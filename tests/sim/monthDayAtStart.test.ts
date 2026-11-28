// PRO-01: a scenario's calendar can start on another day of the month. Weekdays still count from the run's first
// Monday; only the date moves.
import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import { clockAt, DEFAULT_MONTH_DAY_AT_START } from '../../src/sim/core/clock';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import { baseRate } from '../../src/sim/workload/arrivals';
import { monthElapsedFrac } from '../../src/sim/cost/mlc';

/** Ticks after day `d`'s 06:00 start at which wall-clock `hour` falls on that calendar date (hour ≥ 6). */
const at = (d: number, hour: number) => d * TICKS_PER_DAY + (hour - 6) * TICKS_PER_HOUR;
/** Ticks of the first moment of the calendar date after played day `d`'s start. */
const midnightAfter = (d: number) => at(d, 24);

describe('a calendar starting on the 26th (PRO-01)', () => {
  const sc = { ...MIDWEST, monthDayAtStart: 26 };

  it('day 0 is Monday the 26th; the tick after day 4\'s midnight is Saturday the 1st', () => {
    expect(clockAt(0, 26)).toMatchObject({ dayOfWeek: 0, dayOfMonth: 26 });
    expect(clockAt(at(3, 12), 26)).toMatchObject({ dayOfWeek: 3, dayOfMonth: 29 });
    expect(clockAt(midnightAfter(4) - 1, 26)).toMatchObject({ dayOfWeek: 4, dayOfMonth: 30 });
    expect(clockAt(midnightAfter(4), 26)).toMatchObject({ dayOfWeek: 5, isWeekend: true, dayOfMonth: 1 });
    // The default is the 3rd, as before.
    expect(DEFAULT_MONTH_DAY_AT_START).toBe(3);
    expect(clockAt(0).dayOfMonth).toBe(3);
    expect(clockAt(midnightAfter(4)).dayOfMonth).toBe(8);
  });

  it('day 3 has the month-end multiplier and Saturday the 1st the payday multiplier', () => {
    const w = MIDWEST.workloads.find((x) => x.shape.monthEnd !== 1 && x.shape.payday !== 1)!;
    expect(w).toBeDefined();
    // Same weekday and hour, the only difference the date: the 3rd's calendar has neither on these ticks.
    const ratio = (tick: number) => baseRate(w, clockAt(tick, 26)) / baseRate(w, clockAt(tick));
    expect(ratio(at(3, 12))).toBeCloseTo(w.shape.monthEnd, 9);
    expect(ratio(at(1, 12))).toBeCloseTo(1, 9);
    expect(ratio(midnightAfter(4) + 1)).toBeCloseTo(w.shape.payday, 9);
  });

  it('the run state carries the start day, and the MLC month fraction reads it', () => {
    expect(initState(1, sc).monthDayAtStart).toBe(26);
    expect('monthDayAtStart' in initState(1, MIDWEST)).toBe(false);
    expect(monthElapsedFrac(0, 26)).toBeCloseTo((25 * 24 + 6) / (30 * 24), 9);
  });

  it('day 4\'s night closes the month and writes a bill', () => {
    let s = { ...initState(7, sc), tick: midnightAfter(4) - 2 * TICKS_PER_HOUR };
    for (let i = 0; i < 2 * TICKS_PER_HOUR - 1; i++) s = step(s, [], sc);
    expect(s.cost.bills).toHaveLength(0);
    s = step(s, [], sc);
    s = step(s, [], sc);
    expect(s.cost.bills).toHaveLength(1);
    // The 3rd's calendar crosses no month end on the same ticks.
    let d = { ...initState(7, MIDWEST), tick: midnightAfter(4) - 2 };
    for (let i = 0; i < 4; i++) d = step(d, [], MIDWEST);
    expect(d.cost.bills).toHaveLength(0);
  });
});
