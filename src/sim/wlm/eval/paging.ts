// Paging delay per slice: storage-critical periods keep their frames by taking
// them from the less important work.

import { STORAGE_STEAL_MAX_FRAC } from '../../../content/wlm/tuning';
import type { SliceSpec } from './types';

/** Per-slice paging delay fraction. Storage-critical periods page nothing; the paging they avoid moves to the
 * unprotected periods in proportion to demand × steal weight, so the image's total stays the same (Storage
 * Critical keeps frames by taking them from less important work, WLM Planning p.119). APPROX: activity
 * (CP + zIIP demand) stands in for frames held. */
export function slicePagingFrac(
  slices: readonly SliceSpec[],
  pagingFrac: number,
  storageCritical: ReadonlySet<string> | undefined,
  weightOf: Readonly<Record<string, number>> | undefined,
): number[] {
  const n = slices.length;
  const out = new Array<number>(n).fill(pagingFrac);
  if (!storageCritical || storageCritical.size === 0) return out;
  let keptAct = 0;
  let stealDen = 0;
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const act = s.cpEngines + s.ziipEngines;
    if (storageCritical.has(s.scKey)) keptAct += act;
    else stealDen += act * (weightOf?.[s.scKey] ?? 1);
  }
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    if (storageCritical.has(s.scKey)) out[i] = 0;
    else if (stealDen > 0) {
      const extra = (pagingFrac * keptAct * (weightOf?.[s.scKey] ?? 1)) / stealDen;
      out[i] = Math.min(Math.max(pagingFrac, STORAGE_STEAL_MAX_FRAC), pagingFrac + extra);
    }
  }
  return out;
}
