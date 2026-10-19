// What player actions cost (SPEC §6): engineer-hours per command, fixes for events,
// hardware orders.

import { HARDWARE, type HardwareItem } from '../content/hardware-catalog';
import type { Command } from '../sim/core/commands';

const HOURS: Partial<Record<Command['kind'], number>> = {
  ACTIVATE_POLICY: 1.5,
  SET_WEIGHT: 0.5,
  SET_LOGICAL: 1,
  SET_DEFINED_CAPACITY: 0.5,
  SET_CAPACITY_GROUP: 1,
  SET_ABSOLUTE_CAP: 0.5,
  SET_IEAOPT: 0.5,
  SET_RMF_INTERVAL: 0.25,
  SET_LPAR_MEMORY: 1,
  SET_DB2: 1,
  SET_CICS: 0.5,
  ADD_AOR: 3,
  SET_JOB_CLASS: 1,
  SET_CF: 1,
  SET_ROUTING: 0.5,
  RESTART_JOB: 0.5,
};

const PRSM_KINDS: ReadonlySet<Command['kind']> = new Set(['SET_WEIGHT', 'SET_LOGICAL', 'SET_DEFINED_CAPACITY', 'SET_CAPACITY_GROUP', 'SET_ABSOLUTE_CAP']);

export function hoursFor(commands: readonly Command[], perks: readonly string[]): number {
  let h = 0;
  for (const c of commands) {
    if (perks.includes('HMC_NINJA') && PRSM_KINDS.has(c.kind)) continue;
    h += HOURS[c.kind] ?? 0.5;
  }
  return h;
}

export interface FixDef {
  id: string;
  name: string;
  hours: number;
  /** Trust cost to the facet that owns the affected work (e.g. cancelling a user's query). */
  trustCost: { facet: 'Digital' | 'Retail' | 'Finance'; amount: number } | null;
  description: string;
}

export const FIXES: FixDef[] = [
  { id: 'CANCEL_RUNAWAY', name: 'Cancel the runaway DDF thread', hours: 0.5, trustCost: null, description: '-CANCEL THREAD on the looping BI query.' },
  { id: 'REBIND_REVERT', name: 'REBIND with APREUSE / switch back', hours: 1.5, trustCost: null, description: 'Restore the previous access path for the retail package.' },
  { id: 'BLOCK_BOTS', name: 'Block bot traffic at the edge', hours: 1, trustCost: { facet: 'Digital', amount: 1 }, description: 'Rate-limit the credential-stuffing source addresses.' },
  { id: 'ROLLBACK_MONITOR', name: 'Roll back the monitoring agent', hours: 1, trustCost: null, description: 'Revert to the previous agent release.' },
];

export const hardwareItem = (id: string): HardwareItem | undefined => HARDWARE.find((h) => h.id === id);
