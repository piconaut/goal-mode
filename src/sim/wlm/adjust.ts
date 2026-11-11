// WLM policy adjustment (SG24-7621 §3.12–3.15), run every 10 s per system:
// pick the most important, worst-PI receiver; find its bottleneck; try DP moves
// (receiver up, donors down); accept the first move with receiver value and net value.
// At most one receiver is helped per interval.
// Two PIs, each with one job (docs/wlm-design.md §5.2): receivers are chosen on the management PI (the smoothed
// accumulators); every trial is judged on projected PIs, `base` at the current DPs against `after` at the trial's,
// both from the dispatcher model at sustained demand (projection.ts).

import { PCT_PROJECTION_SIGMA, POLICY_ADJUST, RECEIVERS_PER_IMPORTANCE as DEFAULT_RECEIVERS_PER_IMPORTANCE } from '../../content/wlm/tuning';
import { DP } from '../zos/dispatcher';
import { evaluateLpar, prepareLpar, type LparEvalInput, type ScpTick } from './evaluate';
import { projectionInput } from './projection';
import { batchRecoveryAccepts, type BatchProjectionSlice } from './batchProjection';
import { projectedPercentilePi } from './goals';
import { ACC_DECAY, goalPi, goalInfo, tickPi, type ScpGoalInfo, type ScpState, type WlmSystemState } from './runtime';
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
  /** How many fixable receivers the search assesses at one importance before going on (WLM content tunable). */
  receiversPerImportance?: number;
  /** Measured demand and next-tick demand already enabled by execution's grants. */
  batch?: readonly BatchProjectionSlice[];
}

export interface AdjustOutput {
  dps: Record<string, number>;
  log: string | null;
  /** DPs lowered to restore long-term CPU protection before any receiver was assessed. */
  protect: string | null;
}

/** Why a trial DP move was accepted or rejected (investigation trace only). */
export type WlmTrialVerdict =
  | 'ACCEPTED'
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
  /** NOT_FIXABLE: bottleneck isn't CPU/zIIP; BUDGET: receiversPerImportance receivers were already assessed at this importance;
   * RECOVERING: its projected PI at sustained demand and the current DPs is already ≤ 1 (or unknown): no trials;
   * ASSESSED: trials below. */
  outcome: 'NOT_FIXABLE' | 'BUDGET' | 'RECOVERING' | 'ASSESSED';
  /** Projected PI at the current DPs (the basis every trial is judged against); absent when not computed. */
  basePi?: number | null;
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

/**
 * Restore long-term CPU protection: every period less important than a protected period goes below its DP. WLM
 * enforces the protection rather than refusing to manage (WLM Planning p.120: "less important work will generally
 * have a lower dispatch priority"). A policy activation can break it (CPU Critical newly set while batch holds a DP
 * it earned under the old policy); DPs carry over by period. APPROX: the less important period is lowered rather than
 * the protected one raised, so the protection costs only the work it is meant to cost. Importance order makes one
 * pass enough: a protected period's DP is final before any less important period is checked against it.
 */
export function enforceCpuProtection(
  dps: Readonly<Record<string, number>>,
  info: Readonly<Record<string, Pick<ScpGoalInfo, 'cpuCritical' | 'period' | 'importance'>>>,
  ccImp: number,
): { dps: Record<string, number>; moves: string[] } {
  const out = { ...dps };
  const moves: string[] = [];
  const keys = Object.keys(info).filter((k) => out[k] !== undefined).sort();
  for (let imp = 2; imp <= 5; imp++) {
    let ceiling = Infinity;
    for (const k of keys) if (info[k]!.importance < imp && cpuProtected(info[k]!, ccImp)) ceiling = Math.min(ceiling, out[k]! - 1);
    if (ceiling === Infinity) continue;
    const to = Math.max(DP.MANAGED_MIN, ceiling);
    for (const k of keys) {
      if (info[k]!.importance !== imp || out[k]! <= ceiling || out[k]! <= to) continue;
      moves.push(`${k} DP ${hex(out[k]!)}→${hex(to)}`);
      out[k] = to;
    }
  }
  return { dps: out, moves };
}

/** Receiver value (WLM Services p.138: "a minimum performance index improvement … to reject very small
 * improvements"): the projected gain must close a share of the distance to the goal, and at least a floor. */
export const receiverValueNeeded = (basePi: number): number =>
  Math.max(POLICY_ADJUST.receiverValueFrac * (basePi - 1), POLICY_ADJUST.receiverValueMinPi);

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
  const { dps, moves: protection } = enforceCpuProtection(held, info, ccImp);
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
  const usedEngines = (k: string): number => {
    const t = tickOf[k];
    const now = t ? t.cpEngines + t.iipcpEngines + t.ziipEngines : 0;
    const acc = accOf[k]?.acc;
    return Math.max(now, ((acc?.cpuEngines ?? 0) + (acc?.ziipEngines ?? 0)) * (1 - ACC_DECAY));
  };
  const tracing = traceSink !== null;
  let why: WlmTrialTrace | null = null;
  // Recorded even without the trace sink: the player-visible log names a rejected move and why.
  const reject = (verdict: WlmTrialVerdict, r: [number | null, number | null], detail?: string) => {
    why = { move: '', verdict, receiverPi: r, ...(detail ? { detail } : {}) };
    return false;
  };
  const passes = (receiver: string, trial: Record<string, number>): boolean => {
    const before = basePis();
    const cc = violatesCpuCritical(trial);
    if (cc) {
      // No projection was judged; the receiver's `base` is still worth recording.
      why = { move: '', verdict: 'CPU_CRITICAL', receiverPi: [before[receiver] ?? null, null], detail: cc };
      return false;
    }
    // A less important receiver never takes from more important work that is missing its goal (the 1994 patent:
    // both missing and the donor more important → no net value; Enrico, slide 52: "never … if donor is missing
    // goal"). The donors of a receiver-up move are the periods it passes or joins that use the processor, whatever
    // the projection says: a period already at the floor of the queueing model (saturated pool) shows no further
    // projected harm. A passed period that gets no CPU has nothing to lose and is left to the projection.
    const rImp0 = info[receiver]!.importance;
    const r0dp = dps[receiver]!;
    const r1dp = trial[receiver] ?? r0dp;
    if (r1dp > r0dp) {
      for (const k of infoKeys) {
        const g = info[k]!;
        const p0 = before[k];
        if (k === receiver || g.importance >= rImp0) continue;
        // "Missing its goal" is a fact about the period, so it is read from the management PI (local or sysplex)
        // as well as from the projection at the current DPs.
        const worst = Math.max(p0 ?? 0, localPi[k] ?? 0, input.sysplexPi[k] ?? 0);
        if (worst <= 1) continue;
        const kdp = trial[k] ?? dps[k]!;
        if (usedEngines(k) < POLICY_ADJUST.donorMinEngines) continue;
        if (kdp >= r0dp && kdp <= r1dp) return reject('MORE_IMPORTANT_HARMED', [before[receiver] ?? null, null], `${k} (imp ${g.importance}) PI ${worst.toFixed(2)} is missing its goal and would be passed`);
      }
    }
    // The pair is only recorded once the whole projection accepts: `project` can still refuse after every accept
    // callback said yes (a batch recovery that never settles runs out of rounds), and a trace must not call that move
    // accepted.
    let acceptedPi: [number | null, number | null] | null = null;
    const ok = project(trial, (after) => {
      const r0 = before[receiver];
      const r1 = after[receiver];
      if (r0 == null || r1 == null || r1 >= r0) return reject('NO_RECEIVER_GAIN', [r0 ?? null, r1 ?? null]);
      const needed = receiverValueNeeded(r0);
      if (r0 - r1 < needed) return reject('SMALL_GAIN', [r0, r1], `needs ≥ ${needed.toFixed(2)}`);
      const rImp = info[receiver]!.importance;
      const floor = POLICY_ADJUST.creditFloor;
      const gain = Math.max(0, r0 - Math.max(r1, floor));
      let equalHarm = 0;
      // Key order, so the period a rejection names (and the harm sum) never depends on the order of `scps`.
      for (const k of infoKeys) {
        const g = info[k]!;
        if (k === receiver) continue;
        const p0 = before[k];
        const p1 = after[k];
        if (p0 == null || p1 == null) continue;
        const harm = Math.max(0, p1 - Math.max(p0, floor));
        if (harm <= POLICY_ADJUST.harmEps) continue;
        if (g.importance < rImp && p1 > 1) return reject('MORE_IMPORTANT_HARMED', [r0, r1], `${k} (imp ${g.importance}) PI ${p0.toFixed(2)}→${p1.toFixed(2)}`);
        if (g.importance === rImp) {
          // Equal importance: the move must also bring the two PIs closer together (SG24-6472 p.60; Enrico,
          // How WLM Works, slide 52: "less disparity in projected PIs"), or the pair trade places forever.
          if (Math.abs(r1 - p1) >= Math.abs(r0 - p0)) return reject('EQUAL_DISPARITY', [r0, r1], `${k} PI ${p0.toFixed(2)}→${p1.toFixed(2)}`);
          equalHarm += harm;
        }
      }
      // APPROX: equal-importance harm is also summed over periods (IBM tests net value per donor).
      if (equalHarm > 0 && gain <= equalHarm) return reject('NO_NET_VALUE', [r0, r1], `gain ${gain.toFixed(2)} ≤ equal-importance harm ${equalHarm.toFixed(2)}`);
      acceptedPi = [r0, r1];
      return true;
    });
    // An accepted trial records the receiver's PI pair like a rejected one, so a trace can show what the move bought.
    if (ok) why = { move: '', verdict: 'ACCEPTED', receiverPi: acceptedPi ?? [null, null] };
    return ok;
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

  const notes: string[] = [];
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
  const finish = (out: AdjustOutput): AdjustOutput => {
    if (traceSink) traceSink({ clockText: input.clockText, lparId: system.lparId, dps: { ...dps }, candidates: traced, action: out.log?.includes('RCVR=') ? out.log : null, protection });
    return out;
  };
  const receiversPerImportance = Math.max(1, input.receiversPerImportance ?? DEFAULT_RECEIVERS_PER_IMPORTANCE);
  let projected = 0;
  let projectedImp = -1;
  for (const receiver of candidates) {
    const impOf = info[receiver]!.importance;
    // Projection is the expensive part: assess at most receiversPerImportance fixable receivers per importance, then move on.
    if (impOf !== projectedImp) {
      projectedImp = impOf;
      projected = 0;
    }
    if (projected >= receiversPerImportance) {
      // Skip, don't stop: lower importances still get their own budget, traced or not.
      if (tracing) traceOf(receiver, null, 'BUDGET', sharesOf(receiver));
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
    const ct = tracing ? traceOf(receiver, btl, 'ASSESSED', sharesOf(receiver)) : null;
    if (ct) ct.basePi = b0;
    // A receiver measured far worse than projected (a runaway whose backlog the projection bounds) is not raised:
    // the projection cannot show what draining that backlog does to others. APPROX: real WLM's demand data does
    // not hide a backlog; this guards the sim's bound (docs/wlm-design.md §9.5).
    const mPi = Math.max(localPi[receiver] ?? 0, input.sysplexPi[receiver] ?? 0);
    const distrust = mPi > POLICY_ADJUST.projectionTrustMax * b0;
    /** The first move tried against this receiver: the clue the log gives when none of them paid off. */
    let firstReject: { move: string; why: WlmTrialTrace } | null = null;
    projected++;
    const rdp = dps[receiver]!;
    const rImp = impOf;
    const trials: { trial: Record<string, number>; text: string }[] = [];

    const levelsAbove = [...new Set(Object.keys(info).map((k) => dps[k]!))]
      .filter((d) => d > rdp)
      .sort((a, b) => a - b)
      .slice(0, 3);
    for (const lvl of levelsAbove) {
      const nd = Math.min(DP.MANAGED_MAX, lvl + 1);
      trials.push({ trial: { ...dps, [receiver]: nd }, text: `${receiver} DP ${hex(rdp)}→${hex(nd)}` });
    }
    if (levelsAbove.length === 0 && rdp < DP.MANAGED_MAX) {
      trials.push({ trial: { ...dps, [receiver]: rdp + 1 }, text: `${receiver} DP ${hex(rdp)}→${hex(rdp + 1)}` });
    }
    // Donors: heavy CPU users at or above the receiver's DP that are less important, or
    // equally important and happy. Least important first (reverse receiver order).
    const donors = Object.keys(info)
      .filter(
        (k) =>
          k !== receiver &&
          dps[k]! >= rdp &&
          (info[k]!.importance > rImp || (info[k]!.importance === rImp && (localPi[k] ?? 0) < 1)) &&
          (tickOf[k]?.cpEngines ?? 0) + (tickOf[k]?.iipcpEngines ?? 0) > 1e-4,
      )
      .sort(
        (a, b) =>
          info[b]!.importance - info[a]!.importance ||
          (tickOf[b]?.cpEngines ?? 0) - (tickOf[a]?.cpEngines ?? 0) ||
          (a < b ? -1 : 1),
      )
      .slice(0, 3);
    if (ct) ct.donors = [...donors];
    for (const d of donors) {
      const nd = Math.max(DP.MANAGED_MIN, rdp - 1);
      trials.push({ trial: { ...dps, [d]: nd }, text: `DONOR ${d} DP ${hex(dps[d]!)}→${hex(nd)}` });
    }

    for (const tr of trials) {
      why = null;
      const up = !tr.text.startsWith('DONOR ');
      const ok = up && distrust
        ? reject('PROJECTION_DISAGREES', [b0, null], `projected PI ${b0.toFixed(2)} vs measured ${mPi.toFixed(2)}`)
        : passes(receiver, tr.trial);
      if (ct) ct.trials.push({ ...(why ?? { verdict: 'NO_RECEIVER_GAIN' as const }), move: tr.text });
      if (ok) {
        return finish({
          dps: tr.trial,
          log: `${input.clockText} ${system.lparId} RCVR=${receiver} PI=${pi} BTLNK=${btl} ${tr.text}`,
          protect,
        });
      }
      if (!firstReject && why) firstReject = { move: tr.text, why };
    }
    // No move taken: say what this receiver's first move would have done, so the log answers "why not?".
    const whyNot = firstReject ? ` (${firstReject.move} rejected: ${playerReason(firstReject.why)})` : '';
    notes.push(`${receiver} PI=${pi} BTLNK=${btl} no action with net value${whyNot}`);
  }
  return finish({
    dps,
    log: notes.length > 0 ? `${input.clockText} ${system.lparId} ${notes[0]}` : null,
    protect,
  });
}

/** The WLM log's wording for a rejected trial: short, and in the player's terms rather than the trace's. */
function playerReason(w: WlmTrialTrace): string {
  const name = w.detail?.split(' ')[0];
  switch (w.verdict) {
    case 'NO_RECEIVER_GAIN': return 'no gain for the receiver';
    case 'SMALL_GAIN': return 'gain too small';
    case 'MORE_IMPORTANT_HARMED': return `harms ${name ?? 'more important work'}, more important`;
    case 'EQUAL_DISPARITY': return `harms ${name ?? 'equal-importance work'}, equal importance`;
    case 'NO_NET_VALUE': return 'equal-importance harm outweighs the gain';
    case 'CPU_CRITICAL': return 'would breach CPU protection';
    case 'PROJECTION_DISAGREES': return 'too far behind to project the effect on other work';
    default: return 'no net value';
  }
}

const hex = (n: number) => n.toString(16).toUpperCase();
