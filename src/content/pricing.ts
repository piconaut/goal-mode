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
