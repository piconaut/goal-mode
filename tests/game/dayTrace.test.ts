// PT-17: a browser save carries its live day's 06:00 start and the actions the browser took during it, so
// `inspect … wlm --at` can answer for any time in the current day. These tests drive one live day the way
// the worker's message handler does — each `apply` mirrors a src/worker/game.worker.ts case body, and each
// `rec` the entry its `trace()` helper records there — then check the replay rebuilds every moment of it,
// and that wlmText answers from a browser save for a time before the saved moment.

import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { advanceHours } from '../../src/game/advance';
import { addAlertRule, removeAlertRule } from '../../src/game/alerts';
import { addAutoRule, removeAutoRule } from '../../src/game/automation';
import { scenarioFor } from '../../src/game/difficulty';
import { addPin, removePin } from '../../src/game/evidence';
import { deletePolicy, policyEditSource, savePolicy, savedPolicy, setSchedule } from '../../src/game/policies';
import { cancelChange, newRun, requestChange, startDay, activateSavedPolicy, type ChangeRequest } from '../../src/game/run';
import { applyWlmEdit, pendingBase, playerWlmEditError, serviceClassGoalIssues } from '../../src/game/wlmEdit';
import { buyTool, normalizeDefinition, noteReportOpened, setToolActive } from '../../src/game/tools';
import { replayDayTrace, traceCovers, type DayTrace, type DayTraceCommand } from '../../src/game/dayTrace';
import { SAVE_VERSION } from '../../src/game/runFile';
import type { RunState } from '../../src/game/types';
import type { ServiceDefinition } from '../../src/sim/wlm/types';
import { encodePlayFile } from '../../tools/playCore';
import { wlmText } from '../../tools/inspect';

/** 06:00 of day 1, plus `hours`: the tick clock text `D1 HH:MM` names. */
const at = (hours: number) => hours * 360;

/** One live day, driven like the browser: advance through it, apply actions the way the worker's cases do,
 *  and record each one the way its trace() helper does. Probes are captured at ticks no later command shares
 *  (a save's trace is as-of its moment), and the day ends at 12:00 — the saved moment. */
function playedDay(): {
  dayTrace: DayTrace;
  final: RunState;
  probes: Array<{ tick: number; run: RunState }>;
  definitionBeforeActivation: ServiceDefinition;
  saveTick: number;
} {
  const probes: Array<{ tick: number; run: RunState }> = [];
  const sc = () => scenarioFor(MIDWEST, 'NORMAL');
  let cur = startDay(newRun(MIDWEST, MIDWEST_GAME, 42, 'NORMAL'), MIDWEST_GAME);
  // The worker's snapshot (START_DAY): the state the day starts from, then every action during it.
  const dayTrace: DayTrace = { start: cur, pendingPolicy: null, commands: [] };
  let pendingPolicy: ServiceDefinition | null = null;
  const advanceH = (hours: number) => {
    cur = advanceHours(cur, MIDWEST_GAME, hours, {});
    // The worker's frame loop clears a pausing alert rule's request (src/worker/game.worker.ts).
    if (cur.alerts?.pauseRequested) cur = { ...cur, alerts: { ...cur.alerts, pauseRequested: false } };
  };
  const apply = (command: DayTraceCommand, workerCase: () => void) => {
    dayTrace.commands.push({ tick: cur.sim.tick, command });
    workerCase();
  };
  const probe = () => probes.push({ tick: cur.sim.tick, run: cur });
  const toTick = (tick: number) => advanceH((tick - cur.sim.tick) / 360);

  // 06:00 — an emergency change (CHANGE); at 07:00 its cancellation is refused, as a live day must.
  const initiators: ChangeRequest = { label: 'Class A initiators on PROD1', commands: [{ kind: 'SET_JOB_CLASS', jobClass: 'A', initiators: { PROD1: 12 } }] };
  apply({ cmd: 'change', req: initiators }, () => {
    cur = requestChange(cur, MIDWEST_GAME, initiators).run;
  });
  const changeId = cur.changes.at(-1)!.id;
  toTick(at(1));
  apply({ cmd: 'cancel', changeId }, () => {
    const o = cancelChange(cur, changeId);
    if (o.restoredPolicy && !pendingPolicy) pendingPolicy = o.restoredPolicy;
    cur = o.run;
  });

  // 07:30 — probe the pre-activation policy, then edit it (WLM_EDIT) and activate it (ACTIVATE_PENDING).
  toTick(at(1.5));
  const definitionBeforeActivation = cur.sim.wlm.definition;
  probe();
  toTick(at(2));
  const classId = cur.sim.wlm.definition.classes[0]!.id;
  const edit = { op: 'SET_FLAGS', classId, cpuCritical: true } as const;
  apply({ cmd: 'wlm', edit }, () => {
    const res = playerWlmEditError(edit) ?? applyWlmEdit(pendingBase(pendingPolicy, policyEditSource(cur)), edit);
    if (typeof res !== 'string') pendingPolicy = res;
  });
  apply({ cmd: 'activate' }, () => {
    const def = pendingPolicy!;
    if (serviceClassGoalIssues(def).some((i) => i.severity === 'error')) return;
    const out = requestChange(cur, MIDWEST_GAME, { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
    cur = out.run;
    if (out.ok) pendingPolicy = null;
  });

  // 08:00 — a tool bought and switched off (BUY_TOOL, SET_TOOL_ACTIVE), alert and automation rules added and
  // removed again (ALERT_ADD, AUTO_ADD, ALERT_REMOVE, AUTO_REMOVE). Probe the result at 08:30.
  toTick(at(2.5));
  apply({ cmd: 'buy', toolId: 'SMF_CICS' }, () => {
    cur = buyTool(cur, sc(), 'SMF_CICS').run;
  });
  apply({ cmd: 'toolActive', toolId: 'SMF_CICS', active: false }, () => {
    cur = setToolActive(cur, sc(), 'SMF_CICS', false).run;
  });
  const alertRule = { metric: 'PI' as const, subject: `${classId}#1`, threshold: 1.5, forMin: 5, pause: true };
  apply({ cmd: 'alertAdd', rule: alertRule }, () => {
    cur = addAlertRule(cur, alertRule).run;
  });
  const alertId = cur.alerts!.rules.at(-1)!.id;
  const autoRule = { trigger: { kind: 'JOB_ABEND', criticalOnly: false }, action: { kind: 'RESTART_JOB' } } as const;
  apply({ cmd: 'autoAdd', rule: { ...autoRule, maxPerDay: 2 } }, () => {
    cur = addAutoRule(cur, { ...autoRule, maxPerDay: 2 }).run;
  });
  const autoId = cur.automation!.rules.at(-1)!.id;
  apply({ cmd: 'alertRemove', id: alertId }, () => {
    cur = removeAlertRule(cur, alertId);
  });
  apply({ cmd: 'autoRemove', id: autoId }, () => {
    cur = removeAutoRule(cur, autoId);
  });
  toTick(at(3));
  probe();

  // 09:00 — the policy book (SAVE_POLICY, LOAD_SAVED_POLICY, ACTIVATE_SAVED_POLICY, SET_POLICY_SCHEDULE,
  // DELETE_POLICY), a JSON activation (ACTIVATE_JSON), a second edit and its discard (DISCARD_PENDING).
  toTick(at(3.5));
  apply({ cmd: 'savePolicy', name: 'DAYTRACE' }, () => {
    cur = savePolicy(cur, { ...(pendingPolicy ?? policyEditSource(cur)), policyName: 'DAYTRACE' }).run;
  });
  apply({ cmd: 'loadSaved', name: 'DAYTRACE' }, () => {
    const def = savedPolicy(cur, 'DAYTRACE');
    if (def) pendingPolicy = structuredClone(def);
  });
  apply({ cmd: 'activateSaved', name: 'DAYTRACE' }, () => {
    const def = savedPolicy(cur, 'DAYTRACE');
    if (!def || serviceClassGoalIssues(def).some((i) => i.severity === 'error')) return;
    const out = activateSavedPolicy(cur, MIDWEST_GAME, 'DAYTRACE');
    cur = out.run;
    if (out.ok) pendingPolicy = null;
  });
  apply({ cmd: 'setPolicySchedule', schedule: [{ policyName: 'DAYTRACE', hour: 23 }] }, () => {
    cur = setSchedule(cur, [{ policyName: 'DAYTRACE', hour: 23 }]).run;
  });
  apply({ cmd: 'deletePolicy', name: 'DAYTRACE' }, () => {
    cur = deletePolicy(cur, 'DAYTRACE').run;
  });
  const json = JSON.stringify(policyEditSource(cur));
  apply({ cmd: 'activateJson', json }, () => {
    const def = normalizeDefinition(JSON.parse(json) as ServiceDefinition);
    if (serviceClassGoalIssues(def).some((i) => i.severity === 'error')) return;
    const out = requestChange(cur, MIDWEST_GAME, { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
    cur = out.run;
    if (out.ok) pendingPolicy = null;
  });
  const edit2 = { op: 'SET_FLAGS', classId, storageCritical: true } as const;
  apply({ cmd: 'wlm', edit: edit2 }, () => {
    const res = playerWlmEditError(edit2) ?? applyWlmEdit(pendingBase(pendingPolicy, policyEditSource(cur)), edit2);
    if (typeof res !== 'string') pendingPolicy = res;
  });
  apply({ cmd: 'discard' }, () => {
    pendingPolicy = null;
  });

  // 10:00 — reports opened (GET_REPORT, GET_SMF) and evidence pinned and unpinned (PIN, UNPIN).
  toTick(at(4));
  apply({ cmd: 'reportOpened', key: 'PARTITION:0' }, () => {
    cur = noteReportOpened(cur, 'PARTITION:0');
  });
  apply({ cmd: 'reportOpened', key: 'SMF:CICS:3' }, () => {
    cur = noteReportOpened(cur, 'SMF:CICS:3');
  });
  const iv = cur.sim.rmf.intervals.length - 1;
  const row = cur.sim.rmf.intervals.at(-1)!.wlm.find((r) => r.lparId === 'PROD1')!;
  const pinReq = { source: 'WLMGL', index: iv, system: 'PROD1', scKey: row.scKey, metric: 'PI' } as const;
  apply({ cmd: 'pin', req: pinReq }, () => {
    cur = addPin(cur, sc(), pinReq, (t) => null).run;
  });
  const pinId = cur.pins!.at(-1)!.id;
  apply({ cmd: 'unpin', id: pinId }, () => {
    cur = removePin(cur, pinId);
  });

  toTick(at(6)); // 12:00 — the saved moment
  return { dayTrace, final: cur, probes, definitionBeforeActivation, saveTick: cur.sim.tick };
}

describe('a browser save\'s day trace (PT-17)', () => {
  it('covers exactly its live day, of its own run only', () => {
    const { dayTrace } = playedDay();
    const start = dayTrace.start.sim.tick;
    expect(traceCovers(dayTrace, dayTrace.start.seed, start)).toBe(true);
    expect(traceCovers(dayTrace, dayTrace.start.seed, start + 1)).toBe(true);
    // The next day's 06:00 (where a played day ends) is outside the traced one.
    expect(traceCovers(dayTrace, dayTrace.start.seed, start + 8640)).toBe(false);
    expect(traceCovers(dayTrace, dayTrace.start.seed, start - 1)).toBe(false);
    // Another run's save never replays this day.
    expect(traceCovers(dayTrace, dayTrace.start.seed + 1, start + 1)).toBe(false);
  });

  it('replays the day to any time in it: the state at every probe matches, and the actions mattered', () => {
    const { dayTrace, final, probes, definitionBeforeActivation } = playedDay();
    expect(final.pins).toHaveLength(0); // pinned then unpinned — the fixture exercised both
    // Every probe replays to exactly the state the browser had at that moment.
    for (const p of probes) {
      expect(replayDayTrace(dayTrace, p.tick).run, `replay to ${p.tick}`).toEqual(p.run);
    }
    const midday = replayDayTrace(dayTrace, probes[0]!.tick).run;
    const end = replayDayTrace(dayTrace, final.sim.tick);
    expect(end.run).toEqual(final);
    expect(end.pendingPolicy).toBe(null);
    // The recorded actions matter: before the activation the policy is the day-start one, at the end it is not.
    expect(midday.sim.wlm.definition).toEqual(definitionBeforeActivation);
    expect(final.sim.wlm.definition).not.toEqual(definitionBeforeActivation);
  });

  it('makes `inspect … wlm --at` answer from a browser save for any time in its current day', () => {
    const { dayTrace, final, saveTick } = playedDay();
    expect(saveTick).toBe(at(6)); // the fixture's saved moment is D1 12:00
    const text = encodePlayFile({ version: SAVE_VERSION, run: final, pendingPolicy: null, log: [{ cmd: 'note', text: `Exported from the browser on day ${final.day + 1}` }], dayTrace });
    // Before the fix the same save answered: "The save is at D1 12:00; … traced forward from there."
    const at8 = wlmText(text, 'PROD1', { at: 'D1 08:00', ticks: 6 });
    expect(at8).toContain('replayed from the live day start (browser day trace)');
    expect(at8).toMatch(/WLM policy adjustment on PROD1/);
    expect(at8).not.toMatch(/traced forward from there|not a live day/);
    // The saved moment itself still traces forward from the save, as before.
    const now = wlmText(text, 'PROD1', { at: 'D1 12:00', ticks: 6 });
    expect(now).toContain('forward from the saved moment');
    // A time of a later day, asked from a save made there, says so instead of pretending to answer.
    const nextDay = encodePlayFile({ version: SAVE_VERSION, run: { ...final, sim: { ...final.sim, tick: saveTick + 8640 } } as RunState, pendingPolicy: null, log: [{ cmd: 'note', text: 'x' }], dayTrace });
    expect(wlmText(nextDay, 'PROD1', { at: 'D2 09:00' })).toMatch(/is outside the day this save traces/);
  });

  it('still traces forward only, with the old message, from a save without a trace', () => {
    let run = startDay(newRun(MIDWEST, MIDWEST_GAME, 7, 'NORMAL'), MIDWEST_GAME);
    run = advanceHours(run, MIDWEST_GAME, 1, {});
    const text = encodePlayFile({ version: SAVE_VERSION, run, pendingPolicy: null, log: [{ cmd: 'note', text: 'no trace' }] });
    const out = wlmText(text, 'PROD1', { at: 'D1 06:30', ticks: 6 });
    expect(out).toMatch(/a save without a play log can only be traced forward from there/);
  });
});
