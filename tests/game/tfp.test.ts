import { MIDWEST_GAME } from "../../src/content/game-midwest";
import { TFP_OFFER, tieredMonthlyCost } from "../../src/content/pricing";
import { MIDWEST } from "../../src/content/scenarios";
import { codexDiscovered } from "../../src/game/codex";
import { financeView } from "../../src/game/finance";
import { advance, newRun, startDay } from "../../src/game/run";
import { decideTfp, quoteTfp, tfpAtDayEnd } from "../../src/game/tfp";
import type { RunState } from "../../src/game/types";
import { TICKS_PER_DAY } from "../../src/sim/core/units";
import {
  billLines,
  closeMonth,
  monthElapsedFrac,
  startTfp,
  tfpCharge,
  type CostState,
} from "../../src/sim/cost/mlc";

const content = { ...MIDWEST_GAME, events: [] };
const products = MIDWEST.products;

/** A run on the offer day with a month of synthetic hourly product MSU. */
function offerDayRun(): RunState {
  const r = newRun(MIDWEST, content, 7);
  const hourly = Object.fromEntries(
    products.map((p) => [
      p.id,
      Array.from({ length: 200 }, (_, i) => 300 + (i % 24) * 10),
    ]),
  );
  const peaks = products.map((p) => ({
    product: p.id,
    peakMsu: 530,
    peakTick: 100,
  }));
  return {
    ...r,
    day: TFP_OFFER.offerDay,
    phase: "REVIEW",
    sim: { ...r.sim, cost: { ...r.sim.cost, hourly, peaks } },
  };
}

describe("Tailored Fit Pricing", () => {
  it("charges the committed baseline plus discounted growth and ignores peaks", () => {
    expect(tfpCharge(500, 1000, 2, 0.5)).toBe(2000); // unused baseline is not refunded
    expect(tfpCharge(1500, 1000, 2, 0.5)).toBe(2500);
    const cost: CostState = {
      month: 0,
      peaks: [{ product: "ZOS", peakMsu: 600, peakTick: 0 }],
      hourly: { ZOS: [] },
      bills: [],
    };
    const terms = {
      baselineMsuHours: { ZOS: 100_000 },
      pricePerMsuHour: { ZOS: 3 },
      overageFrac: 0.5,
    };
    // Day 0 06:00 is the 3rd: 2.25 days of a 30-day month already billed sub-capacity.
    const t = startTfp(cost, terms, 0);
    expect(t.subcapFrac).toBeCloseTo(54 / 720);
    const zos = [products.find((p) => p.id === "ZOS")!];
    expect(billLines(t, zos)[0]!.cost).toBeCloseTo(
      (54 / 720) * tieredMonthlyCost(600, 1) + (666 / 720) * 100_000 * 3,
    );
    // Next month: TFP only, so a higher peak changes nothing.
    const next = closeMonth(
      { ...t, tfp: { ...t.tfp!, consumed: { ZOS: 120_000 } } },
      zos,
    );
    expect(next.bills[0]!.lines[0]!.msuHours).toBe(120_000);
    const peaky = {
      ...next,
      peaks: [{ product: "ZOS", peakMsu: 900, peakTick: 5 }],
    };
    expect(billLines(peaky, zos)[0]!.cost).toBeCloseTo(300_000);
  });

  it("quotes actual consumed MSU-hours per product and the run rate to the quote", () => {
    // The R4HA samples are a DC-limited 4-hour average, not consumption: quote from `usage` instead.
    const usage = Object.fromEntries(products.map((p) => [p.id, 160_000]));
    const tick = 10 * TICKS_PER_DAY;
    const tracked = 240; // 10 played days, the hours the usage covers
    const quoted = {
      ...offerDayRun(),
      sim: { ...offerDayRun().sim, tick, cost: { ...offerDayRun().sim.cost, usage, usageHours: tracked } },
    };
    const offer = quoteTfp(quoted, MIDWEST);
    expect(offer.quotedTick).toBe(tick);
    expect(monthElapsedFrac(tick)).toBeGreaterThan(tracked / 720); // the run's month began before tick 0
    for (const row of offer.products!) {
      expect(row.usageEstimated).toBeUndefined();
      expect(row.msuHoursUsed).toBe(160_000);
      expect(row.projectedMsuHours).toBeCloseTo((160_000 / tracked) * 720);
      const samples = quoted.sim.cost.hourly[row.id]!;
      const sampled = samples.reduce((a, x) => a + x, 0);
      expect(sampled).toBeLessThan(160_000); // the samples alone would understate the month
      const avg = sampled / samples.length;
      // The committed baseline is still the contract figure from the quote-time R4HA profile.
      expect(row.baselineMsuHours).toBeCloseTo(avg * 720 * (1 + TFP_OFFER.baselineGrowthFrac));
      expect(row.pricePerMsu).toBeCloseTo(row.subcapMonthly / row.peakMsu);
      expect(row.pricePerMsuHour).toBeCloseTo((row.subcapMonthly * (1 - TFP_OFFER.discountFrac)) / row.baselineMsuHours);
    }
    const proj = offer.projection!;
    expect(proj.msuHours).toBeCloseTo((160_000 / tracked) * 720 * products.length);
    expect(proj.overageMsuHours).toBeGreaterThan(0); // the consumption pace now really can exceed the baseline
    expect(proj.tfpMonthly).toBeGreaterThan(offer.baselineMonthly);
    expect(proj.subcapMonthly).toBeCloseTo(offer.subcapMonthly);
    expect(proj.savings).toBeCloseTo(offer.subcapMonthly - proj.tfpMonthly);
    expect(proj.savings).toBeLessThan(0);
    const shown = financeView({ ...quoted, tfpOffer: offer }, MIDWEST);
    expect(shown.offer?.products?.[0]?.msuHoursUsed).toBe(160_000);
    expect(shown.offer?.quotedAt).toMatch(/^day \d+ /);
  });

  it("labels usage as an R4HA estimate on a run saved before consumption tracking", () => {
    const r = offerDayRun();
    const legacy = { ...r, sim: { ...r.sim, cost: { ...r.sim.cost, usage: undefined, usageHours: undefined } } };
    expect(legacy.sim.cost.usage).toBeUndefined();
    const offer = quoteTfp(legacy, MIDWEST);
    for (const row of offer.products!) {
      expect(row.usageEstimated).toBe(true);
      expect(row.msuHoursUsed).toBe((legacy.sim.cost.hourly[row.id] ?? []).reduce((a, x) => a + x, 0));
    }
  });

  it("is offered once, signed only outside the live day, and expires", () => {
    let r = tfpAtDayEnd(offerDayRun(), MIDWEST);
    const o = r.tfpOffer!;
    expect(o.status).toBe("OFFERED");
    expect(o.baselineMonthly).toBeCloseTo(
      o.subcapMonthly * (1 - TFP_OFFER.discountFrac),
    );
    expect(r.inbox.at(-1)!.subject).toMatch(/Tailored Fit/);
    expect(codexDiscovered(r)).toContain("tfp");
    expect(decideTfp({ ...r, phase: "LIVE" }, true).ok).toBe(false);
    const signed = decideTfp({ ...r, phase: "BRIEFING" }, true);
    expect(signed.ok).toBe(true);
    expect(signed.run.pendingCommands.at(-1)!.kind).toBe("SET_PRICING");
    expect(signed.run.hoursLeft).toBeCloseTo(
      r.hoursLeft - TFP_OFFER.acceptHours,
    );
    expect(decideTfp(signed.run, true).ok).toBe(false);
    r = tfpAtDayEnd({ ...r, day: o.untilDay }, MIDWEST);
    expect(r.tfpOffer!.status).toBe("EXPIRED");
    expect(
      tfpAtDayEnd({ ...r, day: o.untilDay + 1 }, MIDWEST).inbox.length,
    ).toBe(r.inbox.length);
  });

  it("accrues CP MSU-hours each tick once signed", () => {
    let r = tfpAtDayEnd(offerDayRun(), MIDWEST);
    r = decideTfp({ ...r, phase: "BRIEFING" }, true).run;
    r = {
      ...r,
      day: 0,
      sim: { ...r.sim, cost: newRun(MIDWEST, content, 7).sim.cost },
    };
    r = advance(startDay(r, content), MIDWEST, content, 360);
    const tfp = r.sim.cost.tfp!;
    expect(tfp).toBeDefined();
    const msuNow = ["PROD1", "PROD2", "DEVT", "SYSP"].reduce(
      (a, id) => a + r.sim.lpars.find((l) => l.id === id)!.msuRate,
      0,
    );
    // One hour of consumption is roughly the current rate (within the hour's variation).
    expect(tfp.consumed.ZOS).toBeGreaterThan(0.5 * msuNow);
    expect(tfp.consumed.ZOS).toBeLessThan(1.5 * msuNow);
    expect(tfp.consumed.MQ).toBeLessThan(tfp.consumed.ZOS!);
    const f = financeView(r, MIDWEST);
    expect(f.pricing).toBe("TFP");
    expect(f.tfp![0]!.msuHours).toBeCloseTo(tfp.consumed.ZOS!);
    expect(f.scrt).toMatch(/CONSUMPTION/);
  }, 60_000);
});
