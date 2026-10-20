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
