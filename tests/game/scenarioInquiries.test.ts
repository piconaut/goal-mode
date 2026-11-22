import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { HARBOURLINE_GAME } from '../../src/content/game-harbourline';
import { REVENUE_GAME } from '../../src/content/game-revenue';
import { ACQUIRED_APP, BOOKING_APP } from '../../src/content/events/midwest-events';
import { PREFILL_APP } from '../../src/content/events/revenue-events';
import { HARBOURLINE, MIDWEST, REVENUE } from '../../src/content/scenarios';
import { askAround, deliverInquiries, inquiriesView } from '../../src/game/inquiries';
import { newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { clockAt } from '../../src/sim/core/clock';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import type { Scenario } from '../../src/sim/core/scenario';
import type { GameContent } from '../../src/content/types';

/** PT-49: the business calendar and the app owners are the scenario's own, not Midwest's in every run. */
const PACKS = [
  { name: 'midwest', scenario: MIDWEST, game: MIDWEST_GAME, added: [ACQUIRED_APP, BOOKING_APP] },
  { name: 'revenue', scenario: REVENUE, game: REVENUE_GAME, added: [PREFILL_APP] },
  { name: 'harbourline', scenario: HARBOURLINE, game: HARBOURLINE_GAME, added: [] },
] as const;

const contentOf = (game: GameContent): GameContent => ({ ...game, events: [], story: [] });
const start = (scenario: Scenario, game: GameContent, seed = 7): RunState => startDay(newRun(scenario, contentOf(game), seed), contentOf(game));
/** Jump the clock (the reply logic only reads the tick). */
const at = (r: RunState, hourAfter0600: number): RunState => ({ ...r, sim: { ...r.sim, tick: Math.round(hourAfter0600 * TICKS_PER_HOUR) } });

describe.each(PACKS)('$name inquiries', ({ scenario, game, added }) => {
  it('names an owner for every workload it ships or an event adds', () => {
    const owners = game.appOwners ?? {};
    const ids = [...scenario.workloads, ...added].map((w) => w.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(owners[id], `${id} owner`).toMatch(/\S+ \(\S+/);
    expect(Object.keys(owners).sort()).toEqual([...ids].sort());
  });

  it('asks the application owner by name, shows them while waiting, and sends the reply from them', () => {
    let r = start(scenario, game);
    const wid = scenario.workloads[0]!.id;
    const owner = game.appOwners![wid]!;
    const asked = askAround(r, 'APP_ENTRY', wid, scenario, contentOf(game));
    expect(asked.ok, asked.message).toBe(true);
    expect(asked.message).toContain(owner);
    r = asked.run;
    expect(inquiriesView(r, scenario, contentOf(game)).pending[0]!.who).toBe(owner);
    r = deliverInquiries(at(r, 9), scenario, contentOf(game)); // 15:00
    expect(r.inbox.at(-1)!.from).toBe(owner);
    // The view resolves the run's own scenario content too, as an empty pending list would hide a fallback name.
    expect(inquiriesView(asked.run, scenario).pending[0]!.who).toBe(owner);
  });

  it('answers CALENDAR with this business’s facts, never another scenario’s', () => {
    let r = start(scenario, game);
    r = askAround(r, 'CALENDAR', null, scenario, contentOf(game)).run;
    r = deliverInquiries(at(r, 9), scenario, contentOf(game));
    const body = r.inbox.at(-1)!.body;
    const own = (game.calendarFacts ?? []).map((f) => f.text);
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((text) => body.includes(text))).toBe(true);
    for (const other of PACKS.filter((p) => p.name !== scenario.id)) {
      for (const text of other.game.calendarFacts ?? []) expect(body).not.toContain(text);
    }
  });
});

describe('an app owner that is present answers (PT-49 report)', () => {
  it('Revenue seed 23: a 15:00 question due after office hours waits for 08:00, then answers from its owner', () => {
    // The playtest's "no reply within 17 h" is the office-hours gate, not a missing owner: asked at 15:00, the
    // reply is due 19:02 and the first delivery is 08:00 next day. A 20 % shrug is still a delivered reply.
    const asked = askAround(at(start(REVENUE, REVENUE_GAME, 23), 9), 'APP_ENTRY', 'ANALYTICS', REVENUE, contentOf(REVENUE_GAME));
    expect(asked.ok, asked.message).toBe(true);
    const due = asked.run.inquiries!.pending[0]!.replyTick;
    expect(clockAt(due).hourOfDay).toBeGreaterThanOrEqual(18); // due after the office closes
    const before = asked.run.inbox.length;
    const evening = deliverInquiries({ ...asked.run, sim: { ...asked.run.sim, tick: due } }, REVENUE, contentOf(REVENUE_GAME));
    expect(evening.inbox.length).toBe(before); // due, but nobody answers at 19:02
    const morning = deliverInquiries(at(asked.run, 26), REVENUE, contentOf(REVENUE_GAME)); // 08:00 next day
    expect(morning.inbox.length).toBe(before + 1);
    expect(morning.inbox.at(-1)!.from).toBe('Rosa Delgado (compliance analytics)');
  });
});
