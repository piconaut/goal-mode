// Sub-capacity MLC accounting (SPEC §5.11.2): every hour, per product, sum the LPARs'
// R4HA (limited by their defined capacity, as SCRT does) and track the month's peak.

import { tieredMonthlyCost, type ProductDef } from '../../content/pricing';

export interface ProductPeak {
  product: string;
  peakMsu: number;
  peakTick: number;
  /** Each LPAR's (DC-limited) R4HA in the peak hour: who drove the bill. */
  peakByLpar?: Record<string, number>;
}

export interface Bill {
  month: number;
  lines: { product: string; peakMsu: number; peakTick: number; cost: number; peakByLpar?: Record<string, number> }[];
  total: number;
}

export interface CostState {
  month: number;
  peaks: ProductPeak[];
  /** Hourly product MSU values for the current month (for the SCRT-style report). */
  hourly: Record<string, number[]>;
  bills: Bill[];
}

export const newCost = (products: readonly ProductDef[]): CostState => ({
  month: 0,
  peaks: products.map((p) => ({ product: p.id, peakMsu: 0, peakTick: 0 })),
  hourly: Object.fromEntries(products.map((p) => [p.id, [] as number[]])),
  bills: [],
});

export function recordHour(
  cost: CostState,
  products: readonly ProductDef[],
  r4haByLpar: Readonly<Record<string, number>>,
  limitByLpar: Readonly<Record<string, number | null>>,
  tick: number,
): CostState {
  const hourly: Record<string, number[]> = {};
  const peaks = cost.peaks.map((pk) => {
    const p = products.find((x) => x.id === pk.product)!;
    let msu = 0;
    const byLpar: Record<string, number> = {};
    for (const l of p.lpars) {
      const v = r4haByLpar[l] ?? 0;
      const lim = limitByLpar[l];
      byLpar[l] = lim != null ? Math.min(v, lim) : v;
      msu += byLpar[l]!;
    }
    hourly[pk.product] = [...(cost.hourly[pk.product] ?? []), msu];
    return msu > pk.peakMsu ? { ...pk, peakMsu: msu, peakTick: tick, peakByLpar: byLpar } : pk;
  });
  return { ...cost, peaks, hourly };
}

export function closeMonth(cost: CostState, products: readonly ProductDef[]): CostState {
  const lines = cost.peaks.map((pk) => {
    const p = products.find((x) => x.id === pk.product)!;
    return { product: pk.product, peakMsu: pk.peakMsu, peakTick: pk.peakTick, cost: tieredMonthlyCost(pk.peakMsu, p.priceFactor), peakByLpar: pk.peakByLpar };
  });
  const bill: Bill = { month: cost.month, lines, total: lines.reduce((a, l) => a + l.cost, 0) };
  return {
    month: cost.month + 1,
    peaks: cost.peaks.map((pk) => ({ product: pk.product, peakMsu: 0, peakTick: 0 })),
    hourly: Object.fromEntries(Object.keys(cost.hourly).map((k) => [k, [] as number[]])),
    bills: [...cost.bills, bill],
  };
}

/** Bill-to-date estimate for the current month at the current peaks. */
export function estimateMonth(cost: CostState, products: readonly ProductDef[]): number {
  return cost.peaks.reduce((a, pk) => a + tieredMonthlyCost(pk.peakMsu, products.find((p) => p.id === pk.product)!.priceFactor), 0);
}
