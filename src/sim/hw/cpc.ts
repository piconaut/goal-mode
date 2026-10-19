import { CAPACITY_SETTING_FRAC, GENERATIONS, type GenerationSpec } from '../../content/hardware';
import type { CpcConfig } from '../core/types';

export function generationOf(cpc: CpcConfig): GenerationSpec {
  const g = GENERATIONS[cpc.generation];
  if (!g) throw new Error(`Unknown generation ${cpc.generation}`);
  return g;
}

/** MSU rating of one general CP at the CPC's capacity setting. */
export function msuPerCp(cpc: CpcConfig): number {
  return generationOf(cpc).fullSpeedMsuPerCp * CAPACITY_SETTING_FRAC[cpc.capacitySetting];
}

/** General CP speed relative to the reference engine; sub-capacity CPs are slower engines. */
export function cpSpeed(cpc: CpcConfig): number {
  return generationOf(cpc).relativeSpeed * CAPACITY_SETTING_FRAC[cpc.capacitySetting];
}

/** zIIPs always run at full speed regardless of the CP capacity setting. */
export function ziipSpeed(cpc: CpcConfig): number {
  return generationOf(cpc).relativeSpeed;
}

/** Multiprocessor effect: diminishing per-engine throughput as an image grows. */
export function mpFactor(engines: number, k: number): number {
  if (engines <= 1) return 1;
  return Math.max(0.5, 1 - k * Math.log(engines));
}

/** Service units per engine-second: MSU = millions of SU per hour. */
export function suPerCpuSecOf(cpc: CpcConfig): number {
  return (msuPerCp(cpc) * 1e6) / 3600;
}
