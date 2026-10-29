// Headless play interface for agents (PROGRESS M8.9): a run file plus commands, no hidden ground truth.
// The run file holds the serialised RunState (as the browser saves it), the pending WLM policy and the
// command log, so seed + log replays the same run.

import { PACKS, packOf } from '../src/content/packs';
import type { DifficultyId } from '../src/content/difficulty';
import { scenarioFor } from '../src/game/difficulty';
import { advance, cancelChange, chooseDraft, failedPolicyToday, newRun, rcaLeadId, requestChange, startDay, submitRca, type ChangeRequest } from '../src/game/run';
import type { Mechanism, RunState, Trigger } from '../src/game/types';
import { buyTool, hasFeature, noteReportOpened, REPORT_FEATURE, SMF_FEATURE } from '../src/game/tools';
import { batchNight, cicsMonitoring, db2Accounting, smf113, smfHourRefs } from '../src/game/smf';
import { FIXES } from '../src/game/catalog';
import { HARDWARE } from '../src/content/hardware-catalog';
import { MON3_HISTORY, TOOLS, type ToolFeature } from '../src/content/tools';
import { applyReportClassAdvice } from '../src/game/rcAdvisor';
import { clockAt, formatClock } from '../src/sim/core/clock';
import { allWorkloads, runWorkItems } from '../src/game/workloads';
import { decideTfp } from '../src/game/tfp';
import { decodeRunJson, encodeRunJson } from '../src/game/runFile';
import { idText } from '../src/game/ids';
import { askAround, inquiriesView } from '../src/game/inquiries';
import { projectsView, workOnProject } from '../src/game/projects';
import { addPin, removePin, type PinRequest } from '../src/game/evidence';
import { EVIDENCE_METRICS } from '../src/content/evidence';
import { HINT_SENDER } from '../src/content/hints';
import type { InquiryKind } from '../src/content/inquiries';
import { applyWlmEdit, pendingBase, type WlmEdit } from '../src/game/wlmEdit';
import { buildView } from '../src/game/view';
import { hourAttainment, MECHANISMS, TRIGGERS } from '../src/game/sla';
import type { ClassificationRule, ServiceDefinition } from '../src/sim/wlm/types';
import { goalText } from '../src/sim/wlm/goals';
import { renderReport, REPORT_KINDS, type ReportKind } from '../src/sim/measure/reports';
import { DAY_START_HOUR, TICK_SEC, TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/core/units';
import { buildMon3 } from '../src/game/mon3';
import { emptyMon3PinHistory, mon3PinRange, mon3PinsAt, recordMon3Pins, type Mon3PinHistory } from '../src/game/mon3PinHistory';
import type { SmfKind } from '../src/worker/protocol';


export type PlayCommand =
  | { cmd: 'new'; seed: number; difficulty?: DifficultyId; scenario?: string }
  | { cmd: 'start' }
  | { cmd: 'advance'; hours: number }
  | { cmd: 'change'; req: ChangeRequest }
  /** Withdraw a planned change (ids in status); capex back, hours back on the day they were spent. */
  | { cmd: 'cancel'; changeId: number }
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
  version: 1;
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
      return done(started, `Day started (06:00).${failed ? ` Policy activation failed; its edits are pending again (activate to reschedule).` : ''}`, true, failed ?? file.pendingPolicy);
    }
    case 'note':
      return c.text.trim() ? done(run, 'Noted.') : fail('Empty note');
    case 'advance': {
      if (run.phase !== 'LIVE') return fail(`Nothing to advance in phase ${run.phase}; use start.`);
      const hours = Math.max(1, Math.min(24, Math.floor(c.hours)));
      let r = run;
      let mon3 = file.mon3;
      // Record a Monitor III range every MINTIME, as the browser's worker does.
      const step = (x: RunState): RunState => {
        if (!hasFeature(x, 'MON3')) return advance(x, sc(x), content, TICKS_PER_HOUR);
        for (let left = TICKS_PER_HOUR; left > 0 && x.phase === 'LIVE'; ) {
          const k = Math.min(left, MON3_HISTORY.mintimeTicks - (x.sim.tick % MON3_HISTORY.mintimeTicks));
          x = advance(x, sc(x), content, k);
          left -= k;
          if (x.sim.tick % MON3_HISTORY.mintimeTicks === 0) mon3 = recordMon3Pins(mon3 ?? emptyMon3PinHistory(), x.sim.tick, buildMon3(x, sc(x)));
        }
        return x;
      };
      const abended = (x: RunState) => new Set(buildView(x, sc(x)).batch.abended.map((a) => `${a.day}:${a.name}`));
      const before = abended(run);
      let fresh: string[] = [];
      // Stop at the hour a job abends, as an operator would be paged.
      for (let h = 0; h < hours && r.phase === 'LIVE' && fresh.length === 0; h++) {
        r = step(r);
        if (r.phase === 'LIVE') fresh = buildView(r, sc(r)).batch.abended.filter((a) => !before.has(`${a.day}:${a.name}`)).map((a) => a.name);
      }
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
    case 'cancel': {
      const o = cancelChange(run, c.changeId);
      if (o.restoredPolicy && !file.pendingPolicy) return done(o.run, `${o.message}; its edits are pending again (activate to reschedule)`, o.ok, o.restoredPolicy);
      return done(o.run, o.message, o.ok);
    }
    case 'draft': {
      if (run.phase !== 'REVIEW') return fail('Drafts are chosen in the end-of-day review.');
      return done(chooseDraft(run, content, c.optionId), c.optionId ? `Drafted ${c.optionId}.` : 'Draft skipped.');
    }
    case 'rca': {
      if (!MECHANISMS.includes(c.mechanism) || !TRIGGERS.includes(c.trigger)) return fail(`Mechanism one of ${MECHANISMS.join(' ')}; trigger one of ${TRIGGERS.join(' ')}`);
      const inc = run.incidents.find((i) => i.id === c.incidentId);
      if (!inc) return fail(`No incident ${idText('incident', c.incidentId)}`);
      if (inc.rca) return fail(`Incident ${idText('incident', c.incidentId)} already has an RCA`);
      const missing = (c.evidenceIds ?? []).filter((id) => !run.pins.some((p) => p.id === id));
      if (missing.length && !run.pins.length) return fail('No pins yet. Pin report rows first (e.g. pin WLMGL <interval id> *PLEX ONLHI#1 PI; see catalog), or file the RCA without --evidence.');
      if (missing.length) return fail(`No pinned evidence ${missing.map((id) => idText('pin', id)).join(' ')}; pins: ${run.pins.map((p) => idText('pin', p.id)).join(' ')}`);
      const r = submitRca(run, c.incidentId, c.mechanism, c.trigger, sc(run), c.evidenceIds ?? []);
      const covered = r.incidents.filter((i) => i.id !== c.incidentId && i.rca && rcaLeadId(i) === rcaLeadId(inc))
        .map((i) => `${idText('incident', i.id)} ${i.workloadId}`);
      const rca = r.incidents.find((i) => i.id === c.incidentId)?.rca;
      const t = inc.truth;
      const pts = rca?.points ?? 0;
      const trustNote = pts >= 3 ? 'trust +1 on every facet' : pts > 0 ? 'trust +0.25 on every facet' : 'trust -0.5 on every facet';
      return done(r, `RCA filed for incident ${idText('incident', c.incidentId)}: ${pts} points${rca?.evidencePoints ? ` (${rca.evidencePoints} from evidence)` : ''}. Mechanism ${t.mechanism === c.mechanism ? 'right' : 'wrong'}, trigger ${t.trigger === c.trigger ? 'right' : 'wrong'} (was ${t.mechanism}/${t.trigger}); ${trustNote}.${covered.length ? ` Also covers the same-cause incidents ${covered.join(', ')}.` : ''}`);
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
      if (req.source === 'DB2' || req.source === 'CICS') {
        const hour = smfHourKey(run, req.hour);
        if (hour === null) return fail(`No SMF hour ${req.hour}; hours as \`smf ${req.source}\` lists them (\`10\` = newest 10:00, \`D3 10\` = day 3)`);
        req = { ...req, hour };
      }
      if (c.at !== undefined) {
        if (req.source !== 'MON3' && !(req.source === 'CPC' && req.index === undefined)) return fail('--at takes a Monitor III time (pin MON3 or pin CPC without an interval id)');
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
      const res = applyWlmEdit(pendingBase(file.pendingPolicy, run.sim.wlm.definition), c.edit);
      if (typeof res === 'string') return fail(res);
      return done(run, `Pending policy ${res.policyName} updated. ${run.phase === 'REVIEW' ? "close the day (draft <id|none>), then activate at tomorrow's briefing to install it." : 'activate to install it.'}`, true, res);
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
      const res = applyReportClassAdvice(pendingBase(file.pendingPolicy, run.sim.wlm.definition), runWorkItems(sc(run), run), c.workloadId || null);
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

/** What the player can see: the same fields the browser shows, never the incident ground truth. */
export function statusText(file: PlayFile): string {
  const run = file.run;
  const v = buildView(run, sc(run));
  const out: string[] = [];
  out.push(`${v.phase}  day ${v.day + 1}/${v.maxDays} ${v.weekday}  ${clockText(run.sim.tick)}  difficulty ${v.difficulty.name}  seed ${v.seed}`);
  out.push(`trust ${v.trustOverall.toFixed(1)} (${Object.keys(v.trust).map((f) => `${f} ${v.trust[f]!.toFixed(0)}`).join(', ')})  score ${v.score}`);
  out.push(`engineer-hours left ${v.hoursLeft}  insight ${v.insight}  capex $${Math.round(v.capexRemaining).toLocaleString()}  MLC month est $${Math.round(v.mlcEstimate).toLocaleString()} (billed on the month's peak R4HA so far, so a cap saves only if it lowers that peak) / opex budget $${Math.round(v.opexBudget).toLocaleString()}`);
  out.push(`policy ${v.policyName}${file.pendingPolicy ? `  (pending policy edits in ${file.pendingPolicy.policyName}: activate in BRIEFING or LIVE)` : ''}  tools ${v.tools.filter((t) => t.owned).map((t) => (t.trialLastDay !== null ? `${t.id}(trial to day ${t.trialLastDay + 1})` : t.id)).join(' ') || 'none'}`);
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
      out.push(`SLA last hour (${String(prev.hourOfDay).padStart(2, '0')}:00): ${rows.join('  ') || 'none'}`);
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
    const ws = v.incidents.filter((i) => i.rcaGroup === id).map((i) => `${idText('incident', i.id)} ${i.workloadId}`);
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
  const rows = pick(m.rows, (x) => x.system);
  if (sys && !systems.length && !cpc.length) return `No system ${opts.system}; systems: ${m.systems.map((x) => x.system).join(' ')}`;
  const when = run.phase === 'LIVE' ? `range ending ${clockText(run.sim.tick)}` : `snapshot from ${clockText(run.sim.tick)} (not live: phase ${run.phase})`;
  const head = `Monitor III, last ${m.rangeSec}s, ${when}. Policy ${m.policy}. CPC logical:physical CP ratio ${m.logicalToPhysical.toFixed(2)}.`;
  if (opts.json) return [head, ...systems.map((x) => JSON.stringify(x)), ...cpc.map((x) => JSON.stringify(x)), ...rows.map((x) => JSON.stringify(x)), ...m.enclaves.map((x) => JSON.stringify(x)), ...m.exceptions.map((x) => 'EXCEPTION ' + JSON.stringify(x))].join('\n');
  const out = [head, `History (mon3 [system] --at D2 10:40; pin MON3|CPC ... --at D2 10:40): ${mon3RangeText(file)}.`, '', 'SYSINFO', table(systems), '', 'CPC', table(cpc), '', 'DELAY (fractions of active samples)', table(rows, ['serviceClass', 'period', 'goalVelocity', 'goalRtMs', 'goalPct', 'avgUsers', 'iipcpEngines'])];
  if (m.enclaves.length && !sys) out.push('', 'ENCLAVE', table(m.enclaves));
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

/** The WLM service definition (active, or the pending edits) and the configuration it runs on. */
export function policyText(file: PlayFile, pending: boolean): string {
  const run = file.run;
  if (pending && !file.pendingPolicy) return 'No pending policy edits.';
  const def = pending ? file.pendingPolicy! : run.sim.wlm.definition;
  const out = [`${pending ? 'pending' : 'active'} policy ${def.policyName}  CICS regions managed by ${def.cicsRegionMode ?? 'TRANSACTION'} goals  I/O priority management ${def.ioPriorityManagement === false ? 'NO' : 'YES'}`];
  out.push('service classes (period: goal, duration SU):');
  for (const c of def.classes) {
    const periods = c.periods.map((p, i) => `#${i + 1} ${goalText(p)}${p.durationSu !== null ? ` DUR ${p.durationSu}` : ''}`).join('; ');
    const flags = [c.cpuCritical && 'CPU-critical', c.storageCritical && 'storage-critical', c.resourceGroup && `RG ${c.resourceGroup}`, c.honorPriority === false && 'zIIP honor priority NO'].filter(Boolean).join(', ');
    out.push(`  ${c.id}: ${periods}${flags ? `  [${flags}]` : ''}`);
  }
  if (def.resourceGroups.length) out.push(`resource groups: ${def.resourceGroups.map((g) => `${g.id} type ${g.type} min ${g.min ?? '-'} max ${g.max ?? '-'}`).join(', ')}`);
  if (def.reportClasses.length) out.push(`report classes: ${def.reportClasses.join(' ')}`);
  out.push('classification rules (subsystem: qualifier=pattern → service class / report class):');
  const rule = (r: ClassificationRule, depth: number): string[] => [
    `${'  '.repeat(depth + 2)}${r.qualifier}=${r.pattern} → ${r.serviceClass ?? '(inherit)'}${r.reportClass ? ` / ${r.reportClass}` : ''}`,
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
  out.push('evidence pins (pin SOURCE ...; then rca INC MECH TRIG --evidence 1,2): sources WLMGL <interval id> <system> <scKey> <metric> | MON3 <system> <scKey> <metric> [--at D2 10:40] | CPC <lparId> PRSM_DELAY|CAPPED [interval id, as in Partition Data | --at D2 10:40 for a past Monitor III range] | DB2|CICS <hour> <workloadId> <metric> | BATCH <day as labelled, e.g. D2> <JOB_* metric>');
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
  const f = formatClock(tick);
  return `${f.slice(0, f.indexOf(' '))} ${WEEKDAYS[clockAt(tick).dayOfWeek]} ${f.slice(-8, -3)}`;
}
/** `D2 10:40` or `D2 Tue 10:40` (as clockText prints it) → tick; the small hours belong to the played day before. */
export function tickOfClock(text: string): number | null {
  const m = /^D(\d+)\s+(?:[A-Za-z]{3}\s+)?(\d{1,2}):(\d{2})$/i.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]) - 1, hh = Number(m[2]), mm = Number(m[3]);
  if (day < 0 || hh > 23 || mm > 59) return null;
  const sec = ((hh - DAY_START_HOUR + 24) % 24) * 3600 + mm * 60;
  return day * TICKS_PER_DAY + Math.floor(sec / TICK_SEC);
}

function mon3RangeText(file: PlayFile): string {
  const r = file.mon3 ? mon3PinRange(file.mon3) : null;
  return r ? `history covers ${clockText(r.firstTick)} to ${clockText(r.lastTick)}, one range every ${(MON3_HISTORY.mintimeTicks * TICK_SEC).toFixed(0)}s` : 'no Monitor III history yet (it is recorded while the day runs, once RMF_MON3 is owned)';
}

const intervalLabel = (iv: { startTick: number; endTick: number }) => `${clockText(iv.startTick)}–${clockText(iv.endTick).slice(-5)}`;

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
