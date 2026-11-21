// When a CPU incident is capacity rather than policy (SPEC §10 "Incident ground truth").
// FICTIONAL: the shapes are the game's, not IBM's; they are here rather than in `src/game/sla.ts`
// so a scenario can be retuned without touching the mechanism rules (CLAUDE.md, data-driven content).

// When a CPU incident is capping rather than capacity or priority (SPEC §10, docs/rca-design.md §4.3): the host
// image must have been capped for this share of the hour's ticks (time, not the worst tick).
export const CAPPING = {
  /** Share of an hour's ticks in which the image's CP demand was capped (`cappedFrac > 0`), or in which a server
   * role the work depends on had CPU withheld by a resource-group cap. */
  minHourShare: 0.05,
  /** FICTIONAL: share of a period's WLMGL samples that must be CAP delay for a resource-group maximum to be the
   * cause. A resource group that binds markedly shows far more (a test group on DDFPRD measured 45 %), while a
   * group that only grazes demand stays near zero. */
  capDelayFrac: 0.05,
} as const;

export const CPU_CAPACITY = {
  /** Hour-average busy of a host CPC's general CPs from which a CPU incident can be capacity. */
  cpcBusyFrac: 0.9,
  /** Hour-average share of its available CP (online logical CPs, entitlement plus white space) an image
   * used from which it was full on its own, whatever its CPC shows: PR/SM can't give it more. */
  lparBusyFrac: 0.95,
  /** Below this displaceable share of the image's pool, a full host is judged capacity. */
  displaceableFrac: 0.1,
} as const;

// FICTIONAL (docs/rca-design.md §4.3, RT-07): where the evidence does not separate capacity from priority, both are
// accepted answers to an RCA. These bands only widen the accepted set; the primary stays what the rule above says.
export const CPU_BANDS = {
  /** Hour-average CPC or image busy from which capacity is clearly the answer. */
  hostFullFrac: 0.95,
  /** Below this, priority is clearly the answer: there was room on the machine. */
  hostRoomFrac: 0.85,
  /** Below this share of the judged image's pool going to displaceable work, capacity is clearly the answer. */
  displaceableRoomFrac: 0.05,
} as const;

// FICTIONAL: a substantial second host contributes a verdict; protect SLA work near its target.
export const CPU_SPLIT = {
  coHostFrac: 1 / 3,
  atRiskMargin: 0.25,
} as const;
