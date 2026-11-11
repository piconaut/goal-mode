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

// Percentile goals past the last bounded bucket: the reported PI stops at 4.0 (RMF/WLM bucket layout, SG24-7621
// §3.10), but WLM's projection of receiver value and donor harm must still see a period at 30× its goal improve
// to 10× (SG24-7621 §3.12–3.15; WLM Planning ch.1: the most important work missing its goal is helped first).
// APPROX: projections extrapolate the goal-percentile response time from the mean RT, assuming a log-normal of
// this shape. FICTIONAL: 0.5 makes the 95th percentile ≈ 2× the mean, inside the range of the scenarios' rtSigma.
export const PCT_PROJECTION_SIGMA = 0.5;

// FICTIONAL: bound the cost of coupled batch-demand recovery in a DP trial. Each round retains the
// larger of current demand and demand enabled by the grants. Unsettled trials are rejected, never accepted
// using the final, possibly optimistic estimate. Tolerance is engines per job, not an IBM WLM threshold.
export const BATCH_PROJECTION = { maxRecoveryRounds: 8, demandToleranceEngines: 1e-8 };

// Policy adjustment (docs/wlm-design.md §5.10). IBM publishes none of these numbers; each note says where the
// starting value comes from, not that IBM uses it.
export const POLICY_ADJUST = {
  // FICTIONAL: per-tick decay of WLM's accumulators. Shape: the management PI looks back about a minute.
  accDecay: 0.85,
  // FICTIONAL: a move must close this share of the receiver's distance to its goal (the 1994 patent's example).
  receiverValueFrac: 0.1,
  // FICTIONAL: … and never less than this PI improvement, so nothing moves for a hair (Enrico, slide 50; practitioner).
  receiverValueMinPi: 0.05,
  // FICTIONAL: PI below this earns the receiver nothing and costs a donor nothing (the 1994 patent).
  creditFloor: 0.9,
  // FICTIONAL: projected PI changes up to this are projection noise, not harm.
  harmEps: 0.02,
  // FICTIONAL: a period using less than this many engines holds nothing a priority move could take: not a donor.
  donorMinEngines: 0.01,
  // FICTIONAL: a quiet tick's demand is lifted to its smoothed level in projections, to at most this multiple.
  demandUpliftMax: 2,
  // FICTIONAL: work that has fallen behind is projected to want up to (1 + this) × its sustained demand, not its
  // whole backlog in one interval.
  backlogBoostFrac: 0.5,
  // FICTIONAL: a receiver whose backlog the bound above cut is not raised while its management PI exceeds this
  // multiple of its projected `base`. A projection that far below what is measured (a runaway: 56.6 against 1.15)
  // cannot show what draining that backlog does to others. Shape: only transaction work far behind is affected, and
  // it can still be helped by a donor move; a percentile PI stops at 4.0, so a percentile goal never trips it.
  // Measured against projecting its whole backlog (docs/wlm-design.md §9.5).
  projectionTrustMax: 4,
};

// FICTIONAL: how many fixable receivers the search assesses at one importance before going on to the next.
// Shape: at most this many receivers per importance level get their trials run; the rest are skipped (BUDGET)
// and lower importances still get their own budget. A receiver whose trials find no move of net value does
// not keep lower importances out. SG24-7621 p.105-106 for the search order.
export const RECEIVERS_PER_IMPORTANCE = 2;
