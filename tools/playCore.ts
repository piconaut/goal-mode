// Headless play interface for agents (PROGRESS M8.9): a run file plus commands, no hidden ground truth.
// The run file holds the serialised RunState (as the browser saves it), the pending WLM policy and the
// command log, so seed + log replays the same run.

import { packOf } from '../src/content/packs';
import type { DifficultyId } from '../src/content/difficulty';
import { scenarioFor } from '../src/game/difficulty';
import { advance, chooseDraft, newRun, requestChange, startDay, submitRca, type ChangeRequest } from '../src/game/run';
import type { Mechanism, RunState, Trigger } from '../src/game/types';
import { buyTool, hasFeature, noteReportOpened, REPORT_FEATURE, SMF_FEATURE } from '../src/game/tools';
import { batchNight, cicsMonitoring, db2Accounting, smf113, smfHourRefs } from '../src/game/smf';
import { FIXES } from '../src/game/catalog';
import { HARDWARE } from '../src/content/hardware-catalog';
import { TOOLS, type ToolFeature } from '../src/content/tools';
import { applyReportClassAdvice } from '../src/game/rcAdvisor';
import { runWorkItems } from '../src/game/workloads';
import { formatClock } from '../src/sim/core/clock';
import { decideTfp } from '../src/game/tfp';
import { decodeRunJson, encodeRunJson } from '../src/game/runFile';
import { askAround, inquiriesView } from '../src/game/inquiries';
import { projectsView, workOnProject } from '../src/game/projects';
import { addPin, removePin, type PinRequest } from '../src/game/evidence';
import { EVIDENCE_METRICS } from '../src/content/evidence';
import type { InquiryKind } from '../src/content/inquiries';
import { applyWlmEdit, pendingBase, type WlmEdit } from '../src/game/wlmEdit';
import { buildView } from '../src/game/view';
import { MECHANISMS, TRIGGERS } from '../src/game/sla';
import type { ServiceDefinition } from '../src/sim/wlm/types';
import { renderReport, REPORT_KINDS, type ReportKind } from '../src/sim/measure/reports';
import { TICKS_PER_HOUR } from '../src/sim/core/units';
import type { SmfKind } from '../src/worker/protocol';


export type PlayCommand =
  | { cmd: 'new'; seed: number; difficulty?: DifficultyId; scenario?: string }
  | { cmd: 'start' }
  | { cmd: 'advance'; hours: number }
  | { cmd: 'change'; req: ChangeRequest }
  | { cmd: 'draft'; optionId: string | null }
  | { cmd: 'rca'; incidentId: number; mechanism: Mechanism; trigger: Trigger; evidenceIds?: number[] }
  | { cmd: 'ask'; topic: InquiryKind; workloadId?: string | null }
  | { cmd: 'project'; id: string; hours: number }
  | { cmd: 'pin'; req: PinRequest }
  | { cmd: 'unpin'; id: number }
  | { cmd: 'wlm'; edit: WlmEdit }
  | { cmd: 'activate' }
  | { cmd: 'discard' }
  | { cmd: 'buy'; toolId: string }
  | { cmd: 'tfp'; accept: boolean }
  | { cmd: 'report'; kind: ReportKind; index?: number; scKey?: string; system?: string }
  | { cmd: 'smf'; kind: SmfKind; hour?: string }
  | { cmd: 'rcadvice'; workloadId?: string | null }
  /** The agent's reasoning, logged in the run file (spectator banner); changes nothing in the run. */
  | { cmd: 'note'; text: string };

export interface PlayFile {
  version: 1;
  run: RunState;
  pendingPolicy: ServiceDefinition | null;
  log: PlayCommand[];
}

export interface PlayResult {
  file: PlayFile;
  ok: boolean;
  text: string;
}

const sc = (run: RunState) => scenarioFor(packOf(run.scenarioId).scenario, run.difficulty);

/** Real RMF report names an agent may reach for. */
const REPORT_ALIASES: Record<string, ReportKind> = { WLMGL: 'WLM_SUMMARY', WORKLOAD: 'WLM_SUMMARY', CPU: 'PARTITION', CFACT: 'CF', CF_ACTIVITY: 'CF', DEVICE: 'DASD' };

/** Name the tool to buy, not the internal feature it unlocks. */
function needs(feature: ToolFeature, what: string): string {
  const tools = TOOLS.filter((t) => t.unlocks.includes(feature)).map((t) => t.id);
  return `${what} needs the ${tools.join(' or ') || feature} tool (buy ${tools[0] ?? feature}; see catalog).`;
}

export const encodePlayFile = (f: PlayFile): string => encodeRunJson(f);
export const decodePlayFile = (text: string): PlayFile => decodeRunJson<PlayFile>(text);

export function newPlayFile(seed: number, difficulty: DifficultyId = 'NORMAL', scenario = 'midwest'): PlayFile {
  const pack = packOf(scenario);
  return { version: 1, run: newRun(pack.scenario, pack.game, seed, difficulty), pendingPolicy: null, log: [{ cmd: 'new', seed, difficulty, ...(scenario !== 'midwest' ? { scenario } : {}) }] };
}

export function applyPlayCommand(file: PlayFile, c: PlayCommand): PlayResult {
  const out = apply(file, c);
  return out.ok ? { ...out, file: { ...out.file, log: [...file.log, c] } } : out;
}

function apply(file: PlayFile, c: PlayCommand): PlayResult {
  const run = file.run;
  const content = packOf(run.scenarioId).game;
  const done = (r: RunState, text: string, ok = true, pendingPolicy = file.pendingPolicy): PlayResult => ({ file: { ...file, run: r, pendingPolicy }, ok, text });
  const fail = (text: string): PlayResult => ({ file, ok: false, text });
  switch (c.cmd) {
    case 'new':
      return { file: newPlayFile(c.seed, c.difficulty, c.scenario), ok: true, text: `New run, seed ${c.seed}${c.scenario ? `, ${packOf(c.scenario).name}` : ''}` };
    case 'start': {
      if (run.phase !== 'BRIEFING') return fail(`Cannot start a day in phase ${run.phase}`);
      return done(startDay(run, content), 'Day started (06:00).');
    }
    case 'note':
      return c.text.trim() ? done(run, 'Noted.') : fail('Empty note');
    case 'advance': {
      if (run.phase !== 'LIVE') return fail(`Nothing to advance in phase ${run.phase}; use start.`);
      const hours = Math.max(1, Math.min(24, Math.floor(c.hours)));
      let r = run;
      for (let h = 0; h < hours && r.phase === 'LIVE'; h++) r = advance(r, sc(r), content, TICKS_PER_HOUR);
      return done(r, r.phase === 'LIVE' ? `Advanced to ${buildView(r, sc(r)).clock}.` : `Day over: ${r.phase}.`);
    }
    case 'change': {
      const o = requestChange(run, content, c.req);
      return done(o.run, o.message, o.ok);
    }
    case 'draft': {
      if (run.phase !== 'REVIEW') return fail('Drafts are chosen in the end-of-day review.');
      return done(chooseDraft(run, content, c.optionId), c.optionId ? `Drafted ${c.optionId}.` : 'Draft skipped.');
    }
    case 'rca': {
      if (!MECHANISMS.includes(c.mechanism) || !TRIGGERS.includes(c.trigger)) return fail(`Mechanism one of ${MECHANISMS.join(' ')}; trigger one of ${TRIGGERS.join(' ')}`);
      const inc = run.incidents.find((i) => i.id === c.incidentId);
      if (!inc) return fail(`No incident ${c.incidentId}`);
      if (inc.rca) return fail(`Incident ${c.incidentId} already has an RCA`);
      const missing = (c.evidenceIds ?? []).filter((id) => !run.pins.some((p) => p.id === id));
      if (missing.length) return fail(`No pinned evidence ${missing.join(' ')}`);
      const r = submitRca(run, c.incidentId, c.mechanism, c.trigger, sc(run), c.evidenceIds ?? []);
      const rca = r.incidents.find((i) => i.id === c.incidentId)?.rca;
      return done(r, `RCA filed for incident ${c.incidentId}: ${rca?.points ?? 0} points${rca?.evidencePoints ? ` (${rca.evidencePoints} from evidence)` : ''}.`);
    }
    case 'ask': {
      const o = askAround(run, c.topic, c.workloadId ?? null, sc(run));
      return done(o.run, o.message, o.ok);
    }
    case 'project': {
      const o = workOnProject(run, c.id, c.hours);
      return done(o.run, o.message, o.ok);
    }
    case 'pin': {
      const o = addPin(run, sc(run), c.req);
      return done(o.run, o.message, o.ok);
    }
    case 'unpin': {
      if (!run.pins.some((p) => p.id === c.id)) return fail(`No pin ${c.id}`);
      return done(removePin(run, c.id), `Unpinned ${c.id}.`);
    }
    case 'wlm': {
      const res = applyWlmEdit(pendingBase(file.pendingPolicy, run.sim.wlm.definition), c.edit);
      if (typeof res === 'string') return fail(res);
      return done(run, `Pending policy ${res.policyName} updated. activate to install it.`, true, res);
    }
    case 'activate': {
      const def = file.pendingPolicy;
      if (!def) return fail('No pending policy edits');
      const o = requestChange(run, content, { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
      return done(o.run, o.message, o.ok, o.ok ? null : def);
    }
    case 'discard':
      return done(run, 'Pending policy discarded', true, null);
    case 'buy': {
      const o = buyTool(run, sc(run), c.toolId);
      return done(o.run, o.message, o.ok);
    }
    case 'tfp': {
      const o = decideTfp(run, c.accept);
      return done(o.run, o.message, o.ok);
    }
    case 'report': {
      const kind = REPORT_ALIASES[c.kind.toUpperCase()] ?? (c.kind.toUpperCase() as ReportKind);
      if (!REPORT_KINDS.includes(kind)) return fail(`Report kinds: ${REPORT_KINDS.join(' ')} (WLMGL = WLM_SUMMARY)`);
      const ivs = run.sim.rmf.intervals;
      const index = c.index ?? ivs.length - 1;
      const iv = ivs[index];
      if (!iv) return fail(ivs.length ? `RMF intervals 0..${ivs.length - 1}` : 'No RMF intervals yet (they cover intervals that ended before the day started).');
      const need = REPORT_FEATURE[kind];
      if (need && !hasFeature(run, need)) return fail(needs(need, 'This report'));
      const rcs = [...new Set((iv.wlmRc ?? []).map((r) => r.scKey))].sort();
      const rcLine = rcs.length
        ? `\nReport classes in this interval: ${rcs.join(' ')} (report WLM_DETAIL ${index} <name>)`
        : '\nNo report classes defined: workloads that share a service class are not shown separately. Add report classes with rcadvice (RC_ADVISOR tool) or a wlm SET_RULE_TARGET edit.';
      const text = renderReport(iv, kind, c.scKey, c.system) + (kind === 'WLM_SUMMARY' || kind === 'WLM_DETAIL' ? rcLine : '');
      return done(noteReportOpened(run, `${kind}:${index}`), text);
    }
    case 'rcadvice': {
      if (!hasFeature(run, 'REPORT_CLASS_ADVISOR')) return fail(needs('REPORT_CLASS_ADVISOR', 'Report class advice'));
      const res = applyReportClassAdvice(pendingBase(file.pendingPolicy, run.sim.wlm.definition), runWorkItems(sc(run), run), c.workloadId || null);
      if (typeof res === 'string') return fail(res);
      if (!res.added.length) return fail('No report class advice left.');
      return done(run, `Report classes for ${res.added.join(' ')} staged in ${res.def.policyName}. activate to install (takes effect next day).`, true, res.def);
    }
    case 'smf': {
      const need = SMF_FEATURE[c.kind];
      if (!need) return fail(`SMF kinds: ${Object.keys(SMF_FEATURE).join(' ')}`);
      if (!hasFeature(run, need)) return fail(needs(need, 'This SMF view'));
      const hours = smfHourRefs(run);
      const hour = c.hour ?? hours[0]?.key;
      const rows =
        c.kind === 'DB2' ? (hour ? db2Accounting(run, sc(run), hour) : [])
        : c.kind === 'CICS' ? (hour ? cicsMonitoring(run, sc(run), hour) : [])
        : c.kind === 'BATCH' ? batchNight(run)
        : smf113(run);
      const head = c.kind === 'DB2' || c.kind === 'CICS' ? `hour ${hour ?? 'none'} (hours: ${hours.map((h) => h.key).join(' ')})\n` : '';
      const body = Array.isArray(rows) ? rows.map((r) => JSON.stringify(r)).join('\n') : JSON.stringify(rows, null, 1);
      const r = c.kind === 'DB2' || c.kind === 'CICS' ? noteReportOpened(run, `SMF:${c.kind}:${hour}`) : run;
      return done(r, head + (body || 'no data'));
    }
  }
}

/** What the player can see: the same fields the browser shows, never the incident ground truth. */
export function statusText(file: PlayFile): string {
  const run = file.run;
  const v = buildView(run, sc(run));
  const out: string[] = [];
  out.push(`${v.phase}  day ${v.day + 1}/${v.maxDays} ${v.weekday}  ${v.clock}  difficulty ${v.difficulty.name}  seed ${v.seed}`);
  out.push(`trust ${v.trustOverall.toFixed(1)} (${Object.keys(v.trust).map((f) => `${f} ${v.trust[f]!.toFixed(0)}`).join(', ')})  score ${v.score}`);
  out.push(`engineer-hours left ${v.hoursLeft}  insight ${v.insight}  capex $${Math.round(v.capexRemaining).toLocaleString()}  MLC month est $${Math.round(v.mlcEstimate).toLocaleString()} / opex budget $${Math.round(v.opexBudget).toLocaleString()}`);
  out.push(`policy ${v.policyName}${file.pendingPolicy ? `  (pending edits: ${file.pendingPolicy.policyName})` : ''}  tools ${v.tools.filter((t) => t.owned).map((t) => (t.trialLastDay !== null ? `${t.id}(trial to day ${t.trialLastDay + 1})` : t.id)).join(' ') || 'none'}`);
  out.push(`CPC busy ${v.cpcBusyPct.toFixed(0)}%  ` + v.lpars.map((l) => `${l.id} ${l.cpBusyPct.toFixed(0)}%`).join('  '));
  if (v.phase === 'LIVE') {
    const hot = v.piHeat.filter((p) => p.pi !== null && p.pi > 1).map((p) => `${p.scKey} ${p.pi!.toFixed(2)}`);
    out.push(`PI > 1: ${hot.join('  ') || 'none'}`);
    out.push('SLA this hour: ' + v.sla.filter((s) => s.hourPct !== null).map((s) => `${s.workloadId} ${s.hourPct!.toFixed(1)}%${s.met === false ? '!' : ''}`).join('  '));
  }
  if (v.lastReport) {
    const r = v.lastReport;
    out.push(`last report card (day ${r.day + 1}): score ${r.score}${r.batchMissed ? ', batch window MISSED' : ''}; events: ${r.events.join(', ') || 'none'}`);
    out.push('  ' + r.sla.map((s) => `${s.workloadId} ${s.attainmentPct.toFixed(1)}%`).join('  '));
  }
  const today = v.inbox.filter((m) => m.day >= v.day - 1);
  if (today.length) {
    out.push('inbox:');
    for (const m of today) out.push(`  [day ${m.day + 1}] ${m.from}: ${m.subject}\n    ${m.body.replace(/\n/g, '\n    ')}`);
  }
  const open = v.incidents.filter((i) => !i.rca);
  if (open.length) out.push('incidents without RCA: ' + open.map((i) => `#${i.id} ${i.workloadId} day ${i.day + 1} from ${formatClock(i.startTick)} (RMF interval ${intervalAt(run, i.startTick)}) ${i.hours}h worst ${i.worstAttainmentPct.toFixed(1)}%`).join('; '));
  if (run.pins.length) out.push('pinned evidence (rca ... --evidence ids):\n' + run.pins.map((p) => `  ${p.id}: ${p.text}`).join('\n'));
  const asks = inquiriesView(run, sc(run)).pending;
  if (asks.length) out.push('waiting for replies: ' + asks.map((p) => `${p.who}: ${p.question}${p.workloadId ? ` (${p.workloadId})` : ''}`).join('; '));
  const planned = v.changes.filter((c) => c.status === 'PLANNED');
  if (planned.length) out.push('planned changes: ' + planned.map((c) => `#${c.id} ${c.label} (day ${c.activateDay + 1})`).join('; '));
  if (v.draft) out.push('draft options: ' + v.draft.map((d) => `${d.id}: ${d.title}. ${d.description}`).join('\n  '));
  if (v.reports.length) out.push(`RMF intervals: 0..${v.reports.length - 1} (latest ${v.reports.at(-1)!.label})`);
  if (v.endReason) out.push(`END: ${v.endReason}`);
  out.push(`next: ${v.phase === 'BRIEFING' ? 'plan changes, then start' : v.phase === 'LIVE' ? 'advance <hours>' : v.phase === 'REVIEW' ? 'file RCAs, read reports, then draft <id|none> to close the day' : 'run over'}`);
  return out.join('\n');
}

/** Monitor III (tool MON3): the last range's delay rows, CPC view and exceptions, one JSON object per line. */
export function mon3Text(file: PlayFile): string {
  const m = buildView(file.run, sc(file.run)).mon3;
  if (!m) return 'Monitor III needs the MON3 tool.';
  return [`Monitor III, last ${m.rangeSec}s. CPC logical:physical CP ratio ${m.logicalToPhysical.toFixed(2)}. Lines: systems (SYSINFO), CPC (per LPAR), delay rows per service class period (DELAY/PROCU, % of samples), enclaves, exceptions (WFEX).`, ...m.systems.map((x) => JSON.stringify(x)), ...m.cpc.map((x) => JSON.stringify(x)),
    ...m.rows.map((x) => JSON.stringify(x)), ...m.enclaves.map((x) => JSON.stringify(x)), ...m.exceptions.map((x) => 'EXCEPTION ' + JSON.stringify(x))].join('\n');
}

/** What can be ordered or fixed: the Change Desk catalog, the tool tree and the RCA vocabulary. */
export function catalogText(file: PlayFile): string {
  const v = buildView(file.run, sc(file.run));
  const out = ['hardware (change {"label":..,"hardwareId":ID}):'];
  for (const h of HARDWARE) out.push(`  ${h.id}: ${h.name}. capex $${h.capex.toLocaleString()}, opex $${h.opexPerDay.toLocaleString()}/day, lead ${h.leadDays}d${h.durationDays ? `, lasts ${h.durationDays}d` : ''}. ${h.description}`);
  out.push('fixes (change {"label":..,"fixId":ID}):');
  for (const f of FIXES) out.push(`  ${f.id}: ${f.name}. ${f.hours}h${f.trustCost ? `, ${f.trustCost.facet} trust -${f.trustCost.amount}` : ''}. ${f.description}`);
  out.push(`tools (buy ID; insight ${v.insight}):`);
  for (const t of v.tools) out.push(`  ${t.id}${t.trialLastDay !== null ? ` [free trial to end of day ${t.trialLastDay + 1}; buy to keep]` : t.owned ? ' [owned]' : ''}${t.comingSoon ? ' [coming soon]' : ''}: ${t.name}, tier ${t.tier}, ${t.insightCost} insight${t.prereqs.length ? `, needs ${t.prereqs.join('+')}` : ''}. ${t.reveals}`);
  out.push(`RCA mechanisms: ${MECHANISMS.join(' ')}`, `RCA triggers: ${TRIGGERS.join(' ')}`);
  const iq = inquiriesView(file.run, sc(file.run));
  out.push(`ask around (ask TOPIC [workloadId]; replies arrive in the inbox hours later; at most ${iq.maxOpen} open):`);
  for (const t of iq.topics) out.push(`  ${t.id}: ${t.contact}, ${t.hours}h. ${t.question}${t.perWorkload ? ' Needs a workload id.' : ''}`);
  out.push(`  workloads: ${iq.apps.map((a) => a.id).join(' ')}`);
  out.push('projects (project ID hours; engineer-hours spread over days):');
  for (const p of projectsView(file.run)) out.push(`  ${p.id}${p.done ? ' [done]' : ''}: ${p.name}, ${p.hoursDone}/${p.hours}h, max ${p.maxHoursPerDay}h/day. ${p.description}`);
  out.push('evidence pins (pin SOURCE ...; then rca INC MECH TRIG --evidence 1,2): sources WLMGL <interval> <system> <scKey> <metric> | MON3 <system> <scKey> <metric> | CPC <lparId> PRSM_DELAY|CAPPED | DB2|CICS <hour> <workloadId> <metric>');
  out.push(`  metrics: ${Object.keys(EVIDENCE_METRICS).join(' ')}`);
  out.push('Config/WLM commands for change {"label":..,"commands":[...]}: see the Command type in src/sim/core/commands.ts; WLM edits: WlmEdit in src/game/wlmEdit.ts');
  return out.join('\n');
}

/** The RMF interval (index) whose span contains this tick; intervals end on the half hour. */
function intervalAt(run: RunState, tick: number): number | string {
  const i = run.sim.rmf.intervals.findIndex((iv) => iv.endTick > tick);
  return i >= 0 ? i : 'not yet closed';
}
