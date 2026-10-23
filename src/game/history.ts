// Five-minute samples for the console charts (UI-side history; not part of the run).

import { msuPerCp } from '../sim/hw/cpc';
import type { RunState } from './types';

export interface HistoryPoint {
  tick: number;
  hourOfDay: number;
  msu: Record<string, number>;
  r4ha: Record<string, number>;
  cpcBusyPct: number;
  /** Installed general CP capacity of all CPCs (rises while On/Off CoD is active). */
  capacityMsu: number;
}

export const HISTORY_EVERY_TICKS = 30;
export const HISTORY_MAX = 288 * 2;

export function samplePoint(run: RunState): HistoryPoint {
  const sim = run.sim;
  const msu: Record<string, number> = {};
  const r4ha: Record<string, number> = {};
  for (const l of sim.lpars) if (sim.config.lpars.find((x) => x.id === l.id)?.kind === 'ZOS') msu[l.id] = l.msuRate;
  for (const r of sim.capping.lpars) r4ha[r.id] = r.r4ha;
  const engines = sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  const delivered = sim.lpars.reduce((a, l) => a + (l.pools.find((p) => p.pool === 'CP')?.deliveredEngines ?? 0), 0);
  const secOfDay = ((sim.tick * 10) / 3600 + 6) % 24;
  const capacityMsu = sim.config.cpcs.reduce((a, c) => a + c.engines.CP * msuPerCp(c), 0);
  return { tick: sim.tick, hourOfDay: secOfDay, msu, r4ha, cpcBusyPct: engines > 0 ? (100 * delivered) / engines : 0, capacityMsu };
}
