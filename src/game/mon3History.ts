// Monitor III history (SPEC §8): one Monitor III view per MINTIME, kept for the retention window so the
// tabular reports can be redisplayed for a past interval. Held by the worker, outside the run, so saves
// and golden hashes don't grow. Each view is packed: every number goes into one Float32Array and the
// rest (names, goal text, structure) is interned, since it rarely changes between intervals.

import { MON3_HISTORY } from '../content/tools';
import { TICKS_PER_HOUR } from '../sim/core/units';
import type { Mon3View } from './mon3';

export const MON3_HISTORY_MAX = (MON3_HISTORY.retentionHours * TICKS_PER_HOUR) / MON3_HISTORY.mintimeTicks;

interface Shape {
  id: number;
  json: string;
}

export interface Mon3Packed {
  tick: number;
  nums: Float32Array;
  /** Interned shape of the view's scalars and of each array element, in pack order. */
  shapes: readonly Shape[];
}

export interface Mon3History {
  entries: Mon3Packed[];
  /** Shape intern pool, keyed by JSON; `lists` interns whole shape lists by their ids. */
  pool: Map<string, Shape>;
  lists: Map<string, readonly Shape[]>;
}

export interface Mon3HistoryRange {
  firstTick: number;
  lastTick: number;
  count: number;
  everyTicks: number;
}

export const emptyMon3History = (): Mon3History => ({ entries: [], pool: new Map(), lists: new Map() });

// Numbers (and nulls, as NaN) leave the shape; a 0 in a shape is always a number slot.
function strip(x: unknown, nums: number[]): unknown {
  if (typeof x === 'number') {
    nums.push(x);
    return 0;
  }
  if (x === null) {
    nums.push(NaN);
    return 0;
  }
  if (Array.isArray(x)) return x.map((y) => strip(y, nums));
  if (typeof x === 'object' && x) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x)) {
      const v = (x as Record<string, unknown>)[k];
      if (v !== undefined) o[k] = strip(v, nums);
    }
    return o;
  }
  return x;
}

function fill(x: unknown, nums: Float32Array, at: { i: number }): unknown {
  if (typeof x === 'number') {
    const v = nums[at.i++]!;
    return Number.isNaN(v) ? null : v;
  }
  if (Array.isArray(x)) return x.map((y) => fill(y, nums, at));
  if (typeof x === 'object' && x) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(x)) o[k] = fill((x as Record<string, unknown>)[k], nums, at);
    return o;
  }
  return x;
}

type Parts = { head: Record<string, unknown>; arrays: [string, unknown[]][] };
function split(view: Mon3View): Parts {
  const head: Record<string, unknown> = {};
  const arrays: [string, unknown[]][] = [];
  for (const [k, v] of Object.entries(view)) {
    if (Array.isArray(v)) arrays.push([k, v]);
    else head[k] = v;
  }
  return { head, arrays };
}

function intern(h: Mon3History, json: string): Shape {
  let s = h.pool.get(json);
  if (!s) {
    s = { id: h.pool.size, json };
    h.pool.set(json, s);
  }
  return s;
}

export function packMon3(h: Mon3History, tick: number, view: Mon3View): Mon3Packed {
  const nums: number[] = [];
  const { head, arrays } = split(view);
  const shapes: Shape[] = [intern(h, JSON.stringify({ head: strip(head, nums), arrays: arrays.map(([k, a]) => [k, a.length]) }))];
  for (const [, a] of arrays) for (const el of a) shapes.push(intern(h, JSON.stringify(strip(el, nums))));
  const key = shapes.map((s) => s.id).join(',');
  let list = h.lists.get(key);
  if (!list) {
    list = shapes;
    h.lists.set(key, list);
  }
  return { tick, nums: Float32Array.from(nums), shapes: list };
}

export function unpackMon3(p: Mon3Packed): Mon3View {
  const at = { i: 0 };
  const top = JSON.parse(p.shapes[0]!.json) as { head: Record<string, unknown>; arrays: [string, number][] };
  const view = fill(top.head, p.nums, at) as Record<string, unknown>;
  let s = 1;
  for (const [k, n] of top.arrays) {
    const a: unknown[] = [];
    for (let i = 0; i < n; i++) a.push(fill(JSON.parse(p.shapes[s++]!.json), p.nums, at));
    view[k] = a;
  }
  return view as unknown as Mon3View;
}

/** Adds one interval and drops what fell out of the retention window. Mutates the intern pools. */
export function recordMon3History(h: Mon3History, tick: number, view: Mon3View): Mon3History {
  const entries = [...h.entries.filter((e) => e.tick < tick), packMon3(h, tick, view)].slice(-MON3_HISTORY_MAX);
  // Pools only grow; rebuild them from the live entries now and then so dropped shapes go too.
  if (h.pool.size > 4 * MON3_HISTORY_MAX || h.lists.size > 2 * MON3_HISTORY_MAX) {
    const fresh = emptyMon3History();
    return { ...fresh, entries: entries.map((e) => packMon3(fresh, e.tick, unpackMon3(e))) };
  }
  return { ...h, entries };
}

/** The interval ending at or before `tick` (Monitor III shows the range that ends at the chosen time). */
export function mon3At(h: Mon3History, tick: number): { tick: number; view: Mon3View } | null {
  let lo = 0;
  let hi = h.entries.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (h.entries[mid]!.tick <= tick) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  const e = h.entries[found]!;
  return { tick: e.tick, view: unpackMon3(e) };
}

export function mon3HistoryRange(h: Mon3History): Mon3HistoryRange | null {
  const first = h.entries[0];
  const last = h.entries.at(-1);
  return first && last ? { firstTick: first.tick, lastTick: last.tick, count: h.entries.length, everyTicks: MON3_HISTORY.mintimeTicks } : null;
}
