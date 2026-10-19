// Tier-2 analytics content: Db2 package names and SMF 113 counter model coefficients.

/** Main Db2 package per workload, as Db2 accounting (SMF 101) would show it. FICTIONAL names. */
export const DB2_PACKAGES: Record<string, string> = {
  RBANK: 'RB01',
  CARDAUTH: 'AUTH01',
  MOBILE: 'MOBPKG',
  TELLER: 'TL10',
  PAYMQ: 'PMQ1',
  ADHOC: 'DSNTEP2',
};

// FICTIONAL: SMF 113 (CPU Measurement Facility) shape. Work dispatched on vertical-medium/low
// logical CPs loses cache affinity, so L1 misses travel further (higher RNI, higher CPI). Busy
// CPCs and many LPARs sharing the machine raise RNI further. Magnitudes sit in the ranges IBM
// publishes for LSPR categories (RNI roughly 0.4–1.6, L1MP roughly 2–8%).
export const SMF113 = {
  /** L1 miss % per 100 instructions for the image's mix, before cache disruption. */
  l1mpBase: 3.6,
  /** Extra L1MP per unit of capacity running off VH engines. */
  l1mpPerNonVhFrac: 1.6,
  rniBase: 0.62,
  /** RNI added when all of the image's work runs on VM/VL engines. */
  rniPerNonVhFrac: 0.55,
  /** RNI added at 100% CPC busy (shared caches under pressure). */
  rniPerCpcBusyFrac: 0.3,
  /** Infinite-cache CPI plus the finite-cache term CPI ≈ base + k × L1MP × RNI. */
  cpiBase: 1.4,
  cpiPerL1mpRni: 0.42,
};

/**
 * LSPR workload category from L1MP and RNI (IBM "LSPR workload categories", used by zPCR;
 * table as published for z13 and later: <3% / 3–6% / >6% L1MP bands).
 */
export function lsprCategory(l1mpPct: number, rni: number): 'LOW' | 'AVERAGE' | 'HIGH' {
  if (l1mpPct < 3) return rni >= 0.75 ? 'AVERAGE' : 'LOW';
  if (l1mpPct <= 6) return rni > 1.0 ? 'HIGH' : rni >= 0.6 ? 'AVERAGE' : 'LOW';
  return rni >= 0.75 ? 'HIGH' : 'AVERAGE';
}
