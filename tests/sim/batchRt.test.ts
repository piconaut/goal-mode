import { BASEPOL } from '../../src/content/wlm/basepol';
import { POLICY_ADJUST } from '../../src/content/wlm/tuning';
import { policyAdjust, setWlmTraceSink, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { projectBatchRtPi } from '../../src/sim/wlm/batchRt';
import { emptyScpTick, evaluateLpar, sliceSpec, type SliceSpec } from '../../src/sim/wlm/evaluate';
import { decayInto, emptyAcc, tickPi, type ScpAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';
import type { Goal } from '../../src/sim/wlm/types';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };

const AVG: Goal = { kind: 'AVG', rtSec: 30 };
const PCT: Goal = { kind: 'PCT', pct: 90, rtSec: 30 };

function tickWith(using: number, delay: number) {
  const t = emptyScpTick('BATCHPRD#1', 240);
  t.usingCpu = using;
  t.delayCpu = delay;
  return t;
}

function accWith(p: { completions?: number; rt?: number; queue?: number; using?: number; delay?: number; buckets?: number[] } = {}): ScpAcc {
  const a = emptyAcc();
  a.completions = p.completions ?? 2;
  a.rtSumSec = p.rt ?? 120;
  a.rtQueueSumSec = p.queue ?? 40;
  a.using = p.using ?? 1;
  a.delay = p.delay ?? 1;
  a.delayCpu = p.delay ?? 1;
  if (p.buckets) a.buckets = p.buckets;
  return a;
}

describe('batch response-time projection (docs/wlm-design.md §9.15)', () => {
  it('scales an AVG PI by the execution-speed change and holds the queue time (Sinram rule)', () => {
    // Q̄ = 20 s, Ē = 40 s. v_ref = 100/200 = 50 %, v' = 200/250 = 80 %.
    // 2 × (20 + 40 × 50/80) / 60 = 1.5.
    expect(projectBatchRtPi(AVG, accWith(), tickWith(2, 0.5))).toBeCloseTo(1.5, 9);
  });

  it('applies the same factor to a PCT PI, with means for the split', () => {
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0]; // two jobs in the 2× goal bucket
    const acc = accWith({ buckets });
    expect(projectBatchRtPi(PCT, acc, tickWith(2, 0.5))).toBeCloseTo(1.5, 9);
  });

  it('uses the 0.1 % velocity floor on both sides', () => {
    // v_ref is 0.1 % (using 1, delay 1000), v' is 100 %; Ē = 40 s, Q̄ = 20 s.
    const expected = 2 * ((20 + 40 * 0.1 / 100) / 60);
    expect(projectBatchRtPi(AVG, accWith({ using: 1, delay: 1000 }), tickWith(1, 0))).toBeCloseTo(expected, 9);
  });

  it('is null when no job completed in the window', () => {
    expect(projectBatchRtPi(AVG, accWith({ completions: 0 }), tickWith(2, 0.5))).toBeNull();
  });

  it('is null when the completion history has expired', () => {
    expect(projectBatchRtPi(AVG, accWith({ completions: 0, rt: 0, queue: 0 }), tickWith(2, 0.5))).toBeNull();
  });

  it('is null when no job of the period is running, so no samples exist', () => {
    expect(projectBatchRtPi(AVG, accWith(), tickWith(0, 0))).toBeNull();
  });

  it('is null when the measured side has no velocity samples', () => {
    expect(projectBatchRtPi(AVG, accWith({ using: 0, delay: 0 }), tickWith(2, 0.5))).toBeNull();
  });

  it('is null without the batch completion queue split', () => {
    const acc = accWith();
    delete acc.rtQueueSumSec;
    expect(projectBatchRtPi(AVG, acc, tickWith(2, 0.5))).toBeNull();
  });

  it('excludes queue-delay samples from both velocities', () => {
    // Queue delay is in Q̄. A tick with a huge queue delay must not change v': the same formula as tickWith(2, .5).
    const t = tickWith(2, 0.5);
    t.delayQueue = 50;
    expect(projectBatchRtPi(AVG, accWith(), t)).toBeCloseTo(1.5, 9);
    const acc = accWith();
    acc.delayQueue = 50;
    acc.delay += 50; // measured delay includes the queue too
    expect(projectBatchRtPi(AVG, acc, tickWith(2, 0.5))).toBeCloseTo(1.5, 9);
  });
});

describe('batch response-time goals in policy adjustment', () => {
  function fixture(goal: Goal) {
    const def = structuredClone(BASEPOL);
    def.classes.find((c) => c.id === 'BATCHPRD')!.periods = [{ goal, importance: 4, durationSu: null }];
    // A less important happy donor at a higher DP; the receiver can pass it safely.
    const slices: SliceSpec[] = [
      sliceSpec({ key: 'bat', scKey: 'BATCHPRD#1', kind: 'AS', cpEngines: 3, units: 8, fixedDemand: true, goalRtSec: goal.kind === 'AVG' || goal.kind === 'PCT' ? goal.rtSec : null }),
      sliceSpec({ key: 'low', scKey: 'STCLO#1', kind: 'AS', cpEngines: 1.5, units: 4, fixedDemand: true }),
    ];
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'BATCHPRD#1': 240, 'STCLO#1': 246 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const recTick = cur.scps.find((t) => t.scKey === 'BATCHPRD#1')!;
    const lowTick = cur.scps.find((t) => t.scKey === 'STCLO#1')!;
    const rec = decayInto(emptyAcc(), recTick);
    rec.completions = 2;
    rec.rtSumSec = 120;
    rec.rtQueueSumSec = 40;
    if (goal.kind === 'PCT') rec.buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0];
    const system: WlmSystemState = {
      lparId: 'SYS1',
      scps: [
        { scKey: 'BATCHPRD#1', dp: 240, starvedSec: 0, acc: rec },
        { scKey: 'STCLO#1', dp: 246, starvedSec: 0, acc: accOfTick(lowTick) },
      ],
    };
    return { def, evalInput, cur, dps, system };
  }

  const accOfTick = (t: ReturnType<typeof emptyScpTick>) => decayInto(emptyAcc(), t);

  function run(goal: Goal) {
    const f = fixture(goal);
    return runWith(f);
  }

  function runWith(f: ReturnType<typeof fixture>) {
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      const out = policyAdjust({ def: f.def, system: f.system, evalInput: f.evalInput, current: f.cur.scps, sysplexPi: {}, clockText: 'T' });
      return { ...f, traces, out };
    } finally {
      setWlmTraceSink(null);
    }
  }

  it.each([AVG, PCT])('gives an AVG/PCT batch-only receiver non-null base and trial PIs ($kind)', (goal) => {
    const { traces } = run(goal);
    const c = traces[0]!.candidates.find((x) => x.scKey === 'BATCHPRD#1')!;
    expect(c.basePi).not.toBeNull();
    expect(c.plans!.length).toBeGreaterThan(0);
    expect(c.trials.length).toBeGreaterThan(0);
    expect(c.trials.every((t) => t.receiverPi?.[0] != null && t.projected)).toBe(true);
  });

  it('raises a CPU-starved batch RT receiver and improves its projected PI', () => {
    const { out, traces, dps } = run(AVG);
    const c = traces[0]!.candidates.find((x) => x.scKey === 'BATCHPRD#1')!;
    expect(out.log).toContain('RCVR=BATCHPRD#1');
    expect(out.dps['BATCHPRD#1']!).toBeGreaterThan(dps['BATCHPRD#1']!);
    const accepted = c.trials.find((t) => t.verdict === 'ACCEPTED') ?? c.trials.find((t) => t.verdict === 'RETAINED');
    expect(accepted).toBeDefined();
    expect(accepted!.receiverPi![1]!).toBeLessThan(accepted!.receiverPi![0]!);
  });

  it('RECOVERING when the measured PI is already met at the current DPs', () => {
    const f = fixture(AVG);
    const rec = f.system.scps.find((p) => p.scKey === 'BATCHPRD#1')!;
    rec.acc.using = 0.05;
    rec.acc.delay = 0.95;
    rec.acc.delayCpu = 0.95;
    rec.acc.rtQueueSumSec = 0;
    const traces: WlmAdjustTrace[] = [];
    setWlmTraceSink((t) => traces.push(t));
    try {
      const out = policyAdjust({ def: f.def, system: f.system, evalInput: f.evalInput, current: f.cur.scps, sysplexPi: {}, clockText: 'T' });
      expect(traces[0]!.candidates.find((x) => x.scKey === 'BATCHPRD#1')).toMatchObject({ outcome: 'RECOVERING', trials: [] });
      expect(out.log).toContain('already recovering');
    } finally {
      setWlmTraceSink(null);
    }
  });

  it('projects a batch RT donor\'s harm through the same formula', () => {
    const f = fixture(AVG);
    f.def.classes.find((c) => c.id === 'STCLO')!.periods = [{ goal: AVG, importance: 5, durationSu: null }];
    const don = f.system.scps.find((p) => p.scKey === 'STCLO#1')!;
    don.acc.completions = 2;
    don.acc.rtSumSec = 24; // measured PI 0.4
    don.acc.rtQueueSumSec = 0;
    const { traces } = runWith(f);
    const c = traces[0]!.candidates.find((x) => x.scKey === 'BATCHPRD#1')!;
    const accepted = c.trials.find((t) => t.verdict === 'ACCEPTED');
    expect(accepted).toBeDefined();
    // The donor lost execution speed; the formula turns that into a non-null, worse projected PI.
    const after = accepted!.afterPis!['STCLO#1'];
    expect(after).not.toBeNull();
    expect(after!).toBeGreaterThan(0.4);
  });

  it('still refuses to push a more important batch RT donor past its goal', () => {
    const f = fixture(AVG);
    const donor = f.def.classes.find((c) => c.id === 'STCLO')!;
    donor.periods = [{ goal: AVG, importance: 3, durationSu: null }];
    const don = f.system.scps.find((p) => p.scKey === 'STCLO#1')!;
    don.acc.completions = 2;
    don.acc.rtSumSec = 54; // measured PI 0.9; at the receiver's DP it would cross 1
    don.acc.rtQueueSumSec = 0;
    const { traces, out } = runWith(f);
    const c = traces[0]!.candidates.find((x) => x.scKey === 'BATCHPRD#1')!;
    expect(c.trials.some((t) => t.verdict === 'MORE_IMPORTANT_HARMED' && t.blockedBy === 'STCLO#1')).toBe(true);
    expect(out.log).toContain('more important');
  });

  it('applies receiver value to a batch RT receiver', () => {
    const f = fixture(AVG);
    const saved = { ...POLICY_ADJUST };
    Object.assign(POLICY_ADJUST, { receiverValueMinPi: 100 });
    try {
      const { traces } = runWith(f);
      const c = traces[0]!.candidates.find((x) => x.scKey === 'BATCHPRD#1')!;
      expect(c.trials.length).toBeGreaterThan(0);
      expect(c.trials.every((t) => t.verdict !== 'ACCEPTED')).toBe(true);
      expect(c.trials.every((t) => t.receiverPi?.[0] != null)).toBe(true);
    } finally {
      Object.assign(POLICY_ADJUST, saved);
    }
  });

  it('uses the transaction projection when only a decayed batch observation remains (B1)', () => {
    const def = structuredClone(BASEPOL);
    def.classes.find((c) => c.id === 'BATCHPRD')!.periods = [{ goal: { kind: 'AVG', rtSec: 3 }, importance: 4, durationSu: null }];
    const slices: SliceSpec[] = [
      sliceSpec({ key: 'txn', scKey: 'BATCHPRD#1', kind: 'TXN', workloadId: 'w', rate: 200, cpEngines: 3, cpuSecPerTxn: 3 / 200, baseLatencySec: 0.02, rtSigma: 0.5, timeoutSec: 30, goalRtSec: 3 }),
      sliceSpec({ key: 'low', scKey: 'STCLO#1', kind: 'AS', cpEngines: 1.5, units: 4, fixedDemand: true }),
    ];
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'BATCHPRD#1': 240, 'STCLO#1': 246 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const recTick = cur.scps.find((t) => t.scKey === 'BATCHPRD#1')!;
    const lowTick = cur.scps.find((t) => t.scKey === 'STCLO#1')!;
    const rec = decayInto(emptyAcc(), recTick);
    rec.completions = 2;
    rec.rtSumSec = 80; // one old batch job: 40 s response, 20 s queue
    rec.rtQueueSumSec = 40;
    const system: WlmSystemState = {
      lparId: 'SYS1',
      scps: [
        { scKey: 'BATCHPRD#1', dp: 240, starvedSec: 0, acc: rec },
        { scKey: 'STCLO#1', dp: 246, starvedSec: 0, acc: accOfTick(lowTick) },
      ],
    };
    const { traces } = runWith({ def, evalInput, cur, dps, system });
    const c = traces[0]!.candidates.find((x) => x.scKey === 'BATCHPRD#1')!;
    const goal = def.classes.find((x) => x.id === 'BATCHPRD')!.periods[0]!.goal;
    expect(c.basePi).toBe(tickPi(goal, recTick, Infinity));
    expect(c.basePi!).toBeLessThanOrEqual(1);
    expect(c.trials).toEqual([]);
  });
});
