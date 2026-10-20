// z/OS dispatcher model for one LPAR and one tick. SPEC §5.4.
// Work is allocated by dispatching priority (DP) level, highest first; equal-DP work
// shares in proportion to demand; queueing delay comes from Erlang-C at the cumulative
// utilisation of work at or above each level.

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
}

export interface DispatchInput {
  cpCapacityEngines: number;
  cpServers: number;
  ziipCapacityEngines: number;
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

/** Fills granted/queueRatio (indexed like the demands) level by level in dispatch order. */
function allocateByPriority(
  capacity: number,
  servers: number,
  demands: readonly DispatchDemand[],
  order: readonly number[],
  want: readonly number[],
  granted: number[],
  queueRatio: number[],
): void {
  let remaining = Math.max(0, capacity);
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
    for (let k = start; k < end; k++) {
      const i = order[k]!;
      granted[i] = levelWant > 0 ? (levelGet * want[i]!) / levelWant : 0;
      queueRatio[i] = q;
    }
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
  allocateByPriority(input.ziipCapacityEngines, input.ziipServers, demands, order, zWant, zGranted, zQueue);

  // zIIP-eligible work that could not get a zIIP overflows to CPs at the same DP.
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
  allocateByPriority(input.cpCapacityEngines, input.cpServers, demands, order, cWant, cGranted, cQueue);

  const prsmDelayRatio = input.cpPrsmDelayFrac / Math.max(1e-6, 1 - input.cpPrsmDelayFrac);
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
      ziipQueueRatio: zQueue[i]!,
      prsmDelayRatio,
      cpUnmet: Math.max(0, d.cpEngines - (cpGot - iipcp)),
      ziipUnmet: Math.max(0, d.ziipEngines - ziipGot - iipcp),
    };
  }
  return out;
}
