// Workload routing tunables (SPEC §13.5).

export const ROUTING = {
  // Sysplex distributor asks WLM for server weights once a minute (z/OS Communications Server IP
  // Configuration Guide, "Server-specific WLM recommendations"); 6 ticks = 60 s.
  wlmIntervalTicks: 6,
  // FICTIONAL: every candidate keeps a trickle so a saturated system still answers health probes.
  minShareFrac: 0.02,
  // FICTIONAL: shares are rounded to 1 % so tiny capacity changes don't rebuild routing every minute.
  shareQuantum: 0.01,
  // FICTIONAL: CICSPlex SM re-reads region load and response every 30 s here (real CPSM routes each
  // transaction on near-live data; the interval keeps routing changes cheap).
  cpsmIntervalTicks: 3,
  // FICTIONAL: how far goal routing moves toward the faster regions per interval (0..1).
  cpsmStepFrac: 0.5,
  // FICTIONAL: an abending transaction ends in a few milliseconds, which is what makes a failing
  // region look fast to goal routing (the "storm drain").
  abendRtSec: 0.004,
};
