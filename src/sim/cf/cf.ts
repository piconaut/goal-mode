// Coupling facility model (SPEC §5.9). Request rate × cost → CF utilisation; sync
// service time stretches with utilisation and, on shared CF engines, with dispatch
// latency. z/OS converts slow sync requests to async (heuristic); sync requests spin
// on the z/OS CP for their whole service time, async ones cost a fixed CPU overhead.

export interface CfConfig {
  lparId: string;
  /** Share of the sysplex's CF requests whose structures live here. */
  requestShare: number;
  /** Dynamic CF dispatching with thin interrupts (only matters on shared engines). */
  thinInterrupts: boolean;
  /** Link/hardware degradation multiplier on service time (events), default 1. */
  degrade?: number;
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
}

export function evaluateCf(images: readonly CfImageInput[], totalRequestRate: number, t: CfTunables): CfResult[] {
  return images.map((im) => {
    const rate = totalRequestRate * im.cfg.requestShare;
    const demand = rate * t.cpuSecPerRequest;
    const cap = Math.max(1e-6, im.availableEngines);
    const busy = Math.min(0.97, demand / cap);
    let sync = (t.linkSyncSec + t.cpuSecPerRequest / (1 - busy)) * (im.cfg.degrade ?? 1);
    if (!im.dedicated) {
      // A shared CF logical CP is not always dispatched when a request arrives.
      const undispatched = Math.max(0, 1 - Math.min(1, im.entitlementEngines));
      const wait = im.cfg.thinInterrupts ? t.sharedDispatchWaitSec.thin : t.sharedDispatchWaitSec.polling;
      sync += undispatched * wait;
    }
    // Heuristic conversion: the slower sync gets relative to the threshold, the more converts.
    const asyncFrac = sync <= t.syncThresholdSec ? 0 : Math.min(0.98, 1 - t.syncThresholdSec / sync);
    const asyncSec = t.asyncBaseSec + (sync - t.linkSyncSec);
    const serviceSec = (1 - asyncFrac) * sync + asyncFrac * asyncSec;
    const zosCpuSec = (1 - asyncFrac) * sync + asyncFrac * t.asyncZosCpuSec;
    return { lparId: im.cfg.lparId, requestRate: rate, demandEngines: demand, busyFrac: busy, syncSec: sync, asyncFrac, serviceSec, zosCpuSec };
  });
}
