import { DAY_SEC, DAY_START_HOUR, TICK_SEC, TICKS_PER_DAY } from './units';

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Monday

export interface ClockInfo {
  /** Played-day index since run start (0-based); a played day starts at 06:00. */
  day: number;
  /** Seconds since the played day's 06:00 start. */
  secOfPlayedDay: number;
  /** Wall-clock hour of day, fractional, 0..24. */
  hourOfDay: number;
  /** Calendar date index (changes at midnight), 0 = run's first Monday. */
  calendarDay: number;
  dayOfWeek: DayOfWeek;
  isWeekend: boolean;
  /** Day of month 1..30 under the sim's simplified 30-day months. */
  dayOfMonth: number;
}

export function clockAt(tick: number): ClockInfo {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const secOfPlayedDay = (tick - day * TICKS_PER_DAY) * TICK_SEC;
  const absSec = day * DAY_SEC + DAY_START_HOUR * 3600 + secOfPlayedDay;
  const calendarDay = Math.floor(absSec / DAY_SEC);
  const hourOfDay = (absSec - calendarDay * DAY_SEC) / 3600;
  const dayOfWeek = (calendarDay % 7) as DayOfWeek;
  return {
    day,
    secOfPlayedDay,
    hourOfDay,
    calendarDay,
    dayOfWeek,
    isWeekend: dayOfWeek >= 5,
    // Runs start on the 3rd so the first payday (15th) lands mid-run.
    dayOfMonth: ((calendarDay + 2) % 30) + 1,
  };
}

export function formatClock(tick: number): string {
  const c = clockAt(tick);
  const secOfDay = Math.round(c.hourOfDay * 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `D${c.day + 1} ${pad(Math.floor(secOfDay / 3600))}:${pad(Math.floor((secOfDay % 3600) / 60))}:${pad(secOfDay % 60)}`;
}
