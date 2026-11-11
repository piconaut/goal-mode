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

/** One MSU is a million service units per hour, i.e. 277.8 SU/s (WLM Planning p.44). */
export const SU_PER_SEC_PER_MSU = 1e6 / 3600;

/** Service units per engine-second: MSU = millions of SU per hour. */
export function suPerCpuSecOf(cpc: CpcConfig): number {
  return (msuPerCp(cpc) * 1e6) / 3600;
}

/** SMF70CAI, capacity-adjustment indication: 1–99 while capacity is reduced against the normal (peak) setting,
 * undefined when not adjusted (MVS SMF p.589). */
export function capacityAdjustmentIndication(cpc: { capacitySetting: 4 | 5 | 6 | 7; peakCapacitySetting?: 4 | 5 | 6 | 7 }): number | undefined {
  const peak = cpc.peakCapacitySetting;
  if (peak === undefined || CAPACITY_SETTING_FRAC[cpc.capacitySetting] >= CAPACITY_SETTING_FRAC[peak]) return undefined;
  return Math.max(1, Math.round((100 * CAPACITY_SETTING_FRAC[cpc.capacitySetting]) / CAPACITY_SETTING_FRAC[peak]));
}

/** SMF70CAI as a loss: 100 − SMF70CAI, 0 when not adjusted (the same figure Partition Data reports). */
export function capacityLossPct(cpc: { capacitySetting: 4 | 5 | 6 | 7; peakCapacitySetting?: 4 | 5 | 6 | 7 }): number {
  const cai = capacityAdjustmentIndication(cpc);
  return cai === undefined ? 0 : 100 - cai;
}
