// WLM internals that IBM doesn't publish as numbers.

// Discretionary goal management (SG24-7621 §4.22): WLM caps over-achieving work with loose goals
// so discretionary work gets cycles.
// FICTIONAL: the cap level and thresholds. Shape: an eligible period keeps most of its CPU (its
// PI stays under 1) and the withheld share goes to discretionary work.
export const DISC_GOAL_MGMT = {
  /** Eligible when PI is below this (SG24-7621: "projected PI < 0.7"). */
  piBelow: 0.7,
  /** Already-capped periods stay capped while PI is below this (hysteresis, APPROX). */
  stayCappedPiBelow: 0.9,
  /** Velocity goals at or below this qualify (SG24-7621: ≤ 30). */
  maxVelocity: 30,
  /** Response-time goals longer than this qualify (SG24-7621: > 1 minute). */
  minRtSec: 60,
  /** Periods using fewer CP engines than this are "small consumers" and left alone. */
  minEngines: 0.05,
  /** Capped periods get this fraction of their CP demand. */
  capFrac: 0.8,
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
