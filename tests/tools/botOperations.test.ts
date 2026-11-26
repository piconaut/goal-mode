import { describe, expect, it } from 'vitest';
import { PACKS } from '../../src/content/packs';
import { cardMechanisms } from '../../src/content/footprint';
import { resolveCulprits } from '../../src/game/culprits';
import { advance, newRun, startDay } from '../../src/game/run';
import { announceOtherTeamChange } from '../../src/game/run/otherTeamChanges';
import type { ActiveEvent, RunState } from '../../src/game/types';
import { applyCommands } from '../../src/sim/core/commands';
import { effectiveWorkloads } from '../../src/sim/core/tick/helpers';
import { clockAt } from '../../src/sim/core/clock';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import { releaseNetwork } from '../../src/sim/subsys/batch';
import { operationsForEventReports, protectionReleases } from '../../tools/botOperations';

const midwest = PACKS.midwest!;
const noEvents = { ...midwest.game, events: [] };
const live = (): RunState => ({ ...startDay(newRun(midwest.scenario, noEvents, 42), noEvents), events: [] });
const eventFor = (def: (typeof midwest.game.events)[number], startTick = 0): ActiveEvent => ({
  uid: `${def.id}@test`, defId: def.id, name: def.name, startTick, endTick: null,
  trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end,
  started: true, ended: false,
});
const contentWith = (def: (typeof midwest.game.events)[number]) => ({ ...midwest.game, events: [def] });
const withGatewayReports = (run: RunState, baselines: Record<string, number>, currents: Record<string, number>): RunState => {
  const closed = run.smfHours.at(-1);
  const hourOfDay = closed?.hourOfDay ?? clockAt(run.sim.tick - TICKS_PER_HOUR).hourOfDay;
  const day = closed?.day ?? run.day;
  const workload = (rate: number): RunState['smfHours'][number]['workloads'][string] => ({
    completions: rate * 3600, withinSla: 0, failed: 0, rtSumSec: 0, parts: {}, offeredSec: rate * 3600,
  });
  const ids = [...new Set([...Object.keys(baselines), ...Object.keys(currents)])].sort();
  const rows = (rates: Record<string, number>, atDay: number): RunState['smfHours'][number] => ({
    day: atDay, hourOfDay, workloads: Object.fromEntries(ids.filter((id) => rates[id] !== undefined).map((id) => [id, workload(rates[id]!)])),
  });
  return { ...run, day: day + 1, smfHours: [rows(baselines, day - 1), rows(currents, day)] };
};
const withMobileReports = (run: RunState, baseline: number, current: number) =>
  withGatewayReports(run, { MOBILE: baseline }, { MOBILE: current });

describe('report-driven bot operation targets', () => {
  it.each(['RUNAWAY', 'SHADOW_IT'] as const)('picks %s culprits from the displayed roster CPU, not resolved culprits', (id) => {
    const def = midwest.game.events.find((row) => row.id === id)!;
    let run = live();
    const resolved = resolveCulprits(run.sim, effectiveWorkloads(midwest.scenario, run.sim), def.culprits!, `${id}@test`, 1);
    run = { ...run, sim: applyCommands(run.sim, resolved.commands) };
    run = advance(run, midwest.scenario, noEvents, 1);
    const ops = operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def));
    const picked = ops.map((op) => op.kind === 'CANCEL_SESSION' ? op.target.id : '').sort();
    expect(picked).toEqual([...resolved.ids].sort());
  });

  it('leaves a roster card unresolved when the report does not single out a culprit', () => {
    const def = midwest.game.events.find((row) => row.id === 'RUNAWAY')!;
    const run = advance(live(), midwest.scenario, noEvents, 1);
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def))).toEqual([]);
  });

  it('cancels the started task PROCU identifies as the clear top consumer', () => {
    const def = midwest.game.events.find((row) => row.id === 'XLOG_LOOP')!;
    let run = { ...live(), sim: applyCommands(live().sim, def.begin) };
    run = advance(run, midwest.scenario, noEvents, TICKS_PER_HOUR);
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def))).toEqual([
      { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'CICSXLOG', lparId: 'PROD1' },
    ]);
  });

  it('does not cancel a normal started task when no address space is elevated', () => {
    const def = midwest.game.events.find((row) => row.id === 'XLOG_LOOP')!;
    const run = advance(live(), midwest.scenario, noEvents, TICKS_PER_HOUR);
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def))).toEqual([]);
  });

  it('does not cancel another class after the looping archiver is down', () => {
    const def = midwest.game.events.find((row) => row.id === 'XLOG_LOOP')!;
    const base = live();
    const sim = applyCommands(base.sim, [
      { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'CICSXLOG', lparId: 'PROD1' },
      { kind: 'SET_MODIFIER', mod: 'asCpu', key: 'MONAGENT', value: 100 },
    ], midwest.scenario.addressSpaces);
    const run = advance({ ...base, sim }, midwest.scenario, noEvents, TICKS_PER_HOUR);
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def))).toEqual([]);
  });

  it('terminates the utility whose displayed status is past its scheduled end', () => {
    const def = midwest.game.events.find((row) => row.id === 'REORG_OVERRUN')!;
    const run = { ...live(), sim: applyCommands(live().sim, def.begin) };
    const ops = operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'TERM_UTILITY' });
  });

  it('leaves two overrunning utilities ambiguous', () => {
    const def = midwest.game.events.find((row) => row.id === 'REORG_OVERRUN')!;
    const reorg = midwest.scenario.utilities!.find((row) => row.kind === 'REORG')!;
    const site = { ...midwest.scenario, utilities: [
      { ...reorg, id: 'REORG_A', startHour: 0, durationMin: 1, nightFrac: 1 },
      { ...reorg, id: 'REORG_B', startHour: 0, durationMin: 1, nightFrac: 1 },
    ] };
    const run = { ...live(), sim: applyCommands(live().sim, def.begin) };
    expect(operationsForEventReports(run, site, contentWith(def), eventFor(def))).toEqual([]);
  });

  it('cancels the running job named by the Db2 lock-holder report', () => {
    const def = midwest.game.events.find((row) => row.id === 'LOCK_ESCALATION')!;
    const base = live();
    const batch = releaseNetwork(base.sim.batch, 0, midwest.scenario.batchNetwork(base.seed, 0, 1));
    const job = batch.jobs.find((row) => row.def.name.startsWith('STL'))!;
    Object.assign(job, { status: 'RUNNING', lparId: 'PROD1', startTick: 5, progress: 0.5 });
    const run = { ...base, sim: { ...applyCommands(base.sim, def.begin), tick: 15, batch } };
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def))).toEqual([
      { kind: 'CANCEL_JOB', day: job.day, jobname: job.def.name, lparId: 'PROD1' },
    ]);
  });

  it('does not recancel a lock holder that is already backing out', () => {
    const def = midwest.game.events.find((row) => row.id === 'LOCK_ESCALATION')!;
    const base = live();
    const batch = releaseNetwork(base.sim.batch, 0, midwest.scenario.batchNetwork(base.seed, 0, 1));
    const job = batch.jobs.find((row) => row.def.name.startsWith('STL'))!;
    Object.assign(job, { status: 'RUNNING', lparId: 'PROD1', startTick: 5, lockBackout: { untilTick: 100, lockIndex: 6, object: 'SETTLE.POSTINGS' } });
    const run = { ...base, sim: { ...applyCommands(base.sim, def.begin), tick: 15, batch } };
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def))).toEqual([]);
  });

  it('recycles the regions whose displayed EDSA headroom is below the SOS cushion', () => {
    const def = midwest.game.events.find((row) => row.id === 'CICS_SOS')!;
    const leaks = ['CICSAOR2', 'CICSAOR4'].map((name) => ({ kind: 'SET_CICS' as const, name, leak: { startMb: 900, mbPerHour: 40 } }));
    const run = advance({ ...live(), sim: applyCommands(live().sim, leaks) }, midwest.scenario, noEvents, 1);
    const ops = operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def));
    expect(ops).toEqual([{ kind: 'RECYCLE_CICS', targets: [
      { name: 'CICSAOR2', lparId: 'PROD2' }, { name: 'CICSAOR4', lparId: 'PROD2' },
    ] }]);
  });

  it('recycles the region singled out by per-region CICS abends', () => {
    const pack = PACKS.harbourline!;
    const content = { ...pack.game, events: [] };
    const def = pack.game.events.find((row) => row.id === 'SICK_AOR')!;
    const base = startDay(newRun(pack.scenario, content, 42), content);
    const run = advance({ ...base, sim: applyCommands(base.sim, def.begin) }, pack.scenario, content, TICKS_PER_HOUR);
    expect(operationsForEventReports(run, pack.scenario, { ...pack.game, events: [def] }, eventFor(def))).toEqual([
      { kind: 'RECYCLE_CICS', targets: [{ name: 'CICSAOR3', lparId: 'PRDC' }] },
    ]);
  });

  it('uses the Change board label and time rather than a rollout’s hidden event link', () => {
    const def = midwest.game.events.find((row) => row.id === 'REGRESSION')!;
    const profile = midwest.game.otherTeamChanges!.find((row) => row.eventId === def.id)!;
    const event = eventFor(def, 20);
    let run = announceOtherTeamChange(live(), profile, event.startTick, null);
    run = announceOtherTeamChange(run, profile, event.startTick + 100, null, event.uid);
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), event)).toEqual([
      { kind: 'BACKOUT_CHANGE', changeId: 'OT1' },
    ]);
  });

  it('leaves two Change-board rollouts in the same visible minute ambiguous', () => {
    const def = midwest.game.events.find((row) => row.id === 'REGRESSION')!;
    const profile = midwest.game.otherTeamChanges!.find((row) => row.eventId === def.id)!;
    const event = eventFor(def, 20);
    let run = announceOtherTeamChange(live(), profile, 20, null, event.uid);
    run = announceOtherTeamChange(run, profile, 21, null);
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), event)).toEqual([]);
  });

  it('chooses the gateway channel with the reported offered-traffic surge', () => {
    const original = midwest.game.events.find((row) => row.id === 'BOT_ATTACK')!;
    const def = { ...original, endedBy: { kind: 'SET_GATEWAY' as const, workloadId: 'RBANK', mode: 'BLOCK' as const } };
    const base = advance(live(), midwest.scenario, noEvents, 12 * TICKS_PER_HOUR);
    const baseline = base.sim.last.workloads.find((row) => row.id === 'MOBILE')!.arrivalRate;
    let run = { ...base, sim: applyCommands(base.sim, [
      { kind: 'SET_MODIFIER', mod: 'rate', key: 'MOBILE', value: 6 },
    ]) };
    run = advance(run, midwest.scenario, noEvents, TICKS_PER_HOUR);
    const current = run.smfHours.at(-1)!.workloads.MOBILE!.offeredSec! / 3600;
    expect(operationsForEventReports(withMobileReports(run, baseline, current), midwest.scenario, contentWith(def), eventFor(def))).toEqual([
      { kind: 'SET_GATEWAY', workloadId: 'MOBILE', mode: 'BLOCK' },
    ]);
  });

  it('leaves near-tied gateway surges unresolved', () => {
    const def = midwest.game.events.find((row) => row.id === 'BOT_ATTACK')!;
    const run = withGatewayReports(live(), { MOBILE: 100, CARDAUTH: 100 }, { MOBILE: 160, CARDAUTH: 159 });
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def))).toEqual([]);
  });

  it('does not invent a surge from a flat closed-hour report', () => {
    const def = midwest.game.events.find((row) => row.id === 'BOT_ATTACK')!;
    const run = withGatewayReports(live(), { MOBILE: 100 }, { MOBILE: 100 });
    expect(operationsForEventReports(run, midwest.scenario, contentWith(def), eventFor(def))).toEqual([]);
  });
});

describe('report-driven protection release', () => {
  it('keeps protection while underlying pressure is masked, then clears it when the reports recover', () => {
    const base = advance(live(), midwest.scenario, noEvents, 12 * TICKS_PER_HOUR);
    const baseline = base.sim.last.workloads.find((row) => row.id === 'MOBILE')!.arrivalRate;
    const surged = { ...base, sim: applyCommands(base.sim, [
      { kind: 'SET_MODIFIER', mod: 'rate', key: 'MOBILE', value: 6 },
      { kind: 'SET_LCU', lcuId: '30', extraIops: { RANDOM: 60_000 } },
    ]) };
    const guarded = { ...surged, sim: {
      ...surged.sim,
      gatewayModes: { MOBILE: 'BLOCK' as const },
      hsmRecalls: { heldSinceTick: 0, backlogIo: 10 },
    } };
    const during = advance(guarded, midwest.scenario, noEvents, TICKS_PER_HOUR);
    const duringRate = during.smfHours.at(-1)!.workloads.MOBILE!.offeredSec! / 3600;
    expect(protectionReleases(withMobileReports(during, baseline, duringRate), midwest.scenario)).toEqual([]);
    const recovered = advance({ ...during, sim: applyCommands(during.sim, [
      { kind: 'SET_MODIFIER', mod: 'rate', key: 'MOBILE', value: 1 },
      { kind: 'SET_LCU', lcuId: '30', extraIops: {} },
    ]) }, midwest.scenario, noEvents, TICKS_PER_HOUR);
    expect(protectionReleases(withMobileReports(recovered, baseline, baseline), midwest.scenario)).toEqual([
      { kind: 'HOLD_HSM_RECALL', held: false },
      { kind: 'SET_GATEWAY', workloadId: 'MOBILE', mode: null },
    ]);
  });
});
