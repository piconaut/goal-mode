import { cpSpeed, suPerCpuSecOf, ziipSpeed } from '../../hw/cpc';
import { addJobDelay, advanceJob, jobShape } from '../../subsys/batch';
import { DB2 } from '../../subsys/db2';
import { scKeyAtService } from '../../workload/slices';
import { classify } from '../../wlm/classify';
import { emptyScpTick, evaluateLpar, type LparEvalInput } from '../../wlm/evaluate';
import { decayInto, emptyAcc, initialDp, type ScpState } from '../../wlm/runtime';
import type { LparConfig } from '../types';
import { TICK_SEC } from '../units';
import { type TickCtx, type TickSums, servers, usesDb2 } from './ctx';
import { addParts, cicsHonorPriority, cicsRegions, combineCaps, discretionaryCaps, idleScpTick, jobServiceSu, resourceGroupCaps, rgMin, rgSysplexShares, wlLparKey } from './helpers';

/** 7–12a. One z/OS image's dispatch, response times, batch progress and WLM measurement. */
export function dispatchLpar(t: TickCtx, l: LparConfig, sums: TickSums): void {
  const { prev, def, env, config, cpcOf, workloadById, addressSpaces, io, lpars, slicesBy, batchRefsBy, swappedBy, queuedWlmBy, pagingFrac } = t;
  const { storageCritical, pagingWeight, evalInputs, backlog, ziipBacklog, failedBy, wlTick, rtByWorkloadLpar, holdByWorkloadLpar, failByWorkloadLpar, systems, lparTicks } = t;
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
  const regions = cicsRegions(def, slices, workloadById, addressSpaces, l.id).regions;
  const overflowSlices = cicsHonorPriority(def, slices, workloadById, regions, prev.backlog, prev.ziipBacklog ?? {});
  // Every optional field is always present so all evaluator inputs share one shape.
  const evalInput: LparEvalInput = {
    cpCapacityEngines: cpRt?.availableEffectiveEngines ?? 0,
    cpServers: servers(cpRt, cpCfg?.logical ?? 0, l.hiperDispatch),
    ziipCapacityEngines: ziRt?.availableEffectiveEngines ?? 0,
    ziipServers: servers(ziRt, ziCfg?.logical ?? 0, l.hiperDispatch),
    cpPrsmDelayFrac: cpRt?.prsmDelayFrac ?? 0,
    slices: sysCfg && !sysCfg.iipHonorPriority ? overflowSlices.map((s) => ({ ...s, mayOverflow: false })) : overflowSlices,
    backlog: prev.backlog,
    ziipBacklog: prev.ziipBacklog ?? {},
    dpOf,
    capOf: combineCaps(resourceGroupCaps(def, slices, cpRt, suPerCpuSecOf(cpc), plexShare, workloadById, prev.backlog, prev.ziipBacklog ?? {}), discretionaryCaps(def, slices, prevSys?.scps ?? [])),
    ...rgMin(def, slices, prevSys?.scps ?? [], cpRt, suPerCpuSecOf(cpc), plexShare),
    regions,
    io,
    ioPriority: def.ioPriorityManagement === false ? false : undefined,
    pagingFrac: pagingFrac[l.id] ?? 0,
    storageCritical,
    pagingWeight,
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
    if (r.newBacklog > 1e-9) {
      backlog[s.key] = r.newBacklog;
      if (r.newZiipBacklog > 1e-9) ziipBacklog[s.key] = r.newZiipBacklog;
    }
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
  const cics = regions?.targets;
  const cicsStorage = t.cicsStorageBy[l.id];
  lparTicks.push({ lparId: l.id, scps: res.scps, roleHealth: res.roleHealth, ...(res.rcs ? { rcs: res.rcs } : {}), ...(cics ? { cics } : {}), ...(cicsStorage ? { cicsStorage } : {}) });
}

