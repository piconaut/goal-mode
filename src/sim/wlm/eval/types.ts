// Shapes of the per-LPAR evaluation: the input the tick pipeline builds, the
// per-slice results, the per-period samples RMF reports, and the DP-independent
// preparation the policy-adjust projections reuse.
// Stage bodies live beside this file: prepare, grants, results, accounting, io, paging.

import type { MovedSamples, WorkManagerSamples, CicsTargets } from '../reporting';
import type { IoClass } from '../../io/dasd';
import { emptyBuckets } from '../goals';

/** Per-class I/O service seen by this image. WLM counts device connect as I/O using and IOSQ +
 * pending as I/O delay; disconnect is neither (z/OS MVS Planning: WLM, "Velocity formula").
 * APPROX: control unit queue time is folded into pending. */
export interface IoService {
  rtSec: number;
  delaySec: number;
  /** IOSQ part of delaySec (z/OS UCB queue: the only part WLM I/O priority can reorder). */
  iosqSec?: number;
  /** Device connect time per I/O (WLM I/O using); absent means everything outside delaySec. */
  connSec?: number;
}

export interface SliceSpec {
  key: string;
  scKey: string;
  kind: 'TXN' | 'AS';
  workloadId: string | null;
  jobname: string | null;
  role: string | null;
  /** Transactions per second ending in this period (0 for address spaces). */
  rate: number;
  /** Demand on this image's engines from new arrivals, engines' worth. */
  cpEngines: number;
  ziipEngines: number;
  mayOverflow: boolean;
  /** Per-ending-transaction engine CPU seconds in this period. */
  cpuSecPerTxn: number;
  ziipSecPerTxn: number;
  ioPerTxn: number;
  baseLatencySec: number;
  rtSigma: number;
  timeoutSec: number;
  servers: { role: string; latencySec: number }[];
  /** Goal response time of the period for bucket accounting; null for velocity/discretionary. */
  goalRtSec: number | null;
  /** SLA response-time threshold for the game layer; null if none. */
  slaRtSec: number | null;
  ioClass: IoClass;
  /** Address spaces (incl. batch): I/O rate per second for using/delay samples. */
  ioRate: number;
  /** Extra per-transaction wait from subsystem limits, locks and CF (not WLM-fixable). */
  extraOtherSec: number;
  /** Fraction of transactions failing due to subsystem limits (e.g. QR TCB overload). */
  failFrac: number;
  /** The part of failFrac that fails fast (abends, rejections) rather than by QR overload; what
   * CPSM's abend probability sees. Absent = all of failFrac. */
  abendFrac?: number;
  /** Queueing before the work manager sees the request (MXT, DBAT): end users feel it,
   * WLM and RMF response times do not include it. */
  outsideWaitSec: number;
  /** The same queue had the work run at its unqueued service time (no CPU, I/O or other waits): the part of
   * outsideWaitSec that arrival rate against the limit causes, rather than slow tasks holding their slot. */
  outsideRefSec?: number;
  /** Diagnostic split of extraOtherSec (e.g. cf, lock, qr). */
  extraParts?: Record<string, number>;
  /** Report class from classification (reporting only: WLM never manages to it). */
  reportClass?: string | null;
  /** Share of its MQ queue this slice's messages may fill (message-driven work only). */
  mqQueueFrac?: number;
  /** Messages this slice may keep queued before puts fail (MAXDEPTH share); no timeout applies. */
  maxQueueMsgs?: number;
  /** Dispatchable units able to run this work (TCBs/SRBs, batch jobs): its weight against other work at the
   * same DP. 0 or absent: at least one for an address space; for transactions one per engine of new work. */
  units?: number;
}

/** Builds a slice with every field present in one fixed order, so all slices share one hidden
 * class and the per-tick evaluator's property loads stay monomorphic (hot path). */
export function sliceSpec(p: Pick<SliceSpec, 'key' | 'scKey' | 'kind'> & Partial<SliceSpec>): SliceSpec {
  return {
    key: p.key,
    scKey: p.scKey,
    kind: p.kind,
    workloadId: p.workloadId ?? null,
    jobname: p.jobname ?? null,
    role: p.role ?? null,
    rate: p.rate ?? 0,
    cpEngines: p.cpEngines ?? 0,
    ziipEngines: p.ziipEngines ?? 0,
    mayOverflow: p.mayOverflow ?? true,
    cpuSecPerTxn: p.cpuSecPerTxn ?? 0,
    ziipSecPerTxn: p.ziipSecPerTxn ?? 0,
    ioPerTxn: p.ioPerTxn ?? 0,
    baseLatencySec: p.baseLatencySec ?? 0,
    rtSigma: p.rtSigma ?? 0,
    timeoutSec: p.timeoutSec ?? Infinity,
    servers: p.servers ?? [],
    goalRtSec: p.goalRtSec ?? null,
    slaRtSec: p.slaRtSec ?? null,
    ioClass: p.ioClass ?? 'RANDOM',
    ioRate: p.ioRate ?? 0,
    extraOtherSec: p.extraOtherSec ?? 0,
    failFrac: p.failFrac ?? 0,
    outsideWaitSec: p.outsideWaitSec ?? 0,
    extraParts: p.extraParts,
    reportClass: p.reportClass ?? null,
    mqQueueFrac: p.mqQueueFrac,
    maxQueueMsgs: p.maxQueueMsgs,
    units: p.units ?? 0,
  };
}

/** Where a transaction's response time went, seconds per transaction. */
export interface RtParts {
  base: number;
  cpu: number;
  cpuQueue: number;
  ziip: number;
  io: number;
  paging: number;
  dependency: number;
  extra: Record<string, number>;
  backlogWait: number;
  outside: number;
  outsideRef: number;
}

export interface LparEvalInput {
  cpCapacityEngines: number;
  cpAllocatedEngines?: number;
  cpServers: number;
  ziipCapacityEngines: number;
  ziipAllocatedEngines?: number;
  ziipServers: number;
  /** No online zIIPs: eligible work counts against the CP maximum. Absent: infer from ziipServers. */
  eligibleOnCp?: boolean;
  cpPrsmDelayFrac: number;
  slices: readonly SliceSpec[];
  /** Backlogged work per slice key, engine-seconds (CP + zIIP). */
  backlog: Readonly<Record<string, number>>;
  /** zIIP-eligible part of `backlog`, engine-seconds. Absent: the backlog splits by the slice's arrival mix. */
  ziipBacklog?: Readonly<Record<string, number>>;
  dpOf: (scKey: string) => number;
  /** Optional per-slice CP cap (resource group maximums), engines. */
  capOf?: (slice: SliceSpec) => number;
  /** Resource group minimums in force this tick: CP engines per service-class period. */
  minOf?: Readonly<Record<string, number>>;
  /** Periods in minOf that are discretionary: their minimum yields to goal work. */
  discMin?: ReadonlySet<string>;
  /** CICS work runs inside region address spaces, so it shares their dispatching priority: the most
   * important served period's DP (TRANSACTION mode, the "free ride") or the region's own class (REGION/BOTH).
   * `servers`: slice keys of the region address spaces managed as transaction servers (TRANSACTION); their own
   * CPU dispatches with the transactions, not at their service class's DP (WLM Planning p.122).
   * `rtTracked: false` (every region REGION): the transactions' response times reach their report classes only,
   * not their service classes (WLM Planning p.123), so WLM has no response time data to manage them. */
  regions?: { keys: readonly string[]; mode: 'TRANSACTION' | 'REGION'; regionKey: string; servers?: readonly string[]; rtTracked?: boolean; transactionKeys?: ReadonlySet<string>; targets?: CicsTargets; managedToTxn?: boolean };
  io: Record<IoClass, IoService>;
  /** WLM I/O priority management: I/O samples count in velocity. */
  ioPriority?: boolean;
  /** Paging delay fraction on this image (storage-critical classes are exempt). */
  pagingFrac: number;
  storageCritical?: ReadonlySet<string>;
  /** Steal weight per service-class period: how much of the protected classes' paging it absorbs. */
  pagingWeight?: Readonly<Record<string, number>>;
  /** Service-class periods starved past BLWLINTHD, eligible for promotion. */
  promoted?: ReadonlySet<string>;
  promotionShareFrac?: number;
  /** Only the per-period ticks are needed (policy-adjust projections): skips response-time parts,
   * SLA attainment and report classes, none of which feed the period ticks. */
  scpsOnly?: boolean;
  /** With scpsOnly: the periods whose response-time buckets are needed (percentile goals). */
  bucketsFor?: ReadonlySet<string>;
  /** The DP-independent first stage, when the caller evaluates the same input under several DP sets. */
  prepared?: PreparedLpar;
}

export interface SliceResult {
  key: string;
  scKey: string;
  cpGranted: number;
  ziipGranted: number;
  iipcpGranted: number;
  /** Time-average concurrency in each state (WLM "samples" per tick, normalised). */
  usingCpu: number;
  usingZiip: number;
  usingIo: number;
  delayCpu: number;
  delayZiip: number;
  delayIo: number;
  /** Server/dependency waits: not a WLM-managed resource delay. */
  delayOther: number;
  delayStorage: number;
  /** Capping delay (soft cap / resource group): counts against velocity, not WLM-fixable. */
  delayCap: number;
  completions: number;
  failed: number;
  /** Response time as WLM/RMF see it. */
  rtMeanSec: number;
  /** In-region time a transaction holds its task slot, excluding the CPU backlog wait (already a queue). */
  holdSec: number;
  /** Response time as end users see it (adds pre-work-manager queueing). */
  userRtSec: number;
  parts: RtParts | null;
  newBacklog: number;
  /** zIIP-eligible part of newBacklog, engine-seconds. */
  newZiipBacklog: number;
  /** Health of this address space as a server (granted/wanted), 1 for transactions. */
  health: number;
  queueRatio: number;
  withinSla: number;
}

export interface ScpTick {
  /** Reporting only: CICS transactions' resource accounting, which RMF reports with the region classes, and
   * their work manager states (reporting.ts). */
  moved?: MovedSamples;
  workManager?: WorkManagerSamples;
  scKey: string;
  dp: number;
  cpEngines: number;
  ziipEngines: number;
  iipcpEngines: number;
  usingCpu: number;
  usingZiip: number;
  usingIo: number;
  delayCpu: number;
  delayZiip: number;
  delayIo: number;
  delayOther: number;
  delayStorage: number;
  delayCap: number;
  /** Batch jobs queued for an initiator in a WLM-managed job class (WLMGL QMPL). */
  delayQueue?: number;
  /** Arriving demand this tick, engines, without backlog: feeds WLM's sustained demand. */
  demandCp?: number;
  demandZi?: number;
  /** The part of usingIo / delayIo left out of velocity (I/O priority management off). */
  usingIoNoVel?: number;
  delayIoNoVel?: number;
  /** Velocity samples of transaction-server regions in this period: reported, but left out of its PI. */
  srvUsing?: number;
  srvDelay?: number;
  completions: number;
  failed: number;
  rtSumSec: number;
  buckets: number[];
}

/** A report class's tick on one image, and the service-class periods its work ran in. */
export interface ReportClassTick extends ScpTick {
  members: string[];
}

export const emptyScpTick = (scKey: string, dp: number): ScpTick => ({
  scKey,
  dp,
  cpEngines: 0,
  ziipEngines: 0,
  iipcpEngines: 0,
  usingCpu: 0,
  usingZiip: 0,
  usingIo: 0,
  delayCpu: 0,
  delayZiip: 0,
  delayIo: 0,
  delayOther: 0,
  delayStorage: 0,
  delayCap: 0,
  completions: 0,
  failed: 0,
  rtSumSec: 0,
  buckets: emptyBuckets(),
});

export interface LparEvalResult {
  slices: SliceResult[];
  scps: ScpTick[];
  /** Report classes (only when the policy assigns any). */
  rcs?: ReportClassTick[];
  roleHealth: Record<string, { health: number; queueRatio: number }>;
}

/** Per-slice demand and its per-period totals: everything in an evaluation that does not depend on DPs. */
export interface PreparedLpar {
  sliceCp: number[];
  sliceZi: number[];
  /** CP + zIIP demand withheld by a resource group or discretionary cap. */
  sliceCut: number[];
  sliceZiCut: number[];
  /** Index of each slice's dispatch aggregate in `order`. */
  sliceAgg: number[];
  /** Dispatch identities: service-class periods, plus `<scKey>~srv` for transaction-server regions.
   * An identity can occur twice when its slices have different overflow eligibility. */
  order: string[];
  dispatchIds: string[];
  cpShares: number[] | null;
  aggCp: number[];
  aggZi: number[];
  aggOverflow: boolean[];
  /** Ready units per slice; undefined shares by demand. */
  sliceUnits: (number | undefined)[];
  /** Ready units per dispatch aggregate; undefined when none of its slices count units. */
  aggUnits: (number | undefined)[];
  /** Slice indices of each dispatch aggregate. */
  aggSlices: number[][];
}
