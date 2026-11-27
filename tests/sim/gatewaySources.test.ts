// PR-27: a gateway card's attack/retry source split lives in sim state, so a sim-only replay of a run with a
// protection mode set sheds exactly what the game shifts. Before this, `step` took the split as a fourth argument
// that only src/game/run.ts supplied, so `step(sim, commands, scenario)` (bench, lab, a headless replay) shed a
// different share of the same demand.

import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { advance, newRun, startDay } from '../../src/game/run';
import type { ActiveEvent } from '../../src/game/types';
import { applyOperation } from '../../src/sim/core/operations';
import { step } from '../../src/sim/core/step';

const bots = MIDWEST_GAME.events.find((e) => e.id === 'BOT_ATTACK')!;
// The card must be in the content so `advance` can find its begin/end commands; its minDay keeps the deck empty on
// day 0, so the run below injects the live card itself.
const content = { ...MIDWEST_GAME, events: [bots] };

/** The bot card live from the run's first tick, its begin commands not yet applied. */
const card = (startTick: number): ActiveEvent => ({
  uid: 'BOT_ATTACK@0',
  defId: bots.id,
  name: bots.name,
  startTick,
  endTick: null,
  trigger: bots.trigger,
  affects: bots.affects,
  mechanisms: [],
  endCommands: bots.end,
  started: false,
  ended: false,
});

describe('gateway source state (PR-27)', () => {
  it('hands the card source to sim state, and a sim-only step sheds the same traffic as the game', () => {
    let run = { ...startDay(newRun(MIDWEST, content, 7), content), events: [card(0)] };
    run = advance(run, MIDWEST, content, 1);
    // The begin commands ran: the demand multiplier and the edge's attack share are both in the sim.
    expect(run.sim.mods.rate.MOBILE).toBeGreaterThan(1);
    expect(run.sim.mods.gatewaySources?.MOBILE?.attackRateMult).toBeGreaterThan(1);

    const mode = applyOperation(run.sim, MIDWEST, { kind: 'SET_GATEWAY', workloadId: 'MOBILE', mode: 'BLOCK' });
    expect(mode.ok).toBe(true);
    const guarded = { ...run, sim: mode.state };

    // The game path and a bare `step` (no fourth argument) must agree: the split is in the state they share.
    const game = advance(guarded, MIDWEST, content, 1);
    const simOnly = step(guarded.sim, [], MIDWEST);
    expect(simOnly).toEqual(game.sim);
    // The attack share was blocked, not admitted; the failed share is the shared-source leak only.
    const mobile = simOnly.last.workloads.find((w) => w.id === 'MOBILE')!;
    expect(mobile.failed).toBeGreaterThan(0);
  });

  it('stops applying the source when the card ends, so the next replay matches too', () => {
    let run = { ...startDay(newRun(MIDWEST, content, 7), content), events: [card(0)] };
    run = advance(run, MIDWEST, content, 2);
    expect(run.sim.mods.gatewaySources?.MOBILE?.attackRateMult).toBeGreaterThan(1);
    // End the card the way the deck does: its end commands clear what its begin set.
    run = { ...run, sim: { ...run.sim, tick: 2 }, events: run.events.map((e) => ({ ...e, endTick: 2 })) };
    run = advance(run, MIDWEST, content, 1);
    expect(run.sim.mods.gatewaySources).toBeUndefined();
    expect(step(run.sim, [], MIDWEST)).toEqual(advance(run, MIDWEST, content, 1).sim);
  });
});
