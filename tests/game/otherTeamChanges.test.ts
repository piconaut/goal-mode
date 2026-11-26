import { describe, expect, it } from 'vitest';
import { PACKS } from '../../src/content/packs';
import { BACKOUT_TRUST, ROUTINE_CHANGE_CPU_MULT } from '../../src/content/otherTeamChanges';
import { cardMechanisms } from '../../src/content/footprint';
import { advance, cancelChange, newRun, startDay } from '../../src/game/run';
import { announceOtherTeamChange, otherTeamChangesView, requestBackout } from '../../src/game/run/otherTeamChanges';
import { drawEvents } from '../../src/game/run/events';

const { scenario, game } = PACKS.midwest!;
const profile = game.otherTeamChanges!.find((p) => p.kind === 'REBIND')!;
const fresh = () => ({ ...startDay(newRun(scenario, game, 42), game), events: [], otherTeamChanges: [] });

describe('other teams’ changes', () => {
  it('lands a helpful routine change and removes its CPU benefit and owner trust on backout', () => {
    const base = fresh();
    const control = advance(base, scenario, game, 1);
    const run = advance(announceOtherTeamChange(base, profile, 0, null), scenario, game, 1);
    const cpu = (r: typeof run) => r.sim.last.lpars.reduce((sum, lpar) => {
      const grant = lpar.cpByWorkload?.[profile.benefitTarget];
      return sum + (grant ? grant.cp + grant.ziip + grant.iipcp : 0);
    }, 0);
    expect(cpu(control)).toBeGreaterThan(0);
    expect(cpu(run)).toBeLessThan(cpu(control));
    expect(run.sim.mods.rolloutCpu?.[profile.benefitTarget]).toBeCloseTo(ROUTINE_CHANGE_CPU_MULT);
    const beforeTrust = run.trust[profile.trustFacet]!;
    const beforeHours = run.hoursLeft;
    const id = otherTeamChangesView(run, game).find((c) => c.label === profile.routineLabel)!.id;
    const result = requestBackout(run, game, id);
    expect(result.ok, result.message).toBe(true);
    expect(result.run.sim.mods.rolloutCpu?.[profile.benefitTarget] ?? 1).toBeCloseTo(1);
    expect(result.run.trust[profile.trustFacet]).toBe(beforeTrust - BACKOUT_TRUST);
    expect(result.run.hoursLeft).toBeLessThan(beforeHours);
    expect(otherTeamChangesView(result.run, game).find((c) => c.id === id)!.status).toBe('BACKED_OUT');
    expect(requestBackout(result.run, game, id).ok).toBe(false);
  });

  it('prevents a forewarned change from starting when backed out before landing', () => {
    const def = game.events.find((e) => e.id === profile.eventId)!;
    const run = fresh();
    const startTick = run.sim.tick + 2;
    const event = { uid: `${def.id}@test`, defId: def.id, name: def.name, startTick, endTick: null,
      trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end,
      started: false, ended: false };
    const announced = announceOtherTeamChange({ ...run, events: [...run.events, event] }, profile, startTick, null, event.uid);
    const row = otherTeamChangesView(announced, game).find((c) => c.label === profile.label)!;
    expect(row).toMatchObject({ owner: profile.owner, startTick, status: 'SCHEDULED' });
    const result = requestBackout(announced, game, row.id);
    expect(result.ok, result.message).toBe(true);
    const after = advance(result.run, scenario, game, 3);
    expect(after.events.find((e) => e.uid === event.uid)).toMatchObject({ started: false, ended: true });
    expect(after.sim.mods.cpu[profile.benefitTarget] ?? 1).toBe(1);
    expect(otherTeamChangesView(after, game).find((c) => c.id === row.id)?.status).toBe('BACKED_OUT');
  });

  it('allows a cancelled deployment backout to be requested again', () => {
    const deployment = game.otherTeamChanges!.find((p) => p.kind === 'DEPLOYMENT')!;
    const run = announceOtherTeamChange(newRun(scenario, game, 42), deployment, 20, null);
    const id = otherTeamChangesView(run, game).find((c) => c.label === deployment.routineLabel)!.id;
    const planned = requestBackout(run, game, id);
    expect(planned.ok, planned.message).toBe(true);
    expect(otherTeamChangesView(planned.run, game).find((c) => c.id === id)!.planned).toBe(true);
    expect(requestBackout(planned.run, game, id).ok).toBe(false);
    const change = planned.run.changes.find((c) => c.backoutChangeId === id)!;
    const cancelled = cancelChange(planned.run, change.id);
    expect(cancelled.ok, cancelled.message).toBe(true);
    expect(otherTeamChangesView(cancelled.run, game).find((c) => c.id === id)!.planned).toBe(false);
    const retry = requestBackout(cancelled.run, game, id);
    expect(retry.ok).toBe(true);
    const started = startDay(retry.run, game);
    expect(started.changes.find((c) => c.backoutChangeId === id)?.status).toBe('APPLIED');
    const after = advance(started, scenario, game, 21);
    expect(otherTeamChangesView(after, game).find((c) => c.id === id)?.status).toBe('BACKED_OUT');
    expect(after.sim.mods.rolloutCpu?.[deployment.benefitTarget] ?? 1).toBe(1);
  });

  it('announces card and routine changes with the same notice format in every scenario', () => {
    const expected: Record<string, string[]> = {
      midwest: ['REGRESSION', 'MONITOR_CREEP', 'ZIIP_LOSS', 'QR_RELEASE'],
      harbourline: ['REGRESSION', 'MONITOR_CREEP', 'ZIIP_LOSS'],
      revenue: ['EFILE_REGRESSION', 'MONITOR_CREEP', 'ZIIP_LOSS'],
    };
    for (const [name, ids] of Object.entries(expected)) {
      const pack = PACKS[name]!;
      expect(pack.game.otherTeamChanges!.map((p) => p.eventId).sort()).toEqual(ids.sort());
      for (const p of pack.game.otherTeamChanges!) {
        const def = pack.game.events.find((e) => e.id === p.eventId)!;
        const content = { ...pack.game, events: [{ ...def, minDay: 0 }], otherTeamChanges: [p] };
        // A single-card deck guarantees the routine notice; find a seed that also draws the card.
        const drawn = Array.from({ length: 30 }, (_, seed) => drawEvents({ ...newRun(pack.scenario, content, seed), events: [], otherTeamChanges: [], inbox: [] }, content, 0))
          .find((r) => r.otherTeamChanges?.some((c) => c.eventUid))!;
        const entries = drawn.otherTeamChanges!;
        expect(entries.some((c) => !c.eventUid)).toBe(true);
        expect(entries.some((c) => c.eventUid)).toBe(true);
        const notices = drawn.inbox.filter((m) => m.from === p.owner && m.subject === 'Change board · Day 1');
        expect(notices).toHaveLength(2);
        expect(notices.map((m) => m.body.replace(p.label, 'CHANGE').replace(p.routineLabel, 'CHANGE')))
          .toEqual(notices.map((m) => expect.stringMatching(/^CHANGE is scheduled for \d\d:\d\d\.$/)));
      }
    }
  });
});
