// DASD subsystem model (SPEC §5.7): response time = IOSQ + PEND + DISC + CONN.
// IOSQ comes from device queueing with HyperPAV aliases; PEND from fabric/host-adapter
// utilisation; DISC from cache misses against a back end; CONN from transfer size.

import { queueDelayRatio } from '../zos/erlang';

export type IoClass = 'RANDOM' | 'SEQ';

export interface DasdConfig {
  /** Volumes carrying active data (spread of the I/O load). */
  activeVolumes: number;
  /** HyperPAV alias pool shared by the active volumes. */
  aliasPool: number;
  /** FICON / host adapter capacity, I/Os per second. */
  fabricCapacityIops: number;
  /** Back-end (flash array) capacity for cache misses, I/Os per second. */
  backendCapacityIops: number;
  cacheHitFrac: Record<IoClass, number>;
  connectSec: Record<IoClass, number>;
  backendLatencySec: number;
  pendBaseSec: number;
  /** Share of I/O landing on the busiest 10% of volumes (hot-spot skew). */
  hotSkew: number;
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

export interface DasdResult {
  totalIops: number;
  fabricBusyFrac: number;
  backendBusyFrac: number;
  aliasesPerHotVolume: number;
  classes: Record<IoClass, IoClassResult>;
}

const MAX_RHO = 0.97;

export function evaluateDasd(cfg: DasdConfig, iops: Record<IoClass, number>): DasdResult {
  const total = iops.RANDOM + iops.SEQ;
  const fabricBusy = Math.min(MAX_RHO, total / cfg.fabricCapacityIops);
  const misses = iops.RANDOM * (1 - cfg.cacheHitFrac.RANDOM) + iops.SEQ * (1 - cfg.cacheHitFrac.SEQ);
  const backendBusy = Math.min(MAX_RHO, misses / cfg.backendCapacityIops);
  const pend = cfg.pendBaseSec / (1 - fabricBusy);
  const backend = (cfg.backendLatencySec * cfg.backendDegrade) / (1 - backendBusy);

  // Hot volumes: the top 10% of volumes carry `hotSkew` of the I/O.
  const hotVolumes = Math.max(1, Math.round(cfg.activeVolumes * 0.1));
  const hotRatePerVol = (total * cfg.hotSkew) / hotVolumes;
  // HyperPAV aliases are assigned dynamically; hot volumes get the lion's share.
  const aliasesPerHot = Math.min(16, (cfg.aliasPool * 0.7) / hotVolumes);

  const classes = {} as Record<IoClass, IoClassResult>;
  for (const cls of ['RANDOM', 'SEQ'] as const) {
    const disc = (1 - cfg.cacheHitFrac[cls]) * backend;
    const conn = cfg.connectSec[cls];
    const service = pend + disc + conn;
    // A hot volume can drive its base exposure plus borrowed aliases; interpolate the
    // M/M/c queue between integer exposure counts.
    const exposures = 1 + aliasesPerHot;
    const lo = Math.floor(exposures);
    const frac = exposures - lo;
    const q = (c: number) => queueDelayRatio(c, (hotRatePerVol * service) / c);
    const qRatio = q(lo) * (1 - frac) + q(lo + 1) * frac;
    // Only the hot share of I/O sees meaningful queueing.
    const iosq = cfg.hotSkew * service * qRatio;
    classes[cls] = { rtSec: iosq + pend + disc + conn, iosqSec: iosq, pendSec: pend, discSec: disc, connSec: conn };
  }
  return { totalIops: total, fabricBusyFrac: fabricBusy, backendBusyFrac: backendBusy, aliasesPerHotVolume: aliasesPerHot, classes };
}
