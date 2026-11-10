import { BASEPOL } from '../../src/content/wlm/basepol';
import { BATCH_PROJECTION, PCT_PROJECTION_SIGMA } from '../../src/content/wlm/tuning';
import { advanceJob, emptyBatch, jobCpuDemand, jobPacing, jobShape, releaseNetwork, type JobDef } from '../../src/sim/subsys/batch';
import { policyAdjust, setWlmTraceSink, type WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { batchRecoveryAccepts, type BatchProjectionSlice } from '../../src/sim/wlm/batchProjection';
import { evaluateLpar, prepareLpar, sliceSpec, type LparEvalInput, type LparEvalResult } from '../../src/sim/wlm/evaluate';
import { projectedPercentilePi } from '../../src/sim/wlm/goals';
import { decayInto, emptyAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';

const IO = { RANDOM: { rtSec: .001, delaySec: 0 }, SEQ: { rtSec: .001, delaySec: 0 } };
const DEF: JobDef = { name: 'J', stream: 'RPT', jobClass: 'A', sysaff: null, cpuSecRef: 100000, ziipFrac: .9, ioCount: 150000000, lockIntensity: 0, usesDb2: false, preds: [], earliestSec: 0, critical: false, deadlineSec: 86400 };
const cardPi = (r: LparEvalResult) => {
  const t = r.scps.find((t) => t.scKey === 'ONLCARD#1')!;
  return projectedPercentilePi(t.buckets, 99, t.completions, t.rtSumSec, .1, PCT_PROJECTION_SIGMA)!;
};

function recoveryCase(mayOverflow: boolean, reverse = false) {
  const def = structuredClone(BASEPOL);
  def.classes.push({ ...structuredClone(def.classes.find((c) => c.id === 'ONLHI')!), id: 'ONLCARD', periods: [{ goal: { kind: 'PCT', pct: 99, rtSec: .1 }, importance: 2, durationSu: null }] });
  const dps: Record<string, number> = { 'STCHI#1': 250, 'ONLCARD#1': 244, 'STCLO#1': 243, 'BATCHPRD#1': 242 };
  const jobDef = { ...DEF, ziipFrac: reverse ? .1 : .9 };
  const job = releaseNetwork(emptyBatch(), 0, [jobDef]).jobs[0]!;
  job.status = 'RUNNING';
  const shape = jobShape(jobDef, 1, 1, .001);
  const input = (): LparEvalInput => {
    const d = jobCpuDemand(shape, job, true);
    return { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 2, ziipServers: 2, cpPrsmDelayFrac: 0, slices: [
      sliceSpec({ key: 'fixed', scKey: 'STCHI#1', kind: 'AS', cpEngines: reverse ? 0 : 3.6, ziipEngines: reverse ? 1.6 : 0, units: 4 }),
      sliceSpec({ key: 'card', scKey: 'ONLCARD#1', kind: 'TXN', rate: 200, cpEngines: reverse ? 0 : .2, ziipEngines: reverse ? .2 : 0, cpuSecPerTxn: reverse ? 0 : .001, ziipSecPerTxn: reverse ? .001 : 0, baseLatencySec: .025, rtSigma: .4, goalRtSec: .1, timeoutSec: 30 }),
      sliceSpec({ key: 'zother', scKey: 'STCLO#1', kind: 'AS', cpEngines: reverse ? 4 : 0, ziipEngines: reverse ? 0 : 2, units: 4, mayOverflow }),
      sliceSpec({ key: 'batch', scKey: 'BATCHPRD#1', kind: 'AS', cpEngines: 5 * d.cp, ziipEngines: 5 * d.ziip, units: 5, mayOverflow, reportClass: 'RPT', ioClass: 'SEQ', ioRate: 5 * shape.ioRate / Math.max(1, job.stretch) }),
    ], backlog: {}, io: IO, pagingFrac: 0, dpOf: (k) => dps[k]! };
  };
  for (let tick = 0; tick < 16; tick++) {
    const e = input(), b = evaluateLpar(e).slices[3]!;
    advanceJob(job, shape, { cpWanted: e.slices[3]!.cpEngines / 5, cpGot: b.cpGranted / 5, ziipWanted: e.slices[3]!.ziipEngines / 5, ziipGot: (b.ziipGranted + b.iipcpGranted) / 5, extraStretch: 1 }, tick);
  }
  const e = input(), current = evaluateLpar(e);
  const system: WlmSystemState = { lparId: 'TEST', scps: current.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
  const cp = e.slices[3]!.cpEngines / 5, zi = e.slices[3]!.ziipEngines / 5, grant = current.slices[3]!;
  const next = jobCpuDemand(shape, jobPacing(shape, { cpWanted: cp, cpGot: grant.cpGranted / 5, ziipWanted: zi, ziipGot: (grant.ziipGranted + grant.iipcpGranted) / 5 }), true);
  const batch: BatchProjectionSlice[] = [{ key: 'batch', jobs: Array.from({ length: 5 }, () => ({ shape, cp, zi, nextCp: next.cp, nextZi: next.ziip, cfCpEngines: 0 })) }];
  return { def, dps, job, e, current, system, batch };
}

describe('cross-pool recovery during WLM projections', () => {
  it.each([true, false])('rejects the reproduced F2→F4 raise after zIIP service restores CP demand (CP help %s)', (help) => {
    const { def, dps, job, e, current, system, batch } = recoveryCase(help);
    const snapshot = JSON.stringify({ job, slices: e.slices, batch });
    const frozen = policyAdjust({ def, system, evalInput: e, current: current.scps, sysplexPi: {}, clockText: 'T' });
    expect(frozen.dps['BATCHPRD#1']).toBe(244);
    const trial = { ...e, prepared: prepareLpar(e), dpOf: (k: string) => k === 'BATCHPRD#1' ? 244 : dps[k]! };
    const pis: number[] = [];
    expect(batchRecoveryAccepts(trial, batch, (r) => { pis.push(cardPi(r)); return cardPi(r) < 1; })).toBe(false);
    expect(pis).toEqual([.8, 2]);
    const corrected = policyAdjust({ def, system, evalInput: e, current: current.scps, sysplexPi: {}, clockText: 'T', batch });
    expect(corrected.dps['BATCHPRD#1']).toBe(242);
    expect(JSON.stringify({ job, slices: e.slices, batch })).toBe(snapshot);
  });

  it.each([true, false])('also catches zIIP demand restored by better CP service (CP help %s)', (help) => {
    const { def, dps, e, current, system, batch } = recoveryCase(help, true);
    const frozen = policyAdjust({ def, system, evalInput: e, current: current.scps, sysplexPi: {}, clockText: 'T' });
    expect(frozen.dps['BATCHPRD#1']).toBe(244);
    const pis: number[] = [];
    expect(batchRecoveryAccepts({ ...e, dpOf: (k) => k === 'BATCHPRD#1' ? 244 : dps[k]! }, batch, (r) => { pis.push(cardPi(r)); return cardPi(r) < 1; })).toBe(false);
    expect(pis[0]).toBeLessThan(1);
    expect(pis[1]).toBeGreaterThan(1);
    const corrected = policyAdjust({ def, system, evalInput: e, current: current.scps, sysplexPi: {}, clockText: 'T', batch });
    expect(corrected.dps['BATCHPRD#1']).toBe(242);
  });

  it('still permits useful help when recovered demand has CP headroom', () => {
    const { def, e, system, batch } = recoveryCase(false);
    const slices = e.slices.map((s) => s.key === 'fixed' ? { ...s, cpEngines: 2 } : s);
    const evalInput = { ...e, slices };
    const current = evaluateLpar(evalInput);
    const out = policyAdjust({ def, system, evalInput, current: current.scps, sysplexPi: {}, clockText: 'T', batch });
    expect(out.dps['BATCHPRD#1']).toBe(244);
  });

  it.each(['LPAR', 'RG'])('keeps zIIP demand paced while CP service remains constrained by a %s cap', (cap) => {
    const shape = jobShape({ ...DEF, ziipFrac: .1, ioCount: 0 }, 1, 1, .001);
    const cp = .9, zi = .0001;
    const e: LparEvalInput = { cpCapacityEngines: cap === 'LPAR' ? .01 : 4, cpServers: 4, ziipCapacityEngines: 2, ziipServers: 2, cpPrsmDelayFrac: 0, slices: [sliceSpec({ key: 'batch', scKey: 'BATCHPRD#1', kind: 'AS', cpEngines: cp, ziipEngines: zi, units: 1 })], backlog: {}, io: IO, pagingFrac: 0, dpOf: () => 244, capOf: cap === 'RG' ? () => .01 : undefined };
    const seen: LparEvalResult[] = [];
    expect(batchRecoveryAccepts(e, [{ key: 'batch', jobs: [{ cp, zi, nextCp: cp, nextZi: zi, shape, cfCpEngines: 0 }] }], (r) => { seen.push(r); return true; })).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
    for (const r of seen) {
      expect(r.slices[0]!.cpGranted).toBeLessThanOrEqual(.01);
      expect(r.slices[0]!.ziipGranted).toBeLessThan(.002);
    }
  });

  it('does not record an exhausted recovery trial as accepted (WT-02)', () => {
    // Every accept callback says yes and the recovery still runs out of rounds, so the move is not taken: the trace
    // must not call it ACCEPTED and the player log must not invent a rejection reason for it.
    const { def, system, e, current, batch } = recoveryCase(true);
    const traces: WlmAdjustTrace[] = [];
    const rounds = BATCH_PROJECTION.maxRecoveryRounds;
    BATCH_PROJECTION.maxRecoveryRounds = 0;
    setWlmTraceSink((t) => traces.push(t));
    let out;
    try {
      out = policyAdjust({ def, system, evalInput: e, current: current.scps, sysplexPi: {}, clockText: 'T', batch });
    } finally {
      setWlmTraceSink(null);
      BATCH_PROJECTION.maxRecoveryRounds = rounds;
    }
    expect(out.log).not.toContain('RCVR=');
    expect(out.log).not.toContain('rejected:');
    expect(out.dps['ONLCARD#1']).toBe(244);
    const verdicts = traces[0]!.candidates.flatMap((c) => c.trials.map((t) => t.verdict));
    expect(verdicts).not.toContain('ACCEPTED');
  });

  it('rejects an unsettled trial when its recovery budget is exhausted', () => {
    const { e, dps, batch } = recoveryCase(true);
    const rounds = BATCH_PROJECTION.maxRecoveryRounds;
    BATCH_PROJECTION.maxRecoveryRounds = 0;
    try {
      expect(batchRecoveryAccepts({ ...e, dpOf: (k) => k === 'BATCHPRD#1' ? 244 : dps[k]! }, batch, () => true)).toBe(false);
    } finally { BATCH_PROJECTION.maxRecoveryRounds = rounds; }
  });

  it('keeps heterogeneous jobs, report slices and CF CPU separate during recovery', () => {
    const shapes = [.1, .9].map((ziipFrac) => jobShape({ ...DEF, ziipFrac, ioCount: 0 }, 1, 1, .001));
    const jobs = [
      { shape: shapes[0]!, cp: .04, zi: .01, nextCp: .04, nextZi: .01, cfCpEngines: .03 },
      { shape: shapes[1]!, cp: .03, zi: .01, nextCp: .03, nextZi: .01, cfCpEngines: .02 },
    ];
    const other = { shape: shapes[1]!, cp: .041, zi: .001, nextCp: .041, nextZi: .001, cfCpEngines: .04 };
    const e: LparEvalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 2, ziipServers: 2, cpPrsmDelayFrac: 0, slices: [
      sliceSpec({ key: 'a', scKey: 'BATCHPRD#1', reportClass: 'RPTA', kind: 'AS', cpEngines: .07, ziipEngines: .02, units: 2 }),
      sliceSpec({ key: 'b', scKey: 'BATCHPRD#1', reportClass: 'RPTB', kind: 'AS', cpEngines: .041, ziipEngines: .001, units: 1 }),
    ], backlog: {}, io: IO, pagingFrac: 0, dpOf: () => 244 };
    const seen: LparEvalResult[] = [];
    expect(batchRecoveryAccepts(e, [{ key: 'b', jobs: [other] }, { key: 'a', jobs }], (r) => { seen.push(r); return true; })).toBe(true);
    const last = seen.at(-1)!;
    expect(last.slices[0]!.cpGranted).toBeCloseTo(1.05);
    expect(last.slices[0]!.ziipGranted).toBeCloseTo(1);
    expect(last.slices[1]!.cpGranted).toBeCloseTo(.14);
    expect(last.slices[1]!.ziipGranted).toBeCloseTo(.9);
    expect(last.rcs).toHaveLength(2);
  });

  it('includes demand already enabled by old-DP grants when a trial starves another batch class', () => {
    const def = structuredClone(BASEPOL);
    def.classes.find((c) => c.id === 'ONLHI')!.periods = [{ goal: { kind: 'PCT', pct: 99, rtSec: .1 }, importance: 2, durationSu: null }];
    def.classes.find((c) => c.id === 'BATCHPRD')!.periods = [{ goal: { kind: 'VEL', velocity: 80 }, importance: 3, durationSu: null }];
    def.classes.find((c) => c.id === 'BATCHHI')!.periods = [{ goal: { kind: 'VEL', velocity: 30 }, importance: 4, durationSu: null }];
    const dps: Record<string, number> = { 'STCHI#1': 250, 'ONLHI#1': 244, 'BATCHPRD#1': 242, 'BATCHHI#1': 245 };
    const e: LparEvalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 2, ziipServers: 2, cpPrsmDelayFrac: 0, slices: [
      sliceSpec({ key: 'fixed', scKey: 'STCHI#1', kind: 'AS', cpEngines: 2.59, ziipEngines: 1.2, units: 4 }),
      sliceSpec({ key: 'card', scKey: 'ONLHI#1', kind: 'TXN', rate: 200, cpEngines: .2, cpuSecPerTxn: .001, baseLatencySec: .025, rtSigma: .4, goalRtSec: .1, timeoutSec: 30 }),
      sliceSpec({ key: 'a', scKey: 'BATCHPRD#1', kind: 'AS', cpEngines: .02, ziipEngines: .925, units: 5, mayOverflow: false }),
      sliceSpec({ key: 'b', scKey: 'BATCHHI#1', kind: 'AS', cpEngines: .91, ziipEngines: .415, units: 9, mayOverflow: false }),
    ], backlog: {}, io: IO, pagingFrac: 0, dpOf: (k) => dps[k]! };
    const current = evaluateLpar(e);
    const shapes = [jobShape({ ...DEF, cpuSecRef: 64000, ziipFrac: .6 / .64, ioCount: 160000000 }, 1, 1, .001), jobShape({ ...DEF, cpuSecRef: 33000, ziipFrac: .14 / .33, ioCount: 112000000 }, 1, 1, .001)];
    const batch: BatchProjectionSlice[] = shapes.map((shape, i) => {
      const slice = e.slices[i + 2]!, grant = current.slices[i + 2]!;
      const n = slice.units!, cp = slice.cpEngines / n, zi = slice.ziipEngines / n;
      const next = jobCpuDemand(shape, jobPacing(shape, { cpWanted: cp, cpGot: grant.cpGranted / n, ziipWanted: zi, ziipGot: (grant.ziipGranted + grant.iipcpGranted) / n }), true);
      return { key: slice.key, jobs: Array.from({ length: n }, () => ({ shape, cp, zi, nextCp: next.cp, nextZi: next.ziip, cfCpEngines: 0 })) };
    });
    const system: WlmSystemState = { lparId: 'TEST', scps: current.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    const trialOnly = batch.map((g) => ({ ...g, jobs: g.jobs.map((j) => ({ ...j, nextCp: j.cp, nextZi: j.zi })) }));
    const run = (b: BatchProjectionSlice[]) => policyAdjust({ def, system, evalInput: e, current: current.scps, sysplexPi: {}, clockText: 'T', batch: b });
    expect(run(trialOnly).dps['BATCHPRD#1']).toBe(246);
    expect(run(batch).dps['BATCHPRD#1']).toBe(242);
  });
});
