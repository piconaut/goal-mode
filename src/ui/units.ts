import { SU_PER_SEC_PER_MSU } from '../sim/hw/cpc';

export interface CpcSpeed {
  id: string;
  /** Service units per second delivered by one general CP on this CPC. */
  suPerCpuSec: number;
}

/** Two significant digits below 1, without trailing zeros and without exponent notation. */
export function fmtSuRate(x: number): string {
  if (!Number.isFinite(x) || x < 0) return '-';
  if (x === 0) return '0';
  const dp = x >= 10 ? 0 : x >= 1 ? 2 : 1 - Math.floor(Math.log10(x));
  const s = x.toFixed(dp);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** A type 1 resource-group limit is SU/s: show its MSU value and the CP equivalent on each CPC. */
export function rgLimitEquiv(suPerSec: number | null, cpcs: readonly CpcSpeed[]): string | null {
  if (suPerSec === null || !Number.isFinite(suPerSec) || suPerSec < 0) return null;
  const msu = `≈ ${fmtSuRate(suPerSec / SU_PER_SEC_PER_MSU)} MSU`;
  if (cpcs.length === 0) return msu;
  const cps = cpcs.map((c) => `${fmtSuRate(suPerSec / c.suPerCpuSec)} CP${cpcs.length > 1 ? ` (${c.id})` : ''}`);
  return `${msu} ≈ ${cps.join(' / ')}`;
}
