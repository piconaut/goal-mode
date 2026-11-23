// Rolling 4-hour average and soft capping (SPEC §5.11.1). WLM samples MSU consumption
// and keeps 48 five-minute values; the R4HA is their mean. When the R4HA exceeds the
// defined capacity (or a group's capacity limit), the LPAR is capped until it drops back.
// At IPL the window holds no usage, so the R4HA starts at zero and early spikes go uncapped
// (MVS Planning: WLM, "Workload management and Workload License Charges"). APPROX: the cap is a
// flat MSU limit; real WLM caps via phantom weight, which can also cut VH/VM processors while capped.

import { R4HA_SLOTS, TICKS_PER_R4HA_SLOT } from '../core/units';

/** Ticks in a full four-hour R4HA window (48 five-minute slots). */
export const R4HA_WINDOW_TICKS = R4HA_SLOTS * TICKS_PER_R4HA_SLOT;

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

/**
 * A member's view of its capacity group's four-hour average: the group's slot history since the member joined, with
 * the slots before that counted as zero. A partition that joined less than four hours ago therefore sees a lower used
 * average than the existing members — the documented "different view of unused group capacity", so it may cap
 * differently (RMF Report Analysis 3.1 PDF p.400 (printed 360); Planning for Sub-Capacity Pricing PDF p.69 (printed
 * 53)). The arithmetic itself is inferred: IBM states the different view, not how a member computes it (APPROX).
 *
 * `joinTick` is the first simulated tick the member's window includes, and `tick` is the tick just simulated.
 * APPROX: a join inside a group slot counts that whole slot once it completes, so up to five minutes of usage from
 * before the join can enter the member's view.
 */
export function groupMemberR4ha(group: R4haState, joinTick: number, tick: number): number {
  const slots = Math.min(R4HA_SLOTS, Math.max(0, Math.floor((tick - joinTick) / TICKS_PER_R4HA_SLOT)));
  if (slots <= 0) return 0;
  return group.slots.slice(R4HA_SLOTS - slots).reduce((a, b) => a + b, 0) / R4HA_SLOTS;
}

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
 * using less than their share donate the surplus to the others (SG24-7621 §4.21; MVS Planning: WLM,
 * "Defining group capacity"). A member's own defined capacity still applies.
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
