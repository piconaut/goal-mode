// Workload routing tunables (SPEC §13.5).

export const ROUTING = {
  // Sysplex distributor asks WLM for server weights once a minute (z/OS Communications Server IP
  // Configuration Guide, "Server-specific WLM recommendations"); 6 ticks = 60 s.
  wlmIntervalTicks: 6,
  // FICTIONAL: every candidate keeps a trickle so a saturated system still answers health probes.
  minShareFrac: 0.02,
  // FICTIONAL: shares are rounded to 1 % so tiny capacity changes don't rebuild routing every minute.
  shareQuantum: 0.01,
};
