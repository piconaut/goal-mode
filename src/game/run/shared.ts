import type { WorkloadDef } from '../../sim/workload/types';
import type { Facet } from '../../content/types';
import {
  facetsOf,
  type RunState
} from '../types';

export type { GameContent } from '../../content/types';

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

/** Charges `amount` trust to each of `facets` the run tracks, clamped like every other trust change. */
export const loseTrust = (run: RunState, facets: Iterable<string>, amount: number): RunState => {
  const trust = { ...run.trust };
  for (const facet of facets) if (trust[facet] !== undefined) trust[facet] = clampTrust(trust[facet]! - amount);
  return { ...run, trust };
};

/** `day` dates the message for a later morning's briefing (default: today). */
export function msg(run: RunState, from: string, subject: string, body: string, day = run.day): RunState {
  return { ...run, inbox: [...run.inbox, { day, from, subject, body }] };
}

export function logLine(run: RunState, text: string): RunState {
  return { ...run, log: [...run.log, text].slice(-300) };
}

export const toolOn = (r: RunState, id: string) => r.tools.includes(id) && !r.toolsOff.includes(id);
