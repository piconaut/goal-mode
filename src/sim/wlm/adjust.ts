// WLM policy adjustment (SG24-7621 §3.12–3.15), run every 10 s per system:
// pick the most important, worst-PI receiver; find its bottleneck; try DP moves
// (receiver up, donors down); accept the first move with receiver value and net value.
// At most one receiver is helped per interval.

import { PCT_PROJECTION_SIGMA } from '../../content/wlm/tuning';
import { DP } from '../zos/dispatcher';
import { prepareLpar, type LparEvalInput, type ScpTick } from './evaluate';
import { batchRecoveryAccepts, type BatchProjectionSlice } from './batchProjection';
import { projectedPercentilePi } from './goals';
import { goalPi, goalInfo, tickPi, type ScpGoalInfo, type WlmSystemState } from './runtime';
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
  | 'NO_NET_VALUE'; // equal-importance harm outweighs the receiver's gain

export interface WlmTrialTrace {
  move: string;
  verdict: WlmTrialVerdict;
  /** Receiver PI before → projected after (unclamped, as judged). */
  receiverPi?: [number | null, number | null];
  detail?: string;
}

export interface WlmCandidateTrace {
  scKey: string;
  importance: number;
  sysplexPi: number | null;
  localPi: number | null;
  dp: number;
  bottleneck: Bottleneck | null;
  /** NOT_FIXABLE: bottleneck isn't CPU/zIIP; BUDGET: two receivers were already assessed at this importance;
   * ASSESSED: trials below. */
  outcome: 'NOT_FIXABLE' | 'BUDGET' | 'ASSESSED';
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

const RECEIVER_VALUE_FRAC = 0.1;
const DONOR_CREDIT_FLOOR = 0.9;
/** Projections are the expensive part, so the search assesses at most this many fixable receivers per importance
 * level, then goes on at the next importance (SG24-7621 p.105–106: the search moves down the importances when no
 * receiver can be selected). A receiver whose trials find no move of net value does not keep lower importances out. */
const RECEIVERS_PER_IMPORTANCE = 2;

export function policyAdjust(input: AdjustInput): AdjustOutput {
  const { def, system } = input;
  const held: Record<string, number> = {};
  for (const s of system.scps) held[s.scKey] = s.dp;

  const info: Record<string, ScpGoalInfo> = {};
  for (const s of system.scps) {
    const g = goalInfo(def, s.scKey);
    if (g && g.goal.kind !== 'DISC') info[s.scKey] = g;
  }
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
  const before = instPi(input.current);

  // The first evaluation shares prepared demand; later evaluations follow cross-pool batch recovery.
  let projectBase: LparEvalInput | null = null;
  const project = (trial: Record<string, number>, accepts: (after: Record<string, number | null>) => boolean) => {
    projectBase ??= {
      ...input.evalInput,
      dpOf: (k) => dps[k] ?? 196,
      scpsOnly: true,
      bucketsFor: new Set(Object.keys(info).filter((k) => info[k]!.goal.kind === 'PCT')),
      prepared: prepareLpar(input.evalInput),
    };
    return batchRecoveryAccepts({ ...projectBase, dpOf: (k) => trial[k] ?? dps[k] ?? 196 }, input.batch ?? [], (r) => accepts(instPi(r.scps)));
  };

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

  const tracing = traceSink !== null;
  let why: WlmTrialTrace | null = null;
  // Recorded even without the trace sink: the player-visible log names a rejected move and why.
  const reject = (verdict: WlmTrialVerdict, r: [number | null, number | null], detail?: string) => {
    why = { move: '', verdict, receiverPi: r, ...(detail ? { detail } : {}) };
    return false;
  };
  const passes = (receiver: string, trial: Record<string, number>): boolean => {
    const cc = violatesCpuCritical(trial);
    if (cc) {
      why = { move: '', verdict: 'CPU_CRITICAL', detail: cc };
      return false;
    }
    return project(trial, (after) => {
      const r0 = before[receiver];
      const r1 = after[receiver];
      if (r0 == null || r1 == null || r1 >= r0) return reject('NO_RECEIVER_GAIN', [r0 ?? null, r1 ?? null]);
      if (r0 - r1 < RECEIVER_VALUE_FRAC * (r0 - 1)) return reject('SMALL_GAIN', [r0, r1], `needs ≥ ${(RECEIVER_VALUE_FRAC * (r0 - 1)).toFixed(2)}`);
      const rImp = info[receiver]!.importance;
      const gain = Math.max(0, r0 - Math.max(r1, DONOR_CREDIT_FLOOR));
      let equalHarm = 0;
      for (const [k, g] of Object.entries(info)) {
        if (k === receiver) continue;
        const p0 = before[k];
        const p1 = after[k];
        if (p0 == null || p1 == null) continue;
        const harm = Math.max(0, p1 - Math.max(p0, DONOR_CREDIT_FLOOR));
        if (g.importance < rImp && p1 > 1 && harm > 0.02) return reject('MORE_IMPORTANT_HARMED', [r0, r1], `${k} (imp ${g.importance}) PI ${p0.toFixed(2)}→${p1.toFixed(2)}`);
        if (g.importance === rImp) {
          // Equal importance: the move must also bring the two PIs closer together (SG24-6472 p.60; Enrico,
          // How WLM Works, slide 52: "less disparity in projected PIs"), or the pair trade places forever.
          if (harm > 0 && Math.abs(r1 - p1) >= Math.abs(r0 - p0)) return reject('EQUAL_DISPARITY', [r0, r1], `${k} PI ${p0.toFixed(2)}→${p1.toFixed(2)}`);
          equalHarm += harm;
        }
      }
      if (gain > equalHarm) return true;
      return reject('NO_NET_VALUE', [r0, r1], `gain ${gain.toFixed(2)} ≤ equal-importance harm ${equalHarm.toFixed(2)}`);
    });
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
  const traceOf = (k: string, bottleneck: Bottleneck | null, outcome: WlmCandidateTrace['outcome']): WlmCandidateTrace => {
    const c = { scKey: k, importance: info[k]!.importance, sysplexPi: input.sysplexPi[k] ?? null, localPi: localPi[k] ?? null, dp: dps[k]!, bottleneck, outcome, trials: [] };
    traced.push(c);
    return c;
  };
  const finish = (out: AdjustOutput): AdjustOutput => {
    if (traceSink) traceSink({ clockText: input.clockText, lparId: system.lparId, dps: { ...dps }, candidates: traced, action: out.log?.includes('RCVR=') ? out.log : null, protection });
    return out;
  };
  let projected = 0;
  let projectedImp = -1;
  for (const receiver of candidates) {
    const impOf = info[receiver]!.importance;
    // Projection is the expensive part: assess at most two fixable receivers per importance, then move on.
    if (impOf !== projectedImp) {
      projectedImp = impOf;
      projected = 0;
    }
    if (projected >= RECEIVERS_PER_IMPORTANCE) {
      // Skip, don't stop: lower importances still get their own budget, traced or not.
      if (tracing) traceOf(receiver, null, 'BUDGET');
      continue;
    }
    const scState = system.scps.find((s) => s.scKey === receiver)!;
    // With I/O priority management off, I/O samples are outside velocity and WLM doesn't manage I/O (WLM Planning p.115).
    const btl = bottleneckOf({ ...scState.acc, delayIo: scState.acc.delayIo - (scState.acc.delayIoNoVel ?? 0) });
    const pi = (input.sysplexPi[receiver] ?? localPi[receiver] ?? 0).toFixed(2);
    if (btl !== 'CPU' && btl !== 'ZIIP') {
      notes.push(`${receiver} PI=${pi} BTLNK=${btl} not WLM-fixable`);
      if (tracing) traceOf(receiver, btl, 'NOT_FIXABLE');
      continue;
    }
    const ct = tracing ? traceOf(receiver, btl, 'ASSESSED') : null;
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
    for (const d of donors) {
      const nd = Math.max(DP.MANAGED_MIN, rdp - 1);
      trials.push({ trial: { ...dps, [d]: nd }, text: `DONOR ${d} DP ${hex(dps[d]!)}→${hex(nd)}` });
    }

    for (const tr of trials) {
      why = null;
      const ok = passes(receiver, tr.trial);
      if (ct) ct.trials.push(ok ? { move: tr.text, verdict: 'ACCEPTED' } : { ...(why ?? { verdict: 'NO_RECEIVER_GAIN' as const }), move: tr.text });
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
    default: return 'no net value';
  }
}

const hex = (n: number) => n.toString(16).toUpperCase();
