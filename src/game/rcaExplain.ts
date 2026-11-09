// The numbers behind a CPU mechanism verdict, in the words a player can check. They are recorded on the
// incident when the truth is decided (see `capacityBasis` in game/sla.ts), so the line always matches the
// hour that decided the verdict, whatever the player does before filing the RCA.

import { CPU_CAPACITY } from '../content/incidents';
import type { Incident } from './types';

const pct = (v: number) => `${v.toFixed(1)} %`;

/** One line explaining the CPU mechanism verdict, e.g. "CPC CPCA averaged 81.2 % busy, below the 90 % capacity
 * line: capacity was not the constraint." Null for other mechanisms or an incident recorded before the basis. */
export function mechanismExplanation(inc: Incident): string | null {
  const b = inc.basis;
  const mech = inc.truth.mechanism;
  if (!b || (mech !== 'CPU_CAPACITY' && mech !== 'CPU_PRIORITY')) return null;
  const cpcLine = Math.round(CPU_CAPACITY.cpcBusyFrac * 100);
  const lparLine = Math.round(CPU_CAPACITY.lparBusyFrac * 100);
  const donorLine = Math.round(CPU_CAPACITY.donorFrac * 100);
  const cpcFull = b.cpcBusyPct >= 100 * CPU_CAPACITY.cpcBusyFrac;
  const lparFull = b.lparBusyPct >= 100 * CPU_CAPACITY.lparBusyFrac;
  const cpcText = `CPC ${b.cpcId} averaged ${pct(b.cpcBusyPct)} busy`;
  const lparText = `LPAR ${b.lparId} used ${pct(b.lparBusyPct)} of the CP it could get`;

  if (mech === 'CPU_CAPACITY') {
    const where = cpcFull ? `${cpcText} (capacity line ${cpcLine} %)` : `${lparText} (capacity line ${lparLine} %)`;
    return `${where}, and less important work had ${pct(b.donorPct)} of the CP against the ${donorLine} % donor line: the machine, not the policy, was short.`;
  }
  if (!cpcFull && !lparFull) return `${cpcText}, below the ${cpcLine} % capacity line: capacity was not the constraint.`;
  const where = cpcFull ? `${cpcText} (capacity line ${cpcLine} %)` : `${lparText} (capacity line ${lparLine} %)`;
  return `${where}, but ${pct(b.donorPct)} of the CP went to less important work (donor line ${donorLine} %): WLM had the CPU to move, so the policy held this work back.`;
}
