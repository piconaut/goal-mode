// Tailored Fit Pricing offer (SPEC §5.11.2): a mid-run strategic choice between sub-capacity billing
// (peak R4HA, capping and peak-shaving pay) and consumption billing (MSU-hours vs a committed baseline).

import { TFP_OFFER, tieredMonthlyCost } from "../content/pricing";
import type { Scenario } from "../sim/core/scenario";
import type { TfpTerms } from "../sim/cost/mlc";
import type { RunState } from "./types";

export interface TfpOffer {
  status: "OFFERED" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  /** Last played day it can be accepted on. */
  untilDay: number;
  terms: TfpTerms;
  /** What the baseline costs per month vs the sub-capacity bill at the peak when quoted. */
  baselineMonthly: number;
  subcapMonthly: number;
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
  for (const pk of cost.peaks) {
    const p = scenario.products.find((x) => x.id === pk.product)!;
    const h = cost.hourly[pk.product] ?? [];
    // APPROX: the mean of hourly R4HA samples ≈ mean consumption over the month so far.
    const avg =
      h.length > 0 ? h.reduce((a, x) => a + x, 0) / h.length : pk.peakMsu;
    const base = avg * 720 * (1 + TFP_OFFER.baselineGrowthFrac);
    const subcap = tieredMonthlyCost(pk.peakMsu, p.priceFactor);
    const monthly = subcap * (1 - TFP_OFFER.discountFrac);
    terms.baselineMsuHours[p.id] = base;
    terms.pricePerMsuHour[p.id] = base > 0 ? monthly / base : 0;
    baselineMonthly += monthly;
    subcapMonthly += subcap;
  }
  return {
    status: "OFFERED",
    untilDay: run.day + TFP_OFFER.openDays,
    terms,
    baselineMonthly,
    subcapMonthly,
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
