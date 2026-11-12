// Dispatch stage: build the dispatch demands (promotion and resource-group minimums
// split out), run the dispatcher, then split each period's grant among its slices.

import { DP, dispatch, shareByUnits, type DispatchDemand, type DispatchResult } from '../../zos/dispatcher';
import type { LparEvalInput, PreparedLpar } from './types';

/** Above every goal-managed period, below SYSTEM/SYSSTC and blocked-workload promotion. */
const RG_MIN_DP = DP.RG_MINIMUM;
/** Discretionary work gets its minimum only "if that action does not cause other work to miss its goal" (WLM
 * Planning p.59): above other discretionary work, below every goal-managed period. APPROX: it is served from
 * capacity no goal period wants, not only from goal periods that are meeting their goals. */
const RG_MIN_DISC_DP = DP.MANAGED_MIN - 1;

export interface LparGrants {
  dres: DispatchResult[];
  extraById: Record<string, DispatchResult>;
  anyPromo: boolean;
  minOf: LparEvalInput['minOf'];
  cpG: number[];
  ziG: number[];
  iipcpG: number[];
  cpUnmetS: number[];
  ziUnmetS: number[];
  /** CP demand that overflowed a resource group cap (slice indices), when one applies. */
  overflowCut: number[] | undefined;
}

export function grantDispatch(input: LparEvalInput, prepared: PreparedLpar, runDp: readonly number[]): LparGrants {
  const { slices } = input;
  const n = slices.length;
  const { sliceCp, sliceZi, aggCp, aggZi, aggOverflow, sliceUnits, aggUnits, aggSlices, order, dispatchIds, cpShares } = prepared;

  const demands: DispatchDemand[] = order.map((_, a) => ({
    id: dispatchIds[a]!,
    dp: runDp[a]!,
    cpEngines: aggCp[a]!,
    ziipEngines: aggZi[a]!,
    ziipMayOverflow: aggOverflow[a]!,
    units: aggUnits[a],
  }));

  // Blocked workload support: ready work that got no CPU for BLWLINTHD (default 20 s) is promoted; BLWLTRPCT
  // (default 0.5%) bounds the promoted capacity (MVS Init & Tuning Ref, IEAOPTxx). APPROX: real promotion gives
  // each promoted unit a fixed slice and BLWLTRPCT limits how many; here the share is split among them.
  const anyPromo = input.promoted !== undefined && input.promoted.size > 0;
  if (anyPromo) {
    const share = (input.promotionShareFrac ?? 0.005) * input.cpCapacityEngines;
    const promotedKeys = new Set(order.filter((k) => input.promoted!.has(k)));
    const per = promotedKeys.size > 0 ? share / promotedKeys.size : 0;
    for (let a = 0; a < order.length; a++) {
      if (!promotedKeys.has(order[a]!)) continue;
      const d = demands[a]!;
      const lift = Math.min(per * (cpShares?.[a] ?? 1), d.cpEngines);
      if (lift > 0) {
        d.cpEngines -= lift;
        demands.push({ id: `${d.id}~promo`, dp: DP.PROMOTED, cpEngines: lift, ziipEngines: 0, ziipMayOverflow: false });
      }
    }
  }

  // Resource group minimum: while the group misses goals, WLM guarantees it up to the minimum
  // even at the expense of more important work (SG24-7621 §4.17; MVS Planning: WLM, ch. 7 "Minimum").
  const minOf = input.minOf;
  if (minOf) {
    for (let a = 0; a < order.length; a++) {
      const d = demands[a]!;
      const m = (minOf[order[a]!] ?? 0) * (cpShares?.[a] ?? 1);
      if (!m) continue;
      const lift = Math.min(m, d.cpEngines);
      if (lift > 0) {
        d.cpEngines -= lift;
        demands.push({ id: `${d.id}~rgmin`, dp: input.discMin?.has(order[a]!) ? RG_MIN_DISC_DP : RG_MIN_DP, cpEngines: lift, ziipEngines: 0, ziipMayOverflow: false });
      }
    }
  }

  const dres = dispatch({
    cpCapacityEngines: input.cpCapacityEngines,
    cpAllocatedEngines: input.cpAllocatedEngines,
    cpServers: input.cpServers,
    ziipCapacityEngines: input.ziipCapacityEngines,
    ziipAllocatedEngines: input.ziipAllocatedEngines,
    ziipServers: input.ziipServers,
    cpPrsmDelayFrac: input.cpPrsmDelayFrac,
    demands,
  });
  // Results for the periods themselves line up with `order`; promoted/minimum shares follow.
  const extraById: Record<string, DispatchResult> = {};
  for (let j = order.length; j < dres.length; j++) extraById[dres[j]!.id] = dres[j]!;

  // Each slice's share of its period's grant.
  const cpG = new Array<number>(n);
  const ziG = new Array<number>(n);
  const iipcpG = new Array<number>(n);
  const cpUnmetS = new Array<number>(n);
  const ziUnmetS = new Array<number>(n);

  // Each period's grant split among its slices: by demand, or by ready units when the period counts them.
  for (let a = 0; a < order.length; a++) {
    const idx = aggSlices[a]!;
    if (idx.length === 0) continue;
    const r = dres[a]!;
    const own = order[a] === slices[idx[0]!]!.scKey;
    const promo = anyPromo && own ? extraById[`${dispatchIds[a]}~promo`] : undefined;
    const rgmin = minOf && own ? extraById[`${dispatchIds[a]}~rgmin`] : undefined;
    const cpGot = r.cpGranted + (promo?.cpGranted ?? 0) + (rgmin?.cpGranted ?? 0);
    const cpMiss = r.cpUnmet + (promo?.cpUnmet ?? 0) + (rgmin?.cpUnmet ?? 0);
    const totCp = aggCp[a]!;
    const totZi = aggZi[a]!;
    if (cpGot >= totCp && r.ziipGranted >= totZi) {
      for (const i of idx) {
        cpG[i] = sliceCp[i]!;
        ziG[i] = sliceZi[i]!;
        iipcpG[i] = 0;
        cpUnmetS[i] = 0;
        ziUnmetS[i] = 0;
      }
      continue;
    }
    if (aggUnits[a] === undefined || idx.length === 1) {
      for (const i of idx) {
        const fc = totCp > 0 ? sliceCp[i]! / totCp : 0;
        const fz = totZi > 0 ? sliceZi[i]! / totZi : 0;
        cpG[i] = cpGot * fc;
        ziG[i] = r.ziipGranted * fz;
        iipcpG[i] = r.iipcpGranted * fz;
        cpUnmetS[i] = cpMiss * fc;
        ziUnmetS[i] = r.ziipUnmet * fz;
      }
      continue;
    }
    shareByUnits(Math.min(cpGot, totCp), idx, sliceCp, sliceUnits, cpG);
    shareByUnits(Math.min(r.ziipGranted, totZi), idx, sliceZi, sliceUnits, ziG);
    let cpShort = 0;
    let ziShort = 0;
    for (const i of idx) {
      cpShort += Math.max(0, sliceCp[i]! - cpG[i]!);
      ziShort += Math.max(0, sliceZi[i]! - ziG[i]!);
    }
    for (const i of idx) {
      const fc = cpShort > 0 ? Math.max(0, sliceCp[i]! - cpG[i]!) / cpShort : 0;
      const fz = ziShort > 0 ? Math.max(0, sliceZi[i]! - ziG[i]!) / ziShort : 0;
      cpUnmetS[i] = cpMiss * fc;
      iipcpG[i] = r.iipcpGranted * fz;
      ziUnmetS[i] = r.ziipUnmet * fz;
    }
  }

  // Eligible work that overflows from a configured zIIP still consumes the group's CP budget.
  // APPROX: unused overflow grants wait until the next tick instead of rerunning shared-pool allocation.
  // APPROX: for a transaction hosted partly outside the group, capOf includes that share's CP demand
  // but not its eligible overflow; the shared slice can therefore over-restrict the outside share.
  const overflowCut = input.capOf && !(input.eligibleOnCp ?? input.ziipServers <= 0) ? slices.map((s, i) => {
    const before = iipcpG[i]!;
    iipcpG[i] = Math.min(before, Math.max(0, input.capOf!(s) - cpG[i]!));
    return before - iipcpG[i]!;
  }) : undefined;

  return { dres, extraById, anyPromo, minOf, cpG, ziG, iipcpG, cpUnmetS, ziUnmetS, overflowCut };
}
