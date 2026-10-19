// The game runs here, off the UI thread. At 1× a played day (8640 ticks) takes 10 minutes.

import { MIDWEST_GAME } from '../content/game-midwest';
import { MIDWEST } from '../content/scenarios';
import { advance, chooseDraft, newRun, requestChange, startDay, submitRca } from '../game/run';
import type { RunState } from '../game/types';
import { buildView } from '../game/view';
import { applyWlmEdit } from '../game/wlmEdit';
import type { ServiceDefinition } from '../sim/wlm/types';
import { renderCfActivity, renderDasdSummary, renderPartitionData, renderWlmDetail, renderWlmSummary } from '../sim/measure/reports';
import { HISTORY_EVERY_TICKS, HISTORY_MAX, samplePoint, type HistoryPoint } from '../game/history';
import { classify } from '../sim/wlm/classify';
import { goalText } from '../sim/wlm/goals';
import type { FromWorker, PendingPolicyView, ToWorker } from './protocol';
import { loadRun, saveRun } from './storage';

const scenario = MIDWEST;
const content = MIDWEST_GAME;
/** Ticks per real second at 1×: 8640 ticks / 600 s. */
const TICKS_PER_SEC_1X = 14.4;
const FRAME_MS = 100;

let run: RunState = newRun(scenario, content, Date.now() % 100000);
let speed = 1;
let pendingPolicy: ServiceDefinition | null = null;
let carry = 0;

let history: HistoryPoint[] = [];
let historyDirty = true;
let saved: RunState | null = null;
let lastPhase = run.phase;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);
function pendingView(): PendingPolicyView | null {
  if (!pendingPolicy) return null;
  return {
    policyName: pendingPolicy.policyName,
    classes: pendingPolicy.classes.map((c) => ({ id: c.id, periods: c.periods.map((p) => goalText(p)), cpuCritical: c.cpuCritical })),
    rules: pendingPolicy.subsystems.flatMap((ss) =>
      ss.rules.map((r) => ({ subsystem: ss.subsystem, text: `${r.qualifier}=${r.pattern} → ${r.serviceClass ?? '(default)'}` })),
    ),
  };
}

const postPolicy = () => post({ type: 'POLICY', json: JSON.stringify(pendingPolicy ?? run.sim.wlm.definition, null, 2) });

function activate(def: ServiceDefinition) {
  const out = requestChange(run, content, { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
  run = out.run;
  if (out.ok) {
    pendingPolicy = null;
    postPolicy();
  }
  post({ type: 'RESULT', ok: out.ok, message: out.message });
}

const sendView = () => {
  post({ type: 'VIEW', view: buildView(run, scenario), history: historyDirty ? history : null, savedRunDay: saved && saved.day > 0 ? saved.day : null, pending: pendingView() });
  historyDirty = false;
};

/** Advance in chunks so the chart history gets a sample every five minutes. */
function advanceSampled(n: number) {
  let left = n;
  while (left > 0 && run.phase === 'LIVE') {
    const toSample = HISTORY_EVERY_TICKS - (run.sim.tick % HISTORY_EVERY_TICKS);
    const k = Math.min(left, toSample);
    run = advance(run, scenario, content, k);
    left -= k;
    if (run.sim.tick % HISTORY_EVERY_TICKS === 0) {
      history = [...history, samplePoint(run)].slice(-HISTORY_MAX);
      historyDirty = true;
    }
  }
  autosave();
}

/** Save whenever the phase changes (end of day, game over) so a reload resumes there. */
function autosave() {
  if (run.phase !== lastPhase) {
    lastPhase = run.phase;
    if (run.phase !== 'LIVE') void saveRun(run);
  }
}

void loadRun().then((r) => {
  saved = r;
  sendView();
});

setInterval(() => {
  if (run.phase !== 'LIVE' || speed <= 0) return;
  carry += (TICKS_PER_SEC_1X * speed * FRAME_MS) / 1000;
  const n = Math.floor(carry);
  if (n <= 0) return;
  carry -= n;
  advanceSampled(n);
  sendView();
}, FRAME_MS);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'NEW_RUN':
      run = newRun(scenario, content, m.seed);
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
      }
      break;
    case 'CLASSIFY':
      post({ type: 'CLASSIFIED', result: classify(pendingPolicy ?? run.sim.wlm.definition, m.work), pending: pendingPolicy !== null });
      break;
    case 'START_DAY':
      run = startDay(run, content);
      break;
    case 'SET_SPEED':
      speed = m.speed;
      break;
    case 'CHANGE': {
      const out = requestChange(run, content, m.req);
      run = out.run;
      post({ type: 'RESULT', ok: out.ok, message: out.message });
      break;
    }
    case 'DRAFT':
      run = chooseDraft(run, content, m.optionId);
      autosave();
      break;
    case 'RCA':
      run = submitRca(run, m.incidentId, m.mechanism, m.trigger);
      break;
    case 'WLM_EDIT': {
      // Edits accumulate on a pending copy of the active policy until it is activated.
      const base = pendingPolicy ?? { ...run.sim.wlm.definition, policyName: nextPolicyName(run.sim.wlm.definition.policyName) };
      const res = applyWlmEdit(base, m.edit);
      if (typeof res === 'string') post({ type: 'RESULT', ok: false, message: res });
      else {
        pendingPolicy = res;
        postPolicy();
        post({ type: 'RESULT', ok: true, message: `Pending policy ${res.policyName} updated. Activate it to take effect.` });
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
        def = JSON.parse(m.json) as ServiceDefinition;
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
      const text =
        m.kind === 'WLM_SUMMARY' ? renderWlmSummary(iv, m.system ?? '*PLEX')
        : m.kind === 'WLM_DETAIL' ? renderWlmDetail(iv, m.scKey ?? 'ONLHI#1', m.system ?? '*PLEX')
        : m.kind === 'PARTITION' ? renderPartitionData(iv)
        : m.kind === 'CF' ? renderCfActivity(iv)
        : renderDasdSummary(iv);
      post({ type: 'REPORT', text });
      break;
    }
  }
  sendView();
};

sendView();

/** BASEPOL → BASEPOL2 → BASEPOL3 … so RMF reports show which policy was active. */
function nextPolicyName(name: string): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  const stem = (m ? m[1]! : name).slice(0, 7);
  const n = m ? Number(m[2]) + 1 : 2;
  return `${stem}${n}`.slice(0, 8);
}
