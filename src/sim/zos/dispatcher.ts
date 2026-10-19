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

interface Level {
  dp: number;
  items: { id: string; want: number }[];
}

function groupByDp(items: { id: string; dp: number; want: number }[]): Level[] {
  const levels: Level[] = [];
  const sorted = [...items].sort((a, b) => b.dp - a.dp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const it of sorted) {
    const last = levels[levels.length - 1];
    if (last && last.dp === it.dp) last.items.push({ id: it.id, want: it.want });
    else levels.push({ dp: it.dp, items: [{ id: it.id, want: it.want }] });
  }
  return levels;
}

interface PoolOutcome {
  granted: Record<string, number>;
  queueRatio: Record<string, number>;
}

function allocateByPriority(
  capacity: number,
  servers: number,
  items: { id: string; dp: number; want: number }[],
): PoolOutcome {
  const granted: Record<string, number> = {};
  const queueRatio: Record<string, number> = {};
  let remaining = Math.max(0, capacity);
  let usedAbove = 0;
  for (const level of groupByDp(items)) {
    const levelWant = level.items.reduce((a, i) => a + i.want, 0);
    const levelGet = Math.min(levelWant, remaining);
    remaining -= levelGet;
    usedAbove += levelGet;
    const rho = capacity > 0 ? usedAbove / capacity : 1;
    const q = queueDelayRatio(servers, rho);
    for (const it of level.items) {
      granted[it.id] = levelWant > 0 ? (levelGet * it.want) / levelWant : 0;
      queueRatio[it.id] = q;
    }
  }
  return { granted, queueRatio };
}

export function dispatch(input: DispatchInput): DispatchResult[] {
  const z = allocateByPriority(
    input.ziipCapacityEngines,
    input.ziipServers,
    input.demands.map((d) => ({ id: d.id, dp: d.dp, want: d.ziipEngines })),
  );

  // zIIP-eligible work that could not get a zIIP overflows to CPs at the same DP.
  const overflow: Record<string, number> = {};
  for (const d of input.demands) {
    const unmet = d.ziipEngines - (z.granted[d.id] ?? 0);
    overflow[d.id] = d.ziipMayOverflow || input.ziipServers === 0 ? Math.max(0, unmet) : 0;
  }

  const c = allocateByPriority(
    input.cpCapacityEngines,
    input.cpServers,
    input.demands.map((d) => ({ id: d.id, dp: d.dp, want: d.cpEngines + (overflow[d.id] ?? 0) })),
  );

  return input.demands.map((d) => {
    const cpWant = d.cpEngines + (overflow[d.id] ?? 0);
    const cpGot = c.granted[d.id] ?? 0;
    const ov = overflow[d.id] ?? 0;
    // Native CP work and overflowed zIIP work share the grant pro rata.
    const iipcp = cpWant > 0 ? (cpGot * ov) / cpWant : 0;
    const ziipGot = z.granted[d.id] ?? 0;
    return {
      id: d.id,
      cpGranted: cpGot - iipcp,
      ziipGranted: ziipGot,
      iipcpGranted: iipcp,
      cpQueueRatio: c.queueRatio[d.id] ?? 0,
      ziipQueueRatio: z.queueRatio[d.id] ?? 0,
      prsmDelayRatio: input.cpPrsmDelayFrac / Math.max(1e-6, 1 - input.cpPrsmDelayFrac),
      cpUnmet: Math.max(0, d.cpEngines - (cpGot - iipcp)),
      ziipUnmet: Math.max(0, d.ziipEngines - ziipGot - iipcp),
    };
  });
}
