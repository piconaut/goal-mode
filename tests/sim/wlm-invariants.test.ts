// Invariants of WLM policy adjustment (docs/wlm-design.md §5.9), as property tests over generated images.
// This file holds the ones the PI-basis change (WT-04) is responsible for: I1, I4, I8, I17. Some generated images
// have a CPU-critical class, so CPU protection and the CPU_CRITICAL verdict are reached too.
import { BASEPOL } from '../../src/content/wlm/basepol';
import { PCT_PROJECTION_SIGMA, POLICY_ADJUST } from '../../src/content/wlm/tuning';
import { Rng, seedRng } from '../../src/sim/core/rng';
import { policyAdjust, receiverValueNeeded, setWlmTraceSink, type AdjustInput, type AdjustOutput, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { evaluateLpar, sliceSpec, type ScpTick, type SliceSpec } from '../../src/sim/wlm/evaluate';
import { projectedPercentilePi } from '../../src/sim/wlm/goals';
import { decayInto, emptyAcc, goalInfo, tickPi, type ScpAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';
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
  // Drawn after every other value, so the rest of the case is the same as before this was added: some images have a
  // CPU-critical class, so the CPU_CRITICAL verdict is reached too.
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
});
