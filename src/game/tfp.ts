// Tailored Fit Pricing offer (SPEC §5.11.2): a mid-run strategic choice between sub-capacity billing
// (peak R4HA, capping and peak-shaving pay) and consumption billing (MSU-hours vs a committed baseline).

import { TFP_OFFER, tieredMonthlyCost } from "../content/pricing";
import type { Scenario } from "../sim/core/scenario";
import type { TfpTerms } from "../sim/cost/mlc";
import type { RunState } from "./types";

/** One product's offer row: what the peak costs now, what the baseline buys, and the month's pace. */
export interface TfpOfferProduct {
  id: string;
  name: string;
  peakMsu: number;
  /** Sub-capacity monthly charge at the quoted peak (before the baseline discount). */
  subcapMonthly: number;
  /** That charge per peak MSU. */
  pricePerMsu: number;
  baselineMsuHours: number;
  pricePerMsuHour: number;
  /** MSU-hours consumed so far this month. */
  msuHoursUsed: number;
  /** Month at the current hourly pace (mean of the samples so far × 720). */
  projectedMsuHours: number;
}

export interface TfpOffer {
  status: "OFFERED" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  /** Last played day it can be accepted on. */
  untilDay: number;
  terms: TfpTerms;
  /** What the baseline costs per month vs the sub-capacity bill at the peak when quoted. */
  baselineMonthly: number;
  subcapMonthly: number;
  /** Per-product terms and pace (absent on offers saved by an older build). */
  products?: TfpOfferProduct[];
  /** Run-rate projection at the sampled pace (absent on older offers). */
  projection?: { msuHours: number; baselineMsuHours: number; overageMsuHours: number; tfpMonthly: number; subcapMonthly: number; savings: number };
}

type Out = { run: RunState; ok: boolean; message: string };

export function quoteTfp(run: RunState, scenario: Scenario): TfpOffer {
  const cost = run.sim.cost;
  const terms: TfpTerms = {
    baselineMsuHours: {},
    pricePerMsuHour: {},
    overageFrac: TFP_OFFER.overageFrac,
  };
  let baselineMonthly = 0;
  let subcapMonthly = 0;
  let projectedMsuHours = 0;
  let baselineMsuHours = 0;
  let overageMsuHours = 0;
  const products: TfpOfferProduct[] = [];
  for (const pk of cost.peaks) {
    const p = scenario.products.find((x) => x.id === pk.product)!;
    const h = cost.hourly[pk.product] ?? [];
    // APPROX: the mean of hourly R4HA samples ≈ mean consumption over the month so far.
    const used = h.reduce((a, x) => a + x, 0);
    const avg = h.length > 0 ? used / h.length : pk.peakMsu;
    const projected = avg * 720;
    const base = avg * 720 * (1 + TFP_OFFER.baselineGrowthFrac);
    const subcap = tieredMonthlyCost(pk.peakMsu, p.priceFactor) * (cost.priceMult ?? 1);
    const monthly = subcap * (1 - TFP_OFFER.discountFrac);
    terms.baselineMsuHours[p.id] = base;
    const perHour = base > 0 ? monthly / base : 0;
    terms.pricePerMsuHour[p.id] = perHour;
    products.push({
      id: p.id,
      name: p.name,
      peakMsu: pk.peakMsu,
      subcapMonthly: subcap,
      pricePerMsu: pk.peakMsu > 0 ? subcap / pk.peakMsu : 0,
      baselineMsuHours: base,
      pricePerMsuHour: perHour,
      msuHoursUsed: used,
      projectedMsuHours: projected,
    });
    baselineMonthly += monthly;
    subcapMonthly += subcap;
    projectedMsuHours += projected;
    baselineMsuHours += base;
    overageMsuHours += Math.max(0, projected - base);
  }
  const overage = products.reduce((a, x) => a + Math.max(0, x.projectedMsuHours - x.baselineMsuHours) * x.pricePerMsuHour * TFP_OFFER.overageFrac, 0);
  const tfpMonthly = baselineMonthly + overage;
  return {
    status: "OFFERED",
    untilDay: run.day + TFP_OFFER.openDays,
    terms,
    baselineMonthly,
    subcapMonthly,
    products,
    projection: { msuHours: projectedMsuHours, baselineMsuHours, overageMsuHours, tfpMonthly, subcapMonthly, savings: subcapMonthly - tfpMonthly },
  };
}

export function offerTfp(run: RunState, scenario: Scenario): RunState {
  const offer = quoteTfp(run, scenario);
  const k$ = (x: number) => `$${Math.round(x / 1000).toLocaleString()}k`;
  const body =
    `IBM proposes Tailored Fit Pricing: pay for MSU-hours consumed instead of the monthly peak R4HA. ` +
    `Committed baseline ${k$(offer.baselineMonthly)}/month (your sub-capacity bill at this month's peak: ${k$(offer.subcapMonthly)}); ` +
    `growth above the baseline at ${Math.round(TFP_OFFER.overageFrac * 100)}% of the price. Capping and peak-shaving stop saving money; ` +
    `unused baseline is not refunded. Decide in the Finance tab, during a briefing, by day ${offer.untilDay + 1}.`;
  return {
    ...run,
    tfpOffer: offer,
    inbox: [
      ...run.inbox,
      {
        day: run.day,
        from: "IBM",
        subject: "Tailored Fit Pricing proposal",
        body,
      },
    ],
  };
}

/** Called at the end of each played day: make the offer once, and expire it. */
export function tfpAtDayEnd(run: RunState, scenario: Scenario): RunState {
  const o = run.tfpOffer;
  if (!o && run.day === TFP_OFFER.offerDay) return offerTfp(run, scenario);
  if (o?.status === "OFFERED" && run.day >= o.untilDay)
    return { ...run, tfpOffer: { ...o, status: "EXPIRED" } };
  return run;
}

export function decideTfp(run: RunState, accept: boolean): Out {
  const o = run.tfpOffer;
  if (!o || o.status !== "OFFERED")
    return { run, ok: false, message: "No open pricing offer" };
  if (run.phase === "LIVE")
    return {
      run,
      ok: false,
      message: "Contracts are signed during the briefing",
    };
  if (!accept)
    return {
      run: { ...run, tfpOffer: { ...o, status: "DECLINED" } },
      ok: true,
      message: "Staying on sub-capacity pricing",
    };
  if (run.hoursLeft < TFP_OFFER.acceptHours)
    return {
      run,
      ok: false,
      message: `Reviewing the contract takes ${TFP_OFFER.acceptHours}h`,
    };
  return {
    run: {
      ...run,
      hoursLeft: run.hoursLeft - TFP_OFFER.acceptHours,
      tfpOffer: { ...o, status: "ACCEPTED" },
      pendingCommands: [
        ...run.pendingCommands,
        { kind: "SET_PRICING", tfp: o.terms },
      ],
      log: [
        ...run.log,
        "Signed Tailored Fit Pricing: consumption billing from 06:00",
      ],
    },
    ok: true,
    message: "Tailored Fit Pricing signed: billing on MSU-hours from 06:00",
  };
}
