// The game runs here, off the UI thread. At 1× a played day (8640 ticks) takes 10 minutes.

import { difficultyOf, scenarioFor } from '../game/difficulty';
import type { Command } from '../sim/core/commands';
import { MIDWEST_GAME } from '../content/game-midwest';
import { packOf } from '../content/packs';
import { MIDWEST } from '../content/scenarios';
import { advance, chooseDraft, continueEndless, newRun, startDay } from '../game/run';
import { applyGameCommand, type GameCommand, type GameCommandResult } from '../game/commands';
import { advanceHours } from '../game/advance';
import type { RunState } from '../game/types';
import { noteReportOpened, normalizeDefinition, REPORT_FEATURE, hasFeature, SMF_FEATURE } from '../game/tools';
import { batchNight, cicsMonitoring, cicsStorageStats, db2Accounting, db2Blockers, db2Statistics, smf113 } from '../game/smf';
import { addAlertRule, removeAlertRule } from '../game/alerts';
import { addAutoRule, removeAutoRule } from '../game/automation';
import { policyEditSource, savedPolicy } from '../game/policies';
import { forkForWhatIf, summarizeWhatIf, whatIfContent } from '../game/whatif';
import { INSIGHT } from '../content/tools';
import { financeView } from '../game/finance';
import { offerTfp } from '../game/tfp';
import { adviseReportClasses } from '../game/rcAdvisor';
import { buildView } from '../game/view';
import { cicsTransactionClasses, serviceClassGoalIssues } from '../game/wlmEdit';
import type { ServiceDefinition } from '../sim/wlm/types';
import { renderReport } from '../sim/measure/reports';
import { OLD_SAVE_MESSAGE, SAVE_VERSION, assertSaveVersion, decodeRunFileText, decodeRunJson, encodeRunJson } from '../game/runFile';
import { basketAfterFailure } from '../game/changeDesk';
import { HISTORY_EVERY_TICKS, HISTORY_MAX, samplePoint, type HistoryPoint } from '../game/history';
import { buildMon3 } from '../game/mon3';
import { emptyMon3History, mon3At, mon3HistoryRange, recordMon3History } from '../game/mon3History';
import { classify } from '../sim/wlm/classify';
import { explainClassification } from '../game/classifyExplain';
import { runWorkItems } from '../game/workloads';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../sim/core/units';
import { goalText } from '../sim/wlm/goals';
import { AUTO_SPEED, type FromWorker, type PendingPolicyView, type SmfData, type ToWorker } from './protocol';
import { loadCareer, loadDesk, loadRun, saveCareer, saveRun, type DeskState } from './storage';
import { EMPTY_CAREER, recordRun, runXp, setStartingPerk, type CareerState } from '../game/career';
import type { DayTrace, DayTraceCommand } from '../game/dayTrace';

/** The run's scenario pack (sim scenario + game content). */
const pack = () => packOf(run.scenarioId);
/** The scenario as this run's difficulty shapes it (memoised). */
const sc = () => scenarioFor(pack().scenario, run.difficulty);
/** Ticks per real second at 1×: 8640 ticks / 600 s. */
const TICKS_PER_SEC_1X = 14.4;
const FRAME_MS = 100;

let run: RunState = newRun(MIDWEST, MIDWEST_GAME, Date.now() % 100000);
let speed = 1;
const IRONMAN_MIN_SPEED = 0.5;
const canPause = () => run.phase !== 'LIVE' || difficultyOf(run.difficulty).pauseAllowed;
let pendingPolicy: ServiceDefinition | null = null;
let carry = 0;
/** Speed to return to when an auto-run day ends. */
let speedBeforeAuto = 1;
// Wall-clock budget per frame for auto-run; the sim itself never reads the clock.
const AUTO_FRAME_BUDGET_MS = 60;

let history: HistoryPoint[] = [];
let historyDirty = true;
/** Monitor III intervals for the retention window (recorded only while the Monitor III tool is owned). */
let mon3Hist = emptyMon3History();
let saved: RunState | null = null;
let career: CareerState = EMPTY_CAREER;
/** XP the run that just ended added to the career (shown on the end screen). */
let lastRunXp: number | null = null;
let savedDesk: DeskState | null = null;
const LIVE_SAVE_EVERY_TICKS = 360; // one sim hour
let lastLiveSaveHour = -1;
let liveSaveInFlight = false;
/** Live-day saves: each sim hour, but at least every 30 real seconds (a reload or closed tab can't flush a save:
 * the worker is gone before IndexedDB commits) and not more often than every couple of seconds at high speed. */
const LIVE_SAVE_MAX_MS = 30_000;
const LIVE_SAVE_MIN_MS = 2000;
let lastLiveSaveMs = 0;
/** Mirror of the UI's change basket, so it can be saved with the run. */
let basket: Command[] = [];
/** The live day's trace (PT-17): the 06:00 start state and every action during the day, so `inspect … wlm --at`
 *  can replay a browser save to any time in its current day. Kept in the desk save, so a reload keeps it. */
let dayTrace: DayTrace | null = null;
/** Record one action of the live day (the tick it is applied at). Outside a live day nothing records: briefing
 *  actions are part of the next day's start state, and the ended day's trace is kept as it was. Dev fast-forwards
 *  (DEV_*) do not record; the states they skip past are not replayable. */
function trace(command: DayTraceCommand) {
  if (!dayTrace || run.phase !== 'LIVE') return;
  dayTrace = { ...dayTrace, commands: [...dayTrace.commands, { tick: run.sim.tick, command }] };
}
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** False until the previous save has been read: nothing may overwrite it before then. */
let storageReady = false;
let lastPhase = run.phase;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);
function pendingView(): PendingPolicyView | null {
  if (!pendingPolicy) return null;
  return {
    policyName: pendingPolicy.policyName,
    classes: pendingPolicy.classes.map((c) => ({ id: c.id, periods: c.periods.map((p) => goalText(p)), cpuCritical: c.cpuCritical, resourceGroup: c.resourceGroup })),
    resourceGroups: pendingPolicy.resourceGroups,
    classDefs: pendingPolicy.classes,
    ioPriorityManagement: pendingPolicy.ioPriorityManagement !== false,
    rules: pendingPolicy.subsystems.flatMap((ss) =>
      ss.rules.map((r) => ({ subsystem: ss.subsystem, text: `${r.qualifier}=${r.pattern} → ${r.serviceClass ?? '(default)'}${r.regionMode ? ` [${r.regionMode}]` : ''}` })),
    ),
    cicsClasses: cicsTransactionClasses(pendingPolicy),
    goalIssues: serviceClassGoalIssues(pendingPolicy),
  };
}

const currentItems = () => runWorkItems(sc(), run);

/** Adopt an action's outcome and tell the player how it went. */
/** Hand the changes of requests that just failed back to the Change Desk basket, and say so. */
function returnFailed(before: RunState) {
  const back = basketAfterFailure(before, run, basket);
  if (!back) return;
  const n = back.length - basket.length;
  basket = back;
  post({ type: 'BASKET', basket });
  post({ type: 'RESULT', ok: false, message: `The failed change was backed out: ${n > 0 ? `${n} change${n === 1 ? ' is' : 's are'} back` : 'its changes are back'} in the change request, to retry or edit.` });
}

function settle(out: { run: RunState; ok: boolean; message: string }) {
  run = out.run;
  post({ type: 'RESULT', ok: out.ok, message: out.message });
}

/** Run a command of the shared layer (src/game/commands.ts) against the current run and pending policy. */
const command = (cmd: GameCommand) => applyGameCommand(run, pendingPolicy, cmd, pack().game, sc());

/** Adopt a shared command's outcome and post its reply. The layer owns the rule; this adapter records the action
 *  (for the day trace) and shows the result. */
function settleGame(out: GameCommandResult) {
  // The policy views show the pending edits or, without them, the planned policy: an activation or a cancel with no
  // pending edits changes the second, so compare what is shown, not only the pending policy.
  const shown = pendingPolicy ?? policyEditSource(run);
  settle(out);
  pendingPolicy = out.pending;
  if ((pendingPolicy ?? policyEditSource(run)) !== shown) postPolicy();
}

function postRules() {
  const items = currentItems();
  const def = pendingPolicy ?? policyEditSource(run);
  post({
    type: 'RULES',
    active: explainClassification(run.sim.wlm.definition, items),
    pending: def !== run.sim.wlm.definition ? explainClassification(def, items) : null,
    classIds: ['SYSTEM', 'SYSSTC', 'SYSOTHER', ...def.classes.map((c) => c.id)],
    advice: hasFeature(run, 'REPORT_CLASS_ADVISOR') ? adviseReportClasses(def, items) : null,
  });
}

// Every policy change (edit, activation, discard) refreshes both the JSON and the rules view.
const postPolicy = () => {
  post({ type: 'POLICY', json: JSON.stringify(pendingPolicy ?? policyEditSource(run), null, 2) });
  postRules();
};


const sendView = () => {
  post({ type: 'VIEW', view: buildView(run, sc()), history: historyDirty ? history : null, savedRunDay: saved ? saved.day : null, pending: pendingView(), speed, mon3Range: mon3HistoryRange(mon3Hist) });
  historyDirty = false;
};

/** Advance in chunks so the chart history gets a sample every five minutes. */
function advanceSampled(n: number) {
  run = advanceHours(run, pack().game, n / TICKS_PER_HOUR, {
    onChunk: (r) => {
      if (r.sim.tick % HISTORY_EVERY_TICKS === 0) {
        history = [...history, samplePoint(r)].slice(-HISTORY_MAX);
        historyDirty = true;
      }
    },
    onMintime: (r) => {
      mon3Hist = recordMon3History(mon3Hist, r.sim.tick, buildMon3(r, scenarioFor(pack().scenario, r.difficulty)));
    },
  });
  autosave();
}

const postCareer = () => post({ type: 'CAREER', career, lastRunXp });

/** Add a finished run to the career once (endless continuation and reloads never count it again). */
function recordCareer() {
  if ((run.phase !== 'GAMEOVER' && run.phase !== 'VICTORY') || run.careerRecorded || !storageReady) return;
  const rep = buildView(run, sc()).endReport;
  if (!rep) return;
  lastRunXp = runXp(rep, run.difficulty);
  career = recordRun(career, rep, run.difficulty);
  run = { ...run, careerRecorded: true };
  void saveCareer(career);
  postCareer();
}

/** Save whenever the phase changes (end of day, game over) so a reload resumes there, and through the live day
 * (see LIVE_SAVE_MAX_MS) so a crash or reload costs at most about 30 s of play (and cannot replay the day from its briefing). */
function autosave() {
  if (spectating) return;
  if (run.phase !== lastPhase) {
    lastPhase = run.phase;
    recordCareer();
    lastLiveSaveHour = Math.floor(run.sim.tick / LIVE_SAVE_EVERY_TICKS);
    if (run.phase !== 'LIVE' && storageReady) {
      // This run now replaces any older save still on offer, so stop offering it (and stop blocking saves).
      saved = null;
      savedDesk = null;
      void saveRun(run, desk());
    }
    return;
  }
  const hour = Math.floor(run.sim.tick / LIVE_SAVE_EVERY_TICKS);
  const now = performance.now();
  const due = hour !== lastLiveSaveHour ? now - lastLiveSaveMs >= LIVE_SAVE_MIN_MS : now - lastLiveSaveMs >= LIVE_SAVE_MAX_MS;
  if (run.phase === 'LIVE' && due && storageReady && saved === null && !liveSaveInFlight) {
    lastLiveSaveHour = hour;
    lastLiveSaveMs = now;
    liveSaveInFlight = true;
    void saveRun(run, desk()).finally(() => (liveSaveInFlight = false));
  }
}

const desk = (): DeskState => ({ pendingPolicy, basket, dayTrace });

/** Save soon after any action (planned changes, purchases, project hours, the basket, pending WLM edits), live day
 * included: outside it shortly after the last action, during it at most every few seconds. Never while an older save
 * is still on offer: it is only replaced once this run reaches a phase change. */
const LIVE_PERSIST_MS = 3000;
function persistSoon() {
  if (spectating) return;
  if (!storageReady || saved !== null) return;
  const live = run.phase === 'LIVE';
  if (persistTimer) {
    if (live) return;
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveNow();
  }, live ? LIVE_PERSIST_MS : 400);
}

function saveNow() {
  if (spectating || !storageReady || saved !== null) return;
  if (run.phase === 'LIVE') lastLiveSaveHour = Math.floor(run.sim.tick / LIVE_SAVE_EVERY_TICKS);
  void saveRun(run, desk());
}

/** Same shape as tools/playCore.ts PlayFile, so `npm run play -- <file> status` and spectator mode can read it.
 *  The day trace rides along (PT-17): it is what makes `inspect … wlm --at` work on a browser save. */
function runFileText(): string {
  return encodeRunJson({ version: SAVE_VERSION, run, pendingPolicy, ...(dayTrace ? { dayTrace } : {}), log: [{ cmd: 'note', text: `Exported from the browser on day ${run.day + 1}` }] });
}

function importRun(text: string) {
  const f = decodeRunFileText<{ run?: RunState; pendingPolicy?: ServiceDefinition | null; dayTrace?: DayTrace | null }>(text);
  if (!f?.run?.sim || !f.run.scenarioId) throw new Error('Not a GOAL MODE run file');
  assertSaveVersion(f.run);
  run = f.run;
  lastPhase = run.phase;
  speed = 0;
  whatIf = null;
  history = [];
  mon3Hist = emptyMon3History();
  if (run.phase === 'LIVE') history = [samplePoint(run)];
  historyDirty = true;
  saved = null;
  savedDesk = null;
  pendingPolicy = f.pendingPolicy ? normalizeDefinition(f.pendingPolicy) : null;
  basket = [];
  // Keep the imported day's trace when it belongs to this run, so the day stays traceable into its past.
  dayTrace = f.dayTrace && f.dayTrace.start.seed === run.seed ? f.dayTrace : null;
  postPolicy();
  post({ type: 'BASKET', basket });
  saveNow();
}

void Promise.all([loadRun(), loadDesk(), loadCareer()]).then(([r, d, c]) => {
  career = c ?? EMPTY_CAREER;
  postCareer();
  if (r && r.version !== SAVE_VERSION) post({ type: 'RESULT', ok: false, message: OLD_SAVE_MESSAGE });
  saved = r && r.version === SAVE_VERSION ? r : null;
  savedDesk = d;
  storageReady = true;
  sendView();
});

setInterval(() => {
  if (run.phase !== 'LIVE' || speed <= 0) return;
  if (speed === AUTO_SPEED) {
    const t0 = performance.now();
    while (run.phase === 'LIVE' && !run.alerts?.pauseRequested && performance.now() - t0 < AUTO_FRAME_BUDGET_MS) advanceSampled(HISTORY_EVERY_TICKS);
    if (run.phase !== 'LIVE') speed = speedBeforeAuto;
  } else {
    carry += (TICKS_PER_SEC_1X * speed * FRAME_MS) / 1000;
    const n = Math.floor(carry);
    if (n <= 0) return;
    carry -= n;
    advanceSampled(n);
  }
  if (run.alerts?.pauseRequested) {
    // A pausing alert rule fired: stop the clock (Ironman: drop to the slowest speed) and tell the player why.
    speed = canPause() ? 0 : IRONMAN_MIN_SPEED;
    carry = 0;
    const page = [...run.alerts.log].reverse().find((e) => e.kind === 'FIRED');
    run = { ...run, alerts: { ...run.alerts, pauseRequested: false } };
    post({ type: 'RESULT', ok: false, message: `Paused: ${page?.text ?? 'alert fired'}` });
  }
  sendView();
}, FRAME_MS);

// What-if forks run in chunks between messages so the worker stays responsive.
let whatIf: { token: number; label: string; base: RunState; prop: RunState; ticks: number } | null = null;
let whatIfToken = 0;
function whatIfChunk(token: number) {
  const w = whatIf;
  if (!w || w.token !== token) return;
  const forkContent = whatIfContent(pack().game);
  w.base = advance(w.base, sc(), forkContent, INSIGHT.whatIfChunkTicks);
  w.prop = advance(w.prop, sc(), forkContent, INSIGHT.whatIfChunkTicks);
  w.ticks += INSIGHT.whatIfChunkTicks;
  if (w.base.phase === 'LIVE' || w.prop.phase === 'LIVE') {
    post({ type: 'WHATIF_PROGRESS', frac: Math.min(1, w.ticks / TICKS_PER_DAY) });
    setTimeout(() => whatIfChunk(token), 0);
    return;
  }
  post({ type: 'WHATIF_RESULT', label: w.label, base: summarizeWhatIf(w.base), proposal: summarizeWhatIf(w.prop) });
  whatIf = null;
}

/** Spectator mode shows a run file another process plays; only reading messages get through. */
let spectating = false;
const SPECTATOR_OK = new Set<ToWorker['type']>(['SPECTATE', 'EXPORT_RUN', 'SPECTATE_ADOPT', 'GET_REPORT', 'GET_POLICY', 'GET_RULES', 'GET_SMF', 'GET_FINANCE', 'GET_MON3_CHARTS', 'GET_MON3_AT', 'CLASSIFY', 'SET_BASKET']);

function spectate(text: string) {
  const f = decodeRunJson<{ run: RunState; pendingPolicy: ServiceDefinition | null; dayTrace?: DayTrace | null }>(text);
  assertSaveVersion(f.run);
  const next = f.run;
  // Same run moving forward: extend the charts; otherwise (new run, earlier file) start them over.
  const sameRun = spectating && next.seed === run.seed && next.sim.tick >= run.sim.tick;
  spectating = true;
  speed = 0;
  whatIf = null;
  saved = null;
  if (!sameRun) {
    history = [];
    mon3Hist = emptyMon3History();
  }
  run = next;
  lastPhase = run.phase;
  if (run.phase === 'LIVE' && history.at(-1)?.tick !== run.sim.tick) history = [...history, samplePoint(run)].slice(-HISTORY_MAX);
  historyDirty = true;
  pendingPolicy = f.pendingPolicy ? normalizeDefinition(f.pendingPolicy) : null;
  // Follow the watched file's own trace (a browser save it may carry), so adopting it keeps its day traceable.
  dayTrace = f.dayTrace && f.dayTrace.start.seed === run.seed ? f.dayTrace : null;
  postPolicy();
}

/** Exhaustiveness guard for the message switch: an unhandled `ToWorker` type is a type error here. An untyped
 *  sender's unknown type throws, where the switch used to fall through to `sendView()`. */
function assertNever(x: never): never {
  throw new Error(`Unhandled worker message: ${JSON.stringify(x)}`);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (spectating && !SPECTATOR_OK.has(m.type)) return;
  switch (m.type) {
    case 'SPECTATE':
      try {
        spectate(m.text);
      } catch (e) {
        post({ type: 'RESULT', ok: false, message: `Spectate failed: ${(e as Error).message}` });
      }
      break;
    case 'SPECTATE_ADOPT':
      if (!spectating) break;
      spectating = false;
      lastLiveSaveHour = Math.floor(run.sim.tick / LIVE_SAVE_EVERY_TICKS);
      if (storageReady) void saveRun(run, desk());
      break;
    case 'NEW_RUN':
      whatIf = null;
      pendingPolicy = null;
      basket = [];
      dayTrace = null;
      post({ type: 'BASKET', basket });
      postPolicy();
      run = newRun(packOf(m.scenario).scenario, packOf(m.scenario).game, m.seed, m.difficulty, m.daily);
      lastRunXp = null;
      postCareer();
      history = [];
      mon3Hist = emptyMon3History();
      historyDirty = true;
      // An older save stays on offer (Continue saved run) until this run reaches a phase change.
      break;
    case 'SAVE_NOW':
      saveNow();
      break;
    case 'EXPORT_RUN':
      post({ type: 'RUN_FILE', name: `goal-mode-${run.scenarioId}-${run.seed}-day${run.day + 1}.json`, text: runFileText() });
      break;
    case 'IMPORT_RUN':
      // Its own message kind: the dialog must not infer the outcome from a toast's wording (PR-05).
      try {
        importRun(m.text);
        post({ type: 'IMPORT_RESULT', ok: true, message: `Loaded run: ${run.scenarioId}, seed ${run.seed}, day ${run.day + 1}` });
      } catch (e) {
        post({ type: 'IMPORT_RESULT', ok: false, message: `Import failed: ${(e as Error).message}` });
      }
      break;
    case 'CONTINUE_SAVED':
      if (saved) {
        run = saved;
        lastPhase = run.phase;
        history = [];
        mon3Hist = emptyMon3History();
        historyDirty = true;
        saved = null;
        pendingPolicy = savedDesk?.pendingPolicy ? normalizeDefinition(savedDesk.pendingPolicy) : null;
        basket = savedDesk?.basket ?? [];
        // The resumed day keeps its trace (seed-checked), so a reload does not cost the day its past.
        dayTrace = savedDesk?.dayTrace && savedDesk.dayTrace.start.seed === run.seed ? savedDesk.dayTrace : null;
        savedDesk = null;
        postPolicy();
        post({ type: 'BASKET', basket });
      }
      break;
    case 'CONTINUE_ENDLESS':
      run = continueEndless(run, pack().game);
      break;
    case 'SET_BASKET':
      basket = m.basket;
      break;
    case 'DEV_INSIGHT':
      if (import.meta.env.DEV) run = { ...run, insight: run.insight + m.amount };
      break;
    case 'DEV_TFP_OFFER':
      if (import.meta.env.DEV && !run.tfpOffer) run = offerTfp(run, sc());
      break;
    case 'DEV_FAST_DAYS':
      // Play whole days headlessly (skipping drafts) to reach later-game states quickly.
      if (import.meta.env.DEV) {
        for (let d = 0; d < m.days && run.phase !== 'GAMEOVER' && run.phase !== 'VICTORY'; d++) {
          if (run.phase === 'REVIEW') run = chooseDraft(run, pack().game, null);
          if (run.phase === 'BRIEFING') run = startDay(run, pack().game);
          run = advance(run, sc(), pack().game, TICKS_PER_DAY);
        }
        if (run.phase === 'REVIEW') run = chooseDraft(run, pack().game, null);
        lastPhase = run.phase;
        recordCareer();
        history = [];
        mon3Hist = emptyMon3History();
        historyDirty = true;
      }
      break;
    case 'GET_MON3_CHARTS': {
      const c = run.mon3Charts;
      if (!c || !hasFeature(run, 'MON3_CHARTS')) break;
      post({ type: 'MON3_CHARTS', fromSample: m.fromSample, fromMarker: m.fromMarker, samples: c.samples.slice(m.fromSample), markers: c.markers.slice(m.fromMarker) });
      break;
    }
    case 'GET_MON3_AT': {
      const at = hasFeature(run, 'MON3') ? mon3At(mon3Hist, m.tick) : null;
      post({ type: 'MON3_AT', tick: at?.tick ?? m.tick, view: at?.view ?? null });
      break;
    }
    case 'WHATIF_RUN': {
      if (!hasFeature(run, 'WHAT_IF')) break;
      if (run.phase !== 'BRIEFING') {
        post({ type: 'RESULT', ok: false, message: 'What-if runs during the briefing' });
        break;
      }
      if (run.hoursLeft < INSIGHT.whatIfHours) {
        post({ type: 'RESULT', ok: false, message: `A what-if needs ${INSIGHT.whatIfHours}h` });
        break;
      }
      run = { ...run, hoursLeft: run.hoursLeft - INSIGHT.whatIfHours, insight: run.insight + INSIGHT.perWhatIf };
      whatIfToken++;
      whatIf = { token: whatIfToken, label: m.label, base: forkForWhatIf(run, pack().game, []), prop: forkForWhatIf(run, pack().game, m.commands), ticks: 0 };
      post({ type: 'WHATIF_PROGRESS', frac: 0 });
      const token = whatIfToken;
      setTimeout(() => whatIfChunk(token), 0);
      break;
    }
    case 'PROJECT_WORK': {
      trace({ cmd: 'project', id: m.id, hours: m.hours });
      settleGame(command({ kind: 'PROJECT', id: m.id, hours: m.hours }));
      break;
    }
    case 'ASK_AROUND': {
      trace({ cmd: 'ask', topic: m.topic, workloadId: m.workloadId });
      settleGame(command({ kind: 'ASK', topic: m.topic, workloadId: m.workloadId ?? null }));
      break;
    }
    case 'TFP_DECIDE': {
      trace({ cmd: 'tfp', accept: m.accept });
      settleGame(command({ kind: 'TFP', accept: m.accept }));
      post({ type: 'FINANCE', finance: financeView(run, sc()) });
      break;
    }
    case 'GET_FINANCE':
      post({ type: 'FINANCE', finance: financeView(run, sc()) });
      break;
    case 'GET_SMF': {
      const need = SMF_FEATURE[m.kind];
      if (!hasFeature(run, need)) break;
      if (m.kind !== 'SMF113' && m.kind !== 'BATCH' && m.kind !== 'DB2_BLOCKERS') {
        trace({ cmd: 'reportOpened', key: `SMF:${m.kind}:${m.hour}` });
        run = noteReportOpened(run, `SMF:${m.kind}:${m.hour}`);
      }
      const data: SmfData =
        m.kind === 'DB2' ? { kind: 'DB2', hour: m.hour, rows: db2Accounting(run, sc(), m.hour) }
        : m.kind === 'DB2_BLOCKERS' ? { kind: 'DB2_BLOCKERS', tick: run.sim.tick, view: db2Blockers(run, sc()) }
        : m.kind === 'DB2_STATS' ? { kind: 'DB2_STATS', hour: m.hour, rows: db2Statistics(run, sc(), m.hour) }
        : m.kind === 'CICS' ? { kind: 'CICS', hour: m.hour, rows: cicsMonitoring(run, sc(), m.hour), storage: cicsStorageStats(run, m.hour) }
        : m.kind === 'BATCH' ? { kind: 'BATCH', night: batchNight(run) }
        : { kind: 'SMF113', rows: smf113(run) };
      post({ type: 'SMF', data });
      break;
    }
    case 'ALERT_ADD': {
      trace({ cmd: 'alertAdd', rule: m.rule });
      settle(addAlertRule(run, m.rule));
      break;
    }
    // The day trace (PT-17) records only what the replay (src/game/dayTrace.ts) can apply as the layer did: the
    // saved-policy name as the layer resolved it, and no action the layer refused.
    case 'ACTIVATE_SAVED_POLICY': {
      const name = m.name.trim().toUpperCase();
      if (savedPolicy(run, name)) trace({ cmd: 'activateSaved', name });
      settleGame(command({ kind: 'POLICY_ACTIVATE', name: m.name }));
      break;
    }
    case 'LOAD_SAVED_POLICY': {
      const out = command({ kind: 'POLICY_LOAD', name: m.name });
      if (out.ok) trace({ cmd: 'loadSaved', name: m.name.trim().toUpperCase() });
      settleGame(out);
      break;
    }
    case 'SAVE_POLICY':
    case 'DELETE_POLICY':
    case 'SET_POLICY_SCHEDULE': {
      if (m.type === 'SAVE_POLICY') {
        const out = command({ kind: 'POLICY_SAVE', name: m.name });
        if (out.ok) trace({ cmd: 'savePolicy', name: m.name.trim().toUpperCase() });
        settleGame(out);
      } else if (m.type === 'DELETE_POLICY') {
        trace({ cmd: 'deletePolicy', name: m.name.trim().toUpperCase() });
        settleGame(command({ kind: 'POLICY_DELETE', name: m.name }));
      } else {
        trace({ cmd: 'setPolicySchedule', schedule: m.schedule });
        settleGame(command({ kind: 'POLICY_SCHEDULE', schedule: m.schedule }));
      }
      break;
    }
    case 'AUTO_ADD': {
      trace({ cmd: 'autoAdd', rule: m.rule });
      settle(addAutoRule(run, m.rule));
      break;
    }
    case 'AUTO_REMOVE':
      trace({ cmd: 'autoRemove', id: m.id });
      run = removeAutoRule(run, m.id);
      break;
    case 'ALERT_REMOVE':
      trace({ cmd: 'alertRemove', id: m.id });
      run = removeAlertRule(run, m.id);
      break;
    case 'BUY_TOOL':
    case 'SET_TOOL_ACTIVE': {
      if (m.type === 'BUY_TOOL') {
        trace({ cmd: 'buy', toolId: m.toolId });
        settleGame(command({ kind: 'BUY', toolId: m.toolId }));
      } else {
        trace({ cmd: 'toolActive', toolId: m.toolId, active: m.active });
        settleGame(command({ kind: 'TOOL_ACTIVE', toolId: m.toolId, active: m.active }));
      }
      break;
    }
    case 'DEACTIVATE_COD': {
      trace({ cmd: 'deactivateCod', changeId: m.changeId });
      settleGame(command({ kind: 'COD_DEACTIVATE', changeId: m.changeId }));
      break;
    }
    case 'CANCEL_CHANGE': {
      trace({ cmd: 'cancel', changeId: m.changeId });
      settleGame(command({ kind: 'CANCEL', changeId: m.changeId }));
      break;
    }
    case 'GET_RULES':
      postRules();
      break;
    case 'CLASSIFY':
      post({ type: 'CLASSIFIED', result: classify(pendingPolicy ?? policyEditSource(run), m.work), pending: pendingPolicy !== null || policyEditSource(run) !== run.sim.wlm.definition });
      break;
    case 'SET_STARTING_PERK':
      run = setStartingPerk(run, m.perkId, career.xp);
      break;
    case 'START_DAY': {
      const before = run;
      const o = command({ kind: 'START' });
      run = o.run;
      pendingPolicy = o.pending;
      returnFailed(before);
      // PT-17: the live day's trace starts here — the state the day starts from, then every action during it.
      dayTrace = run.phase === 'LIVE' ? { start: run, pendingPolicy, commands: [] } : null;
      if (m.auto && run.phase === 'LIVE') {
        if (speed !== AUTO_SPEED) speedBeforeAuto = speed > 0 ? speed : 1;
        speed = AUTO_SPEED;
      } else if (!m.auto && speed === AUTO_SPEED) speed = speedBeforeAuto;
      break;
    }
    case 'SET_SPEED':
      if (m.speed <= 0 && !canPause()) {
        speed = IRONMAN_MIN_SPEED;
        post({ type: 'RESULT', ok: false, message: 'Ironman: the clock cannot be paused during the live day.' });
      } else {
        if (m.speed === AUTO_SPEED && speed !== AUTO_SPEED) speedBeforeAuto = speed > 0 ? speed : 1;
        speed = m.speed;
      }
      break;
    case 'CHANGE': {
      trace({ cmd: 'change', req: m.req });
      const before = run;
      settleGame(command({ kind: 'CHANGE', req: m.req }));
      returnFailed(before);
      break;
    }
    case 'DRAFT': {
      const o = command({ kind: 'DRAFT', optionId: m.optionId });
      run = o.run;
      autosave();
      break;
    }
    case 'RCA': {
      const out = command({ kind: 'RCA', incidentId: m.incidentId, mechanism: m.mechanism, trigger: m.trigger, evidenceIds: m.evidenceIds ?? [] });
      if (out.ok) trace({ cmd: 'rca', incidentId: m.incidentId, mechanism: m.mechanism, trigger: m.trigger, evidenceIds: m.evidenceIds ?? [] });
      run = out.run;
      break;
    }
    case 'OPEN_PROBLEM':
      settleGame(command({ kind: 'OPEN_PROBLEM', subject: m.subject, fromTick: m.fromTick, toTick: m.toTick }));
      break;
    case 'FILE_PROBLEM':
      settleGame(command({ kind: 'FILE_PROBLEM', recordId: m.recordId, mechanism: m.mechanism, trigger: m.trigger, evidenceIds: m.evidenceIds ?? [] }));
      break;
    case 'PIN': {
      // The Monitor III history a past-range pin resolves against; the CLI passes its side file the same way.
      const out = applyGameCommand(run, pendingPolicy, { kind: 'PIN', req: m.req }, pack().game, sc(), { mon3History: (t) => mon3At(mon3Hist, t) });
      trace({ cmd: 'pin', req: m.req, pin: out.ok ? out.run.pins.at(-1)! : null });
      settleGame(out);
      break;
    }
    case 'UNPIN':
      trace({ cmd: 'unpin', id: m.id });
      run = command({ kind: 'UNPIN', id: m.id }).run;
      break;
    case 'WLM_EDIT': {
      const out = command({ kind: 'WLM_EDIT', edit: m.edit });
      if (out.ok) trace({ cmd: 'wlm', edit: m.edit });
      settleGame(out);
      break;
    }
    case 'RC_ADVICE_APPLY': {
      const out = command({ kind: 'RC_ADVICE', workloadId: m.workloadId });
      if (out.ok) trace({ cmd: 'rcadvice', workloadId: m.workloadId });
      settleGame(out);
      break;
    }
    case 'ACTIVATE_PENDING':
      if (pendingPolicy) trace({ cmd: 'activate' });
      settleGame(command({ kind: 'ACTIVATE' }));
      break;
    case 'DISCARD_PENDING':
      trace({ cmd: 'discard' });
      settleGame(command({ kind: 'DISCARD' }));
      break;
    case 'GET_POLICY':
      postPolicy();
      break;
    case 'ACTIVATE_JSON': {
      let def: ServiceDefinition;
      try {
        def = normalizeDefinition(JSON.parse(m.json) as ServiceDefinition);
      } catch {
        post({ type: 'RESULT', ok: false, message: 'Policy JSON does not parse' });
        break;
      }
      trace({ cmd: 'activateJson', json: m.json });
      settleGame(command({ kind: 'ACTIVATE_DEFINITION', definition: def }));
      break;
    }
    case 'GET_REPORT': {
      const iv = run.sim.rmf.intervals[m.index];
      if (!iv) break;
      const need = REPORT_FEATURE[m.kind];
      if (need && !hasFeature(run, need)) {
        post({ type: 'REPORT', text: `This report needs an analytics tool (${need}). See the Analytics tab.` });
        break;
      }
      trace({ cmd: 'reportOpened', key: `${m.kind}:${m.index}` });
      run = noteReportOpened(run, `${m.kind}:${m.index}`);
      post({ type: 'REPORT', text: renderReport(iv, m.kind, m.scKey, m.system) });
      break;
    }
    default:
      assertNever(m);
  }
  if (!m.type.startsWith('GET_')) persistSoon();
  sendView();
};

sendView();

