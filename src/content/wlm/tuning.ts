// WLM internals that IBM doesn't publish as numbers.

// Discretionary goal management: WLM caps over-achieving work with loose goals so discretionary work
// gets cycles, holding the capped work's PI between 0.71 and 0.81 (SG24-6472-03 p.183; docs/research.md).
// FICTIONAL: capGainPerPi and minCapFrac. Shape: the further PI is below 0.81, the more is withheld, so a
// capped period settles inside the 0.71–0.81 band and only a little CPU goes to discretionary work.
export const DISC_GOAL_MGMT = {
  /** Eligible when PI is below this (SG24-6472: "PI of the service class is less than 0.71"). */
  piBelow: 0.71,
  /** Already-capped periods stay capped while PI is below this, the top of WLM's band. */
  stayCappedPiBelow: 0.81,
  /** Velocity goals at or below this qualify (SG24-7621: ≤ 30). */
  maxVelocity: 30,
  /** Response-time goals longer than this qualify (SG24-7621: > 1 minute). */
  minRtSec: 60,
  /** Periods using fewer CP engines than this are "small consumers" and left alone. */
  minEngines: 0.05,
  /** Capped periods get 1 − capGainPerPi × (stayCappedPiBelow − PI) of their CP demand… */
  capGainPerPi: 1.0,
  /** …but never less than this fraction. */
  minCapFrac: 0.5,
};

// FICTIONAL: when SRM starts swapping. Shape: swapping kicks in as soon as running work would overcommit
// real memory, and swaps down to a small margin so paging stays low for the work left in storage.
export const STORAGE_SWAP = {
  swapAboveFrac: 1.0,
  swapToFrac: 0.97,
  // Never swap the last job(s) out: SRM keeps a minimum MPL and the rest pages instead. Without it, fixed demand
  // above swapToFrac (e.g. oversized buffer pools) froze every batch job for the whole night.
  minSwappedIn: 1,
};

// Storage Critical: protected work loses frames only to equal or more important work, so the paging it avoids
// lands on unprotected work, more on less important work (WLM Planning p.119: "can reduce throughput").
// FICTIONAL: steal weight per importance 1..5, and for discretionary; the shape is "importance 5 and
// discretionary absorb most of it".
export const STORAGE_STEAL_WEIGHT_BY_IMP = [1, 2, 3, 4, 5];
export const STORAGE_STEAL_WEIGHT_DISC = 6;
// FICTIONAL: ceiling on any one period's paging delay fraction after redistribution.
export const STORAGE_STEAL_MAX_FRAC = 0.9;
