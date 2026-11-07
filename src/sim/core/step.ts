// The tick pipeline (SPEC §5.1). Stages are added milestone by milestone; the order
// here is the contract. Circular couplings (I/O response, CF service, lock contention,
// subsystem concurrency) use the previous tick's values carried in `env`.
// Stage bodies live in ./tick/ (ctx, control, demand, dispatch, helpers); this file orchestrates them.

import { cfServiceForSystem, evaluateCf, type CfImageInput, type CfSystemResult } from '../cf/cf';
import { cpSpeed, ziipSpeed } from '../hw/cpc';
import type { PoolDemand } from '../hw/pools';
import { evaluateDasd, type IoClass } from '../io/dasd';
import { closeNight, jobShape, projectCriticalEnd, promoteEligible, releaseNetwork, startJobs, type JobRuntime } from '../subsys/batch';
import { baseRate, scheduledBurstMult, stepBurst, stepNoise } from '../workload/arrivals';
import { scKeyOf } from '../workload/slices';
import type { IoService } from '../wlm/evaluate';
import { STORAGE_STEAL_WEIGHT_BY_IMP, STORAGE_STEAL_WEIGHT_DISC } from '../../content/wlm/tuning';
import { CF_FAILURE } from '../../content/cf';
import { clockAt, formatClock } from './clock';
import { applyCommands, type Command } from './commands';
import { Rng } from './rng';
import type { Scenario } from './scenario';
import type { CpcConfig, EnvState, SimState, WorkloadRuntime } from './types';
import { TICK_SEC, TICKS_PER_DAY } from './units';
import { CRITICAL_PROJECTION_EVERY, DEFAULT_IO, type TickCtx, type TickSums } from './tick/ctx';
import { adjustPolicies, prsm, softCap, stepCapping, stepCost, stepRmf } from './tick/control';
import { lparDemand, planLpar } from './tick/demand';
import { dispatchLpar, reserveOverflow } from './tick/dispatch';
import { byIdOf, effectiveAddressSpaces, effectiveWorkloads, updateRouting } from './tick/helpers';

export type { Command } from './commands';
export { instanceClock, swapOut, rgSysplexShares, discretionaryCaps, cicsRegions, cicsHonorPriority, rgMin, resourceGroupCaps } from './tick/helpers';

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
  const db2Lpars = new Set(addressSpaces.filter((a) => a.role === 'DB2.MSTR').map((a) => a.lparId));
  startJobs(batch.jobs, prev.tick, { jobClasses: config.jobClasses, lparBusy, db2Lpars });
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
    capOfBy: {},
    batchRefsBy: {},
    swappedBy: {},
    pagingFrac,
    demands,
    lpars: [],
    storageCritical: new Set<string>(),
    pagingWeight: {},
    evalInputs: {},
    backlog: {},
    ziipBacklog: {},
    failedBy: {},
    wlTick: {},
    rtByWorkloadLpar: {},
    holdByWorkloadLpar: {},
    failByWorkloadLpar: prev.routingPolicies ? {} : null,
    systems: [],
    lparTicks: [],
    onlineDb2Rate: 0,
    slotQueue: {},
    cicsStorageBy: {},
  };
  for (const l of zosLpars) lparDemand(t, l);
  for (const l of zosLpars) planLpar(t, l);
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
  const { backlog, ziipBacklog, failedBy, wlTick, lparTicks, rtByWorkloadLpar, holdByWorkloadLpar, storageCritical, pagingWeight } = t;
  for (const w of workloads) {
    wlTick[w.id] = { id: w.id, arrivalRate: rates[w.id] ?? 0, completions: 0, withinSla: 0, failed: 0, rtSumSec: 0, parts: {} };
  }
  for (const c of def.classes) if (c.storageCritical) c.periods.forEach((_, i) => storageCritical.add(scKeyOf(c.id, i)));
  if (storageCritical.size > 0) {
    for (const c of def.classes) {
      c.periods.forEach((p, i) => {
        pagingWeight[scKeyOf(c.id, i)] = p.goal.kind === 'DISC' ? STORAGE_STEAL_WEIGHT_DISC : (STORAGE_STEAL_WEIGHT_BY_IMP[p.importance - 1] ?? 1);
      });
    }
  }

  if (reserveOverflow(t, zosLpars)) {
    t.lpars.length = 0;
    softCap(t);
    prsm(t);
  }
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
    ziipBacklog,
    last: { lpars: lparTicks, workloads: Object.values(wlTick) },
    env: nextEnv,
    batch,
    capping: { lpars: cappingLpars, groups: cappingGroups },
    cost,
    rmf,
  };
}
