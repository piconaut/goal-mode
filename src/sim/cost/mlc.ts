// Sub-capacity MLC accounting (SPEC §5.11.2): every hour, per product, sum the LPARs'
// R4HA (limited by their defined capacity, as SCRT does) and track the month's peak.
// Under Tailored Fit Pricing (SPEC §5.11.2) products are instead billed on consumed MSU-hours
// against a committed baseline: peaks and caps stop mattering, total consumption is everything.

import { tieredMonthlyCost, type ProductDef } from '../../content/pricing';
import { clockAt } from '../core/clock';

export interface ProductPeak {
  product: string;
  peakMsu: number;
  peakTick: number;
  /** Each LPAR's (DC-limited) R4HA in the peak hour: who drove the bill. */
  peakByLpar?: Record<string, number>;
}

/** Tailored Fit Pricing (Enterprise Consumption) terms, per product. */
export interface TfpTerms {
  /** Committed MSU-hours per 30-day month: paid whether used or not. */
  baselineMsuHours: Record<string, number>;
  pricePerMsuHour: Record<string, number>;
  /** Price of MSU-hours above the baseline, as a fraction of the baseline price. */
  overageFrac: number;
}

export interface TfpState {
  terms: TfpTerms;
  startTick: number;
  /** MSU-hours consumed this month since TFP started, per product. */
  consumed: Record<string, number>;
  /** Fraction of the current month billed under TFP (prorated baseline). */
  monthFrac: number;
}

export interface Bill {
  month: number;
  lines: { product: string; peakMsu: number; peakTick: number; cost: number; peakByLpar?: Record<string, number>; msuHours?: number; baselineMsuHours?: number }[];
  total: number;
}

export interface CostState {
  month: number;
  peaks: ProductPeak[];
  /** Hourly product MSU values for the current month (for the SCRT-style report). */
  hourly: Record<string, number[]>;
  bills: Bill[];
  /** Present once TFP is in force. */
  tfp?: TfpState;
  /** Fraction of the current month still billed sub-capacity (absent = 1). */
  subcapFrac?: number;
  /** Vendor list-price multiplier on sub-capacity MLC (absent = 1). TFP prices are contracted, so unaffected. */
  priceMult?: number;
}

export const newCost = (products: readonly ProductDef[]): CostState => ({
  month: 0,
  peaks: products.map((p) => ({ product: p.id, peakMsu: 0, peakTick: 0 })),
  hourly: Object.fromEntries(products.map((p) => [p.id, [] as number[]])),
  bills: [],
});

/** Capacity group terms for billing: SCRT never counts a group above its group capacity limit. */
export interface GroupLimit {
  limitMsu: number;
  members: readonly string[];
}

/** Each LPAR's billable MSU for the hour: R4HA limited by its defined capacity, then a capacity
 * group's members scaled down together so the group's sum does not exceed its limit.
 * APPROX: SCRT applies the group limit to the group's combined R4HA; splitting it pro rata
 * only matters when a product runs on part of a group. */
export function billableMsu(
  r4haByLpar: Readonly<Record<string, number>>,
  limitByLpar: Readonly<Record<string, number | null>>,
  groups: readonly GroupLimit[] = [],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(r4haByLpar).sort()) {
    const v = r4haByLpar[id] ?? 0;
    const lim = limitByLpar[id];
    out[id] = lim != null ? Math.min(v, lim) : v;
  }
  for (const g of groups) {
    const sum = g.members.reduce((a, id) => a + (out[id] ?? 0), 0);
    if (sum <= g.limitMsu || sum <= 0) continue;
    const f = g.limitMsu / sum;
    for (const id of g.members) if (out[id] !== undefined) out[id] *= f;
  }
  return out;
}

export function recordHour(
  cost: CostState,
  products: readonly ProductDef[],
  r4haByLpar: Readonly<Record<string, number>>,
  limitByLpar: Readonly<Record<string, number | null>>,
  tick: number,
  groups: readonly GroupLimit[] = [],
): CostState {
  const billable = billableMsu(r4haByLpar, limitByLpar, groups);
  const hourly: Record<string, number[]> = {};
  const peaks = cost.peaks.map((pk) => {
    const p = products.find((x) => x.id === pk.product)!;
    let msu = 0;
    const byLpar: Record<string, number> = {};
    for (const l of p.lpars) {
      byLpar[l] = billable[l] ?? 0;
      msu += byLpar[l]!;
    }
    hourly[pk.product] = [...(cost.hourly[pk.product] ?? []), msu];
    return msu > pk.peakMsu ? { ...pk, peakMsu: msu, peakTick: tick, peakByLpar: byLpar } : pk;
  });
  return { ...cost, peaks, hourly };
}

/** Baseline is committed (paid in full); MSU-hours above it are charged at the overage price. */
export function tfpCharge(msuHours: number, baselineMsuHours: number, price: number, overageFrac: number): number {
  return baselineMsuHours * price + Math.max(0, msuHours - baselineMsuHours) * price * overageFrac;
}

/** Fraction of the 30-day month elapsed at `tick`. */
export function monthElapsedFrac(tick: number): number {
  const c = clockAt(tick);
  return ((c.dayOfMonth - 1) * 24 + c.hourOfDay) / (30 * 24);
}

/** Switch billing to TFP from `tick`: the month so far stays sub-capacity, prorated. */
export function startTfp(cost: CostState, terms: TfpTerms, tick: number): CostState {
  const elapsed = monthElapsedFrac(tick);
  return {
    ...cost,
    subcapFrac: elapsed,
    tfp: { terms, startTick: tick, consumed: Object.fromEntries(cost.peaks.map((p) => [p.product, 0])), monthFrac: 1 - elapsed },
  };
}

/** Accrue one tick of consumption (CP MSU only: zIIP work isn't chargeable under TFP either). */
export function accrueTfp(cost: CostState, products: readonly ProductDef[], msuByLpar: Readonly<Record<string, number>>, tickSec: number): CostState {
  const tfp = cost.tfp;
  if (!tfp) return cost;
  const consumed: Record<string, number> = {};
  for (const p of products) {
    let msu = 0;
    for (const l of p.lpars) msu += msuByLpar[l] ?? 0;
    consumed[p.id] = (tfp.consumed[p.id] ?? 0) + (msu * tickSec) / 3600;
  }
  return { ...cost, tfp: { ...tfp, consumed } };
}

/** This month's bill lines so far (sub-capacity part prorated, TFP baseline prorated). */
export function billLines(cost: CostState, products: readonly ProductDef[]): Bill['lines'] {
  const subcap = (cost.subcapFrac ?? 1) * (cost.priceMult ?? 1);
  const tfp = cost.tfp;
  return cost.peaks.map((pk) => {
    const p = products.find((x) => x.id === pk.product)!;
    const peakCost = subcap > 0 ? subcap * tieredMonthlyCost(pk.peakMsu, p.priceFactor) : 0;
    if (!tfp) return { product: pk.product, peakMsu: pk.peakMsu, peakTick: pk.peakTick, cost: peakCost, peakByLpar: pk.peakByLpar };
    const used = tfp.consumed[p.id] ?? 0;
    const base = (tfp.terms.baselineMsuHours[p.id] ?? 0) * tfp.monthFrac;
    const cost_ = peakCost + tfpCharge(used, base, tfp.terms.pricePerMsuHour[p.id] ?? 0, tfp.terms.overageFrac);
    return { product: pk.product, peakMsu: pk.peakMsu, peakTick: pk.peakTick, cost: cost_, peakByLpar: pk.peakByLpar, msuHours: used, baselineMsuHours: base };
  });
}

export function closeMonth(cost: CostState, products: readonly ProductDef[]): CostState {
  const lines = billLines(cost, products);
  const bill: Bill = { month: cost.month, lines, total: lines.reduce((a, l) => a + l.cost, 0) };
  const next: CostState = {
    month: cost.month + 1,
    peaks: cost.peaks.map((pk) => ({ product: pk.product, peakMsu: 0, peakTick: 0 })),
    hourly: Object.fromEntries(Object.keys(cost.hourly).map((k) => [k, [] as number[]])),
    bills: [...cost.bills, bill],
  };
  if (cost.priceMult !== undefined) next.priceMult = cost.priceMult;
  if (cost.tfp) {
    next.subcapFrac = 0;
    next.tfp = { ...cost.tfp, consumed: Object.fromEntries(Object.keys(cost.tfp.consumed).map((k) => [k, 0])), monthFrac: 1 };
  }
  return next;
}

/** Bill-to-date: sub-capacity at the current peaks; under TFP, the prorated baseline plus overage so far. */
export function estimateMonth(cost: CostState, products: readonly ProductDef[]): number {
  return billLines(cost, products).reduce((a, l) => a + l.cost, 0);
}
