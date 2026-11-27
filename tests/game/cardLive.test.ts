// CL-64: the one "card is live" predicate, and the engine's tick-aware form kept beside it.

import { cardLive, cardRunning } from '../../src/game/run/shared';
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
  });

  it('stays live while a persistent card is started', () => {
    expect(cardLive(card({ started: true, startTick: 10 }), 12)).toBe(true);
  });

  it('a card that starts in the current tick is live to the engine, not yet to the live query', () => {
    const starting = card({ started: false, startTick: 12 });
    expect(cardLive(starting, 12)).toBe(false);
    expect(cardRunning(starting, 12)).toBe(true);
  });

  it('a card that ends in the current tick is live to neither query', () => {
    const ending = card({ started: true, startTick: 10, endTick: 12 });
    expect(cardLive(ending, 12)).toBe(false);
    expect(cardRunning(ending, 12)).toBe(false);
  });

  it('an ended card and a card not yet due are live to neither query', () => {
    const ended = card({ started: true, ended: true });
    expect(cardLive(ended, 12)).toBe(false);
    expect(cardRunning(ended, 12)).toBe(false);
    const future = card({ startTick: 13 });
    expect(cardLive(future, 12)).toBe(false);
    expect(cardRunning(future, 12)).toBe(false);
  });
});
