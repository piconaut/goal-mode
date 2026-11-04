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


export interface CicsStorageCoef {
  defaultEdsaLimitMb: number;
  baseMb: number;
  perTaskMb: number;
  minTasks: number;
  sosThrashGamma: number;
}

export interface CicsStorageState {
  edsaLimitMb?: number;
  leak?: { startMb: number; mbPerHour: number; sinceTick: number };
}

/** Storage held by a leaking program at `tick`, MB (grows linearly from its start). */
export function leakedMb(r: CicsStorageState, tick: number, tickSec: number): number {
  if (!r.leak) return 0;
  return r.leak.startMb + (r.leak.mbPerHour * Math.max(0, tick - r.leak.sinceTick) * tickSec) / 3600;
}

/** Concurrent tasks the region's EDSA can hold before it goes short on storage (CICS Performance p.73). */
export function storageCapTasks(r: CicsStorageState, tick: number, tickSec: number, k: CicsStorageCoef): number {
  const limit = r.edsaLimitMb ?? k.defaultEdsaLimitMb;
  return Math.max(k.minTasks, (limit - k.baseMb - leakedMb(r, tick, tickSec)) / k.perTaskMb);
}

/** EDSA in use for `tasks` concurrent tasks, MB (capped at the limit: CICS stops attaching instead). */
export function edsaInUseMb(r: CicsStorageState, tasks: number, tick: number, tickSec: number, k: CicsStorageCoef): number {
  const limit = r.edsaLimitMb ?? k.defaultEdsaLimitMb;
  return Math.min(limit, k.baseMb + leakedMb(r, tick, tickSec) + tasks * k.perTaskMb);
}

/**
 * Task slots a region delivers. Up to MXT tasks are attached; if the in-flight demand (min of MXT and offered
 * concurrency) exceeds what storage holds, the region is short on storage, defers attaches and thrashes, so it
 * delivers fewer than its storage cap (CICS Performance p.76, p.78).
 */
export function effectiveMxt(maxTasks: number, capTasks: number, offeredTasks: number, gamma: number): number {
  if (maxTasks <= capTasks) return maxTasks;
  const inFlight = Math.min(maxTasks, offeredTasks);
  if (inFlight <= capTasks) return maxTasks;
  return capTasks * Math.pow(capTasks / inFlight, gamma);
}
