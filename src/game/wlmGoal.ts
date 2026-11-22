// Draft goal helpers for the service-class editor: the string→goal parse, the inline field check and the
// "has this edited goal changed?" comparison. Pure, so the editor component only keeps the React state.
//
// The field check is deliberately not `wlmEdit.ts`'s `goalError`: that is the authoritative policy check (response
// time 1 ms to 24 h, IBM's range) run when the edit is applied, and it speaks in edit-result messages. This one
// guards the input fields before an edit is sent; its messages are the editor's inline hints.

import type { Goal } from '../sim/wlm/types';

/** The goal a draft period describes: a number typed as text, a percentile where the kind has one. */
export function goalOf(kind: Goal['kind'], val: string, pct: string): Goal {
  return kind === 'VEL' ? { kind, velocity: Number(val) } : kind === 'AVG' ? { kind, rtSec: Number(val) } : kind === 'PCT' ? { kind, rtSec: Number(val), pct: Number(pct) } : { kind: 'DISC' };
}

/** The editor's inline error for a draft goal, or null when it can be sent. */
export function goalDraftError(kind: Goal['kind'], val: number, pct: number): string | null {
  if (kind === 'DISC') return null;
  if (kind === 'VEL') return val >= 1 && val <= 99 ? null : 'Velocity is 1–99';
  if (!(val > 0)) return 'Response time must be > 0 s';
  if (kind === 'PCT' && !(pct >= 1 && pct <= 99)) return 'Percentile is 1–99';
  return null;
}

/** Whether two goals ask for the same thing (DISC always does). */
export function sameGoal(a: Goal, b: Goal): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'VEL' && b.kind === 'VEL') return a.velocity === b.velocity;
  if (a.kind === 'PCT' && b.kind === 'PCT') return a.rtSec === b.rtSec && a.pct === b.pct;
  if (a.kind === 'AVG' && b.kind === 'AVG') return a.rtSec === b.rtSec;
  return true;
}
