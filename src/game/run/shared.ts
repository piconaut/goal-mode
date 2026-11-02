import type { DifficultyId } from '../../content/difficulty';
import { type EventDef, type ScriptedBeat } from '../../content/events/midwest-events';
import { type Command } from '../../sim/core/commands';
import type { WorkloadDef } from '../../sim/workload/types';
import {
facetsOf,
type Facet,
type RunState
} from '../types';

export interface GameContent {
  events: EventDef[];
  story: ScriptedBeat[];
  opexBudgetMonthly: number;
  capexQuarter: number;
  maxDays: number;
  /** Stakeholder facets with their SLA-breach trust weights; absent = Midwest's (FACET_WEIGHT). */
  facets?: { id: Facet; weight: number }[];
  /** Facet that also loses trust on a missed batch deadline (default Retail). */
  batchMissFacet?: Facet;
  /** Planted flaws already fixed at the start on a difficulty (SPEC §11.2, §13.3). */
  startingFixes?: Partial<Record<DifficultyId, { flaw: string; label: string; commands: Command[] }[]>>;
  /** Analytics tools already installed on day 1 (SPEC §13.5); their measurement overhead applies from the start. */
  startTools?: string[];
}

export const BASE_HOURS = 8;
export const FATIGUE_PER_OVERTIME_HOUR = 6;
export const FACET_WEIGHT: Record<string, number> = { Cards: 1.4, Retail: 1.2, Digital: 1, Payments: 1, Finance: 1, Regulator: 1 };

export const facetOf = (w: WorkloadDef): Facet | null => (w.stakeholder === 'Internal' ? null : w.stakeholder);

export const overallTrust = (run: RunState) => {
  const fs = facetsOf(run);
  return fs.reduce((a, f) => a + run.trust[f]!, 0) / fs.length;
};

/** Applies f to every facet's trust and clamps. */
export const mapTrust = (run: RunState, f: (t: number) => number): Record<Facet, number> =>
  Object.fromEntries(facetsOf(run).map((k) => [k, clampTrust(f(run.trust[k]!))]));

export const clampTrust = (x: number) => Math.max(0, Math.min(100, x));

/** `day` dates the message for a later morning's briefing (default: today). */
export function msg(run: RunState, from: string, subject: string, body: string, day = run.day): RunState {
  return { ...run, inbox: [...run.inbox, { day, from, subject, body }] };
}

export function logLine(run: RunState, text: string): RunState {
  return { ...run, log: [...run.log, text].slice(-300) };
}
