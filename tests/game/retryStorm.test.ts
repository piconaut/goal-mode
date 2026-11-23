import { HARBOURLINE_GAME } from '../../src/content/game-harbourline';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { REVENUE_GAME } from '../../src/content/game-revenue';
import { HARBOURLINE, MIDWEST, REVENUE } from '../../src/content/scenarios';
import { addPin, type EvidencePin } from '../../src/game/evidence';
import { judgeProof } from '../../src/game/proof';
import { advance, newRun, startDay } from '../../src/game/run';
import { db2Accounting, db2Statistics } from '../../src/game/smf';
import type { GameContent } from '../../src/content/types';
import type { Incident } from '../../src/game/types';
import type { Scenario } from '../../src/sim/core/scenario';
import type { Command } from '../../src/sim/core/commands';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import { EMPTY_SUBJECTS, truthOf } from '../helpers/truth';

/** RT-23: a retry storm backs out a share of its units of work, so the Db2 rollback share tells it from a surge. */
const PACKS = [
  { name: 'midwest', scenario: MIDWEST, game: MIDWEST_GAME, storm: 'RETRY_STORM', workloadId: 'MOBILE' },
  { name: 'revenue', scenario: REVENUE, game: REVENUE_GAME, storm: 'REFUND_RETRY_STORM', workloadId: 'REFSTAT' },
  { name: 'harbourline', scenario: HARBOURLINE, game: HARBOURLINE_GAME, storm: 'RETRY_STORM', workloadId: 'MOBILE' },
] as const;

const contentOf = (game: GameContent): GameContent => ({ ...game, events: [] });
const HOUR = TICKS_PER_HOUR;

/** A clean noon run with no event deck, so only the commands under test move the sim. */
function noon(scenario: Scenario, game: GameContent): ReturnType<typeof newRun> {
  return advance(startDay(newRun(scenario, contentOf(game), 7), contentOf(game)), scenario, contentOf(game), 6 * HOUR);
}

const beginOf = (game: GameContent, id: string): Command[] => {
  const card = game.events.find((e) => e.id === id);
  expect(card, id).toBeDefined();
  expect(card!.begin, `${id} begin`).toBeDefined();
  return card!.begin as Command[];
};

/** The same storm without its rollback modifier: a demand surge of the same rate on the same workload. */
const surgeOf = (begin: Command[]): Command[] =>
  begin.filter((c) => !(c.kind === 'SET_MODIFIER' && c.mod === 'rollbackFrac'));

const rowOf = (r: ReturnType<typeof newRun>, scenario: Scenario, workloadId: string) =>
  db2Accounting(r, scenario, 'current').find((x) => x.workloadId === workloadId)!;

describe.each(PACKS)('$name retry storm (RT-23)', ({ scenario, game, storm, workloadId }) => {
  let begin: Command[];
  let base: ReturnType<typeof newRun>;
  let backedOut: ReturnType<typeof newRun>;
  let surged: ReturnType<typeof newRun>;

  beforeAll(() => {
    begin = beginOf(game, storm);
    base = noon(scenario, game);
    backedOut = advance({ ...base, pendingCommands: begin }, scenario, contentOf(game), 30);
    surged = advance({ ...base, pendingCommands: surgeOf(begin) }, scenario, contentOf(game), 30);
  }, 120_000);

  it('backs out a share of the units, which the Db2 accounting row shows', () => {
    const stormRow = rowOf(backedOut, scenario, workloadId);
    const surgeRow = rowOf(surged, scenario, workloadId);
    expect(stormRow.rollbacks).toBeGreaterThan(0);
    expect(stormRow.rollbackPct).toBeCloseTo(20, 6);
    expect(stormRow.commits).toBeCloseTo(stormRow.rollbacks * 4, 6);
    // Same rate, same work: only the backouts differ.
    expect(stormRow.txnPerSec).toBeCloseTo(surgeRow.txnPerSec, 12);
    expect(surgeRow.rollbacks).toBe(0);
    expect(surgeRow.rollbackPct).toBe(0);
    // The rollback pin reads the row and is notable enough to prove an application error.
    const pinned = addPin(backedOut, scenario, { source: 'DB2', hour: 'current', workloadId, metric: 'ROLLBACK_PCT' });
    expect(pinned.ok, pinned.message).toBe(true);
    expect(pinned.run.pins.at(-1)!.value).toBeCloseTo(stormRow.rollbackPct, 6);
  });

  it('the Db2 statistics view counts rollbacks per member', () => {
    const rows = db2Statistics(backedOut, scenario, 'current');
    expect(rows.reduce((a, x) => a + x.rollbacks, 0)).toBeCloseTo(rowOf(backedOut, scenario, workloadId).rollbacks, 6);
    expect(rows.some((x) => x.rollbacks > 0)).toBe(true);
    expect(db2Statistics(surged, scenario, 'current').reduce((a, x) => a + x.rollbacks, 0)).toBe(0);
  });

  it('keeps the share, and the member split, in a closed hour', () => {
    const closed = advance(backedOut, scenario, contentOf(game), HOUR - 30);
    const h = closed.smfHours.at(-1)!;
    const key = `${h.day}:${h.hourOfDay}`;
    const before = db2Statistics(closed, scenario, key).map((x) => x.rollbacks);
    expect(h.workloads[workloadId]!.rolledBack).toBeGreaterThan(0);
    expect(h.db2RollbacksByLpar).toBeDefined();
    expect(db2Accounting(closed, scenario, key).find((x) => x.workloadId === workloadId)!.rollbackPct).toBeCloseTo(20, 6);
    // A later routing change must not rewrite the closed report (the frozen-SMF rule, as for "vs base").
    const first = Object.keys(scenario.workloads.find((w) => w.id === workloadId)!.routing)[0]!;
    const rerouted = advance({ ...closed, pendingCommands: [{ kind: 'SET_ROUTING', workloadId, routing: { [first]: 1 } }] }, scenario, contentOf(game), 30);
    expect(db2Statistics(rerouted, scenario, key).map((x) => x.rollbacks)).toEqual(before);
  });
});

describe('the rollback share proves an application error (RT-23, docs/rca-design.md §5.3)', () => {
  const run = newRun(MIDWEST, contentOf(MIDWEST_GAME), 7);
  const group: Incident[] = [{
    id: 1, workloadId: 'MOBILE', day: run.day, startTick: 0, endTick: null, hours: 1, worstAttainmentPct: 80,
    truth: truthOf('CPU_PRIORITY', 'APPLICATION_ERROR'), subjects: EMPTY_SUBJECTS, rca: null, trustLost: 0,
  }];
  const pin = (id: number, metric: 'ROLLBACK_PCT' | 'ENDED_RATE', value: number, baseline?: number): EvidencePin => ({
    id, source: 'DB2', metric, subject: 'MOBILE', system: '*PLEX', tick: 0, value, ...(baseline !== undefined ? { baseline } : {}), text: `${metric} ${value}`,
  });

  it('two pins prove it: the rollbacks and the volume they came with', () => {
    const proof = judgeProof(run, MIDWEST, group, 'CPU_PRIORITY', 'APPLICATION_ERROR', [pin(1, 'ROLLBACK_PCT', 20), pin(2, 'ENDED_RATE', 2.5, 1)]);
    expect(proof.trigger.complete).toBe(true);
  });

  it('the volume alone does not: a campaign without backouts stays unproven', () => {
    const proof = judgeProof(run, MIDWEST, group, 'CPU_PRIORITY', 'APPLICATION_ERROR', [pin(1, 'ROLLBACK_PCT', 0), pin(2, 'ENDED_RATE', 2.5, 1)]);
    expect(proof.trigger.complete).toBe(false);
  });

  it('the rollbacks alone do not: the volume predicate still needs its pin', () => {
    const proof = judgeProof(run, MIDWEST, group, 'CPU_PRIORITY', 'APPLICATION_ERROR', [pin(1, 'ROLLBACK_PCT', 20)]);
    expect(proof.trigger.complete).toBe(false);
    expect(proof.trigger.predicates[0]!.met).toBe(true);
    expect(proof.trigger.predicates[1]!.met).toBe(false);
  });
});
