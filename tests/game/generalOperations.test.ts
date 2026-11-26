import { describe, expect, it } from 'vitest';
import { PACKS } from '../../src/content/packs';
import { applyGameCommand } from '../../src/game/commands';
import { applyTraceCommand } from '../../src/game/dayTrace';
import { operationsView, requestOperation } from '../../src/game/operations';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { buildView } from '../../src/game/view';
import { applyCommand } from '../../src/sim/core/commands';
import { operatorRoster, rolloverOperations, type Operation } from '../../src/sim/core/operations';
import { TICK_SEC, TICKS_PER_DAY } from '../../src/sim/core/units';
import { releaseNetwork } from '../../src/sim/subsys/batch';

const { scenario, game } = PACKS.midwest!;
const content = { ...game, events: [] };
const live = (): RunState => ({ ...startDay(newRun(scenario, content, 42), content), events: [] });
const issue = (r: RunState, op: Operation) => requestOperation(r, scenario, content, op);

describe('general operator commands', () => {
  it('cancels the chosen running batch instance and loses work on a restart', () => {
    const run = live();
    const batch = releaseNetwork(run.sim.batch, 0, scenario.batchNetwork(run.seed, 0, 1));
    const [target, other] = batch.jobs;
    Object.assign(target!, { status: 'RUNNING', lparId: 'PROD1', startTick: 0, progress: 0.8 });
    Object.assign(other!, { status: 'RUNNING', lparId: 'PROD2', startTick: 0 });
    const before = { ...run, sim: { ...run.sim, batch } };
    const op = { kind: 'CANCEL_JOB', day: 0, jobname: target!.def.name, lparId: 'PROD1' } as const;
    const cancelled = issue(before, op);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.run.sim.batch.jobs[0]).toMatchObject({ status: 'ABENDED', failCode: 'S222' });
    expect(cancelled.run.sim.batch.jobs[1]).toBe(other);
    expect(target!.status).toBe('RUNNING');
    const restarted = applyCommand(cancelled.run.sim, { kind: 'RESTART_JOB', day: 0, name: target!.def.name });
    expect(restarted.state.batch.jobs[0]).toMatchObject({ status: 'QUEUED', progress: 0.4 });
  });

  it('replays a TSO logoff at the original tick, with lost hours and trust, and rejects a duplicate', () => {
    const run = live();
    const target = operatorRoster(run.sim, scenario, 'TSO_USER')[0]!;
    const op: Operation = { kind: 'CANCEL_SESSION', target };
    const out = applyGameCommand(run, null, { kind: 'OPERATION', op }, content, scenario);
    expect(out.ok).toBe(true);
    expect(out.run.hoursLeft).toBeLessThan(run.hoursLeft);
    expect(out.run.trust.Digital).toBeLessThan(run.trust.Digital!);
    expect(operatorRoster(out.run.sim, scenario, 'TSO_USER')).not.toContainEqual(target);
    expect(issue(out.run, op)).toMatchObject({ ok: false, run: out.run });
    expect(applyTraceCommand({ run, pendingPolicy: null }, { cmd: 'operation', op }).run).toEqual(out.run);
    const nextDay = { ...out.run, sim: { ...out.run.sim, tick: TICKS_PER_DAY } };
    expect(issue(nextDay, op).ok).toBe(false);
  });

  it('cancels one Db2 thread and sends a failed request plus its replacement through the simulation', () => {
    const run = live();
    const thread = operatorRoster(run.sim, scenario, 'DDF_THREAD').find((t) => t.workloadId === 'MOBILE')!;
    const out = issue(run, { kind: 'CANCEL_SESSION', target: thread });
    expect(out.ok).toBe(true);
    const before = advance(run, scenario, content, 1).sim.last.workloads.find((w) => w.id === 'MOBILE')!;
    const after = advance(out.run, scenario, content, 1).sim.last.workloads.find((w) => w.id === 'MOBILE')!;
    expect(after.failed).toBeCloseTo(before.failed + 1);
    expect(after.arrivalRate).toBeCloseTo(before.arrivalRate + 0.1);
    expect(operationsView(out.run, scenario).threads).not.toContainEqual(expect.objectContaining({ id: thread.id, lparId: thread.lparId, workloadId: thread.workloadId }));
  });

  it('takes the monitoring collector offline until site automation restarts it', () => {
    const run = { ...live(), tools: ['RMF_MON3'] };
    const op = { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'MONAGENT', lparId: 'PROD1' } as const;
    const out = issue(run, op);
    expect(out.ok).toBe(true);
    expect(buildView(out.run, scenario)).toMatchObject({ mon3: null, monitorCollectorDown: true });
    const tick = out.run.sim.cancelledAddressSpaces![0]!.restartTick!;
    expect(buildView({ ...out.run, sim: { ...out.run.sim, tick } }, scenario).monitorCollectorDown).toBe(false);
  });

  it('terminates an active utility and records the lost run', () => {
    const run = live();
    const sim = applyCommand(run.sim, { kind: 'SET_UTILITY_OVERRUN', utility: 'REORG', seqIops: 55_000 }).state;
    const before = { ...run, sim };
    const { id, member, day } = operationsView(before, scenario).utilities.find((u) => u.kind === 'REORG')!;
    const op = { kind: 'TERM_UTILITY', id, member, day } as const;
    const terminated = issue(before, op);
    expect(terminated.ok).toBe(true);
    expect(terminated.run.sim.utilityOverruns).toBeUndefined();
    expect(operationsView(terminated.run, scenario).utilities).not.toContainEqual(expect.objectContaining({ id }));
    expect(operationsView(terminated.run, scenario).missedUtilities).toContainEqual(expect.objectContaining({ id, day }));
    expect(issue(terminated.run, op).ok).toBe(false);
  });

  it('keeps a missed backup visible until a replacement actually completes', () => {
    const run = live();
    const utility = { ...scenario.utilities!.find((u) => u.kind === 'COPY')!, startHour: 6, durationMin: 1, nightFrac: 1 };
    const site = { ...scenario, utilities: [utility] };
    const out = requestOperation(run, site, content, { kind: 'TERM_UTILITY', id: utility.id, member: utility.member, day: 0 });
    expect(out.ok).toBe(true);
    const nextNight = { ...out.run.sim, tick: TICKS_PER_DAY };
    expect(rolloverOperations(nextNight, site).terminatedUtilities).toHaveLength(1);
    const afterCopy = { ...nextNight, tick: nextNight.tick + 60 / TICK_SEC };
    expect(rolloverOperations(afterCopy, site).terminatedUtilities).toBeUndefined();
  });
});
