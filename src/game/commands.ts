// CL-18: one command layer for the two front ends. The browser worker (src/worker/game.worker.ts) and the play
// CLI (tools/playCore.ts) both turn player commands into `RunState` changes; this module holds the rule and the
// reply, so neither adapter can drift from the other. Adapters keep only their own concerns: how a command arrives
// (a typed message or a text line), resolving text forms to ids, watch state (the change basket, the posted
// policy), and how the reply is shown.
//
// Validation is the union of what both sides did. Where the two differed, the side kept is named:
// - START: the day-start note about failed policy activations (CLI) and the pending policy the day starts with.
//   `startDay` itself already ignores a day that is not in the briefing.
// - RCA: the CLI's checks (a known mechanism and trigger, an incident that exists and has no RCA yet, pins that
//   exist) and its full reply (points, right/wrong answers, the also-accepted answers, trust, the same-cause
//   incidents the group covers, proof lines). The worker had no checks and no reply.
// - CANCEL: the CLI's "Activate to reschedule." after a restored policy; the worker said only the change's message.
// - UNPIN: the CLI's "No pin" check; the worker removed an unknown id silently.
// - DRAFT: the CLI's "Drafts are chosen in the end-of-day review."; the worker silently did nothing.
// - WLM edit: the CLI's phase-aware instruction ("close the day … activate at tomorrow's briefing" in the review)
//   with the worker's warning about a new goal issue.
// - Activate: the worker's goal-issue gate ("Policy not installed: …", pending edits kept); the CLI activated
//   without it.

import { failedPolicyToday, policyFailuresWithLaterToday, requestChange, startDay, cancelChange, chooseDraft, submitRca, type ChangeRequest } from './run';
import { buyTool, hasFeature, needsText, setToolActive } from './tools';
import { applyReportClassAdvice } from './rcAdvisor';
import { runWorkItems } from './workloads';
import { decideTfp } from './tfp';
import { askAround } from './inquiries';
import { workOnProject } from './projects';
import { addPin, removePin, type PinRequest } from './evidence';
import { fileProblemDiagnosis, openProblemRecord } from './problems';
import { applyWlmEdit, pendingBase, playerWlmEditError, serviceClassGoalIssues, type WlmEdit } from './wlmEdit';
import { activateSavedPolicy, deactivateCod } from './run';
import { deletePolicy, policyEditSource, savedPolicy, savePolicy, setSchedule, type ScheduleEntry } from './policies';
import { buildView } from './view';
import { requestOperation } from './operations';
import { requestBackout } from './run/otherTeamChanges';
import { MECHANISMS, TRIGGERS } from './sla';
import { alsoAcceptedOf, groupAcceptedOf, rcaAnswerText, rcaGroupOf } from './run/rca';
import { TRIGGER_LABEL } from '../content/rca';
import { EVIDENCE } from '../content/evidence';
import { pinVerdictLines, proofLines } from './proof';
import { idText } from './ids';
import type { Mon3PinLookup } from './mon3PinHistory';
import type { GameContent } from './run/shared';
import type { Scenario } from '../sim/core/scenario';
import type { Operation } from '../sim/core/operations';
import type { Mechanism, ProblemSubject, RunState, Trigger } from './types';
import type { InquiryKind } from '../content/inquiries';
import type { ServiceDefinition } from '../sim/wlm/types';

/** A player command the two front ends share. Text forms (an interval id, a clock time, an SMF hour key) are
 *  resolved by the adapter before they get here; this layer works in ids and ticks. */
export type GameCommand =
  | { kind: 'START' }
  | { kind: 'CHANGE'; req: ChangeRequest }
  | { kind: 'OPERATION'; op: Operation }
  | { kind: 'BACKOUT_CHANGE'; changeId: string }
  | { kind: 'RESTART'; name: string }
  | { kind: 'CANCEL'; changeId: number }
  | { kind: 'COD_DEACTIVATE'; changeId: number }
  | { kind: 'DRAFT'; optionId: string | null }
  | { kind: 'RCA'; incidentId: number; mechanism: Mechanism; trigger: Trigger; evidenceIds?: number[] }
  | { kind: 'OPEN_PROBLEM'; subject: ProblemSubject; fromTick: number; toTick: number }
  | { kind: 'FILE_PROBLEM'; recordId: number; mechanism: Mechanism; trigger: Trigger; evidenceIds?: number[] }
  | { kind: 'PIN'; req: PinRequest }
  | { kind: 'UNPIN'; id: number }
  | { kind: 'WLM_EDIT'; edit: WlmEdit }
  | { kind: 'ACTIVATE' }
  | { kind: 'ACTIVATE_DEFINITION'; definition: ServiceDefinition }
  | { kind: 'DISCARD' }
  | { kind: 'POLICY_LOAD'; name: string }
  | { kind: 'POLICY_ACTIVATE'; name: string }
  | { kind: 'POLICY_SAVE'; name: string }
  | { kind: 'POLICY_DELETE'; name: string }
  | { kind: 'POLICY_SCHEDULE'; schedule: ScheduleEntry[] }
  | { kind: 'RC_ADVICE'; workloadId?: string | null }
  | { kind: 'BUY'; toolId: string }
  | { kind: 'TOOL_ACTIVE'; toolId: string; active: boolean }
  | { kind: 'TFP'; accept: boolean }
  | { kind: 'ASK'; topic: InquiryKind; workloadId?: string | null }
  | { kind: 'PROJECT'; id: string; hours: number };

export interface GameCommandResult {
  run: RunState;
  /** The pending policy after the command: what the worker keeps beside the run and the CLI stores in its file. */
  pending: ServiceDefinition | null;
  ok: boolean;
  message: string;
}

/** Apply one command. `mon3History` is the caller's Monitor III pin history (the worker's live history, the
 *  CLI's side file): a pin without one resolves only against the current view. */
export function applyGameCommand(
  run: RunState,
  pending: ServiceDefinition | null,
  cmd: GameCommand,
  content: GameContent,
  sc: Scenario,
  opts: { mon3History?: Mon3PinLookup } = {},
): GameCommandResult {
  const no = (message: string): GameCommandResult => ({ run, pending, ok: false, message });
  const yes = (r: RunState, message: string, next: ServiceDefinition | null = pending): GameCommandResult => ({ run: r, pending: next, ok: true, message });
  const result = (o: { run: RunState; ok: boolean; message: string }, next: ServiceDefinition | null = pending): GameCommandResult => ({ run: o.run, pending: next, ok: o.ok, message: o.message });

  switch (cmd.kind) {
    case 'START': {
      if (run.phase !== 'BRIEFING') return no(`Cannot start a day in phase ${run.phase}`);
      const started = startDay(run, content);
      const failed = pending ? null : failedPolicyToday(started);
      const later = failed ? [] : policyFailuresWithLaterToday(started);
      const live = later.find((x) => x.editsLive);
      const note = failed
        ? ' Policy activation failed; its edits are pending again (activate to reschedule).'
        : live
          ? ` Policy activation failed earlier, but later activation ${live.laterName} went live with its edits.`
          : later.length > 0
            ? ` Policy activation failed earlier; later activation ${later[0]!.laterName} also went live, but without this request's edits; they are not pending again (make them again and activate).`
            : '';
      return { run: started, pending: failed ?? pending, ok: true, message: `Day started (06:00).${note}` };
    }
    case 'CHANGE':
      return result(requestChange(run, content, cmd.req));
    case 'OPERATION':
      return result(requestOperation(run, sc, content, cmd.op));
    case 'BACKOUT_CHANGE':
      return result(requestBackout(run, content, cmd.changeId));
    case 'RESTART': {
      const batch = buildView(run, sc).batch;
      const a = batch.abended.find((x) => x.name === cmd.name.toUpperCase());
      if (!a) return no(`${cmd.name} is not abended now. Abended jobs: ${batch.abended.map((x) => x.name).join(' ') || 'none'} (a job can be restarted only during its batch night).`);
      return result(requestChange(run, content, { label: `Restart ${a.name}`, commands: [{ kind: 'RESTART_JOB', day: a.day, name: a.name }] }));
    }
    case 'CANCEL': {
      const o = cancelChange(run, cmd.changeId);
      const next = o.restoredPolicy && !pending ? o.restoredPolicy : pending;
      return { run: o.run, pending: next, ok: o.ok, message: o.restoredPolicy && !pending ? `${o.message} Activate to reschedule.` : o.message };
    }
    case 'COD_DEACTIVATE':
      return result(deactivateCod(run, cmd.changeId));
    case 'DRAFT': {
      if (run.phase !== 'REVIEW') return no('Drafts are chosen in the end-of-day review.');
      return yes(chooseDraft(run, content, cmd.optionId), cmd.optionId ? `Drafted ${cmd.optionId}.` : 'Draft skipped.');
    }
    case 'RCA': {
      if (!MECHANISMS.includes(cmd.mechanism) || !TRIGGERS.includes(cmd.trigger)) return no(`Mechanism one of ${MECHANISMS.join(' ')}; trigger one of ${TRIGGERS.join(' ')}`);
      const inc = run.incidents.find((i) => i.id === cmd.incidentId);
      if (!inc) return no(`No incident ${idText('incident', cmd.incidentId)}`);
      if (inc.rca) return no(`Incident ${idText('incident', cmd.incidentId)} already has an RCA`);
      const missing = (cmd.evidenceIds ?? []).filter((id) => !run.pins.some((p) => p.id === id));
      const pins = run.pins ?? [];
      if (missing.length && !pins.length) return no('No pins yet. Pin report rows first (e.g. pin WLMGL <interval id> *PLEX ONLHI#1 PI; see catalog), or file the RCA without evidence.');
      if (missing.length) return no(`No pinned evidence ${missing.map((id) => idText('pin', id)).join(' ')}; pins: ${pins.map((p) => idText('pin', p.id)).join(' ')}`);
      const r = submitRca(run, cmd.incidentId, cmd.mechanism, cmd.trigger, sc, cmd.evidenceIds ?? []);
      // One RCA covers the group: its accepted answers are the union of the members', and the header names each
      // distinct primary with its workloads, each accepted reason with its victim (RT-15, RT-28, §4.5).
      const group = rcaGroupOf(r.incidents, cmd.incidentId);
      const covered = group.filter((i) => i.id !== cmd.incidentId && i.rca).map((i) => `${idText('incident', i.id)} ${i.workloadId}`);
      const rca = r.incidents.find((i) => i.id === cmd.incidentId)?.rca;
      const accepted = groupAcceptedOf(group);
      const pts = rca?.points ?? 0;
      const trustNote = rca?.duplicateOf !== undefined
        ? `no second credit for this cause${rca.duplicateOf ? ` (#${rca.duplicateOf})` : ''}`
        : pts >= 3 ? 'trust +1 on every facet' : pts > 0 ? 'trust +0.25 on every facet' : 'trust -0.5 on every facet';
      // An accepted alternate is a right answer, so the reply must say so and give its reason (RT-07).
      // Answers are shown with the trigger's display name; the ids stay what a command types (RT-09).
      const also = alsoAcceptedOf(group).map(({ answer, why }) => `${TRIGGER_LABEL[answer as Trigger] ?? answer}${why ? ` (${why})` : ''}`);
      const evidence = rca?.evidencePoints ? ` (${rca.evidencePoints} from evidence)` : '';
      const proof = rca?.proof ? `\n${proofLines(rca.proof, (id) => idText('pin', id)).join('\n')}` : '';
      // The answer and the proof are different things (RT-30): the truth accepts the answer (or not), and the pins
      // prove the recipe (or not). The answer line is shared with the RCA card.
      const answer = rcaAnswerText(group, cmd.mechanism, cmd.trigger, accepted);
      // Every filed pin is listed with the clause it counted for or why it did not count, and the hour note recorded
      // at filing when a met pin was over a line the hour average missed (RT-30).
      const pinLines = rca ? pinVerdictLines(rca.proof, rca.evidence ?? [], (id) => idText('pin', id)) : [];
      const pinsLine = pinLines.length ? `\nPins: ${pinLines.join('; ')}` : '';
      const hourNote = rca?.hourNote ? `\n${rca.hourNote}` : '';
      return yes(
        r,
        `RCA filed for incident ${idText('incident', cmd.incidentId)}: ${pts} points${evidence}. ${answer}${also.length ? `; also accepted: ${also.join('; ')}` : ''}; ${trustNote}.${rca?.explain ? ` ${rca.explain}` : ''}${covered.length ? ` Also covers the same-cause incidents ${covered.join(', ')}.` : ''}${rca?.strong ? ` Strong evidence: +${EVIDENCE.strongInsight} Insight.` : ''}${proof}${pinsLine}${hourNote}`,
      );
    }
    case 'OPEN_PROBLEM': {
      const o = openProblemRecord(run, content, sc, cmd.subject, cmd.fromTick, cmd.toTick);
      return { run: o.run, pending, ok: o.ok, message: o.message };
    }
    case 'FILE_PROBLEM': {
      if (!MECHANISMS.includes(cmd.mechanism) || !TRIGGERS.includes(cmd.trigger)) return no(`Mechanism one of ${MECHANISMS.join(' ')}; trigger one of ${TRIGGERS.join(' ')}`);
      const missing = (cmd.evidenceIds ?? []).filter((id) => !run.pins.some((p) => p.id === id));
      if (missing.length) return no(`No pinned evidence ${missing.map((id) => idText('pin', id)).join(' ')}; pins: ${(run.pins ?? []).map((p) => idText('pin', p.id)).join(' ')}`);
      const o = fileProblemDiagnosis(run, content, sc, cmd.recordId, cmd.mechanism, cmd.trigger, cmd.evidenceIds ?? []);
      return { run: o.run, pending, ok: o.ok, message: o.message };
    }
    case 'PIN':
      return result(addPin(run, sc, cmd.req, opts.mon3History));
    case 'UNPIN': {
      if (!run.pins.some((p) => p.id === cmd.id)) return no(`No pin ${idText('pin', cmd.id)}`);
      return yes(removePin(run, cmd.id), `Unpinned ${idText('pin', cmd.id)}.`);
    }
    case 'WLM_EDIT': {
      // After a briefing install, subsequent edits retain its queued changes.
      const base = pendingBase(pending, policyEditSource(run));
      const res = playerWlmEditError(cmd.edit) ?? applyWlmEdit(base, cmd.edit);
      if (typeof res === 'string') return no(res);
      const had = new Set(serviceClassGoalIssues(base).map((i) => i.message));
      const warn = serviceClassGoalIssues(res).find((i) => !had.has(i.message));
      const instruction = run.phase === 'REVIEW'
        ? "close the day (draft <id|none>), then activate at tomorrow's briefing to install it."
        : 'Activate it to take effect.';
      return yes(run, `Pending policy ${res.policyName} updated. ${instruction}${warn ? ` Warning: ${warn.message}` : ''}`, res);
    }
    case 'ACTIVATE':
      if (!pending) return no('No pending policy edits');
      return activate(run, pending, pending, content);
    case 'ACTIVATE_DEFINITION':
      return activate(run, pending, cmd.definition, content);
    case 'DISCARD':
      return yes(run, 'Pending policy discarded', null);
    case 'POLICY_LOAD': {
      const name = cmd.name.trim().toUpperCase();
      const def = savedPolicy(run, name);
      if (!def) return no(`No saved policy ${name || '(none)'}`);
      return yes(run, `Loaded ${def.policyName} into the editor`, structuredClone(def));
    }
    case 'POLICY_ACTIVATE': {
      const name = cmd.name.trim().toUpperCase();
      const def = savedPolicy(run, name);
      if (!def) return no(`No saved policy ${name}`);
      const err = serviceClassGoalIssues(def).find((i) => i.severity === 'error');
      if (err) return no(`Policy not installed: ${err.message}`);
      const o = activateSavedPolicy(run, content, name);
      return { run: o.run, pending: o.ok ? null : pending, ok: o.ok, message: o.message };
    }
    case 'POLICY_SAVE': {
      const name = cmd.name.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9#@$]{0,7}$/.test(name)) return no('Policy names are 1–8 characters, starting with a letter');
      return result(savePolicy(run, { ...(pending ?? policyEditSource(run)), policyName: name }));
    }
    case 'POLICY_DELETE':
      return result(deletePolicy(run, cmd.name.trim().toUpperCase()));
    case 'POLICY_SCHEDULE':
      return result(setSchedule(run, cmd.schedule));
    case 'TOOL_ACTIVE':
      return result(setToolActive(run, sc, cmd.toolId, cmd.active));
    case 'RC_ADVICE': {
      if (!hasFeature(run, 'REPORT_CLASS_ADVISOR')) return no(needsText('REPORT_CLASS_ADVISOR', 'Report class advice'));
      const res = applyReportClassAdvice(pendingBase(pending, policyEditSource(run)), runWorkItems(sc, run), cmd.workloadId ?? null);
      if (typeof res === 'string') return no(res);
      if (!res.added.length) return no('No report class advice left.');
      const instruction = run.phase === 'REVIEW'
        ? "close the day (draft <id|none>), then activate at tomorrow's briefing (takes effect next day)."
        : 'Activate it to take effect (next day).';
      return yes(run, `Report classes for ${res.added.join(' ')} staged in ${res.def.policyName}. ${instruction}`, res.def);
    }
    case 'BUY':
      return result(buyTool(run, sc, cmd.toolId));
    case 'TFP':
      return result(decideTfp(run, cmd.accept));
    case 'ASK':
      return result(askAround(run, cmd.topic, cmd.workloadId ?? null, sc, content));
    case 'PROJECT':
      return result(workOnProject(run, cmd.id, cmd.hours));
  }
}

/** Activate a policy (a pasted definition included): the goal-issue gate first, so a policy that cannot meet its
 *  goals is not installed. A failure (the gate or the request) leaves the pending edits exactly as they were, for
 *  the player to fix; only a successful request consumes them. */
function activate(run: RunState, pending: ServiceDefinition | null, def: ServiceDefinition, content: GameContent): GameCommandResult {
  const err = serviceClassGoalIssues(def).find((i) => i.severity === 'error');
  if (err) return { run, pending, ok: false, message: `Policy not installed: ${err.message}` };
  const o = requestChange(run, content, { label: `Activate policy ${def.policyName}`, commands: [{ kind: 'ACTIVATE_POLICY', definition: def }] });
  return { run: o.run, pending: o.ok ? null : pending, ok: o.ok, message: o.message };
}
