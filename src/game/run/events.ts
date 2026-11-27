import { MAX_OVERTIME } from '../catalog';
import type { Scenario } from '../../sim/core/scenario';
import { type EventDef } from '../../content/events/midwest-events';
import { cardMechanisms } from '../../content/footprint';
import { STORY_BEAT_HINTS } from '../../content/hints';
import { EVENT_RUMOURS } from '../../content/inquiries';
import type { OtherTeamChangeDef } from '../../content/otherTeamChanges';
import { tickOfPlayedHour } from '../../sim/core/clock';
import { type Rng, streamRng } from '../../sim/core/rng';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../sim/core/units';
import { difficultyOf, storyBeatsFor } from '../difficulty';
import {
  type ActiveEvent,
  type RunState
} from '../types';
import type { GameContent } from './shared';
import { logLine, loseTrust, msg } from './shared';
import { previewContext, spendHours, type ChangeOutcome } from './changes';
import { eventTargets, matchesEventEffect, type CardOperation } from './eventEffects';
import { announceOtherTeamChange, profileOf } from './otherTeamChanges';

/** A rollout already on the calendar: enough to keep the draw from repeating or stacking a change. */
type ChangeHistory = readonly { eventId: string; startTick: number; endTick: number | null }[];

/** Draw one def by weight and remove it, so a caller can make several draws from one pool. */
function drawFrom(rng: Rng, pool: EventDef[], weightOf: (def: EventDef) => number): EventDef | undefined {
  const def = rng.pickWeighted(pool, weightOf);
  if (!def) return undefined;
  pool.splice(pool.indexOf(def), 1);
  return def;
}

function pickEvents(
  run: RunState, content: GameContent, day: number, rng: Rng,
  history: ChangeHistory = run.events.map(({ defId, startTick, endTick }) => ({ eventId: defId, startTick, endTick })),
) {
  const lambda = (0.35 + 0.05 * day) * difficultyOf(run.difficulty).eventRateMult;
  const n = Math.floor(lambda) + (rng.chance(lambda - Math.floor(lambda)) ? 1 : 0);
  const dayStartTick = day * TICKS_PER_DAY;
  const pool = content.events.filter(
    (e) =>
      day >= e.minDay &&
      !(e.oncePerRun && history.some((x) => x.eventId === e.id)) &&
      // No card two days running. Back-to-back repeats read as noise.
      !history.some((x) => x.eventId === e.id && x.startTick >= dayStartTick - TICKS_PER_DAY) &&
      // An hours card must not stack on itself while still running.
      !(e.hoursDelta && history.some((x) => x.eventId === e.id && (x.endTick === null || x.endTick > dayStartTick))),
  );
  const out: { def: EventDef; hour: number }[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const def = drawFrom(rng, pool, (e) => e.weight * (e.category === 'WORKLOAD' ? 1 : 1 + day / 20));
    if (!def) break;
    out.push({ def, hour: rng.range(def.startHour[0], def.startHour[1]) });
  }
  return out;
}

const changeTick = (day: number, hour: number) => day * TICKS_PER_DAY + tickOfPlayedHour(hour);
const endTickOf = (def: EventDef, startTick: number): number | null =>
  def.durationHours === null ? null : startTick + Math.max(1, Math.round(def.durationHours * TICKS_PER_HOUR));

/** Pick tomorrow's (or today's) events; forewarn when the card says so. */
export function drawEvents(run: RunState, content: GameContent, day: number): RunState {
  const picked = pickEvents(run, content, day, streamRng(run.seed, 'events', day));
  const profiles = content.otherTeamChanges ?? [];
  const notices: { def: OtherTeamChangeDef; startTick: number; endTick: number | null; uid?: string }[] = [];
  let r = run;
  for (const { def, hour } of picked) {
    const profile = profileOf(profiles, def.id);
    const scheduledTick = changeTick(day, hour);
    // Repeat rollouts share their card's effect. Let the previous rollout finish before the new one can change it.
    const startTick = profile ? r.events.reduce((tick, event) => event.defId === def.id ? Math.max(tick, event.endTick ?? tick) : tick, scheduledTick)
      : scheduledTick;
    const endTick = endTickOf(def, startTick);
    const ev: ActiveEvent = {
      uid: `${def.id}@${day}`,
      defId: def.id,
      name: def.name,
      startTick,
      endTick,
      trigger: def.trigger,
      affects: def.affects,
      mechanisms: cardMechanisms(def) ?? [],
      ...(def.failureMechanism ? { failureMechanism: def.failureMechanism } : {}),
      ...(def.blocksHardware ? { blocksHardware: def.blocksHardware } : {}),
      endCommands: def.end,
      started: false,
      ended: false,
    };
    r = { ...r, events: [...r.events, ev] };
    if (def.hoursDelta) {
      // Same bookkeeping as the CONTRACTOR perk: endDay recomputes hoursLeft from baseHours + live entries each morning.
      const days = Math.max(1, Math.ceil((def.durationHours ?? 24) / 24));
      r = { ...r, bonusHours: [...r.bonusHours, { hours: def.hoursDelta, untilDay: day + days }], hoursLeft: Math.max(0, r.hoursLeft + def.hoursDelta) };
    }
    if (profile) notices.push({ def: profile, startTick, endTick, uid: ev.uid });
    else if (def.forewarning) r = msg(r, 'Inbox', `For day ${day + 1}`, def.forewarning, day, def.reply ? ev.uid : undefined);
  }
  if (profiles.length) {
    // Sample the same deck and rollout windows with a separate seed stream. This avoids pairing a routine notice
    // with a specific regression. The first briefing starts with a routine change already on the schedule.
    const rng = streamRng(run.seed, 'routine-changes', day);
    const available = content.events.filter((def) => profileOf(profiles, def.id) !== undefined);
    const handover = day === 0 ? rng.pickWeighted(available, (def) => def.weight) : null;
    const routine = handover ? [{ def: handover, hour: rng.range(...handover.startHour) }]
      : pickEvents(run, content, day, rng, (run.otherTeamChanges ?? []).filter((change) => !change.eventUid))
        .filter(({ def }) => available.includes(def));
    // Keep routine rollouts at least as common even on seeds with an unusually busy change calendar.
    const priorShortfall = (run.otherTeamChanges ?? []).reduce((sum, entry) => sum + (entry.eventUid ? 1 : -1), 0);
    const minimum = notices.length + priorShortfall;
    const candidates = available.filter((def) => day >= def.minDay && !routine.some((rollout) => rollout.def === def));
    while (routine.length < minimum && candidates.length > 0) {
      const def = drawFrom(rng, candidates, (candidate) => candidate.weight);
      if (!def) break;
      routine.push({ def, hour: rng.range(...def.startHour) });
    }
    for (const { def, hour } of routine) {
      const profile = profileOf(profiles, def.id);
      if (!profile) continue;
      const startTick = changeTick(day, hour);
      notices.push({ def: profile, startTick, endTick: endTickOf(def, startTick) });
    }
    // Tied notices must not reveal which rollout was drawn from the card deck.
    const order = streamRng(run.seed, 'change-board-order', day);
    const ordered = notices.map((notice) => ({ ...notice, tieBreak: order.nextU32() }))
      .sort((a, b) => a.startTick - b.startTick || a.tieBreak - b.tieBreak);
    for (const notice of ordered) {
      r = announceOtherTeamChange(r, notice.def, notice.startTick, notice.endTick, notice.uid);
    }
  }
  return r;
}

export function storyFor(run: RunState, content: GameContent, day: number): RunState {
  let r = run;
  for (const b of storyBeatsFor(content.story, run.difficulty, day)) {
    r = msg(r, b.from, b.title, b.body);
    if (b.constraint) {
      r = { ...r, constraints: [...r.constraints, b.constraint] };
      if (b.constraint === 'DEADLINE_0500') r = { ...r, batchDeadlineSec: 23 * 3600 };
    }
    if (b.commands) r = { ...r, pendingCommands: [...r.pendingCommands, ...b.commands] };
  }
  if (difficultyOf(run.difficulty).hints !== 'NONE') {
    for (const [id, h] of Object.entries(STORY_BEAT_HINTS)) {
      if (storyBeatsFor(content.story, run.difficulty, day + h.daysBefore).some((b) => b.id === id)) r = msg(r, h.from, h.subject, h.body);
    }
  }
  return r;
}

/**
 * What the log may say about a card: the wording the player was given, or null for a silent one. The card's
 * name can give the diagnosis away (e.g. "Stored procedures lose zIIP offload" after a vague forewarning), so a
 * forewarning alone is not enough. An announcement, an owned perk's tip-off and a revealed Ask Around rumour are
 * explicit reveals; only the first two reveal the name too (the inbox subject). A silent card stays out of the
 * log and its chart markers.
 */
function eventLogText(run: RunState, def: EventDef, uid: string): { text: string; named: boolean } | null {
  if (def.announcement !== null) return { text: def.announcement, named: true };
  if (def.perkTip && run.perks.includes(def.perkTip.perk)) return { text: def.perkTip.text, named: true };
  const rumour = EVENT_RUMOURS[def.id];
  if (rumour && (run.inquiries?.revealed ?? []).includes(`ev:${uid}`)) return { text: rumour, named: false };
  return null;
}

export function eventStartLog(run: RunState, def: EventDef, uid: string): string | null {
  const t = eventLogText(run, def, uid);
  return t === null ? null : `EVENT start: ${t.named ? `${def.name} — ` : ''}${t.text}`;
}

export function eventEndLog(run: RunState, def: EventDef, uid: string): string | null {
  const t = eventLogText(run, def, uid);
  return t === null ? null : `EVENT end: ${t.named ? def.name : t.text}`;
}

/** Apply card cleanup for a timely resolution. An intercepted card has no begin effects to undo. */
export function resolveEvent(run: RunState, event: ActiveEvent, operation?: CardOperation): RunState {
  if (event.ended) return run;
  const { endOnRecycleTick: _scheduled, ...resolved } = event;
  const commands = event.started ? event.endCommands.filter((cmd) =>
    operation?.kind !== 'CANCEL_ADDRESS_SPACE' || cmd.kind !== 'CANCEL_ADDRESS_SPACE' ||
    cmd.jobname !== operation.jobname || cmd.lparId !== operation.lparId) : [];
  return {
    ...run,
    events: run.events.map((e) => e.uid === event.uid ? { ...resolved, ended: true, endTick: run.sim.tick } : e),
    pendingCommands: [...run.pendingCommands, ...commands],
  };
}

/** Check targets against the pre-command world, while preserving the successful operation's own effects. */
export function endEventsByOperation(before: RunState, after: RunState, scenario: Scenario, content: GameContent, op: CardOperation): RunState {
  let run = after;
  for (const event of before.events) {
    if (!event.started || event.ended || (event.endTick !== null && event.endTick <= before.sim.tick)) continue;
    const def = content.events.find((d) => d.id === event.defId);
    if (def?.endedBy && matchesEventEffect(def.endedBy, op, eventTargets(before, scenario, def, event))) {
      if (op.kind === 'RECYCLE_CICS' && def.endedBy.kind === 'RECYCLE_CICS') {
        const { targets } = def.endedBy;
        const endOnRecycleTick = run.sim.cicsRecycles?.reduce((latest, recycle) =>
          targets.some((r) => r.name === recycle.name && r.lparId === recycle.lparId) ? Math.max(latest, recycle.startTick) : latest,
          before.sim.tick) ?? before.sim.tick;
        run = { ...run, events: run.events.map((e) => e.uid === event.uid ? { ...e, endOnRecycleTick } : e) };
      } else run = resolveEvent(run, event, op);
    }
  }
  return run;
}

export function inboxReply(run: RunState, content: GameContent, uid: string | undefined) {
  if (!uid || (run.phase !== 'BRIEFING' && run.phase !== 'LIVE')) return undefined;
  const event = run.events.find((e) => e.uid === uid && !e.ended && (e.endTick === null || e.endTick > run.sim.tick));
  const reply = event && content.events.find((d) => d.id === event.defId)?.reply;
  if (!event || !reply) return undefined;
  const hours = reply.hours * (previewContext(run, content).staffSurcharge?.mult ?? 1);
  return { event, reply, hours, affordable: hours <= run.hoursLeft + MAX_OVERTIME };
}

export function requestEventReply(run: RunState, content: GameContent, uid: string): ChangeOutcome {
  const target = run.inbox.some((m) => m.replyToEventUid === uid) ? inboxReply(run, content, uid) : undefined;
  if (!target) return { run, ok: false, message: 'This thread no longer needs a reply.' };
  const { event, reply, hours, affordable } = target;
  if (!affordable) return { run, ok: false, message: `Needs ${hours}h to reply.` };
  const next = resolveEvent(loseTrust(spendHours(run, hours), [reply.facet], reply.trust), event);
  const message = `Reply sent: ${reply.label}`;
  return { run: logLine(next, message), ok: true, message };
}
