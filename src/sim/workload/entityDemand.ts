// Constant demand of a card's loaded roster entity (RF-11). A runaway thread or an unapproved TSO user keeps running
// where it is: its CPU does not rise and fall with its workload's arrival rate, and routing the workload away does not
// move it. A card's load is therefore sized once, when the card begins, as an engine count: the excess the old
// rate-proportional modifier would have carried, averaged over the hours the card usually runs.

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

/** Ticks between samples of the arrival shape when averaging a card's usual hours (15 sim-minutes). */
const SAMPLE_TICKS = Math.max(1, Math.round((15 * 60) / TICK_SEC));

/** Mean deterministic arrival rate (transactions/s, sysplex) over the card's window from `startTick`, including the
 * day's weekly and calendar factors. The random noise and bursts are left out: they average out, and the entity's
 * demand is constant. */
export function meanReferenceRate(w: WorkloadDef, startTick: number, hours: number): number {
  if (!(hours > 0)) return baseRate(w, clockAt(startTick));
  const end = startTick + Math.round(hours * (60 * 60) / TICK_SEC);
  let sum = 0;
  let n = 0;
  for (let t = startTick; t < end; t += SAMPLE_TICKS) {
    sum += baseRate(w, clockAt(t));
    n++;
  }
  return n > 0 ? sum / n : baseRate(w, clockAt(startTick));
}

/** Processors the image has online: the most one enclave or address space can run on. */
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
