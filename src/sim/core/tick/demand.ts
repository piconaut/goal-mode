import { cpSpeed, ziipSpeed } from '../../hw/cpc';
import { jobShape } from '../../subsys/batch';
import { edsaInUseMb, effectiveMxt, qrTcb, storageCapTasks } from '../../subsys/cics';
import { slotQueueStep } from '../../subsys/slots';
import { CICS_STORAGE, SLOT_QUEUE } from '../../../content/subsys';
import { bpIoMultiplier, DB2 } from '../../subsys/db2';
import { buildSlices, honorsPriority, scKeyAtService } from '../../workload/slices';
import { backlogCpSec, sliceSpec } from '../../wlm/evaluate';
import { pagingDelayFrac } from '../../zos/storage';
import type { LparConfig, CicsStorageTick } from '../types';
import { TICK_SEC } from '../units';
import { type BatchSliceRef, DEFAULT_EFF_RATIO, type TickCtx, usesDb2 } from './ctx';
import { applyCpuModifiers, cicsRegionCount, classifyJob, jobServiceSu, queuedMsgGb, swapOut, wlLparKey, workloadScope } from './helpers';

/** 3–4. One z/OS image's slices (online + batch), storage state and pool demand. */
export function lparDemand(t: TickCtx, l: LparConfig): void {
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
  // Short on storage: a region whose EDSA cannot hold its in-flight tasks attaches fewer (CICS Performance p.76).
  const offeredPerAor = aors.length ? cicsRtWeighted / aors.length : 0;
  let maxTasks = 0;
  const storage: CicsStorageTick[] = [];
  for (const c of aors) {
    const cap = storageCapTasks(c, prev.tick, TICK_SEC, CICS_STORAGE);
    const eff = effectiveMxt(c.maxTasks, cap, offeredPerAor, CICS_STORAGE.sosThrashGamma);
    maxTasks += eff;
    const inFlight = Math.min(c.maxTasks, offeredPerAor);
    storage.push({
      region: c.name,
      limitMb: c.edsaLimitMb ?? CICS_STORAGE.defaultEdsaLimitMb,
      inUseMb: edsaInUseMb(c, inFlight, prev.tick, TICK_SEC, CICS_STORAGE),
      sos: eff < c.maxTasks && inFlight > cap,
    });
  }
  if (storage.length) t.cicsStorageBy[l.id] = storage;
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
    const cpWant = shape.cpRate * (j.cpPace ?? 1) + cfCpu;
    const ziWant = shape.zRate * (j.ziipPace ?? 1);
    ref.slice.cpEngines += cpWant;
    ref.slice.ziipEngines += ziWant;
    ref.slice.ioRate += shape.ioRate / Math.max(1, j.stretch);
    ref.jobs.push({ job: j, cp: cpWant, zi: ziWant, shape });
  }
  const batchRefs = Object.values(refs);
  // One TCB per running job.
  for (const r of batchRefs) r.slice.units = r.jobs.length;
  batchRefsBy[l.id] = batchRefs;
  const all = [...slices, ...batchRefs.map((r) => r.slice)];
  slicesBy[l.id] = all;

  const memDemand = fixedGb + runningJobs * scenario.memory.batchJobGb;
  pagingFrac[l.id] = pagingDelayFrac(memDemand, l.memoryGb);

  let cp = 0;
  let zi = 0;
  for (const s of all) {
    const bl = prev.backlog[s.key] ?? 0;
    const blCp = backlogCpSec(s, prev.backlog, prev.ziipBacklog ?? {});
    cp += s.cpEngines + blCp / TICK_SEC;
    zi += s.ziipEngines + (bl - blCp) / TICK_SEC;
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

