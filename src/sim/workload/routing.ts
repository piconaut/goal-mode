// Dynamic workload routing (SPEC §13.5): sysplex distributor SERVERWLM-style weights.

export type RoutingPolicy = { method: 'STATIC' } | { method: 'WLM'; ziipAware: boolean };

export interface RouteCandidate {
  lparId: string;
  /** Capacity this work could displace: available engines minus use at higher or equal priority. */
  cpFreeEngines: number;
  ziipFreeEngines: number;
}

/**
 * WLM server weights from displaceable capacity at the work's priority. CP-only by default: zIIP
 * capacity counts only when the weights are zIIP-aware (SD PROCTYPE). APPROX: IBM documents the
 * PROCTYPE proportions, not the exact weight arithmetic.
 */
export function wlmShares(
  cands: readonly RouteCandidate[],
  ziipFrac: number,
  ziipAware: boolean,
  minShareFrac: number,
  quantum: number,
): Record<string, number> {
  if (cands.length === 0) return {};
  const raw = cands.map((c) => Math.max(0, ziipAware ? (1 - ziipFrac) * c.cpFreeEngines + ziipFrac * c.ziipFreeEngines : c.cpFreeEngines));
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

export const sameShares = (a: Record<string, number> | undefined, b: Record<string, number>): boolean =>
  !!a && Object.keys(b).every((k) => Math.abs((a[k] ?? 0) - b[k]!) < 1e-9) && Object.keys(a).every((k) => k in b);
