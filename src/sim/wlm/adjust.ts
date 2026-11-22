// WLM policy adjustment (SG24-7621 §3.12–3.15), run every 10 s per system:
// pick the most important, worst-PI receiver; find its bottleneck; try DP moves
// (receiver up, donors down); accept the first move with receiver value and net value.
// At most one receiver is helped per interval.
// Two PIs, each with one job (docs/wlm-design.md §5.2): receivers are chosen on the management PI (the smoothed
// accumulators); every trial is judged on projected PIs, `base` at the current DPs against `after` at the trial's,
// both from the dispatcher model at sustained demand (projection.ts).

import { CLUE_LOG_EVERY, MOSTLY_WAITING_FRAC, POLICY_ADJUST } from '../../content/wlm/tuning';
import { formatClock } from '../core/clock';
import { buildPlan, formatPlanMoves, type PlanAttempt } from './plan';
import { createAdjustContext } from './adjust/context';
import { createAssessment, receiverValueNeeded } from './adjust/assess';
import { selectCandidates } from './adjust/candidates';
import { donorInfoFor, donorOrder } from './adjust/donors';
import { fixableBottlenecks, largestManagedDelay, managedDelayFrac, sharesOf, waitingFrac, type Bottleneck } from './adjust/delays';
import { traceSink, type WlmCandidateTrace, type WlmTrialTrace } from './adjust/trace';
import type { AdjustInput, AdjustOutput } from './adjust/types';

export type { AdjustInput, AdjustOutput } from './adjust/types';
export type { Bottleneck, FixableBottleneck } from './adjust/delays';
export { fixableBottlenecks, largestManagedDelay, managedDelayFrac, waitingFrac } from './adjust/delays';
export type { WlmTrialVerdict, WlmTrialTrace, WlmDelayShares, WlmCandidateTrace, WlmAdjustTrace } from './adjust/trace';
export { setWlmTraceSink } from './adjust/trace';
export { cpuProtected, enforceCpuProtection } from './adjust/protection';
export { receiverValueNeeded } from './adjust/assess';
export { managementWorstPi, donorOrder, type DonorInfo } from './adjust/donors';

export function policyAdjust(input: AdjustInput): AdjustOutput {
  const ctx = createAdjustContext(input);
  const { info, topo, server, hold, dps, ladder, protect, protection, localPi, accOf, honourSkipClock,
    nowTick, skipUntil, basePis, backlogCut, withHolders } = ctx;
  const { system } = input;
  const donorInfo = donorInfoFor(ctx);
  const tracing = traceSink !== null;
  const { state, assess, reject } = createAssessment(ctx);
  const { candidates, resumedAt, nextCandidateAfter } = selectCandidates(ctx);

  const notes: string[] = [];
  const clockNotes: string[] = [];
  const traced: WlmCandidateTrace[] = [];
  const traceOf = (
    k: string,
    bottleneck: Bottleneck | null,
    outcome: WlmCandidateTrace['outcome'],
  ): WlmCandidateTrace => {
    const acc = accOf[k]!.acc;
    const c: WlmCandidateTrace = { scKey: k, ...(hold(k) !== k ? { holder: hold(k) } : {}), importance: info[k]!.importance, sysplexPi: input.sysplexPi[k] ?? null, localPi: localPi[k] ?? null, dp: dps[k]!, bottleneck, delayShares: sharesOf(acc), waitingFrac: waitingFrac(acc), outcome, trials: [] };
    traced.push(c);
    return c;
  };
  const finish = (out: Omit<AdjustOutput, 'skipUntil' | 'resumeAt' | 'clockNotes'>, resumeAt: string | null): AdjustOutput => {
    if (traceSink) traceSink({ clockText: input.clockText, lparId: system.lparId, dps: { ...dps }, candidates: traced, action: out.log?.includes('RCVR=') ? out.log : null, protection, ...(server ? { heldBy: { ...topo.heldBy } } : {}) });
    const srv = server && out.dps[server] !== undefined ? { servers: [{ key: server, dp: out.dps[server]! }] } : {};
    return { ...out, ...srv, skipUntil, resumeAt, clockNotes };
  };
  /** The no-action note's text for a period that is mostly waiting (§5.7): its waits are not a delay WLM manages, and
   * the CPU delay it does have is named, which keeps the clue for a starved server (SPEC §5.5.4). */
  const waitingNote = (k: string): string | null => {
    const acc = accOf[k]!.acc;
    if (waitingFrac(acc) <= MOSTLY_WAITING_FRAC) return null;
    const samples = acc.using + acc.delay + acc.delayOther;
    return `mostly waiting, CPU delay ${Math.round((100 * acc.delayCpu) / samples)} %: not WLM-fixable`;
  };
  let stoppedAt: string | null = null;
  for (const receiver of candidates) {
    // The skip clock (WLM Services 3.1, PDF p.145 (printed 121)): a receiver nothing could help is not assessed again until it expires.
    if (skipUntil[receiver] !== undefined) {
      if (tracing) traceOf(receiver, null, 'SKIP_CLOCK').skipUntilTick = skipUntil[receiver];
      continue;
    }
    const acc = accOf[receiver]!.acc;
    const pi = (input.sysplexPi[receiver] ?? localPi[receiver] ?? 0).toFixed(2);
    const waiting = waitingNote(receiver);
    // A period with no managed delay is not assessed: no priority change can help it (WLM Services 3.1, PDF p.144 (printed 120)).
    const mdf = managedDelayFrac(acc);
    if (mdf < POLICY_ADJUST.needsHelpDelayFrac) {
      if (waiting) notes.push(`${receiver} PI=${pi} ${waiting}`);
      if (tracing) traceOf(receiver, null, 'NO_MANAGED_DELAY').managedDelayFrac = mdf;
      continue;
    }
    // Plans are built for CPU and zIIP, largest delay first, each a real share of the managed delay (§5.7). I/O,
    // storage and queue delay are managed by other means (I/O priority, storage targets, MPL) that the sim does not
    // model as policy adjustment actions. With I/O priority management off, I/O samples are outside velocity
    // (WLM Planning 3.1, PDF p.115 (printed 95)) and are not managed delay.
    const fixable = fixableBottlenecks(acc);
    if (fixable.length === 0) {
      const largest = largestManagedDelay(acc);
      notes.push(`${receiver} PI=${pi} ${waiting ?? `BTLNK=${largest} not WLM-fixable`}`);
      if (tracing) traceOf(receiver, largest, 'NOT_FIXABLE').managedDelayFrac = mdf;
      continue;
    }
    const btl0 = fixable[0]!;
    // One basis: a receiver whose projected PI at sustained demand is already at or under 1 is recovering by
    // itself (its management PI is still catching up). No trials, and no use of the projection budget.
    const b0 = basePis()[receiver];
    if (b0 == null || b0 <= 1) {
      // A period mostly waiting keeps the waiting note: its measured PI stays high while the projection, at sustained
      // demand, says the processor is not what holds it back.
      notes.push(`${receiver} PI=${pi} ${waiting ?? `BTLNK=${btl0} already recovering`}`);
      if (tracing) traceOf(receiver, btl0, 'RECOVERING').basePi = b0 ?? null;
      continue;
    }
    // The projection budget is per interval: when it is spent the search stops, with no skip clock, and the next
    // interval's search starts at this receiver.
    if (state.budget <= 0) {
      if (tracing) traceOf(receiver, btl0, 'BUDGET').basePi = b0;
      stoppedAt = receiver;
      break;
    }
    const ct = tracing ? traceOf(receiver, btl0, 'ASSESSED') : null;
    if (ct) {
      ct.basePi = b0;
      ct.managedDelayFrac = mdf;
      ct.plans = [];
    }
    // A receiver whose backlog the projection bounded, and that is measured far worse than projected (a runaway), is
    // not raised: the projection cannot show what draining that backlog does to others. Only where the bound cut
    // something: elsewhere a gap between the PIs is no reason to distrust the projection. APPROX: real WLM's demand
    // data does not hide a backlog (WLM Services 3.1, PDF p.144 (printed 120): maximum demand is use with no processor delay); this guards
    // the sim's bound (docs/wlm-design.md §5.4). A percentile PI stops at 4.0, so a percentile receiver never trips it.
    const mPi = Math.max(localPi[receiver] ?? 0, input.sysplexPi[receiver] ?? 0);
    const distrust = mPi > POLICY_ADJUST.projectionTrustMax * b0 && backlogCut(receiver);
    /** The clue the log gives when no move paid off: the first rejection that names what stood in the way (harm,
     * CPU protection, the projection), else the first. Small steps come first on the ladder and often only gain
     * nothing, which says less than the harm a larger step would do. */
    let firstReject: { move: string; why: WlmTrialTrace } | null = null;
    let firstNamed: { move: string; why: WlmTrialTrace } | null = null;
    let retained: PlanAttempt | undefined;
    const hadWholeBudget = state.budget === POLICY_ADJUST.maxProjectionsPerInterval;
    const describe = formatPlanMoves;
    let outOfBudget = false;
    for (const btl of fixable) {
      const donors = donorOrder(hold(receiver), btl, dps, donorInfo, POLICY_ADJUST, info[receiver]!.importance);
      if (ct && !ct.donors) ct.donors = [...donors];
      const plan = buildPlan({
        receiver: hold(receiver), receiverImportance: info[receiver]!.importance, holderOf: hold,
        ladder, donors, maxSteps: POLICY_ADJUST.maxPlanSteps, basePi: b0,
        importanceOf: (k) => info[k]!.importance,
        receiverValue: (after) => b0 - after >= receiverValueNeeded(b0),
        assess: (L, kind) => {
          if (kind === 'UP' && distrust) {
            reject('PROJECTION_DISAGREES', [b0, null], `projected PI ${b0.toFixed(2)} vs measured ${mPi.toFixed(2)}`);
            return { ...state.why!, receiverPi: [b0, null], ok: false, projected: false };
          }
          return assess(receiver, withHolders(dps, L));
        },
      });
      if (ct) {
        ct.planOutcome = plan.outcome;
        ct.plans!.push({ bottleneck: btl, donors: [...donors], outcome: plan.outcome });
        if (plan.outcome === 'ACCEPTED') ct.bottleneck = btl;
      }
      for (const attempt of plan.attempts) {
        const w: WlmTrialTrace = { move: describe(attempt.moves), verdict: attempt.verdict,
          receiverPi: attempt.receiverPi, projected: attempt.projected, steps: attempt.moves,
          ...(fixable.length > 1 ? { bottleneck: btl } : {}),
          ...(attempt.detail ? { detail: attempt.detail } : {}),
          ...(attempt.blockedBy ? { blockedBy: attempt.blockedBy } : {}),
          ...(attempt.verdict === 'ACCEPTED' ? { plan: plan.moves, afterPis: attempt.after, afterDps: withHolders(dps, plan.ladder) } : {}),
        };
        if (ct) ct.trials.push(w);
        if (w.verdict === 'RETAINED' || w.verdict === 'ACCEPTED') continue;
        if (!firstReject) firstReject = { move: w.move, why: w };
        if (!firstNamed && (w.blockedBy || w.verdict === 'CPU_CRITICAL' || w.verdict === 'PROJECTION_DISAGREES')) firstNamed = { move: w.move, why: w };
      }
      if (plan.outcome === 'ACCEPTED') return finish({
        dps: withHolders(dps, plan.ladder),
        log: `${input.clockText} ${system.lparId} RCVR=${receiver}${hold(receiver) !== receiver ? ` (regions ${hold(receiver)})` : ''} PI=${pi} BTLNK=${btl} ${describe(plan.moves)}`,
        protect,
      }, resumedAt);
      retained ??= plan.attempts.filter((a) => a.ok).at(-1);
      if (plan.outcome === 'BUDGET') {
        outOfBudget = true;
        break;
      }
    }
    // No move taken: say what this receiver's first move would have done, so the log answers "why not?".
    const clue = firstNamed ?? firstReject ?? (retained ? {
      move: describe(retained.moves),
      why: { move: '', verdict: 'SMALL_GAIN' as const, receiverPi: retained.receiverPi,
        detail: `complete plan needs ≥ ${receiverValueNeeded(b0).toFixed(2)}` },
    } : null);
    const whyNot = clue ? ` (${clue.move} rejected: ${playerReason(clue.why)})` : '';
    const noAction = waiting ?? `BTLNK=${btl0} no action with net value${whyNot}`;
    if (outOfBudget && !hadWholeBudget) {
      notes.push(`${receiver} PI=${pi} ${noAction}`);
      stoppedAt = receiver;
      break;
    }
    // Every trial was rejected: skip it until the clock expires, unless few periods miss their goals (RF-03).
    if (honourSkipClock) {
      // The next three cycles are skipped: `nowTick + 1`, `+ 2` and `+ 3`. `until` is the first tick it may be
      // assessed again, and the check is `skipUntilTick > nowTick`, so add one to the count.
      const until = nowTick + POLICY_ADJUST.rejectedSkipTicks + 1;
      skipUntil[receiver] = until;
      if (ct) ct.skipUntilTick = until;
      const note = `${receiver} PI=${pi} ${noAction}, next look ${formatClock(until).split(' ')[1]}`;
      notes.push(note);
      clockNotes.push(`${input.clockText} ${system.lparId} ${note}`);
    } else {
      // No clock: the note joins the ordinary five-minute no-action cadence instead of being logged when a clock
      // starts. At the cadence, `clockNotes` carries every receiver's clue, not only the first (`out.log`).
      const note = `${receiver} PI=${pi} ${noAction}`;
      notes.push(note);
      if (nowTick % CLUE_LOG_EVERY === 0) clockNotes.push(`${input.clockText} ${system.lparId} ${note}`);
    }
    if (outOfBudget) {
      // A budget hog is normally clocked, so the next search starts at it only to trace SKIP_CLOCK and move on. With
      // the clock not honoured (RF-03), start after it instead, or it would spend the whole budget again every
      // interval and the receivers behind it would never be reached.
      stoppedAt = honourSkipClock ? receiver : nextCandidateAfter(receiver);
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
    case 'PROJECTION_DISAGREES':
      return w.detail?.includes(' is behind with a backlog ')
        ? `${name}'s backlog would take the processor from work moved below it`
        : 'its backlog would take the processor from other work while it catches up';
    default: return 'no net value';
  }
}
