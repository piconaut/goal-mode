// Headless play interface for agents (PROGRESS M8.9): a run file plus commands, no hidden ground truth.
// The run file holds the serialised RunState (as the browser saves it), the pending WLM policy and the
// command log, so seed + log replays the same run.

import { PACKS, packOf } from '../src/content/packs';
import type { DifficultyId } from '../src/content/difficulty';
import { scenarioFor } from '../src/game/difficulty';
import { activateSavedPolicy, cancelChange, chooseDraft, deactivateCod, failedPolicyToday, newRun, policyFailuresWithLaterToday, requestChange, startDay, submitRca, type ChangeRequest } from '../src/game/run';
import { advanceHours } from '../src/game/advance';
import type { Mechanism, RunState, Trigger } from '../src/game/types';
import { buyTool, hasFeature, noteReportOpened, REPORT_FEATURE, SMF_FEATURE } from '../src/game/tools';
import { batchNight, cicsMonitoring, db2Accounting, smf113, smfHourRefs } from '../src/game/smf';
import { financeView } from '../src/game/finance';
import { budgetDelta, BUDGET_MONTH_BOUNDARY_NOTE, R4HA_BILLING_NOTE } from '../src/game/budget';
import { monthElapsedFrac } from '../src/sim/cost/mlc';
import { msuPerCp } from '../src/sim/hw/cpc';
import { FIXES } from '../src/game/catalog';
import { HARDWARE } from '../src/content/hardware-catalog';
import { MON3_HISTORY, TOOLS, type ToolFeature } from '../src/content/tools';
import { applyReportClassAdvice } from '../src/game/rcAdvisor';
import { clockAt, hhmm, pad2, tickOfClock } from '../src/sim/core/clock';
import { allWorkloads, runWorkItems } from '../src/game/workloads';
import { decideTfp } from '../src/game/tfp';
import { SAVE_VERSION, assertSaveVersion, decodeRunFileText, encodeRunJson } from '../src/game/runFile';
import { idText } from '../src/game/ids';
import { askAround, inquiriesView } from '../src/game/inquiries';
import { projectsView, workOnProject } from '../src/game/projects';
import { addPin, removePin, type PinRequest } from '../src/game/evidence';
import { EVIDENCE, EVIDENCE_METRICS } from '../src/content/evidence';
import { proofLines } from '../src/game/proof';
import { HINT_SENDER } from '../src/content/hints';
import type { InquiryKind } from '../src/content/inquiries';
import { applyWlmEdit, pendingBase, playerWlmEditError, type WlmEdit } from '../src/game/wlmEdit';
import { plannedPolicy, policyEditSource, savedPolicy } from '../src/game/policies';
import { buildView } from '../src/game/view';
import { hourAttainment, MECHANISMS, TRIGGERS } from '../src/game/sla';
import { alsoAcceptedOf, groupAcceptedOf, rcaGroupOf } from '../src/game/run/rca';
import { TRIGGER_LABEL, triggerLabel } from '../src/content/rca';
import type { ClassificationRule, ServiceDefinition } from '../src/sim/wlm/types';
import { goalText } from '../src/sim/wlm/goals';
import { renderReport, REPORT_KINDS, type ReportKind } from '../src/sim/measure/reports';
import { TICK_SEC } from '../src/sim/core/units';
import { buildMon3, type Mon3Cpc, type Mon3CpcPhysical, type Mon3Row } from '../src/game/mon3';
import { emptyMon3PinHistory, mon3PinRange, mon3PinsAt, recordMon3Pins, type Mon3PinHistory } from '../src/game/mon3PinHistory';
import type { SmfKind } from '../src/worker/protocol';


export type PlayCommand =
  | { cmd: 'new'; seed: number; difficulty?: DifficultyId; scenario?: string }
  | { cmd: 'start' }
  | { cmd: 'advance'; hours: number }
  | { cmd: 'change'; req: ChangeRequest }
  /** Withdraw a planned change (ids in status); capex back, hours back on the day they were spent. */
  | { cmd: 'cancel'; changeId: number }
  /** End an active On/Off CoD lease at 06:00 tomorrow. */
  | { cmd: 'cod-deactivate'; changeId: number }
  | { cmd: 'draft'; optionId: string | null }
  | { cmd: 'rca'; incidentId: number; mechanism: Mechanism; trigger: Trigger; evidenceIds?: number[] }
  | { cmd: 'ask'; topic: InquiryKind; workloadId?: string | null }
  | { cmd: 'project'; id: string; hours: number }
  | { cmd: 'restart'; name: string }
  /** intervalId (WLMGL): the stable interval id the CLI shows; it replaces req.index. */
  /** at (MON3, CPC without an interval): a past time as `clockText` prints it (`D2 10:40`); it sets req.tick. */
  | { cmd: 'pin'; req: PinRequest; intervalId?: number; at?: string }
  | { cmd: 'unpin'; id: number }
  | { cmd: 'wlm'; edit: WlmEdit }
  | { cmd: 'activate' }
  /** Activate a saved policy by name (ordinary activation; emergency when the day is live). */
  | { cmd: 'policy-activate'; name: string }
  /** Load a saved policy into the pending editor without installing it. */
  | { cmd: 'policy-load'; name: string }
  | { cmd: 'discard' }
  | { cmd: 'buy'; toolId: string }
  | { cmd: 'tfp'; accept: boolean }
  /** index is the array position (older logs); id is the stable interval id the CLI shows. */
  | { cmd: 'report'; kind: ReportKind; index?: number; id?: number; scKey?: string; system?: string }
  /** hour: a key from the hour list, `current`, `D8 12` / `8:12` (played day 8, 12:00) or a bare hour (`12`, newest). */
  | { cmd: 'smf'; kind: SmfKind; hour?: string; json?: boolean }
  | { cmd: 'rcadvice'; workloadId?: string | null }
  /** The agent's reasoning, logged in the run file (spectator banner); changes nothing in the run. */
  | { cmd: 'note'; text: string };

export interface PlayFile {
  /** `SAVE_VERSION` (src/game/runFile.ts): a play file of another version is refused at load. */
  version: typeof SAVE_VERSION;
  run: RunState;
  pendingPolicy: ServiceDefinition | null;
  log: PlayCommand[];
  /** Monitor III history for pins (play.ts keeps it in a file beside the run file, not in it). */
  mon3?: Mon3PinHistory;
}

export interface PlayResult {
  file: PlayFile;
  ok: boolean;
  text: string;
}

const sc = (run: RunState) => scenarioFor(packOf(run.scenarioId).scenario, run.difficulty);

/** The view's key for an abended job. One definition, so the CLI's before/after comparison cannot drift from the
 *  helper that builds the replays' set. */
export const abendedKey = (a: { day: number; name: string }): string => `${a.day}:${a.name}`;

/** Jobs abended at this moment, as the view reports them. The CLI's advance stop rule and the inspect replays share
 *  this, so a change to the view's list cannot desynchronise a replay from the CLI. */
export const abendedJobs = (run: RunState) => buildView(run, sc(run)).batch.abended;
export const abendedSet = (run: RunState): Set<string> => new Set(abendedJobs(run).map(abendedKey));

/** Real RMF report names an agent may reach for. */
const REPORT_ALIASES: Record<string, ReportKind> = { WLMGL: 'WLM_SUMMARY', WORKLOAD: 'WLM_SUMMARY', CPU: 'PARTITION', CFACT: 'CF', CF_ACTIVITY: 'CF', DEVICE: 'DASD' };

/** Name the tool to buy, not the internal feature it unlocks. */
function needs(feature: ToolFeature, what: string): string {
  const tools = TOOLS.filter((t) => t.unlocks.includes(feature)).map((t) => t.id);
  return `${what} needs the ${tools.join(' or ') || feature} tool (buy ${tools[0] ?? feature}; see catalog).`;
}

export const encodePlayFile = (f: PlayFile): string => encodeRunJson(f);
export const decodePlayFile = (text: string): PlayFile => {
  const f = decodeRunFileText<PlayFile>(text);
  assertSaveVersion(f);
  return f;
};

/** Load a play file as the CLI does: the current save version, decoded and checked. */
export const openPlayFile = (text: string): PlayFile => decodePlayFile(text);

export function newPlayFile(seed: number, difficulty: DifficultyId = 'NORMAL', scenario = 'midwest'): PlayFile {
  const pack = packOf(scenario);
  return { version: SAVE_VERSION, run: newRun(pack.scenario, pack.game, seed, difficulty), pendingPolicy: null, log: [{ cmd: 'new', seed, difficulty, ...(scenario !== 'midwest' ? { scenario } : {}) }] };
}

export function applyPlayCommand(file: PlayFile, c: PlayCommand): PlayResult {
  const out = apply(file, c);
  return out.ok ? { ...out, file: { ...out.file, log: [...file.log, c] } } : out;
}

function apply(file: PlayFile, c: PlayCommand): PlayResult {
  if (c.cmd === 'new' && c.scenario && !PACKS[c.scenario]) return { file, ok: false, text: `Unknown scenario ${c.scenario}; one of ${Object.keys(PACKS).join(' ')}` };
  if (c.cmd === 'new') return { file: newPlayFile(c.seed, c.difficulty, c.scenario), ok: true, text: `New run, seed ${c.seed}${c.scenario ? `, ${packOf(c.scenario).name}` : ''}` };
  const run = file.run;
  const content = packOf(run.scenarioId).game;
  const done = (r: RunState, text: string, ok = true, pendingPolicy = file.pendingPolicy): PlayResult => ({ file: { ...file, run: r, pendingPolicy }, ok, text });
  const fail = (text: string): PlayResult => ({ file, ok: false, text });
  switch (c.cmd) {
    case 'start': {
      if (run.phase !== 'BRIEFING') return fail(`Cannot start a day in phase ${run.phase}`);
      const started = startDay(run, content);
      const failed = file.pendingPolicy ? null : failedPolicyToday(started);
      const later = failed ? [] : policyFailuresWithLaterToday(started);
      const live = later.find((x) => x.editsLive);
      const note = failed
        ? ' Policy activation failed; its edits are pending again (activate to reschedule).'
        : live
          ? ` Policy activation failed earlier, but later activation ${live.laterName} went live with its edits.`
          : later.length > 0
            ? ` Policy activation failed earlier; later activation ${later[0]!.laterName} also went live, but without this request's edits; they are not pending again (make them again and activate).`
            : '';
      return done(started, `Day started (06:00).${note}`, true, failed ?? file.pendingPolicy);
    }
    case 'note':
      return c.text.trim() ? done(run, 'Noted.') : fail('Empty note');
    case 'advance': {
      if (run.phase !== 'LIVE') return fail(`Nothing to advance in phase ${run.phase}; use start.`);
      const hours = Math.max(1, Math.min(24, Math.floor(c.hours)));
      let mon3 = file.mon3;
      const before = abendedSet(run);
      let fresh: string[] = [];
      // One MINTIME hook records a Monitor III range, as the browser's worker does; the other stops
      // at the hour a job abends, as an operator would be paged.
      const r = advanceHours(run, content, hours, {
        onMintime: hasFeature(run, 'MON3') ? (x) => {
          mon3 = recordMon3Pins(mon3 ?? emptyMon3PinHistory(), x.sim.tick, buildMon3(x, sc(x)));
        } : undefined,
        stopWhen: (x) => {
          fresh = abendedJobs(x).filter((a) => !before.has(abendedKey(a))).map((a) => a.name);
          return fresh.length > 0;
        },
      });
      const mail = r.inbox.slice(run.inbox.length).map((m) => `\n  mail: ${m.from}: ${m.subject}`).join('');
      const page = fresh.length ? `\nSTOPPED: ${fresh.join(' ')} ABENDED. restart ${fresh[0]} (0.5h) or let it miss the window.` : '';
      const d = done(r, `${r.phase === 'LIVE' ? `Advanced to ${buildView(r, sc(r)).clock}.` : `Day over: ${r.phase}.`}${mail}${page}`);
      return mon3 ? { ...d, file: { ...d.file, mon3 } } : d;
    }
    case 'change': {
      const o = requestChange(run, content, c.req);
      return done(o.run, o.message, o.ok);
    }
    case 'restart': {
      const a = buildView(run, sc(run)).batch.abended.find((x) => x.name === c.name.toUpperCase());
      if (!a) return fail(`${c.name} is not abended now. Abended jobs: ${buildView(run, sc(run)).batch.abended.map((x) => x.name).join(' ') || 'none'} (a job can be restarted only during its batch night).`);
      const o = requestChange(run, content, { label: `Restart ${a.name}`, commands: [{ kind: 'RESTART_JOB', day: a.day, name: a.name }] });
      return done(o.run, o.message, o.ok);
    }
    case 'cod-deactivate': {
      const o = deactivateCod(run, c.changeId);
      return done(o.run, o.message, o.ok);
    }
    case 'cancel': {
      const o = cancelChange(run, c.changeId);
      if (o.restoredPolicy && !file.pendingPolicy) return done(o.run, `${o.message} Activate to reschedule.`, o.ok, o.restoredPolicy);
      return done(o.run, o.message, o.ok);
    }
    case 'draft': {
      if (run.phase !== 'REVIEW') return fail('Drafts are chosen in the end-of-day review.');
      return done(chooseDraft(run, content, c.optionId), c.optionId ? `Drafted ${c.optionId}.` : 'Draft skipped.');
    }
    case 'rca': {
      const cTrigger = c.trigger;
      if (!MECHANISMS.includes(c.mechanism) || !TRIGGERS.includes(cTrigger)) return fail(`Mechanism one of ${MECHANISMS.join(' ')}; trigger one of ${TRIGGERS.join(' ')}`);
      const inc = run.incidents.find((i) => i.id === c.incidentId);
      if (!inc) return fail(`No incident ${idText('incident', c.incidentId)}`);
      if (inc.rca) return fail(`Incident ${idText('incident', c.incidentId)} already has an RCA`);
      const missing = (c.evidenceIds ?? []).filter((id) => !run.pins.some((p) => p.id === id));
      if (missing.length && !run.pins.length) return fail('No pins yet. Pin report rows first (e.g. pin WLMGL <interval id> *PLEX ONLHI#1 PI; see catalog), or file the RCA without --evidence.');
      if (missing.length) return fail(`No pinned evidence ${missing.map((id) => idText('pin', id)).join(' ')}; pins: ${run.pins.map((p) => idText('pin', p.id)).join(' ')}`);
      const r = submitRca(run, c.incidentId, c.mechanism, cTrigger, sc(run), c.evidenceIds ?? []);
      // One RCA covers the group: its primary is the lead's and its accepted answers are the union of the members'
      // (RT-15, docs/rca-design.md §4.5).
      const group = rcaGroupOf(r.incidents, c.incidentId);
      const covered = group.filter((i) => i.id !== c.incidentId && i.rca).map((i) => `${idText('incident', i.id)} ${i.workloadId}`);
      const rca = r.incidents.find((i) => i.id === c.incidentId)?.rca;
      const t = group[0]!.truth;
      const accepted = groupAcceptedOf(group);
      const pts = rca?.points ?? 0;
      const trustNote = pts >= 3 ? 'trust +1 on every facet' : pts > 0 ? 'trust +0.25 on every facet' : 'trust -0.5 on every facet';
      // An accepted alternate is a right answer, so the reply must say so and give its reason (RT-07).
      // Answers are shown with the trigger's display name; the ids stay what a command types (RT-09).
      const also = alsoAcceptedOf(group).map(({ answer, why }) => `${TRIGGER_LABEL[answer as Trigger] ?? answer}${why ? ` (${why})` : ''}`);
      return done(r, `RCA filed for incident ${idText('incident', c.incidentId)}: ${pts} points${rca?.evidencePoints ? ` (${rca.evidencePoints} from evidence)` : ''}. Mechanism ${accepted.mechanisms.includes(c.mechanism) ? 'right' : 'wrong'}, trigger ${accepted.triggers.includes(cTrigger) ? 'right' : 'wrong'} (primary ${t.mechanism}/${triggerLabel(t.trigger)})${also.length ? `; also accepted: ${also.join('; ')}` : ''}; ${trustNote}.${rca?.explain ? ` ${rca.explain}` : ''}${covered.length ? ` Also covers the same-cause incidents ${covered.join(', ')}.` : ''}${rca?.strong ? ` Strong evidence: +${EVIDENCE.strongInsight} Insight.` : ''}${rca?.proof ? `\n${proofLines(rca.proof, (id) => idText('pin', id)).join('\n')}` : ''}`);
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
      let req = c.req;
      // Same gate as the view the browser pins from.
      const view = req.source === 'DB2' || req.source === 'CICS' || req.source === 'BATCH' ? SMF_FEATURE[req.source] : undefined;
      if (view && !hasFeature(run, view)) return fail(needs(view, `A ${req.source} pin`));
      if (req.source === 'WLMGL') {
        const index = c.intervalId !== undefined ? intervalIndex(run, c.intervalId) : req.index;
        const iv = buildView(run, sc(run)).reports.some((x) => x.index === index) ? run.sim.rmf.intervals[index] : undefined;
        if (!iv) return fail(`No RMF interval ${c.intervalId ?? req.index}; ${intervalList(run)}`);
        const w = { ...req, index, scKey: resolveKey(req.scKey, iv.wlm.map((x) => x.scKey)) };
        if (!iv.wlm.some((x) => x.lparId === w.system && x.scKey === w.scKey)) return fail(`No WLMGL row ${w.system} ${w.scKey} in interval ${intervalId(iv)}; ${rowKeys(iv, w.system)}`);
        req = w;
      }
      if (req.source === 'CPC' && c.intervalId !== undefined) {
        const index = intervalIndex(run, c.intervalId);
        if (!buildView(run, sc(run)).reports.some((x) => x.index === index)) return fail(`No RMF interval ${c.intervalId}; ${intervalList(run)}`);
        req = { ...req, index };
      }
      if (req.source === 'DB2' || req.source === 'CICS' || req.source === 'CICS_STORAGE') {
        const hour = smfHourKey(run, req.hour);
        if (hour === null) return fail(`No SMF hour ${req.hour}; hours as \`smf ${req.source === 'CICS_STORAGE' ? 'CICS' : req.source}\` lists them (\`10\` = newest 10:00, \`D3 10\` = day 3)`);
        req = { ...req, hour };
      }
      if (c.at !== undefined) {
        if (req.source !== 'MON3' && req.source !== 'PROCU' && !(req.source === 'CPC' && req.index === undefined)) return fail('--at takes a Monitor III time (pin MON3, pin PROCU, or pin CPC without an interval id)');
        const tick = tickOfClock(c.at);
        if (tick === null) return fail(`No time ${c.at}; write it as clockText does, e.g. D2 10:40 (D1 = first played day, 06:00 to 06:00)`);
        if (tick > run.sim.tick) return fail(`${c.at} is in the future; it is ${clockText(run.sim.tick)}`);
        const at = file.mon3 ? mon3PinsAt(file.mon3, tick) : null;
        if (!at) return fail(`No Monitor III history at ${c.at}; ${mon3RangeText(file)}`);
        req = { ...req, tick };
      }
      const history = (t: number) => (file.mon3 ? mon3PinsAt(file.mon3, t) : null);
      if (req.source === 'MON3') {
        const keys = (req.tick !== undefined ? history(req.tick)?.view.rows : buildView(run, sc(run)).mon3?.rows)?.map((x) => x.scKey) ?? [];
        req = { ...req, scKey: resolveKey(req.scKey, keys) };
      }
      const o = addPin(run, sc(run), req, history);
      return done(o.run, o.message, o.ok);
    }
    case 'unpin': {
      if (!run.pins.some((p) => p.id === c.id)) return fail(`No pin ${idText('pin', c.id)}`);
      return done(removePin(run, c.id), `Unpinned ${idText('pin', c.id)}.`);
    }
    case 'wlm': {
      const res = playerWlmEditError(c.edit) ?? applyWlmEdit(pendingBase(file.pendingPolicy, policyEditSource(run)), c.edit);
      if (typeof res === 'string') return fail(res);
      return done(run, `Pending policy ${res.policyName} updated. ${run.phase === 'REVIEW' ? "close the day (draft <id|none>), then activate at tomorrow's briefing to install it." : 'activate to install it.'}`, true, res);
    }
    case 'activate': {
      const def = file.pendingPolicy;
      if (!def) return fail('No pending policy edits');
      const o = requestChange(run, content, { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
      return done(o.run, o.message, o.ok, o.ok ? null : def);
    }
    case 'policy-load': {
      const name = c.name.trim().toUpperCase();
      const def = savedPolicy(run, name);
      if (!def) return fail(`No saved policy ${name || '(none)'}`);
      return done(run, `Loaded ${def.policyName} into the editor`, true, structuredClone(def));
    }
    case 'policy-activate': {
      const name = c.name.trim().toUpperCase();
      const o = activateSavedPolicy(run, content, name);
      return done(o.run, o.message, o.ok, o.ok ? null : file.pendingPolicy);
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
      const visible = buildView(run, sc(run)).reports;
      const index = c.id !== undefined ? intervalIndex(run, c.id) : c.index ?? visible.at(-1)?.index ?? -1;
      const iv = visible.some((x) => x.index === index) ? ivs[index] : undefined;
      if (!iv) return fail(visible.length ? `No RMF interval ${c.id ?? c.index}; ${intervalList(run)}` : 'No RMF intervals yet: without Monitor III, the Postprocessor shows intervals that ended before the day started.');
      const id = intervalId(iv);
      const need = REPORT_FEATURE[kind];
      if (need && !hasFeature(run, need)) return fail(needs(need, 'This report'));
      const rcs = [...new Set((iv.wlmRc ?? []).map((r) => r.scKey))].sort();
      const rcLine = rcs.length
        ? `\nReport classes in this interval: ${rcs.join(' ')} (report WLM_DETAIL ${id} <name>)`
        : '\nNo report classes defined: workloads that share a service class are not shown separately. Add report classes with rcadvice (RC_ADVISOR tool) or a wlm SET_RULE_TARGET edit.';
      const scKey = c.scKey === undefined ? undefined : resolveKey(c.scKey, [...iv.wlm, ...(iv.wlmRc ?? [])].map((x) => x.scKey));
      if (kind === 'WLM_DETAIL' && scKey && !iv.wlm.some((x) => x.scKey === scKey) && !(iv.wlmRc ?? []).some((x) => x.scKey === scKey)) return fail(`No WLM_DETAIL row ${scKey} in interval ${id}; service class periods: ${[...new Set(iv.wlm.map((x) => x.scKey))].sort().join(' ')}`);
      const head = `RMF interval ${id} (${intervalLabel(iv)})\n`;
      const text = head + renderReport(iv, kind, scKey, c.system) + (kind === 'WLM_SUMMARY' || kind === 'WLM_DETAIL' ? rcLine : '');
      return done(noteReportOpened(run, `${kind}:${index}`), text);
    }
    case 'rcadvice': {
      if (!hasFeature(run, 'REPORT_CLASS_ADVISOR')) return fail(needs('REPORT_CLASS_ADVISOR', 'Report class advice'));
      const res = applyReportClassAdvice(pendingBase(file.pendingPolicy, policyEditSource(run)), runWorkItems(sc(run), run), c.workloadId || null);
      if (typeof res === 'string') return fail(res);
      if (!res.added.length) return fail('No report class advice left.');
      return done(run, `Report classes for ${res.added.join(' ')} staged in ${res.def.policyName}. ${run.phase === 'REVIEW' ? 'close the day (draft <id|none>), then activate at tomorrow\'s briefing (takes effect next day).' : 'activate to install (takes effect next day).'}`, true, res.def);
    }
    case 'smf': {
      const need = SMF_FEATURE[c.kind];
      if (!need) return fail(`SMF kinds: ${Object.keys(SMF_FEATURE).join(' ')}`);
      if (!hasFeature(run, need)) return fail(needs(need, 'This SMF view'));
      const hourly = c.kind === 'DB2' || c.kind === 'CICS';
      const hours = smfHourRefs(run);
      const hour = hourly ? smfHourKey(run, c.hour) : undefined;
      const list = `hours (smf ${c.kind} <hour>; \`12\` = newest 12:00, \`D8 12\` = day 8): ${hours.slice(0, 8).map((h) => h.label).join(', ') || 'none yet'}${hours.length > 8 ? `, … (${hours.length} hours, oldest ${hours.at(-1)!.label})` : ''}`;
      if (hourly && c.hour !== undefined && hour === null) return fail(`No SMF hour ${c.hour}; ${list}`);
      const rows =
        c.kind === 'DB2' ? (hour ? db2Accounting(run, sc(run), hour) : [])
        : c.kind === 'CICS' ? (hour ? cicsMonitoring(run, sc(run), hour) : [])
        : c.kind === 'BATCH' ? batchNight(run)
        : smf113(run);
      const label = hours.find((h) => h.key === hour)?.label;
      const head = hourly ? `hour ${label ?? 'none'}\n${list}\n` : '';
      const body = c.json
        ? Array.isArray(rows) ? rows.map((r) => JSON.stringify(r)).join('\n') : JSON.stringify(rows, null, 1)
        : Array.isArray(rows) ? (rows.length ? table(rows) : '') : rows ? batchText(rows) : '';
      const r = hourly ? noteReportOpened(run, `SMF:${c.kind}:${hour}`) : run;
      return done(r, head + (body || 'no data'));
    }
  }
}

/** Resolve an smf hour argument to an smfHourRefs key; null when nothing matches. */
function smfHourKey(run: RunState, arg: string | undefined): string | null {
  const hours = smfHourRefs(run);
  if (arg === undefined) return hours[0]?.key ?? null;
  const a = arg.trim();
  if (hours.some((h) => h.key === a)) return a;
  const m = /^(?:D(\d+)[\s:]+)?(\d{1,2})(?::00)?$/i.exec(a);
  if (!m) return null;
  const hourOfDay = Number(m[2]);
  if (m[1] !== undefined) {
    const key = `${Number(m[1]) - 1}:${hourOfDay}`;
    return hours.some((h) => h.key === key) ? key : null;
  }
  const curHour = Math.floor(clockAt(run.sim.tick).hourOfDay);
  const key = hours.find((h) => (h.key === 'current' ? curHour : Number(h.key.split(':')[1])) === hourOfDay)?.key;
  return key ?? null;
}

/** The batch night view: a summary line, then the job table. */
function batchText(b: object): string {
  // Days as the game labels them (D1 = first played day), matching `pin BATCH D2`.
  const scalars = Object.entries(b).filter(([, v]) => !Array.isArray(v)).map(([k, v]) => (k === 'day' && typeof v === 'number' ? [k, `D${v + 1}`] : [k, v]));
  // Critical path first, development work last; otherwise by start (the order batchNight gives).
  const rank = (j: object) => ('critical' in j && j.critical ? 0 : 'stream' in j && j.stream === 'DEV' ? 2 : 1);
  const lists = (Object.entries(b).filter(([, v]) => Array.isArray(v)) as [string, object[]][]).map(([k, v]): [string, object[]] => [k, [...v].sort((x, y) => rank(x) - rank(y))]);
  const legend = 'stretch: how many times slower than running alone, at the job\'s last interval (×1 = no contention; a capped or CPU-starved LPAR raises it); queuedSec: wait for an initiator';
  return [table([Object.fromEntries(scalars)]), ...lists.flatMap(([k, v]) => ['', k, table(v)]), '', legend].join('\n');
}

/** When the planned policy takes over (BRIEFING: at day start; LIVE: the next tick's queued command). */
function plannedWhen(phase: RunState['phase']): string {
  return phase === 'LIVE' ? 'queued; V WLM,POLICY= applies at the next tick' : 'activates when the day starts';
}

/** What the player can see: the same fields the browser shows, never the incident ground truth. */
export function statusText(file: PlayFile): string {
  const run = file.run;
  const v = buildView(run, sc(run));
  const out: string[] = [];
  out.push(`${v.phase}  day ${v.day + 1}/${v.maxDays} ${v.weekday}  ${clockText(run.sim.tick)}  difficulty ${v.difficulty.name}  seed ${v.seed}`);
  out.push(`trust ${v.trustOverall.toFixed(1)} (${Object.keys(v.trust).map((f) => `${f} ${v.trust[f]!.toFixed(0)}`).join(', ')})  score ${v.score}`);
  out.push(`engineer-hours left ${v.hoursLeft}  insight ${v.insight}  capex $${Math.round(v.capexRemaining).toLocaleString()}`);
  out.push(budgetLine(v.mlcEstimate, v.opexSpent, v.opexBudget), R4HA_BILLING_NOTE);
  if (run.sim.cost.bills.length > run.billsSeen) out.push(BUDGET_MONTH_BOUNDARY_NOTE);
  out.push(`policy ${v.policyName}${file.pendingPolicy ? `  (pending policy edits in ${file.pendingPolicy.policyName}: activate in BRIEFING or LIVE)` : ''}  tools ${v.tools.filter((t) => t.owned).map((t) => (t.trialLastDay !== null ? `${t.id}(trial to day ${t.trialLastDay + 1})` : t.id)).join(' ') || 'none'}`);
  if (v.plannedPolicy) out.push(`planned policy ${v.plannedPolicy.policyName} (${plannedWhen(v.phase)})`);
  out.push(`CPC busy ${v.cpcBusyPct.toFixed(0)}%  ` + v.lpars.map((l) => `${l.id} ${l.cpBusyPct.toFixed(0)}%`).join('  '));
  if (v.phase === 'LIVE') {
    const hot = v.piHeat.filter((p) => p.pi !== null && p.pi > 1).map((p) => `${p.scKey} ${p.pi!.toFixed(2)}`);
    out.push(`PI > 1 now: ${hot.join('  ') || 'none'}`);
    const now = v.sla.filter((s) => s.hourPct !== null);
    const prev = run.smfHours.at(-1);
    if (now.length) out.push('SLA this hour: ' + now.map((s) => `${s.workloadId} ${s.hourPct!.toFixed(1)}%${s.met === false ? '!' : ''}`).join('  '));
    else if (prev) {
      const rows = allWorkloads(sc(run), run).flatMap((w) => {
        const h = prev.workloads[w.id];
        const a = h ? hourAttainment(w, h) : null;
        return a ? [`${w.id} ${a.attainmentPct.toFixed(1)}%${a.met ? '' : '!'}`] : [];
      });
      out.push(`SLA last hour (${pad2(prev.hourOfDay)}:00): ${rows.join('  ') || 'none'}`);
    }
  }
  const lastIv = v.reports.at(-1);
  if (lastIv) {
    const iv = run.sim.rmf.intervals[lastIv.index]!;
    const hotIv = iv.wlm.filter((w) => w.lparId === '*PLEX' && w.pi !== null && w.pi > 1).map((w) => `${w.scKey} ${w.pi!.toFixed(2)}`);
    out.push(`PI > 1 in RMF interval ${intervalId(iv)} (${intervalLabel(iv)}): ${hotIv.join('  ') || 'none'}`);
  }
  if (v.lastReport) {
    const r = v.lastReport;
    out.push(`last report card (day ${r.day + 1}): score ${r.score}${r.batchMissed ? ', batch window MISSED' : ''}; events: ${r.events.join(', ') || 'none'}`);
    out.push('  ' + r.sla.map((s) => `${s.workloadId} ${s.attainmentPct.toFixed(1)}%`).join('  '));
  }
  // Yesterday's mail stays (night-time alerts land on the played day before); only today's hints are shown.
  const today = v.inbox.filter((m) => m.day >= v.day - 1 && (m.from !== HINT_SENDER || m.day >= v.day));
  if (today.length) {
    out.push('inbox:');
    for (const m of today) out.push(`  [day ${m.day + 1}] ${m.from}: ${m.subject}\n    ${m.body.replace(/\n/g, '\n    ')}`);
  }
  const open = v.incidents.filter((i) => !i.rca && i.rcaGroup === undefined);
  const linked = (id: number) => {
    const ws = rcaGroupOf(v.incidents, id).slice(1).map((i) => `${idText('incident', i.id)} ${i.workloadId}`);
    return ws.length ? ` (same cause, one RCA covers: ${ws.join(', ')})` : '';
  };
  if (open.length) out.push('incidents without RCA: ' + open.map((i) => `${idText('incident', i.id)} ${i.workloadId} day ${i.day + 1} from ${clockText(i.startTick)} (RMF interval ${intervalAt(run, i.startTick)}) ${i.hours}h worst ${i.worstAttainmentPct.toFixed(1)}%${linked(i.id)}`).join('; '));
  if (run.pins.length) out.push('pinned evidence (rca ... --evidence ids):\n' + run.pins.map((p) => `  ${idText('pin', p.id)}: ${p.text}`).join('\n'));
  const asks = inquiriesView(run, sc(run)).pending;
  if (asks.length) out.push('waiting for replies: ' + asks.map((p) => `${p.who}: ${p.question}${p.workloadId ? ` (${p.workloadId})` : ''}`).join('; '));
  const planned = v.changes.filter((c) => c.status === 'PLANNED');
  const projs = v.projects.filter((p) => p.hoursDone > 0);
  if (projs.length) out.push('projects: ' + projs.map((p) => (p.done ? `${p.id} done` : `${p.id} ${p.hoursDone}/${p.hours}h (${p.hoursToday}/${p.maxHoursPerDay}h today)`)).join('; '));
  if (planned.length) out.push('planned changes: ' + planned.map((c) => `${idText('change', c.id)} ${c.label} (day ${c.activateDay + 1})`).join('; '));
  if (v.draft) out.push('draft options (take one with draft <id>; draft none forgoes it):\n  ' + v.draft.map((d) => `${d.id}: ${d.title}. ${d.description}`).join('\n  '));
  if (v.reports.length) {
    const ivs = run.sim.rmf.intervals;
    out.push(`RMF intervals (report KIND <id>): ${intervalId(ivs[v.reports[0]!.index]!)}..${intervalId(ivs[v.reports.at(-1)!.index]!)}, latest ${v.reports.slice(-4).map((r) => `${intervalId(ivs[r.index]!)} (${intervalLabel(ivs[r.index]!)})`).join(', ')}`);
  }
  if (v.endReason) out.push(`END: ${v.endReason}`);
  out.push(`next: ${v.phase === 'BRIEFING' ? 'plan changes, then start' : v.phase === 'LIVE' ? 'advance <hours>' : v.phase === 'REVIEW' ? 'file RCAs, read reports, then draft <id> to take an option and close the day (draft none takes nothing)' : 'run over'}`);
  return out.join('\n');
}

const DELAY_HEAD =
  'DELAY (fractions of active samples; rows are service-class summaries). DLY includes WLM capping delay, which has no column (Primary Reason RG-Cap), so it can exceed PRC+DEV+STR. IDL, SUB, OPR, ENQ are not modelled. Pin DELAY_CPU/DELAY_ZIIP for the PRC split, DELAY_CAP for capping; --json has every field.';

/** One DELAY line in the report's column order (RMF Report Analysis p.108–110), plus the SYSSUM/PROCU values a pin reads. */
function delayRow(r: Mon3Row): object {
  const { system, scKey, goal, importance, pi, endedPerSec, avgRtMs, cpuEngines, ziipEngines, withinGoalPct, velocityAct, delay: d } = r;
  const head = { system, scKey, goal, importance, pi, endedPerSec, avgRtMs, cpuEngines, ziipEngines, withinGoalPct, velocityAct };
  const states = { 'WFL%': r.velocity, USG: r.usingFrac, DLY: r.delayFrac, IDL: null, UKN: r.unknownFrac };
  return { ...head, ...states, PRC: d.cpu + d.ziip, DEV: d.io, STR: d.stor, SUB: 0, OPR: 0, ENQ: 0, primaryReason: r.primaryReason };
}

const CPC_HEAD =
  'CPC (RMF Report Analysis p.97–99): partitions are grouped by processor type (*CP, *IIP, *ICF), each group ending in its PHYSICAL line (physical time no partition can claim; Logical Util % Effect/Total = effective/total dispatch ÷ online logicals, Physical Util % = engine-time ÷ the type\'s physical engines). Pin CPC <lpar> LPAR_BUSY for Logical Util % Total, PRSM_DELAY for PR/SM delay % (the game\'s short-engine wait, not an RMF column) and CAPPED for capped %; CPC <lpar> CPC_BUSY is the *CP row\'s Physical Util % Total, CAPACITY_ADJ the capacity-adjusted line. --json has every field; weight is in `play capacity`, weight and polarity are in the Partition Data report.';

/**
 * The browser's single CPC table (src/ui/monitor/Cpc.tsx) as text: RMF's two-level header (Partition, MSU, Proc Num,
 * Logical/Physical Util %) over one block per processor type — *CP, *IIP, *ICF — each with its partitions and its
 * PHYSICAL line (p.97–99).
 */
function cpcText(rows: Mon3Cpc[], physical: Mon3CpcPhysical[]): string[] {
  if (!rows.length) return ['none'];
  const ids = [...new Set(rows.map((c) => c.cpcId))];
  const out: string[] = [];
  for (const id of ids) {
    const part = rows.filter((c) => c.cpcId === id);
    if (ids.length > 1) out.push(`CPC ${id}`);
    out.push(cpcTable(part, physical.filter((x) => x.cpcId === id)));
    const first = part.find((c) => c.kind === 'ZOS');
    if (first) out.push(`CPC ${id}: capacity adjusted ${(first.capacityAdjPct ?? 0).toFixed(1)} % (pin CPC ${first.lparId} CAPACITY_ADJ)`);
  }
  return out;
}

function cpcTable(rows: Mon3Cpc[], physical: Mon3CpcPhysical[]): string {
  const groups = [
    { label: 'Partition', cols: [''] },
    { label: 'MSU', cols: ['Def', 'Act'] },
    { label: 'Proc Num', cols: [''] },
    { label: 'Logical Util %', cols: ['Effect', 'Total'] },
    { label: 'Physical Util %', cols: ['LPAR', 'Effect', 'Total'] },
    { label: 'PR/SM delay %', cols: [''] },
    { label: 'capped %', cols: [''] },
  ];
  const n1 = (x: number) => x.toFixed(1);
  type Group = 'CP' | 'IIP' | 'ICF';
  const partRow = (g: Group, c: Mon3Cpc) => {
    const v = g === 'IIP' ? c.iip! : c;
    return [
      c.lparId,
      g !== 'CP' ? '' : c.msuDef == null ? 'N/A' : String(c.msuDef),
      g !== 'CP' || c.msuAct === null ? '' : c.msuAct.toFixed(0),
      n1(v.procNum),
      n1(v.logicalEffectPct),
      n1(v.logicalTotalPct),
      n1(v.physLparPct),
      n1(v.physEffectPct),
      n1(v.physTotalPct),
      g === 'CP' ? n1(v.prsmDelayPct) : '',
      g === 'CP' ? v.cappedPct.toFixed(0) : '',
    ];
  };
  const groupRow = (g: Group, label: string, part: Mon3Cpc[]) => {
    const vals = part.map((c) => (g === 'IIP' ? c.iip! : c));
    const sum = (f: (v: (typeof vals)[number]) => number) => vals.reduce((a, v) => a + f(v), 0);
    return [label, '', '', n1(sum((v) => v.procNum)), '', '', n1(sum((v) => v.physLparPct)), n1(sum((v) => v.physEffectPct)), n1(sum((v) => v.physTotalPct)), '', ''];
  };
  const types: { kind: Group; label: string; part: Mon3Cpc[] }[] = [
    { kind: 'CP', label: '*CP', part: rows.filter((c) => c.kind === 'ZOS') },
    { kind: 'IIP', label: '*IIP', part: rows.filter((c) => c.iip) },
    { kind: 'ICF', label: '*ICF', part: rows.filter((c) => c.kind === 'CF') },
  ];
  const body = types.flatMap(({ kind, label, part }) => {
    if (!part.length) return [];
    const phys = physical.find((x) => x.kind === kind);
    return [
      groupRow(kind, label, part),
      ...part.map((c) => partRow(kind, c)),
      ...(phys ? [['PHYSICAL', '', '', '', '', '', n1(phys.physPct), n1(0), n1(phys.physPct), '', '']] : []),
    ];
  });
  const leaf = groups.flatMap((g) => g.cols.map((c) => c || g.label));
  const width = leaf.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)));
  const offset = (gi: number) => groups.slice(0, gi).reduce((a, x) => a + x.cols.length, 0);
  const spanW = (gi: number) => groups[gi]!.cols.reduce((a, _, i) => a + width[offset(gi) + i]!, 0) + 2 * (groups[gi]!.cols.length - 1);
  // A group label spans its columns; widen the last one if the label is longer than the span.
  groups.forEach((g, gi) => {
    if (g.cols.length > 1 && g.label.length > spanW(gi)) width[offset(gi) + g.cols.length - 1]! += g.label.length - spanW(gi);
  });
  const line = (cells: string[]) => cells.map((x, i) => x.padEnd(width[i]!)).join('  ').trimEnd();
  const groupLine = groups.map((g, gi) => (g.cols.length === 1 ? ''.padEnd(width[offset(gi)]!) : g.label.padEnd(spanW(gi)))).join('  ').trimEnd();
  return [groupLine, line(leaf), ...body.map(line)].join('\n');
}

/** Monitor III (tool MON3): SYSINFO, CPC, DELAY, enclave and WFEX tables for the current range (or JSON lines). */
export function mon3Text(file: PlayFile, opts: { system?: string; json?: boolean; at?: string } = {}): string {
  const run = file.run;
  const m = buildView(run, sc(run)).mon3;
  if (!m) return 'Monitor III needs the MON3 tool.';
  if (opts.at !== undefined) return mon3PastText(file, opts.at, opts.system?.toUpperCase(), opts.json);
  const sys = opts.system?.toUpperCase();
  const pick = <T,>(xs: T[], id: (x: T) => string) => (sys ? xs.filter((x) => id(x).toUpperCase() === sys) : xs);
  const systems = pick(m.systems, (x) => x.system);
  const cpc = pick(m.cpc, (x) => x.lparId);
  // The CPC table is the CPC's, as in the browser (Cpc.tsx prints every partition of the CPC it shows), so a
  // system filter picks the CPC that system runs on and keeps the whole CPC: the *CP/*ICF rows stay the CPC's
  // totals, which is what the CPC_BUSY pin reads. --json keeps the per-partition rows the filter asked for.
  const cpcIds = new Set(m.cpc.filter((x) => x.lparId.toUpperCase() === sys).map((x) => x.cpcId));
  const cpcRows = sys ? m.cpc.filter((x) => cpcIds.has(x.cpcId)) : m.cpc;
  const rows = pick(m.rows, (x) => x.system);
  if (sys && !systems.length && !cpc.length) return `No system ${opts.system}; systems: ${m.systems.map((x) => x.system).join(' ')}`;
  const when = run.phase === 'LIVE' ? `range ending ${clockText(run.sim.tick)}` : `snapshot from ${clockText(run.sim.tick)} (not live: phase ${run.phase})`;
  const head = `Monitor III, last ${m.rangeSec}s, ${when}. Policy ${m.policy}. CPC logical:physical CP ratio ${m.logicalToPhysical.toFixed(2)}.`;
  if (opts.json) return [head, ...systems.map((x) => JSON.stringify(x)), ...cpc.map((x) => JSON.stringify(x)), ...m.cpcPhysical.map((x) => 'CPC_PHYSICAL ' + JSON.stringify(x)), ...rows.map((x) => JSON.stringify(x)), ...m.enclaves.map((x) => JSON.stringify(x)), ...(m.wkm ?? []).map((x) => 'SYSWKM ' + JSON.stringify(x)), ...pick(m.procJobs ?? [], (x) => x.system).map((x) => 'PROCU ' + JSON.stringify(x)), ...m.exceptions.map((x) => 'EXCEPTION ' + JSON.stringify(x))].join('\n');
  const out = [head, `History (mon3 [system] --at D2 10:40; pin MON3|CPC ... --at D2 10:40): ${mon3RangeText(file)}.`, '', 'SYSINFO', table(systems), '', 'CPC', CPC_HEAD, ...cpcText(cpcRows, m.cpcPhysical), '', DELAY_HEAD, table(rows.filter((r) => r.resourceSamples !== false).map(delayRow))];
  // PROCU lists jobs by EAppl % CP (RMF Report Analysis p.188); percentages are of one engine.
  const procu = pick(m.procJobs ?? [], (x) => x.system).filter((j) => j.eapplCpEngines + j.eapplZiipEngines > 0.0005);
  const p1 = (e: number) => Number((e * 100).toFixed(1));
  out.push('', 'PROCU (top 15 jobs; shares of each class row are estimated)', table(procu.slice(0, 15).map((j) => ({ system: j.system, jobname: j.jobname, cx: j.cx, serviceClass: j.serviceClass, cpPct: p1(j.cpEngines), iipcpPct: p1(j.iipcpEngines), eapplCpPct: p1(j.eapplCpEngines), eapplIipPct: p1(j.eapplZiipEngines) }))));
  if (m.enclaves.length && !sys) out.push('', 'ENCLAVE', table(m.enclaves));
  // SYSWKM: CICS classes' work manager states and the AORs serving them (their CPU and delays live on those AORs).
  for (const w of m.wkm ?? []) {
    if (sys && !w.servers.some((x) => x.system.toUpperCase() === sys)) continue;
    const st = w.states;
    const f = (x: number | null) => (x === null ? '-' : x.toFixed(0));
    out.push('', `SYSWKM ${w.serviceClass} period ${w.period}: ${w.goal}, avg ${w.avgRtMs === null ? '-' : w.avgRtMs.toFixed(0)} ms, ${w.endedPerSec.toFixed(1)}/s, PI ${w.pi === null ? '-' : w.pi.toFixed(2)}`,
      ...(w.note ? [`  ${w.note}`] : []),
      `  CICS EXE %: ACTIVE ${f(st.active)} READY ${f(st.ready)} IDLE ${f(st.idle)} LOCK ${f(st.lock)} I/O ${f(st.io)} CONV ${f(st.conv)} PROD ${f(st.prod)} MISC ${f(st.misc)}`,
      table(w.servers.filter((x) => !sys || x.system.toUpperCase() === sys).map((x) => ({ jobname: x.jobname, mgmt: x.mgmt, system: x.system, serviceClass: x.serviceClass, servicePct: x.servicePct, velocity: x.velocity, procUsgPct: x.procUsgPct, ioUsgPct: x.ioUsgPct, cappPct: x.cappPct }))));
  }
  out.push('', 'WFEX exceptions', m.exceptions.length ? table(m.exceptions) : 'none');
  return out.join('\n');
}

/** A past Monitor III range from the history: only the values a pin can use. */
function mon3PastText(file: PlayFile, at: string, sys: string | undefined, json?: boolean): string {
  const tick = tickOfClock(at);
  if (tick === null) return `No time ${at}; write it as D2 10:40 (D1 = first played day, 06:00 to 06:00)`;
  const p = file.mon3 ? mon3PinsAt(file.mon3, tick) : null;
  if (!p) return `No Monitor III history at ${at}; ${mon3RangeText(file)}.`;
  const rows = p.view.rows.filter((x) => !sys || x.system.toUpperCase() === sys);
  const cpc = p.view.cpc.filter((x) => !sys || x.lparId.toUpperCase() === sys);
  if (sys && !rows.length && !cpc.length) return `No system ${sys} at ${at}`;
  const head = `Monitor III history, range ending ${clockText(p.tick)}: the values a pin reads (pin MON3|CPC ... --at ${clockText(p.tick)}). Delays are fractions of active samples, cpuEngines is EAppl% ÷ 100.`;
  if (json) return [head, ...cpc.map((x) => JSON.stringify(x)), ...rows.map((x) => JSON.stringify(x))].join('\n');
  return [head, '', 'CPC', table(cpc), '', 'SERVICE CLASS PERIODS', table(rows)].join('\n');
}

/** Flat objects as a fixed-width table: numbers to 1 decimal (0..1 fractions to 2), nested objects as a.b columns. */
function table(rows: object[], omit: string[] = []): string {
  if (!rows.length) return 'none';
  const flat = rows.map((r) => {
    const o: Record<string, string> = {};
    const put = (k: string, v: unknown) => {
      if (omit.includes(k) || omit.includes(k.split('.')[0]!)) return;
      if (v === null || v === undefined) o[k] = '-';
      else if (typeof v === 'number') o[k] = Number.isInteger(v) ? String(v) : Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1);
      else if (Array.isArray(v)) o[k] = v.join(',') || '-';
      else if (typeof v === 'object') for (const [k2, v2] of Object.entries(v)) put(`${k}.${k2}`, v2);
      else o[k] = String(v);
    };
    for (const [k, v] of Object.entries(r)) put(k, v);
    return o;
  });
  const cols = [...new Set(flat.flatMap((o) => Object.keys(o)))];
  const width = cols.map((c) => Math.max(c.length, ...flat.map((o) => (o[c] ?? '').length)));
  const line = (cells: string[]) => cells.map((x, i) => x.padEnd(width[i]!)).join('  ').trimEnd();
  return [line(cols), ...flat.map((o) => line(cols.map((c) => o[c] ?? '')))].join('\n');
}

/** The WLM activity log as the Monitor shows it (last 60 lines; live only with Monitor III, else after the day).
 * system: lines for one LPAR; grep: lines containing that text (case-insensitive). */
export function wlmLogText(file: PlayFile, opts: { system?: string; grep?: string } = {}): string {
  const run = file.run;
  const lines = buildView(run, sc(run)).wlmLog;
  if (lines.length === 0) return run.phase === 'LIVE' ? 'The live WLM activity log needs the RMF_MON3 tool; without it the log is readable after the day.' : 'WLM activity log is empty.';
  const g = opts.grep?.toLowerCase();
  const shown = lines.filter((l) => (!opts.system || l.split(' ')[2] === opts.system) && (!g || l.toLowerCase().includes(g)));
  return [`WLM activity log (last ${lines.length} lines${opts.system ? `, ${opts.system}` : ''}${g ? `, matching "${opts.grep}"` : ''}):`, ...(shown.length ? shown : ['(no matching lines)'])].join('\n');
}

/** The WLM service definition (active, or the pending edits) and the configuration it runs on. */
export function policyText(file: PlayFile, pending: boolean): string {
  const run = file.run;
  if (pending && !file.pendingPolicy) return 'No pending policy edits.';
  const def = pending ? file.pendingPolicy! : run.sim.wlm.definition;
  const out = [`${pending ? 'pending' : 'active'} policy ${def.policyName}  I/O priority management ${def.ioPriorityManagement === false ? 'NO' : 'YES'}${def.cicsRegionMode === 'REGION' ? '  manage regions using goals of REGION (rules without their own setting)' : ''}`];
  // The policy the WLM schedule or a queued activation will install, so `policy` says what `status` says.
  const planned = plannedPolicy(run);
  if (planned && (planned.policyName !== def.policyName || !pending)) out.push(`planned policy ${planned.policyName} (${plannedWhen(run.phase)})`);
  out.push('service classes (period: goal, duration SU):');
  for (const c of def.classes) {
    const periods = c.periods.map((p, i) => `#${i + 1} ${goalText(p)}${p.durationSu !== null ? ` DUR ${p.durationSu}` : ''}`).join('; ');
    const flags = [c.cpuCritical && 'CPU-critical', c.storageCritical && 'storage-critical', c.resourceGroup && `RG ${c.resourceGroup}`, c.honorPriority === false && 'zIIP honor priority NO'].filter(Boolean).join(', ');
    out.push(`  ${c.id}: ${periods}${flags ? `  [${flags}]` : ''}`);
  }
  if (def.resourceGroups.length) out.push(`resource groups: ${def.resourceGroups.map((g) => `${g.id} type ${g.type} min ${g.min ?? '-'} max ${g.max ?? '-'}`).join(', ')}`);
  if (def.reportClasses.length) out.push(`report classes: ${def.reportClasses.join(' ')}`);
  out.push('classification rules (subsystem: qualifier=pattern → service class / report class [manage region using goals of]):');
  const rule = (r: ClassificationRule, depth: number): string[] => [
    `${'  '.repeat(depth + 2)}${r.qualifier}=${r.pattern} → ${r.serviceClass ?? '(inherit)'}${r.reportClass ? ` / ${r.reportClass}` : ''}${r.regionMode ? ` [${r.regionMode}]` : ''}`,
    ...r.children.flatMap((ch) => rule(ch, depth + 1)),
  ];
  for (const ss of def.subsystems) {
    out.push(`  ${ss.subsystem} (default ${ss.defaultServiceClass ?? 'none'}${ss.defaultReportClass ? ` / ${ss.defaultReportClass}` : ''}):`);
    for (const r of ss.rules) out.push(...rule(r, 0));
  }
  const cfg = run.sim.config;
  out.push('LPARs (logical processors by pool; weight):');
  for (const l of cfg.lpars) out.push(`  ${l.id} on ${l.cpcId}: ${l.pools.map((p) => `${p.pool} ${p.logical}${p.reserved ? ` (+${p.reserved} reserved)` : ''}${p.dedicated ? ' dedicated' : ` weight ${p.weight}`}`).join(', ')}`);
  if (cfg.cics.length) out.push(`CICS regions: ${cfg.cics.map((r) => `${r.name}@${r.lparId} MXT ${r.maxTasks} QR ${Math.round(r.qrFrac * 100)}%`).join(', ')}`);
  return out.join('\n');
}

/** What can be ordered or fixed: the Change Desk catalog, the tool tree and the RCA vocabulary. */
export function catalogText(file: PlayFile): string {
  const v = buildView(file.run, sc(file.run));
  const out = ['hardware (change {"label":..,"hardwareId":ID}):'];
  for (const h of HARDWARE) out.push(`  ${h.id}: ${h.name}. capex $${h.capex.toLocaleString()}, opex $${h.opexPerDay.toLocaleString()}/day, lead ${h.leadDays}d${h.durationDays ? `, lasts ${h.durationDays}d` : ''}. ${h.description}`);
  out.push('fixes (change {"label":..,"fixId":ID}):');
  for (const f of FIXES.filter((x) => v.fixIds.includes(x.id))) out.push(`  ${f.id}: ${f.name}. ${f.hours}h${f.trustCost ? `, ${f.trustCost.facet} trust -${f.trustCost.amount}` : ''}${f.operational ? ', operator command (no change-board trust cost)' : ''}. ${f.description}`);
  out.push(`batch restart (restart JOB; 0.5h; from the last checkpoint, only during its batch night): abended now: ${v.batch.abended.map((a) => `${a.name}${a.critical ? ' (critical path)' : ''}`).join(' ') || 'none'}`);
  out.push(`tools (buy ID; insight ${v.insight}):`);
  for (const t of v.tools) out.push(`  ${t.id}${t.trialLastDay !== null ? ` [free trial to end of day ${t.trialLastDay + 1}; buy to keep]` : t.owned ? ' [owned]' : ''}${t.comingSoon ? ' [coming soon]' : ''}: ${t.name}, tier ${t.tier}, ${t.insightCost} insight${t.prereqs.length ? `, needs ${t.prereqs.join('+')}` : ''}. ${t.reveals}`);
  out.push(`RCA mechanisms: ${MECHANISMS.join(' ')}`, `RCA triggers: ${TRIGGERS.join(' ')}`);
  const iq = inquiriesView(file.run, sc(file.run));
  out.push(`ask around (ask TOPIC [workloadId]; replies arrive in the inbox hours later; at most ${iq.maxOpen} open):`);
  for (const t of iq.topics) out.push(`  ${t.id}: ${t.contact}, ${t.hours}h. ${t.question}${t.perWorkload ? ' Needs a workload id.' : ''}`);
  out.push(`  workloads: ${iq.apps.map((a) => a.id).join(' ')}`);
  out.push('projects (project ID hours; engineer-hours spread over days):');
  for (const p of projectsView(file.run)) out.push(`  ${p.id}${p.done ? ' [done]' : ''}: ${p.name}, ${p.hoursDone}/${p.hours}h, max ${p.maxHoursPerDay}h/day. ${p.description}`);
  out.push('evidence pins (pin SOURCE ...; then rca INC MECH TRIG --evidence 1,2): sources WLMGL <interval id> <system> <scKey> <metric> | MON3 <system> <scKey> <metric> [jobname: a SYSWKM server, metric VELOCITY] [--at D2 10:40] | CPC <lparId> PRSM_DELAY|CAPPED [interval id, as in Partition Data | --at D2 10:40 for a past Monitor III range] | DB2|CICS <hour> <workloadId> <metric> | BATCH <day as labelled, e.g. D2> <JOB_* metric>');
  out.push(`  metrics: ${Object.keys(EVIDENCE_METRICS).join(' ')}`);
  const cfg = file.run.sim.config;
  out.push('change targets (current config):');
  out.push(`  LPARs: ${cfg.lpars.map((l) => l.id).join(' ')}`);
  out.push(`  CICS regions (SET_CICS name; MXT = maxTasks): ${cfg.cics.map((r) => `${r.name}@${r.lparId} MXT ${r.maxTasks}`).join(', ') || 'none'}`);
  out.push(`  Db2 (SET_DB2 ssid): ${cfg.db2.map((d) => `${d.ssid} MAXDBAT ${d.maxDbat}, BP ${d.bufferPoolGb} GB`).join(', ') || 'none'}`);
  out.push('Config/WLM commands for change {"label":..,"commands":[...]}: see the Command type in src/sim/core/commands.ts; WLM edits: WlmEdit in src/game/wlmEdit.ts');
  return out.join('\n');
}

/** Stable RMF interval id: the interval's end in 5-minute slots since the run began. Array positions shift
 * as old intervals age out of the RMF buffer; ids don't, and every allowed interval length is a multiple of 5 min. */
export const intervalId = (iv: { endTick: number }): number => Math.round((iv.endTick * TICK_SEC) / 300);
const intervalIndex = (run: RunState, id: number): number => run.sim.rmf.intervals.findIndex((iv) => intervalId(iv) === id);

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** formatClock plus the calendar weekday: the played day runs 06:00 to 06:00, so 00:30 after D1's evening is "D1 Tue 00:30". */
export function clockText(tick: number): string {
  const c = clockAt(tick);
  return `D${c.day + 1} ${WEEKDAYS[c.dayOfWeek]} ${hhmm(tick)}`;
}
export { tickOfClock };

function mon3RangeText(file: PlayFile): string {
  const r = file.mon3 ? mon3PinRange(file.mon3) : null;
  return r ? `history covers ${clockText(r.firstTick)} to ${clockText(r.lastTick)}, one range every ${(MON3_HISTORY.mintimeTicks * TICK_SEC).toFixed(0)}s` : 'no Monitor III history yet (it is recorded while the day runs, once RMF_MON3 is owned)';
}

const intervalLabel = (iv: { startTick: number; endTick: number }) => `${clockText(iv.startTick)}–${hhmm(iv.endTick)}`;

function intervalList(run: RunState): string {
  const all = run.sim.rmf.intervals;
  const ivs = buildView(run, sc(run)).reports.map((r) => all[r.index]!);
  if (!ivs.length) return 'no intervals visible yet';
  const recent = ivs.slice(-6).map((iv) => `${intervalId(iv)} (${intervalLabel(iv)})`);
  return `intervals ${intervalId(ivs[0]!)}..${intervalId(ivs.at(-1)!)}, latest: ${recent.join(', ')}`;
}

/** The RMF interval id whose span contains this tick. */
function intervalAt(run: RunState, tick: number): number | string {
  const iv = run.sim.rmf.intervals.find((x) => x.endTick > tick);
  return iv ? intervalId(iv) : 'not yet closed';
}

/** A bare service class name means its first period (RMF row keys are CLASS#period, 1-based). */
function resolveKey(key: string, keys: string[]): string {
  return keys.includes(key) || key.includes('#') || !keys.includes(`${key}#1`) ? key : `${key}#1`;
}

function rowKeys(iv: { wlm: { lparId: string; scKey: string }[] }, system: string): string {
  const keys = [...new Set(iv.wlm.filter((x) => x.lparId === system).map((x) => x.scKey))].sort();
  return keys.length ? `${system} rows: ${keys.join(' ')}` : `systems: ${[...new Set(iv.wlm.map((x) => x.lparId))].sort().join(' ')}`;
}

const usd = (x: number) => `$${Math.round(x).toLocaleString()}`;

function budgetLine(software: number, cod: number, budget: number): string {
  const total = software + cod;
  return `Software + CoD estimate: ${usd(software)} + ${usd(cod)} = ${usd(total)} vs budget ${usd(budget)}; ${budgetDelta(total, budget).label}. At billing: over 25% ends the run.`;
}

/** Finance tab as text: the month's bill so far and, under TFP, pace against the prorated baseline per product. */
export function financeText(file: PlayFile): string {
  const run = file.run;
  const scenario = sc(run);
  const f = financeView(run, scenario);
  const out = [`month ${f.month + 1}  pricing ${f.pricing}  month to date ${usd(f.monthToDate)}${f.cfoTarget !== null ? `  CFO target <= ${usd(f.cfoTarget)}` : ''}`];
  out.push(budgetLine(f.monthToDate, f.opexSpent, f.opexBudget), R4HA_BILLING_NOTE, BUDGET_MONTH_BOUNDARY_NOTE);
  if (f.offer) out.push(`TFP offer ${f.offer.status} (decide by day ${f.offer.untilDay + 1}${f.offer.quotedAt ? `, quoted ${f.offer.quotedAt}` : ''}): baseline ${usd(f.offer.baselineMonthly)}/month vs sub-capacity ${usd(f.offer.subcapMonthly)}/month, overage at ${Math.round(100 * f.offer.overageFrac)}% of price`);
  for (const p of f.offer?.products ?? [])
    out.push(`  ${p.name}: peak ${Math.round(p.peakMsu).toLocaleString()} MSU, sub-capacity ${usd(p.subcapMonthly)}/month ($${p.pricePerMsu.toFixed(0)}/MSU); baseline ${Math.round(p.baselineMsuHours).toLocaleString()} MSU-hours at $${p.pricePerMsuHour.toFixed(2)}/MSU-hour; used ${Math.round(p.msuHoursUsed).toLocaleString()} MSU-hours${p.usageEstimated ? ' (estimated from R4HA samples: this run predates consumption tracking)' : ''}`);
  if (f.offer?.projection)
    out.push(`  run rate: ${Math.round(f.offer.projection.msuHours).toLocaleString()} MSU-hours against a ${Math.round(f.offer.projection.baselineMsuHours).toLocaleString()} baseline (${Math.round(f.offer.projection.overageMsuHours).toLocaleString()} over) -> TFP ${usd(f.offer.projection.tfpMonthly)}/month vs sub-capacity ${usd(f.offer.projection.subcapMonthly)}/month (${usd(Math.abs(f.offer.projection.savings))} ${f.offer.projection.savings >= 0 ? 'lower' : 'higher'})`);
  const tfp = run.sim.cost.tfp;
  if (f.tfp && tfp) {
    // The baseline is prorated over the TFP part of the month; project consumption over that same part.
    const tfpElapsed = monthElapsedFrac(run.sim.tick) - (1 - tfp.monthFrac);
    const scale = tfpElapsed > 1e-6 ? tfp.monthFrac / tfpElapsed : null;
    out.push('', `TFP: ${scale ? (100 / scale).toFixed(0) : 0}% of this month's TFP period elapsed. The baseline is paid in full, used or not; MSU-hours above it cost ${Math.round(100 * tfp.terms.overageFrac)}% of price. zIIP MSU is not counted.`);
    out.push(
      table(
        f.tfp.map((p) => {
          const price = tfp.terms.pricePerMsuHour[p.id] ?? 0;
          const proj = scale ? p.msuHours * scale : null;
          return {
            product: p.id,
            lpars: scenario.products.find((x) => x.id === p.id)?.lpars ?? [],
            msuHours: Math.round(p.msuHours),
            baselineMsuHours: Math.round(p.baselineMsuHours),
            projectedMsuHours: proj === null ? null : Math.round(proj),
            projectedVsBaselinePct: proj === null || p.baselineMsuHours <= 0 ? null : 100 * (proj / p.baselineMsuHours - 1),
            pricePerMsuHour: price.toFixed(3),
            overagePerMsuHour: (price * tfp.terms.overageFrac).toFixed(3),
            chargeSoFar: usd(p.charge),
          };
        }),
      ),
    );
    // One MSU-hour above the baseline on an image is charged by every product licensed there.
    const lpars = [...new Set(scenario.products.flatMap((p) => p.lpars))].sort();
    const perLpar = lpars.map((l) => `${l} ${scenario.products.filter((p) => p.lpars.includes(l)).reduce((a, p) => a + (tfp.terms.pricePerMsuHour[p.id] ?? 0) * tfp.terms.overageFrac, 0).toFixed(2)}`);
    out.push('', `overage $ per MSU-hour by LPAR (all products licensed on it): ${perLpar.join('  ')}`);
  } else {
    out.push('', table(f.products.map((p) => ({ product: p.id, lpars: p.lpars, peakR4haMsu: Math.round(p.peakMsu), peakAt: p.peakAt, charge: usd(p.charge) }))));
  }
  if (f.bills.length) out.push('', 'closed months: ' + f.bills.map((b) => `month ${b.month + 1} ${usd(b.total)}`).join('  '));
  return out.join('\n');
}

const CAPACITY_COMMANDS = new Set<string>(['ADD_CPC_ENGINES', 'SET_CPC_ENGINES', 'SET_CPC_CAPACITY', 'SET_CPC_MEMORY', 'SET_LOGICAL', 'SET_WEIGHT', 'SET_DEFINED_CAPACITY', 'SET_ABSOLUTE_CAP', 'SET_CAPACITY_GROUP', 'SET_LPAR_MEMORY', 'SET_JOB_CLASS']);

/** Hardware view as text: CPC engines and MSU, LPAR definitions, and change-desk changes with their days. */
export function capacityText(file: PlayFile): string {
  const run = file.run;
  const c = run.sim.config;
  const out = c.cpcs.map((cpc) => `${cpc.id} ${cpc.generation} capacity setting ${cpc.capacitySetting}: CP ${cpc.engines.CP} x ${msuPerCp(cpc).toFixed(0)} MSU = ${Math.round(cpc.engines.CP * msuPerCp(cpc))} MSU, zIIP ${cpc.engines.ZIIP}, ICF ${cpc.engines.ICF}, memory ${cpc.memoryGb} GB`);
  out.push(
    '',
    table(
      c.lpars.map((l) => {
        const cp = l.pools.find((p) => p.pool === (l.kind === 'CF' ? 'ICF' : 'CP'));
        const zi = l.pools.find((p) => p.pool === 'ZIIP');
        return { lpar: l.id, kind: l.kind, logicalCp: cp?.logical ?? 0, reservedCp: cp?.reserved ?? 0, weight: cp?.weight ?? 0, logicalZiip: zi?.logical ?? 0, ziipWeight: zi?.weight ?? 0, definedCapacityMsu: l.definedCapacityMsu, group: l.capacityGroup, memoryGb: l.memoryGb };
      }),
    ),
  );
  if (c.capacityGroups.length) out.push('', 'capacity groups: ' + c.capacityGroups.map((g) => `${g.id} ${g.limitMsu} MSU`).join('  '));
  out.push('', 'job classes (initiators per LPAR): ' + c.jobClasses.map((j) => `${j.jobClass} ${j.mode} ${Object.entries(j.initiators).map(([l, n]) => `${l}:${n}`).join(',')}`).join('  '));
  const changes = run.changes
    .filter((ch) => ch.status !== 'FAILED' && ch.commands.some((x) => CAPACITY_COMMANDS.has(x.kind)))
    .sort((a, b) => a.activateDay - b.activateDay || a.id - b.id);
  if (changes.length) {
    out.push('', 'capacity, LPAR and initiator changes from the change desk (temporary ones revert at the start of revertDay):');
    out.push(table(changes.map((ch) => ({ id: idText('change', ch.id), status: ch.status, activateDay: `D${ch.activateDay + 1}`, revertDay: ch.revertDay === null ? null : `D${ch.revertDay + 1}`, label: ch.label, capex: usd(ch.capex), opexPerDay: usd(ch.opexPerDay) }))));
  }
  return out.join('\n');
}

/** The latest batch night from SMF 30, rolled up by stream (needs the same tool as smf BATCH). */
export function batchStreamsText(file: PlayFile): string {
  const run = file.run;
  if (!hasFeature(run, SMF_FEATURE.BATCH)) return needs(SMF_FEATURE.BATCH, 'The batch view');
  const n = batchNight(run);
  if (!n) return 'No batch jobs have ended yet.';
  const rows = [...new Set(n.jobs.map((j) => j.stream))].sort().map((s) => {
    const js = n.jobs.filter((j) => j.stream === s);
    const start = Math.min(...js.map((j) => j.startSec));
    const end = Math.max(...js.map((j) => j.endSec));
    return {
      stream: s,
      jobsEnded: js.length,
      critical: js.some((j) => j.critical),
      lpars: [...new Set(js.map((j) => j.lparId))].sort(),
      firstStart: clockText(n.dayStartTick + Math.round(start / TICK_SEC)),
      lastEnd: clockText(n.dayStartTick + Math.round(end / TICK_SEC)),
      spanMin: (end - start) / 60,
      maxQueuedMin: Math.max(...js.map((j) => j.queuedSec)) / 60,
      maxStretch: Math.max(...js.map((j) => j.stretch)),
    };
  });
  const share = n.critical?.delaySharePct;
  return [
    `batch night D${n.day + 1} (SMF 30, ended jobs only): last critical job ${n.criticalEnd ?? 'none'}`,
    share ? `critical path delay share %: ${Object.entries(share).map(([k, v]) => `${k} ${v.toFixed(0)}`).join('  ')}` : '',
    n.critical?.abended.length ? `critical abends: ${n.critical.abended.join(' ')}` : '',
    table(rows),
    '',
    'smf BATCH has the per-job rows. maxQueuedMin: longest wait for an initiator; maxStretch: slowdown against running alone.',
  ].filter(Boolean).join('\n');
}
