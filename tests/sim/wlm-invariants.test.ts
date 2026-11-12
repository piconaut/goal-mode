// Invariants of WLM policy adjustment (docs/wlm-design.md §5.9), as property tests over generated images.
// I1, I4, I8, I17 came with the PI basis (WT-04); I12 and I16 with skip clocks and the interval budget (WT-05). Some
// generated images have a CPU-critical class, so CPU protection and the CPU_CRITICAL verdict are reached too.
import { BASEPOL } from '../../src/content/wlm/basepol';
import { PCT_PROJECTION_SIGMA, POLICY_ADJUST } from '../../src/content/wlm/tuning';
import { Rng, seedRng } from '../../src/sim/core/rng';
import { policyAdjust, receiverValueNeeded, setWlmTraceSink, type AdjustInput, type AdjustOutput, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { cpuProtected } from '../../src/sim/wlm/adjust';
import { ladderOf, levelDp } from '../../src/sim/wlm/ladder';
import { DP } from '../../src/sim/zos/dispatcher';
import { evaluateLpar, sliceSpec, type ScpTick, type SliceSpec } from '../../src/sim/wlm/evaluate';
import { projectedPercentilePi } from '../../src/sim/wlm/goals';
import { ACC_DECAY, decayInto, emptyAcc, goalInfo, goalPi, tickPi, type ScpAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';
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
  it('repairs aggregate equal-importance NO_NET_VALUE by carrying its largest harmed period (real evaluator)', () => {
    // Tied lower periods G00/G03/G06 below five donors. Raising G00 alone narrows each PI gap but
    // costs more total harm than it gains; carrying G03 preserves the gain without that harm.
    const { input } = makeCase(1044, 'rest');
    for (const c of input.def.classes.filter((c) => c.id.startsWith('G'))) c.periods[0]!.importance = 2;
    input.system.scps.forEach((p, i) => { p.dp = i % 3 === 0 ? 244 : 246; });
    const held = Object.fromEntries(input.system.scps.map((p) => [p.scKey, p.dp]));
    input.current = evaluateLpar({ ...input.evalInput, dpOf: (k) => held[k]! }).scps;
    for (const p of input.system.scps) p.acc = decayInto(emptyAcc(), input.current.find((t) => t.scKey === p.scKey)!);
    const { out, trace } = traced(input);
    const receiver = trace.candidates[0]!;
    expect(receiver.scKey).toBe('G00#1');
    expect(receiver.trials.map((t) => t.verdict)).toEqual(['NO_NET_VALUE', 'ACCEPTED']);
    expect(receiver.trials[0]!.blockedBy).toBe('G03#1');
    expect(receiver.trials[0]!.detail).toBe('gain 149.37 ≤ equal-importance harm 192.30');
    expect(receiver.trials[1]!.plan?.map((m) => [m.kind, m.scKey])).toEqual([['UP', 'G00#1'], ['CARRY', 'G03#1']]);
    expect(out.dps).toEqual({ 'G00#1': 244, 'G01#1': 246, 'G02#1': 246, 'G03#1': 244, 'G04#1': 246, 'G05#1': 246, 'G06#1': 242, 'G07#1': 246 });
    expect(receiver.trials[1]!.receiverPi![1]!).toBeCloseTo(90.90406894046295);
    expect(receiver.trials[1]!.afterPis!['G03#1']).toBeCloseTo(2.6765215857532136);
  });

  it('I13 settles at constant demand: no plan after interval 30, including ten subsequent clock cycles', () => {
    const { input } = makeCase(134, 'rest');
    let system = input.system;
    let changed = 0;
    for (let tick = 0; tick < 90; tick++) {
      const held = Object.fromEntries(system.scps.map((p) => [p.scKey, p.dp]));
      const current = evaluateLpar({ ...input.evalInput, dpOf: (k) => held[k]! }).scps;
      system = { ...system, scps: system.scps.map((p) => ({ ...p, acc: decayInto(p.acc, current.find((c) => c.scKey === p.scKey)!) })) };
      const out = policyAdjust({ ...input, system, current, nowTick: tick });
      if (out.log?.includes('RCVR=')) { changed++; expect(tick).toBeLessThan(30); }
      system = { ...system, scps: system.scps.map((p) => {
        const { skipUntilTick: _, resumeSearch: _r, ...rest } = p;
        return { ...rest, dp: out.dps[p.scKey]!, ...(out.skipUntil[p.scKey] !== undefined ? { skipUntilTick: out.skipUntil[p.scKey] } : {}),
          ...(out.resumeAt === p.scKey ? { resumeSearch: true as const } : {}) };
      }) };
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('I2/I5/I6: one atomic plan, safe for every period, with receiver value on the original base', () => {
    let accepted = 0, carried = 0;
    for (const seed of SEEDS) {
      const { input } = makeCase(seed, 'rest');
      const { out, trace } = traced(input);
      const plans = trace.candidates.flatMap((c) => c.trials.filter((t) => t.verdict === 'ACCEPTED').map((t) => ({ c, t })));
      expect(plans.length).toBeLessThanOrEqual(1);
      if (plans.length === 0) { expect(out.dps).toEqual(trace.dps); continue; }
      accepted++;
      const { c, t } = plans[0]!;
      expect(t.plan!.length).toBeLessThanOrEqual(POLICY_ADJUST.maxPlanSteps);
      carried += t.plan!.filter((m) => m.kind === 'CARRY').length;
      const piAt = (dps: Record<string, number>) => Object.fromEntries(evaluateLpar({ ...input.evalInput, dpOf: (k) => dps[k]! }).scps.map((s) => {
        const g = goalInfo(input.def, s.scKey)!.goal;
        return [s.scKey, g.kind === 'PCT' ? projectedPercentilePi(s.buckets, g.pct, s.completions, s.rtSumSec, g.rtSec, PCT_PROJECTION_SIGMA) : tickPi(g, s)];
      }));
      const before = piAt(trace.dps), after = piAt(out.dps);
      expect(t.afterPis).toEqual(after);
      const r0 = before[c.scKey]!, r1 = after[c.scKey]!;
      expect(r0 - r1).toBeGreaterThanOrEqual(receiverValueNeeded(r0));
      let equalHarm = 0;
      for (const k of Object.keys(before)) {
        if (k === c.scKey || before[k] == null || after[k] == null) continue;
        const importance = goalInfo(input.def, k)!.importance;
        const p0 = before[k]!, p1 = after[k]!;
        const harm = Math.max(0, p1 - Math.max(p0, POLICY_ADJUST.creditFloor));
        if (importance < c.importance) {
          if (p0 <= 1) expect(p1).toBeLessThanOrEqual(1);
          else expect(harm).toBeLessThanOrEqual(POLICY_ADJUST.harmEps);
        } else if (importance === c.importance && harm > POLICY_ADJUST.harmEps) {
          expect(Math.abs(r1 - p1)).toBeLessThan(Math.abs(r0 - p0));
          equalHarm += harm;
        }
      }
      if (equalHarm > 0) expect(r0 - Math.max(r1, POLICY_ADJUST.creditFloor)).toBeGreaterThan(equalHarm);
    }
    expect(accepted).toBeGreaterThan(20);
    expect(carried).toBeGreaterThan(0); // seed 134 needs the carry: real dispatcher and PI computation, not a fake assessor.
  });

  it('I7 donor order: trials follow happy PI order, then reverse importance/PI order on the delayed processor', () => {
    let donorsTried = 0;
    let happyTried = 0;
    let unhappyTried = 0;
    for (const seed of SEEDS) {
      const { input } = makeCase(seed, 'varied');
      const { trace } = traced(input);
      for (const c of trace.candidates.filter((c) => c.outcome === 'ASSESSED')) {
        // An independent partition/order, using the actual DPs after protection and the measured history.
        const pool = input.system.scps.flatMap((s) => {
          const g = goalInfo(input.def, s.scKey);
          const use = (c.bottleneck === 'CPU' ? s.acc.cpuEngines : s.acc.ziipEngines ?? 0) * (1 - ACC_DECAY);
          if (!g || g.goal.kind === 'DISC' || s.scKey === c.scKey || trace.dps[s.scKey]! < c.dp || use < POLICY_ADJUST.donorMinEngines) return [];
          // No PI at all counts as missing the goal (managementWorstPi), so it is never taken as happy.
          const own = goalPi(g.goal, s.acc);
          const plex = input.sysplexPi[s.scKey];
          const pi = own == null && plex == null ? Infinity : Math.max(own ?? 0, plex ?? 0);
          if (pi > 1 && g.importance < c.importance) return [];
          return [{ key: s.scKey, importance: g.importance, pi }];
        });
        const byPi = (a: typeof pool[number], b: typeof pool[number]) => (a.pi === b.pi ? 0 : a.pi - b.pi) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
        const expected = pool.filter((p) => p.pi < 1).sort(byPi);
        for (const imp of [5, 4, 3, 2, 1]) expected.push(...pool.filter((p) => p.pi >= 1 && p.importance === imp).sort(byPi));
        const order = expected.slice(0, POLICY_ADJUST.donorsPerReceiver).map((p) => p.key);
        expect(c.donors).toEqual(order);
        const tried = c.trials.filter((t) => t.steps?.[0]?.kind === 'DONOR').map((t) => t.steps![0]!.scKey);
        expect(tried).toEqual(order.filter((k) => tried.includes(k)));
        expect(new Set(tried).size).toBe(tried.length);
        donorsTried += tried.length;
        happyTried += tried.filter((k) => pool.find((p) => p.key === k)!.pi < 1).length;
        unhappyTried += tried.filter((k) => pool.find((p) => p.key === k)!.pi >= 1).length;
      }
    }
    expect(donorsTried).toBeGreaterThan(20);
    expect(happyTried).toBeGreaterThan(0);
    expect(unhappyTried).toBeGreaterThan(0);
  });

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
    t.candidates.flatMap((c) => c.trials).filter((tr) => tr.projected).length;

  it('I16 cost bound: at most maxProjectionsPerInterval projections per interval, none when every candidate is on its clock', () => {
    let spent = 0;
    let allClocked = 0;
    // RF-03's five-period exception is tested in adjust.test.ts; here every clock must be honoured, or the quiet
    // interval below would assess instead of skipping.
    const savedMinMissing = POLICY_ADJUST.skipClockMinMissing;
    POLICY_ADJUST.skipClockMinMissing = -1;
    try {
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
          // No receiver moved: the DPs are the input's, or what CPU protection restored before the search.
          if (quiet.out.protect === null) expect(ladderOf(quiet.out.dps)).toEqual(ladderOf(Object.fromEntries(input.system.scps.map((p) => [p.scKey, p.dp]))));
        }
      }
    } finally {
      POLICY_ADJUST.skipClockMinMissing = savedMinMissing;
    }
    expect(allClocked).toBeGreaterThan(50);
    expect(spent).toBeGreaterThan(0);
  });

  it('I16 cost bound, over budget: an image that wants many times the budget gets exactly the budget', () => {
    // Twelve importance-1 receivers no move helps (PR/SM delay), each with three raises and three happy donors to
    // try: 72 projections with no budget.
    const def = structuredClone(BASEPOL);
    const template = BASEPOL.classes.find((c) => c.id === 'STCLO')!;
    const keys = Array.from({ length: 15 }, (_, i) => `H${String(i).padStart(2, '0')}`);
    keys.forEach((id, i) => def.classes.push({ ...structuredClone(template), id, periods: [{ goal: { kind: 'VEL', velocity: i < 12 ? 90 : 5 }, importance: 1, durationSu: null }] }));
    const slices = keys.map((id) => sliceSpec({ key: id, scKey: `${id}#1`, kind: 'AS', cpEngines: 0.01, units: 1 }));
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0.3, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = {};
    keys.forEach((id, i) => (dps[`${id}#1`] = i < 12 ? 0xf0 : 0xf1 + i - 12));
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = { lparId: 'SYS1', scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    const input: AdjustInput = { def, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T', nowTick: 0 };
    const { trace } = traced(input);
    expect(projections(trace)).toBe(POLICY_ADJUST.maxProjectionsPerInterval);
    const saved = POLICY_ADJUST.maxProjectionsPerInterval;
    POLICY_ADJUST.maxProjectionsPerInterval = 1000;
    try {
      expect(projections(traced(input).trace)).toBeGreaterThan(3 * saved);
    } finally {
      POLICY_ADJUST.maxProjectionsPerInterval = saved;
    }
  });

  it('I12 skip clock, no starvation: every candidate is assessed, clocked or recovering within rejectedSkipTicks + 2 intervals', () => {
    // Half the default budget, so it bites but the rotation still leaves the clock bound meaningful; the image is
    // replayed for 40 intervals with its DPs and clocks carried over.
    const saved = POLICY_ADJUST.maxProjectionsPerInterval;
    POLICY_ADJUST.maxProjectionsPerInterval = 6;
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
            const { skipUntilTick: _, resumeSearch: _r, ...rest } = p;
            const c = out.skipUntil[p.scKey];
            return { ...rest, dp: out.dps[p.scKey] ?? p.dp, ...(c !== undefined ? { skipUntilTick: c } : {}), ...(p.scKey === out.resumeAt ? { resumeSearch: true as const } : {}) };
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

  it('I14 not fixable, not moved: a receiver with neither CPU nor zIIP delay a real share of its delay changes no DP', () => {
    let notFixable = 0;
    let waitingNotes = 0;
    for (const seed of SEEDS) {
      const { input } = makeCase(seed, 'varied');
      // The same images with nine tenths of every period's CPU and zIIP delay turned into I/O delay, and on odd seeds
      // waits three times the period's other samples.
      const scps = input.system.scps.map((p) => {
        const a = p.acc;
        const moved = 0.9 * (a.delayCpu + a.delayZiip);
        return { ...p, acc: { ...a, delayCpu: 0.1 * a.delayCpu, delayZiip: 0.1 * a.delayZiip, delayIo: a.delayIo + moved,
          delayOther: seed % 2 ? 3 * (a.using + a.delay) : a.delayOther } };
      });
      const { out, trace } = traced({ ...input, system: { ...input.system, scps } });
      for (const c of trace.candidates) {
        expect(['NOT_FIXABLE', 'NO_MANAGED_DELAY', 'SKIP_CLOCK']).toContain(c.outcome);
        expect(c.trials).toEqual([]);
        expect(c.basePi).toBeUndefined();
        if (c.outcome === 'NOT_FIXABLE') notFixable++;
      }
      expect(out.skipUntil).toEqual({});
      // The DPs are the input's (made canonical, WT-06), or what CPU protection restored before the search.
      if (out.protect === null) expect(ladderOf(out.dps)).toEqual(ladderOf(Object.fromEntries(input.system.scps.map((p) => [p.scKey, p.dp]))));
      if (seed % 2 && trace.candidates.length > 0) {
        expect(out.log).toMatch(/ mostly waiting, CPU delay \d+ %: not WLM-fixable$/);
        waitingNotes++;
      }
    }
    expect(notFixable).toBeGreaterThan(50);
    expect(waitingNotes).toBeGreaterThan(20);
  });

  it('I9 canonical ladder: after every interval the goal DPs are MANAGED_MAX − 1 − 2i; fixed DPs never change', () => {
    let moved = 0;
    for (const seed of SEEDS) {
      const { def, input } = makeCase(seed, 'varied');
      // Work outside goal management on the same image: SYSSTC and discretionary keep their DPs.
      const fixed = [{ scKey: 'SYSSTC#1', dp: DP.SYSSTC }, { scKey: 'SYSOTHER#1', dp: 196 }];
      const system = { ...input.system, scps: [...input.system.scps, ...fixed.map((f) => ({ ...f, starvedSec: 0, acc: emptyAcc() }))] };
      const out = policyAdjust({ ...input, system, ccImp: seed % 3 });
      if (out.log?.includes('RCVR=')) moved++;
      for (const f of fixed) expect(out.dps[f.scKey]).toBe(f.dp);
      const goal = Object.keys(out.dps).filter((k) => goalInfo(def, k)?.goal.kind !== 'DISC' && goalInfo(def, k) !== null);
      const levels = [...new Set(goal.map((k) => out.dps[k]!))].sort((a, b) => b - a);
      expect(levels).toEqual(levels.map((_, i) => levelDp(i)));
      for (const k of goal) {
        expect(out.dps[k]).toBeLessThan(DP.MANAGED_MAX);
        expect(out.dps[k]).toBeGreaterThanOrEqual(DP.MANAGED_MIN);
      }
    }
    expect(moved).toBeGreaterThan(10);
  });

  it('I10 CPU protection: after every interval no less important period is at or above a protected one', () => {
    let protectedPairs = 0;
    for (const seed of SEEDS) {
      const { def, input } = makeCase(seed, 'varied');
      const ccImp = seed % 3;
      const out = policyAdjust({ ...input, ccImp });
      const keys = input.system.scps.map((p) => p.scKey);
      for (const k of keys) {
        const g = goalInfo(def, k)!;
        if (!cpuProtected(g, ccImp)) continue;
        for (const k2 of keys) {
          if (goalInfo(def, k2)!.importance <= g.importance) continue;
          protectedPairs++;
          expect(out.dps[k2]!, `${k2} vs protected ${k} (seed ${seed})`).toBeLessThan(out.dps[k]!);
        }
      }
    }
    expect(protectedPairs).toBeGreaterThan(50);
  });

  it('I15 minimum above goal work: a resource-group minimum and promotion are dispatched above every goal period', () => {
    expect(DP.RG_MINIMUM).toBeGreaterThan(DP.MANAGED_MAX);
    expect(DP.PROMOTED).toBeGreaterThan(DP.RG_MINIMUM);
    // C-4: a period low on the ladder with a 1-engine minimum gets it from a hog on the top level.
    const slices = [
      sliceSpec({ key: 'hog', scKey: 'HOG#1', kind: 'AS', cpEngines: 4, units: 8 }),
      sliceSpec({ key: 'min', scKey: 'MIN#1', kind: 'AS', cpEngines: 2, units: 4 }),
    ];
    const dps: Record<string, number> = { 'HOG#1': levelDp(0), 'MIN#1': levelDp(5) };
    const base = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, dpOf: (k: string) => dps[k]! };
    const got = (r: ReturnType<typeof evaluateLpar>) => r.slices[1]!.cpGranted;
    expect(got(evaluateLpar(base))).toBeLessThan(0.1);
    expect(got(evaluateLpar({ ...base, minOf: { 'MIN#1': 1 } }))).toBeCloseTo(1, 2);
  });
});
