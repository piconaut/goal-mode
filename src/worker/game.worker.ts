// The game runs here, off the UI thread. At 1× a played day (8640 ticks) takes 10 minutes.

import { MIDWEST_GAME } from '../content/game-midwest';
import { MIDWEST } from '../content/scenarios';
import { advance, chooseDraft, newRun, requestChange, startDay, submitRca } from '../game/run';
import type { RunState } from '../game/types';
import { buildView } from '../game/view';
import { applyWlmEdit } from '../game/wlmEdit';
import type { ServiceDefinition } from '../sim/wlm/types';
import { renderCfActivity, renderDasdSummary, renderPartitionData, renderWlmDetail, renderWlmSummary } from '../sim/measure/reports';
import type { FromWorker, ToWorker } from './protocol';

const scenario = MIDWEST;
const content = MIDWEST_GAME;
/** Ticks per real second at 1×: 8640 ticks / 600 s. */
const TICKS_PER_SEC_1X = 14.4;
const FRAME_MS = 100;

let run: RunState = newRun(scenario, content, Date.now() % 100000);
let speed = 1;
let pendingPolicy: ServiceDefinition | null = null;
let carry = 0;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);
const sendView = () => post({ type: 'VIEW', view: buildView(run, scenario) });

setInterval(() => {
  if (run.phase !== 'LIVE' || speed <= 0) return;
  carry += (TICKS_PER_SEC_1X * speed * FRAME_MS) / 1000;
  const n = Math.floor(carry);
  if (n <= 0) return;
  carry -= n;
  run = advance(run, scenario, content, n);
  sendView();
}, FRAME_MS);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'NEW_RUN':
      run = newRun(scenario, content, m.seed);
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
      break;
    case 'RCA':
      run = submitRca(run, m.incidentId, m.mechanism, m.trigger);
      break;
    case 'WLM_EDIT': {
      // Edits accumulate on the *pending* policy if one is planned for today, else the active one.
      const res = applyWlmEdit(pendingPolicy ?? run.sim.wlm.definition, m.edit);
      if (typeof res === 'string') post({ type: 'RESULT', ok: false, message: res });
      else {
        pendingPolicy = res;
        post({ type: 'RESULT', ok: true, message: 'Policy edited (not yet active). Install & activate it from the Change Desk.' });
      }
      break;
    }
    case 'GET_POLICY':
      post({ type: 'POLICY', json: JSON.stringify(pendingPolicy ?? run.sim.wlm.definition, null, 2) });
      break;
    case 'ACTIVATE_JSON': {
      let def: ServiceDefinition;
      try {
        def = JSON.parse(m.json) as ServiceDefinition;
      } catch {
        post({ type: 'RESULT', ok: false, message: 'Policy JSON does not parse' });
        break;
      }
      const out = requestChange(run, content, { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
      run = out.run;
      if (out.ok) pendingPolicy = null;
      post({ type: 'RESULT', ok: out.ok, message: out.message });
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
