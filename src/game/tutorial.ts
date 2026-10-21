import type { ServiceDefinition } from '../sim/wlm/types';
import { classify } from '../sim/wlm/classify';
import type { RunState } from './types';

// Day-1 tutorial (SPEC §11.2): its one judged step is F1, "Db2 below the work it serves" (SPEC §13.1).
const DB2_STC = 'DB1AMSTR';
const CICS_STC = 'CICSAOR1';
const SYSTEM_CLASSES = new Set(['SYSTEM', 'SYSSTC']);

/** Importance the STC rules give a jobname (0 = above every goal: SYSTEM/SYSSTC). */
function stcImportance(def: ServiceDefinition, jobname: string): number {
  const sc = classify(def, { subsystem: 'STC', TN: jobname }).serviceClass;
  if (SYSTEM_CLASSES.has(sc)) return 0;
  return def.classes.find((c) => c.id === sc)?.periods[0]?.importance ?? 6;
}

/** True when Db2's address spaces sit at or above the CICS regions they serve. */
export function db2AboveItsClients(def: ServiceDefinition): boolean {
  return stcImportance(def, DB2_STC) <= stcImportance(def, CICS_STC);
}

/** The policy the player has installed: the latest planned or applied activation, else the active one. */
export function installedPolicy(run: RunState): ServiceDefinition {
  for (let i = run.changes.length - 1; i >= 0; i--) {
    const c = run.changes[i]!;
    if (c.status !== 'PLANNED' && c.status !== 'APPLIED') continue;
    const act = c.commands.find((x) => x.kind === 'ACTIVATE_POLICY');
    if (act && act.kind === 'ACTIVATE_POLICY') return act.definition;
  }
  return run.sim.wlm.definition;
}
