import { MIDWEST } from '../../src/content/scenarios';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import { closeInterval } from '../../src/sim/measure/rmf';
import type { JobRuntime } from '../../src/sim/subsys/batch';
import { projectBatchRtPi } from '../../src/sim/wlm/batchRt';
import { emptyScpTick } from '../../src/sim/wlm/evaluate';
import { accPi, ACC_DECAY } from '../../src/sim/wlm/runtime';
import type { Goal } from '../../src/sim/wlm/types';

function fixture(goal: Goal, secondPeriod = false) {
  const scenario = { ...MIDWEST, workloads: [], addressSpaces: [], batchNetwork: () => [] };
  const state = initState(42, scenario);
  state.tick = 6;
  const cls = state.wlm.definition.classes.find((c) => c.id === 'BATCHPRD')!;
  cls.periods = secondPeriod
    ? [{ goal: { kind: 'AVG', rtSec: 30 }, importance: 4, durationSu: 1 }, { goal, importance: 4, durationSu: null }]
    : [{ goal, importance: 4, durationSu: null }];
  const job: JobRuntime = {
    day: 0,
    def: { name: 'ONEJOB', stream: 'TEST', jobClass: 'A', sysaff: 'PROD1', cpuSecRef: 1, ziipFrac: 0, ioCount: 0, lockIntensity: 0, usesDb2: false, preds: [], earliestSec: 0, critical: false, deadlineSec: 86400 },
    status: 'RUNNING', lparId: 'PROD1', progress: .99, queuedTick: 1, startTick: 3, endTick: null, stretch: 1,
  };
  state.batch.jobs = [job];
  return { state, scenario };
}

const measured = (state: ReturnType<typeof initState>, key = 'BATCHPRD#1') =>
  state.wlm.systems.find((s) => s.lparId === 'PROD1')!.scps.find((s) => s.scKey === key)!.acc;

describe('batch response-time goals (WLM Planning 3.1 p.71)', () => {
  it.each<Goal>([{ kind: 'AVG', rtSec: 30 }, { kind: 'PCT', rtSec: 30, pct: 90 }])('has a $kind PI after a job ends and none 25 minutes later', (goal) => {
    const { state, scenario } = fixture(goal);
    let next = step(state, [], scenario);
    expect(next.batch.jobs[0]!.status).toBe('DONE');
    const end = next.rmf.jobsThisInterval[0]!;
    expect([end.queuedSec, end.elapsedSec]).toEqual([20, 40]);
    expect(measured(next).completions).toBe(1);
    expect(measured(next).rtSumSec).toBe(end.queuedSec + end.elapsedSec);
    expect(accPi(goal, measured(next))).toBe(2);
    expect(measured(next).buckets).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
    next = step(next, [], scenario);
    expect(measured(next).completions).toBeCloseTo(.85); // no second completion for the finished job
    for (let i = 1; i < 150; i++) next = step(next, [], scenario);
    expect(accPi(goal, measured(next))).toBeNull();
  });

  it('puts one exact observation in the percentile bucket of the ending period', () => {
    const goal: Goal = { kind: 'PCT', rtSec: 100, pct: 90 };
    const { state, scenario } = fixture(goal, true);
    const next = step(state, [], scenario);
    const acc = measured(next, 'BATCHPRD#2');
    expect(acc.completions).toBe(1);
    expect(acc.rtSumSec).toBe(60);
    expect(acc.buckets).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(accPi(goal, acc)).toBe(.6);
    expect(next.wlm.systems.flatMap((s) => s.scps).filter((p) => p.scKey === 'BATCHPRD#1').every((p) => p.acc.completions === 0)).toBe(true);
  });

  it('counts only when the job finishes', () => {
    const { state, scenario } = fixture({ kind: 'AVG', rtSec: 30 });
    state.batch.jobs[0]!.def.cpuSecRef = 1000;
    state.batch.jobs[0]!.progress = 0;
    const next = step(state, [], scenario);
    expect(next.batch.jobs[0]!.status).toBe('RUNNING');
    expect(measured(next).completions).toBe(0);
  });

  it('keeps the queue part of each completion beside the response-time sum (WT-12)', () => {
    const { state, scenario } = fixture({ kind: 'AVG', rtSec: 30 });
    let next = step(state, [], scenario);
    expect(measured(next).rtQueueSumSec).toBe(20);
    next = step(next, [], scenario);
    expect(measured(next).rtQueueSumSec).toBeCloseTo(20 * ACC_DECAY);
  });

  it("keeps a period's queue/execution split across a goal change (RF-13)", () => {
    const { state, scenario } = fixture({ kind: 'VEL', velocity: 30 });
    const acc = measured(step(state, [], scenario));
    // The job's 20 s initiator wait is recorded under the velocity goal too (R723CQDT is per period, not per goal).
    expect(acc.rtQueueSumSec).toBe(20);
    // The policy then gives the period an average response goal: the split measured under the old goal is available
    // at once, so the WT-12 projection can use it (dev had none until an AVG completion was recorded).
    const t = { ...emptyScpTick('BATCHPRD#1', 0), usingCpu: 1, delayCpu: 1 };
    const projected = projectBatchRtPi({ kind: 'AVG', rtSec: 30 }, acc, t);
    expect(projected).not.toBeNull();
    expect(Number.isFinite(projected)).toBe(true);
    const { rtQueueSumSec: _queue, ...withoutSplit } = acc;
    expect(projectBatchRtPi({ kind: 'AVG', rtSec: 30 }, withoutSplit, t)).toBeNull();
  });

  it('adds simultaneous job completions in the same period', () => {
    const { state, scenario } = fixture({ kind: 'AVG', rtSec: 30 });
    const second = structuredClone(state.batch.jobs[0]!);
    second.def.name = 'TWOJOB';
    second.queuedTick = 3;
    state.batch.jobs.push(second);
    const next = step(state, [], scenario);
    expect(next.batch.jobs.every((j) => j.status === 'DONE')).toBe(true);
    expect(measured(next).completions).toBe(2);
    expect(measured(next).rtSumSec).toBe(100);
    expect(measured(next).buckets.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it.each([
    { goal: { kind: 'AVG', rtSec: 100 } as Goal, secondPeriod: false },
    { goal: { kind: 'PCT', rtSec: 100, pct: 90 } as Goal, secondPeriod: false },
    { goal: { kind: 'AVG', rtSec: 100 } as Goal, secondPeriod: true },
    { goal: { kind: 'PCT', rtSec: 100, pct: 90 } as Goal, secondPeriod: true },
  ])('reports each completed $goal.kind job only in its assigned report class (later period: $secondPeriod)', ({ goal, secondPeriod }) => {
    const { state, scenario } = fixture(goal, secondPeriod);
    state.wlm.definition.reportClasses.push('BATCHRC', 'OTHERRC');
    const jes = state.wlm.definition.subsystems.find((s) => s.subsystem === 'JES')!;
    jes.rules.unshift(...['ONEJOB', 'TWOJOB'].map((pattern, i) => ({
      qualifier: 'TN' as const, pattern, serviceClass: 'BATCHPRD', reportClass: i === 0 ? 'BATCHRC' : 'OTHERRC', children: [],
    })));
    for (const [name, queuedTick] of [['TWOJOB', 3], ['THREEJOB', 5]] as const) {
      const job = structuredClone(state.batch.jobs[0]!);
      job.def.name = name;
      job.queuedTick = queuedTick;
      // The third job waits zero ticks, then runs for 20 seconds.
      if (name === 'THREEJOB') job.startTick = 5;
      state.batch.jobs.push(job);
    }
    let next = step(state, [], scenario);
    next = step(next, [], scenario); // finished jobs must not be counted again
    const iv = closeInterval(next.rmf.acc, { def: next.wlm.definition, config: next.config, r4haByLpar: {}, jobs: [], endTick: next.tick });
    const key = `BATCHPRD#${secondPeriod ? 2 : 1}`;
    const service = iv.wlm.find((r) => r.lparId === 'PROD1' && r.scKey === key)!;
    expect([service.ended, service.avgRtSec]).toEqual([3, 40]);
    for (const system of ['PROD1', '*PLEX']) {
      for (const [name, rtSec, pi] of [['BATCHRC', 60, .6], ['OTHERRC', 40, goal.kind === 'AVG' ? .4 : .5]] as const) {
        const row = iv.wlmRc!.find((r) => r.lparId === system && r.scKey === name)!;
        expect(row.members).toEqual([key]);
        expect([row.ended, row.avgRtSec, row.pi]).toEqual([1, rtSec, pi]);
        expect(row.buckets.reduce((a, b) => a + b, 0)).toBe(1);
      }
    }
  });

  it.each<Goal>([{ kind: 'VEL', velocity: 30 }, { kind: 'DISC' }])('counts a non-RT job end in its period and report class, without a bucket: $kind', (goal) => {
    const { state, scenario } = fixture(goal);
    state.wlm.definition.reportClasses.push('BATCHRC');
    const jes = state.wlm.definition.subsystems.find((s) => s.subsystem === 'JES')!;
    jes.rules.unshift({ qualifier: 'TN', pattern: 'ONEJOB', serviceClass: 'BATCHPRD', reportClass: 'BATCHRC', children: [] });
    const next = step(state, [], scenario);
    expect(next.batch.jobs[0]!.status).toBe('DONE');
    const acc = measured(next);
    // ENDED has no goal-type condition (RMF Report Analysis 3.1 p.530-531): the job is one ended transaction.
    expect([acc.completions, acc.rtSumSec]).toEqual([1, 60]);
    // The queue split is recorded whatever the goal (R723CQDT, RF-13: SMF carries it for every period); only the
    // buckets stay with response-time goals (RMF's velocity distribution is not modelled).
    expect(acc.rtQueueSumSec).toBe(20);
    expect(acc.buckets.every((n) => n === 0)).toBe(true);
    // Neither a velocity nor a discretionary PI reads completions.
    expect(accPi(goal, acc)).toBe(accPi(goal, { ...acc, completions: 0, rtSumSec: 0 }));
    const iv = closeInterval(next.rmf.acc, { def: next.wlm.definition, config: next.config, r4haByLpar: {}, jobs: [], endTick: next.tick });
    for (const system of ['PROD1', '*PLEX']) {
      const row = iv.wlmRc!.find((r) => r.lparId === system && r.scKey === 'BATCHRC')!;
      // The row reports the initiator wait inside its response time (TRANS-TIME QUEUED, RMF Report Analysis p.531).
      expect([row.ended, row.avgRtSec, row.avgQueueSec]).toEqual([1, 60, 20]);
      expect(row.buckets.every((n) => n === 0)).toBe(true);
    }
  });
});
