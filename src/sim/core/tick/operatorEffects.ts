import { CICS_RECYCLE, GATEWAY, HSM_RECALL } from '../../../content/operations';
import type { JobRuntime } from '../../subsys/batch';
import type { AddressSpaceDef, WorkloadDef } from '../../workload/types';
import type { CicsRecycle, GatewayMode, HsmRecalls } from '../operations';
import { streamRng } from '../rng';
import type { SimState, WorldConfig } from '../types';
import { TICK_SEC } from '../units';

export function activeRecycle(recycle: CicsRecycle, tick: number): boolean {
  return recycle.startTick <= tick && tick < recycle.restartTick;
}

/** Start each shutdown in its turn. Storage restarts from base, and a storage leak continues to grow. */
export function startRecycles(s: SimState): SimState {
  if (!s.cicsRecycles?.length) return s;
  const pending = s.cicsRecycles.filter((r) => r.restartTick > s.tick);
  const config = s.config;
  const starting = pending.filter((r) => r.startTick === s.tick);
  const { cicsRecycles, ...rest } = s;
  if (!starting.length) {
    return pending.length === cicsRecycles.length ? s : { ...rest, ...(pending.length ? { cicsRecycles: pending } : {}) };
  }
  const cics = config.cics.map((c) => {
    const restart = starting.find((r) => c.name === r.name && c.lparId === r.lparId);
    return c.leak && restart ? { ...c, leak: { ...c.leak, startMb: 0, sinceTick: restart.restartTick } } : c;
  });
  const { aorFailFrac, ...mods } = s.mods;
  const sickness = Object.fromEntries(Object.entries(aorFailFrac ?? {}).filter(([key]) => !starting.some((r) => key.endsWith(`@${r.name}`))));
  return { ...rest, cicsRecycles: pending, config: { ...config, cics }, mods: { ...mods, ...(Object.keys(sickness).length ? { aorFailFrac: sickness } : {}) } };
}

/** Approximate CICSPlex SM eligible targets by removing down regions from the routing pool. */
export function recycleRouting(s: SimState, workloads: WorkloadDef[], addressSpaces: AddressSpaceDef[], rates: Record<string, number>) {
  const down = s.cicsRecycles?.filter((r) => activeRecycle(r, s.tick));
  if (!down?.length) return { workloads, addressSpaces, config: s.config };
  const includes = (name: string, lparId: string) => down.some((r) => r.name === name && r.lparId === lparId);
  const cics = s.config.cics.filter((c) => !includes(c.name, c.lparId));
  const failed: Record<string, number> = {};
  const modified = workloads.map((w) => {
    if (w.subsystem !== 'CICS') return w;
    const eligible: Record<string, number> = {};
    let survivingShare = 0;
    let lostShare = 0;
    let stranded = 0;
    for (const [lparId, share] of Object.entries(w.routing)) {
      const total = s.config.cics.filter((c) => c.lparId === lparId).length;
      const unavailable = down.filter((r) => r.lparId === lparId);
      const loss = total ? share * unavailable.length / total : 0;
      eligible[lparId] = share - loss;
      survivingShare += eligible[lparId];
      lostShare += loss;
      const starting = unavailable.filter((r) => r.startTick === s.tick).length;
      const holdSec = s.env.holdByWorkloadLpar?.[`${w.id}@${lparId}`] ?? w.baseLatencySec;
      if (starting > 0 && total > 0) stranded += (rates[w.id] ?? 0) * holdSec * share * starting / total;
    }
    if (lostShare <= 0) return w;
    const rate = rates[w.id] ?? 0;
    const failFrac = survivingShare > 0 ? lostShare * CICS_RECYCLE.affinityFrac : 1;
    failed[w.id] = rate * failFrac * TICK_SEC + stranded;
    rates[w.id] = rate * (1 - failFrac);
    const routing = survivingShare > 0
      ? Object.fromEntries(Object.entries(eligible).map(([id, share]) => [id, share / survivingShare]))
      : eligible;
    return { ...w, routing };
  });
  return {
    workloads: modified,
    addressSpaces: addressSpaces.filter((a) => !includes(a.jobname, a.lparId)),
    config: { ...s.config, cics },
    failed,
  };
}

export interface GatewayTraffic {
  attackRateMult?: number;
  retryRateMult?: number;
}

export function gatewayTraffic(mode: GatewayMode, organicRate: number, retryRate: number, sources?: GatewayTraffic) {
  const attackRate = Math.min(organicRate, organicRate * (1 - 1 / (sources?.attackRateMult ?? 1)));
  const stormRate = Math.min(organicRate - attackRate, organicRate * (1 - 1 / (sources?.retryRateMult ?? 1)));
  const offeredRate = organicRate + retryRate;
  switch (mode) {
    case 'LIMIT':
      return { admittedRate: offeredRate * (1 - GATEWAY.limitShedFrac), failedRate: offeredRate * GATEWAY.limitShedFrac };
    case 'BACKOFF': {
      const suppressedRate = (stormRate + retryRate) * (1 - GATEWAY.retryPassFrac);
      const failedRate = (organicRate - stormRate - attackRate) * GATEWAY.backoffShedFrac;
      return { admittedRate: offeredRate - suppressedRate - failedRate, failedRate };
    }
    case 'BLOCK': {
      const shedRate = (offeredRate - attackRate) * GATEWAY.sharedSourceFrac;
      return { admittedRate: offeredRate - attackRate - shedRate, failedRate: shedRate };
    }
  }
}

export function hsmIo(s: SimState): { dasd: WorldConfig['dasd']; recalls?: HsmRecalls } {
  const dasd = s.config.dasd;
  const recalls = s.hsmRecalls;
  if (!recalls) return { dasd };
  const lcu = dasd.lcus.find((l) => l.id === HSM_RECALL.lcuId);
  const incomingIops = lcu?.extraIops?.RANDOM ?? 0;
  const drainedIops = recalls.heldSinceTick === null ? Math.min(HSM_RECALL.drainIops, recalls.backlogIo / TICK_SEC) : 0;
  const extraIops = recalls.heldSinceTick === null ? incomingIops + drainedIops : 0;
  const backlogIo = recalls.heldSinceTick === null ? recalls.backlogIo - drainedIops * TICK_SEC : recalls.backlogIo + incomingIops * TICK_SEC;
  return {
    dasd: lcu && extraIops !== incomingIops
      ? { ...dasd, lcus: dasd.lcus.map((l) => l === lcu ? { ...l, extraIops: { ...l.extraIops, RANDOM: extraIops } } : l) }
      : dasd,
    ...(recalls.heldSinceTick !== null || backlogIo > 0 ? { recalls: { ...recalls, backlogIo } } : {}),
  };
}

export function failHeldRecalls(s: SimState, jobs: JobRuntime[]): void {
  if (s.hsmRecalls?.heldSinceTick == null) return;
  for (const job of jobs) {
    if (job.status !== 'RUNNING' || job.startTick !== s.tick || job.def.ioCount <= 0) continue;
    if (!streamRng(s.seed, 'batch-wait-recall', job.day, job.def.name).chance(HSM_RECALL.waitJobFrac)) continue;
    job.status = 'ABENDED';
    job.abended = true;
    job.failCode = 'HSM RECALL HELD';
    job.failTick = s.tick;
    job.endTick = s.tick + 1;
  }
}
