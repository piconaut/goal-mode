// WLM runtime state: per-system service-class-period DPs and smoothed measurements.

import { DP } from '../zos/dispatcher';
import { emptyBuckets, performanceIndex } from './goals';
import type { ScpTick } from './evaluate';
import { SYSOTHER, SYSSTC, SYSTEM, type Goal, type Importance, type ServiceDefinition } from './types';

/** Per-tick decay of the smoothed PI accumulators (APPROX: WLM looks back a few minutes). */
export const ACC_DECAY = 0.85;

export interface ScpAcc {
  completions: number;
  rtSumSec: number;
  buckets: number[];
  using: number;
  delay: number;
  delayCpu: number;
  delayZiip: number;
  delayIo: number;
  delayOther: number;
  delayCap: number;
  cpuEngines: number;
}

export interface ScpState {
  scKey: string;
  dp: number;
  starvedSec: number;
  acc: ScpAcc;
}

export interface WlmSystemState {
  lparId: string;
  scps: ScpState[];
}

export interface WlmState {
  definition: ServiceDefinition;
  systems: WlmSystemState[];
  log: string[];
}

export interface ScpGoalInfo {
  serviceClass: string;
  period: number;
  goal: Goal;
  importance: Importance;
  cpuCritical: boolean;
  resourceGroup: string | null;
}

export function parseScKey(scKey: string): { serviceClass: string; period: number } {
  const i = scKey.lastIndexOf('#');
  return { serviceClass: scKey.slice(0, i), period: Number(scKey.slice(i + 1)) - 1 };
}

// Memoised per definition object (edits produce a new one); results are shared, never mutated.
const goalInfoCache = new WeakMap<ServiceDefinition, Map<string, ScpGoalInfo | null>>();

/** Goal info for a period; null for SYSTEM/SYSSTC (no goal, fixed DP). */
export function goalInfo(def: ServiceDefinition, scKey: string): ScpGoalInfo | null {
  let cache = goalInfoCache.get(def);
  if (!cache) goalInfoCache.set(def, (cache = new Map()));
  let g = cache.get(scKey);
  if (g === undefined) cache.set(scKey, (g = goalInfoUncached(def, scKey)));
  return g;
}

function goalInfoUncached(def: ServiceDefinition, scKey: string): ScpGoalInfo | null {
  const { serviceClass, period } = parseScKey(scKey);
  if (serviceClass === SYSTEM || serviceClass === SYSSTC) return null;
  if (serviceClass === SYSOTHER) {
    return { serviceClass, period, goal: { kind: 'DISC' }, importance: 5, cpuCritical: false, resourceGroup: null };
  }
  const c = def.classes.find((x) => x.id === serviceClass);
  const p = c?.periods[period];
  if (!c || !p) return { serviceClass, period, goal: { kind: 'DISC' }, importance: 5, cpuCritical: false, resourceGroup: null };
  return { serviceClass, period, goal: p.goal, importance: p.importance, cpuCritical: c.cpuCritical, resourceGroup: c.resourceGroup };
}

export function initialDp(def: ServiceDefinition, scKey: string): number {
  const { serviceClass } = parseScKey(scKey);
  if (serviceClass === SYSTEM) return DP.SYSTEM;
  if (serviceClass === SYSSTC) return DP.SYSSTC;
  const g = goalInfo(def, scKey);
  if (!g || g.goal.kind === 'DISC') return 196;
  return DP.MANAGED_MAX - 2 - (g.importance - 1) * 6;
}

export const emptyAcc = (): ScpAcc => ({
  completions: 0,
  rtSumSec: 0,
  buckets: emptyBuckets(),
  using: 0,
  delay: 0,
  delayCpu: 0,
  delayZiip: 0,
  delayIo: 0,
  delayOther: 0,
  delayCap: 0,
  cpuEngines: 0,
});

function decayBuckets(acc: readonly number[], add: readonly number[], d: number): number[] {
  const out = new Array<number>(acc.length);
  for (let i = 0; i < acc.length; i++) out[i] = acc[i]! * d + (add[i] ?? 0);
  return out;
}

export function decayInto(acc: ScpAcc, t: ScpTick): ScpAcc {
  const d = ACC_DECAY;
  return {
    completions: acc.completions * d + t.completions,
    rtSumSec: acc.rtSumSec * d + t.rtSumSec,
    buckets: decayBuckets(acc.buckets, t.buckets, d),
    using: acc.using * d + t.usingCpu + t.usingZiip + t.usingIo,
    delay: acc.delay * d + t.delayCpu + t.delayZiip + t.delayIo + t.delayStorage + t.delayCap + (t.delayQueue ?? 0),
    delayCpu: acc.delayCpu * d + t.delayCpu,
    delayZiip: acc.delayZiip * d + t.delayZiip,
    delayIo: acc.delayIo * d + t.delayIo,
    delayOther: acc.delayOther * d + t.delayOther,
    delayCap: acc.delayCap * d + t.delayCap,
    cpuEngines: acc.cpuEngines * d + t.cpEngines + t.iipcpEngines,
  };
}

export function sumAcc(accs: readonly ScpAcc[]): ScpAcc {
  const out = emptyAcc();
  for (const a of accs) addAccInto(out, a);
  return out;
}

function addAccInto(out: ScpAcc, a: ScpAcc): void {
  out.completions += a.completions;
  out.rtSumSec += a.rtSumSec;
  for (let i = 0; i < a.buckets.length; i++) out.buckets[i] = (out.buckets[i] ?? 0) + a.buckets[i]!;
  out.using += a.using;
  out.delay += a.delay;
  out.delayCpu += a.delayCpu;
  out.delayZiip += a.delayZiip;
  out.delayIo += a.delayIo;
  out.delayOther += a.delayOther;
  out.delayCap += a.delayCap;
  out.cpuEngines += a.cpuEngines;
}

export function accPi(goal: Goal, a: ScpAcc): number | null {
  return performanceIndex(goal, {
    completions: a.completions,
    rtSumSec: a.rtSumSec,
    buckets: a.buckets,
    usingSamples: a.using,
    delaySamples: a.delay,
  });
}

export function tickPi(goal: Goal, t: ScpTick): number | null {
  return performanceIndex(goal, {
    completions: t.completions,
    rtSumSec: t.rtSumSec,
    buckets: t.buckets,
    usingSamples: t.usingCpu + t.usingZiip + t.usingIo,
    delaySamples: t.delayCpu + t.delayZiip + t.delayIo + t.delayStorage + t.delayCap + (t.delayQueue ?? 0),
  });
}

/** Sysplex PI per scKey: merge every system's accumulators, then compute. */
export function sysplexPis(def: ServiceDefinition, systems: readonly WlmSystemState[]): Record<string, number | null> {
  // Summed in system order, as sumAcc would (hot path: no per-period arrays).
  const sums: Record<string, ScpAcc> = {};
  for (const s of systems) for (const p of s.scps) addAccInto((sums[p.scKey] ??= emptyAcc()), p.acc);
  const out: Record<string, number | null> = {};
  for (const k in sums) {
    const g = goalInfo(def, k);
    out[k] = g ? accPi(g.goal, sums[k]!) : null;
  }
  return out;
}
