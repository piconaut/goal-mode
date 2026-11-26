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

/** A clock field to two digits: `pad2(7)` → `07`, the zero-padded form every clock text is built from. */
export const pad2 = (n: number): string => String(n).padStart(2, '0');

export function formatClock(tick: number): string {
  const c = clockAt(tick);
  const secOfDay = Math.round(c.hourOfDay * 3600);
  return `D${c.day + 1} ${pad2(Math.floor(secOfDay / 3600))}:${pad2(Math.floor((secOfDay % 3600) / 60))}:${pad2(secOfDay % 60)}`;
}

/** `HH:MM` of a tick: formatClock's day and time without the day or seconds (chart axes, log lines). */
export function hhmm(tick: number): string {
  const c = clockAt(tick);
  const secOfDay = Math.round(c.hourOfDay * 3600);
  return `${pad2(Math.floor(secOfDay / 3600))}:${pad2(Math.floor((secOfDay % 3600) / 60))}`;
}

/** Stable played-day + visible HH:MM key, shared by report rows and readers. */
export const minuteKey = (tick: number): string => `${clockAt(tick).day}:${hhmm(tick)}`;

/** Seconds after the played day's 06:00 start for a wall-clock hour (hours below 6, or 24 and up, = next morning). */
export const secAfterPlayedStart = (hour: number): number => ((hour - DAY_START_HOUR + 24) % 24) * 3600;

/** Ticks after the played day's start at which a wall-clock hour falls. */
export const tickOfPlayedHour = (hour: number): number => Math.round(secAfterPlayedStart(hour) / TICK_SEC);

/** Seconds after a played day's 06:00 start → `HH:MM`, with `+1` after midnight (a batch deadline). */
export function instanceClock(secAfterStart: number): string {
  const s = Math.round(secAfterStart + DAY_START_HOUR * 3600) % DAY_SEC;
  const dayOffset = secAfterStart >= DAY_SEC - DAY_START_HOUR * 3600 ? '+1' : '';
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}${dayOffset}`;
}

/** `D2 10:40` or `D2 Tue 10:40` (formatClock's day and time) → tick; the small hours belong to the played day before. */
export function tickOfClock(text: string): number | null {
  const m = /^D(\d+)\s+(?:[A-Za-z]{3}\s+)?(\d{1,2}):(\d{2})(?::\d{2})?$/i.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]) - 1, hh = Number(m[2]), mm = Number(m[3]);
  if (day < 0 || hh > 23 || mm > 59) return null;
  const sec = ((hh - DAY_START_HOUR + 24) % 24) * 3600 + mm * 60;
  return day * TICKS_PER_DAY + Math.floor(sec / TICK_SEC);
}
