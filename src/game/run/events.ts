import { type EventDef } from '../../content/events/midwest-events';
import { STORY_BEAT_HINTS } from '../../content/hints';
import { Rng, streamRng } from '../../sim/core/rng';
import { TICK_SEC, TICKS_PER_DAY } from '../../sim/core/units';
import { difficultyOf, storyBeatsFor } from '../difficulty';
import {
  type ActiveEvent,
  type RunState
} from '../types';
import type { GameContent } from './shared';
import { msg } from './shared';

/** Seconds after the played day's 06:00 start for a wall-clock hour (24+ = next morning). */
const secAfterStart = (hour: number) => ((hour - 6 + 48) % 24) * 3600;

/** Pick tomorrow's (or today's) events; forewarn when the card says so. */
export function drawEvents(run: RunState, content: GameContent, day: number): RunState {
  const picked = ((rng: Rng) => {
    const lambda = (0.35 + 0.05 * day) * difficultyOf(run.difficulty).eventRateMult;
    const n = Math.floor(lambda) + (rng.chance(lambda - Math.floor(lambda)) ? 1 : 0);
    const dayStartTick = day * TICKS_PER_DAY;
    const pool = content.events.filter(
      (e) =>
        day >= e.minDay &&
        !(e.oncePerRun && run.events.some((x) => x.defId === e.id)) &&
        // no card two days running: back-to-back repeats (e.g. two abends) read as noise, not a new problem
        !run.events.some((x) => x.defId === e.id && x.startTick >= dayStartTick - TICKS_PER_DAY) &&
        // an hours card must not stack on itself while still running
        !(e.hoursDelta && run.events.some((x) => x.defId === e.id && (x.endTick === null || x.endTick > dayStartTick))),
    );
    const out: { def: EventDef; hour: number }[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const def = rng.pickWeighted(pool, (e) => e.weight * (e.category === 'WORKLOAD' ? 1 : 1 + day / 20));
      if (!def) break;
      pool.splice(pool.indexOf(def), 1);
      out.push({ def, hour: rng.range(def.startHour[0], def.startHour[1]) });
    }
    return out;
  })(streamRng(run.seed, 'events', day));
  let r = run;
  for (const { def, hour } of picked) {
    const startTick = day * TICKS_PER_DAY + Math.round(secAfterStart(hour) / TICK_SEC);
    const endTick = def.durationHours === null ? null : startTick + Math.max(1, Math.round((def.durationHours * 3600) / TICK_SEC));
    const ev: ActiveEvent = {
      uid: `${def.id}@${day}`,
      defId: def.id,
      name: def.name,
      startTick,
      endTick,
      trigger: def.trigger,
      affects: def.affects,
      ...(def.mechanisms ? { mechanisms: def.mechanisms } : {}),
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
    if (def.forewarning) r = msg(r, 'Inbox', `For day ${day + 1}`, def.forewarning, day);
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

/** Context for previewChange from the current run. */
/** Fixes the scenario's event cards call for: the Change Desk offers and accepts only these. */
export const fixIdsOf = (content: GameContent): string[] => [...new Set(content.events.flatMap((e) => (e.fix ? [e.fix] : [])))].sort();

export const hasEventForFix = (run: RunState, content: GameContent, fixId: string): boolean =>
  run.events.some((e) => e.started && !e.ended && content.events.some((d) => d.id === e.defId && d.fix === fixId));

export function endEventByFix(run: RunState, content: GameContent, fixId: string): RunState {
  const tick = run.sim.tick;
  let r = run;
  for (const e of r.events) {
    const def = content.events.find((d) => d.id === e.defId);
    if (e.started && !e.ended && def?.fix === fixId) {
      r = {
        ...r,
        events: r.events.map((x) => (x.uid === e.uid ? { ...x, ended: true, endTick: tick } : x)),
        pendingCommands: [...r.pendingCommands, ...e.endCommands],
      };
    }
  }
  return r;
}
