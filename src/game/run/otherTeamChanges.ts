import { BACKOUT_TRUST, ROUTINE_CHANGE_CPU_MULT, type OtherTeamChangeDef } from '../../content/otherTeamChanges';
import { clockAt, hhmm } from '../../sim/core/clock';
import { applyCommands, type Command } from '../../sim/core/commands';
import { previewChange } from '../catalog';
import type { ActiveEvent, OtherTeamChange, RunState } from '../types';
import { previewContext, requestChange, spendHours, type ChangeOutcome } from './changes';
import { logLine, loseTrust, msg, type GameContent } from './shared';
import { matchesEventEffect, otherTeamChangeId } from './eventEffects';

/** The content definition of a rollout, by the card it partners. */
export const profileOf = (profiles: readonly OtherTeamChangeDef[] | undefined, eventId: string): OtherTeamChangeDef | undefined =>
  profiles?.find((def) => def.eventId === eventId);

/** A rollout that has not finished: the only ones the board offers a backout for. */
export const isOpenStatus = (status: OtherTeamChange['status']): boolean => status === 'SCHEDULED' || status === 'APPLIED';

export function announceOtherTeamChange(
  run: RunState, def: OtherTeamChangeDef, startTick: number, endTick: number | null, eventUid?: string,
): RunState {
  const entries = run.otherTeamChanges ?? [];
  const change: OtherTeamChange = {
    id: `OT${entries.length + 1}`, eventId: def.eventId, startTick, endTick, status: 'SCHEDULED',
    ...(eventUid ? { eventUid } : {}),
  };
  const { day } = clockAt(startTick);
  return msg({ ...run, otherTeamChanges: [...entries, change] }, def.owner, `Change board · Day ${day + 1}`,
    `${labelOf(change, def)} is scheduled for ${hhmm(startTick)}.`, day);
}

/** The board's visible label for a rollout: the profile's title and the change reference. */
export const labelFor = (def: OtherTeamChangeDef, id: string): string => `${def.label} · ${id}`;

function labelOf(change: OtherTeamChange, def: OtherTeamChangeDef): string {
  return labelFor(def, change.id);
}

function statusOf(change: OtherTeamChange, event: ActiveEvent | undefined, tick: number): OtherTeamChange['status'] {
  if (change.status === 'BACKED_OUT') return change.status;
  if (!event) return change.status === 'APPLIED' && change.endTick !== null && change.endTick <= tick ? 'COMPLETE' : change.status;
  if (event.ended || (event.started && event.endTick !== null && event.endTick <= tick)) return 'COMPLETE';
  return event.started ? 'APPLIED' : 'SCHEDULED';
}

function rowsOf(run: RunState, content: GameContent) {
  const profiles = content.otherTeamChanges;
  if (!profiles?.length) return [];
  const entries = run.otherTeamChanges ?? [];
  const events = new Map(run.events.map((event) => [event.uid, event]));
  const posted = new Set(entries.map((entry) => entry.eventUid));
  // Same-version saves already contain the announced cards, even when they predate the board.
  const legacy = run.events.flatMap((event): OtherTeamChange[] =>
    posted.has(event.uid) || !profileOf(profiles, event.defId) ? [] : [{
      id: otherTeamChangeId(run, event), eventId: event.defId, eventUid: event.uid,
      startTick: event.startTick, endTick: event.endTick, status: 'SCHEDULED',
    }]);
  return [...entries, ...legacy].flatMap((change) => {
    const def = profileOf(profiles, change.eventId);
    if (!def) return [];
    const event = change.eventUid ? events.get(change.eventUid) : undefined;
    return [{ change, def, event, status: statusOf(change, event, run.sim.tick), label: labelOf(change, def) }];
  });
}

export function otherTeamChangesView(run: RunState, content: GameContent, ctx = previewContext(run, content)) {
  return rowsOf(run, content).map(({ change, def, status, label }) => ({
    id: change.id, label, owner: def.owner, kind: def.kind, startTick: change.startTick, status,
    planned: run.changes.some((c) => c.backoutChangeId === change.id && c.status === 'PLANNED'),
    preview: previewChange(ctx, {}, def), trustFacet: def.trustFacet, ownerTrust: BACKOUT_TRUST,
  })).sort((a, b) => b.startTick - a.startTick);
}

function rolloutCpuCommands(entries: readonly OtherTeamChange[], profiles: readonly OtherTeamChangeDef[], targets: ReadonlySet<string>): Command[] {
  return [...targets].map((key) => {
    const active = entries.filter((entry) => !entry.eventUid && entry.status === 'APPLIED'
      && profiles.some((def) => def.eventId === entry.eventId && def.benefitTarget === key)).length;
    return { kind: 'SET_MODIFIER', mod: 'rolloutCpu', key, value: ROUTINE_CHANGE_CPU_MULT ** active };
  });
}

export function landRoutineChanges(run: RunState, content: GameContent): RunState {
  const entries = run.otherTeamChanges;
  const profiles = content.otherTeamChanges;
  if (!entries || !profiles) return run;
  const tick = run.sim.tick;
  const due = (entry: OtherTeamChange) => !entry.eventUid && (
    (entry.status === 'SCHEDULED' && entry.startTick <= tick) ||
    (entry.status === 'APPLIED' && entry.endTick !== null && entry.endTick <= tick)
  );
  if (!entries.some(due)) return run;
  const targets = new Set<string>();
  const next = entries.map((entry): OtherTeamChange => {
    if (!due(entry)) return entry;
    const status = entry.endTick !== null && entry.endTick <= tick ? 'COMPLETE' : 'APPLIED';
    const profile = profileOf(profiles, entry.eventId);
    if (profile) targets.add(profile.benefitTarget);
    return { ...entry, status };
  });
  if (targets.size === 0) return run;
  return { ...run, otherTeamChanges: next, pendingCommands: [...run.pendingCommands, ...rolloutCpuCommands(next, profiles, targets)] };
}

/** Apply an approved backout. Before landing, cancel the rollout and suppress the card's begin commands. */
export function applyBackout(run: RunState, content: GameContent, changeId: string, immediate = false, chargeOwner = true): RunState {
  const row = rowsOf(run, content).find(({ change }) => change.id === changeId);
  if (!row || !isOpenStatus(row.status)) return run;
  const { change, def, event: linked, status } = row;
  const effect = linked && content.events.find((card) => card.id === linked.defId)?.endedBy;
  const event = linked && effect && matchesEventEffect(effect, { kind: 'BACKOUT_CHANGE', changeId }, { changeId: otherTeamChangeId(run, linked) })
    ? linked : undefined;
  const backedOut = { ...change, status: 'BACKED_OUT' } as const;
  const stored = run.otherTeamChanges ?? [];
  const entries = stored.some((entry) => entry.id === changeId)
    ? stored.map((entry) => (entry.id === changeId ? backedOut : entry))
    : [...stored, backedOut];
  const commands = status === 'SCHEDULED' ? [] : event ? event.endCommands
    : rolloutCpuCommands(entries, content.otherTeamChanges ?? [], new Set([def.benefitTarget]));
  const charged = chargeOwner ? loseTrust(run, [def.trustFacet], BACKOUT_TRUST) : run;
  return {
    ...charged, otherTeamChanges: entries,
    ...(event ? { events: run.events.map((e) => e === event ? { ...e, ended: true, endTick: run.sim.tick } : e) } : {}),
    ...(immediate || !event ? { sim: applyCommands(run.sim, commands) } : { pendingCommands: [...run.pendingCommands, ...commands] }),
  };
}

export function requestBackout(run: RunState, content: GameContent, changeId: string): ChangeOutcome {
  const row = rowsOf(run, content).find(({ change }) => change.id === changeId);
  if (!row || !isOpenStatus(row.status)) {
    return { run, ok: false, message: 'This change is no longer available for backout.' };
  }
  if (run.changes.some((c) => c.backoutChangeId === changeId && c.status === 'PLANNED')) {
    return { run, ok: false, message: 'A backout is already planned for this change.' };
  }
  const { def, label, status } = row;
  if (def.kind === 'REBIND') {
    const preview = previewChange(previewContext(run, content), {}, def);
    if (!preview.ok) return { run, ok: false, message: preview.reason ?? 'Backout unavailable.' };
    const message = status === 'SCHEDULED' ? `Cancelled rollout: ${label}` : `Backed out: ${label}`;
    return { run: logLine(applyBackout(spendHours(run, preview.hours), content, changeId, true), message), ok: true, message };
  }
  const outcome = requestChange(run, content, { label: `Back out ${label}` }, { ...def, id: changeId });
  return outcome.ok && run.phase === 'LIVE' ? { ...outcome, run: applyBackout(outcome.run, content, changeId) } : outcome;
}
