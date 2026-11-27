import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { cardMechanisms } from '../../src/content/footprint';
import { MIDWEST } from '../../src/content/scenarios';
import { failRiskFor } from '../../src/game/catalog';
import { migrateRunState } from '../../src/game/run/migrate';
import { advance, newRun, requestChange, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { applyCommands } from '../../src/sim/core/commands';
import { streamRng } from '../../src/sim/core/rng';

const fresh = () => newRun(MIDWEST, { ...MIDWEST_GAME, events: [] }, 7);
const card = (r: RunState, id: string, started: boolean) => {
  const def = MIDWEST_GAME.events.find((e) => e.id === id)!;
  return { ...r, events: [{ uid: `${id}@0`, defId: id, name: def.name, startTick: started ? 0 : 10, endTick: 100,
    trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started, ended: false }] };
};
const planned = (r: RunState, fixId: string) => {
  const label = Array.from({ length: 1000 }, (_, i) => `legacy${i}`).find((s) => !streamRng(r.seed, 'activate', r.day, s, 0).chance(failRiskFor(r.fatigue, r.perks)))!;
  const out = requestChange(r, MIDWEST_GAME, { label, commands: [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }] });
  expect(out.ok).toBe(true);
  return { ...out.run, changes: out.run.changes.map((c) => ({ ...c, commands: [], endsEvent: fixId })) };
};

describe('legacy card save migration', () => {
  it('backs out an armed scheduled rollout without a second trust charge', () => {
    const r = card(fresh(), 'REGRESSION', false);
    const withChange = planned(r, 'REBIND_REVERT');
    const old = { ...withChange, changes: withChange.changes.map((c) => ({ ...c, status: 'APPLIED' as const, armedEvents: [r.events[0]!.uid] })) };
    const migrated = migrateRunState(old);
    expect(migrated.events[0]!.ended).toBe(true);
    expect(migrated.otherTeamChanges?.[0]).toMatchObject({ eventUid: r.events[0]!.uid, status: 'BACKED_OUT' });
    expect(migrated.trust).toEqual(old.trust);
    expect(migrateRunState(migrated)).toEqual(migrated);
  });

  it('translates a planned fix into an operation at day start', () => {
    const r = card(fresh(), 'XLOG_LOOP', true);
    const def = MIDWEST_GAME.events.find((e) => e.id === 'XLOG_LOOP')!;
    const old = planned({ ...r, sim: applyCommands(r.sim, def.begin) }, 'CANCEL_XLOG');
    const migrated = migrateRunState(old);
    expect(migrated.changes[0]!.migratedEventId).toBe('XLOG_LOOP');
    const live = startDay(migrated, MIDWEST_GAME);
    expect(live.changes[0]!.status).toBe('APPLIED');
    expect(live.events[0]!.ended).toBe(true);
    expect(live.sim.cancelledAddressSpaces?.some((a) => a.jobname === 'CICSXLOG' && a.lparId === 'PROD1')).toBe(true);
  });

  it('converts a legacy rate-proportional entity load to the engines the save measured (RF-11)', () => {
    const content = { ...MIDWEST_GAME, events: [] };
    const r = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 1);
    const grant = r.sim.last.lpars.find((l) => l.lparId === 'DEVT')?.cpByWorkload?.TSO;
    expect(grant).toBeDefined();
    const legacy = { tag: 'SHADOW_IT@0', kind: 'TSO_USER', id: 'DEV001', workloadId: 'TSO', lparId: 'DEVT', extraCpuFrac: 2 };
    const old = { ...r, sim: { ...r.sim, entityLoads: [legacy] } } as unknown as RunState;
    const migrated = migrateRunState(old);
    expect(migrated.sim.entityLoads).toEqual([{
      tag: 'SHADOW_IT@0', kind: 'TSO_USER', id: 'DEV001', workloadId: 'TSO', lparId: 'DEVT',
      cpEngines: 2 * (grant!.cp + grant!.iipcp), ziipEngines: 2 * grant!.ziip,
    }]);
    // Loading again changes nothing.
    expect(migrateRunState(migrated)).toEqual(migrated);
  });

  it("restores a live gateway card's source split into a save written before it lived in sim state", () => {
    const r = card(fresh(), 'BOT_ATTACK', true);
    const def = MIDWEST_GAME.events.find((e) => e.id === 'BOT_ATTACK')!;
    // The old save has the card's rate/CPU modifiers but no `mods.gatewaySources`.
    const old = { ...r, sim: applyCommands(r.sim, def.begin.filter((c) => c.kind !== 'SET_GATEWAY_SOURCE')) };
    expect(old.sim.mods.gatewaySources).toBeUndefined();
    const migrated = migrateRunState(old);
    expect(migrated.sim.mods.gatewaySources?.MOBILE?.attackRateMult).toBe(4);
    // A second load finds the values already there and changes nothing (no command-log growth either).
    expect(migrateRunState(migrated)).toEqual(migrated);
  });

  it('does not replay an already applied historical change', () => {
    const r = card(fresh(), 'XLOG_LOOP', true);
    const old = planned(r, 'CANCEL_XLOG');
    const historical = { ...old, changes: old.changes.map((c) => ({ ...c, status: 'APPLIED' as const })) };
    const migrated = migrateRunState(historical);
    expect(migrated.changes[0]!.migratedEventId).toBeUndefined();
    expect(migrated.events[0]!.ended).toBe(false);
    expect(migrated.sim.cancelledAddressSpaces).toEqual(historical.sim.cancelledAddressSpaces);
    expect(startDay(migrated, MIDWEST_GAME).events[0]!.ended).toBe(false);
  });
});
