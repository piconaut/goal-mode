import { BATCH_HINTS, BATCH_TIGHT_SLACK_SEC, MAX_HINTS, MECHANISM_HINTS, WLM_DISAGREE_HINTS } from '../content/hints';
import type { Incident } from './types';

export type HintLevel = keyof typeof MAX_HINTS;

export interface BatchOutcome {
  missed: boolean;
  /** Seconds after 06:00 the critical path ended; null if it never did. */
  criticalEndSec: number | null;
  deadlineSec: number;
}

const fmtSlack = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : `${Math.max(1, Math.round(sec / 60))} min`);

/** The Mentor perk raises the hint level one step (NONE → VAGUE → CLEAR). */
export function hintLevelFor(level: HintLevel, perks: readonly string[]): HintLevel {
  if (!perks.includes('MENTOR')) return level;
  return level === 'NONE' ? 'VAGUE' : 'CLEAR';
}

/**
 * Morning hints from yesterday's ground truth (SPEC §11.2): the same incident truth RCA scoring uses picks
 * the report to point at, but the text never names the mechanism, trigger or fix.
 */
export function morningHints(
  level: HintLevel,
  incidents: readonly Incident[],
  batch: BatchOutcome | null,
  /** Workloads whose service class met its goal in WLMGL all day despite the incident → their subsystem. */
  wlmHid: Readonly<Record<string, string>> = {},
): string[] {
  const max = MAX_HINTS[level];
  if (max === 0) return [];
  const key = level === 'CLEAR' ? 'clear' : 'vague';
  const out: string[] = [];

  let batchHint: string | null = null;
  if (batch) {
    if (batch.missed) batchHint = BATCH_HINTS.late[key];
    else if (batch.criticalEndSec !== null && batch.deadlineSec - batch.criticalEndSec < BATCH_TIGHT_SLACK_SEC)
      batchHint = BATCH_HINTS.tight[key].replace('{slack}', fmtSlack(batch.deadlineSec - batch.criticalEndSec));
  }
  if (batchHint && batch?.missed) out.push(batchHint);

  // Worst incident per workload, worst workloads first.
  const worst = new Map<string, Incident>();
  for (const i of incidents) {
    const cur = worst.get(i.workloadId);
    if (!cur || i.hours > cur.hours || (i.hours === cur.hours && i.worstAttainmentPct < cur.worstAttainmentPct)) worst.set(i.workloadId, i);
  }
  const ranked = [...worst.values()].sort((a, b) => b.hours - a.hours || a.worstAttainmentPct - b.worstAttainmentPct || (a.workloadId < b.workloadId ? -1 : 1));
  for (const i of ranked) {
    const sub = wlmHid[i.workloadId];
    const extra = sub ? (WLM_DISAGREE_HINTS[sub]?.[key] ?? '') : '';
    out.push(MECHANISM_HINTS[i.truth.mechanism][key].replace('{w}', i.workloadId) + extra);
  }

  if (batchHint && !batch?.missed) out.push(batchHint);
  return out.slice(0, max);
}
