import { PLANNER } from '../../content/planner';
import { clockAt } from '../../sim/core/clock';
import { streamRng } from '../../sim/core/rng';
import type { Scenario } from '../../sim/core/scenario';
import { TICK_SEC, TICKS_PER_HOUR } from '../../sim/core/units';
import { classify } from '../../sim/wlm/classify';
import { aiopsHypotheses, type Hypothesis } from '../aiops';
import { addHour, capacityBasis, failureMechanismOf, hourAttainment, importanceRank, mechanismOf, perTxnParts, rankedMechanismGroups, triggerOf, updateBaseline } from '../sla';
import {
  type CapacityDay,
  type HourAcc,
  type RunState
} from '../types';
import { allWorkloads, isNewWorkload } from '../workloads';
import type { GameContent } from './shared';
import { toolOn } from './shared';
import { clampTrust, FACET_WEIGHT, facetOf, logLine } from './shared';

export const newHour = (tick: number): HourAcc => ({
  hourIndex: Math.floor(tick / TICKS_PER_HOUR),
  ticks: 0,
  workloads: {},
  maxCappedFrac: 0,
  cappedByLpar: {},
  cpcBusySum: 0,
  cpcBusyById: {},
  lparBusyById: {},
  cpByImportance: {},
  lockIndexSum: 0,
});

export function accumulateHour(run: RunState): RunState {
  const h = run.hour ?? newHour(run.sim.tick - 1);
  const workloads = { ...h.workloads };
  for (const w of run.sim.last.workloads) {
    const a = workloads[w.id] ?? { completions: 0, withinSla: 0, failed: 0, rtSumSec: 0, parts: {} };
    const parts = { ...a.parts };
    for (const [k, v] of Object.entries(w.parts)) parts[k] = (parts[k] ?? 0) + v;
    workloads[w.id] = {
      completions: a.completions + w.completions,
      withinSla: a.withinSla + w.withinSla,
      failed: a.failed + w.failed,
      rtSumSec: a.rtSumSec + w.rtSumSec,
      parts,
    };
  }
  let capped = 0;
  let delivered = 0;
  const cappedByLpar = { ...h.cappedByLpar };
  const deliveredByCpc: Record<string, number> = {};
  const lparBusyById = { ...(h.lparBusyById ?? {}) };
  for (const l of run.sim.lpars) {
    const cp = l.pools.find((p) => p.pool === 'CP');
    if (!cp) continue;
    capped = Math.max(capped, cp.cappedFrac);
    cappedByLpar[l.id] = Math.max(cappedByLpar[l.id] ?? 0, cp.cappedFrac);
    delivered += cp.deliveredEngines;
    if (cp.availableEngines > 0) lparBusyById[l.id] = (lparBusyById[l.id] ?? 0) + Math.min(1, cp.deliveredEngines / cp.availableEngines);
    const cpcId = run.sim.config.lpars.find((x) => x.id === l.id)?.cpcId;
    if (cpcId) deliveredByCpc[cpcId] = (deliveredByCpc[cpcId] ?? 0) + cp.deliveredEngines;
  }
  const engines = run.sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  const cpcBusyById = { ...(h.cpcBusyById ?? {}) };
  for (const c of run.sim.config.cpcs) {
    if (c.engines.CP > 0) cpcBusyById[c.id] = (cpcBusyById[c.id] ?? 0) + (deliveredByCpc[c.id] ?? 0) / c.engines.CP;
  }
  const cpByImportance = { ...(h.cpByImportance ?? {}) };
  const def = run.sim.wlm.definition;
  for (const lt of run.sim.last.lpars) {
    const acc = [...(cpByImportance[lt.lparId] ?? [0, 0, 0, 0, 0, 0, 0])];
    for (const x of lt.scps) acc[importanceRank(def, x.scKey)]! += x.cpEngines;
    cpByImportance[lt.lparId] = acc;
  }
  let cicsStorage = h.cicsStorage;
  for (const lt of run.sim.last.lpars) {
    for (const x of lt.cicsStorage ?? []) {
      cicsStorage = { ...cicsStorage };
      const a = cicsStorage[x.region];
      cicsStorage[x.region] = { peakMb: Math.max(a?.peakMb ?? 0, x.inUseMb), limitMb: x.limitMb, sosSec: (a?.sosSec ?? 0) + (x.sos ? TICK_SEC : 0) };
    }
  }
  return {
    ...run,
    hour: {
      ...h,
      ticks: h.ticks + 1,
      workloads,
      maxCappedFrac: Math.max(h.maxCappedFrac, capped),
      cappedByLpar,
      cpcBusySum: h.cpcBusySum + (engines > 0 ? delivered / engines : 0),
      cpcBusyById,
      lparBusyById,
      cpByImportance,
      lockIndexSum: h.lockIndexSum + run.sim.env.lockIndex,
      ...(cicsStorage ? { cicsStorage } : {}),
    },
  };
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
  return { ...t, peakCpcBusyPct: Math.max(t.peakCpcBusyPct, busy), peakR4ha, peakR4haSum: Math.max(t.peakR4haSum, sum), definedCapacity };
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
  const hourStart = r.sim.tick - TICKS_PER_HOUR;
  const hourEnd = r.sim.tick;
  const workloads = allWorkloads(scenario, r);
  // "vs base" is frozen now, against the baseline that was in force during this hour: later clean hours move the
  // EWMA, and a past row's ratio must not move with it (PT-13). SMF 110 performance data is completed at task end
  // (CICS TS 6 Monitoring CICS p.19) and SMF 101 accounting written at thread end (Db2 13 Managing Performance p.144).
  const cpuVsBase: Record<string, number> = {};
  for (const w of workloads) {
    const wh = h.workloads[w.id];
    const base = baselines[w.id]?.cpu ?? 0;
    if (!wh || wh.completions <= 0 || base <= 0) continue;
    cpuVsBase[w.id] = (perTxnParts(wh).cpu ?? 0) / base;
  }
  // A card running in the hour disturbs its workloads' response-time parts, so that hour teaches nothing about
  // the healthy baseline; otherwise the EWMA absorbs a regression as the new normal within a few hours (PT-13).
  const disturbed = (workloadId: string) =>
    r.events.some((e) => e.started && e.startTick < hourEnd && (e.endTick === null || e.endTick > hourStart) && e.affects.includes(workloadId));
  for (const w of workloads) {
    const wh = h.workloads[w.id];
    if (!wh) continue;
    const att = hourAttainment(w, wh);
    if (!att) continue;
    const parts = perTxnParts(wh);
    // Incidents are per played day (the day's SLA report and RCA count them): one still open at
    // 06:00 is closed there, and a breach that carries on opens a new incident for the new day.
    incidents = incidents.map((i) => (i.workloadId === w.id && i.endTick === null && i.day !== r.day ? { ...i, endTick: hourStart } : i));
    const openIdx = incidents.findIndex((i) => i.workloadId === w.id && i.endTick === null);
    if (att.met) {
      if (!disturbed(w.id)) baselines[w.id] = updateBaseline(baselines[w.id], parts);
      if (openIdx >= 0) incidents[openIdx] = { ...incidents[openIdx]!, endTick: r.sim.tick };
      continue;
    }
    const facet = facetOf(w);
    const loss = facet ? att.severity * 0.9 * ((r.facetWeights ?? FACET_WEIGHT)[facet] ?? 1) : 0;
    if (facet && facet in trust) trust[facet] = clampTrust(trust[facet]! - loss);
    if (openIdx >= 0) {
      const inc = incidents[openIdx]!;
      incidents[openIdx] = { ...inc, hours: inc.hours + 1, worstAttainmentPct: Math.min(inc.worstAttainmentPct, att.attainmentPct), trustLost: inc.trustLost + loss };
    } else {
      const hosts = Object.entries(r.sim.routing[w.id] ?? w.routing)
        .filter(([, f]) => f > 0)
        .map(([lparId]) => {
          const sc = classify(r.sim.wlm.definition, { ...w.work, SY: lparId }).serviceClass;
          return { lparId, cpcId: r.sim.config.lpars.find((l) => l.id === lparId)?.cpcId ?? '', importance: importanceRank(r.sim.wlm.definition, `${sc}#1`) };
        });
      const mechanism = failureMechanismOf(w, wh, r.events, h) ?? mechanismOf(parts, baselines[w.id] ?? {}, h, hosts);
      const basis = mechanism === 'CPU_CAPACITY' || mechanism === 'CPU_PRIORITY' ? capacityBasis(h, hosts) : null;
      const isNew = isNewWorkload(r, content, w.id, h.hourIndex);
      const truth = { mechanism, trigger: triggerOf(w.id, mechanism, r.events, h, isNew) };
      let aiops: Hypothesis[] | undefined;
      if (toolOn(r, 'AIOPS')) {
        aiops = aiopsHypotheses(truth, rankedMechanismGroups(parts, baselines[w.id] ?? {}), streamRng(r.seed, 'aiops', r.sim.tick, w.id));
      }
      const lead = incidents.find((i) => i.day === r.day && i.rcaGroup === undefined && i.truth.mechanism === truth.mechanism && i.truth.trigger === truth.trigger);
      incidents = [
        ...incidents,
        {
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
          rca: lead?.rca ?? null,
          trustLost: loss,
          ...(lead ? { rcaGroup: lead.id } : {}),
        },
      ];
      r = { ...r, nextId: r.nextId + 1 };
      r = logLine(r, `INCIDENT ${w.id}: SLA missed (${att.attainmentPct.toFixed(1)}%)`);
    }
  }
  r = { ...r, capacityToday: hourPeaks(r, h) };
  const hourOfDay = Math.floor(clockAt(r.sim.tick - TICKS_PER_HOUR).hourOfDay);
  if (hourOfDay >= 18 || hourOfDay < 6) r = { ...r, nightHour: addHour(r.nightHour, h) };
  const smfHours = [...(r.smfHours ?? []), {
    day: r.day,
    hourOfDay: Math.floor(clockAt(r.sim.tick - TICKS_PER_HOUR).hourOfDay),
    workloads: h.workloads,
    ...(Object.keys(cpuVsBase).length > 0 ? { cpuVsBase } : {}),
    ...(h.cicsStorage ? { cicsStorage: h.cicsStorage } : {}),
  }].slice(-SMF_HOURS_KEPT);
  return { ...r, trust, incidents, baselines, smfHours, hour: newHour(r.sim.tick) };
}
