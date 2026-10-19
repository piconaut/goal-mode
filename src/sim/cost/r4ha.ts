// Rolling 4-hour average and soft capping (SPEC §5.11.1). WLM samples MSU consumption
// and keeps 48 five-minute values; the R4HA is their mean. When the R4HA exceeds the
// defined capacity (or a group's capacity limit), the LPAR is capped until it drops back.

import { R4HA_SLOTS, TICKS_PER_R4HA_SLOT } from '../core/units';

export interface R4haState {
  id: string;
  /** 48 five-minute MSU averages, oldest first. Starts at zero (IPL). */
  slots: number[];
  curSum: number;
  curTicks: number;
  r4ha: number;
  capped: boolean;
  /** Fraction of ticks capped in the current slot (for reporting). */
  cappedTicks: number;
}

export const newR4ha = (id: string): R4haState => ({
  id,
  slots: new Array<number>(R4HA_SLOTS).fill(0),
  curSum: 0,
  curTicks: 0,
  r4ha: 0,
  capped: false,
  cappedTicks: 0,
});

/** Add one tick of MSU consumption; at each 5-minute boundary roll the window and re-decide capping. */
export function stepR4ha(st: R4haState, msuRate: number, limitMsu: number | null): R4haState {
  let { slots, curSum, curTicks, r4ha, capped, cappedTicks } = st;
  curSum += msuRate;
  curTicks += 1;
  if (capped) cappedTicks += 1;
  if (curTicks >= TICKS_PER_R4HA_SLOT) {
    slots = [...slots.slice(1), curSum / curTicks];
    r4ha = slots.reduce((a, b) => a + b, 0) / slots.length;
    curSum = 0;
    curTicks = 0;
    cappedTicks = 0;
    capped = limitMsu !== null && r4ha > limitMsu;
  }
  if (limitMsu === null) capped = false;
  return { id: st.id, slots, curSum, curTicks, r4ha, capped, cappedTicks };
}

/**
 * Group capacity: under capping each member is entitled to limit × weight share; members
 * using less than their share donate the surplus to the others (SG24-7621 §4.21).
 */
export function groupShares(limitMsu: number, members: { id: string; weight: number; demandMsu: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  let remaining = limitMsu;
  let active = members.slice();
  for (let iter = 0; iter < 8 && active.length > 0; iter++) {
    const w = active.reduce((a, m) => a + m.weight, 0) || 1;
    const next: typeof active = [];
    let used = 0;
    for (const m of active) {
      const share = (remaining * m.weight) / w;
      if (m.demandMsu <= share) {
        out[m.id] = m.demandMsu;
        used += m.demandMsu;
      } else next.push(m);
    }
    if (next.length === active.length) {
      for (const m of active) out[m.id] = (remaining * m.weight) / w;
      return out;
    }
    remaining -= used;
    active = next;
  }
  for (const m of active) out[m.id] = out[m.id] ?? 0;
  return out;
}
