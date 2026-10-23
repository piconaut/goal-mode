// Finance view: the month's software bill as SCRT would compute it, what drives it, and the targets.

import { opexBudgetFor } from './catalog';
import { formatClock } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import { billLines, estimateMonth } from '../sim/cost/mlc';
import { TFP_OFFER, tieredMonthlyCost } from '../content/pricing';
import type { TfpOffer } from './tfp';
import { renderScrt } from '../sim/measure/reports';
import type { RunState } from './types';

export interface FinanceView {
  month: number;
  monthToDate: number;
  opexBudget: number;
  opexSpent: number;
  /** CFO mandate: this month's bill must be ≤ this (null when no mandate or no previous bill). */
  cfoTarget: number | null;
  products: { id: string; name: string; lpars: string[]; peakMsu: number; peakAt: string | null; charge: number; peakByLpar: Record<string, number> }[];
  /** Hourly product MSU (sum of DC-limited R4HA) for the month so far; hour labels end at each sample. */
  hourly: { labels: string[]; series: Record<string, number[]> };
  /** Closed months, each with its SCRT-style report. */
  bills: { month: number; total: number; scrt: string }[];
  scrt: string;
  /** Billing model in force this month. */
  pricing: 'SUBCAP' | 'TFP';
  offer: (Omit<TfpOffer, 'terms'> & { overageFrac: number; acceptHours: number; canDecide: boolean }) | null;
  /** Under TFP: consumption so far vs the (prorated) baseline, per product. */
  tfp: { id: string; name: string; msuHours: number; baselineMsuHours: number; charge: number }[] | null;
}

const clock = (tick: number) => formatClock(tick).replace(/^D(\d+) /, 'day $1 ');

export function financeView(run: RunState, scenario: Scenario): FinanceView {
  const cost = run.sim.cost;
  const last = cost.bills.at(-1);
  const budget = opexBudgetFor(run.opexBudgetMonthly, run.perks);
  const lines = billLines(cost, scenario.products);
  const offer = run.tfpOffer ?? null;
  const n = Math.max(0, ...Object.values(cost.hourly).map((h) => h.length));
  // Hourly samples are taken on the hour; label each by the hour it ends, counting back from now.
  const nowHour = Math.floor(run.sim.tick / 360) * 360;
  const labels = Array.from({ length: n }, (_, i) => formatClock(nowHour - (n - 1 - i) * 360).slice(-11, -3));
  return {
    month: cost.month,
    monthToDate: estimateMonth(cost, scenario.products),
    opexBudget: budget,
    opexSpent: run.opexSpentThisMonth,
    cfoTarget: run.constraints.includes('CFO_MANDATE') && last ? 0.9 * last.total : null,
    products: cost.peaks.map((pk, i) => {
      const p = scenario.products.find((x) => x.id === pk.product)!;
      return { id: p.id, name: p.name, lpars: p.lpars, peakMsu: pk.peakMsu, peakAt: pk.peakMsu > 0 ? clock(pk.peakTick) : null, charge: cost.tfp ? (cost.subcapFrac ?? 0) * (cost.priceMult ?? 1) * tieredMonthlyCost(pk.peakMsu, p.priceFactor) : lines[i]!.cost, peakByLpar: pk.peakByLpar ?? {} };
    }),
    hourly: { labels, series: cost.hourly },
    bills: cost.bills.map((b) => ({ month: b.month, total: b.total, scrt: renderScrt(cost, scenario.products, b.month, clock) })),
    scrt: renderScrt(cost, scenario.products, 'current', clock),
    pricing: cost.tfp ? 'TFP' : 'SUBCAP',
    offer: offer
      ? { status: offer.status, untilDay: offer.untilDay, baselineMonthly: offer.baselineMonthly, subcapMonthly: offer.subcapMonthly, overageFrac: offer.terms.overageFrac, acceptHours: TFP_OFFER.acceptHours, canDecide: offer.status === 'OFFERED' && run.phase !== 'LIVE' }
      : null,
    tfp: cost.tfp
      ? lines.map((l) => ({ id: l.product, name: scenario.products.find((p) => p.id === l.product)!.name, msuHours: l.msuHours ?? 0, baselineMsuHours: l.baselineMsuHours ?? 0, charge: l.cost }))
      : null,
  };
}
