import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { advance, newRun, requestChange, startDay, submitRca } from '../../src/game/run';
import { closeHour, newHour } from '../../src/game/run/hourly';
import type { RunState } from '../../src/game/types';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };
const hourStart = 7 * TICKS_PER_HOUR; // 13:00 on the first played day
const hourEnd = hourStart + TICKS_PER_HOUR;

/** A CPU-delayed MOBILE breach accumulated over 13:00–14:00, independent of sim tuning. */
function breachAt(tick: number): RunState {
  const run = startDay(newRun(MIDWEST, content, 7), content);
  const storm = MIDWEST_GAME.events.find((e) => e.id === 'RETRY_STORM')!;
  return {
    ...run,
    sim: { ...run.sim, tick },
    hour: {
      ...newHour(hourStart),
      ticks: TICKS_PER_HOUR - 1,
      workloads: { MOBILE: { completions: 1000, failed: 0, withinSla: 0, rtSumSec: 10_000, parts: { cpuQueue: 10_000 } } },
    },
    events: [{
      uid: 'RETRY_STORM@0', defId: storm.id, name: storm.name,
      startTick: hourStart - 72, // 12:48, as in the playtest finding
      endTick: hourEnd + TICKS_PER_HOUR, trigger: storm.trigger, affects: storm.affects,
      endCommands: storm.end, started: true, ended: false,
    }],
  };
}

describe('incident trigger history', () => {
  it.each([hourStart + TICKS_PER_HOUR / 4, hourEnd])('retains the storm after MOBILE_BACKOFF at tick %i', (tick) => {
    const fixed = requestChange(breachAt(tick), MIDWEST_GAME, { label: 'Mobile backoff', fixId: 'MOBILE_BACKOFF' });
    expect(fixed.ok).toBe(true);
    expect(fixed.run.events[0]).toMatchObject({ ended: true, endTick: tick });
    const closed = closeHour({ ...fixed.run, sim: { ...fixed.run.sim, tick: hourEnd } }, MIDWEST);
    const inc = closed.incidents.find((i) => i.workloadId === 'MOBILE')!;
    expect(inc.startTick).toBe(hourStart);
    expect(inc.truth).toEqual({ mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE' });
    const scored = submitRca(closed, inc.id, 'CPU_PRIORITY', 'DEMAND_SURGE');
    expect(scored.incidents.find((i) => i.id === inc.id)!.rca!.points).toBe(5);
  });

  it('retains a storm expiring on the last tick before the hour closes', () => {
    const run = breachAt(hourEnd - 1);
    run.events[0] = { ...run.events[0]!, endTick: hourEnd - 1 };
    const closed = advance(run, MIDWEST, content, 1);
    expect(closed.sim.tick).toBe(hourEnd);
    expect(closed.events[0]!.ended).toBe(true);
    expect(closed.incidents.find((i) => i.workloadId === 'MOBILE')?.truth).toEqual({ mechanism: 'CPU_PRIORITY', trigger: 'DEMAND_SURGE' });
  });
});
