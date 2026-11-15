// RT-15: incidents group by their cause (`truth.cause`), not by equal labels (docs/rca-design.md §4.5, A13).
// A card's victims are one group across the played day; a fallback cause's incidents only while they overlap or follow
// within two hours. A filed RCA is inherited from the same card only — a later fallback-caused incident is listed as new.
import { cardMechanisms } from '../../src/content/footprint';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { advance, newRun, startDay } from '../../src/game/run';
import { GROUP_FOLLOW_HOURS, groupLead, sameCause } from '../../src/game/run/grouping';
import { closeHour, newHour } from '../../src/game/run/hourly';
import type { Incident, IncidentTruth } from '../../src/game/types';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const at = (hours: number) => hours * TICKS_PER_HOUR;
const filed = { mechanism: 'CPU_PRIORITY' as const, trigger: 'POLICY' as const, points: 5 };

/** An incident of the played day, with the clock given in hours. */
function inc(id: number, workloadId: string, truth: IncidentTruth, over: Partial<Incident> = {}): Incident {
  return {
    id, workloadId, day: 0, startTick: at(9), endTick: at(10), hours: 1, worstAttainmentPct: 80,
    truth, rca: null, trustLost: 1, ...over,
  };
}

const POWER_CAP_CAUSE = 'POWER_CAP@12';
const CREEP_CAUSE = 'MONITOR_CREEP@6';
const CAMPAIGN_CAUSE = 'CAMPAIGN@13';

describe('grouping incidents by cause (RT-15)', () => {
  it("R-7: a card's two mechanisms are one group, and its filed RCA covers the second victim", () => {
    // One power cap: MOBILE is a CPU-priority victim, CARDAUTH a dependency one. The old rule split them because
    // their labels differ; the cause is the same card.
    const mobile = inc(1, 'MOBILE', { mechanism: 'CPU_PRIORITY', trigger: 'HARDWARE_FAULT', cause: POWER_CAP_CAUSE });
    const cardauth = inc(2, 'CARDAUTH', { mechanism: 'DEPENDENCY', trigger: 'HARDWARE_FAULT', cause: POWER_CAP_CAUSE });
    expect(sameCause(mobile, cardauth)).toBe(true);
    expect(groupLead([mobile], cardauth)).toBe(mobile);
    // A card is the same event however late its victims fall, so a filed RCA is inherited (A13's silent-inheritance
    // harm was across different causes).
    const scored = { ...mobile, rca: filed };
    expect(groupLead([scored], cardauth)).toBe(scored);
  });

  it("R-9: a 13:00 campaign incident does not join — and cannot inherit — the creep's 10:00 RCA", () => {
    const creep = { ...inc(1, 'MOBILE', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY', cause: CREEP_CAUSE }), rca: filed };
    const campaign = inc(2, 'RBANK', { mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE', cause: CAMPAIGN_CAUSE }, { startTick: at(13), endTick: at(14) });
    expect(sameCause(creep, campaign)).toBe(false);
    expect(groupLead([creep], campaign)).toBeNull();
    // The hours alone would have joined them: the same cause is what matters.
    expect(sameCause(creep, { ...campaign, truth: { ...campaign.truth, cause: CREEP_CAUSE } })).toBe(true);
  });

  it('a fallback cause joins while it is the same episode, and is listed as new once its RCA is filed', () => {
    const none: IncidentTruth = { mechanism: 'CPU_PRIORITY', trigger: 'POLICY', cause: 'none:CPU:PROD1' };
    const morning = inc(1, 'MOBILE', none);
    const later = inc(2, 'RBANK', none, { startTick: at(11), endTick: at(12) });
    expect(sameCause(morning, later)).toBe(true);
    // Unfiled: one episode, so the group takes a second victim before the player writes it up.
    expect(groupLead([morning], later)).toBe(morning);
    // Filed: a post-RT-15 fallback group is the same episode only until it is explained; then a later incident needs
    // its own RCA instead of inheriting one unseen (A13).
    const scored = { ...morning, rca: filed };
    expect(groupLead([scored], later)).toBeNull();
    // A third incident joins the unfiled group it overlaps, not the filed one it also overlaps.
    const newest = inc(3, 'TELLER', none, { startTick: at(12), endTick: at(13) });
    const reborn = { ...later, id: 4 };
    expect(groupLead([scored, reborn], newest)).toBe(reborn);
  });

  it('a fallback cause follows for two hours from the earlier incident’s end, or while it is still open', () => {
    const none: IncidentTruth = { mechanism: 'CPU_PRIORITY', trigger: 'POLICY', cause: 'none:CPU:PROD1' };
    const morning = inc(1, 'MOBILE', none, { startTick: at(9), endTick: at(10) });
    const startAt = (hours: number, endTick: number | null) => inc(2, 'RBANK', none, { startTick: at(hours), endTick });
    expect(GROUP_FOLLOW_HOURS).toBe(2);
    expect(sameCause(morning, startAt(12, at(13)))).toBe(true);
    expect(sameCause(morning, startAt(12 + 1 / TICKS_PER_HOUR, at(13)))).toBe(false);
    // Still open at 09:30: every later incident of the cause overlaps it.
    expect(sameCause(inc(1, 'MOBILE', none, { startTick: at(9), endTick: null }), startAt(20, at(21)))).toBe(true);
  });

  it('a 48-hour creep hurting MOBILE at 09:00 and RBANK at 15:00 is one group, and does not cross the played day', () => {
    const mobile = inc(1, 'MOBILE', { mechanism: 'CPU_PRIORITY', trigger: 'CHANGE_REGRESSION', cause: CREEP_CAUSE });
    const rbank = inc(2, 'RBANK', { mechanism: 'DEPENDENCY', trigger: 'CHANGE_REGRESSION', cause: CREEP_CAUSE }, { startTick: at(15), endTick: at(16) });
    expect(sameCause(mobile, rbank)).toBe(true);
    expect(groupLead([mobile], rbank)).toBe(mobile);
    // The review files one RCA per played day, so tomorrow's victims are their own incident.
    expect(sameCause(mobile, { ...rbank, day: 1 })).toBe(false);
  });

  it("R-6: the batch night joins the day's incident only when the card reached it", () => {
    const night = (truth: IncidentTruth) => inc(3, 'BATCH', truth, { startTick: 0, endTick: at(30) });
    const midday = inc(1, 'MOBILE', { mechanism: 'CPU_PRIORITY', trigger: 'POLICY', cause: CREEP_CAUSE });
    // The creep's footprint reached the critical jobs, so the night is the same cause as the midday victim.
    expect(sameCause(midday, night({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', cause: CREEP_CAUSE }))).toBe(true);
    expect(groupLead([midday], night({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', cause: CREEP_CAUSE }))).toBe(midday);
    // It did not: the night's cause is what the critical path itself was short of.
    expect(sameCause(midday, night({ mechanism: 'CPU_PRIORITY', trigger: 'POLICY', cause: 'none:CPU:PROD2' }))).toBe(false);
  });

  it('keeps the labels’ grouping for saves written before RT-07 (no cause)', () => {
    const truth: IncidentTruth = { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' };
    const a = inc(1, 'MOBILE', truth);
    const b = inc(2, 'RBANK', truth, { startTick: at(15), endTick: at(16) });
    expect(sameCause(a, b)).toBe(true);
    expect(sameCause(a, { ...b, truth: { ...truth, mechanism: 'DEPENDENCY' } })).toBe(false);
    expect(sameCause(a, { ...b, day: 1 })).toBe(false);
  });

  it("a closed hour groups a card's victims by cause where equal labels would have split them", () => {
    // R-7's shape through the real path: one POWER_CAP, MOBILE with a CPU delay and CARDAUTH with a dependency one.
    const def = MIDWEST_GAME.events.find((e) => e.id === 'POWER_CAP')!;
    const started = startDay(newRun(MIDWEST, MIDWEST_GAME, 3), MIDWEST_GAME);
    const run = advance({
      ...started,
      events: [{
        uid: 'POWER_CAP@0', defId: def.id, name: def.name, startTick: 0, endTick: 6 * TICKS_PER_HOUR,
        trigger: def.trigger, affects: def.affects, mechanisms: cardMechanisms(def),
        endCommands: def.end, started: false, ended: false,
      }],
    }, MIDWEST, MIDWEST_GAME, 1);
    const closed = closeHour({
      ...run,
      sim: { ...run.sim, tick: TICKS_PER_HOUR },
      hour: {
        ...newHour(0), ticks: TICKS_PER_HOUR,
        workloads: {
          MOBILE: { completions: 1000, failed: 0, withinSla: 0, rtSumSec: 10_000, parts: { cpuQueue: 10_000 } },
          CARDAUTH: { completions: 1000, failed: 0, withinSla: 0, rtSumSec: 10_000, parts: { dependency: 10_000 } },
        },
      },
    }, MIDWEST, MIDWEST_GAME);
    const cardauth = closed.incidents.find((i) => i.workloadId === 'CARDAUTH')!;
    const mobile = closed.incidents.find((i) => i.workloadId === 'MOBILE')!;
    expect([cardauth.truth.mechanism, mobile.truth.mechanism]).toEqual(['DEPENDENCY', 'CPU_PRIORITY']);
    expect(cardauth.truth.cause).toBe('POWER_CAP@0');
    expect(mobile.truth.cause).toBe('POWER_CAP@0');
    expect(cardauth.rcaGroup).toBeUndefined();
    expect(mobile.rcaGroup).toBe(cardauth.id);
  });
});
