// Per-LPAR evaluation for one tick: dispatch every slice at its service-class
// period's DP, then derive response times, dependency delays and WLM using/delay
// samples. Pure, so policy adjustment can re-run it to project the effect of a DP move.

import { lognormCdf } from '../core/math';
import { TICK_SEC } from '../core/units';
import { STORAGE_STEAL_MAX_FRAC } from '../../content/wlm/tuning';
import { DP, dispatch, type DispatchDemand, type DispatchResult } from '../zos/dispatcher';
import { addToBuckets, emptyBuckets } from './goals';

import type { IoClass } from '../io/dasd';

const MAX_QUEUE_RATIO = 50;

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

const ioUsingSec = (io: IoService) => io.connSec ?? io.rtSec - io.delaySec;

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
  cpServers: number;
  ziipCapacityEngines: number;
  ziipServers: number;
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
   * CPU dispatches with the transactions, not at their service class's DP (WLM Planning p.122). */
  regions?: { keys: readonly string[]; mode: 'TRANSACTION' | 'REGION'; regionKey: string; servers?: readonly string[] };
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

/** WLM I/O priority on the z/OS IOSQ: requests are queued by dispatching priority. Non-preemptive
 * priority M/M/1 split, W_k = W0 / ((1 − σ_{k−1})(1 − σ_k)), renormalised so the I/O-weighted mean
 * IOSQ is unchanged (work is reordered, not removed). APPROX: one queue per I/O class per image.
 * `sliceDp` is each slice's period DP. */
function iosqByPriority(slices: readonly SliceSpec[], sliceDp: readonly number[], io: Record<IoClass, IoService>): Partial<Record<IoClass, IoService[]>> | null {
  let out: Partial<Record<IoClass, IoService[]>> | null = null;
  const n = slices.length;
  for (const cls of ['RANDOM', 'SEQ'] as const) {
    const svcIo = io[cls];
    const iosq = svcIo.iosqSec ?? 0;
    if (iosq <= 1e-9) continue;
    const rate = new Array<number>(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const s = slices[i]!;
      rate[i] = s.ioClass === cls ? s.rate * s.ioPerTxn + s.ioRate : 0;
      total += rate[i]!;
    }
    if (total <= 0) continue;
    // Distinct DPs with I/O, rate summed in slice order.
    const dps: number[] = [];
    const byDp: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!(rate[i]! > 0)) continue;
      const dp = sliceDp[i]!;
      const j = dps.indexOf(dp);
      if (j < 0) {
        dps.push(dp);
        byDp.push(rate[i]!);
      } else byDp[j] = byDp[j]! + rate[i]!;
    }
    if (dps.length < 2) continue;
    const levels = dps.map((_, j) => j).sort((a, b) => dps[b]! - dps[a]!);
    const svc = Math.max(1e-6, svcIo.rtSec - iosq);
    const rho = Math.min(0.95, iosq / (iosq + svc));
    const w0 = rho * svc;
    const waitByDp = new Array<number>(dps.length);
    let sigma = 0;
    let mean = 0;
    for (const j of levels) {
      const prev = sigma;
      sigma += (rho * byDp[j]!) / total;
      waitByDp[j] = w0 / ((1 - prev) * (1 - sigma));
      mean += (byDp[j]! / total) * waitByDp[j]!;
    }
    const scale = mean > 0 ? iosq / mean : 1;
    // One service object per distinct DP, shared by the slices at that DP (they are only read).
    const byLevel = new Array<IoService | undefined>(dps.length);
    const list = new Array<IoService>(n);
    for (let i = 0; i < n; i++) {
      if (slices[i]!.ioClass !== cls) {
        list[i] = svcIo;
        continue;
      }
      const j = dps.indexOf(sliceDp[i]!);
      if (j < 0) {
        list[i] = svcIo;
        continue;
      }
      let o = byLevel[j];
      if (o === undefined) {
        const w = waitByDp[j]! * scale;
        o = Number.isFinite(w) ? { rtSec: svcIo.rtSec - iosq + w, delaySec: svcIo.delaySec - iosq + w, iosqSec: w, connSec: svcIo.connSec } : svcIo;
        byLevel[j] = o;
      }
      list[i] = o;
    }
    (out ??= {})[cls] = list;
  }
  return out;
}

/** Above every goal-managed period, below SYSTEM/SYSSTC and blocked-workload promotion. */
const RG_MIN_DP = 252;
/** Discretionary work gets its minimum only "if that action does not cause other work to miss its goal" (WLM
 * Planning p.59): above other discretionary work, below every goal-managed period. APPROX: it is served from
 * capacity no goal period wants, not only from goal periods that are meeting their goals. */
const RG_MIN_DISC_DP = DP.MANAGED_MIN - 1;

/** Suffix of the dispatch aggregate holding a period's transaction-server regions. */
const SRV = '~srv';
const baseKey = (id: string) => (id.endsWith(SRV) ? id.slice(0, -SRV.length) : id);

/** Per-slice demand and its per-period totals: everything in an evaluation that does not depend on DPs. */
export interface PreparedLpar {
  sliceCp: number[];
  sliceZi: number[];
  /** CP demand withheld by a resource group maximum or discretionary goal management cap. */
  sliceCut: number[];
  /** Index of each slice's dispatch aggregate in `order`. */
  sliceAgg: number[];
  /** Dispatch aggregates: service-class periods, plus `<scKey>~srv` for the transaction-server regions in a period. */
  order: string[];
  aggCp: number[];
  aggZi: number[];
  aggOverflow: boolean[];
}

/**
 * CP part of a slice's backlog, engine-seconds. Each pool keeps its own backlog: CP work left unserved by a cap or a
 * CP shortage cannot drain on idle zIIPs (WLM Planning p.182: capping limits general purpose CPs only).
 */
export function backlogCpSec(s: SliceSpec, backlog: Readonly<Record<string, number>>, ziipBacklog?: Readonly<Record<string, number>>): number {
  const bl = backlog[s.key] ?? 0;
  if (ziipBacklog) return Math.max(0, bl - (ziipBacklog[s.key] ?? 0));
  const tot = s.cpEngines + s.ziipEngines;
  return bl * (tot > 0 ? s.cpEngines / tot : 1);
}

export function prepareLpar(input: Omit<LparEvalInput, 'dpOf'>): PreparedLpar {
  const { slices, backlog, ziipBacklog } = input;
  const n = slices.length;
  // Per-slice demand (new arrivals + backlog drain), then aggregate per service-class
  // period: equal-DP work shares in proportion to demand, so dispatching per period is
  // equivalent to dispatching per slice and much cheaper.
  const sliceCp = new Array<number>(n);
  const sliceZi = new Array<number>(n);
  const sliceCut = new Array<number>(n);
  const sliceAgg = new Array<number>(n);
  const aggIdx: Record<string, number> = {};
  const order: string[] = [];
  const aggCp: number[] = [];
  const aggZi: number[] = [];
  const aggOverflow: boolean[] = [];
  const capOf = input.capOf;
  const servers = input.regions?.servers;
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const bl = backlog[s.key] ?? 0;
    const blCp = backlogCpSec(s, backlog, ziipBacklog);
    const uncapped = s.cpEngines + blCp / TICK_SEC;
    const cp = capOf ? Math.min(uncapped, capOf(s)) : uncapped;
    sliceCut[i] = uncapped - cp;
    const zi = s.ziipEngines + (bl - blCp) / TICK_SEC;
    sliceCp[i] = cp;
    sliceZi[i] = zi;
    const id = servers !== undefined && s.kind === 'AS' && servers.includes(s.key) ? `${s.scKey}${SRV}` : s.scKey;
    let a = aggIdx[id];
    if (a === undefined) {
      a = order.length;
      aggIdx[id] = a;
      order.push(id);
      aggCp.push(0);
      aggZi.push(0);
      aggOverflow.push(s.mayOverflow);
    }
    sliceAgg[i] = a;
    aggCp[a] = aggCp[a]! + cp;
    aggZi[a] = aggZi[a]! + zi;
  }
  return { sliceCp, sliceZi, sliceCut, sliceAgg, order, aggCp, aggZi, aggOverflow };
}

export function evaluateLpar(input: LparEvalInput): LparEvalResult {
  const { slices } = input;
  const n = slices.length;
  const scpsOnly = input.scpsOnly === true;
  const bucketsFor = scpsOnly ? input.bucketsFor : undefined;
  const { sliceCp, sliceZi, sliceCut, sliceAgg, order, aggCp, aggZi, aggOverflow } = input.prepared ?? prepareLpar(input);
  const reg = input.regions;
  // Transaction-server regions run at the DP of the most important transaction class they serve.
  const txnDp = reg ? Math.max(...reg.keys.map((k) => input.dpOf(k))) : 0;
  const regionDp = reg ? (reg.mode === 'REGION' ? input.dpOf(reg.regionKey) : txnDp) : 0;
  // dpOf is pure: look each period up once. Reported DPs are the periods' own.
  const aggDp = order.map((k) => input.dpOf(baseKey(k)));
  const runDp = order.map((k, a) => (k.endsWith(SRV) ? txnDp : reg && reg.keys.includes(k) ? regionDp : aggDp[a]!));
  const sliceDp = new Array<number>(n);
  for (let i = 0; i < n; i++) sliceDp[i] = runDp[sliceAgg[i]!]!;

  const demands: DispatchDemand[] = order.map((k, a) => ({
    id: k,
    dp: runDp[a]!,
    cpEngines: aggCp[a]!,
    ziipEngines: aggZi[a]!,
    ziipMayOverflow: aggOverflow[a]!,
  }));

  // Blocked workload support: ready work that got no CPU for BLWLINTHD (default 20 s) is promoted; BLWLTRPCT
  // (default 0.5%) bounds the promoted capacity (MVS Init & Tuning Ref, IEAOPTxx). APPROX: real promotion gives
  // each promoted unit a fixed slice and BLWLTRPCT limits how many; here the share is split among them.
  const anyPromo = input.promoted !== undefined && input.promoted.size > 0;
  if (anyPromo) {
    const share = (input.promotionShareFrac ?? 0.005) * input.cpCapacityEngines;
    const promotedDemands = demands.filter((d) => input.promoted!.has(d.id));
    const per = promotedDemands.length > 0 ? share / promotedDemands.length : 0;
    for (const d of promotedDemands) {
      const lift = Math.min(per, d.cpEngines);
      if (lift > 0) {
        d.cpEngines -= lift;
        demands.push({ id: `${d.id}~promo`, dp: 253, cpEngines: lift, ziipEngines: 0, ziipMayOverflow: false });
      }
    }
  }

  // Resource group minimum: while the group misses goals, WLM guarantees it up to the minimum
  // even at the expense of more important work (SG24-7621 §4.17; MVS Planning: WLM, ch. 7 "Minimum").
  const minOf = input.minOf;
  if (minOf) {
    for (const d of [...demands]) {
      const m = minOf[d.id];
      if (!m || d.id.endsWith('~promo')) continue;
      const lift = Math.min(m, d.cpEngines);
      if (lift > 0) {
        d.cpEngines -= lift;
        demands.push({ id: `${d.id}~rgmin`, dp: input.discMin?.has(d.id) ? RG_MIN_DISC_DP : RG_MIN_DP, cpEngines: lift, ziipEngines: 0, ziipMayOverflow: false });
      }
    }
  }

  const dres = dispatch({
    cpCapacityEngines: input.cpCapacityEngines,
    cpServers: input.cpServers,
    ziipCapacityEngines: input.ziipCapacityEngines,
    ziipServers: input.ziipServers,
    cpPrsmDelayFrac: input.cpPrsmDelayFrac,
    demands,
  });
  // Results for the periods themselves line up with `order`; promoted/minimum shares follow.
  const extraById: Record<string, DispatchResult> = {};
  for (let j = order.length; j < dres.length; j++) extraById[dres[j]!.id] = dres[j]!;

  // Each slice's share of its period's grant.
  const cpG = new Array<number>(n);
  const ziG = new Array<number>(n);
  const iipcpG = new Array<number>(n);
  const cpUnmetS = new Array<number>(n);
  const ziUnmetS = new Array<number>(n);
  const want = new Array<number>(n);
  const got = new Array<number>(n);
  const health = new Array<number>(n);
  const queueRatio = new Array<number>(n);

  // First pass: address spaces → server health by role.
  const roleHealth: Record<string, { health: number; queueRatio: number }> = {};
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const a = sliceAgg[i]!;
    const r = dres[a]!;
    const own = order[a] === s.scKey;
    const promo = anyPromo && own ? extraById[`${s.scKey}~promo`] : undefined;
    const rgmin = minOf && own ? extraById[`${s.scKey}~rgmin`] : undefined;
    const totCp = aggCp[a]!;
    const totZi = aggZi[a]!;
    const fc = totCp > 0 ? sliceCp[i]! / totCp : 0;
    const fz = totZi > 0 ? sliceZi[i]! / totZi : 0;
    cpG[i] = (r.cpGranted + (promo?.cpGranted ?? 0) + (rgmin?.cpGranted ?? 0)) * fc;
    ziG[i] = r.ziipGranted * fz;
    iipcpG[i] = r.iipcpGranted * fz;
    cpUnmetS[i] = (r.cpUnmet + (promo?.cpUnmet ?? 0) + (rgmin?.cpUnmet ?? 0)) * fc;
    ziUnmetS[i] = r.ziipUnmet * fz;
    want[i] = sliceCp[i]! + sliceZi[i]!;
    got[i] = cpG[i]! + ziG[i]! + iipcpG[i]!;
    // Capped demand is still wanted: a resource group max makes the region non-dispatchable, so its
    // dependents wait on it (WLM Planning p.57, p.60 note 4).
    const wantAll = want[i]! + sliceCut[i]!;
    health[i] = wantAll > 1e-12 ? Math.min(1, got[i]! / wantAll) : 1;
    queueRatio[i] = Math.min(MAX_QUEUE_RATIO, r.cpQueueRatio + r.prsmDelayRatio);
    if (s.kind === 'AS' && s.role) {
      const prev = roleHealth[s.role];
      if (!prev || health[i]! < prev.health) roleHealth[s.role] = { health: health[i]!, queueRatio: queueRatio[i]! };
    }
  }

  // I/O priority management NO "sets I/O priorities equal to dispatching priorities" (WLM Planning p.115), so
  // the IOSQ is DP-ordered either way. APPROX: YES (goal-based I/O priorities) is not modelled and also uses DP.
  const prio = iosqByPriority(slices, sliceDp, input.io);
  const pgBy = slicePagingFrac(slices, input.pagingFrac, input.storageCritical, input.pagingWeight);

  const results = new Array<SliceResult>(n);
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const r = dres[sliceAgg[i]!]!;
    const cpGranted = cpG[i]!;
    const ziipGranted = ziG[i]!;
    const iipcpGranted = iipcpG[i]!;
    const qr = queueRatio[i]!;
    const zq = Math.min(MAX_QUEUE_RATIO, r.ziipQueueRatio);
    const cpUsing = cpGranted + iipcpGranted;
    // LPAR capping (soft or absolute) shows as CPU delay; CAP delay is resource-group and discretionary
    // capping only, "not part of the CPU delay" (RMF Report Analysis p.540).
    const unmetCp = cpUnmetS[i]!;
    const cut = sliceCut[i]!;
    const capDelay = cut;
    const unmetZiip = ziUnmetS[i]!;

    const io = prio?.[s.ioClass]?.[i] ?? input.io[s.ioClass];
    const pg = pgBy[i]!;
    if (s.kind === 'AS') {
      results[i] = {
        key: s.key,
        scKey: s.scKey,
        cpGranted,
        ziipGranted,
        iipcpGranted,
        usingCpu: cpUsing,
        usingZiip: ziipGranted,
        usingIo: s.ioRate * ioUsingSec(io),
        delayCpu: cpUsing * qr + unmetCp,
        delayZiip: ziipGranted * zq + unmetZiip,
        delayIo: s.ioRate * io.delaySec,
        delayOther: 0,
        delayStorage: (cpUsing + ziipGranted) * pg,
        delayCap: capDelay,
        completions: 0,
        failed: 0,
        rtMeanSec: 0,
        holdSec: 0,
        userRtSec: 0,
        parts: null,
        newBacklog: 0,
        newZiipBacklog: 0,
        health: health[i]!,
        queueRatio: qr,
        withinSla: 0,
      };
      continue;
    }

    // Transactions: backlog of unserved work and Little's-law wait.
    const wantSec = (want[i]! + cut) * TICK_SEC;
    const gotSec = got[i]! * TICK_SEC;
    let newBacklog = Math.max(0, wantSec - gotSec);
    const rawBacklog = newBacklog;
    const rawZiipBacklog = Math.min(rawBacklog, Math.max(0, sliceZi[i]! - ziG[i]! - iipcpG[i]!) * TICK_SEC);
    const gotRate = Math.max(got[i]!, 1e-9);
    let waitSec = newBacklog / gotRate;
    const workPerTxn = s.cpuSecPerTxn + s.ziipSecPerTxn;
    let failed = 0;
    if (s.maxQueueMsgs !== undefined) {
      // MQ: messages wait on the queue; only puts beyond MAXDEPTH fail (MQRC_Q_FULL). Messages already queued
      // above a lowered MAXDEPTH "remain intact" and drain (MQ 9.4 Administration Reference p.463).
      const cap = s.maxQueueMsgs * workPerTxn;
      if (workPerTxn > 0 && newBacklog > cap) {
        const keep = Math.min(newBacklog, Math.max(cap, (input.backlog[s.key] ?? 0) - gotSec));
        failed = (newBacklog - keep) / workPerTxn;
        newBacklog = keep;
        waitSec = newBacklog / gotRate;
      }
      // A starved queue: messages completing now waited about as long as the backlog took to build
      // (Little's law on arrivals), not backlog / a near-zero service rate.
      if (got[i]! < 1e-3 * (want[i]! + cut)) waitSec = Math.min(waitSec, newBacklog / Math.max(want[i]! + cut, 1e-9));
    } else if (waitSec > s.timeoutSec) {
      const keep = gotRate * s.timeoutSec;
      const excess = newBacklog - keep;
      newBacklog = keep;
      waitSec = s.timeoutSec;
      failed = workPerTxn > 0 ? excess / workPerTxn : 0;
    }

    let depDelay = 0;
    for (const srv of s.servers) {
      const h = roleHealth[srv.role];
      if (!h) continue;
      depDelay += srv.latencySec * (1 / Math.max(h.health, 0.02) - 1 + h.queueRatio);
    }

    const ioSec = s.ioPerTxn * io.rtSec;
    const pagingSec = (s.cpuSecPerTxn + s.ziipSecPerTxn) * pg * 3;
    const otherSec = depDelay + s.extraOtherSec;
    const rt =
      s.baseLatencySec +
      s.cpuSecPerTxn * (1 + qr) +
      s.ziipSecPerTxn * (1 + zq) +
      ioSec +
      pagingSec +
      otherSec +
      waitSec;

    const arrivals = s.rate * TICK_SEC;
    const subsysFailed = arrivals * s.failFrac;
    // A transaction fails once: subsystem rejections and timeouts together are bounded by arrivals.
    failed = Math.min(arrivals, failed + subsysFailed);
    const completions = arrivals - failed;
    const ioRate = s.rate * s.ioPerTxn;
    results[i] = {
      key: s.key,
      scKey: s.scKey,
      cpGranted,
      ziipGranted,
      iipcpGranted,
      usingCpu: cpUsing,
      usingZiip: ziipGranted,
      usingIo: ioRate * ioUsingSec(io),
      delayCpu: cpUsing * qr + unmetCp,
      delayZiip: ziipGranted * zq + unmetZiip,
      delayIo: ioRate * io.delaySec,
      delayOther: s.rate * otherSec,
      delayStorage: s.rate * pagingSec,
      delayCap: capDelay,
      completions,
      failed,
      rtMeanSec: rt,
      holdSec: rt - waitSec,
      userRtSec: rt + s.outsideWaitSec,
      parts: scpsOnly
        ? null
        : {
            base: s.baseLatencySec,
            cpu: s.cpuSecPerTxn + s.ziipSecPerTxn,
            cpuQueue: s.cpuSecPerTxn * qr,
            ziip: s.ziipSecPerTxn * zq,
            io: ioSec,
            paging: pagingSec,
            dependency: depDelay,
            extra: s.extraParts ?? { other: s.extraOtherSec },
            backlogWait: waitSec,
            outside: s.outsideWaitSec,
            outsideRef: s.outsideRefSec ?? 0,
          },
      newBacklog,
      newZiipBacklog: rawBacklog > 0 ? (rawZiipBacklog * newBacklog) / rawBacklog : 0,
      health: 1,
      queueRatio: qr,
      withinSla: !scpsOnly && s.slaRtSec !== null ? completions * lognormCdf(s.slaRtSec, rt + s.outsideWaitSec, s.rtSigma) : 0,
    };
  }

  // One tick per period: transaction-server regions are reported with their own class (WLM Planning p.113).
  const scps: ScpTick[] = [];
  const scpOfAgg = new Array<number>(order.length);
  const scpIdx: Record<string, number> = {};
  for (let a = 0; a < order.length; a++) {
    const k = baseKey(order[a]!);
    let j = scpIdx[k];
    if (j === undefined) {
      j = scps.length;
      scpIdx[k] = j;
      scps.push(emptyScpTick(k, aggDp[a]!));
    }
    scpOfAgg[a] = j;
  }
  const rcMap: Record<string, ReportClassTick> = {};
  const rcs: ReportClassTick[] = [];
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const r = results[i]!;
    if (s.reportClass && !scpsOnly) {
      let rt = rcMap[s.reportClass];
      if (!rt) {
        rt = { ...emptyScpTick(s.reportClass, 0), members: [] };
        rcMap[s.reportClass] = rt;
        rcs.push(rt);
      }
      if (!rt.members.includes(s.scKey)) rt.members.push(s.scKey);
      addSliceTo(rt, s, r, true);
    }
    const t = scps[scpOfAgg[sliceAgg[i]!]!]!;
    addSliceTo(t, s, r, bucketsFor === undefined || bucketsFor.has(s.scKey));
    if (order[sliceAgg[i]!] !== s.scKey) {
      // Not managed to its own class's goal: its samples stay out of the class's PI (WLM Planning p.122).
      t.srvUsing = (t.srvUsing ?? 0) + r.usingCpu + r.usingZiip + (input.ioPriority === false ? 0 : r.usingIo);
      t.srvDelay = (t.srvDelay ?? 0) + r.delayCpu + r.delayZiip + (input.ioPriority === false ? 0 : r.delayIo) + r.delayStorage + r.delayCap;
    }
  }
  // With I/O priority management off, I/O using and delay samples are still reported but "not included" in
  // the velocity formula (WLM Planning p.70, p.115).
  if (input.ioPriority === false) {
    for (const t of scps) excludeIoFromVelocity(t);
    for (const t of rcs) excludeIoFromVelocity(t);
  }

  return rcs.length > 0 ? { slices: results, scps, roleHealth, rcs } : { slices: results, scps, roleHealth };
}

function excludeIoFromVelocity(t: ScpTick): void {
  t.usingIoNoVel = t.usingIo;
  t.delayIoNoVel = t.delayIo;
}

function addSliceTo(t: ScpTick, s: SliceSpec, r: SliceResult, buckets: boolean): void {
  t.cpEngines += r.cpGranted;
  t.ziipEngines += r.ziipGranted;
  t.iipcpEngines += r.iipcpGranted;
  t.usingCpu += r.usingCpu;
  t.usingZiip += r.usingZiip;
  t.usingIo += r.usingIo;
  t.delayCpu += r.delayCpu;
  t.delayZiip += r.delayZiip;
  t.delayIo += r.delayIo;
  t.delayOther += r.delayOther;
  t.delayStorage += r.delayStorage;
  t.delayCap += r.delayCap;
  t.completions += r.completions;
  t.failed += r.failed;
  t.rtSumSec += r.completions * r.rtMeanSec;
  if (buckets && s.goalRtSec !== null) addToBuckets(t.buckets, s.goalRtSec, r.completions, r.rtMeanSec, s.rtSigma);
}

/** Per-slice paging delay fraction. Storage-critical periods page nothing; the paging they avoid moves to the
 * unprotected periods in proportion to demand × steal weight, so the image's total stays the same (Storage
 * Critical keeps frames by taking them from less important work, WLM Planning p.119). APPROX: activity
 * (CP + zIIP demand) stands in for frames held. */
export function slicePagingFrac(
  slices: readonly SliceSpec[],
  pagingFrac: number,
  storageCritical: ReadonlySet<string> | undefined,
  weightOf: Readonly<Record<string, number>> | undefined,
): number[] {
  const n = slices.length;
  const out = new Array<number>(n).fill(pagingFrac);
  if (!storageCritical || storageCritical.size === 0) return out;
  let keptAct = 0;
  let stealDen = 0;
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const act = s.cpEngines + s.ziipEngines;
    if (storageCritical.has(s.scKey)) keptAct += act;
    else stealDen += act * (weightOf?.[s.scKey] ?? 1);
  }
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    if (storageCritical.has(s.scKey)) out[i] = 0;
    else if (stealDen > 0) {
      const extra = (pagingFrac * keptAct * (weightOf?.[s.scKey] ?? 1)) / stealDen;
      out[i] = Math.min(Math.max(pagingFrac, STORAGE_STEAL_MAX_FRAC), pagingFrac + extra);
    }
  }
  return out;
}
