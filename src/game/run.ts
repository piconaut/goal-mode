// Run lifecycle (SPEC §2): BRIEFING → LIVE (06:00→06:00) → REVIEW (draft) → next day.
// Pure functions over plain data; the game RNG is separate from the sim's.

import { DRAFT_OPTIONS, DRAFT_TUNING } from '../content/draft';
import { grantProjectHours } from './projects';
import { AUDIT, type EventDef, type ScriptedBeat } from '../content/events/midwest-events';
import { applyCommand, applyCommands, type Command } from '../sim/core/commands';
import { clockAt } from '../sim/core/clock';
import { initState } from '../sim/core/init';
import { ALERTS } from '../content/alerts';
import { PLANNER } from '../content/planner';
import { aiopsHypotheses, type Hypothesis } from './aiops';
import { emptyAlerts, evaluateAlerts } from './alerts';
import { emptyAutomation, runAutomation } from './automation';
import { emptyPolicyBook, scheduledActivation } from './policies';
import { INSIGHT, MON3_CHARTS } from '../content/tools';
import { expireToolTrials, measurementCommands, trialTool } from './tools';
import { EVIDENCE } from '../content/evidence';
import { judgeEvidence } from './evidence';
import { accumulateMon3, emptyCharts, recordMon3 } from './mon3Charts';
import { Rng, streamRng } from '../sim/core/rng';
import type { Scenario } from '../sim/core/scenario';
import type { ClassificationRule, ServiceDefinition } from '../sim/wlm/types';
import type { DifficultyId } from '../content/difficulty';
import { difficultyOf, scaleEventCommands, scenarioFor, storyBeatsFor } from './difficulty';
import { hintLevelFor, morningHints, type StrainedClass } from './hints';
import { HINT_SENDER, STORY_BEAT_HINTS, STRAIN, WLM_DISAGREE_HINTS } from '../content/hints';
import { step } from '../sim/core/step';
import { classify } from '../sim/wlm/classify';
import { TICK_SEC, TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { estimateMonth } from '../sim/cost/mlc';
import type { RmfInterval } from '../sim/measure/rmf';
import { tfpAtDayEnd } from './tfp';
import { deliverInquiries } from './inquiries';
import { allWorkloads } from './workloads';
import type { NightSummary } from '../sim/subsys/batch';
import type { WorkloadDef } from '../sim/workload/types';
import { failRiskFor, FIXES, opexBudgetFor, hardwareItem, previewChange } from './catalog';
import { addHour, BATCH_INCIDENT, batchMissMechanism, batchMissTrigger, failureMechanismOf, hourAttainment, importanceRank, mechanismOf, rankedMechanismGroups, perTxnParts, scoreRca, triggerOf, updateBaseline } from './sla';
import {
  FACETS,
  facetsOf,
  type ActiveEvent,
  type DayReport,
  type Facet,
  type CapacityDay,
  type HourAcc,
  type Incident,
  type Mechanism,
  type PlannedChange,
  type RunState,
  type Trigger,
} from './types';
import { idText } from './ids';

export interface GameContent {
  events: EventDef[];
  story: ScriptedBeat[];
  opexBudgetMonthly: number;
  capexQuarter: number;
  maxDays: number;
  /** Stakeholder facets with their SLA-breach trust weights; absent = Midwest's (FACET_WEIGHT). */
  facets?: { id: Facet; weight: number }[];
  /** Facet that also loses trust on a missed batch deadline (default Retail). */
  batchMissFacet?: Facet;
  /** Planted flaws already fixed at the start on a difficulty (SPEC §11.2, §13.3). */
  startingFixes?: Partial<Record<DifficultyId, { flaw: string; label: string; commands: Command[] }[]>>;
  /** Analytics tools already installed on day 1 (SPEC §13.5); their measurement overhead applies from the start. */
  startTools?: string[];
}

const BASE_HOURS = 8;
const FATIGUE_PER_OVERTIME_HOUR = 6;
const FACET_WEIGHT: Record<string, number> = { Cards: 1.4, Retail: 1.2, Digital: 1, Payments: 1, Finance: 1, Regulator: 1 };

const facetOf = (w: WorkloadDef): Facet | null => (w.stakeholder === 'Internal' ? null : w.stakeholder);

export const overallTrust = (run: RunState) => {
  const fs = facetsOf(run);
  return fs.reduce((a, f) => a + run.trust[f]!, 0) / fs.length;
};

/** Applies f to every facet's trust and clamps. */
const mapTrust = (run: RunState, f: (t: number) => number): Record<Facet, number> =>
  Object.fromEntries(facetsOf(run).map((k) => [k, clampTrust(f(run.trust[k]!))]));

const clampTrust = (x: number) => Math.max(0, Math.min(100, x));


/** `day` dates the message for a later morning's briefing (default: today). */
function msg(run: RunState, from: string, subject: string, body: string, day = run.day): RunState {
  return { ...run, inbox: [...run.inbox, { day, from, subject, body }] };
}

function logLine(run: RunState, text: string): RunState {
  return { ...run, log: [...run.log, text].slice(-300) };
}

/** Seconds after the played day's 06:00 start for a wall-clock hour (24+ = next morning). */
const secAfterStart = (hour: number) => ((hour - 6 + 48) % 24) * 3600;

export { allWorkloads } from './workloads';

export function newRun(baseScenario: Scenario, content: GameContent, seed: number, difficulty: DifficultyId = 'NORMAL', daily?: string): RunState {
  const diff = difficultyOf(difficulty);
  const scenario = scenarioFor(baseScenario, difficulty);
  const trust = Object.fromEntries((content.facets?.map((f) => f.id) ?? FACETS).map((f) => [f, diff.startTrust])) as Record<Facet, number>;
  let run: RunState = {
    version: 1,
    scenarioId: scenario.id,
    difficulty,
    seed,
    ...(daily ? { daily } : {}),
    sim: applyCommands(initState(seed, scenario), (content.startingFixes?.[difficulty] ?? []).flatMap((f) => f.commands)),
    phase: 'BRIEFING',
    day: 0,
    maxDays: content.maxDays,
    trust,
    ...(content.facets ? { facetWeights: Object.fromEntries(content.facets.map((f) => [f.id, f.weight])) } : {}),
    ...(content.batchMissFacet ? { batchMissFacet: content.batchMissFacet } : {}),
    hoursLeft: BASE_HOURS,
    baseHours: BASE_HOURS,
    bonusHours: [],
    fatigue: 0,
    opexBudgetMonthly: content.opexBudgetMonthly * diff.opexBudgetMult,
    capexRemaining: content.capexQuarter * diff.capexMult,
    opexSpentThisMonth: 0,
    insight: INSIGHT.starting,
    tools: [...(content.startTools ?? [])],
    toolsOff: [],
    reportsOpenedToday: [],
    codexReports: [],
    smfHours: [],
    mon3Charts: null,
    pins: [],
    alerts: emptyAlerts(),
    automation: emptyAutomation(),
    policies: emptyPolicyBook(),
    projects: [],
    capacityDays: [],
    capacityToday: null,
    perks: [],
    constraints: [],
    batchDeadlineSec: 24 * 3600,
    changes: [],
    nextId: 1,
    events: [],
    pendingCommands: [],
    hour: null,
    baselines: {},
    incidents: [],
    reports: [],
    inbox: [],
    draft: null,
    score: 0,
    consecutiveBatchMisses: 0,
    billsSeen: 0,
    log: [],
    endReason: null,
  };
  if (content.startTools?.length) run = { ...run, sim: applyCommands(run.sim, measurementCommands(run, scenario)) };
  const fixed = content.startingFixes?.[difficulty] ?? [];
  if (fixed.length > 0) run = msg(run, 'Previous team', 'Handover notes', `Before leaving we sorted out a few things: ${fixed.map((f) => f.label).join('; ')}. The rest is yours.`);
  run = drawEvents(run, content, 0);
  return storyFor(run, content, 0);
}

/** Pick tomorrow's (or today's) events; forewarn when the card says so. */
export function drawEvents(run: RunState, content: GameContent, day: number): RunState {
  const picked = ((rng: Rng) => {
    const lambda = (0.35 + 0.05 * day) * difficultyOf(run.difficulty).eventRateMult;
    const n = Math.floor(lambda) + (rng.chance(lambda - Math.floor(lambda)) ? 1 : 0);
    const dayStartTick = day * TICKS_PER_DAY;
    const pool = content.events.filter(
      (e) =>
        day >= e.minDay &&
        !(e.oncePerRun && run.events.some((x) => x.defId === e.id)) &&
        // no card two days running: back-to-back repeats (e.g. two abends) read as noise, not a new problem
        !run.events.some((x) => x.defId === e.id && x.startTick >= dayStartTick - TICKS_PER_DAY) &&
        // an hours card must not stack on itself while still running
        !(e.hoursDelta && run.events.some((x) => x.defId === e.id && (x.endTick === null || x.endTick > dayStartTick))),
    );
    const out: { def: EventDef; hour: number }[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const def = rng.pickWeighted(pool, (e) => e.weight * (e.category === 'WORKLOAD' ? 1 : 1 + day / 20));
      if (!def) break;
      pool.splice(pool.indexOf(def), 1);
      out.push({ def, hour: rng.range(def.startHour[0], def.startHour[1]) });
    }
    return out;
  })(streamRng(run.seed, 'events', day));
  let r = run;
  for (const { def, hour } of picked) {
    const startTick = day * TICKS_PER_DAY + Math.round(secAfterStart(hour) / TICK_SEC);
    const endTick = def.durationHours === null ? null : startTick + Math.max(1, Math.round((def.durationHours * 3600) / TICK_SEC));
    const ev: ActiveEvent = {
      uid: `${def.id}@${day}`,
      defId: def.id,
      name: def.name,
      startTick,
      endTick,
      trigger: def.trigger,
      affects: def.affects,
      ...(def.mechanisms ? { mechanisms: def.mechanisms } : {}),
      ...(def.failureMechanism ? { failureMechanism: def.failureMechanism } : {}),
      ...(def.blocksHardware ? { blocksHardware: def.blocksHardware } : {}),
      endCommands: def.end,
      started: false,
      ended: false,
    };
    r = { ...r, events: [...r.events, ev] };
    if (def.hoursDelta) {
      // Same bookkeeping as the CONTRACTOR perk: endDay recomputes hoursLeft from baseHours + live entries each morning.
      const days = Math.max(1, Math.ceil((def.durationHours ?? 24) / 24));
      r = { ...r, bonusHours: [...r.bonusHours, { hours: def.hoursDelta, untilDay: day + days }], hoursLeft: Math.max(0, r.hoursLeft + def.hoursDelta) };
    }
    if (def.forewarning) r = msg(r, 'Inbox', `For day ${day + 1}`, def.forewarning, day);
  }
  return r;
}

function storyFor(run: RunState, content: GameContent, day: number): RunState {
  let r = run;
  for (const b of storyBeatsFor(content.story, run.difficulty, day)) {
    r = msg(r, b.from, b.title, b.body);
    if (b.constraint) {
      r = { ...r, constraints: [...r.constraints, b.constraint] };
      if (b.constraint === 'DEADLINE_0500') r = { ...r, batchDeadlineSec: 23 * 3600 };
    }
    if (b.commands) r = { ...r, pendingCommands: [...r.pendingCommands, ...b.commands] };
  }
  if (difficultyOf(run.difficulty).hints !== 'NONE') {
    for (const [id, h] of Object.entries(STORY_BEAT_HINTS)) {
      if (storyBeatsFor(content.story, run.difficulty, day + h.daysBefore).some((b) => b.id === id)) r = msg(r, h.from, h.subject, h.body);
    }
  }
  return r;
}

export interface ChangeRequest {
  label: string;
  commands?: Command[];
  hardwareId?: string;
  /** Target CPC of a per-CPC hardware item (default the first). */
  cpcId?: string;
  fixId?: string;
  /** Pre-approved automation: no engineer-hours, no emergency trust cost, a misfire chance instead. */
  automated?: { misfireFrac: number };
}

export interface ChangeOutcome {
  run: RunState;
  ok: boolean;
  message: string;
  /** The policy a cancelled activation would have installed, so the caller can keep it as pending edits. */
  restoredPolicy?: ServiceDefinition;
}

function failRisk(run: RunState): number {
  return failRiskFor(run.fatigue, run.perks);
}

/** Context for previewChange from the current run. */
/** Fixes the scenario's event cards call for: the Change Desk offers and accepts only these. */
export const fixIdsOf = (content: GameContent): string[] => [...new Set(content.events.flatMap((e) => (e.fix ? [e.fix] : [])))].sort();

export function previewContext(run: RunState, content?: GameContent) {
  return {
    phase: run.phase,
    perks: run.perks,
    fatigue: run.fatigue,
    hoursLeft: run.hoursLeft,
    capexRemaining: run.capexRemaining,
    incidentOpen: run.incidents.some((i) => i.endTick === null),
    constraints: run.constraints,
    blockedHardware: run.events.flatMap((e) => (e.started && !e.ended ? (e.blocksHardware ?? []) : [])),
    cpcs: run.sim.config.cpcs.map((c) => ({ id: c.id, capacitySetting: c.capacitySetting, generation: c.generation })),
    ...(content ? { fixIds: fixIdsOf(content) } : {}),
  };
}

/** Plan (BRIEFING) or make an emergency change (LIVE). */
export function requestChange(run: RunState, content: GameContent, req: ChangeRequest): ChangeOutcome {
  const live = run.phase === 'LIVE';
  const preview = previewChange(previewContext(run, content), req);
  if (!preview.ok) return { run, ok: false, message: preview.reason ?? 'Change not allowed' };
  const refused = !req.hardwareId && !req.fixId ? dryRunRefusal(run, req.commands ?? []) : null;
  if (refused) return { run, ok: false, message: refused };
  const hw = req.hardwareId ? hardwareItem(req.hardwareId) : undefined;
  const fix = req.fixId ? FIXES.find((f) => f.id === req.fixId) : undefined;
  const commands = hw ? hw.commands(run.sim, req.cpcId) : (req.commands ?? []);
  const hours = req.automated ? 0 : preview.hours;
  const { capex } = preview;

  let r = spendHours(run, hours);
  r = { ...r, capexRemaining: r.capexRemaining - capex };
  const change: PlannedChange = {
    id: r.nextId,
    label: req.label,
    commands,
    hours,
    capex,
    opexPerDay: hw?.opexPerDay ?? 0,
    activateDay: run.day + preview.leadDays,
    plannedDay: run.day,
    emergency: live,
    status: 'PLANNED',
    revertDay: hw?.durationDays ? run.day + preview.leadDays + hw.durationDays : null,
    revertCommands: hw?.durationDays ? hw.revert(run.sim, req.cpcId) : [],
    endsEvent: fix?.id ?? null,
  };
  r = { ...r, nextId: r.nextId + 1 };

  if (live) {
    // Emergency change board: costs trust, more when no incident justifies it.
    const trustCost = req.automated ? 0 : preview.trustCostEach;
    r = { ...r, trust: mapTrust(r, (t) => t - trustCost) };
    if (fix?.trustCost && fix.trustCost.facet in r.trust) r = { ...r, trust: { ...r.trust, [fix.trustCost.facet]: clampTrust(r.trust[fix.trustCost.facet]! - fix.trustCost.amount) } };
    const risk = req.automated ? req.automated.misfireFrac : failRisk(r);
    const attempt = r.changes.filter((x) => x.plannedDay === r.day && x.label === req.label).length;
    const failed = streamRng(r.seed, 'live-change', r.day, req.label, attempt).chance(risk);
    if (failed && !fix) {
      r = { ...r, changes: [...r.changes, { ...change, status: 'FAILED' }] };
      return {
        run: logLine(r, `${req.automated ? 'Automation MISFIRED' : 'Emergency change FAILED'}: ${req.label}`),
        ok: false,
        message: `${req.automated ? 'Automation misfired' : 'Change failed during implementation'} (risk ${(100 * risk).toFixed(0)}%): ${req.label}`,
      };
    }
    if (change.activateDay === r.day) {
      r = { ...r, pendingCommands: [...r.pendingCommands, ...commands], changes: [...r.changes, { ...change, status: 'APPLIED' }] };
    } else r = { ...r, changes: [...r.changes, change] };
    if (fix) r = endEventByFix(r, content, fix.id);
    return { run: logLine(r, `${req.automated ? 'Automation' : 'Emergency change'}: ${req.label}`), ok: true, message: `Applied: ${req.label}` };
  }
  return { run: { ...r, changes: [...r.changes, change] }, ok: true, message: `Planned ${idText('change', change.id)} for day ${change.activateDay + 1}: ${req.label}` };
}

/** Why the config would reject these commands (unknown region, LPAR, pool...), tried on today's config with
 * the changes already planned; null when they apply. Catches a mistyped target before it costs hours. */
export function dryRunRefusal(run: RunState, commands: readonly Command[]): string | null {
  let s = run.sim;
  for (const c of run.changes) if (c.status === 'PLANNED') for (const cmd of c.commands) s = applyCommand(s, cmd).state;
  for (const cmd of commands) {
    const res = applyCommand(s, cmd);
    if (!res.ok) return `${res.message}${targetHint(s, cmd)}`;
    s = res.state;
  }
  return null;
}

function targetHint(s: RunState['sim'], cmd: Command): string {
  const list = (what: string, names: readonly string[]) => `; ${what}: ${names.join(' ')}`;
  switch (cmd.kind) {
    case 'SET_CICS': return list('CICS regions', s.config.cics.map((r) => r.name));
    case 'SET_DB2': return list('Db2 subsystems', s.config.db2.map((d) => d.ssid));
    case 'SET_WEIGHT': case 'SET_LOGICAL': case 'SET_DEFINED_CAPACITY': case 'SET_ABSOLUTE_CAP': case 'SET_IEAOPT': case 'SET_LPAR_MEMORY':
      return list('LPARs', s.config.lpars.map((l) => l.id));
    default: return '';
  }
}

/** End every active event whose card names this fix. */
/** Cancel a change that has not taken effect yet. Capex is refunded; hours only on the day they were spent. */
export function cancelChange(run: RunState, changeId: number): ChangeOutcome {
  const c = run.changes.find((x) => x.id === changeId);
  if (!c) return { run, ok: false, message: `No planned change ${idText('change', changeId)} (already cancelled or applied?)` };
  if (c.status !== 'PLANNED') return { run, ok: false, message: `Already ${c.status.toLowerCase()}` };
  if (c.activateDay === run.day && run.phase !== 'BRIEFING') return { run, ok: false, message: 'It activates today and the day has started' };
  const refundHours = c.plannedDay === run.day ? c.hours : 0;
  const activation = c.commands.find((x) => x.kind === 'ACTIVATE_POLICY');
  return {
    ...(activation?.kind === 'ACTIVATE_POLICY' ? { restoredPolicy: activation.definition } : {}),
    run: logLine(
      { ...run, changes: run.changes.filter((x) => x.id !== changeId), capexRemaining: run.capexRemaining + c.capex, hoursLeft: run.hoursLeft + refundHours },
      `Change cancelled: ${c.label}`,
    ),
    ok: true,
    message: `Cancelled: ${c.label}${refundHours ? ` (${refundHours}h back)` : ''}${c.capex ? ` ($${Math.round(c.capex / 1000)}k capex back)` : ''}`,
  };
}

function endEventByFix(run: RunState, content: GameContent, fixId: string): RunState {
  const tick = run.sim.tick;
  let r = run;
  for (const e of r.events) {
    const def = content.events.find((d) => d.id === e.defId);
    if (e.started && !e.ended && def?.fix === fixId) {
      r = {
        ...r,
        events: r.events.map((x) => (x.uid === e.uid ? { ...x, ended: true, endTick: tick } : x)),
        pendingCommands: [...r.pendingCommands, ...e.endCommands],
      };
    }
  }
  return r;
}

function spendHours(run: RunState, hours: number): RunState {
  const left = run.hoursLeft - hours;
  const overtime = Math.max(0, -left) - Math.max(0, -run.hoursLeft);
  return { ...run, hoursLeft: left, fatigue: Math.min(100, run.fatigue + overtime * FATIGUE_PER_OVERTIME_HOUR) };
}

/** The policy of an activation that failed at this morning's start, so its edits can be pending again. */
export function failedPolicyToday(run: RunState): ServiceDefinition | null {
  for (const c of [...run.changes].reverse()) {
    if (c.status !== 'FAILED' || c.activateDay !== run.day) continue;
    const a = c.commands.find((x) => x.kind === 'ACTIVATE_POLICY');
    if (a?.kind === 'ACTIVATE_POLICY') return a.definition;
  }
  return null;
}

/** BRIEFING → LIVE: activate planned changes due today (with failure risk). */
export function startDay(run: RunState, content: GameContent): RunState {
  if (run.phase !== 'BRIEFING') return run;
  let r = run;
  const changes: PlannedChange[] = [];
  const pending: Command[] = [...r.pendingCommands];
  for (const c of r.changes) {
    if (c.status === 'PLANNED' && c.activateDay === r.day) {
      const attempt = changes.filter((x) => x.label === c.label).length;
      const failed = streamRng(r.seed, 'activate', r.day, c.label, attempt).chance(failRisk(r));
      if (failed) {
        changes.push({ ...c, status: 'FAILED' });
        const policy = c.commands.some((x) => x.kind === 'ACTIVATE_POLICY') ? ' Its edits go back to the pending policy (unless newer edits are pending); activate to reschedule.' : '';
        r = msg(
          r,
          'Change board',
          `Change failed: ${c.label}`,
          `Implementation backed out (risk was ${Math.round(failRisk(r) * 100)} %; tired teams and rushed changes fail more often). Hours were spent; try again tomorrow.${policy}`,
        );
        continue;
      }
      pending.push(...c.commands);
      changes.push({ ...c, status: 'APPLIED' });
      r = logLine(r, `Planned change applied: ${c.label}`);
      if (c.endsEvent) r = endEventByFix(r, content, c.endsEvent);
    } else {
      if (c.status === 'APPLIED' && c.revertDay === r.day) pending.push(...c.revertCommands);
      changes.push(c);
    }
  }
  r = { ...r, changes, pendingCommands: pending, phase: 'LIVE', hour: newHour(r.sim.tick), mon3Charts: null };
  // Today's chart history starts at 06:00 and shows the planned changes just applied.
  if (chartsActive(r)) r = { ...r, mon3Charts: { ...emptyCharts(r), logSeen: run.log.length } };
  return r;
}

const newHour = (tick: number): HourAcc => ({
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

const toolOn = (r: RunState, id: string) => r.tools.includes(id) && !r.toolsOff.includes(id);
const chartsActive = (r: RunState) => toolOn(r, 'MON3_CHARTS') && toolOn(r, 'RMF_MON3');

/** Advance the live day by up to `ticks` ticks. Ends the day automatically at 06:00. */
export function advance(run: RunState, baseScenario: Scenario, content: GameContent, ticks: number): RunState {
  const scenario = scenarioFor(baseScenario, run.difficulty);
  let r = run;
  for (let i = 0; i < ticks && r.phase === 'LIVE'; i++) {
    const tick = r.sim.tick;
    const cmds: Command[] = [...r.pendingCommands];
    const switchTo = scheduledActivation(r);
    if (switchTo) {
      cmds.push(switchTo);
      r = logLine(r, `V WLM,POLICY=${switchTo.kind === 'ACTIVATE_POLICY' ? switchTo.definition.policyName : ''} (scheduled)`);
    }
    let events = r.events;
    const resolvedEnd = new Map<string, Command[]>();
    for (const e of events) {
      const def = content.events.find((d) => d.id === e.defId);
      if (!e.started && e.startTick <= tick) {
        cmds.push(...scaleEventCommands(def?.begin ?? [], difficultyOf(r.difficulty).eventSeverityMult));
        if (def?.capacityDrop) {
          // A site power cap throttles every CPC on the floor; the end restores each one's setting.
          const restore: Command[] = [];
          for (const cpc of r.sim.config.cpcs) {
            const to = Math.max(4, cpc.capacitySetting - def.capacityDrop) as 4 | 5 | 6 | 7;
            cmds.push({ kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: to });
            restore.push({ kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: cpc.capacitySetting });
          }
          resolvedEnd.set(e.uid, restore);
        }
        if (def?.announcement) r = msg(r, 'Operations', def.name, def.announcement);
        if (def?.perkTip && r.perks.includes(def.perkTip.perk)) r = msg(r, def.perkTip.from, def.name, def.perkTip.text);
        r = logLine(r, `EVENT start: ${e.name}`);
      }
      if (e.started && !e.ended && e.endTick !== null && e.endTick <= tick) {
        cmds.push(...e.endCommands);
        r = logLine(r, `EVENT end: ${e.name}`);
      }
    }
    events = events.map((e) => ({
      ...e,
      endCommands: resolvedEnd.get(e.uid) ?? e.endCommands,
      started: e.started || e.startTick <= tick,
      ended: e.ended || (e.started && e.endTick !== null && e.endTick <= tick),
    }));
    const sim = step(r.sim, cmds, scenario);
    r = { ...r, sim, events, pendingCommands: [] };
    r = accumulateHour(r);
    if ((tick + 1) % ALERTS.evalTicks === 0) {
      const before = r.alerts?.firing ?? [];
      if (toolOn(r, 'ALERTS') && toolOn(r, 'RMF_MON3')) r = evaluateAlerts(r, scenario);
      if (toolOn(r, 'AUTOMATION') && r.phase === 'LIVE') {
        const fired = (r.alerts?.firing ?? []).filter((id) => !before.includes(id));
        r = runAutomation(r, content, fired, requestChange);
      }
    }
    if (chartsActive(r)) {
      r = accumulateMon3(r);
      if ((tick + 1) % MON3_CHARTS.sampleTicks === 0) r = recordMon3(r, scenario);
    }
    if ((tick + 1) % TICKS_PER_HOUR === 0) r = deliverInquiries(closeHour(r, scenario), scenario, content);
    if ((tick + 1) % TICKS_PER_DAY === 0) r = endDay(r, scenario, content);
  }
  return r;
}

function accumulateHour(run: RunState): RunState {
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

function closeHour(run: RunState, scenario: Scenario): RunState {
  const h = run.hour;
  if (!h) return run;
  let r = run;
  const trust = { ...r.trust };
  let incidents = [...r.incidents];
  const baselines = { ...r.baselines };
  for (const w of allWorkloads(scenario, r)) {
    const wh = h.workloads[w.id];
    if (!wh) continue;
    const att = hourAttainment(w, wh);
    if (!att) continue;
    const parts = perTxnParts(wh);
    // Incidents are per played day (the day's SLA report and RCA count them): one still open at
    // 06:00 is closed there, and a breach that carries on opens a new incident for the new day.
    const hourStart = r.sim.tick - TICKS_PER_HOUR;
    incidents = incidents.map((i) => (i.workloadId === w.id && i.endTick === null && i.day !== r.day ? { ...i, endTick: hourStart } : i));
    const openIdx = incidents.findIndex((i) => i.workloadId === w.id && i.endTick === null);
    if (att.met) {
      baselines[w.id] = updateBaseline(baselines[w.id], parts);
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
      const mechanism = failureMechanismOf(w, wh, r.events) ?? mechanismOf(parts, baselines[w.id] ?? {}, h, hosts);
      const isNew = r.sim.extraWorkloads.some((x) => x.id === w.id);
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
  const smfHours = [...(r.smfHours ?? []), { day: r.day, hourOfDay: Math.floor(clockAt(r.sim.tick - TICKS_PER_HOUR).hourOfDay), workloads: h.workloads }].slice(-SMF_HOURS_KEPT);
  return { ...r, trust, incidents, baselines, smfHours, hour: newHour(r.sim.tick) };
}

/**
 * Incident workloads whose service class never missed its goal in WLMGL that day (every host's class had a
 * worst sysplex PI ≤ 1): the class average or region goal hid the slide. Only subsystems with a
 * per-transaction record to point at count. Workload id → subsystem.
 */
export function wlmHidSlides(r: RunState, scenario: Scenario, incidents: readonly Incident[], piWorst: Readonly<Record<string, number>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of allWorkloads(scenario, r)) {
    const sub = w.work.subsystem;
    if (!sub || !(sub in WLM_DISAGREE_HINTS) || !incidents.some((i) => i.workloadId === w.id)) continue;
    const pis = Object.entries(r.sim.routing[w.id] ?? w.routing)
      .filter(([, f]) => f > 0)
      .map(([lparId]) => piWorst[`${classify(r.sim.wlm.definition, { ...w.work, SY: lparId }).serviceClass}#1`]);
    if (pis.length > 0 && pis.every((p) => p !== undefined && p <= 1)) out[w.id] = sub;
  }
  return out;
}

/**
 * Service-class periods whose worst PI rose to STRAIN.minPi and STRAIN.riseFactor × the day before, excluding the
 * classes of workloads that raised an incident (their own hint covers them) and batch classes. Worst first.
 */
export function strainedClasses(r: RunState, scenario: Scenario, incidents: readonly Incident[], piWorst: Readonly<Record<string, number>>, prevPiWorst: Readonly<Record<string, number>> | undefined): StrainedClass[] {
  if (!prevPiWorst) return [];
  const covered = jesClasses(r.sim.wlm.definition);
  for (const w of allWorkloads(scenario, r)) {
    if (!incidents.some((i) => i.workloadId === w.id)) continue;
    for (const lparId of Object.keys(r.sim.routing[w.id] ?? w.routing)) covered.add(classify(r.sim.wlm.definition, { ...w.work, SY: lparId }).serviceClass);
  }
  return Object.keys(piWorst)
    .sort()
    .flatMap((scKey) => {
      const pi = piWorst[scKey]!;
      const prevPi = prevPiWorst[scKey] ?? 0;
      return pi >= STRAIN.minPi && pi >= STRAIN.riseFactor * prevPi && !covered.has(scKey.split('#')[0]!) ? [{ scKey, pi, prevPi }] : [];
    })
    .sort((a, b) => b.pi - a.pi);
}

/**
 * Worst sysplex PI per service-class period across the RMF intervals that closed within the day. With minEnded,
 * response-time periods count only in intervals where at least that many transactions ended.
 */
export function worstPiOfDay(intervals: readonly RmfInterval[], day: number, minEnded = 0): Record<string, number> {
  const out: Record<string, number> = {};
  for (const iv of intervals) {
    if (iv.endTick <= day * TICKS_PER_DAY || iv.endTick > (day + 1) * TICKS_PER_DAY) continue;
    for (const w of iv.wlm) {
      if (w.lparId !== '*PLEX' || w.pi === null || w.pi <= (out[w.scKey] ?? -Infinity)) continue;
      if (minEnded > 0 && RT_GOAL.test(w.goalText) && w.ended < minEnded) continue;
      out[w.scKey] = w.pi;
    }
  }
  return out;
}
const RT_GOAL = /^AVG |% </;

/** Service classes the JES rules can assign (batch; the batch-window hint speaks for them). */
function jesClasses(def: ServiceDefinition): Set<string> {
  const out = new Set<string>();
  const walk = (rs: readonly ClassificationRule[]) => rs.forEach((x) => (x.serviceClass && out.add(x.serviceClass), walk(x.children)));
  for (const ss of def.subsystems.filter((x) => x.subsystem === 'JES')) {
    if (ss.defaultServiceClass) out.add(ss.defaultServiceClass);
    walk(ss.rules);
  }
  return out;
}

/** Peak SYSOTHER APPL CP% per LPAR (periods summed within an interval) across the day's closed RMF intervals. */
export function sysotherByLpar(intervals: readonly RmfInterval[], day: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const iv of intervals) {
    if (iv.endTick <= day * TICKS_PER_DAY || iv.endTick > (day + 1) * TICKS_PER_DAY) continue;
    const here: Record<string, number> = {};
    for (const w of iv.wlm) if (w.serviceClass === 'SYSOTHER' && w.lparId !== '*PLEX') here[w.lparId] = (here[w.lparId] ?? 0) + w.applCpPct;
    for (const [id, v] of Object.entries(here)) if (v > (out[id] ?? 0)) out[id] = v;
  }
  return out;
}


/** A missed batch window opens an incident for the night, so it can get an RCA like an online SLA miss. */
function batchMissIncident(r: RunState, night: NightSummary, trustLost: number): RunState {
  const hosts = (night.criticalHosts ?? []).map((j) => {
    const sc = classify(r.sim.wlm.definition, { subsystem: 'JES', TN: j.name, TC: j.jobClass, SY: j.lparId }).serviceClass;
    return { lparId: j.lparId, cpcId: r.sim.config.lpars.find((l) => l.id === j.lparId)?.cpcId ?? '', importance: importanceRank(r.sim.wlm.definition, `${sc}#1`) };
  });
  const nightStartTick = r.day * TICKS_PER_DAY + 12 * TICKS_PER_HOUR;
  const nightHour = r.nightHour ?? newHour(nightStartTick);
  const mechanism = batchMissMechanism(night, nightHour, hosts);
  const truth = { mechanism, trigger: batchMissTrigger(mechanism, r.events, nightHour, nightStartTick) };
  const lead = r.incidents.find((i) => i.day === r.day && i.rcaGroup === undefined && i.truth.mechanism === truth.mechanism && i.truth.trigger === truth.trigger);
  const inc: Incident = {
    id: r.nextId,
    workloadId: BATCH_INCIDENT,
    day: r.day,
    startTick: nightStartTick,
    endTick: r.sim.tick,
    hours: 12,
    worstAttainmentPct: 0,
    truth,
    rca: lead?.rca ?? null,
    trustLost,
    ...(lead ? { rcaGroup: lead.id } : {}),
  };
  return logLine({ ...r, nextId: r.nextId + 1, incidents: [...r.incidents, inc] }, `INCIDENT ${BATCH_INCIDENT}: critical batch missed its window`);
}

function endDay(run: RunState, scenario: Scenario, content: GameContent): RunState {
  let r = run;
  const day = r.day;
  const trustBefore = { ...r.trust };
  const trust = { ...r.trust };

  // SLA summary for the day from hourly incidents.
  const dayIncidents = r.incidents.filter((i) => i.day === day);
  const sla = allWorkloads(scenario, r)
    .filter((w) => w.sla.kind !== 'NONE')
    .map((w) => {
      const breach = dayIncidents.filter((i) => i.workloadId === w.id).reduce((a, i) => a + i.hours, 0);
      return {
        workloadId: w.id,
        target: w.sla.kind === 'PCT' ? `${w.sla.pct}% < ${(w.sla.rtSec * 1000).toFixed(0)}ms` : w.sla.kind === 'AVG' ? `avg < ${w.sla.rtSec}s` : '-',
        attainmentPct: 100 * (1 - breach / 24),
        breachHours: breach,
      };
    });
  for (const f of facetsOf(r)) {
    const owned = allWorkloads(scenario, r).filter((w) => facetOf(w) === f);
    if (owned.length > 0 && owned.every((w) => !dayIncidents.some((i) => i.workloadId === w.id))) trust[f] = clampTrust(trust[f]! + 1.5);
  }

  // Batch deadline (the night that ended at this 06:00).
  const night = r.sim.batch.nights.find((n) => n.day === day) ?? null;
  const missed = night ? night.missedDeadline || night.criticalEndSec === null || night.criticalEndSec > r.batchDeadlineSec : false;
  if (night && missed) {
    trust.Regulator = clampTrust(trust.Regulator! - 20);
    const hurt = r.batchMissFacet ?? 'Retail';
    if (hurt in trust) trust[hurt] = clampTrust(trust[hurt]! - 4);
    r = msg(r, 'Regulator', 'Batch deadline missed', 'Critical batch did not complete on time. A second consecutive miss will trigger a formal review.');
    r = batchMissIncident(r, night, (trustBefore.Regulator! - trust.Regulator!) + (hurt in trust ? trustBefore[hurt]! - trust[hurt]! : 0));
  } else if (night) trust.Regulator = clampTrust(trust.Regulator! + 1);
  // Regulator audit cards: SYSOTHER service on any LPAR today is a finding.
  const auditing = r.events.some((e) => e.started && !e.ended && content.events.find((d) => d.id === e.defId)?.auditUnclassified);
  if (auditing) {
    const seen = Object.entries(sysotherByLpar(r.sim.rmf.intervals, day)).filter(([, v]) => v > AUDIT.minApplPct);
    if (seen.length > 0) {
      trust.Regulator = clampTrust(trust.Regulator! - AUDIT.findingTrust);
      const [lpar, pct] = seen.reduce((a, b) => (b[1] > a[1] ? b : a));
      r = msg(r, 'Regulator', 'Audit finding: unclassified work', `Audit finding: unclassified work in SYSOTHER on ${lpar} (${pct.toFixed(1)}% APPL).`);
    } else {
      trust.Regulator = clampTrust(trust.Regulator! + AUDIT.cleanDayTrust);
      r = msg(r, 'Regulator', 'Audit: no findings today', 'Audit: no findings today.');
    }
  }
  const consecutive = missed ? r.consecutiveBatchMisses + 1 : 0;
  if (r.capacityToday) r = { ...r, capacityDays: [...(r.capacityDays ?? []), { ...r.capacityToday, day, criticalEndSec: night?.criticalEndSec ?? null }], capacityToday: null };

  // Opex: temporary capacity charges today; monthly MLC bills as they arrive.
  const codToday = r.changes.filter((c) => c.status === 'APPLIED' && c.opexPerDay > 0 && c.revertDay !== null && c.revertDay > day).reduce((a, c) => a + c.opexPerDay, 0);
  let opexSpent = r.opexSpentThisMonth + codToday;
  let endReason: string | null = null;
  const budget = opexBudgetFor(r.opexBudgetMonthly, r.perks);
  const bills = r.sim.cost.bills;
  for (let b = r.billsSeen; b < bills.length; b++) {
    const total = bills[b]!.total + opexSpent;
    const over = total / budget - 1;
    if (over > 0) trust.Finance = clampTrust(trust.Finance! - Math.min(40, over * 100));
    else trust.Finance = clampTrust(trust.Finance! + 5);
    if (r.constraints.includes('CFO_MANDATE') && b > 0 && bills[b]!.total > 0.9 * bills[b - 1]!.total) {
      trust.Finance = clampTrust(trust.Finance! - 15);
      r = msg(r, 'CFO', 'Cost target missed', `MLC $${Math.round(bills[b]!.total).toLocaleString()} vs target $${Math.round(0.9 * bills[b - 1]!.total).toLocaleString()}.`);
    }
    r = msg(r, 'Finance', `Month ${b + 1} bill`, `MLC $${Math.round(bills[b]!.total).toLocaleString()} + temporary capacity $${Math.round(opexSpent).toLocaleString()} vs budget $${Math.round(budget).toLocaleString()}.`);
    if (over > 0.25) endReason = 'Opex overrun beyond 25%: the CFO has outsourced capacity planning.';
    opexSpent = 0;
  }

  const trustDelta = Object.fromEntries(facetsOf(r).map((f) => [f, trust[f]! - trustBefore[f]!])) as Record<Facet, number>;
  const slaScore = sla.reduce((a, s) => a + 10 * (s.attainmentPct / 100), 0);
  const rcaPoints = dayIncidents.filter((i) => i.rcaGroup === undefined).reduce((a, i) => a + (i.rca?.points ?? 0), 0);
  const dayScore = Math.round(slaScore + (night && !missed ? 15 : 0) + rcaPoints);
  const report: DayReport = {
    day,
    sla,
    batch: night,
    batchMissed: missed,
    trustDelta,
    score: dayScore,
    mlcEstimate: estimateMonth(r.sim.cost, scenario.products),
    events: r.events.filter((e) => e.started && e.startTick < r.sim.tick && e.startTick >= day * TICKS_PER_DAY).map((e) => e.name),
    piWorst: worstPiOfDay(r.sim.rmf.intervals, day),
  };

  const bonus = r.bonusHours.filter((b) => b.untilDay > day + 1);
  r = expireToolTrials(r, day);
  r = {
    ...r,
    trust,
    nightHour: null,
    consecutiveBatchMisses: consecutive,
    opexSpentThisMonth: opexSpent,
    billsSeen: bills.length,
    reports: [...r.reports, report],
    score: r.score + dayScore,
    fatigue: Math.max(0, r.fatigue - 8),
    bonusHours: bonus,
    hoursLeft: Math.max(0, r.baseHours + bonus.reduce((a, b) => a + b.hours, 0)),
  };

  r = tfpAtDayEnd(r, scenario);
  const overall = overallTrust(r);
  if (!endReason && (overall <= 0 || facetsOf(r).some((f) => r.trust[f]! <= 0))) endReason = 'Trust collapsed: you have been reassigned to the printer fleet.';
  if (!endReason && consecutive >= 2) endReason = 'Two consecutive batch deadline misses: the regulator has opened a formal review.';
  if (endReason) return { ...r, phase: 'GAMEOVER', endReason };
  if (day >= r.maxDays - 1 && r.endlessFromDay === undefined) return { ...r, phase: 'VICTORY', endReason: 'Quarter closed. You kept the bank running.' };

  const hid = wlmHidSlides(r, scenario, dayIncidents, report.piWorst ?? {});
  const strained = strainedClasses(r, scenario, dayIncidents, worstPiOfDay(r.sim.rmf.intervals, day, STRAIN.minEnded), r.reports.at(-2)?.piWorst);
  for (const h of morningHints(hintLevelFor(difficultyOf(r.difficulty).hints, r.perks), dayIncidents, night ? { missed, criticalEndSec: night.criticalEndSec, deadlineSec: r.batchDeadlineSec } : null, hid, strained))
    r = msg(r, HINT_SENDER, 'A thought for this morning', h, day + 1);
  return openReview(r, content, day);
}

/**
 * VICTORY → REVIEW: keep playing past the quarter (endless mode). Growth keeps compounding and the deck keeps
 * drawing; a fresh quarter's capex arrives. The run ends only on a loss, and still counts as a victory.
 */
export function continueEndless(run: RunState, content: GameContent): RunState {
  if (run.phase !== 'VICTORY' || run.endlessFromDay !== undefined) return run;
  let r: RunState = {
    ...run,
    endlessFromDay: run.day,
    endReason: null,
    capexRemaining: run.capexRemaining + content.capexQuarter * difficultyOf(run.difficulty).capexMult,
  };
  r = msg(r, 'CIO', 'Another quarter', 'The board liked the last one. Same systems, more volume, and a new capital budget. Keep it running.', run.day + 1);
  return openReview(r, content, run.day);
}

function openReview(r: RunState, content: GameContent, day: number): RunState {
  const draft = ((rng: Rng) => {
    // The hoarder perk is the advisor tool for free: pointless once it is owned.
    const pool = DRAFT_OPTIONS.filter((d) => !r.perks.includes(d.id) && !(d.id === 'RC_HOARDER' && r.tools.includes('RC_ADVISOR')) && !(d.id === 'SQL_SPRINT' && r.projects?.some((p) => p.id === 'SQL_TUNING' && p.done)) && !(d.id === 'MENTOR' && difficultyOf(r.difficulty).hints === 'CLEAR') && !(d.id === 'TOOL_TRIAL' && !trialTool(r)));
    const out = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const p = rng.pickWeighted(pool, (d) => d.weight)!;
      pool.splice(pool.indexOf(p), 1);
      out.push({ id: p.id, title: p.title, description: p.description });
    }
    return out;
  })(streamRng(r.seed, 'draft', day));
  r = drawEvents({ ...r, phase: 'REVIEW', draft }, content, day + 1);
  return r;
}

/** REVIEW → BRIEFING of the next day. */
export function chooseDraft(run: RunState, content: GameContent, optionId: string | null): RunState {
  if (run.phase !== 'REVIEW') return run;
  let r: RunState = { ...run, draft: null };
  switch (optionId) {
    case 'CONTRACTOR':
      r = { ...r, bonusHours: [...r.bonusHours, { hours: 4, untilDay: r.day + 4 }], hoursLeft: r.hoursLeft + 4 };
      break;
    case 'CFO_BONUS':
      r = { ...r, capexRemaining: r.capexRemaining + 300_000 };
      break;
    case 'QUIET_DAY':
      r = { ...r, fatigue: Math.max(0, r.fatigue - 30) };
      break;
    case 'GOODWILL':
      r = { ...r, trust: mapTrust(r, (t) => t + 4) };
      break;
    case 'VENDOR_TRIAL':
      r = { ...r, insight: r.insight + 15 };
      break;
    case 'OVERTIME_PUSH':
      r = {
        ...r,
        bonusHours: [...r.bonusHours, { hours: DRAFT_TUNING.overtimeHours, untilDay: r.day + 2 }],
        hoursLeft: r.hoursLeft + DRAFT_TUNING.overtimeHours,
        fatigue: r.fatigue + DRAFT_TUNING.overtimeFatigue,
      };
      break;
    case 'NIGHT_DESK':
      // Lasts the run: a bonus that never expires (finite so the save stays plain JSON).
      r = { ...r, perks: [...r.perks, optionId], bonusHours: [...r.bonusHours, { hours: DRAFT_TUNING.nightDeskHours, untilDay: Number.MAX_SAFE_INTEGER }], hoursLeft: r.hoursLeft + DRAFT_TUNING.nightDeskHours };
      break;
    case 'BUDGET_SWAP':
      r = { ...r, perks: [...r.perks, optionId], capexRemaining: r.capexRemaining + DRAFT_TUNING.budgetSwapCapex };
      break;
    case 'TOOL_TRIAL': {
      const t = trialTool(r);
      if (t)
        r = {
          ...r,
          tools: [...r.tools, t.id],
          toolTrials: [...(r.toolTrials ?? []), { id: t.id, untilDay: r.day + 1 + DRAFT_TUNING.toolTrialDays }],
          log: [...r.log, `Analytics: ${t.name} on a free ${DRAFT_TUNING.toolTrialDays}-day trial`],
        };
      break;
    }
    case 'SQL_SPRINT':
      r = grantProjectHours(r, 'SQL_TUNING', DRAFT_TUNING.sqlSprintHours);
      break;
    case 'RC_HOARDER':
      r = { ...r, perks: [...r.perks, optionId], tools: r.tools.includes('RC_ADVISOR') ? r.tools : [...r.tools, 'RC_ADVISOR'], log: [...r.log, 'Analytics: Report class advisor installed (Report Class Hoarder)'] };
      break;
    case 'HMC_NINJA':
    case 'DB2_WHISPERER':
    case 'BELT_AND_BRACES':
    case 'VENDOR_FRIEND':
    case 'ZIIP_PROMO':
    case 'WLM_COURSE':
    case 'MENTOR':
    case 'WELL_CONNECTED':
    case 'FRIENDS_IN_FINANCE':
    case 'NIGHT_OWL':
      r = { ...r, perks: [...r.perks, optionId] };
      break;
    default:
      break;
  }
  r = { ...r, day: r.day + 1, phase: 'BRIEFING', reportsOpenedToday: [] };
  return storyFor(r, content, r.day);
}

/** The incident whose RCA covers this one (itself unless linked to an earlier same-cause incident that day). */
export function rcaLeadId(inc: Incident): number {
  return inc.rcaGroup ?? inc.id;
}

/** Root-cause analysis for an incident and every incident linked to it; scored once against the ground truth. */
export function submitRca(run: RunState, incidentId: number, mechanism: Mechanism, trigger: Trigger, scenario?: Scenario, evidenceIds: readonly number[] = []): RunState {
  const inc = run.incidents.find((i) => i.id === incidentId);
  if (!inc || inc.rca) return run;
  const leadId = rcaLeadId(inc);
  const group = run.incidents.filter((i) => rcaLeadId(i) === leadId);
  const points = scoreRca(inc.truth, { mechanism, trigger });
  const pins = (run.pins ?? []).filter((p) => evidenceIds.includes(p.id)).slice(0, EVIDENCE.perRca);
  // A pin counts if it is evidence for any incident in the group (each has its own workload and window).
  const verdicts = scenario
    ? group.map((g) => judgeEvidence(run, scenario, g, pins)).reduce((best, vs) => best.map((b, k) => (vs[k]!.relevance > b.relevance ? vs[k]! : b)))
    : [];
  const relevance = verdicts.reduce((a, v) => a + v.relevance, 0);
  // Evidence only earns points when it supports the right mechanism (SPEC §10).
  const evidencePoints = mechanism === inc.truth.mechanism ? Math.round(relevance * EVIDENCE.pointsPerRelevance * 2) / 2 : 0;
  const strong = evidencePoints > 0 && relevance >= EVIDENCE.strongAt;
  const baseTrust = points >= 3 ? 2 : points > 0 ? 0.5 : -1;
  const facetTrust = baseTrust > 0 ? baseTrust * (1 + (group.length - 1) * EVIDENCE.groupTrustPerIncident) : baseTrust;
  const trust = mapTrust(run, (t) => t + facetTrust / 2);
  const total = points + evidencePoints;
  const rca = { mechanism, trigger, points: total, evidence: verdicts, evidencePoints };
  return {
    ...run,
    trust,
    insight: run.insight + total + (strong ? EVIDENCE.strongInsight : 0),
    score: run.score + total,
    incidents: run.incidents.map((i) => (rcaLeadId(i) === leadId ? { ...i, rca } : i)),
  };
}
