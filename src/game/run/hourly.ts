import { PLANNER } from '../../content/planner';
import { clockAt } from '../../sim/core/clock';
import { msuPerCp } from '../../sim/hw/cpc';
import { streamRng } from '../../sim/core/rng';
import type { Scenario } from '../../sim/core/scenario';
import { TICK_SEC, TICKS_PER_HOUR } from '../../sim/core/units';
import { classify } from '../../sim/wlm/classify';
import { aiopsHypotheses, type Hypothesis } from '../aiops';
import { activeIn, addHour, capacityBasis, failureMechanismOf, footprintRelation, hourAttainment, markMet, importanceRank, mechanismOf, perTxnParts, rankedMechanismGroups, triggerOf, updateBaseline, workScopeOf, type WorkScope } from '../sla';
import { hostImages } from '../footprint';
import {
  type CapacityDay,
  type HourAcc,
  type Incident,
  type IncidentTruth,
  type RunState
} from '../types';
import { acceptedAnswers, truthCause, type TruthContext } from '../rcaTruth';
import { allWorkloads, isNewWorkload } from '../workloads';
import { incidentSubjects } from '../evidence';
import type { GameContent } from './shared';
import { addGroupedIncident } from './grouping';
import { toolOn } from './shared';
import { clampTrust, FACET_WEIGHT, facetOf, logLine } from './shared';

export const newHour = (tick: number): HourAcc => ({
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
  lockIndexSum: 0,
  dbatQueuedByLpar: {},
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
  // Peak DBAT requests queued at MAXDBAT during the hour, per LPAR running a Db2 member.
  const dbatQueuedByLpar = { ...h.dbatQueuedByLpar };
  for (const [key, queued] of Object.entries(run.sim.env.slotQueue ?? {})) {
    if (key.endsWith(':DBAT')) {
      const lparId = key.slice(0, key.length - 5);
      dbatQueuedByLpar[lparId] = Math.max(dbatQueuedByLpar[lparId] ?? 0, queued);
    }
  }
  let capped = 0;
  let delivered = 0;
  const cappedByLpar = { ...h.cappedByLpar };
  const cappedTicksByLpar = { ...h.cappedTicksByLpar };
  const deliveredByCpc: Record<string, number> = {};
  const lparBusyById = { ...h.lparBusyById };
  for (const l of run.sim.lpars) {
    const cp = l.pools.find((p) => p.pool === 'CP');
    if (!cp) continue;
    capped = Math.max(capped, cp.cappedFrac);
    cappedByLpar[l.id] = Math.max(cappedByLpar[l.id] ?? 0, cp.cappedFrac);
    if (cp.cappedFrac > 0) cappedTicksByLpar[l.id] = (cappedTicksByLpar[l.id] ?? 0) + 1;
    delivered += cp.deliveredEngines;
    if (cp.availableEngines > 0) lparBusyById[l.id] = (lparBusyById[l.id] ?? 0) + Math.min(1, cp.deliveredEngines / cp.availableEngines);
    const cpcId = run.sim.config.lpars.find((x) => x.id === l.id)?.cpcId;
    if (cpcId) deliveredByCpc[cpcId] = (deliveredByCpc[cpcId] ?? 0) + cp.deliveredEngines;
  }
  const engines = run.sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  const cpcBusyById = { ...h.cpcBusyById };
  for (const c of run.sim.config.cpcs) {
    if (c.engines.CP > 0) cpcBusyById[c.id] = (cpcBusyById[c.id] ?? 0) + (deliveredByCpc[c.id] ?? 0) / c.engines.CP;
  }
  const cpByImportance = { ...h.cpByImportance };
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
      cappedTicksByLpar,
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
  const metHour: string[] = [];
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
      metHour.push(w.id);
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
      const hosts = hostImages(r.sim.routing[w.id] ?? w.routing)
        .map((lparId) => {
          const sc = classify(r.sim.wlm.definition, { ...w.work, SY: lparId }).serviceClass;
          return { lparId, cpcId: r.sim.config.lpars.find((l) => l.id === lparId)?.cpcId ?? '', importance: importanceRank(r.sim.wlm.definition, `${sc}#1`) };
        });
      const mechanism = failureMechanismOf(w, wh, r.events, h) ?? mechanismOf(parts, baselines[w.id] ?? {}, h, hosts);
      const basis = mechanism === 'CPU_CAPACITY' || mechanism === 'CPU_PRIORITY' ? capacityBasis(h, hosts) : null;
      const isNew = isNewWorkload(r, content, w.id, h.hourIndex);
      // What the evidence judge sees now, so a later policy or routing change cannot rewrite it (RT-04).
      const subjects = incidentSubjects(r, scenario, w.id, r.day);
      const trigger = triggerOf(w.id, mechanism, r.events, h, isNew, { hosts, servers: subjects.servers });
      const ctx: TruthContext = {
        workloadId: w.id, mechanism, trigger, hour: h, events: r.events, basis, hosts,
        servers: subjects.servers, lpars: r.sim.config.lpars, content, isNew,
      };
      const { accepted, notes } = acceptedAnswers(ctx);
      const truth: IncidentTruth = {
        mechanism, trigger, accepted,
        ...(Object.keys(notes).length > 0 ? { notes } : {}),
        cause: truthCause(ctx),
      };
      let aiops: Hypothesis[] | undefined;
      if (toolOn(r, 'AIOPS')) {
        aiops = aiopsHypotheses(truth, rankedMechanismGroups(parts, baselines[w.id] ?? {}), streamRng(r.seed, 'aiops', r.sim.tick, w.id));
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
  const smfHours = [...(r.smfHours ?? []), {
    day: r.day,
    hourOfDay: Math.floor(clockAt(r.sim.tick - TICKS_PER_HOUR).hourOfDay),
    workloads: h.workloads,
    ...(Object.keys(cpuVsBase).length > 0 ? { cpuVsBase } : {}),
    ...(h.cicsStorage ? { cicsStorage: h.cicsStorage } : {}),
    ...(Object.keys(h.dbatQueuedByLpar ?? {}).length > 0 ? { dbatQueuedByLpar: h.dbatQueuedByLpar } : {}),
  }].slice(-SMF_HOURS_KEPT);
  return { ...r, trust, incidents, baselines, smfHours, hour: newHour(r.sim.tick) };
}
