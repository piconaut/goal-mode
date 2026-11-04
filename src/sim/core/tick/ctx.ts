import type { PoolDemand } from '../../hw/pools';
import type { IoClass } from '../../io/dasd';
import { jobShape, type JobRuntime } from '../../subsys/batch';
import type { IoService, LparEvalInput, SliceSpec } from '../../wlm/evaluate';
import type { WlmSystemState } from '../../wlm/runtime';
import { clockAt } from '../clock';
import type { Scenario } from '../scenario';
import type { AddressSpaceDef, WorkloadDef } from '../../workload/types';
import type { CpcConfig, EnvState, LparPoolRuntime, LparRuntime, CicsStorageTick, LparTick, SimState, WorkloadTick } from '../types';

export const WLM_LOG_MAX = 400;
export const DEFAULT_EFF_RATIO = 0.93;
export const DEFAULT_IO: Record<IoClass, IoService> = {
  RANDOM: { rtSec: 0.0003, delaySec: 0.00005 },
  SEQ: { rtSec: 0.0004, delaySec: 0.00005 },
};
export const CRITICAL_PROJECTION_EVERY = 30;
/** RMF intervals kept in state (older ones live in the game layer's archive). */
export const RMF_KEEP = 300;

export function servers(rt: LparPoolRuntime | undefined, logical: number, hiperDispatch: boolean): number {
  if (!rt) return 0;
  if (!hiperDispatch) return logical;
  return Math.max(1, Math.round(rt.vh + rt.vm + rt.unparkedVl));
}

// Whether a workload calls Db2, memoised per definition object (asked per slice per tick).
export const usesDb2Cache = new WeakMap<WorkloadDef, boolean>();
export function usesDb2(w: WorkloadDef): boolean {
  let v = usesDb2Cache.get(w);
  if (v === undefined) usesDb2Cache.set(w, (v = w.servers.some((s) => s.role.startsWith('DB2.'))));
  return v;
}

export interface BatchSliceRef {
  slice: SliceSpec;
  jobs: { job: JobRuntime; cp: number; zi: number; cfCpEngines: number; shape: ReturnType<typeof jobShape> }[];
}

/** Everything the per-image stages of one tick read or fill in. */
export interface TickCtx {
  prev: SimState;
  scenario: Scenario;
  def: SimState['wlm']['definition'];
  env: EnvState;
  config: SimState['config'];
  clock: ReturnType<typeof clockAt>;
  cpcOf: Record<string, CpcConfig>;
  workloads: readonly WorkloadDef[];
  workloadById: Record<string, WorkloadDef>;
  addressSpaces: readonly AddressSpaceDef[];
  rates: Record<string, number>;
  io: Record<IoClass, IoService>;
  cfServiceSec: number;
  cfZosCpuSec: number;
  /** Rebuild stall per request, on top of each system's own CF service. */
  cfStallSec: number;
  db2FailFrac: number;
  mqFailFrac: number;
  runningBy: Record<string, JobRuntime[]>;
  queuedWlmBy: Record<string, JobRuntime[]>;
  slicesBy: Record<string, SliceSpec[]>;
  capOfBy: Record<string, LparEvalInput['capOf']>;
  batchRefsBy: Record<string, BatchSliceRef[]>;
  swappedBy: Record<string, Set<JobRuntime>>;
  pagingFrac: Record<string, number>;
  demands: PoolDemand[];
  lpars: LparRuntime[];
  storageCritical: Set<string>;
  /** Per-period share of the storage that storage-critical work keeps (only filled when some class is protected). */
  pagingWeight: Record<string, number>;
  evalInputs: Record<string, LparEvalInput>;
  backlog: Record<string, number>;
  ziipBacklog: Record<string, number>;
  failedBy: Record<string, number>;
  wlTick: Record<string, WorkloadTick>;
  rtByWorkloadLpar: Record<string, number>;
  holdByWorkloadLpar: Record<string, number>;
  /** Failed fraction per workload@lpar, kept only when a dynamic routing policy needs it. */
  failByWorkloadLpar: Record<string, number> | null;
  systems: WlmSystemState[];
  lparTicks: LparTick[];
  /** Sysplex online Db2 transaction rate (global lock contention for batch). */
  onlineDb2Rate: number;
  /** Transactions queued for a task slot (MXT, MAXDBAT) per `lparId:kind`. */
  slotQueue: Record<string, number>;
  /** CICS region storage per LPAR (reporting only). */
  cicsStorageBy: Record<string, CicsStorageTick[]>;
}

/** Sums over all images, accumulated in image order. */
export interface TickSums {
  randomIops: number;
  seqIops: number;
  cfRequests: number;
  cfRequestsBy: Record<string, number>;
}
