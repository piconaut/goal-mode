import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { HISTORY_EVERY_TICKS } from '../../src/game/history';
import { advanceHours } from '../../src/game/advance';
import { advance, newRun, startDay } from '../../src/game/run';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };
const live = (seed = 7, mon3 = false) => {
  const run = startDay(newRun(MIDWEST, content, seed), content);
  return mon3 ? { ...run, tools: [...run.tools, 'RMF_MON3'] } : run;
};

describe('advanceHours', () => {
  it('advances exactly as the game advance with no hooks', () => {
    const run = live();
    const base = advance(run, MIDWEST, content, 2 * TICKS_PER_HOUR);
    const out = advanceHours(run, content, 2);
    expect(out.sim.tick).toBe(run.sim.tick + 2 * TICKS_PER_HOUR);
    expect(out).toEqual(base);
  });

  it('calls the hooks on the chart and MINTIME boundaries from any starting tick', () => {
    const run = advance(live(7, true), MIDWEST, content, 7);
    const chunks: number[] = [];
    const minTimes: number[] = [];
    const out = advanceHours(run, content, 1, {
      onChunk: (x) => chunks.push(x.sim.tick),
      onMintime: (x) => minTimes.push(x.sim.tick),
    });
    expect(out.sim.tick).toBe(run.sim.tick + TICKS_PER_HOUR);
    expect(chunks).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]);
    expect(minTimes).toEqual(Array.from({ length: 30 }, (_, i) => (i + 1) * 12));
    expect(chunks.every((t) => t % HISTORY_EVERY_TICKS === 0)).toBe(true);
    expect(minTimes.every((t) => t % 12 === 0)).toBe(true);
  });

  it('does not call the MINTIME hook when MON3 is not owned', () => {
    const run = live(7, false);
    const minTimes: number[] = [];
    advanceHours(run, content, 1, { onMintime: (x) => minTimes.push(x.sim.tick) });
    expect(minTimes).toEqual([]);
  });

  it('stops after the hour whose stop-when condition fires', () => {
    const run = live();
    let calls = 0;
    const out = advanceHours(run, content, 6, {
      stopWhen: () => ++calls === 3,
    });
    expect(calls).toBe(3);
    expect(out.sim.tick).toBe(run.sim.tick + 3 * TICKS_PER_HOUR);
    expect(out).toEqual(advance(run, MIDWEST, content, 3 * TICKS_PER_HOUR));
  });

  it('advances individual ticks with fractional hours', () => {
    const run = live();
    const out = advanceHours(run, content, 30 / TICKS_PER_HOUR);
    expect(out.sim.tick).toBe(run.sim.tick + 30);
    expect(out).toEqual(advance(run, MIDWEST, content, 30));
  });

  it('stops at the end of the live day', () => {
    const run = live();
    const out = advanceHours(run, content, 24);
    expect(out.phase).not.toBe('LIVE');
    expect(out.sim.tick).toBe(run.sim.tick + 24 * TICKS_PER_HOUR);
  });
});
