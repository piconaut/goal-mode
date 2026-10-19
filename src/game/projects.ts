// Multi-day projects: the player books engineer-hours each day during the briefing; when the
// total is reached the improvement is applied permanently (as sim commands at the next tick).

import { projectDef, PROJECTS, type ProjectEffect } from '../content/projects';
import type { Command } from '../sim/core/commands';
import type { SimState } from '../sim/core/types';
import type { RunState } from './types';

export interface ProjectState {
  id: string;
  hoursDone: number;
  /** Hours booked on the played day `day` (each project has a per-day ceiling). */
  hoursToday: number;
  day: number;
  done: boolean;
}

type Out = { run: RunState; ok: boolean; message: string };

export function effectCommands(effects: readonly ProjectEffect[], sim: SimState): Command[] {
  const out: Command[] = [];
  const scaled = (mod: 'efficiency' | 'ioPerTxn', id: string, f: number): Command => ({ kind: 'SET_MODIFIER', mod, key: id, value: (sim.mods[mod]?.[id] ?? 1) * f });
  for (const e of effects) {
    if (e.kind === 'EFFICIENCY') for (const w of e.workloads) out.push(scaled('efficiency', w, e.factor));
    else if (e.kind === 'IO') for (const w of e.workloads) out.push(scaled('ioPerTxn', w, e.factor));
    else if (e.kind === 'ZIIP_SHIFT') for (const w of e.workloads) out.push({ kind: 'SET_MODIFIER', mod: 'ziipShift', key: w, value: Math.min(0.9, (sim.mods.ziipShift?.[w] ?? 0) + e.frac) });
    else for (const r of sim.config.cics) out.push({ kind: 'SET_CICS', name: r.name, qrFrac: r.qrFrac * e.factor });
  }
  return out;
}

/** Book `hours` on a project today. Only during the briefing; respects hours left and the daily ceiling. */
export function workOnProject(run: RunState, id: string, hours: number): Out {
  const def = projectDef(id);
  if (!def) return { run, ok: false, message: 'Unknown project' };
  if (run.phase !== 'BRIEFING') return { run, ok: false, message: 'Project time is booked during the briefing' };
  const list = run.projects ?? [];
  const cur = list.find((p) => p.id === id) ?? { id, hoursDone: 0, hoursToday: 0, day: run.day, done: false };
  if (cur.done) return { run, ok: false, message: `${def.name} is finished` };
  const today = cur.day === run.day ? cur.hoursToday : 0;
  const h = Math.min(hours, def.maxHoursPerDay - today, def.hours - cur.hoursDone);
  if (!(h > 0)) return { run, ok: false, message: `At most ${def.maxHoursPerDay}h a day on ${def.name}` };
  if (h > run.hoursLeft) return { run, ok: false, message: `Only ${run.hoursLeft.toFixed(1)}h left today` };
  const next: ProjectState = { ...cur, hoursDone: cur.hoursDone + h, hoursToday: today + h, day: run.day, done: cur.hoursDone + h >= def.hours - 1e-9 };
  let r: RunState = { ...run, hoursLeft: run.hoursLeft - h, projects: [...list.filter((p) => p.id !== id), next].sort((a, b) => (a.id < b.id ? -1 : 1)) };
  if (next.done) {
    r = { ...r, pendingCommands: [...r.pendingCommands, ...effectCommands(def.effects, r.sim)], log: [...r.log, `Project complete: ${def.name}`] };
    return { run: r, ok: true, message: `${def.name} complete: in effect from 06:00` };
  }
  return { run: r, ok: true, message: `${def.name}: ${next.hoursDone}/${def.hours}h` };
}

export function projectsView(run: RunState) {
  return PROJECTS.map((d) => {
    const s = (run.projects ?? []).find((p) => p.id === d.id);
    const today = s && s.day === run.day ? s.hoursToday : 0;
    return { id: d.id, name: d.name, description: d.description, hours: d.hours, maxHoursPerDay: d.maxHoursPerDay, hoursDone: s?.hoursDone ?? 0, hoursToday: today, done: s?.done ?? false, codex: d.codex ?? null };
  });
}
