// WLM service policies (SPEC §5.4): named policies saved alongside the active one, and a daily
// schedule that switches between them (V WLM,POLICY=name issued by operations automation).

import { POLICY_SCHEDULE } from '../content/alerts';
import { clockAt } from '../sim/core/clock';
import type { Command } from '../sim/core/commands';
import { TICKS_PER_HOUR } from '../sim/core/units';
import type { ServiceDefinition } from '../sim/wlm/types';
import type { RunState } from './types';

export interface ScheduleEntry {
  policyName: string;
  /** Hour of day (0..23) the policy is activated, every day. */
  hour: number;
}

export interface PolicyBook {
  saved: ServiceDefinition[];
  schedule: ScheduleEntry[];
}

export const emptyPolicyBook = (): PolicyBook => ({ saved: [], schedule: [] });

type Out = { run: RunState; ok: boolean; message: string };

/** Save a policy under its name (replacing one with the same name). Free: it is just stored. */
export function savePolicy(run: RunState, def: ServiceDefinition): Out {
  const book = run.policies ?? emptyPolicyBook();
  const others = book.saved.filter((p) => p.policyName !== def.policyName);
  if (others.length >= POLICY_SCHEDULE.maxSaved) return { run, ok: false, message: `At most ${POLICY_SCHEDULE.maxSaved} saved policies` };
  const saved = [...others, structuredClone(def)].sort((a, b) => (a.policyName < b.policyName ? -1 : 1));
  return { run: { ...run, policies: { ...book, saved } }, ok: true, message: `Policy ${def.policyName} saved` };
}

export function deletePolicy(run: RunState, name: string): Out {
  const book = run.policies ?? emptyPolicyBook();
  if (book.schedule.some((e) => e.policyName === name)) return { run, ok: false, message: `${name} is in the schedule; remove it there first` };
  return { run: { ...run, policies: { ...book, saved: book.saved.filter((p) => p.policyName !== name) } }, ok: true, message: `Policy ${name} deleted` };
}

/** Replace the daily schedule. Costs engineer-hours; not allowed during a change freeze. */
export function setSchedule(run: RunState, schedule: ScheduleEntry[]): Out {
  const book = run.policies ?? emptyPolicyBook();
  if (run.phase !== 'BRIEFING' && run.phase !== 'LIVE') return { run, ok: false, message: 'The schedule can be changed during the briefing or the live day' };
  if (run.constraints.includes('FREEZE')) return { run, ok: false, message: 'Change freeze: the policy schedule is frozen' };
  if (schedule.length > POLICY_SCHEDULE.maxEntries) return { run, ok: false, message: `At most ${POLICY_SCHEDULE.maxEntries} switches a day` };
  for (const e of schedule) {
    if (!Number.isInteger(e.hour) || e.hour < 0 || e.hour > 23) return { run, ok: false, message: 'Hours are 0–23' };
    if (!book.saved.some((p) => p.policyName === e.policyName)) return { run, ok: false, message: `${e.policyName} is not a saved policy` };
  }
  if (new Set(schedule.map((e) => e.hour)).size !== schedule.length) return { run, ok: false, message: 'Two switches at the same hour' };
  if (run.hoursLeft < POLICY_SCHEDULE.editHours) return { run, ok: false, message: `Needs ${POLICY_SCHEDULE.editHours}h` };
  const sorted = [...schedule].sort((a, b) => a.hour - b.hour);
  return {
    run: { ...run, hoursLeft: run.hoursLeft - POLICY_SCHEDULE.editHours, policies: { ...book, schedule: sorted }, log: [...run.log, `Policy schedule: ${sorted.map((e) => `${String(e.hour).padStart(2, '0')}:00 ${e.policyName}`).join(', ') || 'none'}`] },
    ok: true,
    message: `Schedule updated (${POLICY_SCHEDULE.editHours}h)`,
  };
}

/** Activation command due at this tick (on the hour), if the schedule has one and it differs from the active policy. */
export function scheduledActivation(run: RunState): Command | null {
  const book = run.policies;
  if (!book || book.schedule.length === 0 || run.sim.tick % TICKS_PER_HOUR !== 0) return null;
  const hour = Math.round(clockAt(run.sim.tick).hourOfDay) % 24;
  const entry = book.schedule.find((e) => e.hour === hour);
  if (!entry || entry.policyName === run.sim.wlm.definition.policyName) return null;
  const def = book.saved.find((p) => p.policyName === entry.policyName);
  return def ? { kind: 'ACTIVATE_POLICY', definition: structuredClone(def) } : null;
}
