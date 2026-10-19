// Db2 effects on dependent work (SPEC §5.10.2): buffer-pool hit ratio → I/O per
// transaction, DBAT limits → DDF queueing, batch/online lock contention.

/** FICTIONAL tunables. */
export const DB2 = {
  /** Content I/O-per-transaction values are defined at this BP/working-set ratio. */
  referenceBpRatio: 0.25,
  /** Miss-ratio curve exponent: miss ∝ (bp / workingSet)^-alpha. */
  alpha: 0.5,
  /** Data working-set growth per played day. */
  workingSetGrowthPerDay: 0.002,
  /** Online lock wait per transaction per unit of batch lock index. */
  lockWaitSecPerIndex: 0.004,
  /** CF requests per online Db2 transaction (lock + GBP) under data sharing. */
  cfRequestsPerTxn: 8,
  /** CF requests per batch I/O. */
  cfRequestsPerBatchIo: 0.3,
};

/** Physical I/O multiplier relative to the content reference BP size. */
export function bpIoMultiplier(bufferPoolGb: number, workingSetGb: number): number {
  const ratio = Math.max(0.01, bufferPoolGb / Math.max(0.1, workingSetGb));
  return Math.min(4, Math.pow(ratio / DB2.referenceBpRatio, -DB2.alpha));
}

/** Extra wait when active DBATs exceed MAXDBAT (Little's law on the excess). */
export function dbatQueueWaitSec(rate: number, rtSec: number, maxDbat: number): number {
  const active = rate * rtSec;
  if (rate <= 0 || active <= maxDbat) return 0;
  return (active - maxDbat) / rate;
}
