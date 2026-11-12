// Composite priority changes (SG24-6472-03, March 2008, p.67–68): retain safe intermediate moves,
// carry a secondary receiver, leave a failing donor, and roll everything back without receiver value.
import { canonical, levelOf, moveToLevel, raiseOneStep, type Ladder } from './ladder';
import type { WlmTrialVerdict } from './adjust';

export interface PlanMove {
  kind: 'UP' | 'CARRY' | 'DONOR';
  scKey: string;
  fromDp: number;
  toDp: number;
  /** Canonical numbering can leave an upward mover's number unchanged while its old mates move down. */
  above?: string;
}

/** Shared by the activity log and inspect's complete accepted-plan rows. */
export function formatPlanMoves(moves: readonly PlanMove[]): string {
  const hex = (dp: number) => dp.toString(16).toUpperCase();
  return moves.map((m) => `${m.kind} ${m.scKey} DP ${hex(m.fromDp)}→${hex(m.toDp)}${m.above ? ` (above ${m.above})` : ''}`).join('; ');
}

export interface PlanAssessment {
  ok: boolean;
  verdict: WlmTrialVerdict;
  receiverPi: [number | null, number | null];
  detail?: string;
  blockedBy?: string;
  projected: boolean;
  after?: Record<string, number | null>;
}

export interface PlanAttempt extends PlanAssessment {
  moves: PlanMove[];
}

export interface PlanResult {
  outcome: 'ACCEPTED' | 'REJECTED' | 'BUDGET' | 'STEP_LIMIT';
  ladder: Ladder;
  moves: PlanMove[];
  attempts: PlanAttempt[];
}

/** The callback judges every proposal against the same original base, charging only real projections.
 * null means the next projection cannot run. Neither a partial plan nor a rejected proposal mutates the input.
 * APPROX: advance receiver steps until blocked, then try donors; one named secondary receiver may repair each raise.
 * maxSteps bounds retained moves (UP, CARRY and DONOR each count), not free rejections. */
export function buildPlan(input: {
  receiver: string;
  ladder: Ladder;
  donors: readonly string[];
  maxSteps: number;
  basePi: number;
  importanceOf: (key: string) => number;
  assess: (ladder: Ladder, kind: 'UP' | 'DONOR') => PlanAssessment | null;
  receiverValue: (after: number) => boolean;
}): PlanResult {
  const { receiver: r, ladder: original, donors, maxSteps, importanceOf, assess, receiverValue } = input;
  let L = original;
  let cur = input.basePi;
  let preferUp = true;
  let upBlocked = false;
  let d = 0;
  const moves: PlanMove[] = [];
  const attempts: PlanAttempt[] = [];
  const seen = new Set([JSON.stringify(original)]);
  const finish = (outcome: PlanResult['outcome']): PlanResult => ({
    outcome, ladder: outcome === 'ACCEPTED' ? L : original, moves: outcome === 'ACCEPTED' ? moves : [], attempts,
  });
  const step = (kind: PlanMove['kind'], key: string, before: Ladder, after: Ladder): PlanMove => {
    const fromDp = canonical(before)[key]!, toDp = canonical(after)[key]!;
    const above = fromDp === toDp ? after[levelOf(after, key) + 1]?.[0] : undefined;
    return { kind, scKey: key, fromDp, toDp, ...(above ? { above } : {}) };
  };
  const evaluate = (T: Ladder, proposed: PlanMove[], kind: 'UP' | 'DONOR'): PlanAssessment | null => {
    const a = assess(T, kind);
    if (a) attempts.push({ ...a, moves: [...proposed] });
    return a;
  };
  // A proposal that passes net value but buys nothing over the retained plan is recorded as no gain and not kept.
  const noGain = (a: PlanAssessment): PlanAssessment => {
    const attempt = attempts[attempts.length - 1]!;
    attempt.ok = false;
    attempt.verdict = 'NO_RECEIVER_GAIN';
    return { ...a, ok: false, verdict: 'NO_RECEIVER_GAIN' };
  };
  const retain = (T: Ladder, proposed: PlanMove[], a: PlanAssessment): boolean => {
    L = T;
    moves.push(...proposed);
    cur = a.receiverPi[1]!;
    seen.add(JSON.stringify(L));
    if (!receiverValue(cur)) return false;
    attempts[attempts.length - 1]!.verdict = 'ACCEPTED';
    return true;
  };
  while (moves.length < maxSteps) {
    if (preferUp && !upBlocked) {
      let T = raiseOneStep(L, r);
      if (T === L || seen.has(JSON.stringify(T))) upBlocked = true;
      else {
        const proposed = [step('UP', r, L, T)];
        let a = evaluate(T, proposed, 'UP');
        if (!a) return finish('BUDGET');
        const k = a.blockedBy;
        if (!a.ok && k && k !== r && importanceOf(k) <= importanceOf(r) && levelOf(T, k) >= levelOf(T, r) &&
            moves.length + 2 <= maxSteps) {
          const carried = moveToLevel(T, k, levelOf(T, r));
          if (JSON.stringify(carried) !== JSON.stringify(T) && !seen.has(JSON.stringify(carried))) {
            proposed.push(step('CARRY', k, T, carried));
            T = carried;
            a = evaluate(T, proposed, 'UP');
            if (!a) return finish('BUDGET');
          }
        }
        // APPROX: a harmful join, or one worse for the receiver itself, can hide a valuable split above that same
        // level (the dispatcher is nonlinear). WLM assesses the move to the free priority above a donor directly (WLM
        // Services p.707, code 630): assess the two-step proposal as a whole; the failed join is never retained alone.
        if (!a.ok && proposed.length === 1 && L[levelOf(L, r)]!.length === 1 &&
            (a.verdict === 'NO_NET_VALUE' || a.verdict === 'EQUAL_DISPARITY' || a.verdict === 'NO_RECEIVER_GAIN') && moves.length + 2 <= maxSteps) {
          const split = raiseOneStep(T, r);
          if (split !== T && !seen.has(JSON.stringify(split))) {
            proposed.push(step('UP', r, T, split));
            T = split;
            a = evaluate(T, proposed, 'UP');
            if (!a) return finish('BUDGET');
          }
        }
        // Every proposal is judged against the original base, so a raise could pass while undoing what earlier
        // retained moves bought. It may add nothing yet (p.67: the first move lacked receiver value), but not lose.
        if (a.ok && a.receiverPi[1]! > cur) a = noGain(a);
        if (a.ok) {
          if (retain(T, proposed, a)) return finish('ACCEPTED');
          preferUp = true;
          continue;
        }
        upBlocked = true;
      }
    }
    // The initial donor order is stable, but a receiver raise may have left a donor below it. Never raise a donor.
    while (d < donors.length && levelOf(L, donors[d]!) > levelOf(L, r)) d++;
    if (d < donors.length) {
      const donor = donors[d++]!;
      const rl = levelOf(L, r);
      const T = moveToLevel(L, donor, rl, levelOf(L, donor) < rl ? 'join' : 'below');
      if (seen.has(JSON.stringify(T))) continue;
      const proposed = [step('DONOR', donor, L, T)];
      const judged = evaluate(T, proposed, 'DONOR');
      if (!judged) return finish('BUDGET');
      // A safe donor still has to improve on the retained plan, not just on the original base.
      const a = judged.ok && judged.receiverPi[1]! >= cur ? noGain(judged) : judged;
      if (a.ok) {
        if (retain(T, proposed, a)) return finish('ACCEPTED');
        upBlocked = false;
        preferUp = true;
      }
      continue;
    }
    if (!upBlocked) { preferUp = true; continue; }
    return finish('REJECTED');
  }
  return finish('STEP_LIMIT');
}
