import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { HARBOURLINE_GAME } from '../../src/content/game-harbourline';
import { REVENUE_GAME } from '../../src/content/game-revenue';
import { HARBOURLINE, MIDWEST, REVENUE } from '../../src/content/scenarios';
import { askAround, deliverInquiries, inquiriesView } from '../../src/game/inquiries';
import { newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import type { Scenario } from '../../src/sim/core/scenario';
import type { GameContent } from '../../src/content/types';

/** PT-49: the business calendar and the app owners are the scenario's own, not Midwest's in every run. */
const PACKS = [
  { name: 'midwest', scenario: MIDWEST, game: MIDWEST_GAME },
  { name: 'revenue', scenario: REVENUE, game: REVENUE_GAME },
  { name: 'harbourline', scenario: HARBOURLINE, game: HARBOURLINE_GAME },
] as const;

const contentOf = (game: GameContent): GameContent => ({ ...game, events: [], story: [] });
const start = (scenario: Scenario, game: GameContent, seed = 7): RunState => startDay(newRun(scenario, contentOf(game), seed), contentOf(game));
/** Jump the clock (the reply logic only reads the tick). */
const at = (r: RunState, hourAfter0600: number): RunState => ({ ...r, sim: { ...r.sim, tick: Math.round(hourAfter0600 * TICKS_PER_HOUR) } });

describe.each(PACKS)('$name inquiries', ({ scenario, game }) => {
  it('names an owner for every workload it ships', () => {
    const owners = game.appOwners ?? {};
    const ids = scenario.workloads.map((w) => w.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(owners[id], `${id} owner`).toMatch(/\S+ \(\S+/);
    expect(Object.keys(owners).sort()).toEqual([...ids].sort());
  });

  it('asks the application owner by name, shows them while waiting, and sends the reply from them', () => {
    let r = start(scenario, game);
    let wid = scenario.workloads[0]!.id;
    let owner = game.appOwners![wid]!;
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
  it('a due ANALYTICS question is delivered at the next office-hours check, not lost for want of an owner', () => {
    // Revenue seed 23: `ask APP_ENTRY ANALYTICS` gave no reply within 17 h. The delay is the office-hours gate and
    // the 20 % shrug, not a missing owner: the reply arrives, from the named owner, on the first delivery in hours.
    let r = start(REVENUE, REVENUE_GAME, 23);
    r = askAround(r, 'APP_ENTRY', 'ANALYTICS', REVENUE, contentOf(REVENUE_GAME)).run;
    const before = r.inbox.length;
    expect(deliverInquiries(at(r, 0.5), REVENUE, contentOf(REVENUE_GAME)).inbox.length).toBe(before); // 06:30, closed
    const answered = deliverInquiries(at(r, 10), REVENUE, contentOf(REVENUE_GAME)); // 16:00
    expect(answered.inbox.length).toBe(before + 1);
    expect(answered.inbox.at(-1)!.from).toBe('Rosa Delgado (compliance analytics)');
  });
});
