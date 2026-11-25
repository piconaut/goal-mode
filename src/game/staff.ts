// The team's own working conditions (PT-50): when the work it uses itself is slow, hands-on engineer-hours cost
// more. The goal is the scenario's content; this module only judges the closed hours against it.

import { INTERNAL_SLOW_HOURS_MULT, INTERNAL_SLOW_WINDOW_HOURS } from '../content/staff';
import { packOf } from '../content/packs';
import type { InternalGoal } from '../content/types';
import type { RunState, SmfHour } from './types';

export interface SlowInternal {
  /** The episode's first missed clock hour, `day:hourOfDay`: one complaint per episode, keyed by it. */
  key: string;
  workloadId: string;
  /** Consecutive missed clock hours, ending at the newest closed hour. */
  missedHours: number;
  /** The newest closed hour's average response, seconds. */
  rtSec: number;
  /** The content goal it missed, seconds. */
  goalSec: number;
  /** What a hands-on engineer-hour costs while this lasts. */
  hoursMult: number;
}

/** A closed hour's average response for the workload, or null when it completed no work. */
function hourAvg(h: SmfHour, workloadId: string): number | null {
  const w = h.workloads[workloadId];
  return w && w.completions > 0 ? w.rtSumSec / w.completions : null;
}

/** An absolute clock-hour index. The played day starts at 06:00, so 05 and the next day's 06 are adjacent. */
const absHour = (h: SmfHour): number => h.day * 24 + ((h.hourOfDay - 6 + 24) % 24);

/**
 * The slow-internal-work episode in force, if the newest closed clock hours each missed the content goal for
 * `INTERNAL_SLOW_WINDOW_HOURS` in a row. Derived from `smfHours`, never a stored flag, so an episode cannot
 * outlive the evidence for it (PT-50). An hour with no completions ends the window: there was no work to be slow.
 */
export function slowInternalOf(
  run: RunState,
  goal: InternalGoal | undefined = packOf(run.scenarioId).game.internalGoal,
): SlowInternal | null {
  if (!goal) return null;
  const hours = run.smfHours ?? [];
  const missed: SmfHour[] = [];
  for (let i = hours.length - 1; i >= 0; i--) {
    const h = hours[i]!;
    if (missed.length > 0 && absHour(h) + 1 !== absHour(missed[0]!)) break;
    const avg = hourAvg(h, goal.workloadId);
    if (avg === null || avg <= goal.avgRtSec) break;
    missed.unshift(h);
  }
  if (missed.length < INTERNAL_SLOW_WINDOW_HOURS) return null;
  const first = missed[0]!;
  const last = missed[missed.length - 1]!;
  return {
    key: `${first.day}:${first.hourOfDay}`,
    workloadId: goal.workloadId,
    missedHours: missed.length,
    rtSec: hourAvg(last, goal.workloadId)!,
    goalSec: goal.avgRtSec,
    hoursMult: INTERNAL_SLOW_HOURS_MULT,
  };
}

/** What a hands-on engineer-hour costs now: `INTERNAL_SLOW_HOURS_MULT` during an episode, otherwise 1. */
export const engineerHoursMult = (run: RunState): number => slowInternalOf(run)?.hoursMult ?? 1;
