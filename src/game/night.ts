import { CPU_SPLIT } from '../content/incidents';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';

/** A played day's batch night starts at 18:00, twelve hours after the day's 06:00 start, and runs to the day end. */
export const nightStartTick = (day: number): number => day * TICKS_PER_DAY + 12 * TICKS_PER_HOUR;

/** The night's opening clock as seconds from the day's 06:00 start (18:00 = 43 200 s). */
export const nightStartSec = (day: number): number =>
  ((nightStartTick(day) - day * TICKS_PER_DAY) / TICKS_PER_HOUR) * 3600;

/** A critical job is at risk once its forecast end is within `CPU_SPLIT.atRiskMargin` of the night before the
 * deadline: the margin is that share of the night window that ends at the deadline, not of the absolute deadline. */
export const batchAtRiskFromSec = (day: number, deadlineSec: number): number =>
  deadlineSec - CPU_SPLIT.atRiskMargin * Math.max(0, deadlineSec - nightStartSec(day));
