// Performance index and response-time distribution buckets (SG24-7621 §3.10–3.11).

import { lognormCdf } from '../core/math';
import type { Goal, PeriodDef } from './types';

/** Upper bounds of the 14 RMF/WLM buckets as multiples of the goal; the last is open. */
export const BUCKET_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 2.0, 4.0, Infinity] as const;
export const BUCKETS = BUCKET_BOUNDS.length;
export const DISCRETIONARY_PI = 0.81;
export const PI_MIN_PERCENTILE = 0.5;
export const PI_MAX_PERCENTILE = 4.0;

export const emptyBuckets = (): number[] => new Array<number>(BUCKETS).fill(0);

/** Add `count` completions with log-normal response times into goal-relative buckets. */
export function addToBuckets(
  buckets: number[],
  goalRtSec: number,
  count: number,
  meanRtSec: number,
  sigma: number,
): void {
  if (count <= 0) return;
  let prev = 0;
  for (let i = 0; i < BUCKETS; i++) {
    const bound = BUCKET_BOUNDS[i]!;
    const cdf = bound === Infinity ? 1 : lognormCdf(bound * goalRtSec, meanRtSec, sigma);
    buckets[i] = (buckets[i] ?? 0) + count * Math.max(0, cdf - prev);
    prev = cdf;
  }
}

/** Percentile PI: first bucket whose cumulative % reaches the goal percentile, ÷ goal. */
export function percentilePi(buckets: readonly number[], pct: number): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let cum = 0;
  for (let i = 0; i < BUCKETS; i++) {
    cum += buckets[i] ?? 0;
    if ((cum / total) * 100 >= pct - 1e-9) {
      const b = BUCKET_BOUNDS[i]!;
      return b === Infinity ? PI_MAX_PERCENTILE : Math.max(PI_MIN_PERCENTILE, b);
    }
  }
  return PI_MAX_PERCENTILE;
}

export interface PiInputs {
  completions: number;
  rtSumSec: number;
  buckets: readonly number[];
  usingSamples: number;
  delaySamples: number;
}

/** Velocity = using / (using + delay) × 100. */
export function velocityOf(usingSamples: number, delaySamples: number): number | null {
  const tot = usingSamples + delaySamples;
  return tot > 1e-12 ? (100 * usingSamples) / tot : null;
}

/** PI for a goal; null when there is no activity to judge. */
export function performanceIndex(goal: Goal, x: PiInputs): number | null {
  switch (goal.kind) {
    case 'DISC':
      return DISCRETIONARY_PI;
    case 'VEL': {
      const v = velocityOf(x.usingSamples, x.delaySamples);
      if (v === null) return null;
      return Math.min(goal.velocity / Math.max(v, 0.1), 99);
    }
    case 'AVG':
      return x.completions > 1e-9 ? x.rtSumSec / x.completions / goal.rtSec : null;
    case 'PCT':
      return percentilePi(x.buckets, goal.pct);
  }
}

/** Goal text as shown in RMF/WLM panels. */
export function goalText(p: PeriodDef): string {
  const g = p.goal;
  switch (g.kind) {
    case 'DISC':
      return 'DISCRETIONARY';
    case 'VEL':
      return `VELOCITY ${g.velocity} IMP ${p.importance}`;
    case 'AVG':
      return `AVG ${g.rtSec.toFixed(3)}s IMP ${p.importance}`;
    case 'PCT':
      return `${g.pct}% < ${g.rtSec.toFixed(3)}s IMP ${p.importance}`;
  }
}
