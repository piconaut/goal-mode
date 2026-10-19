// FICTIONAL software pricing (SPEC §5.11.2). Shapes follow sub-capacity MLC: monthly
// charge per product from the peak hourly sum of R4HA over the LPARs where it runs,
// with a decreasing price per MSU in tiers.

export interface ProductDef {
  id: string;
  name: string;
  lpars: string[];
  /** Multiplier on the base tier prices. */
  priceFactor: number;
}

/** [upper MSU bound of tier, $ per MSU per month]. */
export const BASE_TIERS: [number, number][] = [
  [45, 700],
  [175, 450],
  [315, 250],
  [575, 150],
  [Infinity, 100],
];

export const MIDWEST_PRODUCTS: ProductDef[] = [
  { id: 'ZOS', name: 'z/OS', lpars: ['PROD1', 'PROD2', 'DEVT', 'SYSP'], priceFactor: 1 },
  { id: 'DB2', name: 'Db2 for z/OS', lpars: ['PROD1', 'PROD2', 'DEVT'], priceFactor: 1.1 },
  { id: 'CICS', name: 'CICS TS', lpars: ['PROD1', 'PROD2'], priceFactor: 0.8 },
  { id: 'MQ', name: 'MQ for z/OS', lpars: ['PROD1', 'PROD2'], priceFactor: 0.5 },
];

export function tieredMonthlyCost(msu: number, factor: number, tiers: [number, number][] = BASE_TIERS): number {
  let cost = 0;
  let lo = 0;
  for (const [hi, price] of tiers) {
    if (msu <= lo) break;
    cost += (Math.min(msu, hi) - lo) * price * factor;
    lo = hi;
  }
  return cost;
}

// Tailored Fit Pricing (Enterprise Consumption) offer. Real TFP sets the baseline from the past
// 12 months of MSU consumption, charges growth above it at a discount, and makes capping pointless
// (IBM, "What is Tailored Fit Pricing for IBM Z?"; Precisely, TFP overview).
// APPROX: real contracts are multi-year with unused MSUs rolling over; a game quarter is too short,
// so the baseline is a committed monthly minimum and unused MSU-hours are lost.
// FICTIONAL: terms. The quoted baseline cost is a small discount on the sub-capacity bill at the
// current peak (practitioners note TFP rarely lowers the bill for existing work); growth is cheap.
export const TFP_OFFER = {
  /** The offer arrives at the end of this played day (0-based). */
  offerDay: 9,
  /** Days the offer stays open after it arrives. */
  openDays: 4,
  /** Discount of the committed baseline vs the sub-capacity bill at this month's peak. */
  discountFrac: 0.03,
  /** Baseline = month-to-date average product MSU × 720 h × (1 + growth). */
  baselineGrowthFrac: 0.03,
  /** MSU-hours above the baseline cost this fraction of the baseline price. */
  overageFrac: 0.5,
  /** Engineer-hours to review and sign the contract. */
  acceptHours: 2,
};
