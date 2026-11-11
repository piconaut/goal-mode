// Invariants of WLM policy adjustment (docs/wlm-design.md §5.9), as property tests over generated images.
// I1, I4, I8, I17 came with the PI basis (WT-04); I12 and I16 with skip clocks and the interval budget (WT-05). Some
// generated images have a CPU-critical class, so CPU protection and the CPU_CRITICAL verdict are reached too.
import { BASEPOL } from '../../src/content/wlm/basepol';
import { PCT_PROJECTION_SIGMA, POLICY_ADJUST } from '../../src/content/wlm/tuning';
import { Rng, seedRng } from '../../src/sim/core/rng';
import { policyAdjust, receiverValueNeeded, setWlmTraceSink, type AdjustInput, type AdjustOutput, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { evaluateLpar, sliceSpec, type ScpTick, type SliceSpec } from '../../src/sim/wlm/evaluate';
import { projectedPercentilePi } from '../../src/sim/wlm/goals';
import { decayInto, emptyAcc, goalInfo, goalPi, tickPi, type ScpAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';
import type { ServiceDefinition } from '../../src/sim/wlm/types';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };

interface Case {
  def: ServiceDefinition;
  input: AdjustInput;
}

/** A generated image: 2–10 goal periods with random goals, importances, demand, DPs and backlog on 2–8 engines.
 * `history`: how the accumulators were built. 'rest' = one tick at this demand (sustained = tick);
 * 'varied' = eight earlier ticks at 0.4–1.8 × this demand, so some periods are in a quiet tick now. */
function makeCase(seed: number, history: 'rest' | 'varied'): Case {
  const u = (() => { const r = new Rng(seedRng(seed)); return () => r.nextU32() / 2 ** 32; })();
  const int = (lo: number, hi: number) => lo + Math.floor(u() * (hi - lo + 1));
  const def = structuredClone(BASEPOL);
  const template = BASEPOL.classes.find((c) => c.id === 'STCLO')!;
  const n = int(2, 10);
  const engines = int(2, 8);
  const slices: SliceSpec[] = [];
  const dps: Record<string, number> = {};
  const backlog: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const id = `G${String(i).padStart(2, '0')}`;
    const importance = int(1, 5) as 1 | 2 | 3 | 4 | 5;
    const pct = u() < 0.5;
    const rtSec = 0.05 + u() * 0.4;
    def.classes.push({
      ...structuredClone(template),
      id,
      periods: [{ goal: pct ? { kind: 'PCT', pct: int(80, 95), rtSec } : { kind: 'VEL', velocity: int(10, 80) }, importance, durationSu: null }],
    });
    const cp = (0.1 + u() * 1.6) * (engines / 4);
    const key = `${id}#1`;
    dps[key] = int(215, 250);
    if (pct) {
      const rate = 20 + u() * 300;
      slices.push(sliceSpec({ key: `w${i}`, scKey: key, kind: 'TXN', workloadId: `w${i}`, rate, cpEngines: cp, cpuSecPerTxn: cp / rate, baseLatencySec: rtSec * 0.2, rtSigma: 0.5, timeoutSec: history === 'rest' ? Infinity : 30, goalRtSec: rtSec }));
      if (history === 'varied' && u() < 0.3) backlog[`w${i}`] = u() * cp * 60;
    } else {
      slices.push(sliceSpec({ key: `a${i}`, scKey: key, kind: 'AS', cpEngines: cp, units: int(1, 8) }));
    }
  }
  // Some images have a CPU-critical class, so the CPU_CRITICAL verdict is reached too. (Drawn after the periods; the
  // 'varied' history draws after it.)
  if (u() < 0.5) {
    const critical = `G${String(int(0, n - 1)).padStart(2, '0')}`;
    def.classes.find((c) => c.id === critical)!.cpuCritical = true;
  }
  const evalInput = { cpCapacityEngines: engines, cpServers: engines, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog, io: IO, pagingFrac: 0 };
  const dpOf = (k: string) => dps[k]!;
  const accs: Record<string, ScpAcc> = {};
  if (history === 'varied') {
    for (let t = 0; t < 8; t++) {
      const past = slices.map((s) => { const f = 0.4 + u() * 1.4; return { ...s, rate: s.rate * f, cpEngines: s.cpEngines * f }; });
      for (const tick of evaluateLpar({ ...evalInput, slices: past, backlog: {}, dpOf }).scps) accs[tick.scKey] = decayInto(accs[tick.scKey] ?? emptyAcc(), tick);
    }
  }
  const current = evaluateLpar({ ...evalInput, dpOf }).scps;
  for (const tick of current) accs[tick.scKey] = decayInto(accs[tick.scKey] ?? emptyAcc(), tick);
  const system: WlmSystemState = { lparId: 'GEN', scps: current.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: accs[t.scKey]! })) };
  // Every period that misses its goal anywhere is a candidate, as with a sysplex of one.
  return { def, input: { def, system, evalInput, current, sysplexPi: {}, clockText: 'T' } };
}

function traced(input: AdjustInput): { out: AdjustOutput; trace: WlmAdjustTrace } {
  const traces: WlmAdjustTrace[] = [];
  setWlmTraceSink((t) => traces.push(t));
  try {
    return { out: policyAdjust(input), trace: traces[0]! };
  } finally {
    setWlmTraceSink(null);
  }
}

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);

describe('WLM policy adjustment invariants (docs/wlm-design.md §5.9)', () => {
  it('I8 one basis: no trial for a receiver whose projected PI is ≤ 1, and every verdict compares base with after', () => {
    let assessed = 0;
    let recovering = 0;
    let cpuCritical = 0;
    for (const seed of SEEDS) {
      const { trace } = traced(makeCase(seed, 'varied').input);
      for (const c of trace.candidates) {
        if (c.outcome === 'RECOVERING') {
          recovering++;
          expect(c.trials).toEqual([]);
          expect(c.basePi == null || c.basePi <= 1).toBe(true);
        }
        if (c.outcome !== 'ASSESSED') continue;
        assessed++;
        expect(c.basePi).toBeGreaterThan(1);
        for (const t of c.trials) {
          if (t.receiverPi) expect(t.receiverPi[0]).toBe(c.basePi);
          if (t.verdict === 'CPU_CRITICAL') {
            cpuCritical++;
            expect(t.receiverPi).toEqual([c.basePi, null]);
          }
        }
      }
    }
    expect(cpuCritical).toBeGreaterThan(0);
    // The generator has to reach both branches for the property to mean anything.
    expect(assessed).toBeGreaterThan(50);
    expect(recovering).toBeGreaterThan(5);
  });

  it('I4 receiver value: an accepted move closes a tenth of the gap to the goal and at least the floor', () => {
    let accepted = 0;
    for (const seed of SEEDS) {
      const { out, trace } = traced(makeCase(seed, 'varied').input);
      const moved = out.log?.includes('RCVR=') ?? false;
      const acc = trace.candidates.flatMap((c) => c.trials).filter((t) => t.verdict === 'ACCEPTED');
      expect(acc.length).toBe(moved ? 1 : 0);
      for (const t of acc) {
        accepted++;
        const [r0, r1] = t.receiverPi as [number, number];
        expect(r0).toBeGreaterThan(1);
        expect(r0 - r1).toBeGreaterThanOrEqual(receiverValueNeeded(r0) - 1e-12);
        expect(r0 - r1).toBeGreaterThanOrEqual(POLICY_ADJUST.receiverValueMinPi - 1e-12);
      }
    }
    expect(accepted).toBeGreaterThan(20);
  });

  it('I17 projection is honest at rest: with settled demand, no backlog and nothing at its timeout, base is this tick\'s PI', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { def, input } = makeCase(seed, 'rest');
      const { trace } = traced(input);
      // Restored CPU protection moves DPs before `base` is projected, so this tick ran at other DPs.
      if (trace.protection.length > 0) continue;
      const tickOf: Record<string, ScpTick> = {};
      for (const t of input.current) tickOf[t.scKey] = t;
      for (const c of trace.candidates) {
        if (c.basePi === undefined) continue;
        const g = goalInfo(def, c.scKey)!.goal;
        const t = tickOf[c.scKey]!;
        const now = g.kind === 'PCT' ? projectedPercentilePi(t.buckets, g.pct, t.completions, t.rtSumSec, g.rtSec, PCT_PROJECTION_SIGMA) : tickPi(g, t);
        expect(c.basePi).toBe(now);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('I1 determinism: the decision does not depend on the order of periods in state', () => {
    const shuffle = <T,>(xs: readonly T[], seed: number): T[] => {
      const r = new Rng(seedRng(seed * 7919));
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i--) {
        const j = r.nextU32() % (i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    for (const seed of SEEDS) {
      const { input } = makeCase(seed, 'varied');
      const a = policyAdjust(input);
      const b = policyAdjust({ ...input, system: { ...input.system, scps: shuffle(input.system.scps, seed) }, current: shuffle(input.current, seed + 1) });
      expect(b.dps).toEqual(a.dps);
      expect(b.log).toBe(a.log);
      // Same input twice: identical.
      expect(policyAdjust(input)).toEqual(a);
    }
  });

  it('I1 determinism, slices: reordering the slices of an image changes no decision', () => {
    for (const seed of SEEDS) {
      const { input } = makeCase(seed, 'varied');
      const a = policyAdjust(input);
      const b = policyAdjust({ ...input, evalInput: { ...input.evalInput, slices: [...input.evalInput.slices].reverse() } });
      expect(b.dps).toEqual(a.dps);
    }
  });

  /** Projections a trace's trials cost: a CPU-protection or missing-goal rejection is decided without one. */
  const projections = (t: WlmAdjustTrace) =>
    t.candidates.flatMap((c) => c.trials).filter((tr) => tr.verdict !== 'CPU_CRITICAL' && !tr.detail?.includes('would be passed')).length;

  it('I16 cost bound: at most maxProjectionsPerInterval projections per interval, none when every candidate is on its clock', () => {
    let spent = 0;
    let allClocked = 0;
    for (const seed of SEEDS) {
      const { input } = makeCase(seed, 'varied');
      const first = traced({ ...input, nowTick: 0 });
      expect(projections(first.trace)).toBeLessThanOrEqual(POLICY_ADJUST.maxProjectionsPerInterval);
      if (projections(first.trace) === POLICY_ADJUST.maxProjectionsPerInterval) spent++;
      // Every candidate on a clock: nothing is projected.
      const clocked = { ...input.system, scps: input.system.scps.map((p) => ({ ...p, skipUntilTick: 50 })) };
      const quiet = traced({ ...input, system: clocked, nowTick: 1 });
      if (quiet.trace.candidates.length > 0) {
        allClocked++;
        expect(quiet.trace.candidates.every((c) => c.outcome === 'SKIP_CLOCK')).toBe(true);
        expect(projections(quiet.trace)).toBe(0);
        expect(quiet.out.dps).toEqual(Object.fromEntries(input.system.scps.map((p) => [p.scKey, quiet.out.dps[p.scKey]])));
      }
    }
    expect(allClocked).toBeGreaterThan(50);
    expect(spent).toBeGreaterThan(0);
  });

  it('I12 skip clock, no starvation: every candidate is assessed, clocked or recovering within rejectedSkipTicks + 2 intervals', () => {
    // A small budget so it bites; the image is replayed for 40 intervals with its DPs and clocks carried over.
    const saved = POLICY_ADJUST.maxProjectionsPerInterval;
    POLICY_ADJUST.maxProjectionsPerInterval = 3;
    let budgetHits = 0;
    try {
      for (const seed of SEEDS.slice(0, 60)) {
        const { def, input } = makeCase(seed, 'varied');
        const candidates = input.system.scps.filter((p) => {
          const g = goalInfo(def, p.scKey);
          return g && g.goal.kind !== 'DISC' && (goalPi(g.goal, p.acc) ?? 0) > 1;
        }).map((p) => p.scKey);
        const waiting: Record<string, number> = {};
        let system = input.system;
        for (let tick = 0; tick < 40; tick++) {
          const { out, trace } = traced({ ...input, system, nowTick: tick });
          const carried = system;
          system = { ...carried, scps: carried.scps.map((p) => {
            const { skipUntilTick: _, ...rest } = p;
            const c = out.skipUntil[p.scKey];
            return { ...rest, dp: out.dps[p.scKey] ?? p.dp, ...(c !== undefined ? { skipUntilTick: c } : {}) };
          }) };
          const seen = new Map(trace.candidates.map((c) => [c.scKey, c.outcome]));
          // An interval that helped a receiver ends there (one change per interval): that is not starvation.
          if (trace.action !== null) continue;
          for (const k of candidates) {
            const o = seen.get(k);
            if (o === undefined || o === 'BUDGET') {
              if (o === 'BUDGET') budgetHits++;
              waiting[k] = (waiting[k] ?? 0) + 1;
              expect(waiting[k], `${k} seed ${seed} tick ${tick}`).toBeLessThanOrEqual(POLICY_ADJUST.rejectedSkipTicks + 2);
            } else waiting[k] = 0;
          }
        }
      }
    } finally {
      POLICY_ADJUST.maxProjectionsPerInterval = saved;
    }
    expect(budgetHits).toBeGreaterThan(3);
  });
});

