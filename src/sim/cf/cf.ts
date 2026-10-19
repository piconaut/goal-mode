// Coupling facility model (SPEC §5.9). Request rate × cost → CF utilisation; sync
// service time stretches with utilisation and, on shared CF engines, with dispatch
// latency. z/OS converts slow sync requests to async (heuristic); sync requests spin
// on the z/OS CP for their whole service time, async ones cost a fixed CPU overhead.

export interface CfConfig {
  lparId: string;
  /** Dynamic CF dispatching with thin interrupts (only matters on shared engines). */
  thinInterrupts: boolean;
  /** Link/hardware degradation multiplier on service time (events), default 1. */
  degrade?: number;
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
}

export function evaluateCf(images: readonly CfImageInput[], structures: readonly CfStructureConfig[], totalRequestRate: number, t: CfTunables): CfResult[] {
  return images.map((im) => {
    const here = structures.filter((x) => x.cfLparId === im.cfg.lparId);
    const rates = here.map((x) => totalRequestRate * x.requestShare);
    const rate = rates.reduce((a, r) => a + r, 0);
    const demand = here.reduce((a, x, i) => a + rates[i]! * t.cpuSecPerRequest * x.costMult, 0);
    const cap = Math.max(1e-6, im.availableEngines);
    const busy = Math.min(0.97, demand / cap);
    let extraWait = 0;
    if (!im.dedicated) {
      // A shared CF logical CP is not always dispatched when a request arrives.
      const undispatched = Math.max(0, 1 - Math.min(1, im.entitlementEngines));
      extraWait = undispatched * (im.cfg.thinInterrupts ? t.sharedDispatchWaitSec.thin : t.sharedDispatchWaitSec.polling);
    }
    const syncFor = (costMult: number) => (t.linkSyncSec + (t.cpuSecPerRequest * costMult) / (1 - busy)) * (im.cfg.degrade ?? 1) + extraWait;
    const res: CfStructureResult[] = here.map((x, i) => {
      const sync = syncFor(x.costMult);
      // Heuristic conversion: the slower sync gets relative to the threshold, the more converts.
      // APPROX: lock requests are not converted (they spin however slow the CF is).
      const asyncFrac = x.type === 'LOCK' || sync <= t.syncThresholdSec ? 0 : Math.min(0.98, 1 - t.syncThresholdSec / sync);
      const asyncSec = t.asyncBaseSec + (sync - t.linkSyncSec);
      return {
        name: x.name,
        type: x.type,
        cfLparId: x.cfLparId,
        requestRate: rates[i]!,
        syncSec: sync,
        asyncFrac,
        serviceSec: (1 - asyncFrac) * sync + asyncFrac * asyncSec,
        zosCpuSec: (1 - asyncFrac) * sync + asyncFrac * t.asyncZosCpuSec,
      };
    });
    const w = (f: (r: CfStructureResult) => number, idle: number) => (rate > 0 ? res.reduce((a, r) => a + r.requestRate * f(r), 0) / rate : idle);
    const idleSync = syncFor(1);
    return {
      lparId: im.cfg.lparId,
      requestRate: rate,
      demandEngines: demand,
      busyFrac: busy,
      syncSec: w((r) => r.syncSec, idleSync),
      asyncFrac: w((r) => r.asyncFrac, 0),
      serviceSec: w((r) => r.serviceSec, idleSync),
      zosCpuSec: w((r) => r.zosCpuSec, idleSync),
      structures: res,
    };
  });
}
