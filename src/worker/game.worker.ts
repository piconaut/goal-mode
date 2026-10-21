// The game runs here, off the UI thread. At 1× a played day (8640 ticks) takes 10 minutes.

import { difficultyOf, scenarioFor } from '../game/difficulty';
import type { Command } from '../sim/core/commands';
import { MIDWEST_GAME } from '../content/game-midwest';
import { MIDWEST } from '../content/scenarios';
import { advance, cancelChange, chooseDraft, continueEndless, newRun, requestChange, startDay, submitRca } from '../game/run';
import type { RunState } from '../game/types';
import { buyTool, noteReportOpened, normalizeDefinition, normalizeRun, REPORT_FEATURE, setToolActive, hasFeature, SMF_FEATURE } from '../game/tools';
import { batchNight, cicsMonitoring, db2Accounting, smf113 } from '../game/smf';
import { addAlertRule, removeAlertRule } from '../game/alerts';
import { addAutoRule, removeAutoRule } from '../game/automation';
import { deletePolicy, savePolicy, setSchedule } from '../game/policies';
import { addPin, removePin } from '../game/evidence';
import { forkForWhatIf, summarizeWhatIf, whatIfContent } from '../game/whatif';
import { INSIGHT } from '../content/tools';
import { financeView } from '../game/finance';
import { decideTfp, offerTfp } from '../game/tfp';
import { askAround } from '../game/inquiries';
import { adviseReportClasses, applyReportClassAdvice } from '../game/rcAdvisor';
import { workOnProject } from '../game/projects';
import { buildView } from '../game/view';
import { applyWlmEdit, pendingBase } from '../game/wlmEdit';
import type { ServiceDefinition } from '../sim/wlm/types';
import { renderReport } from '../sim/measure/reports';
import { decodeRunJson } from '../game/runFile';
import { HISTORY_EVERY_TICKS, HISTORY_MAX, samplePoint, type HistoryPoint } from '../game/history';
import { classify } from '../sim/wlm/classify';
import { explainClassification } from '../game/classifyExplain';
import { runWorkItems } from '../game/workloads';
import { TICKS_PER_DAY } from '../sim/core/units';
import { goalText } from '../sim/wlm/goals';
import { AUTO_SPEED, type FromWorker, type PendingPolicyView, type SmfData, type ToWorker } from './protocol';
import { loadCareer, loadDesk, loadRun, saveCareer, saveRun, type DeskState } from './storage';
import { EMPTY_CAREER, recordRun, runXp, setStartingPerk, type CareerState } from '../game/career';

const BASE_SCENARIO = MIDWEST;
/** The scenario as this run's difficulty shapes it (memoised). */
const sc = () => scenarioFor(BASE_SCENARIO, run?.difficulty);
const content = MIDWEST_GAME;
/** Ticks per real second at 1×: 8640 ticks / 600 s. */
const TICKS_PER_SEC_1X = 14.4;
const FRAME_MS = 100;

let run: RunState = newRun(BASE_SCENARIO, content, Date.now() % 100000);
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
let saved: RunState | null = null;
let career: CareerState = EMPTY_CAREER;
/** XP the run that just ended added to the career (shown on the end screen). */
let lastRunXp: number | null = null;
let savedDesk: DeskState | null = null;
const LIVE_SAVE_EVERY_TICKS = 360; // one sim hour
let lastLiveSaveHour = -1;
let liveSaveInFlight = false;
/** Mirror of the UI's change basket, so it can be saved with the run. */
let basket: Command[] = [];
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
    cicsRegionMode: pendingPolicy.cicsRegionMode ?? 'TRANSACTION',
    rules: pendingPolicy.subsystems.flatMap((ss) =>
      ss.rules.map((r) => ({ subsystem: ss.subsystem, text: `${r.qualifier}=${r.pattern} → ${r.serviceClass ?? '(default)'}` })),
    ),
  };
}

const currentItems = () => runWorkItems(sc(), run);

/** Adopt an action's outcome and tell the player how it went. */
function settle(out: { run: RunState; ok: boolean; message: string }) {
  run = out.run;
  post({ type: 'RESULT', ok: out.ok, message: out.message });
}

function postRules() {
  const items = currentItems();
  const def = pendingPolicy ?? run.sim.wlm.definition;
  post({
    type: 'RULES',
    active: explainClassification(run.sim.wlm.definition, items),
    pending: pendingPolicy ? explainClassification(pendingPolicy, items) : null,
    classIds: ['SYSTEM', 'SYSSTC', 'SYSOTHER', ...def.classes.map((c) => c.id)],
    advice: hasFeature(run, 'REPORT_CLASS_ADVISOR') ? adviseReportClasses(def, items) : null,
  });
}

// Every policy change (edit, activation, discard) refreshes both the JSON and the rules view.
const postPolicy = () => {
  post({ type: 'POLICY', json: JSON.stringify(pendingPolicy ?? run.sim.wlm.definition, null, 2) });
  postRules();
};

function activate(def: ServiceDefinition) {
  const out = requestChange(run, content, { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
  if (out.ok) {
    pendingPolicy = null;
    postPolicy();
  }
  settle(out);
}

const sendView = () => {
  post({ type: 'VIEW', view: buildView(run, sc()), history: historyDirty ? history : null, savedRunDay: saved ? saved.day : null, pending: pendingView(), speed });
  historyDirty = false;
};

/** Advance in chunks so the chart history gets a sample every five minutes. */
function advanceSampled(n: number) {
  let left = n;
  while (left > 0 && run.phase === 'LIVE') {
    const toSample = HISTORY_EVERY_TICKS - (run.sim.tick % HISTORY_EVERY_TICKS);
    const k = Math.min(left, toSample);
    run = advance(run, sc(), content, k);
    left -= k;
    if (run.sim.tick % HISTORY_EVERY_TICKS === 0) {
      history = [...history, samplePoint(run)].slice(-HISTORY_MAX);
      historyDirty = true;
    }
  }
  autosave();
}

const postCareer = () => post({ type: 'CAREER', career, lastRunXp });

/** Add a finished run to the career once (endless continuation and reloads never count it again). */
function recordCareer() {
  if ((run.phase !== 'GAMEOVER' && run.phase !== 'VICTORY') || run.careerRecorded || !storageReady) return;
  const rep = buildView(run, sc()).endReport;
  if (!rep) return;
  lastRunXp = runXp(rep, run.difficulty ?? 'NORMAL');
  career = recordRun(career, rep, run.difficulty ?? 'NORMAL');
  run = { ...run, careerRecorded: true };
  void saveCareer(career);
  postCareer();
}

/** Save whenever the phase changes (end of day, game over) so a reload resumes there, and every sim hour of the
 * live day so a crash or reload costs at most an hour (and cannot replay the day from its briefing). */
function autosave() {
  if (spectating) return;
  if (run.phase !== lastPhase) {
    lastPhase = run.phase;
    recordCareer();
    lastLiveSaveHour = Math.floor(run.sim.tick / LIVE_SAVE_EVERY_TICKS);
    if (run.phase !== 'LIVE' && storageReady) void saveRun(run, desk());
    return;
  }
  const hour = Math.floor(run.sim.tick / LIVE_SAVE_EVERY_TICKS);
  if (run.phase === 'LIVE' && hour !== lastLiveSaveHour && storageReady && saved === null && !liveSaveInFlight) {
    lastLiveSaveHour = hour;
    liveSaveInFlight = true;
    void saveRun(run, desk()).finally(() => (liveSaveInFlight = false));
  }
}

const desk = (): DeskState => ({ pendingPolicy, basket });

/** Save soon after any action outside the live day (planned changes, purchases, project hours, the
 * basket and pending WLM edits), not just on phase changes. Never while an older save is still on offer:
 * it is only replaced once this run reaches a phase change, as before. */
function persistSoon() {
  if (spectating) return;
  if (!storageReady || saved !== null || run.phase === 'LIVE') return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (storageReady && saved === null && run.phase !== 'LIVE') void saveRun(run, desk());
  }, 400);
}

void Promise.all([loadRun(), loadDesk(), loadCareer()]).then(([r, d, c]) => {
  career = c ?? EMPTY_CAREER;
  postCareer();
  saved = r ? normalizeRun(r, BASE_SCENARIO) : null;
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
const forkContent = whatIfContent(content);
function whatIfChunk(token: number) {
  const w = whatIf;
  if (!w || w.token !== token) return;
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
const SPECTATOR_OK = new Set<ToWorker['type']>(['SPECTATE', 'SPECTATE_ADOPT', 'GET_REPORT', 'GET_POLICY', 'GET_RULES', 'GET_SMF', 'GET_FINANCE', 'GET_MON3_CHARTS', 'CLASSIFY', 'SET_BASKET']);

function spectate(text: string) {
  const f = decodeRunJson<{ run: RunState; pendingPolicy: ServiceDefinition | null }>(text);
  const next = normalizeRun(f.run, BASE_SCENARIO);
  // Same run moving forward: extend the charts; otherwise (new run, earlier file) start them over.
  const sameRun = spectating && next.seed === run.seed && next.sim.tick >= run.sim.tick;
  spectating = true;
  speed = 0;
  whatIf = null;
  saved = null;
  if (!sameRun) history = [];
  run = next;
  lastPhase = run.phase;
  if (run.phase === 'LIVE' && history.at(-1)?.tick !== run.sim.tick) history = [...history, samplePoint(run)].slice(-HISTORY_MAX);
  historyDirty = true;
  pendingPolicy = f.pendingPolicy ? normalizeDefinition(f.pendingPolicy) : null;
  postPolicy();
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (spectating && !SPECTATOR_OK.has(m.type)) return;
  switch (m.type) {
    case 'SPECTATE':
      spectate(m.text);
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
      post({ type: 'BASKET', basket });
      postPolicy();
      run = newRun(BASE_SCENARIO, content, m.seed, m.difficulty, m.daily);
      lastRunXp = null;
      postCareer();
      history = [];
      historyDirty = true;
      saved = null;
      break;
    case 'CONTINUE_SAVED':
      if (saved) {
        run = saved;
        lastPhase = run.phase;
        history = [];
        historyDirty = true;
        saved = null;
        pendingPolicy = savedDesk?.pendingPolicy ? normalizeDefinition(savedDesk.pendingPolicy) : null;
        basket = savedDesk?.basket ?? [];
        savedDesk = null;
        postPolicy();
        post({ type: 'BASKET', basket });
      }
      break;
    case 'CONTINUE_ENDLESS':
      run = continueEndless(run, content);
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
          if (run.phase === 'REVIEW') run = chooseDraft(run, content, null);
          if (run.phase === 'BRIEFING') run = startDay(run, content);
          run = advance(run, sc(), content, TICKS_PER_DAY);
        }
        if (run.phase === 'REVIEW') run = chooseDraft(run, content, null);
        lastPhase = run.phase;
        recordCareer();
        history = [];
        historyDirty = true;
      }
      break;
    case 'GET_MON3_CHARTS': {
      const c = run.mon3Charts;
      if (!c || !hasFeature(run, 'MON3_CHARTS')) break;
      post({ type: 'MON3_CHARTS', fromSample: m.fromSample, fromMarker: m.fromMarker, samples: c.samples.slice(m.fromSample), markers: c.markers.slice(m.fromMarker) });
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
      whatIf = { token: whatIfToken, label: m.label, base: forkForWhatIf(run, content, []), prop: forkForWhatIf(run, content, m.commands), ticks: 0 };
      post({ type: 'WHATIF_PROGRESS', frac: 0 });
      const token = whatIfToken;
      setTimeout(() => whatIfChunk(token), 0);
      break;
    }
    case 'PROJECT_WORK': {
      settle(workOnProject(run, m.id, m.hours));
      break;
    }
    case 'ASK_AROUND': {
      settle(askAround(run, m.topic, m.workloadId, sc()));
      break;
    }
    case 'TFP_DECIDE': {
      settle(decideTfp(run, m.accept));
      post({ type: 'FINANCE', finance: financeView(run, sc()) });
      break;
    }
    case 'GET_FINANCE':
      post({ type: 'FINANCE', finance: financeView(run, sc()) });
      break;
    case 'GET_SMF': {
      const need = SMF_FEATURE[m.kind];
      if (!hasFeature(run, need)) break;
      if (m.kind !== 'SMF113' && m.kind !== 'BATCH') run = noteReportOpened(run, `SMF:${m.kind}:${m.hour}`);
      const data: SmfData =
        m.kind === 'DB2' ? { kind: 'DB2', hour: m.hour, rows: db2Accounting(run, sc(), m.hour) }
        : m.kind === 'CICS' ? { kind: 'CICS', hour: m.hour, rows: cicsMonitoring(run, sc(), m.hour) }
        : m.kind === 'BATCH' ? { kind: 'BATCH', night: batchNight(run) }
        : { kind: 'SMF113', rows: smf113(run) };
      post({ type: 'SMF', data });
      break;
    }
    case 'ALERT_ADD': {
      settle(addAlertRule(run, m.rule));
      break;
    }
    case 'SAVE_POLICY':
    case 'DELETE_POLICY':
    case 'SET_POLICY_SCHEDULE': {
      let out;
      if (m.type === 'SAVE_POLICY') {
        const name = m.name.trim().toUpperCase();
        out = /^[A-Z][A-Z0-9#@$]{0,7}$/.test(name)
          ? savePolicy(run, { ...(pendingPolicy ?? run.sim.wlm.definition), policyName: name })
          : { run, ok: false, message: 'Policy names are 1–8 characters, starting with a letter' };
      } else if (m.type === 'DELETE_POLICY') out = deletePolicy(run, m.name);
      else out = setSchedule(run, m.schedule);
      settle(out);
      break;
    }
    case 'AUTO_ADD': {
      settle(addAutoRule(run, m.rule));
      break;
    }
    case 'AUTO_REMOVE':
      run = removeAutoRule(run, m.id);
      break;
    case 'ALERT_REMOVE':
      run = removeAlertRule(run, m.id);
      break;
    case 'BUY_TOOL':
    case 'SET_TOOL_ACTIVE': {
      settle(m.type === 'BUY_TOOL' ? buyTool(run, sc(), m.toolId) : setToolActive(run, sc(), m.toolId, m.active));
      break;
    }
    case 'CANCEL_CHANGE': {
      settle(cancelChange(run, m.changeId));
      break;
    }
    case 'GET_RULES':
      postRules();
      break;
    case 'CLASSIFY':
      post({ type: 'CLASSIFIED', result: classify(pendingPolicy ?? run.sim.wlm.definition, m.work), pending: pendingPolicy !== null });
      break;
    case 'SET_STARTING_PERK':
      run = setStartingPerk(run, m.perkId, career.xp);
      break;
    case 'START_DAY':
      run = startDay(run, content);
      if (m.auto && run.phase === 'LIVE') {
        if (speed !== AUTO_SPEED) speedBeforeAuto = speed > 0 ? speed : 1;
        speed = AUTO_SPEED;
      } else if (!m.auto && speed === AUTO_SPEED) speed = speedBeforeAuto;
      break;
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
      settle(requestChange(run, content, m.req));
      break;
    }
    case 'DRAFT':
      run = chooseDraft(run, content, m.optionId);
      autosave();
      break;
    case 'RCA':
      run = submitRca(run, m.incidentId, m.mechanism, m.trigger, sc(), m.evidenceIds ?? []);
      break;
    case 'PIN': {
      settle(addPin(run, sc(), m.req));
      break;
    }
    case 'UNPIN':
      run = removePin(run, m.id);
      break;
    case 'WLM_EDIT': {
      // Edits accumulate on a pending copy of the active policy until it is activated.
      const res = applyWlmEdit(pendingBase(pendingPolicy, run.sim.wlm.definition), m.edit);
      if (typeof res === 'string') post({ type: 'RESULT', ok: false, message: res });
      else {
        pendingPolicy = res;
        postPolicy();
        post({ type: 'RESULT', ok: true, message: `Pending policy ${res.policyName} updated. Activate it to take effect.` });
      }
      break;
    }
    case 'RC_ADVICE_APPLY': {
      if (!hasFeature(run, 'REPORT_CLASS_ADVISOR')) break;
      const res = applyReportClassAdvice(pendingBase(pendingPolicy, run.sim.wlm.definition), currentItems(), m.workloadId);
      if (typeof res === 'string') post({ type: 'RESULT', ok: false, message: res });
      else if (res.added.length > 0) {
        const n = res.added.length;
        pendingPolicy = res.def;
        postPolicy();
        post({ type: 'RESULT', ok: true, message: `${n} report class${n > 1 ? 'es' : ''} staged in ${res.def.policyName}. Activate it to take effect.` });
      }
      break;
    }
    case 'ACTIVATE_PENDING':
      if (pendingPolicy) activate(pendingPolicy);
      else post({ type: 'RESULT', ok: false, message: 'No pending policy edits' });
      break;
    case 'DISCARD_PENDING':
      pendingPolicy = null;
      postPolicy();
      post({ type: 'RESULT', ok: true, message: 'Pending policy discarded' });
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
      activate(def);
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
      run = noteReportOpened(run, `${m.kind}:${m.index}`);
      post({ type: 'REPORT', text: renderReport(iv, m.kind, m.scKey, m.system) });
      break;
    }
  }
  if (!m.type.startsWith('GET_')) persistSoon();
  sendView();
};

sendView();

