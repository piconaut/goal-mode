// WLM runtime state: per-system service-class-period DPs and smoothed measurements.

import { decayMoved, mergeWorkManager, type MovedSamples, type WorkManagerSamples } from './reporting';
import { DP } from '../zos/dispatcher';
import { canonical, ladderOf, levelDp, levelOf, placeNew, type Ladder } from './ladder';
import { NO_SERVERS, type HolderTopology } from './holders';
import { POLICY_ADJUST } from '../../content/wlm/tuning';
import { emptyBuckets, performanceIndex } from './goals';
import type { ScpTick } from './evaluate';
import { SYSOTHER, SYSSTC, SYSTEM, type Goal, type Importance, type ServiceDefinition } from './types';

/** Per-tick decay of the smoothed PI accumulators (APPROX: one exponential window, not WLM's rows of history). */
export const ACC_DECAY = POLICY_ADJUST.accDecay;

export interface ScpAcc {
  /** Reporting only (Monitor III): the decayed part of using/delay/CPU that RMF reports with CICS region classes,
   * and the CICS work manager states. */
  moved?: MovedSamples;
  workManager?: WorkManagerSamples;
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
  /** Decayed storage (paging) and queue delay, both also in `delay` (WT-10: managed delays told apart). Absent in old
   * saves: `decayInto` seeds storage with the part of `delay` no other component explains, queue with 0. */
  delayStorage?: number;
  delayQueue?: number;
  cpuEngines: number;
  /** Decayed zIIP engines used (the zIIP counterpart of `cpuEngines`, for donors of a zIIP bottleneck; WT-07). Absent
   * in a period's first tick and in old saves: seeded at steady state. */
  ziipEngines?: number;
  /** Decayed arriving demand, engines, without backlog: × (1 − ACC_DECAY) is the sustained demand WLM projects
   * with (docs/wlm-design.md §5.4). Absent in a period's first tick and in old saves: seeded at steady state. */
  demandCp?: number;
  demandZi?: number;
  /** Parts of using / delay left out of velocity (I/O priority management off); absent when none. */
  usingIoNoVel?: number;
  delayIoNoVel?: number;
  /** Velocity samples of transaction-server regions: reported, but not used to manage this period; absent when none. */
  srvUsing?: number;
  srvDelay?: number;
  /** The capping delay inside `srvDelay` (the managed-delay test leaves capping out); absent in old saves. */
  srvDelayCap?: number;
}

/** Velocity samples: all using / delay samples except I/O while I/O priority management is off. */
export const velUsing = (a: { using: number; usingIoNoVel?: number }): number => a.using - (a.usingIoNoVel ?? 0);
export const velDelay = (a: { delay: number; delayIoNoVel?: number }): number => a.delay - (a.delayIoNoVel ?? 0);

/** The capping delay inside `srvDelay`. A save from before `srvDelayCap` holds server history without it: the most it
 * can be (all capping, up to `srvDelay`) is assumed, so the managed-delay test errs toward assessing the period. */
export const srvDelayCapOf = (a: { delayCap: number; srvDelay?: number; srvDelayCap?: number }): number =>
  a.srvDelayCap ?? Math.min(a.delayCap, a.srvDelay ?? 0);

export interface ScpState {
  scKey: string;
  dp: number;
  starvedSec: number;
  acc: ScpAcc;
  /** Skip clock: a receiver whose every trial was rejected is not assessed again before this tick (WLM Services
   * p.145). Absent when no clock runs. */
  skipUntilTick?: number;
  /** The interval's projection budget ran out at this receiver: the next interval's search starts here (only one
   * period per image carries it). APPROX: real WLM assesses every receiver; the budget is for cost. */
  resumeSearch?: true;
}

/** A server period (`$SRMS001`, holders.ts): it holds the DP of the TRANSACTION regions and the CICS transactions
 * of its image. No goal and no PI of its own; the served classes are its goal receivers and donors. */
export interface ServerPeriodState {
  key: string;
  dp: number;
}

export interface WlmSystemState {
  lparId: string;
  scps: ScpState[];
  /** Sorted by key. Absent with no server period, and in a save from before server periods: then created with the
   * highest DP among the served periods, which is where the regions ran (docs/wlm-design.md §5.1). */
  servers?: ServerPeriodState[];
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
  // The first ladder: one level per importance (docs/wlm-design.md §5.6); the interval's end makes it canonical.
  return levelDp(g.importance - 1);
}

const isGoal = (def: ServiceDefinition, k: string): boolean => {
  const g = goalInfo(def, k);
  return g !== null && g.goal.kind !== 'DISC';
};

/** The holder ladder of `dps` (goal periods that hold their own DP, and the server period) and the holders'
 * importances: a server period's is the most important of the classes it serves (SG24-6472-03 p.62–63). */
function holderLadder(def: ServiceDefinition, dps: Readonly<Record<string, number>>, topo: HolderTopology): {
  L: Ladder;
  imp: (k: string) => number | undefined;
  goal: Record<string, number>;
} {
  const server = topo.serverKey;
  let serverImp: number | undefined;
  for (const k of Object.keys(topo.heldBy)) {
    const i = goalInfo(def, k)?.importance;
    if (i !== undefined && (serverImp === undefined || i < serverImp)) serverImp = i;
  }
  const imp = (k: string) => (k === server ? serverImp : goalInfo(def, k)?.importance);
  const goal: Record<string, number> = {};
  for (const k of Object.keys(dps)) if (topo.heldBy[k] === undefined && isGoal(def, k)) goal[k] = dps[k]!;
  if (server && dps[server] !== undefined) goal[server] = dps[server]!;
  return { L: ladderOf(goal), imp, goal };
}

/**
 * DPs for an image's tick when periods it has not dispatched before appear (docs/wlm-design.md §5.6): each new goal
 * period is placed on the ladder by importance (`placeNew`, in key order: the result does not depend on it), and the
 * ladder is made canonical, which renumbers held periods without changing their order. Other new periods get their
 * fixed DP. The ladder is of holders (`topo`): a new served period takes its server period's DP, and a server period
 * not yet on the ladder is placed by its most important served class. `held` is not changed.
 */
export function placeNewPeriods(
  def: ServiceDefinition,
  held: Readonly<Record<string, number>>,
  fresh: readonly string[],
  topo: HolderTopology = NO_SERVERS,
): Record<string, number> {
  const out: Record<string, number> = { ...held };
  const lad = holderLadder(def, held, topo);
  let L = lad.L;
  let placed = false;
  const server = topo.serverKey;
  for (const k of [...new Set(fresh)].sort()) {
    if (held[k] !== undefined) continue;
    if (topo.heldBy[k] !== undefined) {
      if (levelOf(L, server!) < 0) {
        L = placeNew(L, server!, lad.imp(server!)!, lad.imp);
        placed = true;
      }
    } else if (!isGoal(def, k)) out[k] = initialDp(def, k);
    else {
      L = placeNew(L, k, lad.imp(k)!, lad.imp);
      placed = true;
    }
  }
  if (placed) Object.assign(out, canonical(L));
  if (server && out[server] !== undefined) for (const k of Object.keys(topo.heldBy)) out[k] = out[server]!;
  return out;
}

/**
 * The DP of one new period once the tick's other DPs are in use, so nothing else may be renumbered: its level's DP,
 * or for a new level the free priority below the level above it (above the level below it on top). APPROX: with no
 * free priority there (two new levels in one gap in one tick) it shares the level below until the next move. A served
 * period takes its server period's DP.
 */
export function placeLateDp(def: ServiceDefinition, dps: Readonly<Record<string, number>>, k: string, topo: HolderTopology = NO_SERVERS): number {
  if (!isGoal(def, k)) return initialDp(def, k);
  const server = topo.heldBy[k];
  if (server !== undefined && dps[server] !== undefined) return dps[server]!;
  const { L: L0, imp, goal } = holderLadder(def, dps, topo);
  const L = placeNew(L0, k, imp(k)!, imp);
  const i = L.findIndex((lv) => lv.includes(k));
  const mate = L[i]!.find((x) => x !== k);
  if (mate !== undefined) return goal[mate]!;
  const up = L[i - 1]?.[0];
  const down = L[i + 1]?.[0];
  if (up !== undefined) return Math.max(goal[up]! - 1, DP.MANAGED_MIN);
  if (down !== undefined) return Math.min(goal[down]! + 1, DP.MANAGED_MAX);
  return levelDp(0);
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
  delayStorage: 0,
  delayQueue: 0,
  cpuEngines: 0,
});

function decayBuckets(acc: readonly number[], add: readonly number[], d: number): number[] {
  const out = new Array<number>(acc.length);
  for (let i = 0; i < acc.length; i++) out[i] = acc[i]! * d + (add[i] ?? 0);
  return out;
}

export function decayInto(acc: ScpAcc, t: ScpTick): ScpAcc {
  const d = ACC_DECAY;
  const out: ScpAcc = {
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
    delayStorage: (acc.delayStorage ?? Math.max(0, acc.delay - acc.delayCpu - acc.delayZiip - acc.delayIo - acc.delayCap)) * d + t.delayStorage,
    delayQueue: (acc.delayQueue ?? 0) * d + (t.delayQueue ?? 0),
    cpuEngines: acc.cpuEngines * d + t.cpEngines + t.iipcpEngines,
    ziipEngines: acc.ziipEngines === undefined ? t.ziipEngines / (1 - d) : acc.ziipEngines * d + t.ziipEngines,
    demandCp: acc.demandCp === undefined ? (t.demandCp ?? 0) / (1 - d) : acc.demandCp * d + (t.demandCp ?? 0),
    demandZi: acc.demandZi === undefined ? (t.demandZi ?? 0) / (1 - d) : acc.demandZi * d + (t.demandZi ?? 0),
    ...(acc.usingIoNoVel !== undefined || t.usingIoNoVel !== undefined
      ? { usingIoNoVel: (acc.usingIoNoVel ?? 0) * d + (t.usingIoNoVel ?? 0), delayIoNoVel: (acc.delayIoNoVel ?? 0) * d + (t.delayIoNoVel ?? 0) }
      : {}),
    ...(acc.srvUsing !== undefined || t.srvUsing !== undefined
      ? {
          srvUsing: (acc.srvUsing ?? 0) * d + (t.srvUsing ?? 0),
          srvDelay: (acc.srvDelay ?? 0) * d + (t.srvDelay ?? 0),
          srvDelayCap: srvDelayCapOf(acc) * d + (t.srvDelayCap ?? 0),
        }
      : {}),
  };
  const moved = decayMoved(acc.moved, t.moved, d);
  if (moved) out.moved = moved;
  if (t.workManager || acc.workManager) {
    const wm = mergeWorkManager(acc.workManager, t.workManager, d);
    if (t.workManager || wm.active + wm.ready + wm.idle + wm.waitingIo + wm.waitingLock + wm.waitingProd + wm.waitingMisc > 1e-9) out.workManager = wm;
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
  if (a.delayStorage !== undefined) out.delayStorage = (out.delayStorage ?? 0) + a.delayStorage;
  if (a.delayQueue !== undefined) out.delayQueue = (out.delayQueue ?? 0) + a.delayQueue;
  out.cpuEngines += a.cpuEngines;
  if (a.usingIoNoVel !== undefined) {
    out.usingIoNoVel = (out.usingIoNoVel ?? 0) + a.usingIoNoVel;
    out.delayIoNoVel = (out.delayIoNoVel ?? 0) + (a.delayIoNoVel ?? 0);
  }
  if (a.srvUsing !== undefined) {
    out.srvUsing = (out.srvUsing ?? 0) + a.srvUsing;
    out.srvDelay = (out.srvDelay ?? 0) + (a.srvDelay ?? 0);
    out.srvDelayCap = (out.srvDelayCap ?? 0) + srvDelayCapOf(a);
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
