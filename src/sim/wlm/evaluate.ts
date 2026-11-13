// Per-LPAR evaluation for one tick: dispatch every slice at its service-class
// period's DP, then derive response times, dependency delays and WLM using/delay
// samples. Pure, so policy adjustment can re-run it to project the effect of a DP move.
// Stage bodies live in ./eval/ (prepare, grants, results, accounting, io, paging,
// types); this file orchestrates them and re-exports the public surface.

import type { LparEvalInput, LparEvalResult } from './eval/types';
import { baseKey, prepareLpar, SRV } from './eval/prepare';
import { grantDispatch } from './eval/grants';
import { healthByRole, sliceResults } from './eval/results';
import { periodTicks } from './eval/accounting';
import { iosqByPriority } from './eval/io';
import { slicePagingFrac } from './eval/paging';

export type {
  IoService,
  LparEvalInput,
  LparEvalResult,
  PreparedLpar,
  ReportClassTick,
  RtParts,
  ScpTick,
  SliceResult,
  SliceSpec,
} from './eval/types';
export { emptyScpTick, sliceSpec } from './eval/types';
export { backlogCpSec, dispatchableDemand, prepareLpar } from './eval/prepare';
export { slicePagingFrac } from './eval/paging';

export function evaluateLpar(input: LparEvalInput): LparEvalResult {
  const { slices } = input;
  const n = slices.length;
  const scpsOnly = input.scpsOnly === true;
  const bucketsFor = scpsOnly ? input.bucketsFor : undefined;
  const prepared = input.prepared ?? prepareLpar(input);
  const { sliceAgg, order } = prepared;
  const reg = input.regions;
  // Transaction-server regions and their transactions run at the server period's DP (holders.ts, I11): a served
  // class's own stored DP plays no part. Without one (REGION/BOTH), the highest served class's, as before.
  const txnDp = !reg ? 0 : reg.serverKey ? input.dpOf(reg.serverKey) : Math.max(...reg.keys.map((k) => input.dpOf(k)));
  const regionDp = reg ? (reg.mode === 'REGION' ? input.dpOf(reg.regionKey) : txnDp) : 0;
  // dpOf is pure: look each period up once. Reported DPs are the periods' own.
  const aggDp = order.map((k) => input.dpOf(baseKey(k)));
  const runDp = order.map((k, a) => (k.endsWith(SRV) ? txnDp : reg && reg.keys.includes(k) ? regionDp : aggDp[a]!));
  const sliceDp = new Array<number>(n);
  for (let i = 0; i < n; i++) sliceDp[i] = runDp[sliceAgg[i]!]!;

  const grants = grantDispatch(input, prepared, runDp);
  const health = healthByRole(input, prepared, grants);
  // I/O priority management NO "sets I/O priorities equal to dispatching priorities" (WLM Planning p.115), so
  // the IOSQ is DP-ordered either way. APPROX: YES (goal-based I/O priorities) is not modelled and also uses DP.
  const prio = iosqByPriority(slices, sliceDp, input.io);
  const pgBy = slicePagingFrac(slices, input.pagingFrac, input.storageCritical, input.pagingWeight);
  const results = sliceResults(input, prepared, grants, health, prio, pgBy);
  const { scps, rcs } = periodTicks(input, prepared, results, scpsOnly, bucketsFor, aggDp);
  return rcs.length > 0 ? { slices: results, scps, roleHealth: health.roleHealth, rcs } : { slices: results, scps, roleHealth: health.roleHealth };
}
