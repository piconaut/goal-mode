// Result stage: server health per role, then every slice's granted engines, sampled
// states, response time and (unless this is a projection) its SLA attainment.

import { lognormCdf } from '../../core/math';
import { TICK_SEC } from '../../core/units';
import type { IoClass } from '../../io/dasd';
import type { LparGrants } from './grants';
import { ioUsingSec } from './io';
import { SRV } from './prepare';
import type { IoService, LparEvalInput, PreparedLpar, SliceResult } from './types';

const MAX_QUEUE_RATIO = 50;

export interface SliceHealth {
  want: number[];
  got: number[];
  health: number[];
  queueRatio: number[];
  roleHealth: Record<string, { health: number; queueRatio: number }>;
  /** Roles whose address spaces are managed as transaction servers (their CPU counts as the classes' CPU delay). */
  srvRoles: Record<string, true>;
}

/** First pass: address spaces → server health by role. */
export function healthByRole(input: LparEvalInput, prepared: PreparedLpar, grants: LparGrants): SliceHealth {
  const { slices } = input;
  const n = slices.length;
  const { sliceCp, sliceZi, sliceCut, sliceAgg } = prepared;
  const { dres, cpG, ziG, iipcpG, overflowCut } = grants;
  const roleHealth: Record<string, { health: number; queueRatio: number }> = {};
  const srvRoles: Record<string, true> = {};
  const want = new Array<number>(n);
  const got = new Array<number>(n);
  const health = new Array<number>(n);
  const queueRatio = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const a = sliceAgg[i]!;
    const r = dres[a]!;
    want[i] = sliceCp[i]! + sliceZi[i]! - (overflowCut?.[i] ?? 0);
    got[i] = cpG[i]! + ziG[i]! + iipcpG[i]!;
    // Capped demand is still wanted: a resource group max makes the region non-dispatchable, so its
    // dependents wait on it (WLM Planning p.57, p.60 note 4).
    const wantAll = want[i]! + sliceCut[i]! + (overflowCut?.[i] ?? 0);
    health[i] = wantAll > 1e-12 ? Math.min(1, got[i]! / wantAll) : 1;
    queueRatio[i] = Math.min(MAX_QUEUE_RATIO, r.cpQueueRatio + r.prsmDelayRatio);
    if (s.kind === 'AS' && s.role) {
      if (prepared.order[a]!.endsWith(SRV)) srvRoles[s.role] = true;
      const prev = roleHealth[s.role];
      if (!prev || health[i]! < prev.health) roleHealth[s.role] = { health: health[i]!, queueRatio: queueRatio[i]! };
    }
  }
  return { want, got, health, queueRatio, roleHealth, srvRoles };
}

/** Second pass: each slice's states, response time and samples. */
export function sliceResults(
  input: LparEvalInput,
  prepared: PreparedLpar,
  grants: LparGrants,
  health: SliceHealth,
  prio: Partial<Record<IoClass, IoService[]>> | null,
  pgBy: readonly number[],
): SliceResult[] {
  const { slices } = input;
  const n = slices.length;
  const scpsOnly = input.scpsOnly === true;
  const { sliceZi, sliceCut, sliceZiCut, sliceAgg, sliceUnits } = prepared;
  const { dres, cpG, ziG, iipcpG, cpUnmetS, ziUnmetS, overflowCut } = grants;
  const { want, got, health: healthBySlice, queueRatio, roleHealth, srvRoles } = health;
  const results = new Array<SliceResult>(n);
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const r = dres[sliceAgg[i]!]!;
    const cpGranted = cpG[i]!;
    const ziipGranted = ziG[i]!;
    const iipcpGranted = iipcpG[i]!;
    const qr = queueRatio[i]!;
    const zq = Math.min(MAX_QUEUE_RATIO, r.ziipQueueRatio);
    const cpUsing = cpGranted + iipcpGranted;
    // LPAR capping (soft or absolute) shows as CPU delay; CAP delay is resource-group and discretionary
    // capping only, "not part of the CPU delay" (RMF Report Analysis p.540).
    const unmetCp = cpUnmetS[i]!;
    const cut = sliceCut[i]! + (overflowCut?.[i] ?? 0);
    const capDelay = cut;
    const unmetZiip = ziUnmetS[i]!;

    const io = prio?.[s.ioClass]?.[i] ?? input.io[s.ioClass];
    const pg = pgBy[i]!;
    if (s.kind === 'AS') {
      const usingIo = s.ioRate * ioUsingSec(io);
      const delayIo = s.ioRate * io.delaySec;
      const delayStorage = (cpUsing + ziipGranted) * pg;
      // Each sampled dispatchable unit is in one state (RMF Report Analysis 3.1 p.540; Monitor III counts an
      // address space once, p.52–53), so processor delay is bounded by the ready units not in another state.
      // Without the bound a saturated pool's queue ratio (up to MAX_QUEUE_RATIO) on top of the unmet demand
      // counts the same wait twice: 12 batch jobs on 3.4 engines showed 140 delay samples, velocity 3 %.
      let delayCpu = cpUsing * qr + unmetCp;
      let delayZiip = ziipGranted * zq + unmetZiip;
      const units = sliceUnits[i];
      if (units !== undefined) {
        const room = Math.max(0, units - cpUsing - ziipGranted - usingIo - delayIo - delayStorage - capDelay);
        const proc = delayCpu + delayZiip;
        if (proc > room) {
          const f = room / proc;
          delayCpu *= f;
          delayZiip *= f;
        }
      }
      results[i] = {
        key: s.key,
        scKey: s.scKey,
        cpGranted,
        ziipGranted,
        iipcpGranted,
        usingCpu: cpUsing,
        usingZiip: ziipGranted,
        usingIo,
        delayCpu,
        delayZiip,
        delayIo,
        delayOther: 0,
        delayStorage,
        delayCap: capDelay,
        completions: 0,
        failed: 0,
        rtMeanSec: 0,
        holdSec: 0,
        userRtSec: 0,
        parts: null,
        newBacklog: 0,
        newZiipBacklog: 0,
        health: healthBySlice[i]!,
        queueRatio: qr,
        withinSla: 0,
      };
      continue;
    }

    // Transactions: backlog of unserved work and Little's-law wait.
    const wantSec = (want[i]! + cut) * TICK_SEC;
    const gotSec = got[i]! * TICK_SEC;
    let newBacklog = Math.max(0, wantSec - gotSec);
    const rawBacklog = newBacklog;
    const rawZiipBacklog = Math.min(rawBacklog, Math.max(0, sliceZi[i]! + sliceZiCut[i]! - ziG[i]! - iipcpG[i]!) * TICK_SEC);
    const gotRate = Math.max(got[i]!, 1e-9);
    let waitSec = newBacklog / gotRate;
    const workPerTxn = s.cpuSecPerTxn + s.ziipSecPerTxn;
    let failed = 0;
    if (s.maxQueueMsgs !== undefined) {
      // MQ: messages wait on the queue; only puts beyond MAXDEPTH fail (MQRC_Q_FULL). Messages already queued
      // above a lowered MAXDEPTH "remain intact" and drain (MQ 9.4 Administration Reference p.463).
      const cap = s.maxQueueMsgs * workPerTxn;
      if (workPerTxn > 0 && newBacklog > cap) {
        const keep = Math.min(newBacklog, Math.max(cap, (input.backlog[s.key] ?? 0) - gotSec));
        failed = (newBacklog - keep) / workPerTxn;
        newBacklog = keep;
        waitSec = newBacklog / gotRate;
      }
      // A starved queue: messages completing now waited about as long as the backlog took to build
      // (Little's law on arrivals), not backlog / a near-zero service rate.
      if (got[i]! < 1e-3 * (want[i]! + cut)) waitSec = Math.min(waitSec, newBacklog / Math.max(want[i]! + cut, 1e-9));
    } else if (waitSec > s.timeoutSec) {
      const keep = gotRate * s.timeoutSec;
      const excess = newBacklog - keep;
      newBacklog = keep;
      waitSec = s.timeoutSec;
      failed = workPerTxn > 0 ? excess / workPerTxn : 0;
    }

    let depDelay = 0;
    // Waiting for regions managed to this work's goals is this work's CPU delay: the regions' delay states count
    // for the transaction classes they serve, and WLM helps those regions to help the class (SG24-7621 p.81, p.126).
    // APPROX: the whole wait counts as CPU, whatever starves the region.
    let srvCpuSec = 0;
    for (const srv of s.servers) {
      const h = roleHealth[srv.role];
      if (!h) continue;
      const d = srv.latencySec * (1 / Math.max(h.health, 0.02) - 1 + h.queueRatio);
      depDelay += d;
      if (srvRoles[srv.role]) srvCpuSec += d;
    }

    const ioSec = s.ioPerTxn * io.rtSec;
    const pagingSec = (s.cpuSecPerTxn + s.ziipSecPerTxn) * pg * 3;
    const otherSec = depDelay - srvCpuSec + s.extraOtherSec;
    const rt =
      s.baseLatencySec +
      s.cpuSecPerTxn * (1 + qr) +
      s.ziipSecPerTxn * (1 + zq) +
      ioSec +
      pagingSec +
      otherSec +
      srvCpuSec +
      waitSec;

    const arrivals = s.rate * TICK_SEC;
    const subsysFailed = arrivals * s.failFrac;
    // A transaction fails once: subsystem rejections and timeouts together are bounded by arrivals.
    failed = Math.min(arrivals, failed + subsysFailed);
    const completions = arrivals - failed;
    const ioRate = s.rate * s.ioPerTxn;
    results[i] = {
      key: s.key,
      scKey: s.scKey,
      cpGranted,
      ziipGranted,
      iipcpGranted,
      usingCpu: cpUsing,
      usingZiip: ziipGranted,
      usingIo: ioRate * ioUsingSec(io),
      delayCpu: cpUsing * qr + unmetCp + s.rate * srvCpuSec,
      delayZiip: ziipGranted * zq + unmetZiip,
      delayIo: ioRate * io.delaySec,
      delayOther: s.rate * otherSec,
      delayStorage: s.rate * pagingSec,
      delayCap: capDelay,
      completions,
      failed,
      rtMeanSec: rt,
      holdSec: rt - waitSec,
      userRtSec: rt + s.outsideWaitSec,
      parts: scpsOnly
        ? null
        : {
            base: s.baseLatencySec,
            cpu: s.cpuSecPerTxn + s.ziipSecPerTxn,
            cpuQueue: s.cpuSecPerTxn * qr,
            ziip: s.ziipSecPerTxn * zq,
            io: ioSec,
            paging: pagingSec,
            dependency: depDelay,
            extra: s.extraParts ?? { other: s.extraOtherSec },
            backlogWait: waitSec,
            outside: s.outsideWaitSec,
            outsideRef: s.outsideRefSec ?? 0,
          },
      newBacklog,
      newZiipBacklog: rawBacklog > 0 ? (rawZiipBacklog * newBacklog) / rawBacklog : 0,
      health: 1,
      queueRatio: qr,
      withinSla: !scpsOnly && s.slaRtSec !== null ? completions * lognormCdf(s.slaRtSec, rt + s.outsideWaitSec, s.rtSigma) : 0,
    };
  }
  return results;
}
