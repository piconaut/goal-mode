import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { advance, newRun, requestChange, startDay, submitRca } from '../../src/game/run';
import { closeHour, newHour } from '../../src/game/run/hourly';
import { triggerOf } from '../../src/game/sla';
import { HARBOURLINE_GAME } from '../../src/content/game-harbourline';
import { REVENUE_GAME } from '../../src/content/game-revenue';
import type { ActiveEvent, HourAcc, RunState } from '../../src/game/types';
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
    const closed = closeHour({ ...fixed.run, sim: { ...fixed.run.sim, tick: hourEnd } }, MIDWEST, MIDWEST_GAME);
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

describe('card mechanisms', () => {
  const hour = { hourIndex: 0, ticks: 1, workloads: {}, maxCappedFrac: 0, cappedByLpar: {}, cpcBusySum: 0, lockIndexSum: 0 } as HourAcc;
  const cardOf = (defId: string, over: Partial<ActiveEvent> = {}): ActiveEvent => {
    const def = MIDWEST_GAME.events.find((e) => e.id === defId)!;
    return { uid: `${defId}@1`, defId, name: def.name, startTick: 0, endTick: 10, trigger: def.trigger, affects: def.affects, mechanisms: def.mechanisms, endCommands: [], started: true, ended: false, ...over };
  };

  it('U-2: a 30-hour CPU regression does not take an I/O incident from the DASD fault', () => {
    const regression = cardOf('REGRESSION', { endTick: null });
    const dasd = cardOf('DASD_DEGRADED', { uid: 'DASD_DEGRADED@1' });
    expect(triggerOf('RBANK', 'IO', [regression, dasd], hour, false)).toBe('HARDWARE_FAULT');
  });

  it('U-4: a retry storm (demand) does not take a lock incident', () => {
    // With no lock index the fallback is growth; a real lock clash is batch overlap, not the storm.
    expect(triggerOf('MOBILE', 'LOCK_CONTENTION', [cardOf('RETRY_STORM')], hour, false)).toBe('GROWTH');
    const clash = { ...hour, ticks: 10, lockIndexSum: 30 } as HourAcc;
    expect(triggerOf('MOBILE', 'LOCK_CONTENTION', [cardOf('RETRY_STORM')], clash, false)).toBe('BATCH_OVERLAP');
  });

  it('every card in the three decks with non-empty affects declares its mechanisms', () => {
    const decks = [MIDWEST_GAME, HARBOURLINE_GAME, REVENUE_GAME];
    const missing = decks.flatMap((d) => d.events.filter((e) => e.affects.length > 0 && !e.mechanisms).map((e) => e.id));
    expect(missing).toEqual([]);
  });
});
