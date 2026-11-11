// When a CPU incident is capacity rather than policy (SPEC §10 "Incident ground truth").
// FICTIONAL: the shapes are the game's, not IBM's; they are here rather than in `src/game/sla.ts`
// so a scenario can be retuned without touching the mechanism rules (CLAUDE.md, data-driven content).

export const CPU_CAPACITY = {
  /** Hour-average busy of a host CPC's general CPs from which a CPU incident can be capacity. */
  cpcBusyFrac: 0.9,
  /** Hour-average share of its available CP (online logical CPs, entitlement plus white space) an image
   * used from which it was full on its own, whatever its CPC shows: PR/SM can't give it more. */
  lparBusyFrac: 0.95,
  /** Below this share of the image's CP going to less important work, WLM had nothing left to donate. */
  donorFrac: 0.1,
} as const;

// FICTIONAL (docs/rca-design.md §4.3, RT-07): where the evidence does not separate capacity from priority, both are
// accepted answers to an RCA. These bands only widen the accepted set; the primary stays what the rule above says.
export const CPU_BANDS = {
  /** Hour-average CPC or image busy from which capacity is clearly the answer. */
  hostFullFrac: 0.95,
  /** Below this, priority is clearly the answer: there was room on the machine. */
  hostRoomFrac: 0.85,
  /** Below this share of the image's CP going to displaceable work, capacity is clearly the answer. */
  donorRoomFrac: 0.05,
  /** From this share up, priority is clearly the answer: WLM had CPU it could have moved. */
  donorBusyFrac: 0.2,
} as const;
