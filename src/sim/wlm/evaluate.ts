// Per-LPAR evaluation for one tick: dispatch every slice at its service-class
// period's DP, then derive response times, dependency delays and WLM using/delay
// samples. Pure, so policy adjustment can re-run it to project the effect of a DP move.

import { lognormCdf } from '../core/math';
import { TICK_SEC } from '../core/units';
import { dispatch, type DispatchDemand } from '../zos/dispatcher';
import { addToBuckets, emptyBuckets } from './goals';

import type { IoClass } from '../io/dasd';

const MAX_QUEUE_RATIO = 50;

/** Per-class I/O service seen by this image. APPROX: connect + disconnect count as
 * I/O using; IOSQ + pend count as I/O delay. */
export interface IoService {
  rtSec: number;
  delaySec: number;
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
  /** Queueing before the work manager sees the request (MXT, DBAT): end users feel it,
   * WLM and RMF response times do not include it. */
  outsideWaitSec: number;
  /** Diagnostic split of extraOtherSec (e.g. cf, lock, qr). */
  extraParts?: Record<string, number>;
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
  dpOf: (scKey: string) => number;
  /** Optional per-slice CP cap (resource group maximums), engines. */
  capOf?: (slice: SliceSpec) => number;
  io: Record<IoClass, IoService>;
  /** Paging delay fraction on this image (storage-critical classes are exempt). */
  pagingFrac: number;
  /** Fraction of the image's CP demand withheld by capping this tick. */
  cappedFrac?: number;
  storageCritical?: ReadonlySet<string>;
  /** Service-class periods starved past BLWLINTHD, eligible for promotion. */
  promoted?: ReadonlySet<string>;
  promotionShareFrac?: number;
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
  /** Response time as end users see it (adds pre-work-manager queueing). */
  userRtSec: number;
  parts: RtParts | null;
  newBacklog: number;
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
  completions: number;
  failed: number;
  rtSumSec: number;
  buckets: number[];
}

export interface LparEvalResult {
  slices: SliceResult[];
  scps: ScpTick[];
  roleHealth: Record<string, { health: number; queueRatio: number }>;
}

export function evaluateLpar(input: LparEvalInput): LparEvalResult {
  const { slices, backlog } = input;

  // Per-slice demand (new arrivals + backlog drain), then aggregate per service-class
  // period: equal-DP work shares in proportion to demand, so dispatching per period is
  // equivalent to dispatching per slice and much cheaper.
  const sliceCp: number[] = [];
  const sliceZi: number[] = [];
  const agg: Record<string, { cp: number; zi: number; overflow: boolean }> = {};
  const order: string[] = [];
  slices.forEach((s) => {
    const bl = backlog[s.key] ?? 0;
    const tot = s.cpEngines + s.ziipEngines;
    const blRate = bl / TICK_SEC;
    const cpShare = tot > 0 ? s.cpEngines / tot : 1;
    let cp = s.cpEngines + blRate * cpShare;
    if (input.capOf) cp = Math.min(cp, input.capOf(s));
    const zi = s.ziipEngines + blRate * (1 - cpShare);
    sliceCp.push(cp);
    sliceZi.push(zi);
    let a = agg[s.scKey];
    if (!a) {
      a = { cp: 0, zi: 0, overflow: s.mayOverflow };
      agg[s.scKey] = a;
      order.push(s.scKey);
    }
    a.cp += cp;
    a.zi += zi;
  });

  const demands: DispatchDemand[] = order.map((k) => ({
    id: k,
    dp: input.dpOf(k),
    cpEngines: agg[k]!.cp,
    ziipEngines: agg[k]!.zi,
    ziipMayOverflow: agg[k]!.overflow,
  }));

  // Blocked workload support: a small promoted share for starved work (IEAOPT BLWLTRPCT).
  if (input.promoted && input.promoted.size > 0) {
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

  const dres = dispatch({
    cpCapacityEngines: input.cpCapacityEngines,
    cpServers: input.cpServers,
    ziipCapacityEngines: input.ziipCapacityEngines,
    ziipServers: input.ziipServers,
    cpPrsmDelayFrac: input.cpPrsmDelayFrac,
    demands,
  });
  const byId: Record<string, (typeof dres)[number]> = {};
  for (const r of dres) byId[r.id] = r;

  interface Share {
    cpGranted: number;
    ziipGranted: number;
    iipcpGranted: number;
    cpUnmet: number;
    ziipUnmet: number;
    cpQueueRatio: number;
    ziipQueueRatio: number;
    prsmDelayRatio: number;
  }
  const anyPromo = input.promoted !== undefined && input.promoted.size > 0;
  const shareOf = (i: number): Share => {
    const s = slices[i]!;
    const a = agg[s.scKey]!;
    const r = byId[s.scKey]!;
    const promo = anyPromo ? byId[`${s.scKey}~promo`] : undefined;
    const totCp = a.cp;
    const fc = totCp > 0 ? sliceCp[i]! / totCp : 0;
    const fz = a.zi > 0 ? sliceZi[i]! / a.zi : 0;
    return {
      cpGranted: (r.cpGranted + (promo?.cpGranted ?? 0)) * fc,
      ziipGranted: r.ziipGranted * fz,
      iipcpGranted: r.iipcpGranted * fz,
      cpUnmet: (r.cpUnmet + (promo?.cpUnmet ?? 0)) * fc,
      ziipUnmet: r.ziipUnmet * fz,
      cpQueueRatio: r.cpQueueRatio,
      ziipQueueRatio: r.ziipQueueRatio,
      prsmDelayRatio: r.prsmDelayRatio,
    };
  };

  // First pass: address spaces → server health by role.
  const roleHealth: Record<string, { health: number; queueRatio: number }> = {};
  const prelim = slices.map((s, i) => {
    const r = shareOf(i);
    const want = sliceCp[i]! + sliceZi[i]!;
    const got = r.cpGranted + r.ziipGranted + r.iipcpGranted;
    const health = want > 1e-12 ? Math.min(1, got / want) : 1;
    const queueRatio = Math.min(MAX_QUEUE_RATIO, r.cpQueueRatio + r.prsmDelayRatio);
    if (s.kind === 'AS' && s.role) {
      const prev = roleHealth[s.role];
      if (!prev || health < prev.health) roleHealth[s.role] = { health, queueRatio };
    }
    return { r, cpGranted: r.cpGranted, want, got, health, queueRatio };
  });

  const results: SliceResult[] = slices.map((s, i) => {
    const { r, cpGranted, want, got, health, queueRatio } = prelim[i]!;
    const zq = Math.min(MAX_QUEUE_RATIO, r.ziipQueueRatio);
    const cpUsing = cpGranted + r.iipcpGranted;
    // APPROX: while an image is capped, most of its undispatched ready work is waiting
    // on the cap rather than on priority.
    const capFrac = Math.min(1, 4 * (input.cappedFrac ?? 0));
    const unmetCp = r.cpUnmet * (1 - capFrac);
    const capDelay = r.cpUnmet * capFrac;
    const unmetZiip = r.ziipUnmet;

    const io = input.io[s.ioClass];
    const pg = input.storageCritical?.has(s.scKey) ? 0 : input.pagingFrac;
    if (s.kind === 'AS') {
      return {
        key: s.key,
        scKey: s.scKey,
        cpGranted,
        ziipGranted: r.ziipGranted,
        iipcpGranted: r.iipcpGranted,
        usingCpu: cpUsing,
        usingZiip: r.ziipGranted,
        usingIo: s.ioRate * (io.rtSec - io.delaySec),
        delayCpu: cpUsing * queueRatio + unmetCp,
        delayZiip: r.ziipGranted * zq + unmetZiip,
        delayIo: s.ioRate * io.delaySec,
        delayOther: 0,
        delayStorage: (cpUsing + r.ziipGranted) * pg,
        delayCap: capDelay,
        completions: 0,
        failed: 0,
        rtMeanSec: 0,
        userRtSec: 0,
        parts: null,
        newBacklog: 0,
        health,
        queueRatio,
        withinSla: 0,
      };
    }

    // Transactions: backlog of unserved work and Little's-law wait.
    const wantSec = want * TICK_SEC;
    const gotSec = got * TICK_SEC;
    let newBacklog = Math.max(0, wantSec - gotSec);
    const gotRate = Math.max(got, 1e-9);
    let waitSec = newBacklog / gotRate;
    const workPerTxn = s.cpuSecPerTxn + s.ziipSecPerTxn;
    let failed = 0;
    if (waitSec > s.timeoutSec) {
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
      s.cpuSecPerTxn * (1 + queueRatio) +
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
    return {
      key: s.key,
      scKey: s.scKey,
      cpGranted,
      ziipGranted: r.ziipGranted,
      iipcpGranted: r.iipcpGranted,
      usingCpu: cpUsing,
      usingZiip: r.ziipGranted,
      usingIo: ioRate * (io.rtSec - io.delaySec),
      delayCpu: cpUsing * queueRatio + unmetCp,
      delayZiip: r.ziipGranted * zq + unmetZiip,
      delayIo: ioRate * io.delaySec,
      delayOther: s.rate * otherSec,
      delayStorage: s.rate * pagingSec,
      delayCap: capDelay,
      completions,
      failed,
      rtMeanSec: rt,
      userRtSec: rt + s.outsideWaitSec,
      parts: {
        base: s.baseLatencySec,
        cpu: s.cpuSecPerTxn + s.ziipSecPerTxn,
        cpuQueue: s.cpuSecPerTxn * queueRatio,
        ziip: s.ziipSecPerTxn * zq,
        io: ioSec,
        paging: pagingSec,
        dependency: depDelay,
        extra: s.extraParts ?? { other: s.extraOtherSec },
        backlogWait: waitSec,
        outside: s.outsideWaitSec,
      },
      newBacklog,
      health: 1,
      queueRatio,
      withinSla: s.slaRtSec !== null ? completions * lognormCdf(s.slaRtSec, rt + s.outsideWaitSec, s.rtSigma) : 0,
    };
  });

  const scpMap: Record<string, ScpTick> = {};
  const scps: ScpTick[] = [];
  slices.forEach((s, i) => {
    const r = results[i]!;
    let t = scpMap[s.scKey];
    if (!t) {
      t = {
        scKey: s.scKey,
        dp: input.dpOf(s.scKey),
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
      };
      scpMap[s.scKey] = t;
      scps.push(t);
    }
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
    if (s.goalRtSec !== null) addToBuckets(t.buckets, s.goalRtSec, r.completions, r.rtMeanSec, s.rtSigma);
  });

  return { slices: results, scps, roleHealth };
}
