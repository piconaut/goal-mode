// CICS region limits (SPEC §5.10.1). Non-threadsafe work serialises on the region's
// single QR TCB, which can use at most one engine; MXT caps concurrent tasks.

export interface QrResult {
  /** QR TCB utilisation of one engine (can exceed 1 = overloaded). */
  qrBusy: number;
  /** Extra wait per transaction for the QR TCB, seconds per second of QR CPU. */
  qrWaitRatio: number;
  /** Fraction of transactions failing (timeouts) when the QR TCB is overloaded. */
  failFrac: number;
}

export function qrTcb(qrCpuEngines: number): QrResult {
  const rho = Math.max(0, qrCpuEngines);
  const r = Math.min(rho, 0.995);
  return { qrBusy: rho, qrWaitRatio: r / (1 - r), failFrac: rho > 1 ? 1 - 1 / rho : 0 };
}

