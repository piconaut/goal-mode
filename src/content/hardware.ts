// FICTIONAL: machine generations and capacity settings. Proportions are meant to
// feel like real sub-capacity ladders; no real LSPR or MSU ratings are used.

export interface GenerationSpec {
  id: string;
  name: string;
  /** MSU per general CP at full speed (capacity setting 7). */
  fullSpeedMsuPerCp: number;
  /** Engine speed relative to the reference engine (M2 full speed = 1.0). */
  relativeSpeed: number;
  /** MP-effect coefficient k in mpFactor(n) = 1 - k·ln(n). */
  mpK: number;
  maxEnginesPerCpc: number;
}

export const GENERATIONS: Record<string, GenerationSpec> = {
  M1: { id: 'M1', name: 'M-series Gen 1', fullSpeedMsuPerCp: 205, relativeSpeed: 0.86, mpK: 0.045, maxEnginesPerCpc: 40 },
  M2: { id: 'M2', name: 'M-series Gen 2', fullSpeedMsuPerCp: 232, relativeSpeed: 1.0, mpK: 0.042, maxEnginesPerCpc: 48 },
  M3: { id: 'M3', name: 'M-series Gen 3', fullSpeedMsuPerCp: 258, relativeSpeed: 1.12, mpK: 0.04, maxEnginesPerCpc: 64 },
};

/** FICTIONAL: capacity of a sub-capacity CP relative to a full-speed CP. */
export const CAPACITY_SETTING_FRAC: Record<4 | 5 | 6 | 7, number> = {
  4: 0.3,
  5: 0.48,
  6: 0.7,
  7: 1.0,
};

/** FICTIONAL: PR/SM and HiperDispatch efficiency coefficients. Shape: overhead grows
 * with logical:physical ratio and much faster above the 2:1 rule of thumb. */
export const PRSM = {
  baseOverheadFrac: 0.01,
  perLtoPAboveOne: 0.006,
  steepMultiplierAbove2to1: 3,
  perUnparkedVl: 0.004,
  /** Unattributed (PHYSICAL) overhead as a fraction of the pool per unit of LtoP above 1. */
  physicalPerLtoP: 0.003,
  efficiency: { VH: 1.0, VM: 0.96, VL: 0.87, horizontal: 0.93 },
  /** Short-engine effect: delay grows as entitlement per logical CP shrinks. */
  shortEngineK: 0.15,
};
