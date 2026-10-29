// The tick pipeline (SPEC §5.1). Stages are added milestone by milestone; the order
// here is the contract. Circular couplings (I/O response, CF service, lock contention,
// subsystem concurrency) use the previous tick's values carried in `env`.

import { cfServiceForSystem, evaluateCf, type CfImageInput, type CfSystemResult } from '../cf/cf';
import { accrueTfp, closeMonth, recordHour } from '../cost/mlc';
import { groupShares, newR4ha, stepR4ha } from '../cost/r4ha';
import { accumulateTick, closeInterval, newRmfAcc, type JobEndRecord } from '../measure/rmf';
import { cpSpeed, msuPerCp, suPerCpuSecOf, ziipSpeed } from '../hw/cpc';
import { poolKey, resolveCpc, type PoolDemand } from '../hw/pools';
import { evaluateDasd, type IoClass } from '../io/dasd';
import {
  addJobDelay,
  advanceJob,
  closeNight,
  jobShape,
  projectCriticalEnd,
  promoteEligible,
  releaseNetwork,
  startJobs,
  type JobRuntime,
} from '../subsys/batch';
import { qrTcb } from '../subsys/cics';
import { slotQueueStep } from '../subsys/slots';
import { SLOT_QUEUE } from '../../content/subsys';
import { bpIoMultiplier, DB2 } from '../subsys/db2';
import { baseRate, scheduledBurstMult, stepBurst, stepNoise } from '../workload/arrivals';
import { buildSlices, honorsPriority, scKeyAtService, scKeyOf } from '../workload/slices';
import { policyAdjust } from '../wlm/adjust';
import { classify } from '../wlm/classify';
import { cpsmGoalShares, sameShares, wlmShares, type RegionStat, type RouteCandidate } from '../workload/routing';
import { ROUTING } from '../../content/routing';
import { emptyScpTick, evaluateLpar, sliceSpec, type IoService, type LparEvalInput, type ScpTick, type SliceSpec } from '../wlm/evaluate';
import { emptyBuckets } from '../wlm/goals';
import { DISC_GOAL_MGMT, STORAGE_SWAP } from '../../content/wlm/tuning';
import { CF_FAILURE } from '../../content/cf';
import {
  decayInto,
  emptyAcc,
  ACC_DECAY,
  accPi,
  goalInfo,
  initialDp,
  sysplexPis,
  type ScpState,
  type WlmSystemState,
} from '../wlm/runtime';
import { pagingDelayFrac } from '../zos/storage';
import { clockAt, formatClock } from './clock';
import { applyCommands, type Command } from './commands';
import { Rng } from './rng';
import type { Scenario } from './scenario';
import type { AddressSpaceDef, WorkloadDef } from '../workload/types';
import type {
  CpcConfig,
  LparConfig,
  EnvState,
  LparPoolRuntime,
  PoolType,
  LparRuntime,
  LparTick,
  SimState,
  WorkloadRuntime,
  WorkloadTick,
} from './types';
import { DAY_SEC, TICK_SEC, TICKS_PER_DAY } from './units';

export type { Command } from './commands';

const WLM_LOG_MAX = 400;
const DEFAULT_EFF_RATIO = 0.93;
const DEFAULT_IO: Record<IoClass, IoService> = {
  RANDOM: { rtSec: 0.0003, delaySec: 0.00005 },
  SEQ: { rtSec: 0.0004, delaySec: 0.00005 },
};
const CRITICAL_PROJECTION_EVERY = 30;
/** RMF intervals kept in state (older ones live in the game layer's archive). */
const RMF_KEEP = 300;

function servers(rt: LparPoolRuntime | undefined, logical: number, hiperDispatch: boolean): number {
  if (!rt) return 0;
  if (!hiperDispatch) return logical;
  return Math.max(1, Math.round(rt.vh + rt.vm + rt.unparkedVl));
}

// Whether a workload calls Db2, memoised per definition object (asked per slice per tick).
const usesDb2Cache = new WeakMap<WorkloadDef, boolean>();
function usesDb2(w: WorkloadDef): boolean {
  let v = usesDb2Cache.get(w);
  if (v === undefined) usesDb2Cache.set(w, (v = w.servers.some((s) => s.role.startsWith('DB2.'))));
  return v;
}

interface BatchSliceRef {
  slice: SliceSpec;
  jobs: { job: JobRuntime; cp: number; zi: number; shape: ReturnType<typeof jobShape> }[];
}

export function step(before: SimState, commands: readonly Command[], scenario: Scenario): SimState {
  const prev = updateRouting(applyCommands(before, commands), scenario);
  const rng = new Rng(prev.rng);
  const workloads = effectiveWorkloads(scenario, prev);
  const addressSpaces = effectiveAddressSpaces(scenario, prev);
  const clock = clockAt(prev.tick);
  const clockText = formatClock(prev.tick);
  const { config } = prev;
  const def = prev.wlm.definition;
  const env = prev.env;
  const tickOfDay = prev.tick % TICKS_PER_DAY;
  const cpcOf: Record<string, CpcConfig> = {};
  for (const c of config.cpcs) cpcOf[c.id] = c;
  const workloadById = byIdOf(workloads);

  // 1–2. Arrivals (noise is mean-corrected so it doesn't inflate average λ).
  const rates: Record<string, number> = {};
  const prevWl: Record<string, WorkloadRuntime> = {};
  for (const w of prev.workloads) prevWl[w.id] = w;
  const workloadRt: WorkloadRuntime[] = workloads.map((w) => {
    const p = prevWl[w.id] ?? { id: w.id, noise: 0, retryRate: 0, lastRtSec: 0 };
    const noise = stepNoise(p.noise, w, rng.normal());
    // Interactive users (closed loop): slow responses throttle their own arrival rate.
    const closedLoop = w.thinkTimeSec ? w.thinkTimeSec / (w.thinkTimeSec + p.lastRtSec) : 1;
    // Bursts draw from the RNG only when the shape has them, so burst-free scenarios keep their streams.
    const b = w.shape.bursts;
    const burst = b ? stepBurst(p.burst ?? { mult: 1, leftSec: 0 }, b, TICK_SEC, rng) : undefined;
    const burstMult = b && burst ? burst.mult * scheduledBurstMult(b, clock) : 1;
    rates[w.id] = baseRate(w, clock) * burstMult * (prev.mods.rate[w.id] ?? 1) * Math.exp(noise - (w.noiseSigma * w.noiseSigma) / 2) * closedLoop + p.retryRate;
    return burst ? { id: w.id, noise, retryRate: 0, lastRtSec: p.lastRtSec, burst } : { id: w.id, noise, retryRate: 0, lastRtSec: p.lastRtSec };
  });

  // Batch scheduling: release tonight's network at the start of the played day.
  // Only queued and running jobs are mutated in place below (promotion copies the held jobs it
  // changes), so every other job can be shared with the previous state.
  let batch = { ...prev.batch, jobs: prev.batch.jobs.map((j) => (j.status === 'QUEUED' || j.status === 'RUNNING' ? { ...j } : j)) };
  if (tickOfDay === 0) batch = releaseNetwork(batch, clock.day, scenario.batchNetwork(prev.seed, clock.day, clock.dayOfMonth));
  promoteEligible(batch.jobs, prev.tick);
  const lparBusy: Record<string, number> = {};
  for (const l of prev.lpars) {
    const cp = l.pools.find((p) => p.pool === 'CP');
    if (cp && cp.availableEngines > 0) lparBusy[l.id] = cp.deliveredEngines / cp.availableEngines;
  }
  startJobs(batch.jobs, prev.tick, { jobClasses: config.jobClasses, lparBusy });
  const runningBy: Record<string, JobRuntime[]> = {};
  for (const j of batch.jobs) if (j.status === 'RUNNING' && j.lparId !== null) (runningBy[j.lparId] ??= []).push(j);
  // Jobs waiting for an initiator in a WLM-managed class are initiation delay for their service class
  // (WLM Planning p.70); APPROX: counted on the first eligible system. JES-managed queues stay invisible.
  const queuedWlmBy: Record<string, JobRuntime[]> = {};
  for (const j of batch.jobs) {
    if (j.status !== 'QUEUED') continue;
    const jc = config.jobClasses.find((c) => c.jobClass === j.def.jobClass);
    if (jc?.mode !== 'WLM') continue;
    const home = j.def.sysaff ?? Object.keys(jc.initiators).filter((l) => (jc.initiators[l] ?? 0) > 0).sort()[0];
    if (home) (queuedWlmBy[home] ??= []).push(j);
  }

  const io: Record<IoClass, IoService> = env.dasd
    ? {
        RANDOM: { rtSec: env.dasd.classes.RANDOM.rtSec, delaySec: env.dasd.classes.RANDOM.iosqSec + env.dasd.classes.RANDOM.pendSec, iosqSec: env.dasd.classes.RANDOM.iosqSec, connSec: env.dasd.classes.RANDOM.connSec },
        SEQ: { rtSec: env.dasd.classes.SEQ.rtSec, delaySec: env.dasd.classes.SEQ.iosqSec + env.dasd.classes.SEQ.pendSec, iosqSec: env.dasd.classes.SEQ.iosqSec, connSec: env.dasd.classes.SEQ.connSec },
      }
    : DEFAULT_IO;

  // CF service per request seen by requesters (previous tick), weighted by structure placement.
  let cfServiceSec = 0;
  let cfZosCpuSec = 0;
  for (const r of env.cf) {
    for (const st of r.structures ?? []) {
      const share = config.cfStructures.find((x) => x.name === st.name)?.requestShare ?? 0;
      cfServiceSec += share * st.serviceSec;
      cfZosCpuSec += share * st.zosCpuSec;
    }
  }
  // CF failure: structures being rebuilt stall their requesters; lost ones take work down.
  let cfStallSec = 0;
  let db2FailFrac = 0;
  let mqFailFrac = 0;
  for (const x of config.cfStructures) {
    if (x.rebuildUntilTick !== undefined && x.rebuildUntilTick > prev.tick) cfStallSec += x.requestShare * CF_FAILURE.stallSecPerRequest;
    if (!x.lost) continue;
    if (x.lostImpact === 'DB2_DOWN') db2FailFrac = Math.max(db2FailFrac, CF_FAILURE.db2DownFailFrac);
    else if (x.lostImpact === 'DB2_GRECP') db2FailFrac = Math.max(db2FailFrac, CF_FAILURE.grecpFailFrac);
    else if (x.lostImpact === 'MQ_DOWN') mqFailFrac = Math.max(mqFailFrac, CF_FAILURE.mqDownFailFrac);
  }

  cfServiceSec += cfStallSec;

  // 3–4. Slices and demand per z/OS image. The per-image stages are separate functions so a
  // deoptimisation in one (state shapes settle over the first simulated days) stays cheap.
  const zosLpars = config.lpars.filter((l) => l.kind === 'ZOS');
  const pagingFrac: Record<string, number> = {};
  const demands: PoolDemand[] = [];
  const t: TickCtx = {
    prev,
    scenario,
    def,
    env,
    config,
    clock,
    cpcOf,
    workloads,
    workloadById,
    addressSpaces,
    rates,
    io,
    cfServiceSec,
    cfZosCpuSec,
    cfStallSec,
    db2FailFrac,
    mqFailFrac,
    runningBy,
    queuedWlmBy,
    slicesBy: {},
    batchRefsBy: {},
    swappedBy: {},
    pagingFrac,
    demands,
    lpars: [],
    storageCritical: new Set<string>(),
    evalInputs: {},
    backlog: {},
    failedBy: {},
    wlTick: {},
    rtByWorkloadLpar: {},
    holdByWorkloadLpar: {},
    failByWorkloadLpar: prev.routingPolicies ? {} : null,
    systems: [],
    lparTicks: [],
    onlineDb2Rate: 0,
    slotQueue: {},
  };
  for (const l of zosLpars) lparDemand(t, l);
  // Coupling facilities: request work from last tick; a shared CF without thin
  // interrupts polls, consuming its whole logical engine share.
  for (const l of config.lpars.filter((x) => x.kind === 'CF')) {
    const cfg = config.cfs.find((c) => c.lparId === l.id);
    const icf = l.pools.find((p) => p.pool === 'ICF');
    const work = (env.cf.find((r) => r.lparId === l.id)?.demandEngines ?? 0) + (scenario.cfBaseEngines[l.id] ?? 0);
    const polling = icf && !icf.dedicated && cfg && !cfg.thinInterrupts;
    demands.push({ lparId: l.id, pool: 'ICF', demandEngines: polling ? (icf?.logical ?? 1) : work, softCapEngines: Infinity });
  }

  // 6. Soft capping, then 5. PR/SM.
  softCap(t);
  prsm(t);
  const lpars = t.lpars;

  // 7–10. Dispatch and response per image.
  const { backlog, failedBy, wlTick, lparTicks, rtByWorkloadLpar, holdByWorkloadLpar, storageCritical } = t;
  for (const w of workloads) {
    wlTick[w.id] = { id: w.id, arrivalRate: rates[w.id] ?? 0, completions: 0, withinSla: 0, failed: 0, rtSumSec: 0, parts: {} };
  }
  for (const c of def.classes) if (c.storageCritical) c.periods.forEach((_, i) => storageCritical.add(scKeyOf(c.id, i)));

  const sums: TickSums = { randomIops: 0, seqIops: 0, cfRequests: 0, cfRequestsBy: {} };
  for (const l of zosLpars) dispatchLpar(t, l, sums);
  const { randomIops, seqIops, cfRequests } = sums;

  // I/O subsystem and CF for next tick.
  const dasd = evaluateDasd(config.dasd, { RANDOM: randomIops, SEQ: seqIops });
  const cfImages: CfImageInput[] = config.cfs.flatMap((cfg) => {
    if (cfg.failed) return [];
    const l = config.lpars.find((x) => x.id === cfg.lparId);
    const icf = l?.pools.find((p) => p.pool === 'ICF');
    const rt = lpars.find((x) => x.id === cfg.lparId)?.pools.find((p) => p.pool === 'ICF');
    if (!l || !icf || !rt) return [];
    return [{ cfg, availableEngines: rt.availableEngines, entitlementEngines: rt.entitlementEngines, dedicated: icf.dedicated }];
  });
  const cf = evaluateCf(cfImages, config.cfStructures, cfRequests, scenario.cfTunables);
  const siteKm = (lparId: string) => cpcOf[config.lpars.find((x) => x.id === lparId)?.cpcId ?? '']?.siteKm ?? 0;
  const cfBySystem: Record<string, CfSystemResult> = {};
  for (const l of zosLpars) {
    const here = siteKm(l.id);
    cfBySystem[l.id] = cfServiceForSystem(cf, config.cfStructures, (cfId) => Math.abs(siteKm(cfId) - here), scenario.cfTunables, sums.cfRequestsBy[l.id] ?? 0);
  }
  const lockIndex = batch.jobs.reduce((a, j) => (j.status === 'RUNNING' ? a + j.def.lockIntensity : a), 0) + prev.mods.lockBoost;

  // Batch critical-path projection and end-of-night summary.
  if (prev.tick % CRITICAL_PROJECTION_EVERY === 0) {
    // A job runs at its sysaff LPAR's CPC speed; unpinned jobs project on the first CPC.
    const cpcOfJob = (lparId: string | null): CpcConfig => cpcOf[config.lpars.find((l) => l.id === lparId)?.cpcId ?? ''] ?? config.cpcs[0]!;
    batch.projectedCriticalEndSec = projectCriticalEnd(batch.jobs, clock.day, prev.tick, (j) => {
      const cpc = cpcOfJob(j.def.sysaff);
      return jobShape(j.def, cpSpeed(cpc), ziipSpeed(cpc), io.SEQ.rtSec).elapsed;
    });
  }
  if (tickOfDay === TICKS_PER_DAY - 1) batch = closeNight(batch, clock.day, prev.tick);

  // 12b. Policy adjustment, one receiver per system.
  const { adjusted, log } = adjustPolicies(t, clockText);

  // Retry storms: timed-out requests come back next tick.
  for (const wr of workloadRt) {
    const w = workloadById[wr.id]!;
    // Clients back off (circuit breakers, retry budgets): retries are capped at twice the
    // organic arrival rate so a storm hurts badly but stays bounded.
    const organic = rates[wr.id]! - (prevWl[wr.id]?.retryRate ?? 0);
    wr.retryRate = Math.min(2 * Math.max(0, organic), ((failedBy[wr.id] ?? 0) * w.retryFrac) / TICK_SEC);
    const wt = wlTick[wr.id]!;
    if (wt.completions > 1e-9) wr.lastRtSec = wt.rtSumSec / wt.completions;
  }

  const nextEnv: EnvState = t.failByWorkloadLpar
    ? { dasd, cf, lockIndex, rtByWorkloadLpar, pagingFrac, failByWorkloadLpar: t.failByWorkloadLpar }
    : { dasd, cf, lockIndex, rtByWorkloadLpar, pagingFrac };
  if (Object.keys(t.slotQueue).length > 0) nextEnv.slotQueue = t.slotQueue;
  if (cf.length > 0) nextEnv.cfBySystem = cfBySystem;
  nextEnv.holdByWorkloadLpar = holdByWorkloadLpar;

  const nextTick = prev.tick + 1;
  const { cappingLpars, cappingGroups, msuBy, r4haBy } = stepCapping(t, zosLpars);
  const cost = stepCost(t, zosLpars, msuBy, r4haBy, nextTick);
  const rmf = stepRmf(t, batch, dasd, cf, r4haBy, nextTick, cfBySystem);
  return {
    ...prev,
    tick: prev.tick + 1,
    rng: rng.snapshot(),
    lpars,
    wlm: { definition: def, systems: adjusted, log },
    workloads: workloadRt,
    backlog,
    last: { lpars: lparTicks, workloads: Object.values(wlTick) },
    env: nextEnv,
    batch,
    capping: { lpars: cappingLpars, groups: cappingGroups },
    cost,
    rmf,
  };
}

/** Everything the per-image stages of one tick read or fill in. */
interface TickCtx {
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
  batchRefsBy: Record<string, BatchSliceRef[]>;
  swappedBy: Record<string, Set<JobRuntime>>;
  pagingFrac: Record<string, number>;
  demands: PoolDemand[];
  lpars: LparRuntime[];
  storageCritical: Set<string>;
  evalInputs: Record<string, LparEvalInput>;
  backlog: Record<string, number>;
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
}

/** Sums over all images, accumulated in image order. */
interface TickSums {
  randomIops: number;
  seqIops: number;
  cfRequests: number;
  cfRequestsBy: Record<string, number>;
}

/** 6. Soft capping: LPARs whose R4HA exceeds their defined capacity, and members of capacity
 * groups over their limit, are held to their MSU share. */
function softCap(t: TickCtx): void {
  const { prev, config, cpcOf, demands } = t;
  for (const d of demands) {
    if (d.pool !== 'CP') continue;
    const l = config.lpars.find((x) => x.id === d.lparId)!;
    const msuCp = msuPerCp(cpcOf[l.cpcId]!);
    const r = prev.capping.lpars.find((x) => x.id === l.id);
    let capMsu = Infinity;
    if (r?.capped && l.definedCapacityMsu !== null) capMsu = l.definedCapacityMsu;
    const g = l.capacityGroup ? config.capacityGroups.find((x) => x.id === l.capacityGroup) : undefined;
    const gs = g ? prev.capping.groups.find((x) => x.id === g.id) : undefined;
    if (g && gs?.capped) {
      const members = config.lpars.filter((x) => x.capacityGroup === g.id);
      const shares = groupShares(
        g.limitMsu,
        members.map((m) => ({
          id: m.id,
          weight: m.pools.find((p) => p.pool === 'CP')?.weight ?? 0,
          demandMsu: (demands.find((x) => x.lparId === m.id && x.pool === 'CP')?.demandEngines ?? 0) * msuPerCp(cpcOf[m.cpcId]!),
        })),
      );
      capMsu = Math.min(capMsu, shares[l.id] ?? capMsu);
    }
    if (capMsu < Infinity) d.softCapEngines = capMsu / msuCp;
  }
}

/** 5. PR/SM: resolve each CPC's pools against this tick's demand into `t.lpars`. */
function prsm(t: TickCtx): void {
  const { config, demands, lpars } = t;
  for (const cpc of config.cpcs) {
    const res = resolveCpc(cpc, config.lpars, demands);
    const msuCp = msuPerCp(cpc);
    for (const l of config.lpars) {
      if (l.cpcId !== cpc.id) continue;
      const pools = l.pools.flatMap((p) => {
        const r = res[poolKey(l.id, p.pool)];
        return r ? [r] : [];
      });
      const cpRt = pools.find((p) => p.pool === 'CP');
      lpars.push({ id: l.id, pools, msuRate: l.kind === 'ZOS' ? (cpRt?.deliveredEngines ?? 0) * msuCp : 0 });
    }
  }
}

/** 12b. Policy adjustment, one receiver per system. */
function adjustPolicies(t: TickCtx, clockText: string): { adjusted: WlmSystemState[]; log: string[] } {
  const { prev, def, systems, lparTicks, evalInputs } = t;
  const spPi = sysplexPis(def, systems);
  // The previous log is only copied once a line is added (states are never mutated in place).
  let log = prev.wlm.log;
  const adjusted = systems.map((sys) => {
    const lt = lparTicks.find((x) => x.lparId === sys.lparId)!;
    const out = policyAdjust({
      def,
      system: sys,
      evalInput: evalInputs[sys.lparId]!,
      current: lt.scps,
      sysplexPi: spPi,
      clockText,
    });
    if (out.log && (out.log.includes('RCVR=') || prev.tick % 30 === 0)) {
      if (log === prev.wlm.log) log = [...log];
      log.push(out.log);
    }
    // This tick's period states are fresh objects: apply the new DPs in place.
    for (const s of sys.scps) s.dp = out.dps[s.scKey] ?? s.dp;
    return sys;
  });
  if (log.length > WLM_LOG_MAX) {
    if (log === prev.wlm.log) log = [...log];
    while (log.length > WLM_LOG_MAX) log.shift();
  }
  return { adjusted, log };
}

/** R4HA bookkeeping and soft-cap decisions for the next tick. */
function stepCapping(t: TickCtx, zosLpars: readonly LparConfig[]) {
  const { prev, config, lpars } = t;
  const msuBy: Record<string, number> = {};
  for (const l of lpars) msuBy[l.id] = l.msuRate;
  const cappingLpars = zosLpars.map((l) =>
    stepR4ha(prev.capping.lpars.find((x) => x.id === l.id) ?? newR4ha(l.id), msuBy[l.id] ?? 0, l.definedCapacityMsu),
  );
  const cappingGroups = config.capacityGroups.map((g) => {
    const msu = config.lpars.filter((l) => l.capacityGroup === g.id).reduce((a, l) => a + (msuBy[l.id] ?? 0), 0);
    return stepR4ha(prev.capping.groups.find((x) => x.id === g.id) ?? newR4ha(g.id), msu, g.limitMsu);
  });
  const r4haBy: Record<string, number> = {};
  for (const r of cappingLpars) r4haBy[r.id] = r.r4ha;
  return { cappingLpars, cappingGroups, msuBy, r4haBy };
}

/** MLC: hourly SCRT-style sample, monthly bill. */
function stepCost(t: TickCtx, zosLpars: readonly LparConfig[], msuBy: Record<string, number>, r4haBy: Record<string, number>, nextTick: number): SimState['cost'] {
  const { prev, scenario, config, clock } = t;
  let cost = prev.cost.tfp ? accrueTfp(prev.cost, scenario.products, msuBy, TICK_SEC) : prev.cost;
  if (nextTick % 360 === 0) {
    const dcBy: Record<string, number | null> = {};
    for (const l of zosLpars) dcBy[l.id] = l.definedCapacityMsu;
    const groupLimits = config.capacityGroups.map((g) => ({ limitMsu: g.limitMsu, members: config.lpars.filter((l) => l.capacityGroup === g.id).map((l) => l.id) }));
    cost = recordHour(cost, scenario.products, r4haBy, dcBy, nextTick, groupLimits);
  }
  if (clockAt(nextTick).dayOfMonth === 1 && clock.dayOfMonth !== 1) cost = closeMonth(cost, scenario.products);
  return cost;
}

/** RMF interval data. */
function stepRmf(
  t: TickCtx,
  batch: SimState['batch'],
  dasd: EnvState['dasd'],
  cf: EnvState['cf'],
  r4haBy: Record<string, number>,
  nextTick: number,
  cfBySystem: Record<string, CfSystemResult>,
): SimState['rmf'] {
  const { prev, def, config, lparTicks, lpars } = t;
  const jobsEnded: JobEndRecord[] = [];
  for (const j of batch.jobs) {
    if (j.endTick !== nextTick || j.startTick === null) continue;
    jobsEnded.push({
      name: j.def.name,
      stream: j.def.stream,
      lparId: j.lparId ?? '',
      critical: j.def.critical,
      queuedSec: ((j.startTick ?? 0) - (j.queuedTick ?? j.startTick ?? 0)) * TICK_SEC,
      elapsedSec: (nextTick - (j.startTick ?? nextTick)) * TICK_SEC,
      endTick: nextTick,
      stretch: j.stretch,
    });
  }
  let acc = accumulateTick(prev.rmf.acc, lparTicks, lpars, dasd, cf, cfBySystem);
  let jobsThisInterval = jobsEnded.length ? [...prev.rmf.jobsThisInterval, ...jobsEnded] : prev.rmf.jobsThisInterval;
  let intervals = prev.rmf.intervals;
  const intervalTicks = Math.max(1, Math.round((config.rmfIntervalMin * 60) / TICK_SEC));
  if (nextTick % intervalTicks === 0) {
    intervals = [...intervals, closeInterval(acc, { def, config, r4haByLpar: r4haBy, jobs: jobsThisInterval, endTick: nextTick })];
    if (intervals.length > RMF_KEEP) intervals = intervals.slice(intervals.length - RMF_KEEP);
    acc = newRmfAcc(nextTick);
    jobsThisInterval = [];
  }
  return { acc, intervals, jobsThisInterval };
}

/** 3–4. One z/OS image's slices (online + batch), storage state and pool demand. */
function lparDemand(t: TickCtx, l: LparConfig): void {
  const { prev, scenario, def, env, config, clock, cpcOf, workloads, workloadById, addressSpaces, rates, io } = t;
  const { cfStallSec, db2FailFrac, mqFailFrac, runningBy, slicesBy, batchRefsBy, swappedBy, pagingFrac, demands } = t;
  const cpc = cpcOf[l.cpcId]!;
  // This system's own CF service (link distance, its own sync→async conversion); plex average before the first CF tick.
  const cfSys = prev.env.cfBySystem?.[l.id];
  const cfServiceSec = cfSys ? cfSys.serviceSec + cfStallSec : t.cfServiceSec;
  const cfZosCpuSec = cfSys ? cfSys.zosCpuSec : t.cfZosCpuSec;
  const cpSp = cpSpeed(cpc);
  const zSp = ziipSpeed(cpc);
  const base = applyCpuModifiers(buildSlices({ def, cpc, lpar: l, workloads, rates, addressSpaces, scope: workloadScope.get(workloads) }), prev.mods);

  const db2 = config.db2.find((d) => d.lparId === l.id);
  const ioMult = db2
    ? bpIoMultiplier(db2.bufferPoolGb, (scenario.memory.db2WorkingSetGb[db2.ssid] ?? 100) * Math.pow(1 + DB2.workingSetGrowthPerDay, clock.day))
    : 1;
  const aors = config.cics.filter((c) => c.lparId === l.id);
  // CICS QR TCB load per AOR (CICS work is spread evenly over the image's AORs).
  let cicsQrCpu = 0;
  let cicsRate = 0;
  let ddfRate = 0;
  let ddfRtWeighted = 0;
  let cicsRtWeighted = 0;
  let ddfRefWeighted = 0;
  let cicsRefWeighted = 0;
  for (const s of base) {
    if (s.kind !== 'TXN' || !s.workloadId) continue;
    const w = workloadById[s.workloadId]!;
    const ioSvc = io[s.ioClass];
    const refRt = s.baseLatencySec + s.cpuSecPerTxn + s.ziipSecPerTxn + s.ioPerTxn * (ioSvc.rtSec - ioSvc.delaySec);
    // Slot hold time: last tick's in-region time without the CPU backlog wait; the unqueued time if nothing completed.
    const lastHold = env.holdByWorkloadLpar?.[wlLparKey(w.id, l.id)] ?? 0;
    const prevRt = lastHold > 0 ? lastHold : refRt;
    if (w.subsystem === 'CICS') {
      cicsQrCpu += s.rate * s.cpuSecPerTxn;
      cicsRate += s.rate;
      cicsRtWeighted += s.rate * prevRt;
      cicsRefWeighted += s.rate * refRt;
    }
    if (w.subsystem === 'DDF') {
      ddfRate += s.rate;
      ddfRtWeighted += s.rate * prevRt;
      ddfRefWeighted += s.rate * refRt;
    }
  }
  const meanQrFrac = aors.length ? aors.reduce((a, c) => a + c.qrFrac, 0) / aors.length : 0;
  const qr = qrTcb(aors.length ? (cicsQrCpu * meanQrFrac) / aors.length : 0);
  const maxTasks = aors.reduce((a, c) => a + c.maxTasks, 0);
  // Task-slot queues persist across ticks: offered load above MXT / MAXDBAT builds a backlog that only
  // drains at limit / hold time, and times out (MAXCONQW for DDF).
  const slotQ = (kind: 'MXT' | 'DBAT', on: boolean, rate: number, holdW: number, refW: number, limit: number, timeoutSec: number) => {
    if (!on) return { waitSec: 0, refSec: 0, failFrac: 0 };
    const key = `${l.id}:${kind}`;
    const hold = rate > 0 ? holdW / rate : 0;
    const refHold = rate > 0 ? refW / rate : 0;
    const r = slotQueueStep(prev.env.slotQueue?.[key] ?? 0, rate, hold, limit, timeoutSec, TICK_SEC);
    if (r.queued > 1e-9) t.slotQueue[key] = r.queued;
    // Same queue at the unqueued service time, so RCA can tell a limit too low for the arrival rate from slow tasks.
    const refSec = rate * refHold >= Math.max(1, Math.floor(limit)) ? r.waitSec : slotQueueStep(0, rate, refHold, limit, timeoutSec, TICK_SEC).waitSec;
    return { waitSec: r.waitSec, refSec, failFrac: r.failFrac };
  };
  const mxt = slotQ('MXT', aors.length > 0, cicsRate, cicsRtWeighted, cicsRefWeighted, maxTasks, SLOT_QUEUE.cicsQueueTimeoutSec);
  const dbat = slotQ('DBAT', !!db2, ddfRate, ddfRtWeighted, ddfRefWeighted, db2?.maxDbat ?? 0, SLOT_QUEUE.ddfQueueTimeoutSec);

  // `base` holds fresh objects built for this tick, so transactions are completed in place.
  for (const s of base) {
    if (s.kind !== 'TXN' || !s.workloadId) continue;
    const w = workloadById[s.workloadId]!;
    let extra = 0;
    let failFrac = 0;
    let cpuAdd = 0;
    let ioPerTxn = s.ioPerTxn;
    const parts: Record<string, number> = {};
    const db2Work = usesDb2(w);
    if (db2Work) {
      ioPerTxn *= ioMult;
      parts.cf = DB2.cfRequestsPerTxn * cfServiceSec;
      parts.lock = DB2.lockWaitSecPerIndex * env.lockIndex;
      extra += parts.cf + parts.lock;
      cpuAdd += DB2.cfRequestsPerTxn * cfZosCpuSec;
    }
    let outside = 0;
    let outsideRef = 0;
    if (w.subsystem === 'CICS' && aors.length) {
      parts.qr = s.cpuSecPerTxn * meanQrFrac * qr.qrWaitRatio;
      extra += parts.qr;
      outside += mxt.waitSec;
      outsideRef += mxt.refSec;
      failFrac = Math.max(qr.failFrac, mxt.failFrac);
    }
    if (w.subsystem === 'DDF') {
      outside += dbat.waitSec;
      outsideRef += dbat.refSec;
      failFrac = Math.max(failFrac, dbat.failFrac);
    }
    if (db2Work) t.onlineDb2Rate += s.rate;
    // A saturated QR TCB makes a region slow, not fast-failing, so it doesn't count as an abend for routing.
    let abendFrac = 0;
    if (db2FailFrac > 0 && db2Work) abendFrac = Math.max(abendFrac, db2FailFrac);
    if (mqFailFrac > 0 && w.mq) abendFrac = Math.max(abendFrac, mqFailFrac);
    const regionFail = prev.mods.regionFailFrac?.[wlLparKey(w.id, l.id)];
    if (regionFail) abendFrac = Math.max(abendFrac, regionFail);
    failFrac = Math.max(failFrac, abendFrac);
    if (t.failByWorkloadLpar) s.abendFrac = abendFrac;
    if (w.mq && s.mqQueueFrac !== undefined) s.maxQueueMsgs = (prev.mqMaxDepth?.[w.id] ?? w.mq.maxDepthMsgs) * s.mqQueueFrac;
    s.ioPerTxn = ioPerTxn;
    s.extraParts = parts;
    s.extraOtherSec = extra;
    s.outsideWaitSec = outside;
    s.outsideRefSec = outsideRef;
    s.failFrac = failFrac;
    s.cpEngines = s.cpEngines + s.rate * cpuAdd;
    s.cpuSecPerTxn = s.cpuSecPerTxn + cpuAdd;
  }
  const slices = base;

  // Batch: one slice per service-class period of running jobs on this image.
  const refs: Record<string, BatchSliceRef> = {};
  // Storage: base + Db2 buffer pools + CICS regions + queued MQ messages + running jobs. When it
  // overcommits real memory, SRM swaps out the least important batch jobs (MPL/swap delay).
  const cicsRegions = cicsRegionCount(addressSpaces, l.id);
  const fixedGb =
    (scenario.memory.osBaseGb[l.id] ?? 20) + (db2?.bufferPoolGb ?? 0) + cicsRegions * scenario.memory.cicsRegionGb + queuedMsgGb(prev, workloadById, l.id);
  const running = runningBy[l.id] ?? [];
  const seqRt = io.SEQ.rtSec;
  const swapped = swapOut(def, running, l.id, fixedGb, scenario.memory.batchJobGb, l.memoryGb, (j) => jobServiceSu(j, jobShape(j.def, cpSp, zSp, seqRt), cpc));
  if (swapped.size > 0) swappedBy[l.id] = swapped;
  let runningJobs = 0;
  for (const j of running) {
    if (swapped.has(j)) continue;
    runningJobs++;
    const cls = classifyJob(def, j.def, l.id);
    const shape = jobShape(j.def, cpSp, zSp, seqRt);
    const scKey = scKeyAtService(def, cls.serviceClass, jobServiceSu(j, shape, cpc));
    const cfCpu = j.def.usesDb2 ? shape.ioRate * DB2.cfRequestsPerBatchIo * cfZosCpuSec : 0;
    // Jobs in different report classes need their own slice so RMF can report them apart.
    const refKey = cls.reportClass ? `${scKey}/${cls.reportClass}` : scKey;
    let ref = refs[refKey];
    if (!ref) {
      ref = {
        slice: sliceSpec({
          key: `BATCH:${refKey}@${l.id}`,
          scKey,
          reportClass: cls.reportClass,
          kind: 'AS',
          workloadId: null,
          jobname: null,
          role: null,
          rate: 0,
          cpEngines: 0,
          ziipEngines: 0,
          mayOverflow: honorsPriority(def, cls.serviceClass, scKey),
          cpuSecPerTxn: 0,
          ziipSecPerTxn: 0,
          ioPerTxn: 0,
          baseLatencySec: 0,
          rtSigma: 0,
          timeoutSec: Infinity,
          servers: [],
          goalRtSec: null,
          slaRtSec: null,
          ioClass: 'SEQ',
          ioRate: 0,
          extraOtherSec: 0,
          failFrac: 0,
          outsideWaitSec: 0,
        }),
        jobs: [],
      };
      refs[refKey] = ref;
    }
    ref.slice.cpEngines += shape.cpRate + cfCpu;
    ref.slice.ziipEngines += shape.zRate;
    ref.slice.ioRate += shape.ioRate / Math.max(1, j.stretch);
    ref.jobs.push({ job: j, cp: shape.cpRate + cfCpu, zi: shape.zRate, shape });
  }
  const batchRefs = Object.values(refs);
  batchRefsBy[l.id] = batchRefs;
  const all = [...slices, ...batchRefs.map((r) => r.slice)];
  slicesBy[l.id] = all;

  const memDemand = fixedGb + runningJobs * scenario.memory.batchJobGb;
  pagingFrac[l.id] = pagingDelayFrac(memDemand, l.memoryGb);

  let cp = 0;
  let zi = 0;
  for (const s of all) {
    const bl = (prev.backlog[s.key] ?? 0) / TICK_SEC;
    const tot = s.cpEngines + s.ziipEngines;
    const cpShare = tot > 0 ? s.cpEngines / tot : 1;
    cp += s.cpEngines + bl * cpShare;
    zi += s.ziipEngines + bl * (1 - cpShare);
  }
  const prevRt = prev.lpars.find((x) => x.id === l.id);
  const ratio = (pool: 'CP' | 'ZIIP') => {
    const r = prevRt?.pools.find((p) => p.pool === pool);
    return r && r.deliveredEngines > 1e-6 ? Math.max(0.5, r.effectiveEngines / r.deliveredEngines) : DEFAULT_EFF_RATIO;
  };
  const hasZiip = l.pools.some((p) => p.pool === 'ZIIP' && p.logical > 0);
  // Without zIIPs every eligible cycle runs on CPs.
  if (!hasZiip) {
    cp += zi;
    zi = 0;
  }
  demands.push({ lparId: l.id, pool: 'CP', demandEngines: cp / ratio('CP'), softCapEngines: Infinity });
  if (hasZiip) demands.push({ lparId: l.id, pool: 'ZIIP', demandEngines: zi / ratio('ZIIP'), softCapEngines: Infinity });
}

/** 7–12a. One z/OS image's dispatch, response times, batch progress and WLM measurement. */
function dispatchLpar(t: TickCtx, l: LparConfig, sums: TickSums): void {
  const { prev, def, env, config, cpcOf, workloadById, addressSpaces, io, lpars, slicesBy, batchRefsBy, swappedBy, queuedWlmBy, pagingFrac } = t;
  const { storageCritical, evalInputs, backlog, failedBy, wlTick, rtByWorkloadLpar, holdByWorkloadLpar, failByWorkloadLpar, systems, lparTicks } = t;
  const rt = lpars.find((x) => x.id === l.id)!;
  const cpRt = rt.pools.find((p) => p.pool === 'CP');
  const ziRt = rt.pools.find((p) => p.pool === 'ZIIP');
  const cpCfg = l.pools.find((p) => p.pool === 'CP');
  const ziCfg = l.pools.find((p) => p.pool === 'ZIIP');
  const sysCfg = config.systems.find((s) => s.lparId === l.id);
  const prevSys = prev.wlm.systems.find((s) => s.lparId === l.id);
  const slices = slicesBy[l.id] ?? [];

  const promoted = new Set<string>();
  if (prevSys && sysCfg) {
    for (const s of prevSys.scps) if (s.starvedSec >= sysCfg.blwlinthdSec) promoted.add(s.scKey);
  }

  const cpc = cpcOf[l.cpcId]!;
  const dpMap: Record<string, number> = {};
  for (const s of prevSys?.scps ?? []) dpMap[s.scKey] = s.dp;
  const dpOf = (k: string) => dpMap[k] ?? initialDp(def, k);
  const plexShare = rgSysplexShares(def, slicesBy, config.lpars, cpcOf, l.id);
  // Every optional field is always present so all evaluator inputs share one shape.
  const evalInput: LparEvalInput = {
    cpCapacityEngines: cpRt?.availableEffectiveEngines ?? 0,
    cpServers: servers(cpRt, cpCfg?.logical ?? 0, l.hiperDispatch),
    ziipCapacityEngines: ziRt?.availableEffectiveEngines ?? 0,
    ziipServers: servers(ziRt, ziCfg?.logical ?? 0, l.hiperDispatch),
    cpPrsmDelayFrac: cpRt?.prsmDelayFrac ?? 0,
    slices: sysCfg && !sysCfg.iipHonorPriority ? slices.map((s) => ({ ...s, mayOverflow: false })) : slices,
    backlog: prev.backlog,
    dpOf,
    capOf: combineCaps(resourceGroupCaps(def, slices, cpRt, suPerCpuSecOf(cpc), plexShare, workloadById, prev.backlog), discretionaryCaps(def, slices, prevSys?.scps ?? [])),
    minOf: rgMin(def, slices, prevSys?.scps ?? [], cpRt, suPerCpuSecOf(cpc), plexShare).minOf,
    regions: cicsRegions(def, slices, workloadById, addressSpaces, l.id).regions,
    io,
    ioPriority: def.ioPriorityManagement === false ? false : undefined,
    pagingFrac: pagingFrac[l.id] ?? 0,
    storageCritical,
    promoted,
    promotionShareFrac: sysCfg?.blwltrpctFrac ?? 0.005,
    scpsOnly: false,
  };
  evalInputs[l.id] = evalInput;
  const res = evaluateLpar(evalInput);
  // Swapped-out jobs are ready but not in storage: swap/MPL delay for their class (RMF reports it
  // with the storage delays; APPROX: one delayed sample per swapped job).
  for (const j of swappedBy[l.id] ?? []) {
    const k = scKeyAtService(def, classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: l.id }).serviceClass, jobServiceSu(j, jobShape(j.def, cpSpeed(cpc), ziipSpeed(cpc), io.SEQ.rtSec), cpc));
    let t = res.scps.find((x) => x.scKey === k);
    if (!t) {
      t = emptyScpTick(k, dpOf(k));
      res.scps.push(t);
    }
    t.delayStorage += 1;
    addJobDelay(j, 'swap', TICK_SEC);
  }
  // APPROX: one delay sample per queued job, in the class's first period.
  for (const j of queuedWlmBy[l.id] ?? []) {
    const k = scKeyAtService(def, classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: l.id }).serviceClass, 0);
    let t = res.scps.find((x) => x.scKey === k);
    if (!t) {
      t = emptyScpTick(k, dpOf(k));
      res.scps.push(t);
    }
    t.delayQueue = (t.delayQueue ?? 0) + 1;
  }

  const compBy: Record<string, number> = {};
  const tries: Record<string, number> = {};
  slices.forEach((s, i) => {
    const r = res.slices[i]!;
    if (r.newBacklog > 1e-9) backlog[s.key] = r.newBacklog;
    if (s.workloadId) {
      const wt = wlTick[s.workloadId]!;
      wt.completions += r.completions;
      wt.withinSla += r.withinSla;
      wt.failed += r.failed;
      wt.rtSumSec += r.completions * r.userRtSec;
      if (r.parts) addParts(wt.parts, r.parts, r.completions);
      failedBy[s.workloadId] = (failedBy[s.workloadId] ?? 0) + r.failed;
      if (s.maxQueueMsgs !== undefined) {
        const per = s.cpuSecPerTxn + s.ziipSecPerTxn;
        const qd = (wt.queueDepth ??= {});
        qd[l.id] = (qd[l.id] ?? 0) + (per > 0 ? r.newBacklog / per : 0);
      }
      const k = wlLparKey(s.workloadId, l.id);
      rtByWorkloadLpar[k] = (rtByWorkloadLpar[k] ?? 0) + r.completions * r.rtMeanSec;
      holdByWorkloadLpar[k] = (holdByWorkloadLpar[k] ?? 0) + r.completions * r.holdSec;
      compBy[k] = (compBy[k] ?? 0) + r.completions;
      if (failByWorkloadLpar) {
        // Only fast failures (abends, subsystem rejections) count; timeouts and QR overload are slow and show in the response.
        failByWorkloadLpar[k] = (failByWorkloadLpar[k] ?? 0) + Math.min(r.failed, s.rate * TICK_SEC * (s.abendFrac ?? s.failFrac));
        tries[k] = (tries[k] ?? 0) + r.completions + r.failed;
      }
      const w = workloadById[s.workloadId]!;
      sums.randomIops += s.rate * s.ioPerTxn;
      if (usesDb2(w)) {
        sums.cfRequests += s.rate * DB2.cfRequestsPerTxn;
        sums.cfRequestsBy[l.id] = (sums.cfRequestsBy[l.id] ?? 0) + s.rate * DB2.cfRequestsPerTxn;
      }
    }
  });
  for (const k in compBy) {
    const c = compBy[k]!;
    rtByWorkloadLpar[k] = c > 0 ? rtByWorkloadLpar[k]! / c : 0;
    holdByWorkloadLpar[k] = c > 0 ? holdByWorkloadLpar[k]! / c : 0;
    if (failByWorkloadLpar) {
      const n = tries[k] ?? 0;
      failByWorkloadLpar[k] = n > 0 ? (failByWorkloadLpar[k] ?? 0) / n : 0;
    }
  }

  // Batch progression: share each batch slice's grant across its jobs by demand.
  const depStretch =
    1 +
    ['DB2.DBM1', 'DB2.MSTR', 'DB2.IRLM'].reduce((a, role) => {
      const x = res.roleHealth[role];
      return x ? a + 0.5 * (1 / Math.max(x.health, 0.02) - 1) + 0.02 * x.queueRatio : a;
    }, 0);
  // Batch slices are the last ones on the image, in batchRefs order.
  const batchRefs = batchRefsBy[l.id] ?? [];
  const firstBatch = slices.length - batchRefs.length;
  for (const [bi, ref] of batchRefs.entries()) {
    const r = res.slices[firstBatch + bi]!;
    const cpWant = ref.slice.cpEngines;
    const ziWant = ref.slice.ziipEngines;
    const cpGot = r.cpGranted;
    const ziGot = r.ziipGranted + r.iipcpGranted;
    for (const jr of ref.jobs) {
      const fc = cpWant > 0 ? jr.cp / cpWant : 0;
      const fz = ziWant > 0 ? jr.zi / ziWant : 0;
      const lockStretch = jr.job.def.usesDb2 ? 1 + 0.4 * Math.min(2, env.lockIndex / 4) * Math.min(1, t.onlineDb2Rate / 2000) : 1;
      advanceJob(
        jr.job,
        jr.shape,
        {
          cpWanted: jr.cp,
          cpGot: cpGot * fc,
          ziipWanted: jr.zi,
          ziipGot: ziGot * fz,
          extraStretch: (jr.job.def.usesDb2 ? depStretch : 1) * lockStretch,
          lockStretch,
          ioDelayFrac: io.SEQ.rtSec > 0 ? io.SEQ.delaySec / io.SEQ.rtSec : 0,
        },
        prev.tick,
      );
      const ioNow = jr.shape.ioRate / Math.max(1, jr.job.stretch);
      sums.seqIops += ioNow;
      if (jr.job.def.usesDb2) {
        sums.cfRequests += ioNow * DB2.cfRequestsPerBatchIo;
        sums.cfRequestsBy[l.id] = (sums.cfRequestsBy[l.id] ?? 0) + ioNow * DB2.cfRequestsPerBatchIo;
      }
    }
  }

  // 12a. Measurement into WLM accumulators.
  const scps: ScpState[] = [];
  const seen = new Set<string>();
  const prevScp: Record<string, ScpState> = {};
  for (const p of prevSys?.scps ?? []) prevScp[p.scKey] = p;
  for (const t of res.scps) {
    seen.add(t.scKey);
    const p = prevScp[t.scKey];
    const starved = t.delayCpu > 1e-6 && t.usingCpu < 0.01 * (t.usingCpu + t.delayCpu);
    scps.push({
      scKey: t.scKey,
      dp: dpOf(t.scKey),
      starvedSec: starved ? (p?.starvedSec ?? 0) + TICK_SEC : 0,
      acc: decayInto(p?.acc ?? emptyAcc(), t),
    });
  }
  for (const p of prevSys?.scps ?? []) {
    if (seen.has(p.scKey)) continue;
    scps.push({ ...p, starvedSec: 0, acc: decayInto(p.acc, idleScpTick(p.scKey, p.dp)) });
  }
  systems.push({ lparId: l.id, scps });
  lparTicks.push(res.rcs ? { lparId: l.id, scps: res.scps, roleHealth: res.roleHealth, rcs: res.rcs } : { lparId: l.id, scps: res.scps, roleHealth: res.roleHealth });
}

/** Seconds after a played day's 06:00 start → wall-clock text. */
export function instanceClock(secAfterStart: number): string {
  const s = Math.round(secAfterStart + 6 * 3600) % DAY_SEC;
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayOffset = secAfterStart >= DAY_SEC - 6 * 3600 ? '+1' : '';
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}${dayOffset}`;
}

// A running job is classified every tick; remember the last answer per job definition (the service
// definition is replaced, never edited, so identity is a safe key; classify itself is pure).
const jobClassCache = new WeakMap<object, { def: object; lparId: string; res: ReturnType<typeof classify> }>();
function classifyJob(def: SimState['wlm']['definition'], jobDef: JobRuntime['def'], lparId: string): ReturnType<typeof classify> {
  const hit = jobClassCache.get(jobDef);
  if (hit && hit.def === def && hit.lparId === lparId) return hit.res;
  const res = classify(def, { subsystem: 'JES', TN: jobDef.name, TC: jobDef.jobClass, SY: lparId });
  jobClassCache.set(jobDef, { def, lparId, res });
  return res;
}

const byIdCache = new WeakMap<readonly WorkloadDef[], Record<string, WorkloadDef>>();
function byIdOf(workloads: readonly WorkloadDef[]): Record<string, WorkloadDef> {
  let m = byIdCache.get(workloads);
  if (!m) byIdCache.set(workloads, (m = Object.fromEntries(workloads.map((w) => [w.id, w]))));
  return m;
}

// `${workloadId}@${lparId}` without building a new string every tick.
const wlLparKeys: Record<string, Record<string, string>> = {};
function wlLparKey(workloadId: string, lparId: string): string {
  const m = (wlLparKeys[workloadId] ??= {});
  return (m[lparId] ??= `${workloadId}@${lparId}`);
}

const regionCountCache = new WeakMap<readonly AddressSpaceDef[], Record<string, number>>();
function cicsRegionCount(addressSpaces: readonly AddressSpaceDef[], lparId: string): number {
  let m = regionCountCache.get(addressSpaces);
  if (!m) {
    m = {};
    for (const a of addressSpaces) if (a.role?.startsWith('CICS.')) m[a.lparId] = (m[a.lparId] ?? 0) + 1;
    regionCountCache.set(addressSpaces, m);
  }
  return m[lparId] ?? 0;
}

/** Service a running job has consumed so far: CPU (incl. zIIP) seconds × SU per second, as the
 * period split of transactions counts it. Drives period aging of multi-period batch classes. */
function jobServiceSu(j: JobRuntime, shape: ReturnType<typeof jobShape>, cpc: CpcConfig): number {
  return j.progress * (shape.cpSec + shape.zSec) * suPerCpuSecOf(cpc);
}

/** Which running batch jobs SRM swaps out to fit real memory: least important first (discretionary
 * before importance 5…1), latest started first within an importance (z/OS storage management,
 * SG24-7621 MPL/swap; APPROX: swap-in is immediate once storage frees, and a minimum MPL always stays in). */
export function swapOut(
  def: SimState['wlm']['definition'],
  running: readonly JobRuntime[],
  lparId: string,
  fixedGb: number,
  jobGb: number,
  memoryGb: number,
  serviceSuOf: (j: JobRuntime) => number = () => 0,
): Set<JobRuntime> {
  const out = new Set<JobRuntime>();
  let demand = fixedGb + running.length * jobGb;
  const limit = memoryGb * STORAGE_SWAP.swapToFrac;
  if (fixedGb + running.length * jobGb <= memoryGb * STORAGE_SWAP.swapAboveFrac) return out;
  const rank = (j: JobRuntime) => {
    const g = goalInfo(def, scKeyAtService(def, classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: lparId }).serviceClass, serviceSuOf(j)));
    return !g || g.goal.kind === 'DISC' ? 6 : g.importance;
  };
  const order = [...running].sort((a, b) => rank(b) - rank(a) || (b.startTick ?? 0) - (a.startTick ?? 0) || (a.def.name < b.def.name ? -1 : 1));
  for (const j of order) {
    if (demand <= limit || out.size >= running.length - STORAGE_SWAP.minSwappedIn) break;
    out.add(j);
    demand -= jobGb;
  }
  return out;
}

/** Deep MQ queues spill from buffer pools into page sets and real memory (SPEC §5.10.3). */
function queuedMsgGb(prev: SimState, byId: Record<string, WorkloadDef>, lparId: string): number {
  let gb = 0;
  for (const w of prev.last.workloads) {
    const d = w.queueDepth?.[lparId];
    const def = byId[w.id];
    if (d && def?.mq) gb += (d * def.mq.msgBytes) / 2 ** 30;
  }
  return gb;
}

// 3. Routing: dynamic policies recompute shares from last tick's measurements once per interval.
function updateRouting(s: SimState, scenario: Scenario): SimState {
  const policies = s.routingPolicies;
  if (!policies || s.last.lpars.length === 0) return s;
  let routing = s.routing;
  for (const id of Object.keys(policies).sort()) {
    const policy = policies[id]!;
    const w = scenario.workloads.find((x) => x.id === id) ?? s.extraWorkloads.find((x) => x.id === id);
    if (!w) continue;
    const lparIds = Object.keys(w.routing).sort();
    let shares: Record<string, number> | null = null;
    if (policy.method === 'WLM' && s.tick % ROUTING.wlmIntervalTicks === 0) {
      shares = wlmShares(lparIds.map((lparId) => routeCandidate(s, w, lparId)), w.ziipFrac, policy.distMethod, ROUTING.minShareFrac, ROUTING.shareQuantum);
    } else if (policy.method === 'CPSM_GOAL' && s.tick % ROUTING.cpsmIntervalTicks === 0) {
      const regions = lparIds.map((lparId) => regionStat(s, w, lparId));
      shares = cpsmGoalShares(routing[id] ?? w.routing, regions, policy, ROUTING.abendRtSec, ROUTING.cpsmStepFrac, ROUTING.minShareFrac, ROUTING.shareQuantum);
    }
    if (shares && !sameShares(routing[id], shares)) routing = { ...routing, [id]: shares };
  }
  return routing === s.routing ? s : { ...s, routing };
}

// What CICSPlex SM sees of a region: last tick's normal response and abend rate for this work there.
function regionStat(s: SimState, w: WorkloadDef, lparId: string): RegionStat {
  const k = wlLparKey(w.id, lparId);
  // No normal completions (all timed out, or no traffic yet) reads as the timeout, never as instant.
  const rt = s.env.rtByWorkloadLpar[k] ?? 0;
  return { lparId, rtSec: rt > 0 ? rt : w.timeoutSec, failFrac: s.env.failByWorkloadLpar?.[k] ?? 0 };
}

function routeCandidate(s: SimState, w: WorkloadDef, lparId: string): RouteCandidate {
  const lt = s.last.lpars.find((l) => l.lparId === lparId);
  const pools = s.lpars.find((l) => l.id === lparId)?.pools ?? [];
  const avail = (p: PoolType) => pools.find((x) => x.pool === p)?.availableEffectiveEngines ?? 0;
  const key = scKeyOf(classify(s.wlm.definition, { ...w.work, SY: lparId }).serviceClass, 0);
  const myDp = lt?.scps.find((x) => x.scKey === key)?.dp ?? 0;
  let cpUsed = 0;
  let ziipUsed = 0;
  let cpBusy = 0;
  for (const x of lt?.scps ?? []) {
    cpBusy += x.cpEngines;
    if (x.scKey === key || x.dp < myDp) continue;
    cpUsed += x.cpEngines;
    ziipUsed += x.ziipEngines;
  }
  return { lparId, cpFreeEngines: Math.max(0, avail('CP') - cpUsed), ziipFreeEngines: Math.max(0, avail('ZIIP') - ziipUsed), cpIdleEngines: Math.max(0, avail('CP') - cpBusy) };
}

// Effective content = scenario + run additions + routing overrides. Memoised on object
// identity so slice-template caches stay warm until something actually changes.
// Same scenario + run additions ⇒ same workload content per id; only routing differs (slice-template scope).
const workloadScope = new WeakMap<readonly WorkloadDef[], object>();
const wlCache = new WeakMap<Scenario, WeakMap<readonly WorkloadDef[], WeakMap<object, WorkloadDef[]>>>();
function effectiveWorkloads(scenario: Scenario, s: SimState): WorkloadDef[] {
  let a = wlCache.get(scenario);
  if (!a) wlCache.set(scenario, (a = new WeakMap()));
  let b = a.get(s.extraWorkloads);
  if (!b) a.set(s.extraWorkloads, (b = new WeakMap()));
  let out = b.get(s.routing);
  if (!out) {
    out = [...scenario.workloads, ...s.extraWorkloads].map((w) => (s.routing[w.id] ? { ...w, routing: s.routing[w.id]! } : w));
    b.set(s.routing, out);
    workloadScope.set(out, b);
  }
  return out;
}

const asCache = new WeakMap<Scenario, WeakMap<readonly AddressSpaceDef[], AddressSpaceDef[]>>();
function effectiveAddressSpaces(scenario: Scenario, s: SimState): AddressSpaceDef[] {
  let a = asCache.get(scenario);
  if (!a) asCache.set(scenario, (a = new WeakMap()));
  let out = a.get(s.extraAddressSpaces);
  if (!out) {
    out = [...scenario.addressSpaces, ...s.extraAddressSpaces];
    a.set(s.extraAddressSpaces, out);
  }
  return out;
}

function addParts(into: Record<string, number>, p: NonNullable<import('../wlm/evaluate').SliceResult['parts']>, n: number): void {
  if (n <= 0) return;
  into.base = (into.base ?? 0) + p.base * n;
  into.cpu = (into.cpu ?? 0) + p.cpu * n;
  into.cpuQueue = (into.cpuQueue ?? 0) + p.cpuQueue * n;
  into.ziipQueue = (into.ziipQueue ?? 0) + p.ziip * n;
  into.io = (into.io ?? 0) + p.io * n;
  into.paging = (into.paging ?? 0) + p.paging * n;
  into.dependency = (into.dependency ?? 0) + p.dependency * n;
  into.backlogWait = (into.backlogWait ?? 0) + p.backlogWait * n;
  into.outside = (into.outside ?? 0) + p.outside * n;
  into.outsideRef = (into.outsideRef ?? 0) + p.outsideRef * n;
  const extra = p.extra;
  for (const k in extra) into[k] = (into[k] ?? 0) + extra[k]! * n;
}

function applyCpuModifiers(slices: SliceSpec[], mods: SimState['mods']): SliceSpec[] {
  const measure = mods.measureCpu ?? {};
  const eff = mods.efficiency ?? {};
  const io = mods.ioPerTxn ?? {};
  const shift = mods.ziipShift ?? {};
  const elig = mods.ziipEligMult ?? {};
  const hasCpu = Object.keys(mods.cpu).length > 0;
  const hasAs = Object.keys(mods.asCpu).length > 0;
  const hasProj = Object.keys(eff).length + Object.keys(io).length + Object.keys(shift).length + Object.keys(elig).length > 0;
  if (!hasCpu && !hasAs && !hasProj && Object.keys(measure).length === 0) return slices;
  return slices.map((s) => {
    const m = s.workloadId
      ? (mods.cpu[s.workloadId] ?? 1) * (measure[s.workloadId] ?? 1) * (eff[s.workloadId] ?? 1)
      : s.jobname
        ? (mods.asCpu[s.jobname] ?? 1) * (measure[s.jobname] ?? 1)
        : 1;
    const ioM = s.workloadId ? (io[s.workloadId] ?? 1) : 1;
    const z = s.workloadId ? (shift[s.workloadId] ?? 0) : 0;
    const e = s.workloadId ? (elig[s.workloadId] ?? 1) : 1;
    if (m === 1 && ioM === 1 && z === 0 && e === 1) return s;
    let out = m === 1 ? s : { ...s, cpEngines: s.cpEngines * m, ziipEngines: s.ziipEngines * m, cpuSecPerTxn: s.cpuSecPerTxn * m, ziipSecPerTxn: s.ziipSecPerTxn * m };
    if (ioM !== 1) out = { ...out, ioPerTxn: out.ioPerTxn * ioM, ioRate: out.ioRate * ioM };
    if (z > 0) {
      // Newly zIIP-eligible: that share of general-CP time moves to the zIIP side (it can still overflow back).
      const moveEng = out.cpEngines * z;
      const moveSec = out.cpuSecPerTxn * z;
      out = { ...out, cpEngines: out.cpEngines - moveEng, ziipEngines: out.ziipEngines + moveEng, cpuSecPerTxn: out.cpuSecPerTxn - moveSec, ziipSecPerTxn: out.ziipSecPerTxn + moveSec };
    }
    if (e < 1) {
      // Work that lost zIIP eligibility (e.g. external stored procedures on WLM-managed TCBs) runs on general CPs.
      const backEng = out.ziipEngines * (1 - e);
      const backSec = out.ziipSecPerTxn * (1 - e);
      out = { ...out, cpEngines: out.cpEngines + backEng, ziipEngines: out.ziipEngines - backEng, cpuSecPerTxn: out.cpuSecPerTxn + backSec, ziipSecPerTxn: out.ziipSecPerTxn - backSec };
    }
    return out;
  });
}

function idleScpTick(scKey: string, dp: number): ScpTick {
  return {
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
  };
}

/** Resource group limits in CP engines on one system (MVS Planning: WLM, ch. 7). Type 1 is a sysplex-wide
 * unweighted SU/s budget, of which this system gets `plexShareFrac` (its share of the group's demand); type 2
 * a percentage of the LPAR share, min(weight share, logical CPs); type 3 CPs × 100. Specialty engine use is
 * excluded (the "Include Specialty Processor Consumption" default). APPROX: type 2 ignores a soft cap
 * below the share; type 4 (MSU) and memory pools are not modelled. */
function resolveRgCapEngines(
  type: 1 | 2 | 3,
  max: number,
  cpRt: LparPoolRuntime | undefined,
  suPerSec: number,
  plexShareFrac: number,
): number {
  if (type === 3) return max / 100;
  if (type === 2) return ((cpRt?.entitlementEngines ?? 0) * max) / 100;
  return (max * plexShareFrac) / suPerSec;
}

/** Each type 1 resource group's share of its sysplex CP demand (in SU/s) that runs on `lparId`.
 * APPROX: WLM balances a type 1 group's service across systems by demand; we split its SU/s
 * budget in proportion to this tick's demand. */
export function rgSysplexShares(
  def: SimState['wlm']['definition'],
  slicesBy: Readonly<Record<string, readonly SliceSpec[]>>,
  lpars: readonly LparConfig[],
  cpcOf: Readonly<Record<string, CpcConfig>>,
  lparId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!def.resourceGroups.some((g) => g.type === 1)) return out;
  const total: Record<string, number> = {};
  const here: Record<string, number> = {};
  for (const l of lpars) {
    const slices = slicesBy[l.id];
    if (!slices) continue;
    const suPerSec = suPerCpuSecOf(cpcOf[l.cpcId]!);
    for (const s of slices) {
      const rg = goalInfo(def, s.scKey)?.resourceGroup;
      if (!rg) continue;
      const su = s.cpEngines * suPerSec;
      total[rg] = (total[rg] ?? 0) + su;
      if (l.id === lparId) here[rg] = (here[rg] ?? 0) + su;
    }
  }
  for (const g of def.resourceGroups) {
    if (g.type !== 1) continue;
    const t = total[g.id] ?? 0;
    out[g.id] = t > 0 ? (here[g.id] ?? 0) / t : 1;
  }
  return out;
}

const combineCaps = (a: ((s: SliceSpec) => number) | undefined, b: ((s: SliceSpec) => number) | undefined) =>
  a && b ? (s: SliceSpec) => Math.min(a(s), b(s)) : (a ?? b);

/** Discretionary goal management: while discretionary work on this image is waiting, over-achieving
 * periods with loose goals are capped so it gets cycles. Only if not in a resource group, not a small
 * consumer, velocity ≤ 30 or response goal > 1 min (MVS Planning: WLM p.118), and PI < 0.71; WLM holds
 * the capped PI in 0.71–0.81 (SG24-6472-03 p.183). APPROX: a proportional cap from the current PI instead
 * of WLM's projection; the other SG24-7621 Fig. 4-22 conditions are not modelled. */
export function discretionaryCaps(def: SimState['wlm']['definition'], slices: readonly SliceSpec[], scps: readonly ScpState[]): ((s: SliceSpec) => number) | undefined {
  const D = DISC_GOAL_MGMT;
  const byKey: Record<string, ScpState> = {};
  for (const st of scps) byKey[st.scKey] = st;
  const discWaiting = scps.some((st) => goalInfo(def, st.scKey)?.goal.kind === 'DISC' && st.acc.delay > st.acc.using);
  if (!discWaiting) return undefined;
  const capped: Record<string, number> = {};
  for (const st of scps) {
    const g = goalInfo(def, st.scKey);
    if (!g || g.resourceGroup) continue;
    const goal = g.goal;
    const loose = goal.kind === 'VEL' ? goal.velocity <= D.maxVelocity : goal.kind === 'AVG' || goal.kind === 'PCT' ? goal.rtSec > D.minRtSec : false;
    if (!loose) continue;
    const samples = st.acc.using + st.acc.delay;
    // Decayed sum → steady-state engines.
    const engines = st.acc.cpuEngines * (1 - ACC_DECAY);
    if (engines < D.minEngines) continue;
    const pi = accPi(goal, st.acc);
    if (pi === null) continue;
    const wasCapped = st.acc.delayCap > 0.05 * samples;
    if (pi < D.piBelow || (wasCapped && pi < D.stayCappedPiBelow)) {
      capped[st.scKey] = Math.max(D.minCapFrac, 1 - D.capGainPerPi * (D.stayCappedPiBelow - pi));
    }
  }
  if (Object.keys(capped).length === 0) return undefined;
  return (s) => {
    const f = capped[s.scKey];
    return f === undefined ? Infinity : s.cpEngines * f;
  };
}

/** CICS transactions on this image share the AOR regions' DP (SG24-7621 CICS/IMS region management). */
function cicsRegions(
  def: SimState['wlm']['definition'],
  slices: readonly SliceSpec[],
  byId: Record<string, WorkloadDef>,
  addressSpaces: readonly AddressSpaceDef[],
  lparId: string,
): { regions?: LparEvalInput['regions'] } {
  const aor = addressSpaces.find((a) => a.lparId === lparId && a.role === 'CICS.AOR');
  if (!aor) return {};
  const keys: string[] = [];
  for (const s of slices) {
    if (s.kind === 'TXN' && s.workloadId && byId[s.workloadId]?.subsystem === 'CICS' && !keys.includes(s.scKey)) keys.push(s.scKey);
  }
  if (keys.length === 0) return {};
  keys.sort();
  const regionKey = scKeyAtService(def, classify(def, { subsystem: aor.subsystem, TN: aor.jobname, SY: lparId }).serviceClass, Infinity);
  return { regions: { keys, mode: def.cicsRegionMode ?? 'TRANSACTION', regionKey } };
}

/** A period misses its goal for the minimum when PI > 1; discretionary work when it is mostly
 * waiting (APPROX: WLM's exact test for discretionary members is not documented here). */
function missingGoal(def: SimState['wlm']['definition'], st: ScpState | undefined, scKey: string): boolean {
  if (!st) return false;
  const g = goalInfo(def, scKey)?.goal;
  if (!g) return false;
  if (g.kind === 'DISC') return st.acc.delay > st.acc.using;
  const pi = accPi(g, st.acc);
  return pi !== null && pi > 1;
}

/** Resource group minimums in force: per-period CP engines, only while the group misses goals. */
export function rgMin(
  def: SimState['wlm']['definition'],
  slices: readonly SliceSpec[],
  scps: readonly ScpState[],
  cpRt: LparPoolRuntime | undefined,
  suPerSec: number,
  plexShare: Readonly<Record<string, number>> = {},
): { minOf?: Record<string, number> } {
  const groups = def.resourceGroups.filter((g) => g.min !== null && g.min > 0);
  if (groups.length === 0) return {};
  const minOf: Record<string, number> = {};
  for (const g of groups) {
    const demand: Record<string, number> = {};
    for (const s of slices) if (goalInfo(def, s.scKey)?.resourceGroup === g.id) demand[s.scKey] = (demand[s.scKey] ?? 0) + s.cpEngines;
    const keys = Object.keys(demand).sort();
    const total = keys.reduce((a, k) => a + demand[k]!, 0);
    if (total <= 0 || !keys.some((k) => missingGoal(def, scps.find((x) => x.scKey === k), k))) continue;
    const min = resolveRgCapEngines(g.type, g.min!, cpRt, suPerSec, plexShare[g.id] ?? 1);
    for (const k of keys) minOf[k] = (min * demand[k]!) / total;
  }
  return Object.keys(minOf).length > 0 ? { minOf } : {};
}

export function resourceGroupCaps(
  def: SimState['wlm']['definition'],
  slices: readonly SliceSpec[],
  cpRt: LparPoolRuntime | undefined,
  suPerSec: number,
  plexShare: Readonly<Record<string, number>>,
  workloadById: Readonly<Record<string, WorkloadDef>>,
  backlog: Readonly<Record<string, number>>,
): ((s: SliceSpec) => number) | undefined {
  const groups = def.resourceGroups.filter((g) => g.max !== null);
  if (groups.length === 0) return undefined;
  // Transactions consume their CPU in their host regions (CICS AORs), so a group on the regions' class caps
  // them (WLM Planning p.60 note 1, p.122). APPROX: a transaction slice is a member in proportion to the CPU
  // share of its LPAR's host regions in the group; CPSM routing away from capped AORs is ignored.
  const hostEngines: Record<string, number> = {};
  const hostInGroup: Record<string, Record<string, number>> = {};
  for (const s of slices) {
    if (s.kind !== 'AS' || !s.role) continue;
    hostEngines[s.role] = (hostEngines[s.role] ?? 0) + s.cpEngines;
    const rg = goalInfo(def, s.scKey)?.resourceGroup;
    if (rg) (hostInGroup[s.role] ??= {})[rg] = (hostInGroup[s.role]![rg] ?? 0) + s.cpEngines;
  }
  const hostShare = (s: SliceSpec, rg: string): number => {
    if (s.kind !== 'TXN' || !s.workloadId) return 0;
    const role = workloadById[s.workloadId]?.hostRole;
    const tot = role ? (hostEngines[role] ?? 0) : 0;
    return tot > 0 ? (hostInGroup[role!]?.[rg] ?? 0) / tot : 0;
  };
  const capBySlice: Record<string, number> = {};
  for (const g of groups) {
    const members: { s: SliceSpec; frac: number }[] = [];
    for (const s of slices) {
      const frac = goalInfo(def, s.scKey)?.resourceGroup === g.id ? 1 : hostShare(s, g.id);
      if (frac > 0) members.push({ s, frac });
    }
    const demand = members.reduce((a, m) => a + m.frac * m.s.cpEngines, 0);
    if (demand <= 0) continue;
    const cap = resolveRgCapEngines(g.type, g.max!, cpRt, suPerSec, plexShare[g.id] ?? 1);
    for (const { s, frac } of members) {
      const capped = (cap * frac * s.cpEngines) / demand;
      if (frac >= 1) {
        capBySlice[s.key] = capped;
        continue;
      }
      // The part of the slice running outside the group's regions stays uncapped (same demand as evaluateLpar).
      const tot = s.cpEngines + s.ziipEngines;
      const uncapped = s.cpEngines + ((backlog[s.key] ?? 0) / TICK_SEC) * (tot > 0 ? s.cpEngines / tot : 1);
      capBySlice[s.key] = capped + (1 - frac) * uncapped;
    }
  }
  return (s) => capBySlice[s.key] ?? Infinity;
}
