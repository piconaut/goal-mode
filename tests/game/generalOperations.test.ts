import { describe, expect, it } from 'vitest';
import { PACKS } from '../../src/content/packs';
import { applyGameCommand } from '../../src/game/commands';
import { applyTraceCommand } from '../../src/game/dayTrace';
import { addPin } from '../../src/game/evidence';
import { buildMon3 } from '../../src/game/mon3';
import { emptyMon3History, mon3At, recordMon3History } from '../../src/game/mon3History';
import { emptyMon3PinHistory, mon3PinsAt, recordMon3Pins } from '../../src/game/mon3PinHistory';
import { chargeHeldRecalls, operationsView, requestOperation } from '../../src/game/operations';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { buildView } from '../../src/game/view';
import { applyCommand, applyCommands } from '../../src/sim/core/commands';
import { CANCEL_WARNINGS, OPERATION_TRUST, OPERATIONS } from '../../src/content/operations';
import { gatewayChannels, operatorRoster, rolloverOperations, type Operation } from '../../src/sim/core/operations';
import { TICK_SEC, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
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

  it('cancelling MONAGENT pauses alerting only; Monitor III keeps gathering', () => {
    const run = { ...live(), tools: ['RMF_MON3', 'ALERTS'] };
    const out = issue(run, { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'MONAGENT', lparId: 'PROD1' });
    expect(out.ok).toBe(true);
    const v = buildView(out.run, scenario);
    expect(v.alerts?.agentDown).toBe(true);
    expect(v.mon3).not.toBeNull();
    expect(v.mon3!.missingSystems).toBeUndefined();
    const tick = out.run.sim.cancelledAddressSpaces![0]!.restartTick!;
    expect(buildView({ ...out.run, sim: { ...out.run.sim, tick } }, scenario).alerts?.agentDown).toBe(false);
  });

  it('cancelling RMFGAT leaves a Monitor III gap on that system only, until automation restarts it', () => {
    const run = advance({ ...live(), tools: ['RMF_MON3'] }, scenario, content, 3 * TICKS_PER_HOUR);
    const out = issue(run, { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'RMFGAT', lparId: 'PROD1' });
    expect(out.ok).toBe(true);
    const full = buildMon3(run, scenario);
    const m = buildView(out.run, scenario).mon3!;
    expect(m.missingSystems).toEqual([{ system: 'PROD1', reason: 'Gatherer not active' }]);
    expect(m.systems.map((s) => s.system)).not.toContain('PROD1');
    expect(m.systems.map((s) => s.system)).toContain('PROD2');
    expect(m.rows.some((r) => r.system === 'PROD1')).toBe(false);
    expect(m.procJobs?.some((j) => j.system === 'PROD1')).toBe(false);
    expect(m.wkm?.flatMap((w) => w.servers).some((x) => x.system === 'PROD1')).toBe(false);
    // The other systems' rows are unchanged; the sysplex rows count only them.
    const prod2 = (v: typeof m) => v.rows.filter((r) => r.system === 'PROD2');
    expect(prod2(m)).toEqual(prod2(full));
    for (const r of m.rows.filter((x) => x.system === '*PLEX')) {
      const sum = m.rows.filter((x) => x.system !== '*PLEX' && x.scKey === r.scKey).reduce((a, x) => a + x.cpuEngines, 0);
      expect(r.cpuEngines).toBeCloseTo(sum, 9);
    }
    // The CPC section still lists every partition (another gatherer on the CPC reads the PR/SM data).
    expect(m.cpc.map((c) => c.lparId)).toEqual(full.cpc.map((c) => c.lparId));
    const pin = (system: string) => addPin(out.run, scenario, { source: 'MON3', system, scKey: m.rows.find((r) => r.system === '*PLEX')!.scKey, metric: 'PI' });
    expect(pin('PROD1')).toMatchObject({ ok: false, message: 'Monitor III gatherer not active on PROD1 in that range' });
    expect(pin('*PLEX').ok).toBe(true);
    // Both histories keep the gap, so a past range inside it shows it and refuses the pin too.
    const at = out.run.sim.tick;
    expect(mon3At(recordMon3History(emptyMon3History(), at, m), at)!.view.missingSystems).toEqual(m.missingSystems);
    const cli = mon3PinsAt(recordMon3Pins(emptyMon3PinHistory(), at, m), at)!;
    expect(cli.view.missingSystems).toEqual(m.missingSystems);
    expect(addPin(out.run, scenario, { source: 'MON3', system: 'PROD1', scKey: 'ONLHI#1', metric: 'PI', tick: at }, () => cli).message).toBe('Monitor III gatherer not active on PROD1 in that range');
    const tick = out.run.sim.cancelledAddressSpaces![0]!.restartTick!;
    expect(buildMon3({ ...out.run, sim: { ...out.run.sim, tick } }, scenario).missingSystems).toBeUndefined();
  }, 60_000);

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
  it('keeps offered gateway traffic and recall demand visible while protection masks admitted work', () => {
    const run = live();
    const surged = { ...run, sim: applyCommands(run.sim, [
      { kind: 'SET_MODIFIER', mod: 'rate', key: 'MOBILE', value: 2.5 },
      { kind: 'SET_LCU', lcuId: '30', extraIops: { RANDOM: 60_000 } },
    ]) };
    const control = advance(surged, scenario, content, 1);
    let guarded = issue(surged, { kind: 'SET_GATEWAY', workloadId: 'MOBILE', mode: 'BLOCK' }).run;
    guarded = issue(guarded, { kind: 'HOLD_HSM_RECALL', held: true }).run;
    guarded = advance(guarded, scenario, content, 1);
    const view = operationsView(guarded, scenario);
    const offered = control.sim.last.workloads.find((w) => w.id === 'MOBILE')!.arrivalRate;
    const admitted = guarded.sim.last.workloads.find((w) => w.id === 'MOBILE')!.arrivalRate;
    expect(admitted).toBeLessThan(offered);
    expect(view.gateway.find((g) => g.id === 'MOBILE')).toMatchObject({ offeredRatePerSec: offered });
    expect(view.recalls.incomingIops).toBe(60_000);
    const legacy = {
      ...guarded,
      sim: {
        ...guarded.sim,
        last: {
          ...guarded.sim.last,
          workloads: guarded.sim.last.workloads.map((row) => {
            const copy = { ...row };
            delete copy.offeredRate;
            return copy;
          }),
        },
      },
    };
    expect(operationsView(legacy, scenario).gateway.find((g) => g.id === 'MOBILE')!.offeredRatePerSec).toBe(admitted);
  });

  it('charges each CICS owner once when recycling a region', () => {
    const run = live();
    const { name, lparId } = scenario.world.cics[0]!;
    const before = run.trust.Retail!;
    const out = issue(run, { kind: 'RECYCLE_CICS', targets: [{ name, lparId }] });
    expect(out.ok).toBe(true);
    // Retail owns both RBANK and TELLER, which route to this image.
    expect(out.run.trust.Retail).toBeCloseTo(before - 1);
  });

  it('removes a logged-off TSO user\'s share of demand on its image', () => {
    const run = live();
    const target = operatorRoster(run.sim, scenario, 'TSO_USER').sort((a, b) => b.shareFrac - a.shareFrac)[0]!;
    const out = issue(run, { kind: 'CANCEL_SESSION', target });
    expect(out.ok).toBe(true);
    const cpu = (r: RunState) => {
      const grant = advance(r, scenario, content, 1).sim.last.lpars.find((l) => l.lparId === target.lparId)?.cpByWorkload?.[target.workloadId];
      return grant ? grant.cp + (grant.iipcp ?? 0) + grant.ziip : 0;
    };
    const before = cpu(run);
    expect(before).toBeGreaterThan(0);
    expect(cpu(out.run)).toBeCloseTo(before * (1 - target.shareFrac), 6);
  });

  it('makes Db2 work on a member dearer while its RUNSTATS run is missing', () => {
    const run = live();
    const member = run.sim.config.db2.find((m) => m.lparId === 'PROD1')!.ssid;
    const missed = { ...run, sim: { ...run.sim, terminatedUtilities: [{ id: 'RSTEST', day: 0, kind: 'RUNSTATS' as const, member, object: 'TEST' }] } };
    const other = { ...run, sim: { ...run.sim, terminatedUtilities: [{ id: 'CPTEST', day: 0, kind: 'COPY' as const, member, object: 'TEST' }] } };
    const cpu = (r: RunState) => {
      const g = advance(r, scenario, content, 1).sim.last.lpars.find((l) => l.lparId === 'PROD1')!.cpByWorkload!.RBANK!;
      return g.cp + (g.iipcp ?? 0) + g.ziip;
    };
    const base = cpu(run);
    expect(cpu(other)).toBeCloseTo(base, 9);
    expect(cpu(missed)).toBeGreaterThan(base * 1.01);
  });

  it('with every gatherer down, Monitor III lists every system as missing and the sysplex rows are empty', () => {
    let run = advance({ ...live(), tools: ['RMF_MON3', 'ALERTS'] }, scenario, content, TICKS_PER_HOUR);
    const images = run.sim.config.lpars.filter((l) => l.kind === 'ZOS').map((l) => l.id);
    for (const lparId of images) run = issue(run, { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'RMFGAT', lparId }).run;
    const m = buildView(run, scenario).mon3!;
    expect(m.missingSystems?.map((x) => x.system)).toEqual([...images].sort());
    expect(m.rows).toEqual([]);
    expect(m.systems).toEqual([]);
    expect(addPin(run, scenario, { source: 'MON3', system: '*PLEX', scKey: 'ONLHI#1', metric: 'PI' }).ok).toBe(false);
    expect(() => advance(run, scenario, content, 12)).not.toThrow();
  }, 60_000);

  it('charges the Regulator for cancelling the CICS log archiver, and no one for other started tasks', () => {
    const run = live();
    const journal = issue(run, { kind: 'CANCEL_ADDRESS_SPACE', jobname: OPERATION_TRUST.journalJobname, lparId: 'PROD1' });
    expect(journal.ok, journal.message).toBe(true);
    expect(journal.run.trust.Regulator).toBeCloseTo(run.trust.Regulator! - OPERATIONS.journalTrust);
    const agent = issue(run, { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'MONAGENT', lparId: 'PROD1' });
    expect(agent.ok, agent.message).toBe(true);
    expect(agent.run.trust).toEqual(run.trust);
  });

  it('warns only about started tasks the Operations picker can offer', () => {
    const offered = new Set(Object.values(PACKS).flatMap((p) => operationsView({ ...startDay(newRun(p.scenario, { ...p.game, events: [] }, 42), { ...p.game, events: [] }), events: [] }, p.scenario).addressSpaces.map((a) => a.jobname)));
    for (const jobname of Object.keys(CANCEL_WARNINGS)) expect(offered, jobname).toContain(jobname);
  });

  it('charges Finance for terminating a utility, whatever it was', () => {
    const run = live();
    for (const kind of ['REORG', 'COPY', 'RUNSTATS'] as const) {
      const utility = { ...scenario.utilities!.find((u) => u.kind === kind)!, startHour: 6, durationMin: 60, nightFrac: 1 };
      const out = requestOperation(run, { ...scenario, utilities: [utility] }, content, { kind: 'TERM_UTILITY', id: utility.id, member: utility.member, day: 0 });
      expect(out.ok, `${kind}: ${out.message}`).toBe(true);
      expect(out.run.trust.Finance).toBeCloseTo(run.trust.Finance! - OPERATIONS.utilityTrust);
    }
  });

  it("charges a gateway channel's owner for a protection mode, and nothing for clearing it", () => {
    const run = live();
    const channel = gatewayChannels(run.sim, scenario)[0]!;
    const owner = channel.stakeholder;
    const on = issue(run, { kind: 'SET_GATEWAY', workloadId: channel.id, mode: 'LIMIT' });
    expect(on.ok, on.message).toBe(true);
    expect(on.run.trust[owner]).toBeCloseTo(run.trust[owner]! - OPERATIONS.gatewayTrust);
    const off = issue(on.run, { kind: 'SET_GATEWAY', workloadId: channel.id, mode: null });
    expect(off.ok, off.message).toBe(true);
    expect(off.run.trust[owner]).toBeCloseTo(on.run.trust[owner]!);
  });

  it('charges owner trust once per full hour that recalls stay held', () => {
    const run = live();
    const held = { ...run, sim: { ...run.sim, hsmRecalls: { heldSinceTick: 0, backlogIo: 0 } } };
    expect(chargeHeldRecalls(held, TICKS_PER_HOUR - 2)).toBe(held);
    expect(chargeHeldRecalls(held, TICKS_PER_HOUR - 1).trust.Retail).toBeLessThan(run.trust.Retail!);
    expect(chargeHeldRecalls(held, TICKS_PER_HOUR)).toBe(held);
    const released = { ...run, sim: { ...run.sim, hsmRecalls: { heldSinceTick: null, backlogIo: 5 } } };
    expect(chargeHeldRecalls(released, TICKS_PER_HOUR - 1)).toBe(released);
  });
});
