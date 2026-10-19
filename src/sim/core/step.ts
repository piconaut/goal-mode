// The tick pipeline (SPEC §5.1). Stages are added milestone by milestone; the order
// here is the contract. Circular couplings (I/O response, CF service, lock contention,
// subsystem concurrency) use the previous tick's values carried in `env`.

import { evaluateCf, type CfImageInput } from '../cf/cf';
import { closeMonth, recordHour } from '../cost/mlc';
import { groupShares, newR4ha, stepR4ha } from '../cost/r4ha';
import { accumulateTick, closeInterval, newRmfAcc, type JobEndRecord } from '../measure/rmf';
import { cpSpeed, msuPerCp, suPerCpuSecOf, ziipSpeed } from '../hw/cpc';
import { resolveCpc, type PoolDemand } from '../hw/pools';
import { evaluateDasd, type IoClass } from '../io/dasd';
import {
  advanceJob,
  closeNight,
  jobShape,
  projectCriticalEnd,
  promoteEligible,
  releaseNetwork,
  startJobs,
  type JobRuntime,
} from '../subsys/batch';
import { mxtQueueWaitSec, qrTcb } from '../subsys/cics';
import { bpIoMultiplier, dbatQueueWaitSec, DB2 } from '../subsys/db2';
import { baseRate, stepNoise } from '../workload/arrivals';
import { buildSlices, scKeyOf } from '../workload/slices';
import { policyAdjust } from '../wlm/adjust';
import { classify } from '../wlm/classify';
import { evaluateLpar, type IoService, type LparEvalInput, type ScpTick, type SliceSpec } from '../wlm/evaluate';
import { emptyBuckets } from '../wlm/goals';
import {
  decayInto,
  emptyAcc,
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
  EnvState,
  LparPoolRuntime,
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

const usesRole = (servers: readonly { role: string }[], prefix: string) => servers.some((s) => s.role.startsWith(prefix));

interface BatchSliceRef {
  slice: SliceSpec;
  jobs: { job: JobRuntime; cp: number; zi: number; shape: ReturnType<typeof jobShape> }[];
}

export function step(before: SimState, commands: readonly Command[], scenario: Scenario): SimState {
  const prev = applyCommands(before, commands);
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
  const workloadById = Object.fromEntries(workloads.map((w) => [w.id, w]));

  // 1–2. Arrivals (noise is mean-corrected so it doesn't inflate average λ).
  const rates: Record<string, number> = {};
  const prevWl: Record<string, WorkloadRuntime> = {};
  for (const w of prev.workloads) prevWl[w.id] = w;
  const workloadRt: WorkloadRuntime[] = workloads.map((w) => {
    const p = prevWl[w.id] ?? { id: w.id, noise: 0, retryRate: 0, lastRtSec: 0 };
    const noise = stepNoise(p.noise, w, rng.normal());
    // Interactive users (closed loop): slow responses throttle their own arrival rate.
    const closedLoop = w.thinkTimeSec ? w.thinkTimeSec / (w.thinkTimeSec + p.lastRtSec) : 1;
    rates[w.id] = baseRate(w, clock) * (prev.mods.rate[w.id] ?? 1) * Math.exp(noise - (w.noiseSigma * w.noiseSigma) / 2) * closedLoop + p.retryRate;
    return { id: w.id, noise, retryRate: 0, lastRtSec: p.lastRtSec };
  });

  // Batch scheduling: release tonight's network at the start of the played day.
  // Finished jobs are never mutated again, so they can be shared with the previous state.
  let batch = { ...prev.batch, jobs: prev.batch.jobs.map((j) => (j.status === 'DONE' ? j : { ...j })) };
  if (tickOfDay === 0) batch = releaseNetwork(batch, clock.day, scenario.batchNetwork(prev.seed, clock.day, clock.dayOfMonth));
  promoteEligible(batch.jobs, prev.tick);
  const lparBusy: Record<string, number> = {};
  for (const l of prev.lpars) {
    const cp = l.pools.find((p) => p.pool === 'CP');
    if (cp && cp.availableEngines > 0) lparBusy[l.id] = cp.deliveredEngines / cp.availableEngines;
  }
  startJobs(batch.jobs, prev.tick, { jobClasses: config.jobClasses, lparBusy });

  const io: Record<IoClass, IoService> = env.dasd
    ? {
        RANDOM: { rtSec: env.dasd.classes.RANDOM.rtSec, delaySec: env.dasd.classes.RANDOM.iosqSec + env.dasd.classes.RANDOM.pendSec },
        SEQ: { rtSec: env.dasd.classes.SEQ.rtSec, delaySec: env.dasd.classes.SEQ.iosqSec + env.dasd.classes.SEQ.pendSec },
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

  // 3–4. Slices and demand per z/OS image.
  const zosLpars = config.lpars.filter((l) => l.kind === 'ZOS');
  const slicesBy: Record<string, SliceSpec[]> = {};
  const batchRefsBy: Record<string, BatchSliceRef[]> = {};
  const pagingFrac: Record<string, number> = {};
  const demands: PoolDemand[] = [];
  for (const l of zosLpars) {
    const cpc = cpcOf[l.cpcId]!;
    const cpSp = cpSpeed(cpc);
    const zSp = ziipSpeed(cpc);
    const base = applyCpuModifiers(buildSlices({ def, cpc, lpar: l, workloads, rates, addressSpaces }), prev.mods);

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
    for (const s of base) {
      if (s.kind !== 'TXN' || !s.workloadId) continue;
      const w = workloadById[s.workloadId]!;
      const prevRt = env.rtByWorkloadLpar[`${w.id}@${l.id}`] ?? 0.05;
      if (w.subsystem === 'CICS') {
        cicsQrCpu += s.rate * s.cpuSecPerTxn;
        cicsRate += s.rate;
        cicsRtWeighted += s.rate * prevRt;
      }
      if (w.subsystem === 'DDF') {
        ddfRate += s.rate;
        ddfRtWeighted += s.rate * prevRt;
      }
    }
    const meanQrFrac = aors.length ? aors.reduce((a, c) => a + c.qrFrac, 0) / aors.length : 0;
    const qr = qrTcb(aors.length ? (cicsQrCpu * meanQrFrac) / aors.length : 0);
    const maxTasks = aors.reduce((a, c) => a + c.maxTasks, 0);
    const mxtWait = aors.length ? mxtQueueWaitSec(cicsRate, cicsRate > 0 ? cicsRtWeighted / cicsRate : 0, maxTasks) : 0;
    const dbatWait = db2 ? dbatQueueWaitSec(ddfRate, ddfRate > 0 ? ddfRtWeighted / ddfRate : 0, db2.maxDbat) : 0;

    const slices: SliceSpec[] = base.map((s) => {
      if (s.kind !== 'TXN' || !s.workloadId) return s;
      const w = workloadById[s.workloadId]!;
      let extra = 0;
      let failFrac = 0;
      let cpuAdd = 0;
      let ioPerTxn = s.ioPerTxn;
      const parts: Record<string, number> = {};
      if (usesRole(w.servers, 'DB2.')) {
        ioPerTxn *= ioMult;
        parts.cf = DB2.cfRequestsPerTxn * cfServiceSec;
        parts.lock = DB2.lockWaitSecPerIndex * env.lockIndex;
        extra += parts.cf + parts.lock;
        cpuAdd += DB2.cfRequestsPerTxn * cfZosCpuSec;
      }
      let outside = 0;
      if (w.subsystem === 'CICS' && aors.length) {
        parts.qr = s.cpuSecPerTxn * meanQrFrac * qr.qrWaitRatio;
        extra += parts.qr;
        outside += mxtWait;
        failFrac = qr.failFrac;
      }
      if (w.subsystem === 'DDF') outside += dbatWait;
      return {
        ...s,
        ioPerTxn,
        extraParts: parts,
        extraOtherSec: extra,
        outsideWaitSec: outside,
        failFrac,
        cpuSecPerTxn: s.cpuSecPerTxn + cpuAdd,
        cpEngines: s.cpEngines + s.rate * cpuAdd,
      };
    });

    // Batch: one slice per service-class period of running jobs on this image.
    const refs: Record<string, BatchSliceRef> = {};
    const seqRt = io.SEQ.rtSec;
    let runningJobs = 0;
    for (const j of batch.jobs) {
      if (j.status !== 'RUNNING' || j.lparId !== l.id) continue;
      runningJobs++;
      const cls = classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: l.id });
      const scKey = scKeyOf(cls.serviceClass, 0);
      const shape = jobShape(j.def, cpSp, zSp, seqRt);
      const cfCpu = j.def.usesDb2 ? shape.ioRate * DB2.cfRequestsPerBatchIo * cfZosCpuSec : 0;
      let ref = refs[scKey];
      if (!ref) {
        ref = {
          slice: {
            key: `BATCH:${scKey}@${l.id}`,
            scKey,
            kind: 'AS',
            workloadId: null,
            jobname: null,
            role: null,
            rate: 0,
            cpEngines: 0,
            ziipEngines: 0,
            mayOverflow: true,
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
          },
          jobs: [],
        };
        refs[scKey] = ref;
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

    // Storage: base + Db2 buffer pools + CICS regions + running jobs.
    const cicsRegions = cicsRegionCount(addressSpaces, l.id);
    const memDemand =
      (scenario.memory.osBaseGb[l.id] ?? 20) +
      (db2?.bufferPoolGb ?? 0) +
      cicsRegions * scenario.memory.cicsRegionGb +
      runningJobs * scenario.memory.batchJobGb;
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
  // Coupling facilities: request work from last tick; a shared CF without thin
  // interrupts polls, consuming its whole logical engine share.
  for (const l of config.lpars.filter((x) => x.kind === 'CF')) {
    const cfg = config.cfs.find((c) => c.lparId === l.id);
    const icf = l.pools.find((p) => p.pool === 'ICF');
    const work = (env.cf.find((r) => r.lparId === l.id)?.demandEngines ?? 0) + (scenario.cfBaseEngines[l.id] ?? 0);
    const polling = icf && !icf.dedicated && cfg && !cfg.thinInterrupts;
    demands.push({ lparId: l.id, pool: 'ICF', demandEngines: polling ? (icf?.logical ?? 1) : work, softCapEngines: Infinity });
  }

  // 6. Soft capping: LPARs whose R4HA exceeds their defined capacity, and members of
  // capacity groups over their limit, are held to their MSU share.
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

  // 5. PR/SM.
  const lpars: LparRuntime[] = [];
  for (const cpc of config.cpcs) {
    const res = resolveCpc(cpc, config.lpars, demands);
    const msuCp = msuPerCp(cpc);
    for (const l of config.lpars.filter((x) => x.cpcId === cpc.id)) {
      const pools = l.pools.flatMap((p) => {
        const r = res[`${l.id}:${p.pool}`];
        return r ? [r] : [];
      });
      const cpRt = pools.find((p) => p.pool === 'CP');
      lpars.push({ id: l.id, pools, msuRate: l.kind === 'ZOS' ? (cpRt?.deliveredEngines ?? 0) * msuCp : 0 });
    }
  }

  // 7–10. Dispatch and response per image.
  const backlog: Record<string, number> = {};
  const failedBy: Record<string, number> = {};
  const wlTick: Record<string, WorkloadTick> = {};
  for (const w of workloads) {
    wlTick[w.id] = { id: w.id, arrivalRate: rates[w.id] ?? 0, completions: 0, withinSla: 0, failed: 0, rtSumSec: 0, parts: {} };
  }
  const lparTicks: LparTick[] = [];
  const systems: WlmSystemState[] = [];
  const evalInputs: Record<string, Omit<LparEvalInput, 'dpOf'>> = {};
  const rtByWorkloadLpar: Record<string, number> = {};
  let randomIops = 0;
  let seqIops = 0;
  let cfRequests = 0;
  let onlineDb2Rate = 0;
  const storageCritical = new Set<string>();
  for (const c of def.classes) if (c.storageCritical) c.periods.forEach((_, i) => storageCritical.add(scKeyOf(c.id, i)));

  for (const l of zosLpars) {
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
    const evalInput: Omit<LparEvalInput, 'dpOf'> = {
      cpCapacityEngines: cpRt?.availableEffectiveEngines ?? 0,
      cpServers: servers(cpRt, cpCfg?.logical ?? 0, l.hiperDispatch),
      ziipCapacityEngines: ziRt?.availableEffectiveEngines ?? 0,
      ziipServers: servers(ziRt, ziCfg?.logical ?? 0, l.hiperDispatch),
      cpPrsmDelayFrac: cpRt?.prsmDelayFrac ?? 0,
      cappedFrac: cpRt?.cappedFrac ?? 0,
      slices: slices.map((s) => (sysCfg && !sysCfg.iipHonorPriority ? { ...s, mayOverflow: false } : s)),
      backlog: prev.backlog,
      io,
      pagingFrac: pagingFrac[l.id] ?? 0,
      storageCritical,
      capOf: resourceGroupCaps(def, slices, cpRt, suPerCpuSecOf(cpc)),
      promoted,
      promotionShareFrac: sysCfg?.blwltrpctFrac ?? 0.005,
    };
    evalInputs[l.id] = evalInput;
    const dpMap: Record<string, number> = {};
    for (const s of prevSys?.scps ?? []) dpMap[s.scKey] = s.dp;
    const dpOf = (k: string) => dpMap[k] ?? initialDp(def, k);
    const res = evaluateLpar({ ...evalInput, dpOf });

    const sliceIdx: Record<string, number> = {};
    const compBy: Record<string, number> = {};
    slices.forEach((s, i) => {
      sliceIdx[s.key] = i;
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
        const k = `${s.workloadId}@${l.id}`;
        rtByWorkloadLpar[k] = (rtByWorkloadLpar[k] ?? 0) + r.completions * r.rtMeanSec;
        compBy[k] = (compBy[k] ?? 0) + r.completions;
        const w = workloadById[s.workloadId]!;
        randomIops += s.rate * s.ioPerTxn;
        if (usesRole(w.servers, 'DB2.')) {
          cfRequests += s.rate * DB2.cfRequestsPerTxn;
          onlineDb2Rate += s.rate;
        }
      }
    });
    for (const [k, c] of Object.entries(compBy)) rtByWorkloadLpar[k] = c > 0 ? rtByWorkloadLpar[k]! / c : 0;

    // Batch progression: share each batch slice's grant across its jobs by demand.
    const depStretch =
      1 +
      ['DB2.DBM1', 'DB2.MSTR', 'DB2.IRLM'].reduce((a, role) => {
        const x = res.roleHealth[role];
        return x ? a + 0.5 * (1 / Math.max(x.health, 0.02) - 1) + 0.02 * x.queueRatio : a;
      }, 0);
    for (const ref of batchRefsBy[l.id] ?? []) {
      const r = res.slices[sliceIdx[ref.slice.key]!]!;
      const cpWant = ref.slice.cpEngines;
      const ziWant = ref.slice.ziipEngines;
      const cpGot = r.cpGranted;
      const ziGot = r.ziipGranted + r.iipcpGranted;
      for (const jr of ref.jobs) {
        const fc = cpWant > 0 ? jr.cp / cpWant : 0;
        const fz = ziWant > 0 ? jr.zi / ziWant : 0;
        const lockStretch = jr.job.def.usesDb2 ? 1 + 0.4 * Math.min(2, env.lockIndex / 4) * Math.min(1, onlineDb2Rate / 2000) : 1;
        advanceJob(
          jr.job,
          jr.shape,
          {
            cpWanted: jr.cp,
            cpGot: cpGot * fc,
            ziipWanted: jr.zi,
            ziipGot: ziGot * fz,
            extraStretch: (jr.job.def.usesDb2 ? depStretch : 1) * lockStretch,
          },
          prev.tick,
        );
        const ioNow = jr.shape.ioRate / Math.max(1, jr.job.stretch);
        seqIops += ioNow;
        if (jr.job.def.usesDb2) cfRequests += ioNow * DB2.cfRequestsPerBatchIo;
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
    lparTicks.push({ lparId: l.id, scps: res.scps, roleHealth: res.roleHealth });
  }

  // I/O subsystem and CF for next tick.
  const dasd = evaluateDasd(config.dasd, { RANDOM: randomIops, SEQ: seqIops });
  const cfImages: CfImageInput[] = config.cfs.flatMap((cfg) => {
    const l = config.lpars.find((x) => x.id === cfg.lparId);
    const icf = l?.pools.find((p) => p.pool === 'ICF');
    const rt = lpars.find((x) => x.id === cfg.lparId)?.pools.find((p) => p.pool === 'ICF');
    if (!l || !icf || !rt) return [];
    return [{ cfg, availableEngines: rt.availableEngines, entitlementEngines: rt.entitlementEngines, dedicated: icf.dedicated }];
  });
  const cf = evaluateCf(cfImages, config.cfStructures, cfRequests, scenario.cfTunables);
  const lockIndex = batch.jobs.reduce((a, j) => (j.status === 'RUNNING' ? a + j.def.lockIntensity : a), 0) + prev.mods.lockBoost;

  // Batch critical-path projection and end-of-night summary.
  if (prev.tick % CRITICAL_PROJECTION_EVERY === 0) {
    const cpc0 = config.cpcs[0]!;
    const cpSp0 = cpSpeed(cpc0);
    const zSp0 = ziipSpeed(cpc0);
    batch.projectedCriticalEndSec = projectCriticalEnd(batch.jobs, clock.day, prev.tick, (j) => jobShape(j.def, cpSp0, zSp0, io.SEQ.rtSec).elapsed);
  }
  if (tickOfDay === TICKS_PER_DAY - 1) batch = closeNight(batch, clock.day);

  // 12b. Policy adjustment, one receiver per system.
  const spPi = sysplexPis(def, systems);
  const log = [...prev.wlm.log];
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
    if (out.log && (out.log.includes('RCVR=') || prev.tick % 30 === 0)) log.push(out.log);
    return { ...sys, scps: sys.scps.map((s) => ({ ...s, dp: out.dps[s.scKey] ?? s.dp })) };
  });
  while (log.length > WLM_LOG_MAX) log.shift();

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

  const nextEnv: EnvState = { dasd, cf, lockIndex, rtByWorkloadLpar, pagingFrac };

  // R4HA bookkeeping and soft-cap decisions for the next tick.
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

  // MLC: hourly SCRT-style sample, monthly bill.
  let cost = prev.cost;
  const nextTick = prev.tick + 1;
  if (nextTick % 360 === 0) {
    const dcBy: Record<string, number | null> = {};
    for (const l of zosLpars) dcBy[l.id] = l.definedCapacityMsu;
    cost = recordHour(cost, scenario.products, r4haBy, dcBy, nextTick);
  }
  if (clockAt(nextTick).dayOfMonth === 1 && clock.dayOfMonth !== 1) cost = closeMonth(cost, scenario.products);

  // RMF interval data.
  const jobsEnded: JobEndRecord[] = batch.jobs
    .filter((j) => j.endTick === nextTick && j.startTick !== null)
    .map((j) => ({
      name: j.def.name,
      stream: j.def.stream,
      lparId: j.lparId ?? '',
      critical: j.def.critical,
      queuedSec: ((j.startTick ?? 0) - (j.queuedTick ?? j.startTick ?? 0)) * TICK_SEC,
      elapsedSec: (nextTick - (j.startTick ?? nextTick)) * TICK_SEC,
      endTick: nextTick,
      stretch: j.stretch,
    }));
  let rmfAcc = accumulateTick(prev.rmf.acc, lparTicks, lpars, dasd, cf);
  let jobsThisInterval = [...prev.rmf.jobsThisInterval, ...jobsEnded];
  let intervals = prev.rmf.intervals;
  const intervalTicks = Math.max(1, Math.round((config.rmfIntervalMin * 60) / TICK_SEC));
  if (nextTick % intervalTicks === 0) {
    intervals = [...intervals, closeInterval(rmfAcc, { def, config, r4haByLpar: r4haBy, jobs: jobsThisInterval, endTick: nextTick })];
    if (intervals.length > RMF_KEEP) intervals = intervals.slice(intervals.length - RMF_KEEP);
    rmfAcc = newRmfAcc(nextTick);
    jobsThisInterval = [];
  }
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
    rmf: { acc: rmfAcc, intervals, jobsThisInterval },
  };
}

/** Seconds after a played day's 06:00 start → wall-clock text. */
export function instanceClock(secAfterStart: number): string {
  const s = Math.round(secAfterStart + 6 * 3600) % DAY_SEC;
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayOffset = secAfterStart >= DAY_SEC - 6 * 3600 ? '+1' : '';
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}${dayOffset}`;
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

// Effective content = scenario + run additions + routing overrides. Memoised on object
// identity so slice-template caches stay warm until something actually changes.
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
  const add = (k: string, v: number) => (into[k] = (into[k] ?? 0) + v * n);
  add('base', p.base);
  add('cpu', p.cpu);
  add('cpuQueue', p.cpuQueue);
  add('ziipQueue', p.ziip);
  add('io', p.io);
  add('paging', p.paging);
  add('dependency', p.dependency);
  add('backlogWait', p.backlogWait);
  add('outside', p.outside);
  for (const [k, v] of Object.entries(p.extra)) add(k, v);
}

function applyCpuModifiers(slices: SliceSpec[], mods: SimState['mods']): SliceSpec[] {
  const measure = mods.measureCpu ?? {};
  const hasCpu = Object.keys(mods.cpu).length > 0;
  const hasAs = Object.keys(mods.asCpu).length > 0;
  if (!hasCpu && !hasAs && Object.keys(measure).length === 0) return slices;
  return slices.map((s) => {
    const m = s.workloadId
      ? (mods.cpu[s.workloadId] ?? 1) * (measure[s.workloadId] ?? 1)
      : s.jobname
        ? (mods.asCpu[s.jobname] ?? 1) * (measure[s.jobname] ?? 1)
        : 1;
    if (m === 1) return s;
    return { ...s, cpEngines: s.cpEngines * m, ziipEngines: s.ziipEngines * m, cpuSecPerTxn: s.cpuSecPerTxn * m, ziipSecPerTxn: s.ziipSecPerTxn * m };
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

/** Resource group maximums as per-slice CP caps (types 2 and 3 are system scope; type 1 is
 * sysplex scope, APPROX: split evenly across the systems where its members run). */
function resolveRgCapEngines(
  type: 1 | 2 | 3,
  max: number,
  cpRt: LparPoolRuntime | undefined,
  suPerSec: number,
  systemsWithMembers: number,
): number {
  if (type === 3) return max / 100;
  if (type === 2) return ((cpRt?.entitlementEngines ?? 0) * max) / 100;
  return max / suPerSec / Math.max(1, systemsWithMembers);
}

function resourceGroupCaps(
  def: SimState['wlm']['definition'],
  slices: readonly SliceSpec[],
  cpRt: LparPoolRuntime | undefined,
  suPerSec: number,
): ((s: SliceSpec) => number) | undefined {
  const groups = def.resourceGroups.filter((g) => g.max !== null);
  if (groups.length === 0) return undefined;
  const capBySlice: Record<string, number> = {};
  for (const g of groups) {
    const members = slices.filter((s) => goalInfo(def, s.scKey)?.resourceGroup === g.id);
    const demand = members.reduce((a, s) => a + s.cpEngines, 0);
    if (demand <= 0) continue;
    const cap = resolveRgCapEngines(g.type, g.max!, cpRt, suPerSec, 1);
    for (const s of members) capBySlice[s.key] = (cap * s.cpEngines) / demand;
  }
  return (s) => capBySlice[s.key] ?? Infinity;
}
