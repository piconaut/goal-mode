// Arrival-rate model: λ(t) = peak × shape(hour) × weekly × calendar × growth × noise.

import type { ClockInfo } from '../core/clock';
import type { Rng } from '../core/rng';
import type { ArrivalShape, BurstShape, WorkloadDef } from './types';

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

/** A random burst in progress: its multiplier and the seconds it has left (0 = none). */
export interface BurstState {
  mult: number;
  leftSec: number;
}

/**
 * Advance random bursts one tick. A burst starting during another keeps the larger height and the
 * longer remaining time. APPROX: flat-topped bursts; real spikes ramp, but a 10 s tick hides the ramp.
 */
export function stepBurst(prev: BurstState, b: BurstShape, tickSec: number, rng: Rng): BurstState {
  let { mult, leftSec } = prev.leftSec > tickSec ? { mult: prev.mult, leftSec: prev.leftSec - tickSec } : { mult: 1, leftSec: 0 };
  if (rng.float() < (b.ratePerHour * tickSec) / 3600) {
    const h = rng.range(b.heightMult[0], b.heightMult[1]);
    const d = rng.range(b.durationSec[0], b.durationSec[1]);
    mult = Math.max(mult, h);
    leftSec = Math.max(leftSec, d);
  }
  return { mult, leftSec };
}

/** Multiplier from fixed-time bursts at this moment: each decays linearly from its height to 1. */
export function scheduledBurstMult(b: BurstShape, clock: ClockInfo): number {
  let m = 1;
  for (const s of b.scheduled) {
    if (s.weekdaysOnly && clock.isWeekend) continue;
    const sinceSec = (clock.hourOfDay - s.hour) * 3600;
    if (sinceSec >= 0 && sinceSec < s.durationSec) m *= 1 + (s.heightMult - 1) * (1 - sinceSec / s.durationSec);
  }
  return m;
}
