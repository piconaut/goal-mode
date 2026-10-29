// Per-CPC, per-pool PR/SM resolution for one tick.

import type { CpcConfig, LparConfig, LparPoolRuntime, PoolType } from '../core/types';
import { clamp } from '../core/units';
import {
  allocatePoolDetailed,
  entitlements,
  logicalToPhysical,
  lparOverheadFrac,
  physicalOverheadEngines,
  polarity,
  polarityEfficiency,
  shortEngineDelayFrac,
  type PoolClaim,
} from './prsm';

export const POOLS: readonly PoolType[] = ['CP', 'ZIIP', 'ICF'];

export interface PoolDemand {
  lparId: string;
  pool: PoolType;
  /** Physical engines' worth requested this tick. */
  demandEngines: number;
  /** Extra cap from soft capping (engines); Infinity if not capped. */
  softCapEngines: number;
}

// `${lparId}:${pool}` without building a new string every tick.
const poolKeys: Record<string, Partial<Record<PoolType, string>>> = {};
export const poolKey = (lparId: string, pool: PoolType): string => ((poolKeys[lparId] ??= {})[pool] ??= `${lparId}:${pool}`);

interface PoolPlan {
  pool: PoolType;
  dedicated: { lpar: LparConfig; pc: LparConfig['pools'][number] }[];
  shared: { lpar: LparConfig; pc: LparConfig['pools'][number] }[];
  physicalShared: number;
  ltoP: number;
  usablePhysical: number;
  baseClaims: PoolClaim[];
  ent: number[];
}

// Everything in resolveCpc that depends only on configuration, reused while the CPC and LPAR list are the
// same objects (config edits clone the config, so any change is a new array).
const planCache = new WeakMap<readonly LparConfig[], { cpc: CpcConfig; plans: PoolPlan[] }[]>();
function poolPlans(cpc: CpcConfig, lpars: readonly LparConfig[]): PoolPlan[] {
  let entries = planCache.get(lpars);
  if (!entries) planCache.set(lpars, (entries = []));
  for (const e of entries) if (e.cpc === cpc) return e.plans;
  const plans: PoolPlan[] = [];
  for (const pool of POOLS) {
    const members = lpars
      .filter((l) => l.cpcId === cpc.id)
      .flatMap((l) => {
        const pc = l.pools.find((p) => p.pool === pool);
        return pc && pc.logical > 0 ? [{ lpar: l, pc }] : [];
      });
    if (members.length === 0) continue;

    const dedicated = members.filter((m) => m.pc.dedicated);
    const shared = members.filter((m) => !m.pc.dedicated);
    const dedicatedEngines = dedicated.reduce((a, m) => a + m.pc.logical, 0);
    const physicalShared = Math.max(0, cpc.engines[pool] - dedicatedEngines);
    let ltoP = 0;
    let usablePhysical = 0;
    let baseClaims: PoolClaim[] = [];
    let ent: number[] = [];
    if (shared.length > 0) {
      const totalLogical = shared.reduce((a, m) => a + m.pc.logical, 0);
      ltoP = logicalToPhysical(totalLogical, physicalShared);
      usablePhysical = Math.max(0, physicalShared - physicalOverheadEngines(ltoP, physicalShared));
      baseClaims = shared.map((m) => ({
        weight: m.pc.weight,
        logical: m.pc.logical,
        demandEngines: 0,
        capEngines: Infinity,
      }));
      ent = entitlements(baseClaims, physicalShared);
    }
    plans.push({ pool, dedicated, shared, physicalShared, ltoP, usablePhysical, baseClaims, ent });
  }
  entries.push({ cpc, plans });
  return plans;
}

/** Resolve PR/SM for every LPAR on one CPC. Returns runtime keyed by `${lparId}:${pool}`. */
export function resolveCpc(
  cpc: CpcConfig,
  lpars: readonly LparConfig[],
  demands: readonly PoolDemand[],
): Record<string, LparPoolRuntime> {
  const out: Record<string, LparPoolRuntime> = {};
  const demandIdx: Record<string, PoolDemand> = {};
  for (const d of demands) demandIdx[poolKey(d.lparId, d.pool)] = d;
  const demandOf = (lparId: string, pool: PoolType) => demandIdx[poolKey(lparId, pool)];

  for (const plan of poolPlans(cpc, lpars)) {
    const { pool, dedicated, shared, physicalShared, ltoP, usablePhysical, baseClaims, ent } = plan;

    for (const m of dedicated) {
      const d = demandOf(m.lpar.id, pool);
      const demand = Math.min(d?.demandEngines ?? 0, m.pc.logical);
      out[poolKey(m.lpar.id, pool)] = {
        pool,
        entitlementEngines: m.pc.logical,
        demandEngines: demand,
        deliveredEngines: demand,
        effectiveEngines: demand * (1 - lparOverheadFrac(1, 0)),
        availableEngines: m.pc.logical,
        availableEffectiveEngines: m.pc.logical * (1 - lparOverheadFrac(1, 0)),
        vh: m.pc.logical,
        vm: 0,
        vl: 0,
        unparkedVl: 0,
        overheadFrac: lparOverheadFrac(1, 0),
        prsmDelayFrac: 0,
        cappedFrac: 0,
        softCappedFrac: 0,
      };
    }

    if (shared.length === 0) continue;
    const claims: PoolClaim[] = shared.map((m, i) => {
      const d = demandOf(m.lpar.id, pool);
      let cap = d?.softCapEngines ?? Infinity;
      if (m.pc.absoluteCapEngines != null) cap = Math.min(cap, m.pc.absoluteCapEngines);
      if (m.pc.initialCapping) cap = Math.min(cap, ent[i] ?? 0);
      return { ...baseClaims[i]!, demandEngines: d?.demandEngines ?? 0, capEngines: cap };
    });
    const alloc = allocatePoolDetailed(claims, usablePhysical);
    const delivered = alloc.delivered;
    // What each LPAR would get with no caps, so capping counts only what a binding cap removed and PR/SM
    // contention doesn't (RMF Report Analysis p.401).
    const uncapped = claims.some((c) => Number.isFinite(c.capEngines))
      ? allocatePoolDetailed(claims.map((c) => ({ ...c, capEngines: Infinity })), usablePhysical).delivered
      : delivered;
    const busyFrac = physicalShared > 0 ? delivered.reduce((a, b) => a + b, 0) / physicalShared : 0;

    shared.forEach((m, i) => {
      const e = ent[i] ?? 0;
      const del = delivered[i] ?? 0;
      const claim = claims[i]!;
      // A soft cap works through a phantom weight that cuts the LPAR's share to its defined capacity, and
      // polarity follows the reduced share (MVS Planning: WLM 3.1 p.46).
      const polEnt = Math.min(e, demandOf(m.lpar.id, pool)?.softCapEngines ?? Infinity);
      const pol = m.lpar.hiperDispatch ? polarity(polEnt, m.pc.logical) : { vh: 0, vm: 0, vl: 0 };
      const effRes = polarityEfficiency(del, pol, m.lpar.hiperDispatch);
      const ovh = lparOverheadFrac(ltoP, effRes.unparkedVl);
      const avail = alloc.available[i] ?? del;
      const availEff = polarityEfficiency(avail, pol, m.lpar.hiperDispatch).effectiveEngines * (1 - ovh);
      const uncappedWant = Math.min(claim.demandEngines, claim.logical);
      const binds = uncappedWant > 1e-9 && claim.capEngines < uncappedWant && del >= claim.capEngines - 1e-6;
      const cappedFrac = binds ? clamp(((uncapped[i] ?? del) - del) / uncappedWant, 0, 1) : 0;
      const softCap = demandOf(m.lpar.id, pool)?.softCapEngines ?? Infinity;
      const softCappedFrac = softCap <= claim.capEngines + 1e-9 ? cappedFrac : 0;
      out[poolKey(m.lpar.id, pool)] = {
        pool,
        entitlementEngines: e,
        demandEngines: claim.demandEngines,
        deliveredEngines: del,
        effectiveEngines: effRes.effectiveEngines * (1 - ovh),
        availableEngines: avail,
        availableEffectiveEngines: availEff,
        ...pol,
        unparkedVl: effRes.unparkedVl,
        overheadFrac: ovh,
        prsmDelayFrac: shortEngineDelayFrac(e, m.pc.logical, busyFrac),
        cappedFrac,
        softCappedFrac,
      };
    });
  }
  return out;
}
