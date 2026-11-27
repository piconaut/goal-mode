// CL-64: the one "card is live" predicate, and the engine's tick-aware form kept beside it.

import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { advance, newRun, startDay } from '../../src/game/run';
import { previewContext } from '../../src/game/run/changes';
import { cardInForce, cardLive, cardRunning } from '../../src/game/run/shared';
import type { ActiveEvent } from '../../src/game/types';

type LiveFields = Pick<ActiveEvent, 'started' | 'ended' | 'startTick' | 'endTick'>;

const card = (over: Partial<LiveFields>): LiveFields => ({
  started: false,
  ended: false,
  startTick: 0,
  endTick: null,
  ...over,
});

describe('the live-card predicate (CL-64)', () => {
  it('is live from its start tick until its end tick', () => {
    const running = card({ started: true, startTick: 10, endTick: 20 });
    expect(cardLive(running, 12)).toBe(true);
    expect(cardLive(running, 19)).toBe(true);
    expect(cardLive(running, 20)).toBe(false);
    expect(cardRunning(running, 20)).toBe(false);
    expect(cardInForce(running)).toBe(true);
  });

  it('stays live while a persistent card is started', () => {
    expect(cardLive(card({ started: true, startTick: 10 }), 12)).toBe(true);
  });

  it('a card that starts in the current tick is live to the engine, not yet to the live query', () => {
    const starting = card({ started: false, startTick: 12 });
    expect(cardLive(starting, 12)).toBe(false);
    expect(cardRunning(starting, 12)).toBe(true);
  });

  it('a card that ends in the current tick is past both live queries but still in force', () => {
    const ending = card({ started: true, startTick: 10, endTick: 12 });
    expect(cardLive(ending, 12)).toBe(false);
    expect(cardRunning(ending, 12)).toBe(false);
    // `advance` has not ended it yet: its end commands run on the next advance, so the published state still
    // carries its effects (blocked hardware, the regulator audit, the bots' hourly fixes).
    expect(cardInForce(ending)).toBe(true);
  });

  it('an ended card and a card not yet due are live to neither query', () => {
    const ended = card({ started: true, ended: true });
    expect(cardLive(ended, 12)).toBe(false);
    expect(cardRunning(ended, 12)).toBe(false);
    expect(cardInForce(ended)).toBe(false);
    const future = card({ startTick: 13 });
    expect(cardLive(future, 12)).toBe(false);
    expect(cardRunning(future, 12)).toBe(false);
    expect(cardInForce(future)).toBe(false);
  });

  it('the published state keeps a card at its end tick in force (one advance behind `ended`)', () => {
    const game = { ...MIDWEST_GAME, events: [] };
    const def = MIDWEST_GAME.events.find((d) => d.id === 'RETRY_STORM')!;
    let run = startDay(newRun(MIDWEST, game, 7), game);
    run = {
      ...run,
      events: [{
        uid: 'RETRY_STORM@0',
        defId: def.id,
        name: def.name,
        startTick: 0,
        endTick: 1,
        trigger: def.trigger,
        affects: def.affects,
        mechanisms: [],
        endCommands: [],
        started: true,
        ended: false,
        blocksHardware: ['COD_CP'],
      }],
    };
    run = advance(run, MIDWEST, game, 1);
    const event = run.events[0]!;
    expect(run.sim.tick).toBe(1);
    expect(event).toMatchObject({ endTick: 1, started: true, ended: false });
    expect(cardLive(event, run.sim.tick)).toBe(false);
    expect(cardInForce(event)).toBe(true);
    expect(previewContext(run, game).blockedHardware).toContain('COD_CP');
  });
});
