// Dynamic workload routing (SPEC §13.5): sysplex distributor SERVERWLM-style weights.

export type RoutingPolicy =
  | { method: 'STATIC' }
  // Sysplex Distributor DISTMETHOD. BASEWLM without PROCTYPE weighs systems by available CP capacity only.
  | { method: 'WLM'; distMethod: 'BASEWLM' | 'SERVERWLM' }
  // CPSM WLM goal routing. ABENDTHRESH/ABENDCRIT (abend compensation) are off by default; a quiesced
  // region gets no new work.
  | { method: 'CPSM_GOAL'; abendThreshFrac: number | null; abendCritFrac: number | null; quiesced: string[] };

export interface RegionStat {
  lparId: string;
  /** Mean response time of transactions that completed normally. */
  rtSec: number;
  /** Fraction of transactions that abended or were rejected. */
  failFrac: number;
}

export interface RouteCandidate {
  lparId: string;
  /** Capacity this work could displace: available engines minus use at higher or equal priority. */
  cpFreeEngines: number;
  ziipFreeEngines: number;
  /** Unused CP capacity, whatever its priority. */
  cpIdleEngines: number;
}

/**
 * Sysplex Distributor WLM weights. BASEWLM (the default) weighs each system by its available CP
 * capacity; zIIP counts only with PROCTYPE. SERVERWLM weighs each server by the capacity it could
 * displace at its importance, as a composite of each processor type weighted by the server's use of it
 * (IP Configuration Guide 3.1, PDF p.555–556). APPROX: IBM gives the inputs, not the weight arithmetic;
 * PROCTYPE and PROCXCOST are not modelled.
 */
export function wlmShares(
  cands: readonly RouteCandidate[],
  ziipFrac: number,
  distMethod: 'BASEWLM' | 'SERVERWLM',
  minShareFrac: number,
  quantum: number,
): Record<string, number> {
  if (cands.length === 0) return {};
  const raw = cands.map((c) => Math.max(0, distMethod === 'SERVERWLM' ? (1 - ziipFrac) * c.cpFreeEngines + ziipFrac * c.ziipFreeEngines : c.cpIdleEngines));
  const total = raw.reduce((a, b) => a + b, 0);
  const even = 1 / cands.length;
  const floor = Math.min(minShareFrac, even);
  const shares = raw.map((r) => (total > 0 ? floor + (1 - floor * cands.length) * (r / total) : even));
  // Whole steps of `quantum`; rounding leftovers go to the largest share so the split sums to 1.
  const steps = Math.round(1 / quantum);
  const q = shares.map((s) => Math.round(s * steps));
  const big = q.indexOf(Math.max(...q));
  q[big] = q[big]! + steps - q.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  cands.forEach((c, i) => (out[c.lparId] = q[i]! / steps));
  return out;
}

/**
 * CICSPlex SM goal routing: each interval, shares move toward the regions whose observed response is
 * best, settling where responses are even. Abends end fast, so they lower the observed response (storm
 * drain). Abend compensation (CICSPlex SM WLM: ABENDTHRESH doubles the region's load count, ABENDCRIT
 * avoids it) halves or removes a region with a high abend rate. APPROX: aggregate shares stand in for
 * per-transaction choices.
 */
export function cpsmGoalShares(
  prev: Record<string, number>,
  regions: readonly RegionStat[],
  policy: Extract<RoutingPolicy, { method: 'CPSM_GOAL' }>,
  abendRtSec: number,
  stepFrac: number,
  minShareFrac: number,
  quantum: number,
): Record<string, number> {
  const live = regions.filter((r) => !policy.quiesced.includes(r.lparId));
  if (live.length === 0) return wlmShares(regions.map((r) => ({ lparId: r.lparId, cpFreeEngines: 0, ziipFreeEngines: 0, cpIdleEngines: 0 })), 0, 'SERVERWLM', 0, quantum);
  const seen = live.map((r) => Math.max(1e-4, (1 - r.failFrac) * r.rtSec + r.failFrac * abendRtSec));
  const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
  const even = 1 / live.length;
  const target = live.map((r, i) => {
    let w = (prev[r.lparId] ?? even) * (mean / seen[i]!);
    if (policy.abendCritFrac !== null && r.failFrac >= policy.abendCritFrac) w = 0;
    else if (policy.abendThreshFrac !== null && r.failFrac >= policy.abendThreshFrac) w *= 0.5;
    return w;
  });
  const tTotal = target.reduce((a, b) => a + b, 0);
  // Move part way from the current split toward the target; free capacity stands in for weight.
  const cands = regions.map((r) => {
    const i = live.indexOf(r);
    const next = i < 0 ? 0 : (1 - stepFrac) * (prev[r.lparId] ?? even) + stepFrac * (tTotal > 0 ? target[i]! / tTotal : even);
    return { lparId: r.lparId, cpFreeEngines: next, ziipFreeEngines: 0, cpIdleEngines: 0 };
  });
  const out = wlmShares(cands, 0, 'SERVERWLM', 0, quantum);
  // Every live region keeps a trickle, ABENDCRIT ones included, so a recovered region shows up in its
  // abend rate (APPROX of CPSM's ageing abend probability); a quiesced region gets nothing.
  const floored = regions.map((r) => ({ lparId: r.lparId, cpFreeEngines: live.includes(r) ? Math.max(out[r.lparId]!, minShareFrac) : 0, ziipFreeEngines: 0, cpIdleEngines: 0 }));
  return wlmShares(floored, 0, 'SERVERWLM', 0, quantum);
}

export const sameShares = (a: Record<string, number> | undefined, b: Record<string, number>): boolean =>
  !!a && Object.keys(b).every((k) => Math.abs((a[k] ?? 0) - b[k]!) < 1e-9) && Object.keys(a).every((k) => k in b);
