import { POLICY_ADJUST } from '../../../content/wlm/tuning';
import type { PlanAssessment } from '../plan';
import type { AdjustContext } from './context';
import { managementWorstPi } from './donors';
import { cpuProtected, hex } from './protection';
import type { WlmTrialTrace, WlmTrialVerdict } from './trace';

/** Receiver value (WLM Services 3.1, PDF p.138 (printed 114): "a minimum performance index improvement … to reject very small
 * improvements"): the projected gain must close a share of the distance to the goal, and at least a floor. */
export const receiverValueNeeded = (basePi: number): number =>
  Math.max(POLICY_ADJUST.receiverValueFrac * (basePi - 1), POLICY_ADJUST.receiverValueMinPi);

/** Mutable trial bookkeeping belongs to one adjustment, never to saved state or the next interval. */
export function createAssessment({ input, holderInfo, ccImp, dps, basePis, info, infoKeys, localPi, usedEngines, hold, runaways, holderKeys, project }: AdjustContext) {
  // Long-term CPU protection: less important work never gets an equal or higher DP than a CPU-critical
  // class (MVS Planning: WLM, ch. 14; enqueue promotion is the documented exception, not modelled).
  // CCIMP extends it to first or only periods up to that importance (Init & Tuning Reference 3.1, PDF p.428 (printed 392)). APPROX: no
  // System Recovery Boost in the sim, so CCIMPBOOST never applies. A pair enforcement could not separate (protected
  // period at the managed floor) is only blamed on a trial that widens it.
  const violatesCpuCritical = (trial: Record<string, number>): string | null => {
    // Holders, not periods: a less important class served by the same regions as protected work rides with it.
    for (const [k, g] of Object.entries(holderInfo)) {
      if (!cpuProtected(g, ccImp)) continue;
      for (const [k2, g2] of Object.entries(holderInfo)) {
        if (g2.importance <= g.importance) continue;
        const gap = (trial[k2] ?? 0) - (trial[k] ?? 0);
        const heldGap = (dps[k2] ?? 0) - (dps[k] ?? 0);
        if (gap >= 0 && (heldGap < 0 || gap > heldGap)) return `${k2} (imp ${g2.importance}) ${hex(trial[k2] ?? 0)} ≥ ${k} (imp ${g.importance}) ${hex(trial[k] ?? 0)}`;
      }
    }
    return null;
  };

  // Projections left this interval (I16): a CPU-protection or missing-goal rejection costs none.
  const state: { budget: number; why: WlmTrialTrace | null } = { budget: POLICY_ADJUST.maxProjectionsPerInterval, why: null };
  // Recorded even without the trace sink: the player-visible log names a rejected move and why.
  const reject = (verdict: WlmTrialVerdict, r: [number | null, number | null], detail?: string, blockedBy?: string) => {
    state.why = { move: '', verdict, receiverPi: r, ...(detail ? { detail } : {}), ...(blockedBy ? { blockedBy } : {}) };
    return false;
  };
  const assess = (receiver: string, trial: Record<string, number>): PlanAssessment | null => {
    state.why = null;
    const judged = (ok: boolean, projected: boolean, after?: Record<string, number | null>): PlanAssessment => ({
      ...(state.why ?? { verdict: 'NO_RECEIVER_GAIN' as const, receiverPi: [null, null] as [null, null] }),
      receiverPi: state.why?.receiverPi ?? [null, null], ok, projected, ...(after ? { after } : {}),
    });
    const before = basePis();
    const cc = violatesCpuCritical(trial);
    if (cc) {
      // No projection was judged; the receiver's `base` is still worth recording.
      state.why = { move: '', verdict: 'CPU_CRITICAL', receiverPi: [before[receiver] ?? null, null], detail: cc };
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
    // Work that is behind its goal with a backlog the projection bounded (sustained demand, `backlogBoostFrac`) will
    // drain that backlog on whatever ends up below it, which the projection cannot show (the receiver-side guard is
    // `projectionTrustMax`). So no trial puts a holder below such a period that was not below it: the server period of a
    // CICS image lowered past a runaway DDF class starved every transaction it serves (docs/wlm-design.md §5.4).
    // APPROX: real WLM's demand data does not hide a backlog (WLM Services 3.1, PDF p.144 (printed 120)); this guards the sim's bound.
    const rHold = hold(receiver);
    for (const k of runaways()) {
      const hk = hold(k);
      if (hk === rHold) continue;
      const k0 = dps[hk]!;
      const k1 = trial[hk] ?? k0;
      for (const x of holderKeys) {
        if (x === hk) continue;
        const x0 = dps[x]!;
        const x1 = trial[x] ?? x0;
        if (x0 >= k0 && x1 < k1) {
          reject('PROJECTION_DISAGREES', [before[receiver] ?? null, null], `${k} is behind with a backlog the projection bounds and would pass ${x}`);
          return judged(false, false);
        }
      }
    }
    // The pair is only recorded once the whole projection accepts: `project` can still refuse after every accept
    // callback said yes (a batch recovery that never settles runs out of rounds), and a trace must not call that move
    // accepted.
    let acceptedPi: [number | null, number | null] | null = null;
    if (state.budget <= 0) return null;
    state.budget--;
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
        // (SG24-6472-03, March 2008, PDF p.60 (printed 42): a more important donor gives only while it keeps its goal); the noise tolerance only
        // spares work already missing it.
        const crosses = g.importance < rImp && p0 <= 1 && p1 > 1;
        if (!crosses && harm <= POLICY_ADJUST.harmEps) continue;
        if (g.importance < rImp && p1 > 1) return reject('MORE_IMPORTANT_HARMED', [r0, r1], `${k} (imp ${g.importance}) PI ${p0.toFixed(2)}→${p1.toFixed(2)}`, k);
        if (g.importance === rImp) {
          // Equal importance: the move must also bring the two PIs closer together (SG24-6472-03, March 2008, PDF p.60 (printed 42); Enrico,
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
    if (ok) state.why = { move: '', verdict: 'RETAINED', receiverPi: acceptedPi ?? [null, null] };
    return judged(ok, true, finalAfter);
  };
  return { state, assess, reject };
}
