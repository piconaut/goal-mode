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
