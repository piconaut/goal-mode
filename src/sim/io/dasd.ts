// DASD subsystem model (SPEC §5.7): response time = IOSQ + PEND + DISC + CONN.
// IOSQ comes from device queueing with HyperPAV aliases; PEND from fabric/host-adapter
// utilisation; DISC from cache misses against a back end; CONN from transfer size.

import { queueDelayRatio } from '../zos/erlang';

export type IoClass = 'RANDOM' | 'SEQ';

/** An LCU addresses 256 unit addresses: base volumes plus HyperPAV aliases. */
export const LCU_MAX_DEVICES = 256;

/** Logical control unit: HyperPAV aliases are pooled per LCU and cannot be borrowed across LCUs. */
export interface LcuConfig {
  id: string;
  /** What lives here, for reports. */
  label: string;
  volumes: number;
  aliases: number;
  /** Share of the sysplex's I/O per class that lands on this LCU (each class sums to 1). */
  ioShare: Record<IoClass, number>;
  /** Share of the LCU's I/O on its busiest 10% of volumes (hot spots). */
  hotSkew: number;
  /** I/O beyond the modelled workloads (utilities, events), per second; it lands on the hot volumes. */
  extraIops?: Partial<Record<IoClass, number>>;
}

export interface DasdConfig {
  lcus: LcuConfig[];
  /** HyperPAV aliases defined but not yet assigned to an LCU (bought, or freed by a reassignment). */
  spareAliases: number;
  /** FICON / host adapter capacity, I/Os per second. */
  fabricCapacityIops: number;
  /** Back-end (flash array) capacity for cache misses, I/Os per second. */
  backendCapacityIops: number;
  cacheHitFrac: Record<IoClass, number>;
  connectSec: Record<IoClass, number>;
  backendLatencySec: number;
  pendBaseSec: number;
  /** Degradation multiplier on back-end latency (events). */
  backendDegrade: number;
}

export interface IoClassResult {
  rtSec: number;
  iosqSec: number;
  pendSec: number;
  discSec: number;
  connSec: number;
}

export interface LcuResult {
  id: string;
  iops: number;
  /** I/O-weighted IOSQ across classes. */
  iosqSec: number;
  rtSec: number;
  hotRatePerVol: number;
  aliasesPerHotVolume: number;
}

export interface DasdResult {
  totalIops: number;
  fabricBusyFrac: number;
  backendBusyFrac: number;
  classes: Record<IoClass, IoClassResult>;
  lcus: LcuResult[];
}

const MAX_RHO = 0.97;

export function evaluateDasd(cfg: DasdConfig, iops: Record<IoClass, number>): DasdResult {
  const CLASSES = ['RANDOM', 'SEQ'] as const;
  const extraOf = (l: LcuConfig) => ({ RANDOM: l.extraIops?.RANDOM ?? 0, SEQ: l.extraIops?.SEQ ?? 0 });
  const lcuIops = cfg.lcus.map((l) => ({ RANDOM: iops.RANDOM * l.ioShare.RANDOM + extraOf(l).RANDOM, SEQ: iops.SEQ * l.ioShare.SEQ + extraOf(l).SEQ }));
  const byClass = { RANDOM: lcuIops.reduce((a, x) => a + x.RANDOM, 0), SEQ: lcuIops.reduce((a, x) => a + x.SEQ, 0) };
  const total = byClass.RANDOM + byClass.SEQ;
  const fabricBusy = Math.min(MAX_RHO, total / cfg.fabricCapacityIops);
  const misses = byClass.RANDOM * (1 - cfg.cacheHitFrac.RANDOM) + byClass.SEQ * (1 - cfg.cacheHitFrac.SEQ);
  const backendBusy = Math.min(MAX_RHO, misses / cfg.backendCapacityIops);
  const pend = cfg.pendBaseSec / (1 - fabricBusy);
  const backend = (cfg.backendLatencySec * cfg.backendDegrade) / (1 - backendBusy);
  const service = {} as Record<IoClass, { disc: number; conn: number; svc: number }>;
  for (const cls of CLASSES) {
    const disc = (1 - cfg.cacheHitFrac[cls]) * backend;
    const conn = cfg.connectSec[cls];
    service[cls] = { disc, conn, svc: pend + disc + conn };
  }

  // Per LCU: the hottest 10% of volumes carry `hotSkew` of its organic I/O plus all utility I/O,
  // and share its alias pool.
  const iosqSum = { RANDOM: 0, SEQ: 0 };
  const lcus: LcuResult[] = cfg.lcus.map((l, i) => {
    const io = lcuIops[i]!;
    const lTotal = io.RANDOM + io.SEQ;
    const extra = extraOf(l);
    const extraTotal = extra.RANDOM + extra.SEQ;
    const hotIops = (lTotal - extraTotal) * l.hotSkew + extraTotal;
    const hotFrac = lTotal > 0 ? hotIops / lTotal : l.hotSkew;
    const hotVolumes = Math.max(1, Math.round(l.volumes * 0.1));
    const hotRatePerVol = hotIops / hotVolumes;
    // HyperPAV aliases are assigned dynamically; hot volumes get the lion's share.
    const aliasesPerHot = Math.min(16, (l.aliases * 0.7) / hotVolumes);
    const exposures = 1 + aliasesPerHot;
    const lo = Math.floor(exposures);
    const frac = exposures - lo;
    let iosqW = 0;
    for (const cls of CLASSES) {
      const svc = service[cls].svc;
      // Interpolate the M/M/c queue between integer exposure counts.
      const q = (c: number) => queueDelayRatio(c, (hotRatePerVol * svc) / c);
      const qRatio = q(lo) * (1 - frac) + q(lo + 1) * frac;
      // Only the I/O on hot volumes sees meaningful queueing.
      const iosq = hotFrac * svc * qRatio;
      iosqSum[cls] += io[cls] * iosq;
      iosqW += io[cls] * iosq;
    }
    const iosqSec = lTotal > 0 ? iosqW / lTotal : 0;
    const svcAvg = lTotal > 0 ? (io.RANDOM * service.RANDOM.svc + io.SEQ * service.SEQ.svc) / lTotal : service.RANDOM.svc;
    return { id: l.id, iops: lTotal, iosqSec, rtSec: iosqSec + svcAvg, hotRatePerVol, aliasesPerHotVolume: aliasesPerHot };
  });

  const classes = {} as Record<IoClass, IoClassResult>;
  for (const cls of CLASSES) {
    const iosq = byClass[cls] > 0 ? iosqSum[cls] / byClass[cls] : 0;
    const { disc, conn } = service[cls];
    classes[cls] = { rtSec: iosq + pend + disc + conn, iosqSec: iosq, pendSec: pend, discSec: disc, connSec: conn };
  }
  return { totalIops: total, fabricBusyFrac: fabricBusy, backendBusyFrac: backendBusy, classes, lcus };
}
