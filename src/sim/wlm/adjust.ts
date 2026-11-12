// WLM policy adjustment (SG24-7621 §3.12–3.15), run every 10 s per system:
// pick the most important, worst-PI receiver; find its bottleneck; try DP moves
// (receiver up, donors down); accept the first move with receiver value and net value.
// At most one receiver is helped per interval.
// Two PIs, each with one job (docs/wlm-design.md §5.2): receivers are chosen on the management PI (the smoothed
// accumulators); every trial is judged on projected PIs, `base` at the current DPs against `after` at the trial's,
// both from the dispatcher model at sustained demand (projection.ts).

import { PCT_PROJECTION_SIGMA, POLICY_ADJUST } from '../../content/wlm/tuning';
import { formatClock } from '../core/clock';
import { canonical, ladderOf, levelOf, moveToLevel, type Ladder } from './ladder';
import { evaluateLpar, prepareLpar, type LparEvalInput, type ScpTick } from './evaluate';
import { projectionInput } from './projection';
import { batchRecoveryAccepts, type BatchProjectionSlice } from './batchProjection';
import { projectedPercentilePi } from './goals';
import { ACC_DECAY, goalPi, goalInfo, srvDelayCapOf, tickPi, type ScpGoalInfo, type ScpState, type WlmSystemState } from './runtime';
import { buildPlan, formatPlanMoves, type PlanMove, type PlanAssessment } from './plan';
import type { ServiceDefinition } from './types';

export type Bottleneck = 'CPU' | 'ZIIP' | 'IO' | 'CAP' | 'OTHER' | 'NONE';

export function bottleneckOf(t: { delayCpu: number; delayZiip: number; delayIo: number; delayOther: number; delayCap: number }): Bottleneck {
  const opts: [Bottleneck, number][] = [
    ['CPU', t.delayCpu],
    ['ZIIP', t.delayZiip],
    ['IO', t.delayIo],
    ['CAP', t.delayCap],
    ['OTHER', t.delayOther],
  ];
  let best: [Bottleneck, number] = ['NONE', 1e-9];
  for (const o of opts) if (o[1] > best[1]) best = o;
  return best[0];
}

export interface AdjustInput {
  def: ServiceDefinition;
  system: WlmSystemState;
  /** This tick's evaluation input; dpOf is replaced during projection. */
  evalInput: Omit<LparEvalInput, 'dpOf'>;
  current: readonly ScpTick[];
  sysplexPi: Readonly<Record<string, number | null>>;
  clockText: string;
  /** IEAOPT CCIMP on this system. */
  ccImp?: number;
  /** This interval's tick: skip clocks are compared with it and set from it (absent = 0). */
  nowTick?: number;
  /** Measured demand and next-tick demand already enabled by execution's grants. */
  batch?: readonly BatchProjectionSlice[];
}

export interface AdjustOutput {
  dps: Record<string, number>;
  log: string | null;
  /** DPs lowered to restore long-term CPU protection before any receiver was assessed. */
  protect: string | null;
  /** Skip clocks still running after this interval (period → first tick it may be assessed again). */
  skipUntil: Record<string, number>;
  /** Where the next interval's search starts (`ScpState.resumeSearch`): set when the projection budget stopped this
   * one, kept when a move was accepted, null once a search reached the end of the list. */
  resumeAt: string | null;
  /** First rejection notes when a receiver starts a skip clock, including off the periodic log cadence. */
  clockNotes: string[];
}

/** Why a trial DP move was accepted or rejected (investigation trace only). */
export type WlmTrialVerdict =
  | 'ACCEPTED'
  | 'RETAINED' // net value passed; tentative until the complete plan has receiver value
  | 'CPU_CRITICAL' // a less important period would reach a CPU-protected period's DP
  | 'NO_RECEIVER_GAIN' // projected receiver PI does not improve
  | 'SMALL_GAIN' // improves by less than the receiver value threshold
  | 'MORE_IMPORTANT_HARMED' // a more important period would be pushed past its goal
  | 'EQUAL_DISPARITY' // an equal-importance period is harmed and the PIs don't get closer
  | 'NO_NET_VALUE' // equal-importance harm outweighs the receiver's gain
  | 'PROJECTION_DISAGREES'; // a receiver-up move for a receiver measured far worse than projected (projectionTrustMax)

export interface WlmTrialTrace {
  move: string;
  verdict: WlmTrialVerdict;
  /** Receiver PI before → projected after (unclamped, as judged). A `CPU_CRITICAL` trial was never projected, so its
   * after value is null; a trial with no receiver PI at all omits the pair. */
  receiverPi?: [number | null, number | null];
  detail?: string;
  blockedBy?: string;
  projected?: boolean;
  steps?: PlanMove[];
  /** Retained moves of the accepted atomic plan (only on its final ACCEPTED proposal). */
  plan?: PlanMove[];
  afterPis?: Record<string, number | null>;
  afterDps?: Record<string, number>;
}

/**
 * Delay shares a bottleneck was chosen from: each delay component over `using + delay`. The denominator keeps the
 * storage and queue delay that have no numerator of their own, and `IO` is the velocity share (delay I/O priority
 * management cannot see is subtracted), so the five do not sum to 1.
 */
export type WlmDelayShares = Record<Exclude<Bottleneck, 'NONE'>, number>;

export interface WlmCandidateTrace {
  scKey: string;
  importance: number;
  sysplexPi: number | null;
  localPi: number | null;
  dp: number;
  bottleneck: Bottleneck | null;
  /**
   * The shares `bottleneckOf` saw for this period (zero when it used and lost no time). On a `BUDGET` candidate the
   * bottleneck was never chosen; the shares are still recorded so a consumer always has the period's accounting.
   */
  delayShares: WlmDelayShares;
  /** Donor periods in the order their trials were built (assessed receivers; empty when none qualified). */
  donors?: string[];
  /** SKIP_CLOCK: its skip clock has not expired (`skipUntilTick`); NO_MANAGED_DELAY: its managed delay is under
   * `needsHelpDelayFrac` (`managedDelayFrac`); NOT_FIXABLE: bottleneck isn't CPU/zIIP; RECOVERING: its projected PI at
   * sustained demand and the current DPs is already ≤ 1 (or unknown): no trials; BUDGET: the interval's projection
   * budget was spent before it (the search stops); ASSESSED: trials below. */
  outcome: 'SKIP_CLOCK' | 'NO_MANAGED_DELAY' | 'NOT_FIXABLE' | 'RECOVERING' | 'BUDGET' | 'ASSESSED';
  /** SKIP_CLOCK: the tick from which it may be assessed again; ASSESSED: the clock set because every trial was
   * rejected (absent when a move was accepted or the budget ran out first). */
  skipUntilTick?: number;
  /** The managed delay share the needs-help test saw. */
  managedDelayFrac?: number;
  /** Projected PI at the current DPs (the basis every trial is judged against); absent when not computed. */
  basePi?: number | null;
  planOutcome?: 'ACCEPTED' | 'REJECTED' | 'BUDGET' | 'STEP_LIMIT';
  trials: WlmTrialTrace[];
}

export interface WlmAdjustTrace {
  clockText: string;
  lparId: string;
  dps: Record<string, number>;
  candidates: WlmCandidateTrace[];
  action: string | null;
  /** Moves that restored CPU protection this interval (before the receivers). */
  protection: string[];
}

// Investigation tooling only (tools/inspect.ts): never set by the game, never part of state, and it doesn't change
// what policyAdjust decides.
let traceSink: ((t: WlmAdjustTrace) => void) | null = null;
export function setWlmTraceSink(sink: ((t: WlmAdjustTrace) => void) | null): void {
  traceSink = sink;
}

/** CPU-protected periods: CPU Critical, or a first or only period at or above the CCIMP importance. */
export const cpuProtected = (g: Pick<ScpGoalInfo, 'cpuCritical' | 'period' | 'importance'>, ccImp: number): boolean =>
  g.cpuCritical || (g.period === 0 && g.importance <= ccImp);

/** The DPs of `dps` with its goal periods (`keys`) on `ladder`'s canonical DPs; other periods keep theirs. */
const withLadder = (dps: Readonly<Record<string, number>>, ladder: Ladder): Record<string, number> => ({ ...dps, ...canonical(ladder) });

/** The ladder of the goal periods `keys` at `dps`. */
const ladderAt = (dps: Readonly<Record<string, number>>, keys: readonly string[]): Ladder => {
  const goal: Record<string, number> = {};
  for (const k of keys) if (dps[k] !== undefined) goal[k] = dps[k]!;
  return ladderOf(goal);
};

/**
 * Make the goal periods' DPs canonical (docs/wlm-design.md §5.6; an old save's are on the first interval, order kept)
 * and restore long-term CPU protection: every period less important than a protected period goes to a new level
 * directly below the lowest protected level above it. WLM enforces the protection rather than refusing to manage (WLM
 * Planning p.120: "less important work will generally have a lower dispatch priority"). A policy activation can break
 * it (CPU Critical newly set while batch holds a DP it earned under the old policy); DPs carry over by period. APPROX:
 * the less important period is lowered rather than the protected one raised, so the protection costs only the work
 * it is meant to cost. Importance order makes one pass enough: a protected period's level is final before any less
 * important period is checked against it.
 */
export function enforceCpuProtection(
  dps: Readonly<Record<string, number>>,
  info: Readonly<Record<string, Pick<ScpGoalInfo, 'cpuCritical' | 'period' | 'importance'>>>,
  ccImp: number,
): { dps: Record<string, number>; moves: string[] } {
  const keys = Object.keys(info).filter((k) => dps[k] !== undefined).sort();
  let L = ladderAt(dps, keys);
  const moved: [string, string][] = [];
  // Everything moved below one protected level shares one new level there, whatever its importance (as one DP did).
  const belowOf: Record<string, string> = {};
  for (let imp = 2; imp <= 5; imp++) {
    // The lowest level holding a protected period more important than `imp`, named by a period on it.
    let floorKey: string | null = null;
    for (const k of keys) {
      if (info[k]!.importance < imp && cpuProtected(info[k]!, ccImp) && (floorKey === null || levelOf(L, k) > levelOf(L, floorKey))) floorKey = k;
    }
    if (floorKey === null) continue;
    for (const k of keys) {
      if (info[k]!.importance !== imp || levelOf(L, k) > levelOf(L, floorKey)) continue;
      const first = belowOf[floorKey];
      L = first === undefined ? moveToLevel(L, k, levelOf(L, floorKey), 'below') : moveToLevel(L, k, levelOf(L, first));
      belowOf[floorKey] ??= k;
      moved.push([k, floorKey]);
    }
  }
  const out = withLadder(dps, L);
  // Named by the DPs before and after all the moves: a protected period can itself be lowered before it is the floor
  // of a later move, so targets in any intermediate numbering would contradict each other.
  const moves = moved.map(([k, floorKey]) => `${k} DP ${hex(dps[k]!)}→${hex(out[k]!)} below ${floorKey}`);
  return { dps: out, moves };
}

/**
 * The share of a period's samples that are delays WLM manages (docs/wlm-design.md §5.7): CPU, zIIP, I/O in velocity,
 * storage and queue delay. Capping delay is in `delay` but reported, not managed. Waits for locks, servers, the CF or
 * the QR TCB (`delayOther`) are not delay states and are not in `delay` at all (`decayInto`), so nothing is taken off
 * for them. A period with none is not assessed (WLM Services p.144: "no delay samples"). The population is the one
 * the period's goal PI is taken from (`goalPi`): velocity samples without those of transaction-server regions, which
 * are managed to the goals of the transactions they serve (WLM Planning p.122).
 */
export function managedDelayFrac(
  acc: Pick<ScpState['acc'], 'using' | 'delay' | 'delayCap' | 'usingIoNoVel' | 'delayIoNoVel' | 'srvUsing' | 'srvDelay' | 'srvDelayCap'>,
): number {
  const srvDelay = acc.srvDelay ?? 0;
  const delay = acc.delay - (acc.delayIoNoVel ?? 0) - srvDelay;
  const samples = acc.using - (acc.usingIoNoVel ?? 0) - (acc.srvUsing ?? 0) + delay;
  if (!(samples > 0)) return 0;
  const cap = acc.delayCap - srvDelayCapOf(acc);
  return Math.max(0, delay - cap) / samples;
}

/** Receiver value (WLM Services p.138: "a minimum performance index improvement … to reject very small
 * improvements"): the projected gain must close a share of the distance to the goal, and at least a floor. */
export const receiverValueNeeded = (basePi: number): number =>
  Math.max(POLICY_ADJUST.receiverValueFrac * (basePi - 1), POLICY_ADJUST.receiverValueMinPi);

/**
 * The worse of a period's management PIs, local and sysplex: what "missing its goal" is read from. APPROX: a period
 * with neither (no completions yet, e.g. a new response-time period) is not known to meet its goal, so it counts as
 * missing it (Infinity): it donates last at its importance, never when more important than the receiver, and a less
 * important receiver does not pass it. A period that structurally has no PI (only server regions in it) is not a goal
 * holder once server periods exist (WT-09, docs/wlm-design.md §5.8); until then it is judged by this rule too.
 */
export function managementWorstPi(localPi: number | null | undefined, sysplexPi: number | null | undefined): number {
  return localPi == null && sysplexPi == null ? Infinity : Math.max(localPi ?? 0, sysplexPi ?? 0);
}

export interface DonorInfo {
  importance: ScpGoalInfo['importance'];
  localPi: number | null;
  sysplexPi: number | null;
  /** Decayed processor use, as stored in ScpAcc (CPU includes IIPCP). */
  acc: Pick<ScpState['acc'], 'cpuEngines' | 'ziipEngines'>;
}

/**
 * Goal periods at or above the receiver using the delayed processor (WLM Services p.147; SG24-7621 p.105).
 * Happy periods give first, lowest PI first regardless of importance (SG24-6472-03, March 2008, p.59–60);
 * then reverse receiver order (WLM Services p.138). APPROX: happiness uses the worse of local/sysplex PI
 * (`managementWorstPi`), processor use is exponentially smoothed, and the small-consumer threshold and donor limit
 * are FICTIONAL. APPROX: the pool is periods, not holders (docs/wlm-design.md §5.5): CICS transaction periods that
 * share regions are separate donors until server periods (WT-09) make the regions' DP one holder's.
 * `info` contains goal periods only; discretionary work is fixed below the managed ladder.
 */
export function donorOrder(
  receiver: string,
  bottleneck: 'CPU' | 'ZIIP',
  dps: Readonly<Record<string, number>>,
  info: Readonly<Record<string, DonorInfo>>,
  tuning: Pick<typeof POLICY_ADJUST, 'accDecay' | 'donorMinEngines' | 'donorsPerReceiver'> = POLICY_ADJUST,
): string[] {
  const r = info[receiver];
  const rdp = dps[receiver];
  if (!r || rdp === undefined) return [];
  return Object.keys(info)
    .map((key) => {
      const g = info[key]!;
      const worst = managementWorstPi(g.localPi, g.sysplexPi);
      const used = bottleneck === 'CPU' ? g.acc.cpuEngines : (g.acc.ziipEngines ?? 0);
      return { key, importance: g.importance, worst, engines: used * (1 - tuning.accDecay) };
    })
    .filter((g) => g.key !== receiver && dps[g.key] !== undefined && dps[g.key]! >= rdp &&
      g.engines >= tuning.donorMinEngines && !(g.worst > 1 && g.importance < r.importance))
    .sort((a, b) => {
      const happyA = a.worst < 1;
      const happyB = b.worst < 1;
      return Number(happyB) - Number(happyA) || (!happyA ? b.importance - a.importance : 0) ||
        (a.worst === b.worst ? 0 : a.worst - b.worst) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    })
    .slice(0, tuning.donorsPerReceiver)
    .map((g) => g.key);
}

export function policyAdjust(input: AdjustInput): AdjustOutput {
  const { def, system } = input;
  const held: Record<string, number> = {};
  for (const s of system.scps) held[s.scKey] = s.dp;

  const info: Record<string, ScpGoalInfo> = {};
  for (const s of system.scps) {
    const g = goalInfo(def, s.scKey);
    if (g && g.goal.kind !== 'DISC') info[s.scKey] = g;
  }
  const infoKeys = Object.keys(info).sort();
  const ccImp = input.ccImp ?? 0;
  // Protection is restored first, so receivers are assessed (and trials judged) from DPs that keep it.
  // The ladder is made canonical here too, so every trial and the result are canonical (I9).
  const { dps, moves: protection } = enforceCpuProtection(held, info, ccImp);
  const ladder = ladderAt(dps, infoKeys);
  const protect = protection.length > 0 ? `${input.clockText} ${system.lparId} CPU PROTECTION ${protection.join(', ')}` : null;
  const localPi: Record<string, number | null> = {};
  for (const s of system.scps) {
    const g = info[s.scKey];
    localPi[s.scKey] = g ? goalPi(g.goal, s.acc) : null;
  }
  const tickOf: Record<string, ScpTick> = {};
  for (const t of input.current) tickOf[t.scKey] = t;
  // Receiver value and donor harm are judged on a percentile PI that is not clamped at 4.0, or a period far past
  // its goal could never show a projected gain and would never be helped.
  const instPi = (ticks: readonly ScpTick[]) => {
    const m: Record<string, number | null> = {};
    for (const t of ticks) {
      const g = info[t.scKey];
      m[t.scKey] = !g
        ? null
        : g.goal.kind === 'PCT'
          ? projectedPercentilePi(t.buckets, g.goal.pct, t.completions, t.rtSumSec, g.goal.rtSec, PCT_PROJECTION_SIGMA)
          : tickPi(g.goal, t);
    }
    return m;
  };

  // Projections run at sustained demand (projection.ts): running batch jobs are exact and never lifted.
  // The first evaluation shares prepared demand; later evaluations follow cross-pool batch recovery.
  let projectBase: LparEvalInput | null = null;
  const projectionBase = (): LparEvalInput => {
    if (projectBase) return projectBase;
    // Running batch slices carry `fixedDemand` on every image, with or without zIIPs.
    const P = projectionInput(input.evalInput, system.scps, POLICY_ADJUST);
    return (projectBase = {
      ...P,
      dpOf: (k) => dps[k] ?? 196,
      scpsOnly: true,
      bucketsFor: new Set(Object.keys(info).filter((k) => info[k]!.goal.kind === 'PCT')),
      prepared: P.prepared ?? prepareLpar(P),
    });
  };
  /** Did the projection bound this period's transaction backlog below what is queued? */
  const backlogCut = (k: string): boolean => {
    const bounded = projectionBase().backlog;
    for (const s of input.evalInput.slices) {
      if (s.scKey !== k || s.kind !== 'TXN') continue;
      const bl = input.evalInput.backlog[s.key] ?? 0;
      if (bl > 0 && (bounded[s.key] ?? 0) < bl) return true;
    }
    return false;
  };
  // `base`: every period's projected PI at the current DPs. One evaluation, made only when a candidate needs it.
  let baseCache: Record<string, number | null> | null = null;
  const basePis = (): Record<string, number | null> => (baseCache ??= instPi(evaluateLpar(projectionBase()).scps));
  const project = (trial: Record<string, number>, accepts: (after: Record<string, number | null>) => boolean) =>
    batchRecoveryAccepts({ ...projectionBase(), dpOf: (k) => trial[k] ?? dps[k] ?? 196 }, input.batch ?? [], (r) => accepts(instPi(r.scps)));

  // Long-term CPU protection: less important work never gets an equal or higher DP than a CPU-critical
  // class (MVS Planning: WLM, ch. 14; enqueue promotion is the documented exception, not modelled).
  // CCIMP extends it to first or only periods up to that importance (Init & Tuning p.428). APPROX: no
  // System Recovery Boost in the sim, so CCIMPBOOST never applies. A pair enforcement could not separate (protected
  // period at the managed floor) is only blamed on a trial that widens it.
  const violatesCpuCritical = (trial: Record<string, number>): string | null => {
    for (const [k, g] of Object.entries(info)) {
      if (!cpuProtected(g, ccImp)) continue;
      for (const [k2, g2] of Object.entries(info)) {
        if (g2.importance <= g.importance) continue;
        const gap = (trial[k2] ?? 0) - (trial[k] ?? 0);
        const heldGap = (dps[k2] ?? 0) - (dps[k] ?? 0);
        if (gap >= 0 && (heldGap < 0 || gap > heldGap)) return `${k2} (imp ${g2.importance}) ${hex(trial[k2] ?? 0)} ≥ ${k} (imp ${g.importance}) ${hex(trial[k] ?? 0)}`;
      }
    }
    return null;
  };

  /** Processor use of a period, engines: the larger of this tick and the smoothed accumulators (CP, IIPCP and zIIP). */
  const accOf: Record<string, ScpState> = {};
  for (const s of system.scps) accOf[s.scKey] = s;
  const donorInfo: Record<string, DonorInfo> = {};
  for (const k of infoKeys) donorInfo[k] = {
    importance: info[k]!.importance, localPi: localPi[k] ?? null, sysplexPi: input.sysplexPi[k] ?? null, acc: accOf[k]!.acc,
  };
  const usedEngines = (k: string): number => {
    const t = tickOf[k];
    const now = t ? t.cpEngines + t.iipcpEngines + t.ziipEngines : 0;
    const acc = accOf[k]?.acc;
    return Math.max(now, ((acc?.cpuEngines ?? 0) + (acc?.ziipEngines ?? 0)) * (1 - ACC_DECAY));
  };
  const tracing = traceSink !== null;
  const nowTick = input.nowTick ?? 0;
  // Projections left this interval (I16): a CPU-protection or missing-goal rejection costs none.
  let budget = POLICY_ADJUST.maxProjectionsPerInterval;
  // Clocks still running; an expired one is dropped (WLM Services p.148–149: a helped receiver can be helped again the next interval).
  const skipUntil: Record<string, number> = {};
  for (const s of system.scps) if (s.skipUntilTick !== undefined && s.skipUntilTick > nowTick) skipUntil[s.scKey] = s.skipUntilTick;
  let why: WlmTrialTrace | null = null;
  // Recorded even without the trace sink: the player-visible log names a rejected move and why.
  const reject = (verdict: WlmTrialVerdict, r: [number | null, number | null], detail?: string, blockedBy?: string) => {
    why = { move: '', verdict, receiverPi: r, ...(detail ? { detail } : {}), ...(blockedBy ? { blockedBy } : {}) };
    return false;
  };
  const assess = (receiver: string, trial: Record<string, number>): PlanAssessment | null => {
    why = null;
    const judged = (ok: boolean, projected: boolean, after?: Record<string, number | null>): PlanAssessment => ({
      ...(why ?? { verdict: 'NO_RECEIVER_GAIN' as const, receiverPi: [null, null] as [null, null] }),
      receiverPi: why?.receiverPi ?? [null, null], ok, projected, ...(after ? { after } : {}),
    });
    const before = basePis();
    const cc = violatesCpuCritical(trial);
    if (cc) {
      // No projection was judged; the receiver's `base` is still worth recording.
      why = { move: '', verdict: 'CPU_CRITICAL', receiverPi: [before[receiver] ?? null, null], detail: cc };
      return judged(false, false);
    }
    // A less important receiver never takes from more important work that is missing its goal (the 1994 patent:
    // both missing and the donor more important → no net value; Enrico, slide 52: "never … if donor is missing
    // goal"). The donors of a receiver-up move are the periods it passes or joins that use the processor, whatever
    // the projection says: a period already at the floor of the queueing model (saturated pool) shows no further
    // projected harm. A passed period that gets no CPU has nothing to lose and is left to the projection.
    // Passed or joined: above the receiver before and not after, or level with it before and below it after. Each
    // side compares DPs of one canonical ladder. A happy more important donor is eligible too, but must still pass
    // this rule and the projected harm check below.
    const rImp0 = info[receiver]!.importance;
    const r0dp = dps[receiver]!;
    const r1dp = trial[receiver] ?? r0dp;
    for (const k of infoKeys) {
      const g = info[k]!;
      if (k === receiver || g.importance >= rImp0) continue;
      const k0 = dps[k]!;
      const k1 = trial[k] ?? k0;
      if (!((k0 > r0dp && k1 <= r1dp) || (k0 === r0dp && k1 < r1dp))) continue;
      // "Missing its goal" is a fact about the period, so it is read from the management PI (local or sysplex; none
      // counts as missing, as in the donor order) as well as from the projection at the current DPs.
      const mWorst = managementWorstPi(localPi[k], input.sysplexPi[k]);
      const worst = Math.max(before[k] ?? 0, mWorst);
      if (worst <= 1) continue;
      if (usedEngines(k) < POLICY_ADJUST.donorMinEngines) continue;
      const piText = mWorst === Infinity ? 'has no PI' : `PI ${worst.toFixed(2)} is missing its goal`;
      reject('MORE_IMPORTANT_HARMED', [before[receiver] ?? null, null], `${k} (imp ${g.importance}) ${piText} and would be passed`, k);
      return judged(false, false);
    }
    // The pair is only recorded once the whole projection accepts: `project` can still refuse after every accept
    // callback said yes (a batch recovery that never settles runs out of rounds), and a trace must not call that move
    // accepted.
    let acceptedPi: [number | null, number | null] | null = null;
    if (budget <= 0) return null;
    budget--;
    let finalAfter: Record<string, number | null> | undefined;
    const ok = project(trial, (after) => {
      const r0 = before[receiver];
      const r1 = after[receiver];
      finalAfter = after;
      if (r0 == null || r1 == null || r1 > r0) return reject('NO_RECEIVER_GAIN', [r0 ?? null, r1 ?? null]);
      const rImp = info[receiver]!.importance;
      const floor = POLICY_ADJUST.creditFloor;
      const gain = Math.max(0, r0 - Math.max(r1, floor));
      let equalHarm = 0;
      let largestEqualHarm = 0;
      let equalBlocker: string | undefined;
      // Key order, so the period a rejection names (and the harm sum) never depends on the order of `scps`.
      for (const k of infoKeys) {
        const g = info[k]!;
        if (k === receiver) continue;
        const p0 = before[k];
        const p1 = after[k];
        if (p0 == null || p1 == null) continue;
        const harm = Math.max(0, p1 - Math.max(p0, floor));
        // More important work that meets its goal must still meet it after the move, however small the harm
        // (SG24-6472-03 p.60: a more important donor gives only while it keeps its goal); the noise tolerance only
        // spares work already missing it.
        const crosses = g.importance < rImp && p0 <= 1 && p1 > 1;
        if (!crosses && harm <= POLICY_ADJUST.harmEps) continue;
        if (g.importance < rImp && p1 > 1) return reject('MORE_IMPORTANT_HARMED', [r0, r1], `${k} (imp ${g.importance}) PI ${p0.toFixed(2)}→${p1.toFixed(2)}`, k);
        if (g.importance === rImp) {
          // Equal importance: the move must also bring the two PIs closer together (SG24-6472 p.60; Enrico,
          // How WLM Works, slide 52: "less disparity in projected PIs"), or the pair trade places forever.
          if (Math.abs(r1 - p1) >= Math.abs(r0 - p0)) return reject('EQUAL_DISPARITY', [r0, r1], `${k} PI ${p0.toFixed(2)}→${p1.toFixed(2)}`, k);
          equalHarm += harm;
          // infoKeys is sorted, so equal harms retain the first key deterministically.
          if (harm > largestEqualHarm) { largestEqualHarm = harm; equalBlocker = k; }
        }
      }
      // APPROX: equal-importance harm is also summed over periods (IBM tests net value per donor).
      if (equalHarm > 0 && gain <= equalHarm) return reject('NO_NET_VALUE', [r0, r1], `gain ${gain.toFixed(2)} ≤ equal-importance harm ${equalHarm.toFixed(2)}`, equalBlocker);
      acceptedPi = [r0, r1];
      return true;
    });
    // An accepted trial records the receiver's PI pair like a rejected one, so a trace can show what the move bought.
    if (ok) why = { move: '', verdict: 'RETAINED', receiverPi: acceptedPi ?? [null, null] };
    return judged(ok, true, finalAfter);
  };

  const ordered = (piOf: Record<string, number | null>) =>
    Object.keys(info)
      .filter((k) => (piOf[k] ?? 0) > 1 && tickOf[k])
      .sort((a, b) => info[a]!.importance - info[b]!.importance || (piOf[b] ?? 0) - (piOf[a] ?? 0) || (a < b ? -1 : 1));

  const tried = new Set<string>();
  const global = ordered(input.sysplexPi as Record<string, number | null>);
  const local = ordered(localPi);
  const candidates = [1, 2, 3, 4, 5].flatMap((importance) => [
    ...global.filter((k) => info[k]!.importance === importance),
    ...local.filter((k) => info[k]!.importance === importance),
  ]).filter((k) => {
    if (tried.has(k)) return false;
    tried.add(k);
    return true;
  });
  // A search the budget stopped resumes at the receiver it stopped on, then wraps to the top, so receivers behind a
  // run of hopeless ones are reached in turn (I12). APPROX: real WLM assesses every receiver each interval.
  const resumeKey = system.scps.find((s) => s.resumeSearch)?.scKey ?? null;
  const start = resumeKey === null ? -1 : candidates.indexOf(resumeKey);
  if (start > 0) candidates.push(...candidates.splice(0, start));
  const resumedAt = start >= 0 ? resumeKey : null;

  const notes: string[] = [];
  const clockNotes: string[] = [];
  const traced: WlmCandidateTrace[] = [];
  const traceOf = (
    k: string,
    bottleneck: Bottleneck | null,
    outcome: WlmCandidateTrace['outcome'],
    delayShares: WlmDelayShares,
  ): WlmCandidateTrace => {
    const c: WlmCandidateTrace = { scKey: k, importance: info[k]!.importance, sysplexPi: input.sysplexPi[k] ?? null, localPi: localPi[k] ?? null, dp: dps[k]!, bottleneck, delayShares, outcome, trials: [] };
    traced.push(c);
    return c;
  };
  /** The period's delay accounting with I/O priority management off applied: what the bottleneck is chosen from. */
  const delaysOf = (k: string) => {
    const acc = system.scps.find((s) => s.scKey === k)!.acc;
    return { ...acc, delayIo: acc.delayIo - (acc.delayIoNoVel ?? 0) };
  };
  const sharesOf = (k: string): WlmDelayShares => {
    const d = delaysOf(k);
    const denom = d.using + d.delay;
    const share = (v: number) => (denom > 0 ? v / denom : 0);
    return { CPU: share(d.delayCpu), ZIIP: share(d.delayZiip), IO: share(d.delayIo), CAP: share(d.delayCap), OTHER: share(d.delayOther) };
  };
  const finish = (out: Omit<AdjustOutput, 'skipUntil' | 'resumeAt' | 'clockNotes'>, resumeAt: string | null): AdjustOutput => {
    if (traceSink) traceSink({ clockText: input.clockText, lparId: system.lparId, dps: { ...dps }, candidates: traced, action: out.log?.includes('RCVR=') ? out.log : null, protection });
    return { ...out, skipUntil, resumeAt, clockNotes };
  };
  let stoppedAt: string | null = null;
  for (const receiver of candidates) {
    // The skip clock (WLM Services p.145): a receiver nothing could help is not assessed again until it expires.
    if (skipUntil[receiver] !== undefined) {
      if (tracing) traceOf(receiver, null, 'SKIP_CLOCK', sharesOf(receiver)).skipUntilTick = skipUntil[receiver];
      continue;
    }
    // A period with no managed delay is not assessed: no priority change can help it (WLM Services p.144).
    const mdf = managedDelayFrac(accOf[receiver]!.acc);
    if (mdf < POLICY_ADJUST.needsHelpDelayFrac) {
      if (tracing) traceOf(receiver, null, 'NO_MANAGED_DELAY', sharesOf(receiver)).managedDelayFrac = mdf;
      continue;
    }
    // With I/O priority management off, I/O samples are outside velocity and WLM doesn't manage I/O (WLM Planning p.115).
    const btl = bottleneckOf(delaysOf(receiver));
    const pi = (input.sysplexPi[receiver] ?? localPi[receiver] ?? 0).toFixed(2);
    if (btl !== 'CPU' && btl !== 'ZIIP') {
      notes.push(`${receiver} PI=${pi} BTLNK=${btl} not WLM-fixable`);
      if (tracing) traceOf(receiver, btl, 'NOT_FIXABLE', sharesOf(receiver));
      continue;
    }
    // One basis: a receiver whose projected PI at sustained demand is already at or under 1 is recovering by
    // itself (its management PI is still catching up). No trials, and no use of the projection budget.
    const b0 = basePis()[receiver];
    if (b0 == null || b0 <= 1) {
      notes.push(`${receiver} PI=${pi} BTLNK=${btl} already recovering`);
      if (tracing) traceOf(receiver, btl, 'RECOVERING', sharesOf(receiver)).basePi = b0 ?? null;
      continue;
    }
    // The projection budget is per interval: when it is spent the search stops, with no skip clock, and the next
    // interval's search starts at this receiver.
    if (budget <= 0) {
      if (tracing) traceOf(receiver, btl, 'BUDGET', sharesOf(receiver)).basePi = b0;
      stoppedAt = receiver;
      break;
    }
    const ct = tracing ? traceOf(receiver, btl, 'ASSESSED', sharesOf(receiver)) : null;
    if (ct) {
      ct.basePi = b0;
      ct.managedDelayFrac = mdf;
    }
    // A receiver whose backlog the projection bounded, and that is measured far worse than projected (a runaway), is
    // not raised: the projection cannot show what draining that backlog does to others. Only where the bound cut
    // something: elsewhere a gap between the PIs is no reason to distrust the projection. APPROX: real WLM's demand
    // data does not hide a backlog (WLM Services p.144: maximum demand is use with no processor delay); this guards
    // the sim's bound (docs/wlm-design.md §9.5). A percentile PI stops at 4.0, so a percentile receiver never trips it.
    const mPi = Math.max(localPi[receiver] ?? 0, input.sysplexPi[receiver] ?? 0);
    const distrust = mPi > POLICY_ADJUST.projectionTrustMax * b0 && backlogCut(receiver);
    /** The clue the log gives when no move paid off: the first rejection that names what stood in the way (harm,
     * CPU protection, the projection), else the first. Small steps come first on the ladder and often only gain
     * nothing, which says less than the harm a larger step would do. */
    let firstReject: { move: string; why: WlmTrialTrace } | null = null;
    let firstNamed: { move: string; why: WlmTrialTrace } | null = null;
    const donors = donorOrder(receiver, btl, dps, donorInfo);
    if (ct) ct.donors = [...donors];
    const hadWholeBudget = budget === POLICY_ADJUST.maxProjectionsPerInterval;
    const describe = formatPlanMoves;
    const plan = buildPlan({
      receiver, ladder, donors, maxSteps: POLICY_ADJUST.maxPlanSteps, basePi: b0,
      importanceOf: (k) => info[k]!.importance,
      receiverValue: (after) => b0 - after >= receiverValueNeeded(b0),
      assess: (L, kind) => {
        if (kind === 'UP' && distrust) {
          reject('PROJECTION_DISAGREES', [b0, null], `projected PI ${b0.toFixed(2)} vs measured ${mPi.toFixed(2)}`);
          return { ...why!, receiverPi: [b0, null], ok: false, projected: false };
        }
        return assess(receiver, withLadder(dps, L));
      },
    });
    if (ct) ct.planOutcome = plan.outcome;
    for (const attempt of plan.attempts) {
      const w: WlmTrialTrace = { move: describe(attempt.moves), verdict: attempt.verdict,
        receiverPi: attempt.receiverPi, projected: attempt.projected, steps: attempt.moves,
        ...(attempt.detail ? { detail: attempt.detail } : {}),
        ...(attempt.blockedBy ? { blockedBy: attempt.blockedBy } : {}),
        ...(attempt.verdict === 'ACCEPTED' ? { plan: plan.moves, afterPis: attempt.after, afterDps: withLadder(dps, plan.ladder) } : {}),
      };
      if (ct) ct.trials.push(w);
      if (w.verdict === 'RETAINED' || w.verdict === 'ACCEPTED') continue;
      if (!firstReject) firstReject = { move: w.move, why: w };
      if (!firstNamed && (w.blockedBy || w.verdict === 'CPU_CRITICAL' || w.verdict === 'PROJECTION_DISAGREES')) firstNamed = { move: w.move, why: w };
    }
    if (plan.outcome === 'ACCEPTED') return finish({
      dps: withLadder(dps, plan.ladder),
      log: `${input.clockText} ${system.lparId} RCVR=${receiver} PI=${pi} BTLNK=${btl} ${describe(plan.moves)}`,
      protect,
    }, resumedAt);
    const outOfBudget = plan.outcome === 'BUDGET';
    // No move taken: say what this receiver's first move would have done, so the log answers "why not?".
    const retained = plan.attempts.filter((a) => a.ok).at(-1);
    const clue = firstNamed ?? firstReject ?? (retained ? {
      move: describe(retained.moves),
      why: { move: '', verdict: 'SMALL_GAIN' as const, receiverPi: retained.receiverPi,
        detail: `complete plan needs ≥ ${receiverValueNeeded(b0).toFixed(2)}` },
    } : null);
    const whyNot = clue ? ` (${clue.move} rejected: ${playerReason(clue.why)})` : '';
    if (outOfBudget && !hadWholeBudget) {
      notes.push(`${receiver} PI=${pi} BTLNK=${btl} no action with net value${whyNot}`);
      stoppedAt = receiver;
      break;
    }
    // Every trial was rejected: skip it until the clock expires. APPROX: one fixed length (`rejectedSkipTicks`).
    const until = nowTick + POLICY_ADJUST.rejectedSkipTicks;
    skipUntil[receiver] = until;
    if (ct) ct.skipUntilTick = until;
    const note = `${receiver} PI=${pi} BTLNK=${btl} no action with net value${whyNot}, next look ${formatClock(until).split(' ')[1]}`;
    notes.push(note);
    clockNotes.push(`${input.clockText} ${system.lparId} ${note}`);
    if (outOfBudget) {
      stoppedAt = receiver;
      break;
    }
  }
  return finish({
    dps,
    log: notes.length > 0 ? `${input.clockText} ${system.lparId} ${notes[0]}` : null,
    protect,
  }, stoppedAt);
}

/** The WLM log's wording for a rejected trial: short, and in the player's terms rather than the trace's. */
function playerReason(w: WlmTrialTrace): string {
  const name = w.detail?.split(' ')[0];
  switch (w.verdict) {
    case 'NO_RECEIVER_GAIN': return 'no gain for the receiver';
    case 'SMALL_GAIN': return 'gain too small';
    case 'MORE_IMPORTANT_HARMED': return `harms ${name ?? 'more important work'}, more important`;
    case 'EQUAL_DISPARITY': return `harms ${name ?? 'equal-importance work'}, equal importance`;
    case 'NO_NET_VALUE': return w.blockedBy ? `harms ${w.blockedBy}, equal importance (no net gain)` : 'equal-importance harm outweighs the gain';
    case 'CPU_CRITICAL': return 'would breach CPU protection';
    case 'PROJECTION_DISAGREES': return 'its backlog would take the processor from other work while it catches up';
    default: return 'no net value';
  }
}

const hex = (n: number) => n.toString(16).toUpperCase();
