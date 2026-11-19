// PT-17: the live day's start-of-day state plus every player action during it, so `inspect … wlm --at` can
// replay a browser save to any time in its current day. The browser worker snapshots the state at 06:00
// (START_DAY) and appends one entry per action, each with the tick it was applied at; the save carries the
// trace (the autosaved desk across reloads, the exported file otherwise), and tools/inspect.ts replays it.
//
// The command union and `applyTraceCommand` mirror the worker's message handling one case at a time
// (src/worker/game.worker.ts): same game functions, same arguments, same effect on the run and the pending
// policy. Only the browser's own behaviour may be replayed this way — when the play CLI mutates a file that
// carries a trace, tools/playCore.ts drops it rather than replay a day the browser did not play.

import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { packOf } from '../content/packs';
import type { InquiryKind } from '../content/inquiries';
import { advanceHours } from './advance';
import { addAlertRule, removeAlertRule, type AlertRule } from './alerts';
import { addAutoRule, removeAutoRule, type AutoRule } from './automation';
import { scenarioFor } from './difficulty';
import { addPin, removePin, type PinRequest } from './evidence';
import { emptyMon3History, mon3At, recordMon3History, type Mon3History } from './mon3History';
import { buildMon3 } from './mon3';
import { policyEditSource, savePolicy, deletePolicy, savedPolicy, setSchedule, type ScheduleEntry } from './policies';
import { runWorkItems } from './workloads';
import { cancelChange, requestChange, submitRca, activateSavedPolicy, deactivateCod, type ChangeRequest } from './run';
import { applyReportClassAdvice } from './rcAdvisor';
import { applyWlmEdit, pendingBase, playerWlmEditError, serviceClassGoalIssues, type WlmEdit } from './wlmEdit';
import { askAround } from './inquiries';
import { workOnProject } from './projects';
import { buyTool, noteReportOpened, normalizeDefinition, setToolActive } from './tools';
import { decideTfp } from './tfp';
import type { Mon3PinLookup } from './mon3PinHistory';
import type { Mechanism, RunState, Trigger } from './types';
import type { ServiceDefinition } from '../sim/wlm/types';

/** One player action the browser applied during the live day, as the worker's message handler received it.
 *  The payloads are the worker's own (`ToWorker`), not the play CLI's text forms. */
export type DayTraceCommand =
  | { cmd: 'change'; req: ChangeRequest }
  | { cmd: 'cancel'; changeId: number }
  | { cmd: 'rca'; incidentId: number; mechanism: Mechanism; trigger: Trigger; evidenceIds?: number[] }
  | { cmd: 'ask'; topic: InquiryKind; workloadId?: string | null }
  | { cmd: 'project'; id: string; hours: number }
  | { cmd: 'pin'; req: PinRequest }
  | { cmd: 'unpin'; id: number }
  | { cmd: 'tfp'; accept: boolean }
  | { cmd: 'buy'; toolId: string }
  | { cmd: 'toolActive'; toolId: string; active: boolean }
  | { cmd: 'alertAdd'; rule: Omit<AlertRule, 'id'> }
  | { cmd: 'alertRemove'; id: number }
  | { cmd: 'autoAdd'; rule: Omit<AutoRule, 'id'> }
  | { cmd: 'autoRemove'; id: number }
  | { cmd: 'savePolicy'; name: string }
  | { cmd: 'deletePolicy'; name: string }
  | { cmd: 'setPolicySchedule'; schedule: ScheduleEntry[] }
  | { cmd: 'activateSaved'; name: string }
  | { cmd: 'loadSaved'; name: string }
  | { cmd: 'deactivateCod'; changeId: number }
  | { cmd: 'wlm'; edit: WlmEdit }
  | { cmd: 'rcadvice'; workloadId?: string | null }
  | { cmd: 'activate' }
  | { cmd: 'activateJson'; json: string }
  | { cmd: 'discard' }
  | { cmd: 'reportOpened'; key: string };

/** A recorded action and the live tick it was applied at (the worker's `run.sim.tick` at that moment). */
export interface DayTraceEntry {
  tick: number;
  command: DayTraceCommand;
}

/** The live day, as a browser save carries it (PT-17). */
export interface DayTrace {
  /** The day's state at its 06:00 start, after `startDay` applied the planned changes (the worker's snapshot). */
  start: RunState;
  /** The pending WLM policy at the day's start (edits pending again after a failed activation, for example). */
  pendingPolicy: ServiceDefinition | null;
  /** The day's player actions, in the order they were applied. */
  commands: DayTraceEntry[];
}

/** The state a trace replays through: the run plus the pending policy the worker holds beside it. */
export interface TraceState {
  run: RunState;
  pendingPolicy: ServiceDefinition | null;
}

/** Does this trace cover `target`? It must be the same run (seed) and a tick of the live day it started. */
export function traceCovers(trace: DayTrace, seed: number, target: number): boolean {
  return trace.start.seed === seed && target >= trace.start.sim.tick && target < trace.start.sim.tick + TICKS_PER_DAY;
}

const contentOf = (run: RunState) => packOf(run.scenarioId).game;
const scOf = (run: RunState) => scenarioFor(packOf(run.scenarioId).scenario, run.difficulty);

/** A recorded action that cannot replay is a corrupt trace (the worker only records actions that succeeded
 *  far enough to change something, and reality ran them once already); fail loudly rather than trace on. */
const corrupt = (what: string): never => {
  throw new Error(`day trace: ${what}`);
};

/** The worker's `activate` (ACTIVATE_PENDING / ACTIVATE_JSON): validation first, then an activation request;
 *  the pending edits are only consumed when the request went through. */
function activate(st: TraceState, def: ServiceDefinition): TraceState {
  const err = serviceClassGoalIssues(def).find((i) => i.severity === 'error');
  if (err) return st;
  const out = requestChange(st.run, contentOf(st.run), { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
  return out.ok ? { run: out.run, pendingPolicy: null } : { run: out.run, pendingPolicy: st.pendingPolicy };
}

/** Apply one recorded action exactly as the worker applied it (the case bodies of src/worker/game.worker.ts;
 *  the basket and the posted messages are browser-only and stay behind). A throw means the trace is corrupt. */
export function applyTraceCommand(st: TraceState, c: DayTraceCommand, mon3AtTick?: Mon3PinLookup): TraceState {
  const run = st.run;
  const settled = (out: { run: RunState }): TraceState => ({ ...st, run: out.run });
  switch (c.cmd) {
    case 'change':
      return settled(requestChange(run, contentOf(run), c.req));
    case 'cancel': {
      const o = cancelChange(run, c.changeId);
      return { run: o.run, pendingPolicy: o.restoredPolicy && !st.pendingPolicy ? o.restoredPolicy : st.pendingPolicy };
    }
    case 'rca':
      return settled({ run: submitRca(run, c.incidentId, c.mechanism, c.trigger, scOf(run), c.evidenceIds ?? []) });
    case 'ask':
      return settled(askAround(run, c.topic, c.workloadId ?? null, scOf(run)));
    case 'project':
      return settled(workOnProject(run, c.id, c.hours));
    case 'pin':
      return settled(addPin(run, scOf(run), c.req, mon3AtTick));
    case 'unpin':
      return { ...st, run: removePin(run, c.id) };
    case 'tfp':
      return settled(decideTfp(run, c.accept));
    case 'buy':
      return settled(buyTool(run, scOf(run), c.toolId));
    case 'toolActive':
      return settled(setToolActive(run, scOf(run), c.toolId, c.active));
    case 'alertAdd':
      return settled(addAlertRule(run, c.rule));
    case 'alertRemove':
      return { ...st, run: removeAlertRule(run, c.id) };
    case 'autoAdd':
      return settled(addAutoRule(run, c.rule));
    case 'autoRemove':
      return { ...st, run: removeAutoRule(run, c.id) };
    case 'savePolicy':
      return settled(savePolicy(run, { ...(st.pendingPolicy ?? policyEditSource(run)), policyName: c.name }));
    case 'deletePolicy':
      return settled(deletePolicy(run, c.name));
    case 'setPolicySchedule':
      return settled(setSchedule(run, c.schedule));
    case 'activateSaved': {
      const def = savedPolicy(run, c.name);
      if (!def) return corrupt(`a recorded activation of saved policy ${c.name} found no such policy`);
      if (serviceClassGoalIssues(def).find((i) => i.severity === 'error')) return st; // recorded after validation
      const out = activateSavedPolicy(run, contentOf(run), c.name);
      return out.ok ? { run: out.run, pendingPolicy: null } : { run: out.run, pendingPolicy: st.pendingPolicy };
    }
    case 'loadSaved': {
      const def = savedPolicy(run, c.name);
      if (!def) return corrupt(`a recorded load of saved policy ${c.name} found no such policy`);
      return { ...st, pendingPolicy: structuredClone(def) };
    }
    case 'deactivateCod':
      return settled(deactivateCod(run, c.changeId));
    case 'wlm': {
      const res = playerWlmEditError(c.edit) ?? applyWlmEdit(pendingBase(st.pendingPolicy, policyEditSource(run)), c.edit);
      if (typeof res === 'string') return corrupt(`a recorded wlm edit was refused: ${res}`);
      return { ...st, pendingPolicy: res };
    }
    case 'rcadvice': {
      const res = applyReportClassAdvice(pendingBase(st.pendingPolicy, policyEditSource(run)), runWorkItems(scOf(run), run), c.workloadId ?? null);
      if (typeof res === 'string') return corrupt(`a recorded rcadvice was refused: ${res}`);
      if (res.added.length === 0) return corrupt('a recorded rcadvice added nothing');
      return { ...st, pendingPolicy: res.def };
    }
    case 'activate':
      return st.pendingPolicy ? activate(st, st.pendingPolicy) : corrupt('an activate was recorded with no pending policy');
    case 'activateJson': {
      let def: ServiceDefinition;
      try {
        def = normalizeDefinition(JSON.parse(c.json) as ServiceDefinition);
      } catch {
        return corrupt('a recorded activateJson does not parse');
      }
      return activate(st, def);
    }
    case 'discard':
      return { ...st, pendingPolicy: null };
    case 'reportOpened':
      return { ...st, run: noteReportOpened(run, c.key) };
  }
}

/** Replay the day to `target`: advance from the 06:00 start, apply the recorded actions at their ticks, and
 *  stop at `target`. The advance records Monitor III history and clears a pausing alert exactly as the worker
 *  does, so a pin taken from today's history and a paused alert replay identically. A pin from a Monitor III
 *  interval before the day's 06:00 start cannot replay (the trace begins at the start, while the worker keeps
 *  48 h of history), so it is refused as out of history and does not consume its id: later integer ids can
 *  shift, which matters to nothing `inspect … wlm` reads. `target` must be inside the traced day. */
export function replayDayTrace(trace: DayTrace, target: number): TraceState {
  const content = contentOf(trace.start);
  let st: TraceState = { run: trace.start, pendingPolicy: trace.pendingPolicy };
  let mon3: Mon3History = emptyMon3History();
  const advanceTo = (tick: number) => {
    if (tick <= st.run.sim.tick) return;
    st.run = advanceHours(st.run, content, (tick - st.run.sim.tick) / TICKS_PER_HOUR, {
      onMintime: (r) => {
        mon3 = recordMon3History(mon3, r.sim.tick, buildMon3(r, scenarioFor(packOf(r.scenarioId).scenario, r.difficulty)));
      },
    });
    if (st.run.alerts?.pauseRequested) st.run = { ...st.run, alerts: { ...st.run.alerts, pauseRequested: false } };
  };
  for (const e of trace.commands) {
    if (e.tick > target) break;
    advanceTo(e.tick);
    st = applyTraceCommand(st, e.command, (t) => mon3At(mon3, t));
  }
  advanceTo(target);
  return st;
}
