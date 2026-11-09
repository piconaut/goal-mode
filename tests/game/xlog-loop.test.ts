import { PACKS } from '../../src/content/packs';
import { advance, newRun, requestChange, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { applyCommands } from '../../src/sim/core/commands';

const packs = Object.values(PACKS).filter((p) => p.game.events.some((e) => e.id === 'XLOG_LOOP'));

describe('looping log archiver lifecycle', () => {
  it.each(packs)('expires, repeats at full CPU, and cancels cleanly in $id', (pack) => {
    const def = pack.game.events.find((e) => e.id === 'XLOG_LOOP')!;
    const content = { ...pack.game, events: [def] };
    let r = startDay(newRun(pack.scenario, { ...content, events: [] }, 7), content);
    r = {
      ...r,
      events: [0, 6].map((startTick, i) => ({
        uid: `XLOG_LOOP@${i}`, defId: def.id, name: def.name, startTick, endTick: startTick + 3,
        trigger: def.trigger, affects: def.affects, endCommands: def.end, started: false, ended: false,
      })),
    };
    const count = (run: RunState) => run.sim.extraAddressSpaces.filter((a) => a.jobname === 'CICSXLOG').length;
    const cpu = (run: RunState) => {
      const sample = (stop: boolean) => {
        const next = advance({ ...run, events: [], pendingCommands: stop ? def.end : [] }, pack.scenario, content, 1);
        return next.sim.last.lpars.find((l) => l.lparId === 'PROD1')!.scps.find((s) => s.scKey === 'STCHI#1')!.cpEngines;
      };
      return sample(false) - sample(true);
    };
    r = advance(r, pack.scenario, content, 1);
    expect(count(r)).toBe(1);
    const firstCpu = cpu(r);
    expect(firstCpu).toBeGreaterThan(0.6);
    r = advance(r, pack.scenario, content, 3);
    expect(r.events[0]!.ended).toBe(true);
    expect(count(r)).toBe(0);
    expect(cpu(r)).toBe(0);
    r = advance(r, pack.scenario, content, 3);
    expect(count(r)).toBe(1);
    expect(cpu(r)).toBeCloseTo(firstCpu, 2);
    const cancelled = requestChange(r, content, { label: 'Cancel archiver', fixId: def.fix! });
    expect(cancelled.ok).toBe(true);
    r = advance(cancelled.run, pack.scenario, content, 1);
    expect(r.events[1]!.ended).toBe(true);
    expect(count(r)).toBe(0);
    expect(cpu(r)).toBe(0);
    r = advance(r, pack.scenario, content, 5);
    expect(count(r)).toBe(0);
    expect(r.sim.mods.asCpu.CICSXLOG).toBeUndefined();
  });

  it.each(packs)('restarts once at full CPU from an older stopped-job save in $id', (pack) => {
    const def = pack.game.events.find((e) => e.id === 'XLOG_LOOP')!;
    let s = applyCommands(newRun(pack.scenario, { ...pack.game, events: [] }, 7).sim, def.begin);
    s = { ...s, extraAddressSpaces: [...s.extraAddressSpaces, ...s.extraAddressSpaces, ...s.extraAddressSpaces], mods: { ...s.mods, asCpu: { CICSXLOG: 0 } } };
    const restarted = applyCommands(s, def.begin);
    expect(restarted.extraAddressSpaces.filter((a) => a.jobname === 'CICSXLOG')).toHaveLength(1);
    expect(restarted.mods.asCpu.CICSXLOG).toBeUndefined();
    expect(applyCommands(restarted, def.end).extraAddressSpaces).toEqual([]);
    expect(s.extraAddressSpaces).toHaveLength(3);
    expect(s.mods.asCpu.CICSXLOG).toBe(0);
  });
});
