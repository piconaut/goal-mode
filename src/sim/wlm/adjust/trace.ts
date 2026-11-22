import type { PlanMove } from '../plan';
import type { Bottleneck, FixableBottleneck } from './delays';

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
  | 'PROJECTION_DISAGREES'; // a receiver-up move for a receiver measured far worse than projected (projectionTrustMax), or a
  // trial that puts a holder below work far behind with a bounded backlog (§9.12)

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
  /** The bottleneck whose plan this trial belongs to, when a receiver had plans for both CPU and zIIP. */
  bottleneck?: FixableBottleneck;
  /** Retained moves of the accepted atomic plan (only on its final ACCEPTED proposal). */
  plan?: PlanMove[];
  afterPis?: Record<string, number | null>;
  afterDps?: Record<string, number>;
}

/**
 * Delay shares of a period: each delay component over `using + delay`. `IO` is the velocity share (delay I/O priority
 * management cannot see is subtracted), and `OTHER` (waits) is outside `delay`, so they do not sum to 1.
 */
export type WlmDelayShares = Record<Exclude<Bottleneck, 'NONE'> | 'CAP' | 'OTHER', number>;

export interface WlmCandidateTrace {
  scKey: string;
  /** The holder whose DP the plans move, when it is not the period itself (the server period of CICS transactions). */
  holder?: string;
  importance: number;
  sysplexPi: number | null;
  localPi: number | null;
  dp: number;
  bottleneck: Bottleneck | null;
  /**
   * The period's delay shares (zero when it used and lost no time), recorded for every outcome so a consumer always
   * has the period's accounting.
   */
  delayShares: WlmDelayShares;
  /** Waits over all samples (`waitingFrac`); over one half the no-action note reads "mostly waiting". */
  waitingFrac?: number;
  /** ASSESSED: one entry per plan built, in order (CPU and zIIP by delay, §5.7); `trials` holds all of their trials. */
  plans?: { bottleneck: FixableBottleneck; donors: string[]; outcome: 'ACCEPTED' | 'REJECTED' | 'BUDGET' | 'STEP_LIMIT' }[];
  /** Donor periods of the first plan in the order its trials were built (assessed receivers; empty when none
   * qualified). Each plan's donors are in `plans`. */
  donors?: string[];
  /** SKIP_CLOCK: its skip clock has not expired (`skipUntilTick`); NO_MANAGED_DELAY: its managed delay is under
   * `needsHelpDelayFrac` (`managedDelayFrac`); NOT_FIXABLE: neither CPU nor zIIP delay is `bottleneckMinFrac` of the
   * managed delay (`bottleneck` is the largest managed delay); RECOVERING: its projected PI at
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
  /** Goal periods whose DP another holder holds → that holder (the server period, WT-09); absent with none. */
  heldBy?: Record<string, string>;
}

// Investigation tooling only (tools/inspect.ts): never set by the game, never part of state, and it doesn't change
// what policyAdjust decides.
export let traceSink: ((t: WlmAdjustTrace) => void) | null = null;
export function setWlmTraceSink(sink: ((t: WlmAdjustTrace) => void) | null): void {
  traceSink = sink;
}
