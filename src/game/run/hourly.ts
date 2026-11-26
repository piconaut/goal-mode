import { PLANNER } from '../../content/planner';
import { CO_DOMINANT_SHARE, DELAY_FLOOR_FRAC, SLOT_BASELINE_DECAY } from '../../content/sla';
import { clockAt } from '../../sim/core/clock';
import { msuPerCp } from '../../sim/hw/cpc';
import { streamRng } from '../../sim/core/rng';
import type { Scenario } from '../../sim/core/scenario';
import type { WorkloadDef } from '../../sim/workload/types';
import { addDb2Counters, emptyDb2Counters } from '../../sim/subsys/db2Contention';
import { TICK_SEC, TICKS_PER_HOUR } from '../../sim/core/units';
import { SERVER_KEY } from '../../sim/wlm/holders';
import type { ServiceDefinition } from '../../sim/wlm/types';
import { accumulateCpuGrant, accumulateCpuGrants, accumulateCpuWaits } from '../hourAccounting';
import { aiopsHypotheses, type Hypothesis } from '../aiops';
import { activeIn, addHour, clockHourOf, footprintRelation, groupExcess, hourAttainment, importanceRank, markMet, perTxnParts, rankedMechanismGroups, slotBaseline, updateBaseline, workScopeOf, type WorkScope } from '../sla';
import { judgeWorkloadHour } from '../hourTruth';
import { hostImages } from '../footprint';
import { peersOf, slowCf, slowLcu, type PeerRows } from '../peerSlow';
import {
  type CapacityDay,
  type HourAcc,
  type Incident,
  type QuietHour,
  type RunState,
  type WorkloadHour
} from '../types';
import { slowInternalOf } from '../staff';
import { allWorkloads } from '../workloads';
import { incidentSubjects } from '../evidence';
import { db2RollbacksByLpar } from '../smf';
import type { GameContent } from './shared';
import { addGroupedIncident } from './grouping';
import { toolOn } from './shared';
import { clampTrust, FACET_WEIGHT, facetOf, logLine, msg } from './shared';

type OptionalHourFields = 'cicsStorage' | 'db2Contention';
type ActiveHour = Required<Omit<HourAcc, OptionalHourFields>> & Pick<HourAcc, OptionalHourFields>;

export const newHour = (tick: number): ActiveHour => ({
  hourIndex: Math.floor(tick / TICKS_PER_HOUR),
  ticks: 0,
  workloads: {},
  maxCappedFrac: 0,
  cappedByLpar: {},
  cappedTicksByLpar: {},
  cpcBusySum: 0,
  cpcBusyById: {},
  lparBusyById: {},
  cpByImportance: {},
  cpuWaitByWorkloadLpar: {},
  cpByScpLpar: {},
  cpByRoleLpar: {},
  cpByWorkloadLpar: {},
  capDelayByScpLpar: {},
  roleCappedTicks: {},
  ziipBusyById: {},
  ziipLparBusyById: {},
  lockIndexSum: 0,
  dbatQueuedByLpar: {},
});

function cloneRows<T>(source: Record<string, T> | undefined, copy: (value: T) => T): Record<string, T> {
  const result = { ...source };
  for (const key of Object.keys(result)) result[key] = copy(result[key]!);
  return result;
}

function cloneLedger<T extends object>(source: Record<string, Record<string, T>> | undefined): Record<string, Record<string, T>> {
  return cloneRows(source, (rows) => cloneRows(rows, (row) => ({ ...row })));
}

/** Take a private copy before advancing a run that may be retained as a snapshot or forked. */
export function copyHourForAdvance(run: RunState): ActiveHour {
  const h = run.hour;
  if (!h) return newHour(run.sim.tick - 1);
  return {
    ...h,
    workloads: cloneRows(h.workloads, (w) => ({ ...w, parts: { ...w.parts } })),
    cappedByLpar: { ...h.cappedByLpar },
    cappedTicksByLpar: { ...h.cappedTicksByLpar },
    cpcBusyById: { ...h.cpcBusyById },
    lparBusyById: { ...h.lparBusyById },
    cpByImportance: cloneRows(h.cpByImportance, (a) => a.slice()),
    cpuWaitByWorkloadLpar: cloneLedger(h.cpuWaitByWorkloadLpar),
    cpByScpLpar: cloneLedger(h.cpByScpLpar),
    cpByRoleLpar: cloneLedger(h.cpByRoleLpar),
    cpByWorkloadLpar: cloneLedger(h.cpByWorkloadLpar),
    capDelayByScpLpar: cloneLedger(h.capDelayByScpLpar),
    roleCappedTicks: { ...h.roleCappedTicks },
    ziipBusyById: { ...h.ziipBusyById },
    ziipLparBusyById: { ...h.ziipLparBusyById },
    dbatQueuedByLpar: { ...h.dbatQueuedByLpar },
    ...(run.sim.last.db2Contention || h.db2Contention ? { db2Contention: cloneRows(h.db2Contention, (row) => ({ ...row })) } : {}),
    ...(h.cicsStorage ? { cicsStorage: { ...h.cicsStorage } } : {}),
  };
}

// Policy activation replaces the definition. Reuse each period's rank while that definition is active.
const ranksByDefinition = new WeakMap<ServiceDefinition, Map<string, number>>();

/** Update an hour owned by this advance. Standalone calls take their own copy. */
export function accumulateHour(run: RunState, h = copyHourForAdvance(run)): RunState {
  const { workloads, cappedByLpar, cappedTicksByLpar, cpcBusyById, lparBusyById, cpByImportance,
    cpuWaitByWorkloadLpar, cpByScpLpar, cpByRoleLpar, cpByWorkloadLpar, capDelayByScpLpar,
    roleCappedTicks, ziipBusyById, ziipLparBusyById, dbatQueuedByLpar } = h;
  for (const w of run.sim.last.workloads) {
    if (w.cpuWaitByLpar) accumulateCpuWaits(cpuWaitByWorkloadLpar[w.id] ??= {}, w.cpuWaitByLpar);
    const a = (workloads[w.id] ??= { completions: 0, withinSla: 0, failed: 0, rtSumSec: 0, parts: {} });
    const { parts } = a;
    for (const k in w.parts) parts[k] = (parts[k] ?? 0) + w.parts[k]!;
    a.completions += w.completions;
    a.withinSla += w.withinSla;
    a.failed += w.failed;
    a.rtSumSec += w.rtSumSec;
    if ((w.rolledBack ?? 0) > 0) a.rolledBack = (a.rolledBack ?? 0) + w.rolledBack!;
  }
  // Cumulative count of DBAT requests that waited for a slot during the hour, per LPAR running a Db2 member
  // (QUEDBAT/QDSTQDBT, Db2 13 Command Reference p.303: work items that had to wait for a DBAT).
  for (const lt of run.sim.last.lpars) {
    const waited = lt.dbatWaited;
    if (waited !== undefined && waited > 1e-9) dbatQueuedByLpar[lt.lparId] = (dbatQueuedByLpar[lt.lparId] ?? 0) + waited;
  }
  let capped = 0;
  let delivered = 0;
  const deliveredByCpc: Record<string, number> = {};
  const ziipDeliveredByCpc: Record<string, number> = {};
  for (const l of run.sim.lpars) {
    const cpcId = run.sim.config.lpars.find((x) => x.id === l.id)?.cpcId;
    const ziip = l.pools.find((p) => p.pool === 'ZIIP');
    if (ziip) {
      if (ziip.availableEngines > 0) ziipLparBusyById[l.id] = (ziipLparBusyById[l.id] ?? 0) + Math.min(1, ziip.deliveredEngines / ziip.availableEngines);
      if (cpcId) ziipDeliveredByCpc[cpcId] = (ziipDeliveredByCpc[cpcId] ?? 0) + ziip.deliveredEngines;
    }
    const cp = l.pools.find((p) => p.pool === 'CP');
    if (!cp) continue;
    capped = Math.max(capped, cp.cappedFrac);
    cappedByLpar[l.id] = Math.max(cappedByLpar[l.id] ?? 0, cp.cappedFrac);
    if (cp.cappedFrac > 0) cappedTicksByLpar[l.id] = (cappedTicksByLpar[l.id] ?? 0) + 1;
    delivered += cp.deliveredEngines;
    if (cp.availableEngines > 0) lparBusyById[l.id] = (lparBusyById[l.id] ?? 0) + Math.min(1, cp.deliveredEngines / cp.availableEngines);
    if (cpcId) deliveredByCpc[cpcId] = (deliveredByCpc[cpcId] ?? 0) + cp.deliveredEngines;
  }
  const engines = run.sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  for (const c of run.sim.config.cpcs) {
    if (c.engines.CP > 0) cpcBusyById[c.id] = (cpcBusyById[c.id] ?? 0) + (deliveredByCpc[c.id] ?? 0) / c.engines.CP;
    if (c.engines.ZIIP > 0) ziipBusyById[c.id] = (ziipBusyById[c.id] ?? 0) + (ziipDeliveredByCpc[c.id] ?? 0) / c.engines.ZIIP;
  }
  const def = run.sim.wlm.definition;
  let ranks = ranksByDefinition.get(def);
  if (!ranks) ranksByDefinition.set(def, (ranks = new Map()));
  for (const lt of run.sim.last.lpars) {
    const acc = (cpByImportance[lt.lparId] ??= [0, 0, 0, 0, 0, 0, 0]);
    if (lt.cpByRole) accumulateCpuGrants(cpByRoleLpar[lt.lparId] ??= {}, lt.cpByRole);
    if (lt.cpByWorkload) accumulateCpuGrants(cpByWorkloadLpar[lt.lparId] ??= {}, lt.cpByWorkload);
    const cp = (cpByScpLpar[lt.lparId] ??= {});
    const cap = (capDelayByScpLpar[lt.lparId] ??= {});
    for (const x of lt.scps) {
      let rank = ranks.get(x.scKey);
      if (rank === undefined) ranks.set(x.scKey, (rank = importanceRank(def, x.scKey)));
      acc[rank]! += x.cpEngines;
      accumulateCpuGrant(cp[x.scKey] ??= { cp: 0, ziip: 0, iipcp: 0 }, x.cpEngines, x.ziipEngines, x.iipcpEngines);
      const b = (cap[x.scKey] ??= { cap: 0, samples: 0 });
      // Same using + delay denominator as WLMGL (rmf.wlmRecord), including OTHER and queued samples.
      // CAP is separate from CPU delay: SC34-2665-60 PDF p.540 (printed 500).
      const samples = x.usingCpu + x.usingZiip + x.usingIo + x.delayCpu + x.delayZiip + x.delayIo + x.delayStorage + x.delayCap + (x.delayQueue ?? 0) + x.delayOther;
      b.cap += x.delayCap;
      b.samples += samples;
      // Server samples already belong to the region class above. Also retain their internal holder's row,
      // not a second addition to the class's CAP (srvDelayCap is a subset of delayCap).
      if (x.srvUsing !== undefined) {
        const srv = (cap[SERVER_KEY] ??= { cap: 0, samples: 0 });
        srv.cap += x.srvDelayCap ?? 0;
        srv.samples = srv.samples + x.srvUsing + (x.srvDelay ?? 0);
      }
    }
    for (const role in lt.roleHealth) if (lt.roleHealth[role]!.capped) {
      const key = `${lt.lparId}:${role}`;
      roleCappedTicks[key] = (roleCappedTicks[key] ?? 0) + 1;
    }
  }
  for (const lt of run.sim.last.lpars) {
    for (const x of lt.cicsStorage ?? []) {
      const cicsStorage = (h.cicsStorage ??= {});
      const a = cicsStorage[x.region];
      const abends = (a?.abends ?? 0) + (lt.cicsAbends?.[x.region] ?? 0);
      cicsStorage[x.region] = { peakMb: Math.max(a?.peakMb ?? 0, x.inUseMb), limitMb: x.limitMb, sosSec: (a?.sosSec ?? 0) + (x.sos ? TICK_SEC : 0), ...(abends > 0 ? { abends } : {}) };
    }
  }
  const db2 = run.sim.last.db2Contention;
  if (db2) for (const member in db2) {
    const members = (h.db2Contention ??= {});
    addDb2Counters(members[member] ??= emptyDb2Counters(), db2[member]!);
  }
  h.ticks += 1;
  h.maxCappedFrac = Math.max(h.maxCappedFrac, capped);
  h.cpcBusySum += engines > 0 ? delivered / engines : 0;
  h.lockIndexSum += run.sim.env.lockIndex;
  return { ...run, hour: h };
}

/** Fold this hour's averages into today's capacity peaks. */
function hourPeaks(r: RunState, h: HourAcc): CapacityDay {
  const t = r.capacityToday ?? { day: r.day, peakCpcBusyPct: 0, peakR4ha: {}, peakR4haSum: 0, definedCapacity: {}, criticalEndSec: null };
  const peakR4ha = { ...t.peakR4ha };
  let sum = 0;
  for (const l of r.sim.capping.lpars) {
    peakR4ha[l.id] = Math.max(peakR4ha[l.id] ?? 0, l.r4ha);
    sum += l.r4ha;
  }
  const definedCapacity = Object.fromEntries(r.sim.config.lpars.filter((l) => l.kind === 'ZOS').map((l) => [l.id, l.definedCapacityMsu]));
  // Online peak only: overnight batch fills whatever CPU is free, so night busy says nothing about headroom.
  const startHour = Math.floor(clockAt(r.sim.tick - TICKS_PER_HOUR).hourOfDay);
  const online = startHour >= PLANNER.onlineHours[0] && startHour < PLANNER.onlineHours[1];
  const busy = online && h.ticks > 0 ? (100 * h.cpcBusySum) / h.ticks : 0;
  // MSU demand: each CPC's hour-average busy share of its own installed CP capacity, so a capacity change moves
  // demand and limit together instead of changing the percentage alone, and a multi-CPC box does not average two
  // different MSU ratings together. Real RMF reads MSU consumption against CPC capacity in MSU/h the same way (RMF
  // Report Analysis 3.1: CPC Capacity report p.96-97, CPC CAPACITY on the CPU Activity report p.391).
  const installedMsu = r.sim.config.cpcs.reduce((a, c) => a + msuPerCp(c) * c.engines.CP, 0);
  let demandMsu = 0;
  for (const c of r.sim.config.cpcs) demandMsu += (h.ticks > 0 ? (h.cpcBusyById[c.id] ?? 0) / h.ticks : 0) * c.engines.CP * msuPerCp(c);
  if (!online) demandMsu = 0;
  return {
    ...t,
    peakCpcBusyPct: Math.max(t.peakCpcBusyPct, busy),
    peakDemandMsu: Math.max(t.peakDemandMsu ?? 0, demandMsu),
    installedMsu,
    peakR4ha,
    peakR4haSum: Math.max(t.peakR4haSum, sum),
    definedCapacity,
  };
}

/** Hours of per-workload SMF detail kept in the run (two played days). */
const SMF_HOURS_KEPT = 48;

export function closeHour(run: RunState, scenario: Scenario, content: GameContent): RunState {
  const h = run.hour;
  if (!h) return run;
  let r = run;
  const trust = { ...r.trust };
  let incidents = [...r.incidents];
  const baselines = { ...r.baselines };
  const hourBaselines = { ...(r.hourBaselines ?? {}) };
  const hourStart = r.sim.tick - TICKS_PER_HOUR;
  const hourEnd = r.sim.tick;
  const workloads = allWorkloads(scenario, r);
  // The hour's clock-hour baseline, or the rolling EWMA until that slot has a met, undisturbed hour (RT-17).
  const hourSlot = clockHourOf(hourStart);
  const baseOf = (workloadId: string) => slotBaseline(hourBaselines, baselines, workloadId, hourSlot);
  // "vs base" is frozen now, against the baseline that was in force during this hour: later clean hours move the
  // EWMA, and a past row's ratio must not move with it (PT-13). SMF 110 performance data is completed at task end
  // (CICS TS 6 Monitoring CICS p.19) and SMF 101 accounting written at thread end (Db2 13 Managing Performance p.144).
  const cpuVsBase: Record<string, number> = {};
  for (const w of workloads) {
    const wh = h.workloads[w.id];
    const base = baseOf(w.id).cpu ?? 0;
    if (!wh || wh.completions <= 0 || base <= 0) continue;
    cpuVsBase[w.id] = (perTxnParts(wh).cpu ?? 0) / base;
  }
  // A card whose footprint reaches the work (direct or collateral, RT-14) disturbs its response-time parts while it
  // runs, so that hour teaches nothing about the healthy baseline; otherwise the EWMA absorbs a regression as the new
  // normal within a few hours (PT-13). A permanent card stops disturbing work it is background for: its cost is then
  // the new normal (docs/rca-design.md §4.4(2)).
  const scopes = new Map<string, WorkScope>();
  const scopeOf = (workloadId: string): WorkScope => {
    let sc = scopes.get(workloadId);
    if (!sc) {
      sc = workScopeOf(incidentSubjects(r, scenario, workloadId, r.day));
      scopes.set(workloadId, sc);
    }
    return sc;
  };
  const window = { startTick: hourStart, endTick: hourEnd };
  const disturbed = (workloadId: string) =>
    r.events.some((e) => activeIn(e, window) && !(e.endTick === null && e.metWith?.includes(workloadId)) && footprintRelation(e, workloadId, scopeOf(workloadId)) !== null);
  // RT-22: a met hour that still shows a problem. A card's footprint counts even when the response met the goal (a
  // quiet regression), a delay group past the floor counts, and a CF/LCU far slower than its peers counts when it
  // carries a third of the response time (RT-35). A clean met hour is no problem and is not stored.
  const peersFor = (w: WorkloadDef): PeerRows | undefined => {
    const rmf = [...r.sim.rmf.intervals].reverse().find((iv) => iv.endTick <= hourEnd && iv.endTick > hourStart);
    return rmf ? peersOf(rmf, hostImages(r.sim.routing[w.id] ?? w.routing)) : undefined;
  };
  const quietReason = (w: WorkloadDef, wh: WorkloadHour, parts: Record<string, number>, base: Record<string, number>): QuietHour['reason'] | null => {
    if (disturbed(w.id)) return 'CARD';
    const slaRtSec = 'rtSec' in w.sla ? w.sla.rtSec : 0;
    // A delay group needs a healthy baseline to be abnormal. A workload's first day has none, and reading every
    // response component as "excess" would make every met hour a problem.
    const hasBaseline = Object.values(base).some((x) => x > 0);
    if (hasBaseline && slaRtSec > 0) {
      const total = groupExcess(parts, base).reduce((a, [, x]) => a + Math.max(0, x), 0);
      if (total >= DELAY_FLOOR_FRAC * slaRtSec) return 'DELAY';
    }
    const rt = wh.completions > 0 ? wh.rtSumSec / wh.completions : 0;
    if (rt <= 0) return null;
    const peers = peersFor(w);
    if (!peers) return null;
    if (parts.cf !== undefined && parts.cf >= CO_DOMINANT_SHARE * rt && slowCf(peers.cf, peers.connectedCf)) return 'PEER';
    if (parts.io !== undefined && parts.io >= CO_DOMINANT_SHARE * rt && slowLcu(peers.lcus)) return 'PEER';
    return null;
  };
  const metHour: string[] = [];
  const quietHours: QuietHour[] = [];
  for (const w of workloads) {
    const wh = h.workloads[w.id];
    if (!wh) continue;
    const att = hourAttainment(w, wh);
    if (!att) {
      // A workload with no SLA (TSO, ad-hoc BI) has no attainment to miss, but a card touching it is still a problem a
      // record can name. With no card there is no goal to judge, so nothing is stored.
      if (disturbed(w.id) && wh.completions + wh.failed > 0) {
        const judge = judgeWorkloadHour(r, scenario, content, w, wh, h, workloads, baseOf(w.id), hourEnd, false);
        quietHours.push({
          day: r.day,
          hourOfDay: hourSlot,
          startTick: hourStart,
          endTick: hourEnd,
          workloadId: w.id,
          reason: 'CARD',
          truth: judge.truth,
          ...(judge.basis ? { basis: judge.basis } : {}),
          subjects: judge.subjects,
        });
      }
      continue;
    }
    const parts = perTxnParts(wh);
    // Incidents are per played day (the day's SLA report and RCA count them): one still open at
    // 06:00 is closed there, and a breach that carries on opens a new incident for the new day.
    incidents = incidents.map((i) => (i.workloadId === w.id && i.endTick === null && i.day !== r.day ? { ...i, endTick: hourStart } : i));
    const openIdx = incidents.findIndex((i) => i.workloadId === w.id && i.endTick === null);
    if (att.met) {
      metHour.push(w.id);
      // The baseline in force during the hour, before this hour is folded into the slot (RT-22): a met hour's
      // delay group must be judged against what "normal" was when it ran, not after it has become part of normal.
      const hourBase = baseOf(w.id);
      if (!disturbed(w.id)) {
        // The rolling EWMA stays the fallback; the clock-hour slot is what judges this hour of the day (RT-17).
        baselines[w.id] = updateBaseline(baselines[w.id], parts);
        hourBaselines[w.id] = {
          ...(hourBaselines[w.id] ?? {}),
          [String(hourSlot)]: updateBaseline(hourBaselines[w.id]?.[String(hourSlot)], parts, SLOT_BASELINE_DECAY),
        };
      }
      if (openIdx >= 0) incidents[openIdx] = { ...incidents[openIdx]!, endTick: r.sim.tick };
      if (openIdx < 0) {
        const reason = quietReason(w, wh, parts, hourBase);
        if (reason) {
          const judge = judgeWorkloadHour(r, scenario, content, w, wh, h, workloads, hourBase, hourEnd, false);
          quietHours.push({
            day: r.day,
            hourOfDay: hourSlot,
            startTick: hourStart,
            endTick: hourEnd,
            workloadId: w.id,
            reason,
            truth: judge.truth,
            ...(judge.basis ? { basis: judge.basis } : {}),
            subjects: judge.subjects,
          });
        }
      }
      continue;
    }
    const facet = facetOf(w);
    const loss = facet ? att.severity * 0.9 * ((r.facetWeights ?? FACET_WEIGHT)[facet] ?? 1) : 0;
    if (facet && facet in trust) trust[facet] = clampTrust(trust[facet]! - loss);
    if (openIdx >= 0) {
      const inc = incidents[openIdx]!;
      incidents[openIdx] = { ...inc, hours: inc.hours + 1, worstAttainmentPct: Math.min(inc.worstAttainmentPct, att.attainmentPct), trustLost: inc.trustLost + loss };
    } else {
      // The hour's truth comes from the shared judge, so a quiet-hour fact (RT-22) and an incident cannot disagree
      // about the same hour. An incident keeps the observed CPU grants; a quiet met hour reads the cheaper split.
      const judge = judgeWorkloadHour(r, scenario, content, w, wh, h, workloads, baseOf(w.id), hourEnd, true);
      const { truth, basis, subjects } = judge;
      let aiops: Hypothesis[] | undefined;
      if (toolOn(r, 'AIOPS')) {
        aiops = aiopsHypotheses(truth, rankedMechanismGroups(parts, baseOf(w.id)), streamRng(r.seed, 'aiops', r.sim.tick, w.id));
      }
      const inc: Incident = {
        id: r.nextId,
        workloadId: w.id,
        day: r.day,
        startTick: r.sim.tick - TICKS_PER_HOUR,
        endTick: null,
        hours: 1,
        worstAttainmentPct: att.attainmentPct,
        truth,
        ...(basis ? { basis } : {}),
        ...(aiops ? { aiops } : {}),
        subjects,
        rca: null,
        trustLost: loss,
      };
      // One RCA per root cause (RT-15, docs/rca-design.md §4.5): a card's victims group across the played day, a
      // fallback cause's while they overlap or follow within two hours, and a filed RCA is inherited only from the
      // same card.
      incidents = addGroupedIncident(incidents, inc);
      r = { ...r, nextId: r.nextId + 1 };
      r = logLine(r, `INCIDENT ${w.id}: SLA missed (${att.attainmentPct.toFixed(1)}%)`);
    }
  }
  // Cards already running when the hour opened become background for the work they reached that met its goal.
  if (metHour.length > 0) r = { ...r, events: markMet(r.events, metHour, hourStart, scopeOf) };
  r = { ...r, capacityToday: hourPeaks(r, h) };
  const hourOfDay = Math.floor(clockAt(r.sim.tick - TICKS_PER_HOUR).hourOfDay);
  if (hourOfDay >= 18 || hourOfDay < 6) r = { ...r, nightHour: addHour(r.nightHour, h) };
  const db2Rollbacks = db2RollbacksByLpar(r, scenario, h.workloads);
  const smfHours = [...(r.smfHours ?? []), {
    day: r.day,
    hourOfDay: Math.floor(clockAt(r.sim.tick - TICKS_PER_HOUR).hourOfDay),
    workloads: h.workloads,
    ...(Object.keys(cpuVsBase).length > 0 ? { cpuVsBase } : {}),
    ...(h.cicsStorage ? { cicsStorage: h.cicsStorage } : {}),
    ...(h.db2Contention && Object.keys(h.db2Contention).length > 0 ? { db2Contention: h.db2Contention } : {}),
    ...(Object.keys(h.dbatQueuedByLpar ?? {}).length > 0 ? { dbatQueuedByLpar: h.dbatQueuedByLpar } : {}),
    ...(Object.keys(db2Rollbacks).length > 0 ? { db2RollbacksByLpar: db2Rollbacks } : {}),
  }].slice(-SMF_HOURS_KEPT);
  const nextQuiet = [...(r.quietHours ?? []), ...quietHours].filter((q) => q.day * 24 + ((q.hourOfDay - 6 + 24) % 24) > (r.day * 24 + ((hourOfDay - 6 + 24) % 24)) - SMF_HOURS_KEPT);
  // Keep the field out of runs that have no quiet hours, so an old save and the passive golden run are unchanged;
  // it appears with the first notable met hour and leaves when the facts roll off.
  const { quietHours: _previousQuiet, ...withoutQuiet } = r;
  r = {
    ...withoutQuiet,
    trust,
    incidents,
    baselines,
    hourBaselines,
    smfHours,
    ...(nextQuiet.length > 0 ? { quietHours: nextQuiet } : {}),
    hour: newHour(r.sim.tick),
  };
  // A slow internal workload (PT-50): one inbox complaint per episode. The surcharge itself is derived from the
  // hours just recorded; this marker only stops a repeat complaint, and a met hour clears it so a later episode
  // complains again. It is not proof that the episode still runs.
  const slow = slowInternalOf(r, content.internalGoal);
  if (slow) {
    if (r.tsoEpisode === undefined) {
      const secs = (x: number) => `${x.toFixed(2)} s`;
      const owner = content.appOwners?.[slow.workloadId] ?? `${slow.workloadId} users`;
      r = { ...r, tsoEpisode: slow.key };
      r = msg(
        r,
        owner,
        `${slow.workloadId} response is slow`,
        `${slow.workloadId} has averaged ${secs(slow.rtSec)} over the last hour, against the team's ${secs(slow.goalSec)} goal, for ${slow.missedHours} hours running. ` +
          `While it lasts, hands-on changes, fixes and hardware orders cost ${slow.hoursMult}× the engineer-hours. ` +
          `The WLMGL ${slow.workloadId} row shows the response time and the goal.`,
      );
      r = logLine(r, `${slow.workloadId} slow: ${secs(slow.rtSec)} average against a ${secs(slow.goalSec)} goal for ${slow.missedHours} h (engineer-hours ×${slow.hoursMult})`);
    }
    if (!r.tsoSlowSeen) r = { ...r, tsoSlowSeen: true };
  } else if (r.tsoEpisode !== undefined) {
    const { tsoEpisode: _ended, ...rest } = r;
    r = rest;
  }
  return r;
}
