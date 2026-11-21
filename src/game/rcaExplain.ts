// The numbers behind a CPU mechanism verdict, in the words a player can check. They are recorded on the
// incident when the truth is decided (see `capacityBasis` in game/sla.ts), so the line always matches the
// hour that decided the verdict, whatever the player does before filing the RCA.

import { CPU_CAPACITY } from '../content/incidents';
import type { Incident } from './types';

const pct = (v: number) => `${v.toFixed(1)} %`;

/** One line explaining the CPU mechanism verdict, e.g. "CPC CPCA averaged 81.2 % busy, below the 90 % capacity
 * line: capacity was not the constraint." When the hour's bands accept both capacity and priority (RT-07), it says so
 * instead of ruling the other answer out. Null for other mechanisms or an incident recorded before the basis. `label`
 * names the victim whose hour the line describes, for a group whose victims differ (RT-15). */
export function mechanismExplanation(inc: Incident, label?: string): string | null {
  const line = verdictLine(inc);
  return line !== null && label ? `${label}: ${line}` : line;
}

function verdictLine(inc: Incident): string | null {
  const b = inc.basis;
  const mech = inc.truth.mechanism;
  if (!b || (mech !== 'CPU_CAPACITY' && mech !== 'CPU_PRIORITY')) return null;
  const mechanisms = inc.truth.accepted.mechanisms;
  const both = mechanisms.includes('CPU_CAPACITY') && mechanisms.includes('CPU_PRIORITY');
  const cpcLine = Math.round(CPU_CAPACITY.cpcBusyFrac * 100);
  const lparLine = Math.round(CPU_CAPACITY.lparBusyFrac * 100);
  const donorLine = Math.round(CPU_CAPACITY.displaceableFrac * 100);
  const share = b.displaceablePct ?? b.donorPct;
  const pool = b.pool ?? 'CP';
  const consumers = (b.topConsumers ?? []).map((c) => `${c.name} ${pct(c.pct)}`).join(', ');
  const prefix = `${b.lparId}${b.excessSharePct !== undefined ? ` carried ${pct(b.excessSharePct)} of the CPU wait excess` : ''}: ${pool} pool${consumers ? `; consumers ${consumers}` : ''}. `;
  const cpcFull = b.cpcBusyPct >= 100 * CPU_CAPACITY.cpcBusyFrac;
  const lparFull = b.lparBusyPct >= 100 * CPU_CAPACITY.lparBusyFrac;
  const cpcText = `CPC ${b.cpcId} averaged ${pct(b.cpcBusyPct)} busy`;
  const lparText = `LPAR ${b.lparId} used ${pct(b.lparBusyPct)} of the ${pool} it could get`;

  if (b.overflowBlocked) return `${prefix}${cpcText}; ${pct(share)} displaceable. zIIP work could not overflow despite CP room: policy or configuration prevented CP help.${both ? ' The zIIP pool was also at its limit, so either CPU answer scores.' : ''}`;

  if (mech === 'CPU_CAPACITY') {
    const where = cpcFull ? `${cpcText} (capacity line ${cpcLine} %)` : `${lparText} (capacity line ${lparLine} %)`;
    const figures = `${prefix}${where}, and displaceable work had ${pct(share)} of the ${pool} against the ${donorLine} % displaceable line`;
    return both
      ? `${figures}: the machine was at its limit, and the hour cannot settle capacity against priority, so either answer scores.`
      : `${figures}: the machine, not the policy, was short.`;
  }
  if (!cpcFull && !lparFull) {
    return both
      ? `${prefix}${cpcText}, below the ${cpcLine} % capacity line, with ${pct(share)} of the ${pool} displaceable: the hour does not settle capacity against priority, so either answer scores.`
      : `${prefix}${cpcText}, below the ${cpcLine} % capacity line: capacity was not the constraint.`;
  }
  const where = cpcFull ? `${cpcText} (capacity line ${cpcLine} %)` : `${lparText} (capacity line ${lparLine} %)`;
  return both
    ? `${prefix}${where}, and ${pct(share)} of the ${pool} was displaceable (displaceable line ${donorLine} %): the policy could have moved CPU, and the machine was at its limit, so either answer scores.`
    : `${prefix}${where}, but ${pct(share)} of the ${pool} was displaceable (displaceable line ${donorLine} %): WLM had the CPU to move, so the policy held this work back.`;
}
