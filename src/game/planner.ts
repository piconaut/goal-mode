// Capacity planner (tool CAP_PLANNER): log-linear trend over recent daily peaks, projected forward
// with a prediction interval that widens with horizon. It sees only measured history, never the
// hidden growth rates or tomorrow's events.

import { PLANNER } from '../content/planner';
import type { RunState } from './types';

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
}

/** Fit log(value) = a + b·day by least squares and project `horizon` days past the last point. */
export function forecastSeries(id: string, title: string, unit: string, history: { day: number; value: number }[], limit: number | null, limitLabel: string | null, cap = Infinity): Forecast | null {
  const h = history.filter((p) => p.value > 0).slice(-PLANNER.windowDays);
  if (h.length < PLANNER.minDays) return null;
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
  const last = xs[n - 1]!;
  const points: ForecastPoint[] = [];
  for (let d = last + 1; d <= last + PLANNER.horizonDays; d++) {
    const se = sigma * Math.sqrt(1 + 1 / n + (sxx > 0 ? (d - mx) ** 2 / sxx : 0));
    const c = a + b * d;
    // Some measures saturate (a CPC cannot be more than 100% busy): the trend then means queueing.
    points.push({ day: d, mid: Math.min(cap, Math.exp(c)), lo: Math.min(cap, Math.exp(c - PLANNER.z * se)), hi: Math.min(cap, Math.exp(c + PLANNER.z * se)) });
  }
  const crossDay = limit === null ? null : (points.find((p) => p.mid >= limit)?.day ?? null);
  const riskDay = limit === null ? null : (points.find((p) => p.hi >= limit)?.day ?? null);
  return { id, title, unit, history: h, points, limit, limitLabel, crossDay, riskDay, growthPerDay: Math.exp(b) - 1 };
}

export function capacityForecasts(run: RunState): Forecast[] {
  const days = run.capacityDays ?? [];
  const out: (Forecast | null)[] = [];
  out.push(forecastSeries('cpc', 'CPC busy, online peak hour (08:00–18:00)', '%', days.map((d) => ({ day: d.day, value: d.peakCpcBusyPct })), PLANNER.cpcWarnPct, `${PLANNER.cpcWarnPct}% busy`, 100));
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
      'deadline 06:00',
    ),
  );
  return out.filter((f): f is Forecast => f !== null);
}
