import { migrateRunState } from '../../src/game/run/migrate';
import { requestOperation } from '../../src/game/operations';
import { PACKS } from '../../src/content/packs';
import { cardMechanisms } from '../../src/content/footprint';
import { STC_AUTOMATION } from '../../src/content/entities';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { TICK_SEC } from '../../src/sim/core/units';

const packs = Object.values(PACKS).filter((p) => p.game.events.some((e) => e.id === 'XLOG_LOOP'));
const restartTicks = Math.ceil((STC_AUTOMATION.restartMin * 60) / TICK_SEC);

// PT-52: CICSXLOG is a permanent STC; the card makes it loop, and its end (or the fix) cancels it until automation
// restarts it healthy.
describe('looping log archiver lifecycle', () => {
  it.each(packs)('loops, is cancelled at the end, restarts healthy, and loops again at full CPU in $id', (pack) => {
    const def = pack.game.events.find((e) => e.id === 'XLOG_LOOP')!;
    const content = { ...pack.game, events: [def] };
    let r = startDay(newRun(pack.scenario, { ...content, events: [] }, 7), content);
    const second = 4 + restartTicks + 2;
    r = {
      ...r,
      events: [0, second].map((startTick, i) => ({
        uid: `XLOG_LOOP@${i}`, defId: def.id, name: def.name, startTick, endTick: startTick + 3,
        trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: false, ended: false,
      })),
    };
    const down = (run: RunState) => (run.sim.cancelledAddressSpaces ?? []).some((a) => a.jobname === 'CICSXLOG');
    const stchi = (run: RunState) => run.sim.last.lpars.find((l) => l.lparId === 'PROD1')!.scps.find((s) => s.scKey === 'STCHI#1')!.cpEngines;
    // The loop's CPU: STCHI with the loop against the same tick with its multiplier reset.
    const loopCpu = (run: RunState) => {
      const sample = (reset: boolean) => stchi(advance({ ...run, events: [], pendingCommands: reset ? [{ kind: 'SET_MODIFIER', mod: 'asCpu', key: 'CICSXLOG', value: 1 }] : [] }, pack.scenario, content, 1));
      return sample(false) - sample(true);
    };
    expect(r.sim.extraAddressSpaces.some((a) => a.jobname === 'CICSXLOG')).toBe(false);
    r = advance(r, pack.scenario, content, 1);
    const firstCpu = loopCpu(r);
    expect(firstCpu).toBeGreaterThan(0.6);
    r = advance(r, pack.scenario, content, 3);
    expect(r.events[0]!.ended).toBe(true);
    expect(r.sim.mods.asCpu.CICSXLOG).toBeUndefined();
    expect(down(r)).toBe(true);
    r = advance(r, pack.scenario, content, second - r.sim.tick + r.events[0]!.startTick);
    expect(down(r)).toBe(false);
    r = advance(r, pack.scenario, content, 1);
    expect(r.events[1]!.started).toBe(true);
    expect(loopCpu(r)).toBeCloseTo(firstCpu, 2);
    const cancelled = requestOperation(r, pack.scenario, content, { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'CICSXLOG', lparId: 'PROD1' });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.run.events[1]!.ended).toBe(true);
    r = advance(cancelled.run, pack.scenario, content, 1);
    expect(down(r)).toBe(true);
    expect(r.sim.mods.asCpu.CICSXLOG).toBeUndefined();
    r = advance(r, pack.scenario, content, restartTicks + 1);
    expect(down(r)).toBe(false);
    expect(r.sim.extraAddressSpaces.some((a) => a.jobname === 'CICSXLOG')).toBe(false);
  });

  it.each(packs)('drops a stale extra copy from an older save before looping in $id', (pack) => {
    const run = newRun(pack.scenario, { ...pack.game, events: [] }, 7);
    const stale = { jobname: 'CICSXLOG', lparId: 'PROD1', role: null, subsystem: 'STC' as const, baseEnginesRef: 0.9, ziipFrac: 0 };
    const migrated = migrateRunState({ ...run, sim: { ...run.sim, extraAddressSpaces: [stale, stale] } });
    expect(migrated.sim.extraAddressSpaces).toEqual([]);
    expect(pack.scenario.addressSpaces.filter((a) => a.jobname === 'CICSXLOG' && a.lparId === 'PROD1')).toHaveLength(1);
  });
});
