import { newHour } from '../../src/game/run/hourly';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import { requestOperation } from '../../src/game/operations';
import { db2LockHolder } from '../../src/game/smf';
import { requestBackout } from '../../src/game/run/otherTeamChanges';
import { PACKS } from '../../src/content/packs';
import { cardMechanisms } from '../../src/content/footprint';
import { PROJECTS } from '../../src/content/projects';
import { failRiskFor } from '../../src/game/catalog';
import { workOnProject } from '../../src/game/projects';
import { advance, newRun, requestChange, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { applyCommands } from '../../src/sim/core/commands';
import { streamRng } from '../../src/sim/core/rng';
import { releaseNetwork } from '../../src/sim/subsys/batch';

const label = (r: RunState) => Array.from({ length: 1000 }, (_, i) => `operation${i}`).find((s) => !streamRng(r.seed, 'activate', r.day, s, r.changes.filter((c) => c.label === s).length).chance(failRiskFor(r.fatigue, r.perks)))!;

describe('Operations command delivery', () => {
  it.each(['CICS_SOS', 'HSM_RECALL_STORM'])('%s is relieved without ending the card', (id) => {
    const pack = PACKS.midwest!;
    const def = pack.game.events.find((e) => e.id === id)!;
    let r = startDay(newRun(pack.scenario, { ...pack.game, events: [] }, 7), pack.game);
    r = { ...r, sim: applyCommands(r.sim, def.begin), events: [{ uid: `${id}@0`, defId: id, name: def.name,
      startTick: 0, endTick: 100, trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false }] };
    const op = id === 'CICS_SOS'
      ? { kind: 'RECYCLE_CICS' as const, targets: [{ name: 'CICSAOR2', lparId: 'PROD2' }] }
      : { kind: 'HOLD_HSM_RECALL' as const, held: true };
    const out = requestOperation(r, pack.scenario, pack.game, op);
    expect(out.ok, out.message).toBe(true);
    expect(out.run.events[0]!.ended).toBe(false);
    if (op.kind === 'RECYCLE_CICS') expect(out.run.sim.cicsRecycles).toHaveLength(1);
    else expect(out.run.sim.hsmRecalls?.heldSinceTick).toBe(r.sim.tick);
  });

  it('drops only the recycled SOS region from the next hour’s footprint', () => {
    const pack = PACKS.midwest!;
    const def = pack.game.events.find((e) => e.id === 'CICS_SOS')!;
    let r = startDay(newRun(pack.scenario, { ...pack.game, events: [] }, 7), pack.game);
    const leaks = ['CICSAOR2', 'CICSAOR4'].map((name) => ({ kind: 'SET_CICS' as const, name, leak: { startMb: 900, mbPerHour: 40 } }));
    r = { ...r, sim: applyCommands(r.sim, leaks), events: [{ uid: 'sos', defId: def.id, name: def.name,
      startTick: 0, endTick: 2000, trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false }] };
    r = advance(r, pack.scenario, pack.game, 1);
    expect(r.events[0]!.reach).toEqual(expect.arrayContaining(['CICSAOR2@PROD2', 'CICSAOR4@PROD2']));
    const recycled = requestOperation(r, pack.scenario, pack.game, { kind: 'RECYCLE_CICS', targets: [{ name: 'CICSAOR2', lparId: 'PROD2' }] });
    expect(recycled.ok).toBe(true);
    r = advance(recycled.run, pack.scenario, pack.game, 1);
    expect(r.events[0]!.reach).toContain('CICSAOR2@PROD2');
    r = { ...r, sim: { ...r.sim, tick: TICKS_PER_HOUR }, hour: newHour(TICKS_PER_HOUR) };
    r = advance(r, pack.scenario, pack.game, 1);
    expect(r.events[0]!.reach).toEqual(['CICSAOR4@PROD2']);
    expect(r.events[0]!.ended).toBe(false);
  });

  it('suppresses the HSM footprint while held and restores sysplex reach during backlog replay', () => {
    const pack = PACKS.midwest!;
    const def = pack.game.events.find((e) => e.id === 'HSM_RECALL_STORM')!;
    let r = startDay(newRun(pack.scenario, { ...pack.game, events: [] }, 7), pack.game);
    r = { ...r, sim: applyCommands(r.sim, def.begin), events: [{ uid: 'hsm', defId: def.id, name: def.name,
      startTick: 0, endTick: 5, trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false }] };
    const held = requestOperation(r, pack.scenario, pack.game, { kind: 'HOLD_HSM_RECALL', held: true });
    expect(held.ok).toBe(true);
    r = advance(held.run, pack.scenario, pack.game, 6);
    expect(r.events[0]!.ended).toBe(true);
    expect(r.events[0]!.reach).toEqual([]);
    expect(r.sim.hsmRecalls!.backlogIo).toBeGreaterThan(0);
    const released = requestOperation(r, pack.scenario, pack.game, { kind: 'HOLD_HSM_RECALL', held: false });
    expect(released.ok).toBe(true);
    r = advance(released.run, pack.scenario, pack.game, 1);
    expect(r.events[0]!.reach).toEqual(r.sim.config.lpars.map((l) => l.id).sort());
    expect(r.events[0]!.footprintReplay).toBeDefined();
    expect(r.events[0]!.ended).toBe(true);
  });

  it('ends SICK_AOR when the affected region starts its scheduled recycle', () => {
    const pack = PACKS.harbourline!;
    const def = pack.game.events.find((e) => e.id === 'SICK_AOR')!;
    let r = startDay(newRun(pack.scenario, { ...pack.game, events: [] }, 7), pack.game);
    r = { ...r, sim: applyCommands(r.sim, def.begin), events: [{ uid: 'sick', defId: def.id, name: def.name,
      startTick: 0, endTick: 1000, trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false }] };
    const other = r.sim.config.cics.find((c) => c.name !== 'CICSAOR3')!;
    const wrong = requestOperation(r, pack.scenario, pack.game, { kind: 'RECYCLE_CICS', targets: [{ name: other.name, lparId: other.lparId }] });
    expect(wrong.ok).toBe(true);
    expect(wrong.run.events[0]!.ended).toBe(false);
    const right = requestOperation(wrong.run, pack.scenario, pack.game, { kind: 'RECYCLE_CICS', targets: [{ name: 'CICSAOR3', lparId: 'PRDC' }] });
    expect(right.ok).toBe(true);
    expect(right.run.events[0]!.ended).toBe(false);
    const start = right.run.sim.cicsRecycles!.find((c) => c.name === 'CICSAOR3')!.startTick;
    r = advance(right.run, pack.scenario, pack.game, start - right.run.sim.tick);
    expect(r.events[0]!.ended).toBe(false);
    r = advance(r, pack.scenario, pack.game, 1);
    expect(r.events[0]!.ended).toBe(true);
  });

  it('keeps settlement locks through backout and permits a rerun after it', () => {
    const pack = PACKS.midwest!;
    const def = pack.game.events.find((e) => e.id === 'LOCK_ESCALATION')!;
    let r = startDay(newRun(pack.scenario, { ...pack.game, events: [] }, 7), pack.game);
    const batch = releaseNetwork(r.sim.batch, 0, pack.scenario.batchNetwork(r.seed, 0, 1));
    const job = batch.jobs.find((j) => j.def.name.startsWith('STL'))!;
    job.status = 'RUNNING'; job.lparId = 'PROD1'; job.startTick = 5; job.progress = 0.5;
    r = { ...r, sim: { ...applyCommands(r.sim, def.begin), tick: 15, batch }, events: [{ uid: 'lock', defId: def.id, name: def.name,
      startTick: 0, endTick: 100, trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false }] };
    const out = requestOperation(r, pack.scenario, pack.game, { kind: 'CANCEL_JOB', day: job.day, jobname: job.def.name, lparId: 'PROD1' });
    expect(out.ok, out.message).toBe(true);
    expect(out.run.events[0]!.ended).toBe(true);
    const until = out.run.sim.batch.jobs.find((j) => j.def.name === job.def.name)!.lockBackout!.untilTick;
    expect(until).toBeGreaterThan(r.sim.tick);
    expect(db2LockHolder(out.run)?.backoutUntilTick).toBe(until);
    const backoutTick = advance(out.run, pack.scenario, pack.game, 1);
    expect(backoutTick.sim.env.lockIndex).toBeGreaterThan(0);
    const releasedTick = advance({ ...out.run, sim: { ...out.run.sim, tick: until } }, pack.scenario, pack.game, 1);
    expect(releasedTick.sim.env.lockIndex).toBe(0);
    const restart = { kind: 'RESTART_JOB' as const, day: job.day, name: job.def.name };
    expect(applyCommands(out.run.sim, [restart]).batch.jobs.find((j) => j.def.name === job.def.name)!.status).toBe('ABENDED');
    const after = { ...out.run.sim, tick: until };
    expect(applyCommands(after, [restart]).batch.jobs.find((j) => j.def.name === job.def.name)!.status).toBe('QUEUED');
  });

  it('keeps a project completion, job restart and temporary change reversion alongside a planned fix', () => {
    const pack = PACKS.midwest!;
    const def = pack.game.events.find((e) => e.id === 'REGRESSION')!;
    let r = newRun(pack.scenario, { ...pack.game, events: [] }, 7);
    const batch = releaseNetwork(r.sim.batch, 0, pack.scenario.batchNetwork(r.seed, 0, 1));
    const job = batch.jobs[0]!;
    job.status = 'ABENDED';
    job.progress = 0.5;
    r = {
      ...r,
      sim: { ...applyCommands(r.sim, def.begin), tick: 1, batch },
      events: [{ uid: 'regression', defId: def.id, name: def.name, startTick: 0, endTick: null, trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false }],
      projects: [{ id: 'SQL_TUNING', hoursDone: PROJECTS.find((p) => p.id === 'SQL_TUNING')!.hours - 2, hoursToday: 0, day: 0, done: false }],
    };
    const project = workOnProject(r, 'SQL_TUNING', 2);
    expect(project.ok).toBe(true);
    r = project.run;
    const backout = requestBackout(r, pack.game, 'OT-legacy-1');
    expect(backout.ok).toBe(true);
    r = backout.run;
    r = requestChange(r, pack.game, { label: label(r), commands: [{ kind: 'RESTART_JOB', day: job.day, name: job.def.name }] }).run;
    r = { ...r, changes: [...r.changes, { ...r.changes[0]!, id: 100, status: 'APPLIED', revertDay: r.day, revertCommands: [{ kind: 'SET_WEIGHT', lparId: 'DEVT', pool: 'CP', weight: 65 }] }] };
    const live = startDay(r, pack.game);
    expect(live.pendingCommands).toEqual([...project.run.pendingCommands, ...r.changes[0]!.commands, ...r.changes[1]!.revertCommands]);
    const next = advance(live, pack.scenario, pack.game, 1);
    expect(next.sim.mods.cpu.RBANK).toBeUndefined();
    expect(next.sim.mods.efficiency?.RBANK).toBeLessThan(1);
    expect(next.sim.batch.jobs[0]!.status).not.toBe('ABENDED');
    expect(next.sim.batch.jobs[0]!.progress).toBeGreaterThanOrEqual(0.25);
    expect(next.sim.batch.jobs[0]!.progress).toBeLessThan(0.5);
    expect(next.sim.config.lpars.find((l) => l.id === 'DEVT')!.pools.find((p) => p.pool === 'CP')!.weight).toBe(65);
  });
});
