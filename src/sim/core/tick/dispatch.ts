import { addJobDelay, advanceJob, jobShape } from '../../subsys/batch';
import { DB2 } from '../../subsys/db2';
import { scKeyAtService } from '../../workload/slices';
import { emptyScpTick, evaluateLpar, prepareLpar, type LparEvalInput } from '../../wlm/evaluate';
import { decayInto, emptyAcc, initialDp, type ScpState } from '../../wlm/runtime';
import type { LparConfig, LparRuntime } from '../types';
import { TICK_SEC } from '../units';
import { type ImageEvalInput, type TickCtx, type TickSums, servers, usesDb2 } from './ctx';
import { addParts, cicsHonorPriority, classifyJob, idleScpTick, jobServiceSu, rgMin, rgSysplexShares, wlLparKey } from './helpers';
import { atOrFind, type ImagePlan, regionsOf } from './plan';

/** This tick's PR/SM outcome for the image (`t.lpars` is in the plan's `rtIdx` order). */
function runtimeOf(t: TickCtx, img: ImagePlan): LparRuntime {
  const id = img.lpar.id;
  return atOrFind(t.lpars, img.rtIdx, (x) => x.id === id)!;
}

/** The evaluator inputs PR/SM's grants don't change: built once per image per tick, shared by the overflow probe
 * and dispatch. */
function imageInput(t: TickCtx, img: ImagePlan): ImageEvalInput {
  const l = img.lpar;
  const hit = t.imageInputs[l.id];
  if (hit) return hit;
  const { prev, def, config, cpcOf, workloadById, addressSpaces, slicesBy } = t;
  const sysCfg = img.system;
  const prevSys = atOrFind(prev.wlm.systems, img.zosIdx, (s) => s.lparId === l.id);
  const slices = slicesBy[l.id] ?? [];

  const promoted = new Set<string>();
  if (prevSys && sysCfg) {
    for (const s of prevSys.scps) if (s.starvedSec >= sysCfg.blwlinthdSec) promoted.add(s.scKey);
  }

  const dpMap: Record<string, number> = {};
  for (const s of prevSys?.scps ?? []) dpMap[s.scKey] = s.dp;
  const dpOf = (k: string) => dpMap[k] ?? initialDp(def, k);
  const plexShare = rgSysplexShares(def, slicesBy, config.lpars, cpcOf, l.id, prev.backlog, prev.ziipBacklog);
  const regions = regionsOf(img, def, slices, workloadById, addressSpaces).regions;
  const overflowSlices = cicsHonorPriority(def, slices, workloadById, regions, prev.backlog, prev.ziipBacklog ?? {});
  const out: ImageEvalInput = {
    prevSys,
    slices: sysCfg && !sysCfg.iipHonorPriority ? overflowSlices.map((s) => ({ ...s, mayOverflow: false })) : overflowSlices,
    dpOf,
    promoted,
    plexShare,
    regions,
  };
  t.imageInputs[l.id] = out;
  return out;
}

function lparEvalInput(t: TickCtx, img: ImagePlan): LparEvalInput {
  const { prev, def, io, slicesBy, pagingFrac, storageCritical, pagingWeight } = t;
  const l = img.lpar;
  const rt = runtimeOf(t, img);
  const cpRt = rt.pools.find((p) => p.pool === 'CP');
  const ziRt = rt.pools.find((p) => p.pool === 'ZIIP');
  const cpCfg = img.cpPool;
  const ziCfg = img.ziipPool;
  const sysCfg = img.system;
  const { prevSys, slices, dpOf, promoted, plexShare, regions } = imageInput(t, img);
  // Every optional field is always present so all evaluator inputs share one shape.
  const evalInput: LparEvalInput = {
    cpCapacityEngines: cpRt?.availableEffectiveEngines ?? 0,
    cpAllocatedEngines: cpRt?.effectiveEngines ?? 0,
    cpServers: servers(cpRt, cpCfg?.logical ?? 0, l.hiperDispatch),
    ziipCapacityEngines: ziRt?.availableEffectiveEngines ?? 0,
    ziipAllocatedEngines: ziRt?.effectiveEngines ?? 0,
    ziipServers: servers(ziRt, ziCfg?.logical ?? 0, l.hiperDispatch),
    eligibleOnCp: (ziCfg?.logical ?? 0) === 0,
    cpPrsmDelayFrac: cpRt?.prsmDelayFrac ?? 0,
    slices,
    backlog: prev.backlog,
    ziipBacklog: prev.ziipBacklog ?? {},
    dpOf,
    capOf: t.capOfBy[l.id],
    ...rgMin(def, slicesBy[l.id] ?? [], prevSys?.scps ?? [], cpRt, img.suPerCpuSec, plexShare),
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
  return evalInput;
}

/** Reserve CP help for the work left after jointly allocated zIIP grants. The probe uses the image's
 * counterfactual CP availability; actual execution below stays inside the final PR/SM grants. */
export function reserveOverflow(t: TickCtx, lpars: readonly LparConfig[]): boolean {
  let changed = false;
  for (const l of lpars) {
    const img = t.plan.byLparId[l.id]!;
    if (!img.hasZiips) continue;
    if (!imageInput(t, img).slices.some((s) => s.mayOverflow && (s.ziipEngines > 0 || (t.prev.ziipBacklog?.[s.key] ?? 0) > 0))) continue;
    const input = lparEvalInput(t, img);
    input.prepared = prepareLpar(input);
    t.evalInputs[l.id] = input;
    const rt = runtimeOf(t, img);
    const zi = rt.pools.find((p) => p.pool === 'ZIIP');
    if (input.prepared.aggZi.reduce((a, b) => a + b, 0) <= (zi?.effectiveEngines ?? 0)) continue;
    const cp = rt.pools.find((p) => p.pool === 'CP');
    const probe = evaluateLpar({ ...input, cpAllocatedEngines: cp?.availableEffectiveEngines ?? 0, scpsOnly: true });
    const overflow = probe.slices.reduce((sum, s) => sum + s.iipcpGranted, 0);
    if (overflow <= 1e-9) continue;
    const ratio = cp && cp.deliveredEngines > 1e-9 ? cp.effectiveEngines / cp.deliveredEngines : cp && cp.availableEngines > 0 ? cp.availableEffectiveEngines / cp.availableEngines : 1;
    const demand = t.demands.find((d) => d.lparId === l.id && d.pool === 'CP');
    if (demand && ratio > 0) {
      demand.demandEngines += overflow / ratio;
      changed = true;
    }
  }
  return changed;
}

/** 7–12a. One z/OS image's dispatch, response times, batch progress and WLM measurement. */
export function dispatchLpar(t: TickCtx, l: LparConfig, sums: TickSums): void {
  const { prev, def, env, workloadById, io, slicesBy, batchRefsBy, swappedBy, queuedWlmBy } = t;
  const { evalInputs, backlog, ziipBacklog, failedBy, wlTick, rtByWorkloadLpar, holdByWorkloadLpar, failByWorkloadLpar, systems, lparTicks } = t;
  const img = t.plan.byLparId[l.id]!;
  const rt = runtimeOf(t, img);
  const cpRt = rt.pools.find((p) => p.pool === 'CP');
  const slices = slicesBy[l.id] ?? [];
  const cpc = img.cpc;
  const evalInput = lparEvalInput(t, img);
  const prevSys = t.imageInputs[l.id]!.prevSys;
  evalInput.prepared = evalInputs[l.id]?.prepared;
  evalInputs[l.id] = evalInput;
  const { dpOf, regions } = evalInput;
  const res = evaluateLpar(evalInput);
  // Only dispatched cycles consume CPU/MSU. An unused PR/SM offer is WAIT, not busy
  // (RMF Report Analysis 3.1 p.389, p.98). PR/SM availability remains separate from consumption.
  for (const pool of rt.pools) {
    if (pool.pool !== 'CP' && pool.pool !== 'ZIIP') continue;
    const used = res.slices.reduce((sum, s) => sum + (pool.pool === 'CP' ? s.cpGranted + s.iipcpGranted : s.ziipGranted), 0);
    // APPROX: retain the full grant's efficiency instead of recomputing its VH/VM/VL mix for used.
    // With HiperDispatch, this can overstate busy/MSU when the unused portion would run on less efficient VM/VLs.
    const efficiency = pool.deliveredEngines > 1e-9 ? pool.effectiveEngines / pool.deliveredEngines : pool.availableEngines > 0 ? pool.availableEffectiveEngines / pool.availableEngines : 1;
    pool.deliveredEngines = efficiency > 0 ? used / efficiency : 0;
    pool.effectiveEngines = used;
  }
  rt.msuRate = (cpRt?.deliveredEngines ?? 0) * img.msuPerCp;
  // Swapped-out jobs are ready but not in storage: swap/MPL delay for their class (RMF reports it
  // with the storage delays; APPROX: one delayed sample per swapped job).
  for (const j of swappedBy[l.id] ?? []) {
    const k = scKeyAtService(def, classifyJob(def, j.def, l.id).serviceClass, jobServiceSu(j, jobShape(j.def, img.cpSpeed, img.ziipSpeed, io.SEQ.rtSec), cpc));
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
    const k = scKeyAtService(def, classifyJob(def, j.def, l.id).serviceClass, 0);
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
      const k = img.wlKey[s.workloadId] ?? wlLparKey(s.workloadId, l.id);
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
  const prevScps = prevSys?.scps ?? [];
  // Period keys are unique on an image and usually come back in last tick's order: then entry i is the match and
  // every earlier period was seen. Otherwise look them up by key.
  let aligned = prevScps.length <= res.scps.length;
  for (let i = 0; aligned && i < prevScps.length; i++) aligned = prevScps[i]!.scKey === res.scps[i]!.scKey;
  let prevScp: Record<string, ScpState> | undefined;
  if (!aligned) {
    prevScp = {};
    for (const p of prevScps) prevScp[p.scKey] = p;
  }
  for (let i = 0; i < res.scps.length; i++) {
    const t = res.scps[i]!;
    const p = prevScp ? prevScp[t.scKey] : prevScps[i];
    const starved = t.delayCpu > 1e-6 && t.usingCpu < 0.01 * (t.usingCpu + t.delayCpu);
    scps.push({
      scKey: t.scKey,
      dp: dpOf(t.scKey),
      starvedSec: starved ? (p?.starvedSec ?? 0) + TICK_SEC : 0,
      acc: decayInto(p?.acc ?? emptyAcc(), t),
      ...(p?.skipUntilTick !== undefined ? { skipUntilTick: p.skipUntilTick } : {}),
    });
  }
  const seen = prevScp ? new Set(res.scps.map((x) => x.scKey)) : undefined;
  for (const p of seen ? prevScps : []) {
    if (seen!.has(p.scKey)) continue;
    scps.push({ ...p, starvedSec: 0, acc: decayInto(p.acc, idleScpTick(p.scKey, p.dp)) });
  }
  systems.push({ lparId: l.id, scps });
  const cics = regions?.targets;
  const cicsStorage = t.cicsStorageBy[l.id];
  lparTicks.push({
    lparId: l.id,
    scps: res.scps,
    roleHealth: res.roleHealth,
    // RMF projects IIPCP only where a zIIP is defined to the image (online or reserved): Init & Tuning p.434
    // (PROJECTCPU default NO reports nothing on an LPAR with no zIIP at all) and p.431 (defined but offline is
    // still reported for planning). With none, the overflow is plain CP work.
    iipcpReported: img.iipcpReported,
    ...(res.rcs ? { rcs: res.rcs } : {}),
    ...(cics ? { cics } : {}),
    ...(cicsStorage ? { cicsStorage } : {}),
  });
}

