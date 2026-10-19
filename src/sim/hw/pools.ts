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

/** Resolve PR/SM for every LPAR on one CPC. Returns runtime keyed by `${lparId}:${pool}`. */
export function resolveCpc(
  cpc: CpcConfig,
  lpars: readonly LparConfig[],
  demands: readonly PoolDemand[],
): Record<string, LparPoolRuntime> {
  const out: Record<string, LparPoolRuntime> = {};
  const demandIdx: Record<string, PoolDemand> = {};
  for (const d of demands) demandIdx[`${d.lparId}:${d.pool}`] = d;
  const demandOf = (lparId: string, pool: PoolType) => demandIdx[`${lparId}:${pool}`];

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

    for (const m of dedicated) {
      const d = demandOf(m.lpar.id, pool);
      const demand = Math.min(d?.demandEngines ?? 0, m.pc.logical);
      out[`${m.lpar.id}:${pool}`] = {
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
      };
    }

    if (shared.length === 0) continue;
    const totalLogical = shared.reduce((a, m) => a + m.pc.logical, 0);
    const ltoP = logicalToPhysical(totalLogical, physicalShared);
    const usablePhysical = Math.max(0, physicalShared - physicalOverheadEngines(ltoP, physicalShared));

    const baseClaims: PoolClaim[] = shared.map((m) => ({
      weight: m.pc.weight,
      logical: m.pc.logical,
      demandEngines: 0,
      capEngines: Infinity,
    }));
    const ent = entitlements(baseClaims, physicalShared);
    const claims: PoolClaim[] = shared.map((m, i) => {
      const d = demandOf(m.lpar.id, pool);
      let cap = d?.softCapEngines ?? Infinity;
      if (m.pc.absoluteCapEngines != null) cap = Math.min(cap, m.pc.absoluteCapEngines);
      if (m.pc.initialCapping) cap = Math.min(cap, ent[i] ?? 0);
      return { ...baseClaims[i]!, demandEngines: d?.demandEngines ?? 0, capEngines: cap };
    });
    const alloc = allocatePoolDetailed(claims, usablePhysical);
    const delivered = alloc.delivered;
    const busyFrac = physicalShared > 0 ? delivered.reduce((a, b) => a + b, 0) / physicalShared : 0;

    shared.forEach((m, i) => {
      const e = ent[i] ?? 0;
      const del = delivered[i] ?? 0;
      const claim = claims[i]!;
      const pol = m.lpar.hiperDispatch ? polarity(e, m.pc.logical) : { vh: 0, vm: 0, vl: 0 };
      const effRes = polarityEfficiency(del, pol, m.lpar.hiperDispatch);
      const ovh = lparOverheadFrac(ltoP, effRes.unparkedVl);
      const avail = alloc.available[i] ?? del;
      const availEff = polarityEfficiency(avail, pol, m.lpar.hiperDispatch).effectiveEngines * (1 - ovh);
      const uncappedWant = Math.min(claim.demandEngines, claim.logical);
      const cappedFrac =
        uncappedWant > 1e-9 && claim.capEngines < uncappedWant
          ? clamp((uncappedWant - Math.max(del, 0)) / uncappedWant, 0, 1)
          : 0;
      out[`${m.lpar.id}:${pool}`] = {
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
      };
    });
  }
  return out;
}
