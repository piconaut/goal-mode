// Capacity planner (tool CAP_PLANNER): log-linear trend over recent daily peaks, projected forward
// with a prediction interval that widens with horizon. It sees only measured history, never the
// hidden growth rates or tomorrow's events.

import { PLANNER } from '../content/planner';
import { clockAt, instanceClock } from '../sim/core/clock';
import { TICKS_PER_DAY } from '../sim/core/units';
import type { CapacityDay, RunState } from './types';

export interface ForecastPoint {
  day: number;
  mid: number;
  lo: number;
  hi: number;
}

export interface Forecast {
  id: string;
  title: string;
  unit: string;
  history: { day: number; value: number }[];
  points: ForecastPoint[];
  limit: number | null;
  limitLabel: string | null;
  /** First day the central forecast reaches the limit, and the first day the upper band does. */
  crossDay: number | null;
  riskDay: number | null;
  /** Daily growth of the fitted trend (fraction). */
  growthPerDay: number;
  /** Measured days the fit skipped (weekends), which stay on the chart. */
  skippedWeekends?: number;
  /** Days the installed capacity changed on, marked beside the chart. */
  capacityChanges?: { day: number; from: number; to: number }[];
}

export interface ForecastOptions {
  /** Days left out of the fit while their measured points stay on the chart: weekends, when quiet for reasons the
   *  trend should not absorb (PT-16). */
  weekend?: (day: number) => boolean;
}

/** Fit log(value) = a + b·day by least squares and project `horizon` days past the last point. */
export function forecastSeries(id: string, title: string, unit: string, history: { day: number; value: number }[], limit: number | null, limitLabel: string | null, cap = Infinity, opts: ForecastOptions = {}): Forecast | null {
  const shown = history.filter((p) => Number.isFinite(p.value) && p.value > 0).slice(-PLANNER.windowDays);
  if (shown.length < PLANNER.minDays) return null;
  const weekdays = opts.weekend ? shown.filter((p) => !opts.weekend!(p.day)) : shown;
  // Too few weekdays to fit (the first days of a run): fall back to every measured day.
  const fittedWeekdays = weekdays.length >= PLANNER.minDays;
  const h = fittedWeekdays ? weekdays : shown;
  const n = h.length;
  const xs = h.map((p) => p.day);
  const ys = h.map((p) => Math.log(p.value));
  const mx = xs.reduce((a, x) => a + x, 0) / n;
  const my = ys.reduce((a, y) => a + y, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const b = sxx > 0 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / sxx : 0;
  const a = my - b * mx;
  const sse = ys.reduce((acc, y, i) => acc + (y - (a + b * xs[i]!)) ** 2, 0);
  const sigma = Math.max(PLANNER.minSigma, n > 2 ? Math.sqrt(sse / (n - 2)) : PLANNER.minSigma);
  const last = shown[shown.length - 1]!.day;
  const points: ForecastPoint[] = [];
  for (let d = last + 1; d <= last + PLANNER.horizonDays; d++) {
    const se = sigma * Math.sqrt(1 + 1 / n + (sxx > 0 ? (d - mx) ** 2 / sxx : 0));
    const c = a + b * d;
    // Some measures saturate (a CPC cannot be more than 100% busy): the trend then means queueing.
    points.push({ day: d, mid: Math.min(cap, Math.exp(c)), lo: Math.min(cap, Math.exp(c - PLANNER.z * se)), hi: Math.min(cap, Math.exp(c + PLANNER.z * se)) });
  }
  const crossDay = limit === null ? null : (points.find((p) => p.mid >= limit)?.day ?? null);
  const riskDay = limit === null ? null : (points.find((p) => p.hi >= limit)?.day ?? null);
  return {
    id, title, unit, history: shown, points, limit, limitLabel, crossDay, riskDay, growthPerDay: Math.exp(b) - 1,
    ...(opts.weekend && fittedWeekdays && weekdays.length !== shown.length ? { skippedWeekends: shown.length - weekdays.length } : {}),
  };
}

/** The days the installed CP capacity changed on, from the recorded days. */
function capacityChanges(days: readonly CapacityDay[]): { day: number; from: number; to: number }[] {
  const out: { day: number; from: number; to: number }[] = [];
  for (let i = 1; i < days.length; i++) {
    const from = days[i - 1]!.installedMsu;
    const to = days[i]!.installedMsu;
    if (from !== undefined && to !== undefined && Math.abs(from - to) > 1e-9) out.push({ day: days[i]!.day, from, to });
  }
  return out;
}

export function capacityForecasts(run: RunState): Forecast[] {
  const days = run.capacityDays ?? [];
  const out: (Forecast | null)[] = [];
  // Installed CP MSU capacity: the last measured day's. Days recorded before PT-16 lack the MSU fields; their demand
  // is converted with this capacity so a save carried across the change keeps a usable chart.
  const installed = [...days].reverse().find((d) => d.installedMsu !== undefined)?.installedMsu ?? null;
  const demandMsu = (d: CapacityDay): number =>
    d.peakDemandMsu ?? (installed === null ? NaN : (d.peakCpcBusyPct / 100) * installed);
  const weekend = (day: number): boolean => clockAt(day * TICKS_PER_DAY).isWeekend;
  // Only the days the chart shows, so a change older than the window is not claimed as a mark on it.
  const changes = capacityChanges(days.slice(-PLANNER.windowDays));
  // The warning line is the busy share at which work starts to queue, read against the installed capacity.
  const warnMsu = installed === null ? null : (installed * PLANNER.cpcWarnPct) / 100;
  const cpc = forecastSeries(
    'cpc',
    'CPC online peak hour (08:00–18:00), MSU demand',
    'MSU',
    days.map((d) => ({ day: d.day, value: demandMsu(d) })),
    warnMsu,
    installed === null ? null : `${PLANNER.cpcWarnPct}% of installed ${Math.round(installed)} MSU`,
    installed ?? Infinity,
    { weekend },
  );
  out.push(cpc === null ? null : { ...cpc, ...(changes.length > 0 ? { capacityChanges: changes } : {}) });
  out.push(forecastSeries('r4haSum', 'Sum of R4HA peaks (drives MLC)', 'MSU', days.map((d) => ({ day: d.day, value: d.peakR4haSum })), null, null));
  const last = days.at(-1);
  for (const [lpar, dc] of Object.entries(last?.definedCapacity ?? {}).sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (dc === null) continue;
    out.push(forecastSeries(`r4ha:${lpar}`, `${lpar} R4HA peak vs defined capacity`, 'MSU', days.map((d) => ({ day: d.day, value: d.peakR4ha[lpar] ?? 0 })), dc, `DC ${dc} MSU`));
  }
  out.push(
    forecastSeries(
      'batch',
      'Critical batch end (hours after 06:00)',
      'h',
      days.filter((d) => d.criticalEndSec !== null).map((d) => ({ day: d.day, value: d.criticalEndSec! / 3600 })),
      run.batchDeadlineSec / 3600,
      `deadline ${instanceClock(run.batchDeadlineSec)}`,
    ),
  );
  return out.filter((f): f is Forecast => f !== null);
}
