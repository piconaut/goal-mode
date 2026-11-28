// Constant demand of a card's loaded roster entity (RF-11). A runaway thread or an unapproved TSO user keeps running
// where it is: its CPU does not rise and fall with its workload's arrival rate, and routing the workload away does not
// move it. A card's load is therefore sized once, when the card begins, as an engine count: the excess the old
// rate-proportional modifier would have carried, averaged over the hours the card usually runs.
//
// The two z/OS facts behind that shape: WLM moves an address space or enclave to the next service-class period as it
// consumes the period's duration in service units, and only the last period has no duration (z/OS 3.1 MVS Planning:
// Workload Manager PDF p.69 (printed 49), PDF p.27 (printed 7)), so long-running work ends in the last period. Routing
// chooses a target for new work requests and lets work already running there complete (CICS TS 6 CICSPlex SM Managing
// Workloads PDF p.96 (printed 90); WLM's sysplex balancing routes the arrival of work and new sessions, WLM Planning
// PDF p.37 (printed 17)). APPROX: the demand is a fluid engine count, not an enclave's real dispatchable units.

import { ROSTERS } from '../../content/entities';
import { clockAt } from '../core/clock';
import type { CpcConfig, LparConfig, WorldConfig } from '../core/types';
import { TICK_SEC } from '../core/units';
import { cpSpeed, generationOf, mpFactor, ziipSpeed } from '../hw/cpc';
import { baseRate } from './arrivals';
import type { WorkloadDef } from './types';

/** Engines of constant demand, split by pool like the workload's own flow. */
export interface EntityDemand {
  cpEngines: number;
  ziipEngines: number;
}

/** Reference engine-seconds one transaction costs on one image. */
interface EngineSecPerTxn {
  cpSecPerTxn: number;
  ziipSecPerTxn: number;
}

/** Reference engine-seconds one of the workload's transactions costs on this image: the same arithmetic as the slice
 * templates, without the run's CPU modifiers. */
export function referenceEngineSecPerTxn(w: WorkloadDef, cpc: CpcConfig, lpar: LparConfig): EngineSecPerTxn {
  const cpLogical = lpar.pools.find((p) => p.pool === 'CP')?.logical ?? 1;
  const mp = 1 / mpFactor(cpLogical, generationOf(cpc).mpK);
  const refSec = (w.cpuMsRef / 1000) * mp;
  return {
    cpSecPerTxn: (refSec * (1 - w.ziipFrac)) / cpSpeed(cpc),
    ziipSecPerTxn: (refSec * w.ziipFrac) / ziipSpeed(cpc),
  };
}

/** Ticks between samples of the arrival shape when averaging a card's usual hours. */
const SAMPLE_TICKS = Math.max(1, Math.round((ROSTERS.sizingSampleMin * 60) / TICK_SEC));

/** Mean deterministic arrival rate (transactions/s, sysplex) over the card's window from `startTick`, including the
 * day's weekly and calendar factors. The random noise and bursts are left out: they average out, and the entity's
 * demand is constant. */
export function meanReferenceRate(w: WorkloadDef, startTick: number, hours: number, monthDayAtStart?: number): number {
  if (!(hours > 0)) return baseRate(w, clockAt(startTick, monthDayAtStart));
  const end = startTick + Math.round(hours * (60 * 60) / TICK_SEC);
  let sum = 0;
  let n = 0;
  for (let t = startTick; t < end; t += SAMPLE_TICKS) {
    sum += baseRate(w, clockAt(t, monthDayAtStart));
    n++;
  }
  return n > 0 ? sum / n : baseRate(w, clockAt(startTick, monthDayAtStart));
}

/** Processors the image has online: the most one enclave or address space can run on. APPROX: a single DDF thread
 * without query parallelism is plausibly about one engine; the model lets a loaded entity reach the whole image
 * (BACKLOG PR-28). */
export function entityEngineCap(config: WorldConfig, lparId: string): number {
  const lpar = config.lpars.find((l) => l.id === lparId);
  const logical = lpar?.pools.reduce((n, p) => n + (p.pool === 'CP' || p.pool === 'ZIIP' ? p.logical : 0), 0) ?? 0;
  return logical > 0 ? logical : Infinity;
}

/** The constant demand one culprit carries, engines. `excessFrac` is the card's whole excess (cpuMult − 1) scaled by
 * difficulty, divided over the culprits by the caller; `ratePerSec` the workload's mean reference arrival rate. */
export function sizedEntityDemand(w: WorkloadDef, config: WorldConfig, lparId: string, ratePerSec: number, excessFrac: number): EntityDemand {
  const lpar = config.lpars.find((l) => l.id === lparId);
  const cpc = lpar && config.cpcs.find((c) => c.id === lpar.cpcId);
  if (!lpar || !cpc || !(excessFrac > 0) || !(ratePerSec > 0)) return { cpEngines: 0, ziipEngines: 0 };
  const perTxn = referenceEngineSecPerTxn(w, cpc, lpar);
  let cpEngines = excessFrac * ratePerSec * perTxn.cpSecPerTxn;
  let ziipEngines = excessFrac * ratePerSec * perTxn.ziipSecPerTxn;
  const cap = entityEngineCap(config, lparId);
  const total = cpEngines + ziipEngines;
  if (total > cap) {
    const f = cap / total;
    cpEngines *= f;
    ziipEngines *= f;
  }
  return { cpEngines, ziipEngines };
}
