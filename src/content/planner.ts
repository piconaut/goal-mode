// FICTIONAL: capacity planner tuning (what a zPCR/MXG-style trend projection would use).
export const PLANNER = {
  /** Fit over the most recent days. */
  windowDays: 10,
  /** Fewer days than this: no forecast. */
  minDays: 3,
  horizonDays: 14,
  /** Two-sided 90% band. */
  z: 1.645,
  /** Floor on the log-residual σ so three calm days don't produce a falsely tight band. */
  minSigma: 0.03,
  /** Hours (start, inclusive..exclusive) whose CPC busy counts as the online peak; batch soaks up nights. */
  onlineHours: [8, 18] as [number, number],
  /** CPC busy at which work starts to queue noticeably. */
  cpcWarnPct: 90,
};
