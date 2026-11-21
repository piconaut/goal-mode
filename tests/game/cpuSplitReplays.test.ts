import { cardMechanisms } from '../../src/content/footprint';
import { packOf } from '../../src/content/packs';
import { advance, chooseDraft, newRun, startDay } from '../../src/game/run';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import { cachedRunState } from '../helpers/fixtureCache';

/** No player actions/cards. Suppress random draws without removing the definition of the injected audit card. */
function replay(id: string, seed: number, through: number, card?: string) {
  return cachedRunState(`rt32-${id}-${seed}-${through}-${card ?? 'quiet'}`, () => {
    const pack = packOf(id);
    const game = { ...pack.game, events: pack.game.events.map((e) => ({ ...e, minDay: 999 })) };
    let r = newRun(pack.scenario, game, seed);
    for (let day = 0; day <= through; day++) {
      r = startDay(r, game);
      if (card && day === through) {
        const d = game.events.find((e) => e.id === card)!;
        const startTick = day * TICKS_PER_DAY + 6 * TICKS_PER_HOUR;
        r = { ...r, events: [...r.events, {
          uid: `${d.id}@${day}`, defId: d.id, name: d.name, startTick, endTick: startTick + 6 * TICKS_PER_HOUR,
          trigger: d.trigger, affects: d.affects, mechanisms: cardMechanisms(d) ?? [], endCommands: d.end, started: false, ended: false,
        }] };
      }
      r = advance(r, pack.scenario, game, TICKS_PER_DAY);
      if (day < through) {
        expect(r.phase).toBe('REVIEW');
        r = chooseDraft(r, game, null);
      }
    }
    return r;
  });
}

describe('RT-32 audit replays', () => {
  it('R-13: Revenue seed 42 days 0–9, no cards: the 21:00 G1 misses are policy, not capacity', () => {
    const r = replay('revenue', 42, 9);
    const incidents = r.incidents.filter((i) => i.workloadId === 'EFILE' && [0, 5, 8].includes(i.day));
    expect(incidents.map((i) => [i.day, i.startTick / TICKS_PER_HOUR - i.day * 24 + 6, i.truth.mechanism, i.truth.trigger]))
      .toEqual([0, 5, 8].map((d) => [d, 21, 'CPU_PRIORITY', 'POLICY']));
    for (const inc of incidents) {
      expect(inc.basis!.displaceablePct).toBeGreaterThan(10);
      expect(inc.basis!.topConsumers!.some((c) => c.name.startsWith('BATCH'))).toBe(true);
    }
  }, 600_000);

  it('R-2: Midwest seed 42 day 12 RETRY_STORM at noon: judge MOBILE on PROD2', () => {
    const r = replay('midwest', 42, 12, 'RETRY_STORM');
    const inc = r.incidents.find((i) => i.day === 12 && i.workloadId === 'MOBILE')!;
    expect(inc).toBeDefined();
    expect(inc.basis?.lparId).toBe('PROD2');
    // The design's predicted capacity primary does not survive its own happy-SLA rule: the same-class ad-hoc query
    // and healthy CICS regions are displaceable in full, even though they are as or more important. Db2 is excluded;
    // the remaining share is still > 10 %.
    expect(inc.truth.mechanism).toBe('CPU_PRIORITY');
    expect(inc.truth.accepted.mechanisms).toContain('CPU_PRIORITY');
    expect(inc.truth.trigger).toBe('DEMAND_SURGE');
  }, 600_000);
});
