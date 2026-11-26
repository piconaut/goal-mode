// The tick pipeline (SPEC §5.1). Stages are added milestone by milestone; the order
// here is the contract. Circular couplings (I/O response, CF service, lock contention,
// subsystem concurrency) use the previous tick's values carried in `env`.
// Stage bodies live in ./tick/ (ctx, control, demand, dispatch, helpers); this file orchestrates them.

import { startDb2Contention } from '../subsys/db2Contention';
import { cfServiceForSystems, evaluateCf, type CfImageInput } from '../cf/cf';
import { cpSpeed, ziipSpeed } from '../hw/cpc';
import type { PoolDemand } from '../hw/pools';
import { evaluateDasd, type IoClass } from '../io/dasd';
import { activeUtilities, utilityIopsByLcu } from '../subsys/utilities';
import { closeNight, jobShape, lockHolderJob, projectCriticalEnd, promoteEligible, releaseNetwork, startJobs, type JobRuntime } from '../subsys/batch';
import { baseRate, scheduledBurstMult, stepBurst, stepNoise } from '../workload/arrivals';
import { scKeyOf } from '../workload/slices';
import type { IoService } from '../wlm/evaluate';
import { STORAGE_STEAL_WEIGHT_BY_IMP, STORAGE_STEAL_WEIGHT_DISC } from '../../content/wlm/tuning';
import { CF_FAILURE } from '../../content/cf';
import { clockAt, formatClock } from './clock';
import { applyCommands, commandLogLine, COMMAND_LOG_MAX, type Command } from './commands';
import { rolloverOperations } from './operations';
import { failHeldRecalls, gatewayTraffic, hsmIo, recycleRouting, startRecycles, type GatewayTraffic } from './tick/operatorEffects';
import { Rng } from './rng';
import type { Scenario } from './scenario';
import type { CpcConfig, EnvState, SimState, WorkloadRuntime } from './types';
import { TICK_SEC, TICKS_PER_DAY } from './units';
import { CRITICAL_PROJECTION_EVERY, DEFAULT_IO, type TickCtx, type TickSums } from './tick/ctx';
import { adjustPolicies, prsm, softCap, stepCapping, stepCost, stepRmf } from './tick/control';
import { lparDemand, planLpar } from './tick/demand';
import { dispatchLpar, reserveOverflow } from './tick/dispatch';
import { atOrFind, lparPlan } from './tick/plan';
import { byIdOf, effectiveAddressSpaces, effectiveWorkloads, updateRouting } from './tick/helpers';

export type { Command } from './commands';
export { swapOut, rgSysplexShares, discretionaryCaps, cicsRegions, cicsHonorPriority, rgMin, resourceGroupCaps } from './tick/helpers';

/** Site automation restarts a cancelled started task once its restart time comes (PT-52). */
function restartStcs(s: SimState): SimState {
  const down = s.cancelledAddressSpaces;
  if (!down?.some((x) => x.restartTick !== null && x.restartTick <= s.tick)) return s;
  const left = down.filter((x) => x.restartTick === null || x.restartTick > s.tick);
  const back = down.filter((x) => x.restartTick !== null && x.restartTick <= s.tick).map((x) => `${x.jobname} restarted on ${x.lparId} by automation`);
  const { cancelledAddressSpaces: _drop, ...rest } = s;
  return { ...(left.length ? { ...rest, cancelledAddressSpaces: left } : rest), commandLog: [...s.commandLog, ...back.map((m) => commandLogLine(true, m))].slice(-COMMAND_LOG_MAX) };
}

/** The lock boost counts while its holder stream has a job running (always, when the boost names no holder). */
export function lockBoostNow(s: SimState, jobs: readonly JobRuntime[]): number {
  if (!s.mods.lockHolder) return s.mods.lockBoost;
  return lockHolderJob(s.mods, jobs) ? s.mods.lockBoost : 0;
}

export function step(before: SimState, commands: readonly Command[], scenario: Scenario, sources?: Readonly<Record<string, GatewayTraffic>>): SimState {
  const commanded = rolloverOperations(applyCommands(before, commands, scenario.addressSpaces), scenario);
  const prev = startRecycles(restartStcs(updateRouting(commanded, scenario)));
  const rng = new Rng(prev.rng);
  const baseWorkloads = effectiveWorkloads(scenario, prev);
  const clock = clockAt(prev.tick);
  const clockText = formatClock(prev.tick);
  const def = prev.wlm.definition;
  const env = prev.env;
  const db2 = scenario.db2Contention ? startDb2Contention(scenario.db2Contention, env.db2Contention, clock, prev.tick) : undefined;
  const tickOfDay = prev.tick % TICKS_PER_DAY;

  // 1–2. Arrivals (noise is mean-corrected so it doesn't inflate average λ).
  const rates: Record<string, number> = {};
  const gatewayFailed: Record<string, number> | undefined = prev.gatewayModes ? {} : undefined;
  const prevWl: Record<string, WorkloadRuntime> = {};
  for (const w of prev.workloads) prevWl[w.id] = w;
  const workloadRt: WorkloadRuntime[] = baseWorkloads.map((w) => {
    const p = prevWl[w.id] ?? { id: w.id, noise: 0, retryRate: 0, lastRtSec: 0 };
    const noise = stepNoise(p.noise, w, rng.normal());
    // Interactive users (closed loop): slow responses throttle their own arrival rate.
    const closedLoop = w.thinkTimeSec ? w.thinkTimeSec / (w.thinkTimeSec + p.lastRtSec) : 1;
    // Bursts draw from the RNG only when the shape has them, so burst-free scenarios keep their streams.
    const b = w.shape.bursts;
    const burst = b ? stepBurst(p.burst ?? { mult: 1, leftSec: 0 }, b, TICK_SEC, rng) : undefined;
    const burstMult = b && burst ? burst.mult * scheduledBurstMult(b, clock) : 1;
    const organicRate = baseRate(w, clock) * burstMult * (prev.mods.rate[w.id] ?? 1) * Math.exp(noise - (w.noiseSigma * w.noiseSigma) / 2) * closedLoop;
    const mode = prev.gatewayModes?.[w.id];
    rates[w.id] = organicRate + p.retryRate;
    if (mode && gatewayFailed) {
      const edge = gatewayTraffic(mode, organicRate, p.retryRate, sources?.[w.id]);
      rates[w.id] = edge.admittedRate;
      gatewayFailed[w.id] = edge.failedRate * TICK_SEC;
    }
    return burst ? { id: w.id, noise, retryRate: 0, lastRtSec: p.lastRtSec, burst } : { id: w.id, noise, retryRate: 0, lastRtSec: p.lastRtSec };
  });
  if (db2) {
    const id = db2.profile.reader;
    rates[id] = Math.min(rates[id] ?? 0, db2.availableClientSlots / TICK_SEC);
  }
  const cancelledRequests: Record<string, number> | undefined = prev.cancelledSessions?.length ? {} : undefined;
  if (cancelledRequests) {
    for (const session of prev.cancelledSessions ?? []) {
      if (session.kind !== 'DDF_THREAD' || session.atTick !== prev.tick) continue;
      // One unit of work was already in flight. Count its failure, then offer its replacement as new work.
      cancelledRequests[session.workloadId] = (cancelledRequests[session.workloadId] ?? 0) + 1 - session.cohortAborted;
      rates[session.workloadId] = (rates[session.workloadId] ?? 0) + 1 / TICK_SEC;
    }
  }
  const { workloads, addressSpaces, config, failed: recycleFailures } = recycleRouting(prev, baseWorkloads, effectiveAddressSpaces(scenario, prev), rates);
  const plan = lparPlan(scenario, config, def, workloads, addressSpaces);
  const cpcOf = plan.cpcOf;
  const workloadById = byIdOf(workloads);

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
  startJobs(batch.jobs, prev.tick, { jobClasses: config.jobClasses, lparBusy, db2Lpars: plan.db2Lpars });
  failHeldRecalls(prev, batch.jobs);
  const runningBy: Record<string, JobRuntime[]> = {};
  for (const j of batch.jobs) if (j.status === 'RUNNING' && j.lparId !== null) (runningBy[j.lparId] ??= []).push(j);
  // Jobs waiting for an initiator in a WLM-managed class are initiation delay for their service class
  // (WLM Planning p.70); APPROX: counted on the first eligible system. JES-managed queues stay invisible.
  const queuedWlmBy: Record<string, JobRuntime[]> = {};
  for (const j of batch.jobs) {
    if (j.status !== 'QUEUED') continue;
    if (plan.jobClassOf[j.def.jobClass]?.mode !== 'WLM') continue;
    const home = j.def.sysaff ?? plan.wlmHomeOf[j.def.jobClass];
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
      const share = plan.structureShareOf[st.name] ?? 0;
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
  const zosLpars = plan.zosLpars;
  const pagingFrac: Record<string, number> = {};
  const demands: PoolDemand[] = [];
  const t: TickCtx = {
    prev,
    scenario,
    plan,
    def,
    env,
    db2Contention: db2,
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
    imageInputs: {},
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
    readerDispatch: undefined,
    dbatWaitedByLpar: {},
    cicsStorageBy: {},
    cicsAbendsBy: {},
  };
  for (const l of zosLpars) lparDemand(t, l);
  for (const l of zosLpars) planLpar(t, l);
  // Coupling facilities: request work from last tick; a shared CF without thin
  // interrupts polls, consuming its whole logical engine share.
  for (const { lpar: l, cf: cfg, icf } of plan.cfImages) {
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
    wlTick[w.id] = {
      id: w.id, arrivalRate: rates[w.id] ?? 0, completions: 0, withinSla: 0,
      failed: (cancelledRequests?.[w.id] ?? 0) + (gatewayFailed?.[w.id] ?? 0) + (recycleFailures?.[w.id] ?? 0),
      rtSumSec: 0, parts: {},
    };
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
  const hsm = hsmIo(prev);
  const dasd = evaluateDasd(hsm.dasd, { RANDOM: randomIops, SEQ: seqIops }, utilityIopsByLcu(activeUtilities(scenario.utilities, prev.seed, prev.tick, prev.utilityOverruns, prev.terminatedUtilities)));
  const cfImages: CfImageInput[] = config.cfs.flatMap((cfg) => {
    if (cfg.failed) return [];
    const l = plan.lparById[cfg.lparId];
    const icf = l?.pools.find((p) => p.pool === 'ICF');
    const rt = atOrFind(lpars, plan.rtIdxOf[cfg.lparId] ?? -1, (x) => x.id === cfg.lparId)?.pools.find((p) => p.pool === 'ICF');
    if (!l || !icf || !rt) return [];
    return [{ cfg, availableEngines: rt.availableEngines, entitlementEngines: rt.entitlementEngines, dedicated: icf.dedicated }];
  });
  const cf = evaluateCf(cfImages, config.cfStructures, cfRequests, scenario.cfTunables);
  const cfBySystem = cfServiceForSystems(cf, config.cfStructures, zosLpars, plan.siteKmOf, scenario.cfTunables, sums.cfRequestsBy);
  const lockIndex = batch.jobs.reduce((sum, job) => {
    if (job.status === 'RUNNING') return sum + job.def.lockIntensity;
    if (job.lockBackout && job.lockBackout.untilTick > prev.tick) return sum + job.lockBackout.lockIndex;
    return sum;
  }, lockBoostNow(prev, batch.jobs));

  // Batch critical-path projection and end-of-night summary.
  if (prev.tick % CRITICAL_PROJECTION_EVERY === 0) {
    // A job runs at its sysaff LPAR's CPC speed; unpinned jobs project on the first CPC.
    const cpcOfJob = (lparId: string | null): CpcConfig => cpcOf[(lparId === null ? undefined : plan.lparById[lparId])?.cpcId ?? ''] ?? config.cpcs[0]!;
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
    // Retry-storm backouts (RT-23): a share of the completed units ends in rollback. Reporting only; the units still
    // consumed their CPU and time, as an abandoned client request does before Db2 backs it out.
    const rollbackFrac = prev.mods.rollbackFrac?.[wr.id] ?? 0;
    if (rollbackFrac > 0 && wt.completions > 0) wt.rolledBack = wt.completions * Math.min(1, rollbackFrac);
  }

  const nextEnv: EnvState = t.failByWorkloadLpar
    ? { dasd, cf, lockIndex, rtByWorkloadLpar, pagingFrac, failByWorkloadLpar: t.failByWorkloadLpar }
    : { dasd, cf, lockIndex, rtByWorkloadLpar, pagingFrac };
  if (db2) {
    nextEnv.db2Contention = db2.drain ? { readers: db2.readers, drain: db2.drain } : { readers: db2.readers };
  }
  if (Object.keys(t.slotQueue).length > 0) nextEnv.slotQueue = t.slotQueue;
  if (cf.length > 0) nextEnv.cfBySystem = cfBySystem;
  nextEnv.holdByWorkloadLpar = holdByWorkloadLpar;

  const nextTick = prev.tick + 1;
  const { cappingLpars, cappingGroups, groupJoinTicks, groupLimitsMsu, groupByLpar, msuBy, r4haBy } = stepCapping(t, zosLpars);
  const cost = stepCost(t, zosLpars, msuBy, r4haBy, nextTick);
  const rmf = stepRmf(t, batch, dasd, cf, r4haBy, groupByLpar, nextTick, cfBySystem, lockIndex);
  const next: SimState = {
    ...prev,
    ...(hsm.recalls ? { hsmRecalls: hsm.recalls } : {}),
    tick: prev.tick + 1,
    rng: rng.snapshot(),
    lpars,
    wlm: { definition: def, systems: adjusted, log },
    workloads: workloadRt,
    backlog,
    ziipBacklog,
    last: { lpars: lparTicks, workloads: Object.values(wlTick), ...(db2 ? { db2Contention: db2.counters } : {}) },
    env: nextEnv,
    batch,
    capping: {
      lpars: cappingLpars,
      groups: cappingGroups,
      ...(Object.keys(groupJoinTicks).length > 0 ? { groupJoinTicks } : {}),
      ...(Object.keys(groupLimitsMsu).length > 0 ? { groupLimitsMsu } : {}),
    },
    cost,
    rmf,
  };
  if (prev.hsmRecalls && !hsm.recalls) delete next.hsmRecalls;
  return next;
}
