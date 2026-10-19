// Arrival-rate model: λ(t) = peak × shape(hour) × weekly × calendar × growth × noise.

import type { ClockInfo } from '../core/clock';
import type { ArrivalShape, WorkloadDef } from './types';

function bump(hour: number, peakHour: number, width: number): number {
  // Wrap around midnight so evening peaks can spill into the next morning.
  let d = Math.abs(hour - peakHour);
  d = Math.min(d, 24 - d);
  return Math.exp(-(d * d) / (2 * width * width));
}

export function shapeAt(shape: ArrivalShape, hour: number): number {
  let raw = 0;
  for (const p of shape.peaks) raw += p.height * bump(hour, p.hour, p.widthHours);
  return shape.floor + (1 - shape.floor) * Math.min(1, raw);
}

export function calendarMultiplier(shape: ArrivalShape, clock: ClockInfo): number {
  let m = shape.weekly[clock.dayOfWeek] ?? 1;
  if (clock.dayOfMonth === 1 || clock.dayOfMonth === 15) m *= shape.payday;
  if (clock.dayOfMonth >= 29) m *= shape.monthEnd;
  return m;
}

export function growthMultiplier(w: WorkloadDef, playedDay: number): number {
  return Math.pow(1 + w.growthPerDay, playedDay);
}

/** Deterministic part of λ (no noise or events). */
export function baseRate(w: WorkloadDef, clock: ClockInfo): number {
  return (
    w.peakRatePerSec *
    shapeAt(w.shape, clock.hourOfDay) *
    calendarMultiplier(w.shape, clock) *
    growthMultiplier(w, clock.day)
  );
}

/** Advance AR(1) log-noise one tick; returns the new noise state. */
export function stepNoise(prev: number, w: WorkloadDef, standardNormal: number): number {
  const phi = w.noisePhi;
  return phi * prev + w.noiseSigma * Math.sqrt(1 - phi * phi) * standardNormal;
}
