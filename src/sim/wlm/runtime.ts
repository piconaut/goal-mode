// WLM runtime state: per-system service-class-period DPs and smoothed measurements.

import { mergeWorkManager, type WorkManagerSamples } from './reporting';
import { DP } from '../zos/dispatcher';
import { emptyBuckets, performanceIndex } from './goals';
import type { ScpTick } from './evaluate';
import { SYSOTHER, SYSSTC, SYSTEM, type Goal, type Importance, type ServiceDefinition } from './types';

/** Per-tick decay of the smoothed PI accumulators (APPROX: WLM looks back a few minutes). */
export const ACC_DECAY = 0.85;

export interface ScpAcc {
  workManager?: WorkManagerSamples;
  resourceSamples?: boolean;
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
  /** Parts of using / delay left out of velocity (I/O priority management off); absent when none. */
  usingIoNoVel?: number;
  delayIoNoVel?: number;
  /** Velocity samples of transaction-server regions: reported, but not used to manage this period; absent when none. */
  srvUsing?: number;
  srvDelay?: number;
}

/** Velocity samples: all using / delay samples except I/O while I/O priority management is off. */
export const velUsing = (a: { using: number; usingIoNoVel?: number }): number => a.using - (a.usingIoNoVel ?? 0);
export const velDelay = (a: { delay: number; delayIoNoVel?: number }): number => a.delay - (a.delayIoNoVel ?? 0);

export interface ScpState {
  scKey: string;
  dp: number;
  starvedSec: number;
  acc: ScpAcc;
  /** Reporting accounting, independent of WLM management measurements (absent in old saves). */
  reportAcc?: ScpAcc;
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
  // A mixed class can lose its last non-CICS member. Keep resource metrics available while
  // its earlier samples remain in the Monitor III smoothing history.
  const retainedResources = acc.resourceSamples === true &&
    d * (acc.using + acc.delay + acc.delayOther + acc.cpuEngines) > 1e-9;
  const workManager = t.workManager || acc.workManager ? mergeWorkManager(acc.workManager, t.workManager, d) : undefined;
  const retainedWorkManager = workManager &&
    workManager.active + workManager.ready + workManager.idle + workManager.waitingIo + workManager.waitingOther > 1e-9;
  const out: ScpAcc = {
    // Subsystem Actual velocity is N/A only while subsystem data remain available (RMF p.237).
    ...(workManager && (t.workManager || retainedWorkManager) ? { workManager } : {}),
    ...(t.resourceSamples !== undefined ? { resourceSamples: t.resourceSamples || retainedResources } : acc.resourceSamples !== undefined ? { resourceSamples: acc.resourceSamples } : {}),
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
    ...(acc.usingIoNoVel !== undefined || t.usingIoNoVel !== undefined
      ? { usingIoNoVel: (acc.usingIoNoVel ?? 0) * d + (t.usingIoNoVel ?? 0), delayIoNoVel: (acc.delayIoNoVel ?? 0) * d + (t.delayIoNoVel ?? 0) }
      : {}),
    ...(acc.srvUsing !== undefined || t.srvUsing !== undefined
      ? { srvUsing: (acc.srvUsing ?? 0) * d + (t.srvUsing ?? 0), srvDelay: (acc.srvDelay ?? 0) * d + (t.srvDelay ?? 0) }
      : {}),
  };
  if (out.resourceSamples === false) {
    // Expired resource samples must not leave a normalized DELAY percentage behind.
    out.using = out.delay = out.delayCpu = out.delayZiip = out.delayIo = out.delayOther = out.delayCap = out.cpuEngines = 0;
    if (out.usingIoNoVel !== undefined) out.usingIoNoVel = out.delayIoNoVel = 0;
  }
  return out;
}

export function sumAcc(accs: readonly ScpAcc[]): ScpAcc {
  const out = emptyAcc();
  for (const a of accs) addAccInto(out, a);
  return out;
}

function addAccInto(out: ScpAcc, a: ScpAcc): void {
  if (a.workManager) out.workManager = mergeWorkManager(out.workManager, a.workManager);
  out.resourceSamples = (out.resourceSamples ?? false) || (a.resourceSamples ?? true);
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
  if (a.usingIoNoVel !== undefined) {
    out.usingIoNoVel = (out.usingIoNoVel ?? 0) + a.usingIoNoVel;
    out.delayIoNoVel = (out.delayIoNoVel ?? 0) + (a.delayIoNoVel ?? 0);
  }
  if (a.srvUsing !== undefined) {
    out.srvUsing = (out.srvUsing ?? 0) + a.srvUsing;
    out.srvDelay = (out.srvDelay ?? 0) + (a.srvDelay ?? 0);
  }
}

export function accPi(goal: Goal, a: ScpAcc): number | null {
  return performanceIndex(goal, {
    completions: a.completions,
    rtSumSec: a.rtSumSec,
    buckets: a.buckets,
    usingSamples: velUsing(a),
    delaySamples: velDelay(a),
  });
}

/** The PI WLM manages a period to: like accPi, but without the samples of transaction-server regions, which are
 * managed to the goals of the transactions they serve (WLM Planning p.122). APPROX: a class holding only such
 * regions has no samples left and is not managed; a mixed class is managed for its other members. */
export function goalPi(goal: Goal, a: ScpAcc): number | null {
  if (a.srvUsing === undefined) return accPi(goal, a);
  return performanceIndex(goal, {
    completions: a.completions,
    rtSumSec: a.rtSumSec,
    buckets: a.buckets,
    usingSamples: velUsing(a) - a.srvUsing,
    delaySamples: velDelay(a) - (a.srvDelay ?? 0),
  });
}

export function tickPi(goal: Goal, t: ScpTick): number | null {
  return performanceIndex(goal, {
    completions: t.completions,
    rtSumSec: t.rtSumSec,
    buckets: t.buckets,
    usingSamples: t.usingCpu + t.usingZiip + t.usingIo - (t.usingIoNoVel ?? 0) - (t.srvUsing ?? 0),
    delaySamples: t.delayCpu + t.delayZiip + t.delayIo + t.delayStorage + t.delayCap + (t.delayQueue ?? 0) - (t.delayIoNoVel ?? 0) - (t.srvDelay ?? 0),
  });
}

/** Sysplex PI per scKey (the goal-management PI, see goalPi): merge every system's accumulators, then compute. */
export function sysplexPis(def: ServiceDefinition, systems: readonly WlmSystemState[]): Record<string, number | null> {
  // Summed in system order, as sumAcc would (hot path: no per-period arrays).
  const sums: Record<string, ScpAcc> = {};
  for (const s of systems) for (const p of s.scps) addAccInto((sums[p.scKey] ??= emptyAcc()), p.acc);
  const out: Record<string, number | null> = {};
  for (const k in sums) {
    const g = goalInfo(def, k);
    out[k] = g ? goalPi(g.goal, sums[k]!) : null;
  }
  return out;
}
