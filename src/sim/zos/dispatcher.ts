// z/OS dispatcher model for one LPAR and one tick. SPEC §5.4.
// Work is allocated by dispatching priority (DP) level, highest first; equal-DP work
// shares by ready units (max-min fair, see shareByUnits); queueing delay comes from Erlang-C
// at the cumulative utilisation of work at or above each level.

import { queueDelayRatio } from './erlang';

/** Fixed DPs from SG24-7621 §3.14. */
export const DP = {
  SYSTEM: 255,
  SYSSTC: 254,
  SMALL_CONSUMER: 253,
  MANAGED_MAX: 252,
  MANAGED_MIN: 208,
  DISCRETIONARY_MAX: 201,
  DISCRETIONARY_MIN: 192,
  QUIESCED: 191,
} as const;

export interface DispatchDemand {
  id: string;
  dp: number;
  /** Engines' worth of CPU wanted on general CPs. */
  cpEngines: number;
  /** Engines' worth of zIIP-eligible CPU wanted. */
  ziipEngines: number;
  /** May overflow to CPs when zIIPs are busy (IIPHONORPRIORITY=YES and not discretionary). */
  ziipMayOverflow: boolean;
  /** Dispatchable units (TCBs/SRBs) behind this demand: its weight at an equal DP. Absent: one per
   * engine of demand, which shares the level in proportion to demand. */
  units?: number;
}

export interface DispatchInput {
  /** Service capacity used for queueing estimates, including available white space. */
  cpCapacityEngines: number;
  /** Joint PR/SM reservation: bounds execution without changing the service capacity. */
  cpAllocatedEngines?: number;
  cpServers: number;
  ziipCapacityEngines: number;
  ziipAllocatedEngines?: number;
  ziipServers: number;
  /** Short-engine PR/SM delay fraction for CPs (cannot be fixed by WLM). */
  cpPrsmDelayFrac: number;
  demands: readonly DispatchDemand[];
}

export interface DispatchResult {
  id: string;
  cpGranted: number;
  ziipGranted: number;
  /** zIIP-eligible work that ran on a CP (RMF APPL% IIPCP). */
  iipcpGranted: number;
  /** Delay-to-using ratios by cause; multiply by using samples to get delay samples. */
  cpQueueRatio: number;
  ziipQueueRatio: number;
  prsmDelayRatio: number;
  /** Unmet demand this tick, engines' worth (becomes backlog/delay). */
  cpUnmet: number;
  ziipUnmet: number;
}

/** Demand indices by DP descending, then id: the dispatch order (ids are unique). */
function dispatchOrder(demands: readonly DispatchDemand[]): number[] {
  const idx = demands.map((_, i) => i);
  return idx.sort((a, b) => {
    const da = demands[a]!;
    const db = demands[b]!;
    return db.dp - da.dp || (da.id < db.id ? -1 : da.id > db.id ? 1 : 0);
  });
}

/**
 * Splits `total` engines among work at one DP the way the z/OS dispatcher's single queue does: every ready
 * unit gets an equal turn, so each entry gets min(want, units × L) for one fair level L per unit, and what a
 * light entry leaves is shared by the rest (max-min fairness). Units default to `want` (share by demand).
 * APPROX: a fluid processor-sharing view of time slicing; units are time averages, not counted TCBs/SRBs.
 * Writes into `out` at `idx`; `total` must not exceed the sum of `want` over `idx`.
 */
export function shareByUnits(total: number, idx: readonly number[], want: readonly number[], units: readonly (number | undefined)[], out: number[]): void {
  const m = idx.length;
  let proportional = true;
  let wantSum = 0;
  for (let k = 0; k < m; k++) {
    const i = idx[k]!;
    wantSum += want[i]!;
    if (units[i] !== undefined) proportional = false;
  }
  if (total >= wantSum || proportional) {
    for (let k = 0; k < m; k++) {
      const i = idx[k]!;
      out[i] = wantSum > 0 ? (total >= wantSum ? want[i]! : (total * want[i]!) / wantSum) : 0;
    }
    return;
  }
  if (m === 1) {
    out[idx[0]!] = Math.min(total, want[idx[0]!]!);
    return;
  }
  // Fill entries in order of want per unit: the lightest are satisfied first.
  const u = new Array<number>(m);
  const per = new Array<number>(m);
  const ord = new Array<number>(m);
  let unitsLeft = 0;
  for (let k = 0; k < m; k++) {
    const i = idx[k]!;
    const w = want[i]!;
    const ui = w > 0 ? ((units[i] ?? 0) > 0 ? units[i]! : w) : 0;
    u[k] = ui;
    per[k] = ui > 0 ? w / ui : 0;
    ord[k] = k;
    unitsLeft += ui;
  }
  ord.sort((a, b) => per[a]! - per[b]! || a - b);
  let remaining = total;
  let k = 0;
  for (; k < m; k++) {
    const j = ord[k]!;
    const i = idx[j]!;
    if (u[j]! <= 0) {
      out[i] = 0;
      continue;
    }
    if (per[j]! * unitsLeft > remaining) break;
    out[i] = want[i]!;
    remaining -= want[i]!;
    unitsLeft -= u[j]!;
  }
  const level = unitsLeft > 0 ? Math.max(0, remaining) / unitsLeft : 0;
  for (; k < m; k++) {
    const j = ord[k]!;
    out[idx[j]!] = Math.min(want[idx[j]!]!, u[j]! * level);
  }
}

/** Fills granted/queueRatio (indexed like the demands) level by level in dispatch order. */
function allocateByPriority(
  capacity: number,
  servers: number,
  demands: readonly DispatchDemand[],
  order: readonly number[],
  want: readonly number[],
  units: readonly (number | undefined)[],
  granted: number[],
  queueRatio: number[],
  allocatedEngines = capacity,
): void {
  let remaining = Math.max(0, Math.min(capacity, allocatedEngines));
  let usedAbove = 0;
  for (let start = 0; start < order.length; ) {
    const dp = demands[order[start]!]!.dp;
    let end = start;
    let levelWant = 0;
    while (end < order.length && demands[order[end]!]!.dp === dp) levelWant += want[order[end++]!]!;
    const levelGet = Math.min(levelWant, remaining);
    remaining -= levelGet;
    usedAbove += levelGet;
    const rho = capacity > 0 ? usedAbove / capacity : 1;
    const q = queueDelayRatio(servers, rho);
    if (levelGet >= levelWant) {
      for (let k = start; k < end; k++) granted[order[k]!] = want[order[k]!]!;
    } else {
      shareByUnits(levelGet, order.slice(start, end), want, units, granted);
    }
    for (let k = start; k < end; k++) queueRatio[order[k]!] = q;
    start = end;
  }
}

export function dispatch(input: DispatchInput): DispatchResult[] {
  const { demands } = input;
  const n = demands.length;
  const order = dispatchOrder(demands);
  const zWant = new Array<number>(n);
  for (let i = 0; i < n; i++) zWant[i] = demands[i]!.ziipEngines;
  const zGranted = new Array<number>(n).fill(0);
  const zQueue = new Array<number>(n).fill(0);
  const units = demands.map((d) => d.units);
  allocateByPriority(input.ziipCapacityEngines, input.ziipServers, demands, order, zWant, units, zGranted, zQueue, input.ziipAllocatedEngines);

  // zIIP-eligible work that could not get a zIIP overflows to CPs at the same DP (IIPHONORPRIORITY=YES,
  // the default); with no zIIPs online it simply runs on CPs (MVS Init & Tuning Ref, IEAOPTxx).
  const overflow = new Array<number>(n);
  const cWant = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const d = demands[i]!;
    const unmet = d.ziipEngines - zGranted[i]!;
    overflow[i] = d.ziipMayOverflow || input.ziipServers === 0 ? Math.max(0, unmet) : 0;
    cWant[i] = d.cpEngines + overflow[i]!;
  }
  const cGranted = new Array<number>(n).fill(0);
  const cQueue = new Array<number>(n).fill(0);
  allocateByPriority(input.cpCapacityEngines, input.cpServers, demands, order, cWant, units, cGranted, cQueue, input.cpAllocatedEngines);

  const prsmDelayRatio = input.cpPrsmDelayFrac / Math.max(1e-6, 1 - input.cpPrsmDelayFrac);
  const noZiip = input.ziipServers === 0;
  const out = new Array<DispatchResult>(n);
  for (let i = 0; i < n; i++) {
    const d = demands[i]!;
    const cpWant = cWant[i]!;
    const cpGot = cGranted[i]!;
    const ov = overflow[i]!;
    // Native CP work and overflowed zIIP work share the grant pro rata.
    const iipcp = cpWant > 0 ? (cpGot * ov) / cpWant : 0;
    const ziipGot = zGranted[i]!;
    out[i] = {
      id: d.id,
      cpGranted: cpGot - iipcp,
      ziipGranted: ziipGot,
      iipcpGranted: iipcp,
      cpQueueRatio: cQueue[i]!,
      // With no zIIP online, eligible work is plain CP work and queues like it (Init & Tuning p.431).
      ziipQueueRatio: noZiip ? cQueue[i]! + prsmDelayRatio : zQueue[i]!,
      prsmDelayRatio,
      cpUnmet: Math.max(0, d.cpEngines - (cpGot - iipcp)),
      ziipUnmet: Math.max(0, d.ziipEngines - ziipGot - iipcp),
    };
  }
  return out;
}
