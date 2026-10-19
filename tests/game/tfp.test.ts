import { MIDWEST_GAME } from "../../src/content/game-midwest";
import { TFP_OFFER, tieredMonthlyCost } from "../../src/content/pricing";
import { MIDWEST } from "../../src/content/scenarios";
import { codexDiscovered } from "../../src/game/codex";
import { financeView } from "../../src/game/finance";
import { advance, newRun, startDay } from "../../src/game/run";
import { decideTfp, tfpAtDayEnd } from "../../src/game/tfp";
import type { RunState } from "../../src/game/types";
import {
  billLines,
  closeMonth,
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
