// Batch response-time goals: project a measured AVG/PCT PI through the change in execution velocity
// (docs/wlm-design.md §9.15). The projection uses only data WLM and RMF have: the completed jobs' queue and
// execution times and the period's using/delay samples. No per-job forecast of remaining work (RMF reports ended
// transactions only, RMF Report Analysis 3.1 p.148; IBM names the plots, SG24-6472 p.62, but no book gives the
// formula). APPROX: whole-life response times, mixed periods use all their samples, and the velocity floor carries
// RF-04's extreme into donor harm.

import { PCT_PROJECTION_SIGMA } from '../../content/wlm/tuning';
import type { ScpTick } from './eval/types';
import { projectedPercentilePi, VELOCITY_FLOOR, velocityOf } from './goals';
import { velDelay, velUsing, type ScpAcc } from './runtime';
import type { Goal } from './types';

/** Execution velocity of a period's measured samples, without queue delay: the queue is in Q̄ already and queued
 * WLM-initiator jobs add `delayQueue` to measured ticks but not to projections. */
function measuredVelocity(acc: ScpAcc): number | null {
  return velocityOf(
    velUsing(acc) - (acc.srvUsing ?? 0),
    velDelay(acc) - (acc.srvDelay ?? 0) - (acc.delayQueue ?? 0),
  );
}

/** Execution velocity of a projection's tick, on the same population: no server samples and no queue delay. */
function projectedVelocity(t: ScpTick): number | null {
  return velocityOf(
    t.usingCpu + t.usingZiip + t.usingIo - (t.usingIoNoVel ?? 0) - (t.srvUsing ?? 0),
    t.delayCpu + t.delayZiip + t.delayIo + t.delayStorage + t.delayCap - (t.delayIoNoVel ?? 0) - (t.srvDelay ?? 0),
  );
}

/**
 * PI' = PI_measured × (Q̄ + Ē × v_ref / v') / (Q̄ + Ē), the measured PI scaled by the projected change in execution
 * speed of the elapsed part (docs/wlm-design.md §9.15). A DP move changes only Ē: JES initiator wait does not
 * respond to dispatching priority. Null when a job has not completed in the window (no measured PI), when no job of
 * the period is running (no samples in the evaluation), or when there is no queue/execution split to scale.
 *
 * Percentile goals use the same factor on the percentile PI, with Q̄ and Ē from the means; buckets keep no
 * queue/execution split, so the percentile PI is the one projections already extrapolate past 4.0 from the mean.
 * The base call uses the current DPs' velocity, which keeps RECOVERING's meaning.
 */
export function projectBatchRtPi(goal: Goal, acc: ScpAcc, t: ScpTick): number | null {
  if (acc.rtQueueSumSec === undefined) return null;
  if (goal.kind !== 'AVG' && goal.kind !== 'PCT') return null;
  const completions = acc.completions;
  if (!(completions > 1e-9)) return null;
  const measuredPi = goal.kind === 'AVG'
    ? acc.rtSumSec / completions / goal.rtSec
    : projectedPercentilePi(acc.buckets, goal.pct, completions, acc.rtSumSec, goal.rtSec, PCT_PROJECTION_SIGMA);
  if (measuredPi === null) return null;
  const meanRt = acc.rtSumSec / completions;
  const queueMean = acc.rtQueueSumSec / completions;
  const execMean = meanRt - queueMean;
  const ref = measuredVelocity(acc);
  const projected = projectedVelocity(t);
  if (!(meanRt > 0) || execMean < 0 || ref === null || projected === null) return null;
  const vRef = Math.max(ref, VELOCITY_FLOOR);
  const vProjected = Math.max(projected, VELOCITY_FLOOR);
  return measuredPi * ((queueMean + (execMean * vRef) / vProjected) / meanRt);
}
