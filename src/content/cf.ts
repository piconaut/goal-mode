// Coupling facility failure, rebuild and duplexing (SPEC §5.9).

// FICTIONAL: shapes follow IBM guidance. Rebuilds take tens of seconds (lock first, it is small and
// critical; GBPs longest), requesters stall meanwhile; a lost lock or SCA structure takes the Db2 data
// sharing group down until it is reallocated, a lost GBP leaves pages in recovery-pending (GRECP/LPL),
// a lost MQ admin structure stops shared-queue work. Duplexed requests wait for both CFs plus a
// protocol exchange; GBP duplexing only copies writes.
export const CF_FAILURE = {
  rebuildSec: { LOCK: 20, LIST: 30, CACHE: 60 } as Record<'LOCK' | 'LIST' | 'CACHE', number>,
  /** Average extra wait per CF request to a structure while it is being rebuilt. */
  stallSecPerRequest: 0.004,
  /** Time to reallocate and recover lost structures once their CF is back. */
  recoverySec: 900,
  db2DownFailFrac: 0.95,
  grecpFailFrac: 0.4,
  mqDownFailFrac: 0.95,
};

export const CF_DUPLEX = {
  syncMult: 1.6,
  cacheWriteFrac: 0.3,
};

// Since z/OS 1.2 the sync→async heuristic covers lock, list and cache requests alike, with a separate
// threshold per request type (IBM WSC, "Heuristic Conversion of CF Operations", 2007).
// FICTIONAL: the per-type multipliers on the scenario's base threshold. Shape: lock requests stay
// synchronous a little longer than cache/list ones, but a slow or shared-engine CF still converts them,
// which trades z/OS CPU spin for longer lock-request elapsed time.
export const CF_ASYNC_THRESHOLD_MULT: Record<'LOCK' | 'LIST' | 'CACHE', number> = { LOCK: 1.5, LIST: 1, CACHE: 1 };
