// Coupling facility model (SPEC §5.9). Request rate × cost → CF utilisation; sync
// service time stretches with utilisation and, on shared CF engines, with dispatch
// latency. z/OS converts slow sync requests to async (heuristic); sync requests spin
// on the z/OS CP for their whole service time, async ones cost a fixed CPU overhead.

import { CF_ASYNC_THRESHOLD_MULT, CF_DUPLEX, CF_FAILURE, CF_LINK_ROUND_TRIP_SEC_PER_KM } from '../../content/cf';

export interface CfConfig {
  lparId: string;
  /** Dynamic CF dispatching with thin interrupts (only matters on shared engines). */
  thinInterrupts: boolean;
  /** Link/hardware degradation multiplier on service time (events), default 1. */
  degrade?: number;
  /** The CF image is down (hardware failure); its structures were rebuilt elsewhere or lost. */
  failed?: boolean;
}

/** LOCK (IRLM lock), CACHE (Db2 group buffer pools) or LIST (XCF signalling, SCA, MQ). */
export type CfStructureType = 'LOCK' | 'CACHE' | 'LIST';

export interface CfStructureConfig {
  name: string;
  type: CfStructureType;
  /** Share of the sysplex's CF requests that go to this structure. */
  requestShare: number;
  /** CF image the structure is allocated in (SETXCF REBUILD moves it). */
  cfLparId: string;
  /** CF CPU per request relative to the average request. */
  costMult: number;
  /** CF storage the structure occupies (and again on the secondary when duplexed). */
  sizeGb?: number;
  /** CFRM preference list: CFs a rebuild may use, in order. */
  prefList?: string[];
  /** Duplexed into the next CF on its preference list (system-managed for LOCK/LIST, user-managed GBP). */
  duplexed?: boolean;
  /** Lost in a CF failure with nowhere to rebuild: requesters cannot use it until it is reallocated. */
  lost?: boolean;
  /** Rebuild in progress: requests stall until this tick. */
  rebuildUntilTick?: number;
  /** What its loss does to the work that uses it. */
  lostImpact?: 'DB2_DOWN' | 'DB2_GRECP' | 'MQ_DOWN' | 'NONE';
}

export interface CfStructureResult {
  name: string;
  type: CfStructureType;
  cfLparId: string;
  requestRate: number;
  syncSec: number;
  asyncFrac: number;
  serviceSec: number;
  zosCpuSec: number;
  /** Duplexed structure: PRIM on the primary's CF, SEC for the copy (RMF Usage Summary status). Absent when simplex. */
  role?: 'PRIM' | 'SEC';
}

export interface CfTunables {
  cpuSecPerRequest: number;
  linkSyncSec: number;
  asyncBaseSec: number;
  asyncZosCpuSec: number;
  /** Sync service time above which z/OS starts converting to async. */
  syncThresholdSec: number;
  /** Expected wait for a shared CF logical CP to be dispatched, by thin-interrupt mode. */
  sharedDispatchWaitSec: { thin: number; polling: number };
}

export interface CfImageInput {
  cfg: CfConfig;
  /** Physical ICF engines delivered / available to the CF image. */
  availableEngines: number;
  entitlementEngines: number;
  dedicated: boolean;
}

export interface CfResult {
  lparId: string;
  requestRate: number;
  demandEngines: number;
  busyFrac: number;
  syncSec: number;
  asyncFrac: number;
  /** Average elapsed per request seen by the requester. */
  serviceSec: number;
  /** z/OS CPU per request: spin time for sync, overhead for async. */
  zosCpuSec: number;
  structures: CfStructureResult[];
  /** Secondary copies of duplexed structures held here (reporting only): each duplexed request also drives
   *  them, so they carry the primary's request rate (writes only for a GBP) and its duplexed service time. */
  secondaries?: CfStructureResult[];
}

/** Share of a duplexed structure's requests that also go to the secondary: GBP duplexing copies only writes. */
const duplexFrac = (x: CfStructureConfig) => (x.type === 'CACHE' ? CF_DUPLEX.cacheWriteFrac : 1);

/** Where a duplexed structure's secondary copy lives: the next CF on its preference list that is up. */
export function duplexSecondary(x: CfStructureConfig, upCfs: readonly string[]): string | null {
  if (!x.duplexed) return null;
  return (x.prefList ?? upCfs).find((id) => id !== x.cfLparId && upCfs.includes(id)) ?? null;
}

export function evaluateCf(images: readonly CfImageInput[], structures: readonly CfStructureConfig[], totalRequestRate: number, t: CfTunables): CfResult[] {
  const up = images.map((im) => im.cfg.lparId);
  // CF CPU demand per image, including the secondary copies of duplexed structures.
  const demandBy: Record<string, number> = {};
  for (const x of structures) {
    if (x.lost || !up.includes(x.cfLparId)) continue;
    const d = totalRequestRate * x.requestShare * t.cpuSecPerRequest * x.costMult;
    demandBy[x.cfLparId] = (demandBy[x.cfLparId] ?? 0) + d;
    const sec = duplexSecondary(x, up);
    if (sec) demandBy[sec] = (demandBy[sec] ?? 0) + d * duplexFrac(x);
  }
  const busyOf: Record<string, number> = {};
  const waitOf: Record<string, number> = {};
  for (const im of images) {
    busyOf[im.cfg.lparId] = Math.min(0.97, (demandBy[im.cfg.lparId] ?? 0) / Math.max(1e-6, im.availableEngines));
    // A shared CF logical CP is not always dispatched when a request arrives.
    const undispatched = im.dedicated ? 0 : Math.max(0, 1 - Math.min(1, im.entitlementEngines));
    waitOf[im.cfg.lparId] = undispatched * (im.cfg.thinInterrupts ? t.sharedDispatchWaitSec.thin : t.sharedDispatchWaitSec.polling);
  }
  const syncAt = (cfId: string, costMult: number) => {
    const im = images.find((i) => i.cfg.lparId === cfId)!;
    return (t.linkSyncSec + (t.cpuSecPerRequest * costMult) / (1 - busyOf[cfId]!)) * (im.cfg.degrade ?? 1) + waitOf[cfId]!;
  };
  const resultOf = (x: CfStructureConfig): CfStructureResult => {
    const id = x.cfLparId;
    const sec = duplexSecondary(x, up);
    // Duplexed: the request completes when both copies have it.
    const sync = sec ? Math.max(syncAt(id, x.costMult), syncAt(sec, x.costMult)) * CF_DUPLEX.syncMult : syncAt(id, x.costMult);
    // Heuristic conversion (z/OS 1.2+, all structure types): the slower sync gets relative to the
    // type's threshold, the more converts; every Nth request stays sync to resample (IBM WSC).
    const threshold = t.syncThresholdSec * CF_ASYNC_THRESHOLD_MULT[x.type];
    const asyncFrac = sync <= threshold ? 0 : Math.min(0.98, 1 - threshold / sync);
    const asyncSec = t.asyncBaseSec + (sync - t.linkSyncSec);
    return {
      name: x.name,
      type: x.type,
      cfLparId: x.cfLparId,
      requestRate: totalRequestRate * x.requestShare,
      syncSec: sync,
      asyncFrac,
      serviceSec: (1 - asyncFrac) * sync + asyncFrac * asyncSec,
      zosCpuSec: (1 - asyncFrac) * sync + asyncFrac * t.asyncZosCpuSec,
      ...(sec ? { role: 'PRIM' as const } : {}),
    };
  };
  return images.map((im) => {
    const id = im.cfg.lparId;
    const live = structures.filter((x) => !x.lost && up.includes(x.cfLparId));
    const res = live.filter((x) => x.cfLparId === id).map(resultOf);
    const rate = res.reduce((a, r) => a + r.requestRate, 0);
    const secondaries = live
      .filter((x) => duplexSecondary(x, up) === id)
      .map((x) => {
        const p = resultOf(x);
        return { ...p, cfLparId: id, requestRate: p.requestRate * duplexFrac(x), role: 'SEC' as const };
      });
    const w = (f: (r: CfStructureResult) => number, idle: number) => (rate > 0 ? res.reduce((a, r) => a + r.requestRate * f(r), 0) / rate : idle);
    const idleSync = syncAt(id, 1);
    return {
      lparId: id,
      requestRate: rate,
      demandEngines: demandBy[id] ?? 0,
      busyFrac: busyOf[id]!,
      syncSec: w((r) => r.syncSec, idleSync),
      asyncFrac: w((r) => r.asyncFrac, 0),
      serviceSec: w((r) => r.serviceSec, idleSync),
      zosCpuSec: w((r) => r.zosCpuSec, idleSync),
      structures: res,
      ...(secondaries.length ? { secondaries } : {}),
    };
  });
}

/** CF storage in use per CF (primaries plus duplexed secondaries). */
export function cfUsedGb(structures: readonly CfStructureConfig[], upCfs: readonly string[]): Record<string, number> {
  const used: Record<string, number> = {};
  for (const x of structures) {
    if (x.lost) continue;
    used[x.cfLparId] = (used[x.cfLparId] ?? 0) + (x.sizeGb ?? 0);
    const sec = duplexSecondary(x, upCfs);
    if (sec) used[sec] = (used[sec] ?? 0) + (x.sizeGb ?? 0);
  }
  return used;
}

const REBUILD_ORDER: Record<CfStructureType, number> = { LOCK: 0, LIST: 1, CACHE: 2 };

/** A CF image fails: duplexed structures switch to their secondary; others are rebuilt into the
 * first CF on their preference list with enough free storage (lock first, then list, then cache);
 * the rest are lost (z/OS XES structure rebuild, CFRM PREFLIST). Returns new structures and notes. */
export function failCf(
  structures: readonly CfStructureConfig[],
  failedId: string,
  upCfs: readonly string[],
  memoryGb: (cfId: string) => number,
  tick: number,
  tickSec: number,
): { structures: CfStructureConfig[]; notes: string[] } {
  const up = upCfs.filter((id) => id !== failedId);
  const out = structures.map((x) => ({ ...x }));
  const notes: string[] = [];
  // Secondaries in the failed CF are just gone: back to simplex.
  for (const x of out) if (x.cfLparId !== failedId && x.duplexed && duplexSecondary(x, [...up, failedId]) === failedId) x.duplexed = false;
  const victims = out.filter((x) => x.cfLparId === failedId && !x.lost).sort((a, b) => REBUILD_ORDER[a.type] - REBUILD_ORDER[b.type] || (a.name < b.name ? -1 : 1));
  for (const x of victims) {
    const sec = duplexSecondary(x, [...up, failedId]);
    if (x.duplexed && sec && up.includes(sec)) {
      x.cfLparId = sec;
      x.duplexed = false;
      notes.push(`${x.name} switched to its duplex copy in ${sec}`);
      continue;
    }
    const used = cfUsedGb(out.filter((y) => y.cfLparId !== failedId), up);
    const target = (x.prefList ?? up).find((id) => up.includes(id) && memoryGb(id) - (used[id] ?? 0) >= (x.sizeGb ?? 0));
    if (target) {
      x.cfLparId = target;
      x.duplexed = false;
      x.rebuildUntilTick = tick + Math.ceil(CF_FAILURE.rebuildSec[x.type] / tickSec);
      notes.push(`${x.name} rebuilt in ${target}`);
    } else {
      x.lost = true;
      x.duplexed = false;
      notes.push(`${x.name} LOST: no CF on its preference list has ${x.sizeGb ?? 0} GB free`);
    }
  }
  return { structures: out, notes };
}

export interface CfSystemResult {
  /** Farthest link this system uses to a structure (primary or duplex secondary), km. */
  distKm: number;
  requestRate: number;
  syncSec: number;
  asyncFrac: number;
  serviceSec: number;
  zosCpuSec: number;
  /** Reporting only: this system's traffic per structure copy (RMF Structure Activity and Subchannel Activity). */
  byStructure?: CfSystemStructureResult[];
}

/** One connected system's requests to one structure copy. A duplexed request drives both copies and completes
 *  when both have it, so the SEC copy carries the same elapsed times (writes only for a GBP). */
export interface CfSystemStructureResult {
  name: string;
  type: CfStructureType;
  role?: 'PRIM' | 'SEC';
  cfLparId: string;
  /** Link distance to this copy's CF, km. */
  distKm: number;
  requestRate: number;
  syncSec: number;
  asyncFrac: number;
  /** Elapsed time of the requests that ran asynchronously. */
  asyncSec: number;
  serviceSec: number;
}

/**
 * CF service as one connected system sees it: the structure's sync time plus the link round trip to its CF
 * (to both copies when duplexed), then z/OS's sync→async heuristic on that system's own sync time. RMF CF
 * Activity reports requests and service times per connected system (RMF Report Analysis p.376).
 */
export function cfServiceForSystem(
  results: readonly CfResult[],
  structures: readonly CfStructureConfig[],
  kmTo: (cfLparId: string) => number,
  t: CfTunables,
  requestRate: number,
): CfSystemResult {
  const up = results.map((r) => r.lparId);
  let share = 0;
  let distKm = 0;
  let syncW = 0;
  let asyncW = 0;
  let serviceW = 0;
  let cpuW = 0;
  const byStructure: CfSystemStructureResult[] = [];
  for (const r of results) {
    for (const st of r.structures) {
      const x = structures.find((s) => s.name === st.name);
      if (!x) continue;
      const sec = duplexSecondary(x, up);
      const km = Math.max(kmTo(st.cfLparId), sec ? kmTo(sec) : 0);
      const link = km * CF_LINK_ROUND_TRIP_SEC_PER_KM;
      const sync = st.syncSec + link;
      const threshold = t.syncThresholdSec * CF_ASYNC_THRESHOLD_MULT[st.type];
      const asyncFrac = sync <= threshold ? 0 : Math.min(0.98, 1 - threshold / sync);
      const asyncSec = t.asyncBaseSec + (sync - t.linkSyncSec);
      distKm = Math.max(distKm, km);
      share += x.requestShare;
      syncW += x.requestShare * sync;
      asyncW += x.requestShare * asyncFrac;
      serviceW += x.requestShare * ((1 - asyncFrac) * sync + asyncFrac * asyncSec);
      cpuW += x.requestShare * ((1 - asyncFrac) * sync + asyncFrac * t.asyncZosCpuSec);
      const row = { name: st.name, type: st.type, requestRate: requestRate * x.requestShare, syncSec: sync, asyncFrac, asyncSec, serviceSec: (1 - asyncFrac) * sync + asyncFrac * asyncSec };
      byStructure.push({ ...row, ...(sec ? { role: 'PRIM' as const } : {}), cfLparId: st.cfLparId, distKm: kmTo(st.cfLparId) });
      if (sec) byStructure.push({ ...row, requestRate: row.requestRate * duplexFrac(x), role: 'SEC', cfLparId: sec, distKm: kmTo(sec) });
    }
  }
  const n = share > 0 ? share : 1;
  return { distKm, requestRate, syncSec: syncW / n, asyncFrac: asyncW / n, serviceSec: serviceW, zosCpuSec: cpuW, byStructure };
}
