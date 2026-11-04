import { PACKS } from '../../src/content/packs';
import { PROJECTS } from '../../src/content/projects';
import { failRiskFor } from '../../src/game/catalog';
import { workOnProject } from '../../src/game/projects';
import { advance, newRun, requestChange, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { applyCommands } from '../../src/sim/core/commands';
import { streamRng } from '../../src/sim/core/rng';
import { releaseNetwork } from '../../src/sim/subsys/batch';

const cards = Object.values(PACKS).flatMap((pack) => pack.game.events.filter((def) => def.fix).map((def) => ({ name: `${pack.id}/${def.id}`, pack, def })));
const label = (r: RunState) => Array.from({ length: 1000 }, (_, i) => `operation${i}`).find((s) => !streamRng(r.seed, 'activate', r.day, s, r.changes.filter((c) => c.label === s).length).chance(failRiskFor(r.fatigue, r.perks)))!;

describe('Operations command delivery', () => {
  it.each(cards)('planned and live fixes restore $name', ({ pack, def }) => {
    for (const phase of ['BRIEFING', 'LIVE'] as const) {
      let r = newRun(pack.scenario, { ...pack.game, events: [] }, 7);
      r = {
        ...r, phase,
        sim: applyCommands(r.sim, def.begin),
        events: [{ uid: `${def.id}@0`, defId: def.id, name: def.name, startTick: 0, endTick: null, trigger: def.trigger, affects: def.affects, endCommands: def.end, started: true, ended: false }],
      };
      const expected = applyCommands(r.sim, def.end);
      const out = requestChange(r, pack.game, { label: label(r), fixId: def.fix! });
      expect(out.ok, out.message).toBe(true);
      r = startDay(out.run, pack.game);
      expect(r.changes.at(-1)!.status).toBe('APPLIED');
      expect(r.events[0]!.ended).toBe(true);
      r = advance(r, pack.scenario, pack.game, 1);
      expect(r.sim.mods).toEqual(expected.mods);
      expect(r.sim.config).toEqual(expected.config);
      expect(r.sim.cost.priceMult).toBe(expected.cost.priceMult);
    }
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
      events: [{ uid: 'regression', defId: def.id, name: def.name, startTick: 0, endTick: null, trigger: def.trigger, affects: def.affects, endCommands: def.end, started: true, ended: false }],
      projects: [{ id: 'SQL_TUNING', hoursDone: PROJECTS.find((p) => p.id === 'SQL_TUNING')!.hours - 2, hoursToday: 0, day: 0, done: false }],
    };
    const project = workOnProject(r, 'SQL_TUNING', 2);
    expect(project.ok).toBe(true);
    r = project.run;
    r = requestChange(r, pack.game, { label: label(r), fixId: def.fix! }).run;
    r = requestChange(r, pack.game, { label: label(r), commands: [{ kind: 'RESTART_JOB', day: job.day, name: job.def.name }] }).run;
    r = { ...r, changes: [...r.changes, { ...r.changes[0]!, id: 100, endsEvent: null, status: 'APPLIED', revertDay: r.day, revertCommands: [{ kind: 'SET_WEIGHT', lparId: 'DEVT', pool: 'CP', weight: 65 }] }] };
    const live = startDay(r, pack.game);
    expect(live.pendingCommands).toEqual([...project.run.pendingCommands, ...def.end, ...r.changes[1]!.commands, ...r.changes[2]!.revertCommands]);
    const next = advance(live, pack.scenario, pack.game, 1);
    expect(next.sim.mods.cpu.RBANK).toBeUndefined();
    expect(next.sim.mods.efficiency?.RBANK).toBeLessThan(1);
    expect(next.sim.batch.jobs[0]!.status).not.toBe('ABENDED');
    expect(next.sim.batch.jobs[0]!.progress).toBeGreaterThanOrEqual(0.25);
    expect(next.sim.batch.jobs[0]!.progress).toBeLessThan(0.5);
    expect(next.sim.config.lpars.find((l) => l.id === 'DEVT')!.pools.find((p) => p.pool === 'CP')!.weight).toBe(65);
  });
});
