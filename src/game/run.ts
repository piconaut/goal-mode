import { toolOn } from './run/shared';
import { ALERTS } from '../content/alerts';
import type { DifficultyId } from '../content/difficulty';
import { DRAFT_OPTIONS, DRAFT_TUNING } from '../content/draft';
import { AUDIT } from '../content/events/midwest-events';
import { HINT_SENDER, STRAIN } from '../content/hints';
import { INSIGHT, MON3_CHARTS } from '../content/tools';
import { applyCommands, type Command } from '../sim/core/commands';
import { initState } from '../sim/core/init';
import { Rng, streamRng } from '../sim/core/rng';
import type { Scenario } from '../sim/core/scenario';
import { step } from '../sim/core/step';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { estimateMonth } from '../sim/cost/mlc';
import type { NightSummary } from '../sim/subsys/batch';
import { classify } from '../sim/wlm/classify';
import { emptyAlerts, evaluateAlerts } from './alerts';
import { emptyAutomation, runAutomation } from './automation';
import { opexBudgetFor } from './catalog';
import { difficultyOf, scaleEventCommands, scenarioFor } from './difficulty';
import { hintLevelFor, morningHints } from './hints';
import { deliverInquiries } from './inquiries';
import { accumulateMon3, emptyCharts, recordMon3 } from './mon3Charts';
import { emptyPolicyBook, scheduledActivation } from './policies';
import { grantProjectHours } from './projects';
import { failRisk, NO_TARGET, requestChange } from './run/changes';
import { strainedClasses, sysotherByLpar, wlmHidSlides, worstPiOfDay } from './run/diagnostics';
import { drawEvents, endEventByFix, hasEventForFix, storyFor } from './run/events';
import { accumulateHour, closeHour, newHour } from './run/hourly';
import type { GameContent } from './run/shared';
import { BASE_HOURS, clampTrust, facetOf, logLine, mapTrust, msg, overallTrust } from './run/shared';
import { BATCH_INCIDENT, batchMissMechanism, batchMissTrigger, importanceRank } from './sla';
import { tfpAtDayEnd } from './tfp';
import { expireToolTrials, measurementCommands, trialTool } from './tools';
import {
  FACETS,
  facetsOf,
  type DayReport,
  type Facet,
  type Incident,
  type PlannedChange,
  type RunState
} from './types';
import { allWorkloads } from './workloads';

export type { GameContent } from './run/shared';
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

/** BRIEFING → LIVE: activate planned changes due today (with failure risk). */
export function startDay(run: RunState, content: GameContent): RunState {
  if (run.phase !== 'BRIEFING') return run;
  let r = run;
  const changes: PlannedChange[] = [];
  for (const c of r.changes) {
    if (c.status === 'PLANNED' && c.activateDay === r.day) {
      const attempt = changes.filter((x) => x.label === c.label).length;
      const failed = streamRng(r.seed, 'activate', r.day, c.label, attempt).chance(failRisk(r));
      if (failed) {
        changes.push({ ...c, status: 'FAILED' });
        const policy = c.commands.some((x) => x.kind === 'ACTIVATE_POLICY') ? ' Its edits go back to the pending policy (unless newer edits are pending or a later activation succeeds); activate to reschedule.' : '';
        r = msg(
          r,
          'Change board',
          `Change failed: ${c.label}`,
          `Implementation backed out (risk was ${Math.round(failRisk(r) * 100)} %; tired teams and rushed changes fail more often). Hours were spent; try again tomorrow.${policy}`,
        );
        continue;
      }
      r = { ...r, pendingCommands: [...r.pendingCommands, ...c.commands] };
      changes.push({ ...c, status: 'APPLIED' });
      const noTarget = c.endsEvent !== null && !hasEventForFix(r, content, c.endsEvent);
      r = logLine(r, `Planned change applied: ${c.label}${noTarget ? ` (${NO_TARGET})` : ''}`);
      if (c.endsEvent) r = endEventByFix(r, content, c.endsEvent);
    } else {
      if (c.status === 'APPLIED' && c.revertDay === r.day) {
        r = { ...r, pendingCommands: [...r.pendingCommands, ...c.revertCommands] };
      }
      changes.push(c);
    }
  }
  r = { ...r, changes, phase: 'LIVE', hour: newHour(r.sim.tick), mon3Charts: null };
  // Today's chart history starts at 06:00 and shows the planned changes just applied.
  if (chartsActive(r)) r = { ...r, mon3Charts: { ...emptyCharts(r), logSeen: run.log.length } };
  return r;
}

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
    const resolvedAffects = new Map<string, string[]>();
    for (const e of events) {
      const def = content.events.find((d) => d.id === e.defId);
      if (!e.started && e.startTick <= tick) {
        cmds.push(...scaleEventCommands(def?.begin ?? [], difficultyOf(r.difficulty).eventSeverityMult));
        if (def?.capacityDrop) {
          // A site power cap throttles every CPC on the floor; the end restores each one's setting.
          const restore: Command[] = [];
          const affectedCpcs = new Set<string>();
          for (const cpc of r.sim.config.cpcs) {
            const to = Math.max(4, cpc.capacitySetting - def.capacityDrop) as 4 | 5 | 6 | 7;
            if (to < cpc.capacitySetting) affectedCpcs.add(cpc.id);
            cmds.push({ kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: to });
            restore.push({ kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: cpc.capacitySetting });
          }
          resolvedEnd.set(e.uid, restore);
          const affectedLpars = new Set(r.sim.config.lpars.filter((l) => affectedCpcs.has(l.cpcId)).map((l) => l.id));
          resolvedAffects.set(e.uid, allWorkloads(scenario, r)
            .filter((w) => Object.entries(r.sim.routing[w.id] ?? w.routing).some(([id, share]) => share > 0 && affectedLpars.has(id)))
            .map((w) => w.id));
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
      affects: resolvedAffects.get(e.uid) ?? e.affects,
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
    if ((tick + 1) % TICKS_PER_HOUR === 0) r = deliverInquiries(closeHour(r, scenario, content), scenario, content);
    if ((tick + 1) % TICKS_PER_DAY === 0) r = endDay(r, scenario, content);
  }
  return r;
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

export { overallTrust } from './run/shared';

export { drawEvents } from './run/events';

export type { ChangeRequest } from './run/changes';

export type { ChangeOutcome } from './run/changes';

export { fixIdsOf } from './run/events';

export { previewContext } from './run/changes';

export { requestChange } from './run/changes';

export { dryRunRefusal } from './run/changes';

export { cancelChange } from './run/changes';

export { failedPolicyToday } from './run/changes';

export { wlmHidSlides } from './run/diagnostics';

export { strainedClasses } from './run/diagnostics';

export { worstPiOfDay } from './run/diagnostics';

export { sysotherByLpar } from './run/diagnostics';

export { rcaLeadId } from './run/rca';

export { submitRca } from './run/rca';
