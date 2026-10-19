// PR/SM model: weight entitlement, white-space redistribution, HiperDispatch
// polarity, efficiency and overhead. SPEC §5.3.

import { PRSM } from '../../content/hardware';
import { clamp } from '../core/units';

export interface PoolClaim {
  weight: number;
  logical: number;
  /** Physical engines' worth the image would consume if unconstrained. */
  demandEngines: number;
  /** Combined cap (absolute, initial, soft) in engines; Infinity if none. */
  capEngines: number;
}

/** Weight share of the shared pool, limited by the number of logical processors. */
export function entitlements(claims: readonly PoolClaim[], physicalEngines: number): number[] {
  const totalWeight = claims.reduce((a, c) => a + c.weight, 0);
  if (totalWeight <= 0) return claims.map(() => 0);
  return claims.map((c) => Math.min(c.logical, (c.weight / totalWeight) * physicalEngines));
}

/**
 * Deliver physical capacity: each image first gets demand up to its entitlement, then
 * unused capacity ("white space") is shared among images still wanting more, in
 * proportion to weight. Weights only matter under contention.
 */
export function allocatePool(claims: readonly PoolClaim[], physicalEngines: number): number[] {
  return allocatePoolDetailed(claims, physicalEngines).delivered;
}

export interface PoolAllocation {
  delivered: number[];
  /** Capacity each image could have used this tick: what it got plus a weight share of
   * the remaining white space, limited by logicals and caps. Drives queueing, not usage. */
  available: number[];
}

export function allocatePoolDetailed(claims: readonly PoolClaim[], physicalEngines: number): PoolAllocation {
  const ent = entitlements(claims, physicalEngines);
  const want = claims.map((c) => Math.max(0, Math.min(c.demandEngines, c.logical, c.capEngines)));
  const given = want.map((w, i) => Math.min(w, ent[i] ?? 0));
  let leftover = physicalEngines - given.reduce((a, b) => a + b, 0);
  for (let iter = 0; iter < 32 && leftover > 1e-9; iter++) {
    let hungryWeight = 0;
    for (let i = 0; i < claims.length; i++) {
      if ((want[i] ?? 0) - (given[i] ?? 0) > 1e-12) hungryWeight += Math.max(claims[i]!.weight, 1e-6);
    }
    if (hungryWeight <= 0) break;
    let distributed = 0;
    for (let i = 0; i < claims.length; i++) {
      const gap = (want[i] ?? 0) - (given[i] ?? 0);
      if (gap <= 1e-12) continue;
      const offer = (leftover * Math.max(claims[i]!.weight, 1e-6)) / hungryWeight;
      const take = Math.min(gap, offer);
      given[i] = (given[i] ?? 0) + take;
      distributed += take;
    }
    leftover -= distributed;
    if (distributed <= 1e-12) break;
  }
  const totalWeight = claims.reduce((a, c) => a + Math.max(c.weight, 1e-6), 0);
  const available = claims.map((c, i) => {
    const limit = Math.min(c.logical, c.capEngines);
    const extra = Math.max(0, leftover) * (Math.max(c.weight, 1e-6) / totalWeight);
    return Math.min(limit, Math.max(given[i] ?? 0, (ent[i] ?? 0)) + extra);
  });
  return { delivered: given, available };
}

export interface PolarityCounts {
  vh: number;
  vm: number;
  vl: number;
}

/**
 * HiperDispatch vertical polarity from entitlement E (in engines), per the published
 * rules in Cheryl Watson's Tuning Letter 2022 No.1 (J. Horne, "A Different Way to
 * Define LPAR Weights"). Remaining logicals are Vertical Low.
 */
export function polarity(entitlement: number, logical: number): PolarityCounts {
  if (logical <= 0) return { vh: 0, vm: 0, vl: 0 };
  const e = Math.max(0, entitlement);
  if (e >= logical - 1e-9) return { vh: logical, vm: 0, vl: 0 };
  let vh: number;
  let vm: number;
  if (e <= 1e-9) {
    vh = 0;
    vm = 0;
  } else if (e < 1.5) {
    vh = 0;
    vm = 2;
  } else if (e < 2) {
    vh = 1;
    vm = 1;
  } else {
    const n = Math.floor(e);
    const frac = e - n;
    if (frac < 0.5) {
      vh = n - 1;
      vm = 2;
    } else {
      vh = n;
      vm = 1;
    }
  }
  vh = Math.min(vh, logical);
  vm = Math.min(vm, logical - vh);
  return { vh, vm, vl: logical - vh - vm };
}

export interface EfficiencyResult {
  effectiveEngines: number;
  unparkedVl: number;
}

/**
 * Usable capacity after cache/affinity efficiency. Capacity is consumed on VH first,
 * then VM, then unparked VLs (which only run when there is white space).
 */
export function polarityEfficiency(
  deliveredEngines: number,
  pol: PolarityCounts,
  hiperDispatch: boolean,
): EfficiencyResult {
  const eff = PRSM.efficiency;
  if (!hiperDispatch) return { effectiveEngines: deliveredEngines * eff.horizontal, unparkedVl: 0 };
  const vhPart = Math.min(deliveredEngines, pol.vh);
  const vmPart = Math.min(Math.max(deliveredEngines - pol.vh, 0), pol.vm);
  const vlPart = Math.min(Math.max(deliveredEngines - pol.vh - pol.vm, 0), pol.vl);
  return {
    effectiveEngines: vhPart * eff.VH + vmPart * eff.VM + vlPart * eff.VL,
    unparkedVl: Math.min(pol.vl, Math.max(0, Math.ceil(vlPart - 1e-9))),
  };
}

/** Logical:physical ratio of a shared pool. */
export function logicalToPhysical(totalLogical: number, physicalEngines: number): number {
  return physicalEngines > 0 ? totalLogical / physicalEngines : 0;
}

/** LPAR-attributed PR/SM overhead fraction. Steepens above the 2:1 rule of thumb. */
export function lparOverheadFrac(ltoP: number, unparkedVl: number): number {
  const above1 = Math.max(0, Math.min(ltoP, 2) - 1);
  const above2 = Math.max(0, ltoP - 2);
  return (
    PRSM.baseOverheadFrac +
    PRSM.perLtoPAboveOne * above1 +
    PRSM.perLtoPAboveOne * PRSM.steepMultiplierAbove2to1 * above2 +
    PRSM.perUnparkedVl * unparkedVl
  );
}

/** Unattributed ("PHYSICAL") overhead in engines for a shared pool. */
export function physicalOverheadEngines(ltoP: number, physicalEngines: number): number {
  return PRSM.physicalPerLtoP * Math.max(0, ltoP - 1) * physicalEngines;
}

/**
 * Short-engine effect: fraction of ready time a logical CP waits for a physical engine.
 * Worse when entitlement per logical CP is small and the pool is busy. WLM cannot fix it.
 */
export function shortEngineDelayFrac(
  entitlement: number,
  logicalOnline: number,
  poolBusyFrac: number,
): number {
  if (logicalOnline <= 0) return 0;
  const perLogical = clamp(entitlement / logicalOnline, 0, 1);
  return PRSM.shortEngineK * (1 - perLogical) * clamp(poolBusyFrac, 0, 1);
}
