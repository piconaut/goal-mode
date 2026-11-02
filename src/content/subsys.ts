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
