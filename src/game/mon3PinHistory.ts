// Monitor III history for the headless play CLI: per MINTIME only the values a pin can read (PI, CPU, ended rate
// and delays per service-class period; PR/SM delay and capping per LPAR), for the same retention as the browser's
// full history (mon3History.ts). Kept beside the run file, never in RunState, so saves and hashes don't grow.

import { MON3_HISTORY } from '../content/tools';
import { TICKS_PER_HOUR } from '../sim/core/units';
import type { Mon3Cpc, Mon3Row, Mon3View } from './mon3';

/** What `addPin` reads from a Monitor III view: the full view (browser) or this trimmed one (CLI). */
export interface Mon3PinView {
  rows: Pick<Mon3Row, 'system' | 'scKey' | 'pi' | 'cpuEngines' | 'endedPerSec' | 'delay'>[];
  cpc: Pick<Mon3Cpc, 'lparId' | 'prsmDelayPct' | 'cappedPct'>[];
}

/** The interval ending at or before a tick, or null when history doesn't reach back that far. */
export type Mon3PinLookup = (tick: number) => { tick: number; view: Mon3PinView } | null;

interface KeySet {
  /** [system, scKey] per row, and lparId per CPC row, in the order the entries' numbers follow. */
  rows: [string, string][];
  cpc: string[];
}

export interface Mon3PinHistory {
  version: 1;
  /** Row and LPAR names change only with the policy or configuration, so entries point at a shared set. */
  keySets: KeySet[];
  /** r: 9 numbers per row (pi, cpuEngines, endedPerSec, delay cpu/ziip/io/stor/cap/other); c: 2 per LPAR. */
  entries: { tick: number; k: number; r: (number | null)[]; c: number[] }[];
}

const RETENTION_TICKS = MON3_HISTORY.retentionHours * TICKS_PER_HOUR;
const ROW_NUMS = 9;
// Pins show at most two decimals of a percentage or PI; four decimals of a fraction keep that.
const round = (x: number) => Math.round(x * 1e4) / 1e4;

export const emptyMon3PinHistory = (): Mon3PinHistory => ({ version: 1, keySets: [], entries: [] });

export function recordMon3Pins(h: Mon3PinHistory, tick: number, view: Mon3View): Mon3PinHistory {
  const keys: KeySet = { rows: view.rows.map((r) => [r.system, r.scKey]), cpc: view.cpc.map((c) => c.lparId) };
  let keySets = h.keySets;
  let k = keySets.length - 1;
  if (k < 0 || JSON.stringify(keySets[k]) !== JSON.stringify(keys)) {
    keySets = [...keySets, keys];
    k = keySets.length - 1;
  }
  const r = view.rows.flatMap((x) => [x.pi === null ? null : round(x.pi), round(x.cpuEngines), round(x.endedPerSec), ...[x.delay.cpu, x.delay.ziip, x.delay.io, x.delay.stor, x.delay.cap, x.delay.other].map(round)]);
  const c = view.cpc.flatMap((x) => [round(x.prsmDelayPct), round(x.cappedPct)]);
  const entries = [...h.entries.filter((e) => e.tick < tick && e.tick > tick - RETENTION_TICKS), { tick, k, r, c }];
  // Key sets are appended in order, so entries' k never decreases: drop the sets no entry uses any more.
  const minK = entries[0]!.k;
  return minK === 0 ? { ...h, keySets, entries } : { ...h, keySets: keySets.slice(minK), entries: entries.map((e) => ({ ...e, k: e.k - minK })) };
}

export function mon3PinsAt(h: Mon3PinHistory, tick: number): { tick: number; view: Mon3PinView } | null {
  let e: Mon3PinHistory['entries'][number] | undefined;
  for (const x of h.entries) {
    if (x.tick > tick) break;
    e = x;
  }
  if (!e) return null;
  const keys = h.keySets[e.k]!;
  const n = (i: number) => e!.r[i] ?? 0;
  const rows = keys.rows.map(([system, scKey], i) => {
    const o = i * ROW_NUMS;
    return { system, scKey, pi: e!.r[o] ?? null, cpuEngines: n(o + 1), endedPerSec: n(o + 2), delay: { cpu: n(o + 3), ziip: n(o + 4), io: n(o + 5), stor: n(o + 6), cap: n(o + 7), other: n(o + 8) } };
  });
  const cpc = keys.cpc.map((lparId, i) => ({ lparId, prsmDelayPct: e!.c[2 * i]!, cappedPct: e!.c[2 * i + 1]! }));
  return { tick: e.tick, view: { rows, cpc } };
}

export const mon3PinRange = (h: Mon3PinHistory): { firstTick: number; lastTick: number } | null =>
  h.entries.length ? { firstTick: h.entries[0]!.tick, lastTick: h.entries.at(-1)!.tick } : null;
