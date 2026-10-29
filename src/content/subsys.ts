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
