import type { DifficultyId } from '../content/difficulty';
import { difficultyOf } from './difficulty';
import { inquiriesView } from './inquiries';
import type { ResourceGroupDef, ServiceClassDef } from '../sim/wlm/types';
// View model: a compact, serialisable projection of RunState for the UI (posted from the
// worker every frame). Applies the fog of war: what the player is allowed to see.

import type { ToolFeature } from '../content/tools';
import { ruleText, type AlertEvent, type AlertRule } from './alerts';
import { autoRuleText } from './automation';
import { codexDiscovered } from './codex';
import type { EvidencePin } from './evidence';
import { projectsView } from './projects';
import { endReport, type EndReport } from './endReport';
import type { ScheduleEntry } from './policies';
import { capacityForecasts, type Forecast } from './planner';
import { smfHourRefs, type SmfHourRef } from './smf';
import { buildMon3, type Mon3View } from './mon3';
import { features, toolsView, type ToolView } from './tools';
import { formatClock, clockAt } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import { instanceClock } from '../sim/core/step';
import { TICKS_PER_DAY } from '../sim/core/units';
import { estimateMonth } from '../sim/cost/mlc';
import { accPi, goalInfo, sumAcc } from '../sim/wlm/runtime';
import { goalText } from '../sim/wlm/goals';
import type { PreviewContext } from './catalog';
import type { CicsRegionConfig, Db2MemberConfig, JobClassConfig, ZosSystemConfig } from '../sim/core/types';
import type { CfConfig, CfStructureConfig } from '../sim/cf/cf';
import type { LcuConfig } from '../sim/io/dasd';
import { allWorkloads, overallTrust, previewContext } from './run';
import { hourAttainment } from './sla';
import { FACETS, type DayReport, type DraftOption, type Facet, type Incident, type Message, type Phase, type PlannedChange, type RunState } from './types';

export interface LparView {
  id: string;
  kind: 'ZOS' | 'CF';
  cpBusyPct: number;
  ziipBusyPct: number | null;
  logicalCps: number;
  weight: number;
  polarity: string;
  msu: number;
  r4ha: number | null;
  definedCapacity: number | null;
  capped: boolean;
  memoryGb: number;
}

export interface PiCell {
  scKey: string;
  goal: string;
  importance: number | null;
  pi: number | null;
}

export interface SlaTicker {
  workloadId: string;
  name: string;
  facet: Facet | null;
  target: string;
  /** Attainment so far this hour (null if no SLA / no traffic). */
  hourPct: number | null;
  met: boolean | null;
  ratePerSec: number;
  avgRtMs: number | null;
}

export interface BatchView {
  running: number;
  queued: number;
  held: number;
  done: number;
  abended: { name: string; day: number; stream: string; critical: boolean }[];
  total: number;
  projectedCriticalEnd: string | null;
  deadline: string;
  atRisk: boolean;
}

export interface ReportRef {
  index: number;
  label: string;
  endTick: number;
  /** Report classes with data in this interval. */
  reportClasses: string[];
}

/** Current configuration the Change Desk forms start from. */
export interface ConfigView {
  lpars: {
    id: string;
    kind: 'ZOS' | 'CF';
    cpLogical: number;
    cpReserved: number;
    ziipLogical: number;
    ziipReserved: number;
    weight: number;
    memoryGb: number;
    definedCapacity: number | null;
  }[];
  cpcMemoryGb: number;
  unassignedMemoryGb: number;
  db2: Db2MemberConfig[];
  /** MQ queues of message-driven workloads (DISPLAY QLOCAL CURDEPTH/MAXDEPTH). */
  mq: { workloadId: string; queue: string; maxDepth: number; depthByLpar: Record<string, number> }[];
  cics: CicsRegionConfig[];
  jobClasses: JobClassConfig[];
  cfs: CfConfig[];
  cfStructures: CfStructureConfig[];
  systems: ZosSystemConfig[];
  routing: { workloadId: string; name: string; shares: Record<string, number> }[];
  rmfIntervalMin: number;
  dasd: { lcus: LcuConfig[]; spareAliases: number };
}

export interface ViewModel {
  phase: Phase;
  day: number;
  maxDays: number;
  difficulty: { id: DifficultyId; name: string; pauseAllowed: boolean };
  clock: string;
  hourOfDay: number;
  tickOfDay: number;
  /** Absolute sim tick (for comparing with tick-stamped state). */
  tick: number;
  ticksPerDay: number;
  trust: Record<Facet, number>;
  trustOverall: number;
  hoursLeft: number;
  fatigue: number;
  insight: number;
  capexRemaining: number;
  opexBudget: number;
  mlcEstimate: number;
  score: number;
  perks: string[];
  constraints: string[];
  lpars: LparView[];
  cpcBusyPct: number;
  /** Physical engines per pool on the (first) CPC, for HMC previews. */
  cpcEngines: { CP: number; ZIIP: number; ICF: number };
  piHeat: PiCell[];
  sla: SlaTicker[];
  batch: BatchView;
  incidents: Incident[];
  inbox: Message[];
  log: string[];
  wlmLog: string[];
  changes: PlannedChange[];
  reports: ReportRef[];
  lastReport: DayReport | null;
  draft: DraftOption[] | null;
  endReason: string | null;
  /** Only once the run has ended. */
  endReport: EndReport | null;
  policyName: string;
  previewCtx: PreviewContext;
  config: ConfigView;
  /** Data the player's active analytics tools unlock (fog of war). */
  features: ToolFeature[];
  /** RMF Monitor III live views (null without the tool). */
  mon3: Mon3View | null;
  tools: ToolView[];
  reportsOpenedToday: number;
  smfHours: SmfHourRef[];
  pins: EvidencePin[];
  projects: ReturnType<typeof projectsView>;
  /** Codex entry ids met in this run. */
  codex: string[];
  /** Automation rules and their action log (null without the tool). */
  automation: { rules: { id: number; text: string; doneToday: number }[]; log: { tick: number; text: string }[] } | null;
  /** Saved service policies (with one-line goal summaries) and the daily switch schedule. */
  policies: { saved: { name: string; summary: string }[]; schedule: ScheduleEntry[] };
  /** Alert rules, firing ids and recent pages (null without the tool). */
  alerts: { rules: (AlertRule & { text: string })[]; firing: number[]; log: AlertEvent[] } | null;
  /** Capacity planner forecasts (null without the tool). */
  planner: { forecasts: Forecast[]; daysRecorded: number } | null;
  /** Monitor III chart history sizes (fetch with GET_MON3_CHARTS); null without the tool. */
  mon3Charts: { samples: number; markers: number; firstTick: number | null } | null;
  serviceClasses: { id: string; periods: string[]; resourceGroup: string | null }[];
  resourceGroups: ResourceGroupDef[];
  /** Full service class definitions of the active policy (the editor's starting point). */
  classDefs: ServiceClassDef[];
  inquiries: ReturnType<typeof inquiriesView>;
  ioPriorityManagement: boolean;
  cicsRegionMode: 'TRANSACTION' | 'REGION';
}

export function buildView(run: RunState, scenario: Scenario): ViewModel {
  const sim = run.sim;
  const c = clockAt(sim.tick);
  const tickOfDay = sim.tick - run.day * TICKS_PER_DAY;
  const def = sim.wlm.definition;

  const lpars: LparView[] = sim.config.lpars.map((l) => {
    const rt = sim.lpars.find((x) => x.id === l.id);
    const cp = rt?.pools.find((p) => p.pool === (l.kind === 'CF' ? 'ICF' : 'CP'));
    const zi = rt?.pools.find((p) => p.pool === 'ZIIP');
    const cfgCp = l.pools.find((p) => p.pool === (l.kind === 'CF' ? 'ICF' : 'CP'));
    const cfgZi = l.pools.find((p) => p.pool === 'ZIIP');
    const r4 = sim.capping.lpars.find((x) => x.id === l.id);
    return {
      id: l.id,
      kind: l.kind,
      cpBusyPct: cp && cfgCp && cfgCp.logical > 0 ? (100 * cp.deliveredEngines) / cfgCp.logical : 0,
      ziipBusyPct: zi && cfgZi && cfgZi.logical > 0 ? (100 * zi.deliveredEngines) / cfgZi.logical : null,
      logicalCps: cfgCp?.logical ?? 0,
      weight: cfgCp?.weight ?? 0,
      polarity: cp && l.hiperDispatch ? `${cp.vh}VH ${cp.vm}VM ${cp.vl}VL` : cfgCp?.dedicated ? 'DED' : 'SHARED',
      msu: rt?.msuRate ?? 0,
      r4ha: r4?.r4ha ?? null,
      definedCapacity: l.definedCapacityMsu,
      capped: r4?.capped ?? false,
      memoryGb: l.memoryGb,
    };
  });
  const cpEngines = sim.config.cpcs.reduce((a, x) => a + x.engines.CP, 0);
  const delivered = sim.lpars.reduce((a, l) => a + (l.pools.find((p) => p.pool === 'CP')?.deliveredEngines ?? 0), 0);

  // PI heat map: sysplex PI per service-class period from WLM's smoothed accumulators.
  const keys = [...new Set(sim.wlm.systems.flatMap((s) => s.scps.map((p) => p.scKey)))].sort();
  const piHeat: PiCell[] = keys.flatMap((k) => {
    const g = goalInfo(def, k);
    if (!g) return [];
    const accs = sim.wlm.systems.flatMap((s) => s.scps.filter((p) => p.scKey === k).map((p) => p.acc));
    const per = def.classes.find((x) => x.id === g.serviceClass)?.periods[g.period];
    return [{ scKey: k, goal: per ? goalText(per) : 'DISCRETIONARY', importance: g.goal.kind === 'DISC' ? null : g.importance, pi: accPi(g.goal, sumAcc(accs)) }];
  });

  const sla: SlaTicker[] = allWorkloads(scenario, run).map((w) => {
    const h = run.hour?.workloads[w.id];
    const att = h ? hourAttainment(w, h) : null;
    const last = sim.last.workloads.find((x) => x.id === w.id);
    return {
      workloadId: w.id,
      name: w.name,
      facet: w.stakeholder === 'Internal' ? null : w.stakeholder,
      target: w.sla.kind === 'PCT' ? `${w.sla.pct}% < ${Math.round(w.sla.rtSec * 1000)}ms` : w.sla.kind === 'AVG' ? `avg < ${w.sla.rtSec}s` : 'best effort',
      hourPct: att?.attainmentPct ?? null,
      met: att?.met ?? null,
      ratePerSec: last?.arrivalRate ?? 0,
      avgRtMs: last && last.completions > 0 ? (1000 * last.rtSumSec) / last.completions : null,
    };
  });

  const jobs = sim.batch.jobs;
  const proj = sim.batch.projectedCriticalEndSec;
  const batch: BatchView = {
    running: jobs.filter((j) => j.status === 'RUNNING').length,
    queued: jobs.filter((j) => j.status === 'QUEUED').length,
    held: jobs.filter((j) => j.status === 'HELD').length,
    done: jobs.filter((j) => j.status === 'DONE').length,
    abended: jobs.filter((j) => j.status === 'ABENDED').map((j) => ({ name: j.def.name, day: j.day, stream: j.def.stream, critical: j.def.critical })),
    total: jobs.length,
    projectedCriticalEnd: proj !== null ? instanceClock(proj) : null,
    deadline: instanceClock(run.batchDeadlineSec),
    atRisk: proj !== null && proj > run.batchDeadlineSec - 1800,
  };

  // Fog of war: without Monitor III, RMF Postprocessor data only for intervals before today's 06:00.
  const feats = features(run);
  const visibleUntil = run.phase === 'LIVE' && !feats.has('MON3') ? run.day * TICKS_PER_DAY : sim.tick;
  const reports: ReportRef[] = sim.rmf.intervals
    .map((iv, index) => ({ index, endTick: iv.endTick, reportClasses: (iv.wlmRc ?? []).filter((r) => r.lparId === '*PLEX').map((r) => r.scKey).sort(), label: `D${clockAt(iv.startTick).day + 1} ${formatClock(iv.startTick).slice(-8, -3)}–${formatClock(iv.endTick).slice(-8, -3)}` }))
    .filter((r) => r.endTick <= visibleUntil);

  return {
    phase: run.phase,
    day: run.day,
    maxDays: run.maxDays,
    difficulty: (({ id, name, pauseAllowed }) => ({ id, name, pauseAllowed }))(difficultyOf(run.difficulty)),
    clock: formatClock(sim.tick),
    hourOfDay: c.hourOfDay,
    tickOfDay,
    tick: sim.tick,
    ticksPerDay: TICKS_PER_DAY,
    trust: run.trust,
    trustOverall: overallTrust(run),
    hoursLeft: run.hoursLeft,
    fatigue: run.fatigue,
    insight: run.insight,
    capexRemaining: run.capexRemaining,
    opexBudget: run.opexBudgetMonthly,
    mlcEstimate: estimateMonth(sim.cost, scenario.products),
    score: run.score,
    perks: run.perks,
    constraints: run.constraints,
    lpars,
    cpcBusyPct: cpEngines > 0 ? (100 * delivered) / cpEngines : 0,
    cpcEngines: { ...sim.config.cpcs[0]!.engines },
    piHeat,
    sla,
    batch,
    incidents: run.incidents.slice(-30),
    inbox: run.inbox.slice(-40),
    log: run.log.slice(-40),
    // The WLM activity log is live only with Monitor III; otherwise it is readable after the day.
    wlmLog: run.phase === 'LIVE' && !feats.has('WLM_ACTIVITY_LOG') ? [] : sim.wlm.log.slice(-60),
    changes: run.changes.slice(-30),
    reports,
    lastReport: run.reports[run.reports.length - 1] ?? null,
    draft: run.draft,
    endReason: run.endReason,
    endReport: run.phase === 'GAMEOVER' || run.phase === 'VICTORY' ? endReport(run, overallTrust(run)) : null,
    policyName: def.policyName,
    previewCtx: previewContext(run),
    features: [...feats].sort(),
    mon3: feats.has('MON3') ? buildMon3(run, scenario) : null,
    tools: toolsView(run),
    reportsOpenedToday: run.reportsOpenedToday.length,
    smfHours: smfHourRefs(run),
    pins: run.pins ?? [],
    projects: projectsView(run),
    codex: codexDiscovered(run),
    automation: feats.has('AUTOMATION')
      ? {
          rules: (run.automation?.rules ?? []).map((a) => ({
            id: a.id,
            text: autoRuleText(a, (id) => {
              const al = run.alerts?.rules.find((x) => x.id === id);
              return al ? ruleText(al) : `alert #${id} (deleted)`;
            }),
            doneToday: run.automation?.day === run.day ? (run.automation?.doneToday[a.id] ?? 0) : 0,
          })),
          log: (run.automation?.log ?? []).slice(-20),
        }
      : null,
    policies: {
      saved: (run.policies?.saved ?? []).map((p) => ({ name: p.policyName, summary: p.classes.map((c) => `${c.id} ${c.periods.map((x) => goalText(x)).join('/')}`).join(' · ') })),
      schedule: run.policies?.schedule ?? [],
    },
    alerts: feats.has('ALERTS')
      ? { rules: (run.alerts?.rules ?? []).map((r) => ({ ...r, text: ruleText(r) })), firing: run.alerts?.firing ?? [], log: (run.alerts?.log ?? []).slice(-20) }
      : null,
    planner: feats.has('CAPACITY_PLANNER') ? { forecasts: capacityForecasts(run), daysRecorded: (run.capacityDays ?? []).length } : null,
    mon3Charts:
      feats.has('MON3_CHARTS') && run.mon3Charts
        ? { samples: run.mon3Charts.samples.length, markers: run.mon3Charts.markers.length, firstTick: run.mon3Charts.samples[0]?.tick ?? null }
        : null,
    config: configView(run, scenario),
    serviceClasses: def.classes.map((x) => ({ id: x.id, periods: x.periods.map((p) => goalText(p)), resourceGroup: x.resourceGroup })),
    resourceGroups: def.resourceGroups,
    classDefs: def.classes,
    inquiries: inquiriesView(run, scenario),
    ioPriorityManagement: def.ioPriorityManagement !== false,
    cicsRegionMode: def.cicsRegionMode ?? 'TRANSACTION',
  };
}

export { FACETS };

function configView(run: RunState, scenario: Scenario): ConfigView {
  const c = run.sim.config;
  const cpc = c.cpcs[0]!;
  const assigned = c.lpars.filter((l) => l.cpcId === cpc.id).reduce((a, l) => a + l.memoryGb, 0);
  return {
    lpars: c.lpars.map((l) => {
      const cp = l.pools.find((p) => p.pool === (l.kind === 'CF' ? 'ICF' : 'CP'));
      const zi = l.pools.find((p) => p.pool === 'ZIIP');
      return {
        id: l.id,
        kind: l.kind,
        cpLogical: cp?.logical ?? 0,
        cpReserved: cp?.reserved ?? 0,
        ziipLogical: zi?.logical ?? 0,
        ziipReserved: zi?.reserved ?? 0,
        weight: cp?.weight ?? 0,
        memoryGb: l.memoryGb,
        definedCapacity: l.definedCapacityMsu,
      };
    }),
    cpcMemoryGb: cpc.memoryGb,
    unassignedMemoryGb: cpc.memoryGb - assigned,
    db2: c.db2,
    mq: allWorkloads(scenario, run)
      .filter((w) => w.mq)
      .map((w) => ({
        workloadId: w.id,
        queue: w.mq!.queue,
        maxDepth: run.sim.mqMaxDepth?.[w.id] ?? w.mq!.maxDepthMsgs,
        depthByLpar: run.sim.last.workloads.find((x) => x.id === w.id)?.queueDepth ?? {},
      })),
    cics: c.cics,
    jobClasses: c.jobClasses,
    cfs: c.cfs,
    cfStructures: c.cfStructures ?? [],
    systems: c.systems,
    routing: allWorkloads(scenario, run).map((w) => ({ workloadId: w.id, name: w.name, shares: run.sim.routing[w.id] ?? w.routing })),
    rmfIntervalMin: c.rmfIntervalMin,
    dasd: { lcus: c.dasd.lcus, spareAliases: c.dasd.spareAliases },
  };
}
