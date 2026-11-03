// Subsystem task-slot queues (CICS MXT, Db2 MAXDBAT).

export const SLOT_QUEUE = {
  /** APPROX: Db2 times out queued DDF connections after MAXCONQW; its default ON uses IDTHTOIN (120 s)
   *  (Db2 13 Installation p.213, p.365). */
  ddfQueueTimeoutSec: 120,
  /** FICTIONAL: CICS tasks waiting for MXT are purged by DTIMOUT-style limits; shape: a queue that cannot
   *  drain fails transactions within about a minute instead of growing forever. */
  cicsQueueTimeoutSec: 60,
  /** Below this utilisation of a large slot pool the Erlang-C wait is negligible; skip it (perf). */
  erlangSkipBelowFrac: 0.5,
  erlangSkipMinSlots: 20,
};

/** Dispatchable units (TCBs/SRBs) an address space keeps ready at once: its weight against other work at the
 * same dispatching priority. Roles not listed count one unit per engine of demand, at least one. */
export const DISPATCH_UNITS = {
  /** FICTIONAL: Db2 spreads its own work over many short SRBs and service TCBs (prefetch, deferred write,
   *  castout, log write), so light per-unit demand. Shape: Db2 keeps most of its CPU when it ties with a busy
   *  transaction class, instead of the share its demand alone would buy. */
  byRole: {
    'DB2.MSTR': 4,
    'DB2.DBM1': 12,
    'DB2.DIST': 4,
    'DB2.IRLM': 2,
    'MQ.MSTR': 4,
    'MQ.CHIN': 6,
  } as Readonly<Record<string, number>>,
};

/** CICS dynamic storage (EDSA) and short-on-storage. CICS Performance Guide 6 p.73: per-task storage multiplies by the
 *  number of concurrent tasks; p.76: SOS defers new task attach; p.78: fewer concurrent tasks (lower MXT) mean less
 *  storage and less SOS. All sizes FICTIONAL. */
export const CICS_STORAGE = {
  /** EDSALIM default is 800 MB (CICS Performance p.73). FICTIONAL min/max: the lever's range. */
  defaultEdsaLimitMb: 800,
  minEdsaLimitMb: 400,
  maxEdsaLimitMb: 1600,
  /** FICTIONAL: storage a region holds with no tasks (programs, control blocks, buffers), MB. */
  baseMb: 300,
  /** FICTIONAL: storage per concurrent task, MB. */
  perTaskMb: 2,
  /** APPROX: the storage cushion keeps a few tasks running even deep in SOS. */
  minTasks: 10,
  /** FICTIONAL: how sharply a region thrashes once more tasks are in flight than fit: effective concurrency is
   *  cap × (cap / in-flight)^gamma. Shape: an MXT above what storage holds makes SOS worse, not better. */
  sosThrashGamma: 0.5,
};
