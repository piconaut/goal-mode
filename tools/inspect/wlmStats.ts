import { abendedSet, applyPlayCommand, decodePlayFile, clockText, newPlayFile, type PlayFile } from '../playCore';
import { tickOfClock } from '../../src/sim/core/clock';
import { TICK_SEC, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import { setWlmTraceSink, type WlmAdjustTrace, type WlmCandidateTrace, type WlmTrialVerdict } from '../../src/sim/wlm/adjust';
import { formatPlanMoves } from '../../src/sim/wlm/plan';
import { hexDp, replayAdvance } from './shared';

/** Per-system and total counts from a run's policy adjustment traces (WT-01); the audit's S-1 … S-3 table. */
export interface WlmStatsCounters {
  /** Policy adjustments in the range (one per system per tick). */
  adjustments: number;
  /** Adjustments where every goal period met its goal, so no candidate was assessed. */
  noCandidate: number;
  /** Candidates with an outcome of `ASSESSED` (trials were built for them). */
  assessed: number;
  /** `NOT_FIXABLE` candidates by their largest managed delay (CPU and zIIP delay both under `bottleneckMinFrac` of it;
   * WT-10). */
  notFixable: Record<'IO' | 'STORAGE' | 'QUEUE', number>;
  /** `SKIP_CLOCK` and `NO_MANAGED_DELAY` candidates (WT-05). */
  skipClock: number;
  noManagedDelay: number;
  /** Candidates that were mostly waiting (waits over half their samples; WT-10), by outcome: their log note says so
   * whatever the outcome (assessed with no plan, not fixable, recovering; no managed delay). */
  waitingNoDelay: number;
  waitingAssessed: number;
  waitingNotFixable: number;
  waitingRecovering: number;
  /** Skip clocks set (an assessed candidate with every trial rejected). */
  clocksSet: number;
  /** `BUDGET` candidates: the interval's projection budget was spent before them. */
  budget: number;
  trials: number;
  projections: number;
  acceptedPlans: number;
  acceptedSteps: number;
  acceptedCarry: number;
  /** Trials by verdict. `ACCEPTED` is the move the adjustment took. */
  verdicts: Record<WlmTrialVerdict, number>;
  /** Accepted trials that raised the receiver, and those that lowered a donor. */
  acceptedReceiverUp: number;
  acceptedDonor: number;
  /** Rejected trials whose receiver's before PI (the value the trial was judged on: its projected `base` since WT-04,
   * so 0 by construction; this tick's own PI before) was ≤ 0.9 … */
  rejectedPiUnder09: number;
  /** … or null (no PI measured for it this tick). */
  rejectedPiNull: number;
  /** A period's DP move reversed by the next move of the same period … */
  reversed: number;
  /** … within two minutes (12 adjustments of that system): the flip-flop W1 is about, as opposed to work that gets
   * a turn every few minutes on a full image (docs/wlm-design.md §5.9 I13). Not counted here when another
   * receiver's plan in between projected the period past its goal (I13): conditions changed, it was not a flip-flop … */
  reversedWithin2Min: number;
  /** … but counted here: reversals within two minutes after such an intervening plan. */
  reversedAfterHarm: number;
  /** Candidates whose projected PI at the current DPs (`base`) was already ≤ 1: no trials (WT-04). */
  recovering: number;
  /** Periods assessed on 30 adjustments without being the receiver of an accepted move (one per run). A donor move
   * on the period does not reset the run, and neither does an adjustment that skipped it: the count is of
   * assessments, in the order they happened. */
  episodes: number;
  /** Runs of 30+ consecutive no-trial candidates (`NOT_FIXABLE` / `RECOVERING`) on one period of one image. */
  noTrialStreaks: number;
}

export interface WlmStats {
  total: WlmStatsCounters;
  systems: { lparId: string; counters: WlmStatsCounters }[];
  /** With `ladder`, each system's DP ladder (hex, highest first) at that clock time each played day. */
  ladder: { lparId: string; lines: string[] }[];
  ladderTime: string | null;
  /** With `byClass`, `episodes`, `streaks` or `moves` (the CLI's `--by-class`, `--episodes`, `--streaks`, `--moves`). */
  byClass?: WlmClassRow[];
  episodes?: WlmEpisode[];
  streaks?: WlmStreak[];
  moves?: WlmMoveRow[];
}

const emptyCounters = (): WlmStatsCounters => ({
  adjustments: 0, noCandidate: 0, assessed: 0, notFixable: { IO: 0, STORAGE: 0, QUEUE: 0 }, budget: 0, recovering: 0, skipClock: 0, noManagedDelay: 0, waitingNoDelay: 0, waitingAssessed: 0, waitingNotFixable: 0, waitingRecovering: 0, clocksSet: 0, trials: 0, projections: 0, acceptedPlans: 0, acceptedSteps: 0, acceptedCarry: 0,
  verdicts: { ACCEPTED: 0, RETAINED: 0, CPU_CRITICAL: 0, NO_RECEIVER_GAIN: 0, SMALL_GAIN: 0, MORE_IMPORTANT_HARMED: 0, EQUAL_DISPARITY: 0, NO_NET_VALUE: 0, PROJECTION_DISAGREES: 0 },
  acceptedReceiverUp: 0, acceptedDonor: 0, rejectedPiUnder09: 0, rejectedPiNull: 0, reversed: 0, reversedWithin2Min: 0, reversedAfterHarm: 0, episodes: 0, noTrialStreaks: 0,
});

const VERDICT_ORDER: WlmTrialVerdict[] = ['ACCEPTED', 'RETAINED', 'CPU_CRITICAL', 'NO_RECEIVER_GAIN', 'SMALL_GAIN', 'MORE_IMPORTANT_HARMED', 'EQUAL_DISPARITY', 'NO_NET_VALUE', 'PROJECTION_DISAGREES'];

const notFixableKey = (b: WlmCandidateTrace['bottleneck']): keyof WlmStatsCounters['notFixable'] => {
  switch (b) {
    case 'IO':
    case 'STORAGE':
    case 'QUEUE':
      return b;
    // CPU and zIIP are assessable, and a candidate with no managed delay is NO_MANAGED_DELAY, so `policyAdjust` never
    // records these as NOT_FIXABLE: if that changes, the audit table needs a column for it.
    default:
      throw new Error(`a ${b} bottleneck cannot be NOT_FIXABLE`);
  }
};

/** A trial's move text names the period and its new DP: `ONLHI#1 DP 20→21` or `DONOR X DP 20→1F`. */
const MOVED = /^(DONOR\s+)?(\S+)\s+DP\s+([0-9A-F]+)→([0-9A-F]+)$/;

/** One episode (`--episodes`): a period's run of assessments without a committed plan helping it, once
 * it reached 30. `end` is that plan's clock, or null when the range ended first. Legacy traces count receiver moves. */
export interface WlmEpisode {
  lparId: string;
  scKey: string;
  /** Clock of the run's first and last assessment. */
  first: string;
  last: string;
  assessments: number;
  /** Trials in the run by verdict; donor moves accepted while the period was the candidate count as `ACCEPTED`. */
  verdicts: Partial<Record<WlmTrialVerdict, number>>;
  end: string | null;
}

/** A streak (`--streaks`): one period on one image checked 30+ times in a row with no trials built. These are
 * candidate checks, not assessment episodes: a `NOT_FIXABLE` or `RECOVERING` outcome sets no skip clock and runs no
 * trial search, so it contributes nothing to `episodes` (PR-20). */
export interface WlmStreak {
  lparId: string;
  scKey: string;
  outcome: 'NOT_FIXABLE' | 'RECOVERING';
  bottleneck: WlmCandidateTrace['bottleneck'];
  /** Clock of the first and last check in the streak. */
  first: string;
  last: string;
  checks: number;
  /** Clock where the outcome/bottleneck changed or the candidate vanished, or null at the range end. */
  end: string | null;
}

/** Count one system's adjustments in trace order: totals, and the three cross-adjustment patterns (reversals,
 * assessment episodes and no-trial streaks). `episodes`/`streaks`, when given, receive the runs that reach 30, in
 * the order they end. */
function countSystem(traces: readonly WlmAdjustTrace[], episodes?: WlmEpisode[], streaks?: WlmStreak[]): WlmStatsCounters {
  const c = emptyCounters();
  const lastDirection = new Map<string, { dir: 1 | -1; at: number }>();
  /** The last adjustment at which another receiver's accepted plan projected the period past its goal. */
  const harmedAt = new Map<string, number>();
  let at = -1;
  const runs = new Map<string, { n: number; counted: boolean; first: string; last: string; verdicts: Partial<Record<WlmTrialVerdict, number>> }>();
  const close = (period: string, end: string | null) => {
    const run = runs.get(period);
    if (run?.counted && episodes) episodes.push({ lparId: traces[0]!.lparId, scKey: period, first: run.first, last: run.last, assessments: run.n, verdicts: run.verdicts, end });
    runs.delete(period);
  };
  type StreakRun = { outcome: 'NOT_FIXABLE' | 'RECOVERING'; bottleneck: WlmCandidateTrace['bottleneck']; n: number; first: string; last: string; counted: boolean };
  const noTrial = new Map<string, StreakRun>();
  const lparId = traces[0]?.lparId ?? '';
  const closeStreak = (period: string, end: string | null) => {
    const run = noTrial.get(period);
    if (!run) return;
    if (run.counted) {
      c.noTrialStreaks++;
      streaks?.push({ lparId, scKey: period, outcome: run.outcome, bottleneck: run.bottleneck, first: run.first, last: run.last, checks: run.n, end });
    }
    noTrial.delete(period);
  };
  for (const t of traces) {
    c.adjustments++;
    at++;
    if (t.candidates.length === 0) c.noCandidate++;
    const assessed = new Set<string>();
    const moved = new Map<string, 1 | -1>();
    const receiverMoved = new Set<string>();
    // A candidate absent from this image's next adjustment breaks its streak; an assessment or a different
    // bottleneck/outcome breaks it too, including SKIP_CLOCK when the candidate is still listed.
    const here = new Set(t.candidates.map((cand) => cand.scKey));
    for (const period of [...noTrial.keys()]) if (!here.has(period)) closeStreak(period, t.clockText);
    for (const cand of t.candidates) {
      const waiting = (cand.waitingFrac ?? 0) > 0.5;
      if (cand.trials.length === 0 && (cand.outcome === 'NOT_FIXABLE' || cand.outcome === 'RECOVERING')) {
        const run = noTrial.get(cand.scKey);
        if (run && (run.outcome !== cand.outcome || run.bottleneck !== cand.bottleneck)) closeStreak(cand.scKey, t.clockText);
        const current = noTrial.get(cand.scKey) ?? { outcome: cand.outcome, bottleneck: cand.bottleneck, n: 0, first: t.clockText, last: t.clockText, counted: false };
        const n = current.n + 1;
        noTrial.set(cand.scKey, { ...current, n, last: t.clockText, counted: current.counted || n >= 30 });
      } else closeStreak(cand.scKey, t.clockText);
      if (cand.outcome === 'NOT_FIXABLE') {
        c.notFixable[notFixableKey(cand.bottleneck)]++;
        if (waiting) c.waitingNotFixable++;
      } else if (cand.outcome === 'BUDGET') c.budget++;
      else if (cand.outcome === 'RECOVERING') {
        c.recovering++;
        if (waiting) c.waitingRecovering++;
      }
      else if (cand.outcome === 'SKIP_CLOCK') c.skipClock++;
      else if (cand.outcome === 'NO_MANAGED_DELAY') {
        c.noManagedDelay++;
        if (waiting) c.waitingNoDelay++;
      } else {
        c.assessed++;
        if (waiting) c.waitingAssessed++;
        assessed.add(cand.scKey);
        if (cand.skipUntilTick !== undefined) c.clocksSet++;
      }
      for (const tr of cand.trials) {
        c.trials++;
        if (tr.projected ?? (!['CPU_CRITICAL', 'PROJECTION_DISAGREES'].includes(tr.verdict) && !(tr.verdict === 'MORE_IMPORTANT_HARMED' && tr.receiverPi?.[1] == null))) c.projections++;
        c.verdicts[tr.verdict]++;
        if (tr.verdict === 'RETAINED') continue;
        if (tr.verdict !== 'ACCEPTED') {
          const pi = tr.receiverPi?.[0] ?? null;
          if (pi === null) c.rejectedPiNull++;
          else if (pi <= 0.9) c.rejectedPiUnder09++;
          continue;
        }
        c.acceptedPlans++;
        if (tr.plan) {
          c.acceptedSteps += tr.plan.length;
          receiverMoved.add(cand.scKey);
          // A plan is applied once: internal steps do not reverse each other in live state.
          for (const m of tr.plan) {
            if (m.kind === 'DONOR') c.acceptedDonor++;
            else if (m.kind === 'CARRY') c.acceptedCarry++;
            else c.acceptedReceiverUp++;
            if (!tr.afterDps) moved.set(m.scKey, m.kind === 'DONOR' ? -1 : 1);
          }
          if (tr.afterDps) {
            const rank = (ds: Record<string, number>, key: string) => Object.keys(ds).sort().reduce((sum, k) => sum + Math.sign(ds[key]! - ds[k]!), 0);
            for (const key of [...new Set(tr.plan.map((m) => m.scKey))].sort()) {
              const delta = rank(tr.afterDps, key) - rank(t.dps, key);
              if (delta !== 0) moved.set(key, delta > 0 ? 1 : -1);
            }
          }
        } else {
          const m = MOVED.exec(tr.move);
          if (!m) continue;
          c.acceptedSteps++;
          if (m[1] !== undefined) c.acceptedDonor++;
          else { c.acceptedReceiverUp++; receiverMoved.add(m[2]!); }
          moved.set(m[2]!, parseInt(m[4]!, 16) > parseInt(m[3]!, 16) ? 1 : -1);
        }
      }
    }
    for (const [period, dir] of moved) {
      const was = lastDirection.get(period);
      if (was !== undefined && was.dir !== dir) {
        c.reversed++;
        if (at - was.at <= 12) {
          if ((harmedAt.get(period) ?? -1) > was.at) c.reversedAfterHarm++;
          else c.reversedWithin2Min++;
        }
      }
      lastDirection.set(period, { dir, at });
    }
    for (const cand of t.candidates) for (const tr of cand.trials) {
      if (tr.verdict !== 'ACCEPTED' || !tr.afterPis) continue;
      // A served period's moves are its holder's (the server period, WT-09): harm to it is harm to that holder.
      for (const [period, pi] of Object.entries(tr.afterPis)) if (period !== cand.scKey && pi !== null && pi > 1) harmedAt.set(t.heldBy?.[period] ?? period, at);
    }
    // A committed plan ends the primary receiver's run, even if only its donors moved. Donating to another
    // receiver does not end the donor's own run; neither does an adjustment that skipped the period.
    for (const period of receiverMoved) close(period, t.clockText);
    for (const cand of t.candidates) {
      const period = cand.scKey;
      if (!assessed.has(period) || receiverMoved.has(period)) continue;
      const run = runs.get(period) ?? { n: 0, counted: false, first: t.clockText, last: t.clockText, verdicts: {} };
      const n = run.n + 1;
      if (n >= 30 && !run.counted) c.episodes++;
      for (const tr of cand.trials) run.verdicts[tr.verdict] = (run.verdicts[tr.verdict] ?? 0) + 1;
      runs.set(period, { ...run, n, last: t.clockText, counted: run.counted || n >= 30 });
    }
  }
  for (const period of [...runs.keys()].sort()) close(period, null);
  for (const period of [...noTrial.keys()].sort()) closeStreak(period, null);
  return c;
}

/** `--by-class`: each period's candidate outcomes, trials and plans helping it over the range, per system. */
export interface WlmClassRow {
  lparId: string;
  scKey: string;
  outcomes: Record<WlmCandidateTrace['outcome'], number>;
  trials: number;
  /** Accepted plans with this period as the primary receiver, including donor-only plans. */
  helped: number;
}

export function classRows(traces: readonly WlmAdjustTrace[]): WlmClassRow[] {
  const rows = new Map<string, WlmClassRow>();
  for (const t of traces) {
    for (const cand of t.candidates) {
      const key = `${t.lparId} ${cand.scKey}`;
      let row = rows.get(key);
      if (!row) {
        row = { lparId: t.lparId, scKey: cand.scKey, outcomes: { ASSESSED: 0, SKIP_CLOCK: 0, RECOVERING: 0, NOT_FIXABLE: 0, NO_MANAGED_DELAY: 0, BUDGET: 0 }, trials: 0, helped: 0 };
        rows.set(key, row);
      }
      row.outcomes[cand.outcome]++;
      row.trials += cand.trials.length;
      for (const tr of cand.trials) {
        if (tr.verdict === 'ACCEPTED' && tr.plan) { row.helped++; continue; }
        const m = tr.verdict === 'ACCEPTED' ? MOVED.exec(tr.move) : null;
        if (m && m[1] === undefined && m[2] === cand.scKey) row.helped++;
      }
    }
  }
  return [...rows.keys()].sort().map((k) => rows.get(k)!);
}

/** `--moves`: every accepted move in trace order, with the receiver it was made for and the receiver's projected PI. */
export interface WlmMoveRow {
  clockText: string;
  lparId: string;
  receiver: string;
  move: string;
  receiverPi: (number | null)[];
}

export function moveRows(traces: readonly WlmAdjustTrace[]): WlmMoveRow[] {
  const out: WlmMoveRow[] = [];
  for (const t of traces) {
    for (const cand of t.candidates) {
      for (const tr of cand.trials) {
        if (tr.verdict === 'ACCEPTED') out.push({ clockText: t.clockText, lparId: t.lparId, receiver: cand.scKey, move: tr.plan ? formatPlanMoves(tr.plan) : tr.move, receiverPi: [...(tr.receiverPi ?? [])] });
      }
    }
  }
  return out;
}

const sumCounters = (all: readonly WlmStatsCounters[]): WlmStatsCounters => {
  const total = emptyCounters();
  for (const c of all) {
    total.adjustments += c.adjustments;
    total.noCandidate += c.noCandidate;
    total.assessed += c.assessed;
    for (const k of Object.keys(total.notFixable) as (keyof WlmStatsCounters['notFixable'])[]) total.notFixable[k] += c.notFixable[k];
    total.budget += c.budget;
    total.recovering += c.recovering;
    total.skipClock += c.skipClock;
    total.noManagedDelay += c.noManagedDelay;
    total.waitingNoDelay += c.waitingNoDelay;
    total.waitingAssessed += c.waitingAssessed;
    total.waitingNotFixable += c.waitingNotFixable;
    total.waitingRecovering += c.waitingRecovering;
    total.clocksSet += c.clocksSet;
    total.trials += c.trials;
    total.projections += c.projections;
    total.acceptedPlans += c.acceptedPlans;
    total.acceptedSteps += c.acceptedSteps;
    total.acceptedCarry += c.acceptedCarry;
    for (const v of VERDICT_ORDER) total.verdicts[v] += c.verdicts[v];
    total.acceptedReceiverUp += c.acceptedReceiverUp;
    total.acceptedDonor += c.acceptedDonor;
    total.rejectedPiUnder09 += c.rejectedPiUnder09;
    total.rejectedPiNull += c.rejectedPiNull;
    total.reversed += c.reversed;
    total.reversedWithin2Min += c.reversedWithin2Min;
    total.reversedAfterHarm += c.reversedAfterHarm;
    total.episodes += c.episodes;
    total.noTrialStreaks += c.noTrialStreaks;
  }
  return total;
};

/** A trace's clock text (`D1 12:19:40` in the sim, `D1 Mon 12:19` from the play CLI) → day and clock time with its
 * seconds, so a range boundary can be applied exactly without a tick. */
const traceWhen = (text: string): { day: string; time: string } | null => {
  const m = /^(D\d+)(?:\s+\S+)?\s+(\d\d:\d\d)(?::(\d\d))?$/.exec(text.trim());
  return m ? { day: m[1]!, time: m[3] === undefined ? m[2]! : `${m[2]}:${m[3]}` } : null;
};

/** A tick as seconds since the run's first 06:00, and a trace's clock text the same way, so a range can be checked
 * exactly even when an advance crosses its end mid-hour. */
const tickKey = (tick: number) => Math.floor(tick / TICKS_PER_DAY) * 86400 + (tick % TICKS_PER_DAY) * TICK_SEC;

/** Seconds since the played day's 06:00, so a trace at 05:59 sorts after a 23:59 one of the same played day. */
const daySec = (time: string): number => {
  const [hh, mm, ss] = time.split(':').map(Number) as [number, number, number | undefined];
  return ((hh - 6 + 24) % 24) * 3600 + mm * 60 + (ss ?? 0);
};

/** Each played day's last adjustment at or before `time`, as a DP ladder (hex, highest first). */
function ladderLines(traces: readonly WlmAdjustTrace[], time: string): string[] {
  const target = daySec(time);
  const out: string[] = [];
  let day = '';
  let best: WlmAdjustTrace | null = null;
  const push = () => {
    if (!best) return;
    const rows = Object.entries(best.dps)
      .sort(([ka, a], [kb, b]) => b - a || (ka < kb ? -1 : 1))
      .map(([k, dp]) => `${k}=${hexDp(dp)}`);
    out.push(`${best.clockText}  ${rows.join(' ')}`);
  };
  for (const t of traces) {
    const when = traceWhen(t.clockText);
    if (!when) continue;
    if (when.day !== day) {
      push();
      day = when.day;
      best = null;
    }
    if (daySec(when.time) <= target) best = t;
  }
  push();
  return out;
}

/** Policy adjustment statistics over a trace list (WT-01). Pure: the audit's S-1 … S-3 counters, per system and total.
 * `ladderTraces` lets the ladder read a wider replay than the counted range (the CLI passes the whole first day). */
export function wlmStats(
  traces: readonly WlmAdjustTrace[],
  opts: { ladder?: string; ladderTraces?: readonly WlmAdjustTrace[]; byClass?: boolean; episodes?: boolean; streaks?: boolean; moves?: boolean } = {},
): WlmStats {
  const bySystem = new Map<string, WlmAdjustTrace[]>();
  for (const t of traces) {
    const list = bySystem.get(t.lparId);
    if (list) list.push(t);
    else bySystem.set(t.lparId, [t]);
  }
  const episodes: WlmEpisode[] = [];
  const streaks: WlmStreak[] = [];
  const systems = [...bySystem.keys()].sort().map((lparId) => ({ lparId, counters: countSystem(bySystem.get(lparId)!, episodes, streaks) }));
  let ladder: WlmStats['ladder'] = [];
  if (opts.ladder) {
    const ladderBySystem = new Map<string, WlmAdjustTrace[]>();
    for (const t of opts.ladderTraces ?? traces) {
      const list = ladderBySystem.get(t.lparId);
      if (list) list.push(t);
      else ladderBySystem.set(t.lparId, [t]);
    }
    ladder = systems.map((x) => ({ lparId: x.lparId, lines: ladderLines(ladderBySystem.get(x.lparId) ?? [], opts.ladder!) }));
  }
  return {
    total: sumCounters(systems.map((x) => x.counters)),
    systems,
    ladder,
    ladderTime: opts.ladder ?? null,
    ...(opts.byClass ? { byClass: classRows(traces) } : {}),
    ...(opts.episodes ? { episodes } : {}),
    ...(opts.streaks ? { streaks } : {}),
    ...(opts.moves ? { moves: moveRows(traces) } : {}),
  };
}

const piPath = (pi: readonly (number | null)[]) => pi.map((x) => (x === null ? '-' : x.toFixed(2))).join('→');
const verdictText = (v: Partial<Record<WlmTrialVerdict, number>>) =>
  VERDICT_ORDER.filter((k) => v[k]).map((k) => `${k} ${v[k]}`).join(', ') || 'no trials';
const CLASS_OUTCOMES: WlmCandidateTrace['outcome'][] = ['ASSESSED', 'SKIP_CLOCK', 'RECOVERING', 'NOT_FIXABLE', 'NO_MANAGED_DELAY', 'BUDGET'];

/** The optional `--by-class`, `--episodes`, `--streaks` and `--moves` sections, in that order. */
function detailLines(stats: WlmStats): string[] {
  const lines: string[] = [];
  if (stats.byClass) {
    const heads = ['assessed', 'clock', 'recover', 'notfix', 'nodelay', 'budget', 'trials', 'helped'];
    const width = Math.max(18, ...stats.byClass.map((r) => r.lparId.length + 1 + r.scKey.length));
    lines.push('', 'Candidates by period (outcome counts, trials, accepted moves raising it)', `${' '.repeat(width)}${heads.map((h) => h.padStart(9)).join('')}`);
    for (const r of stats.byClass) {
      const cells = [...CLASS_OUTCOMES.map((o) => r.outcomes[o]), r.trials, r.helped];
      lines.push(`${`${r.lparId} ${r.scKey}`.padEnd(width)}${cells.map((x) => n0(x).padStart(9)).join('')}`);
    }
  }
  if (stats.episodes) {
    lines.push('', 'Episodes (30 assessments without a receiver move; first → last assessment)');
    if (stats.episodes.length === 0) lines.push('  none');
    for (const e of stats.episodes) {
      lines.push(`  ${e.lparId} ${e.scKey}  ${e.first} → ${e.last}  ${e.assessments} assessments, ${e.end ? `ended by a move at ${e.end}` : 'still open at the end of the range'}`);
      lines.push(`    trials: ${verdictText(e.verdicts)}`);
    }
  }
  if (stats.streaks) {
    lines.push('', 'No-trial streaks (30+ consecutive checks with no trials; first → last check)');
    if (stats.streaks.length === 0) lines.push('  none');
    for (const k of stats.streaks)
      lines.push(`  ${k.lparId} ${k.scKey}  ${k.outcome} ${k.bottleneck ?? 'no bottleneck'}  ${k.first} → ${k.last}  ${k.checks} checks, ${k.end ? `ended at ${k.end}` : 'still open at the end of the range'}`);
  }
  if (stats.moves) {
    lines.push('', 'Accepted moves (receiver, move, receiver PI before → projected)');
    if (stats.moves.length === 0) lines.push('  none');
    for (const m of stats.moves) lines.push(`  ${m.clockText}  ${m.lparId}  for ${m.receiver}: ${m.move}  ${piPath(m.receiverPi)}`);
  }
  return lines;
}

const n0 = (n: number) => n.toLocaleString('en-US');

/** Render `wlmStats` as a table, one column per system plus the total, then the optional ladders. */
export function statsText(stats: WlmStats): string {
  const columns = [...stats.systems.map((s) => s.lparId), 'TOTAL'];
  const rows: [string, number[]][] = [
    ['adjustments', [...stats.systems.map((s) => s.counters.adjustments), stats.total.adjustments]],
    ['  no candidate (every goal met)', [...stats.systems.map((s) => s.counters.noCandidate), stats.total.noCandidate]],
    ['candidates assessed', [...stats.systems.map((s) => s.counters.assessed), stats.total.assessed]],
    ['    of which mostly waiting', [...stats.systems.map((s) => s.counters.waitingAssessed), stats.total.waitingAssessed]],
    ['  not assessed: I/O bottleneck', [...stats.systems.map((s) => s.counters.notFixable.IO), stats.total.notFixable.IO]],
    ['  not assessed: storage bottleneck', [...stats.systems.map((s) => s.counters.notFixable.STORAGE), stats.total.notFixable.STORAGE]],
    ['  not assessed: queue bottleneck', [...stats.systems.map((s) => s.counters.notFixable.QUEUE), stats.total.notFixable.QUEUE]],
    ['    of which mostly waiting', [...stats.systems.map((s) => s.counters.waitingNotFixable), stats.total.waitingNotFixable]],
    ['  not assessed: budget', [...stats.systems.map((s) => s.counters.budget), stats.total.budget]],
    ['  not assessed: already recovering (base ≤ 1)', [...stats.systems.map((s) => s.counters.recovering), stats.total.recovering]],
    ['    of which mostly waiting', [...stats.systems.map((s) => s.counters.waitingRecovering), stats.total.waitingRecovering]],
    ['  not assessed: skip clock running', [...stats.systems.map((s) => s.counters.skipClock), stats.total.skipClock]],
    ['  not assessed: no managed delay', [...stats.systems.map((s) => s.counters.noManagedDelay), stats.total.noManagedDelay]],
    ['    of which mostly waiting', [...stats.systems.map((s) => s.counters.waitingNoDelay), stats.total.waitingNoDelay]],
    ['skip clocks set (every trial rejected)', [...stats.systems.map((s) => s.counters.clocksSet), stats.total.clocksSet]],
    ['proposed steps (including free rejections)', [...stats.systems.map((s) => s.counters.trials), stats.total.trials]],
    ['projections', [...stats.systems.map((s) => s.counters.projections), stats.total.projections]],
    ['accepted plans', [...stats.systems.map((s) => s.counters.acceptedPlans), stats.total.acceptedPlans]],
    ['retained moves in accepted plans', [...stats.systems.map((s) => s.counters.acceptedSteps), stats.total.acceptedSteps]],
    ['accepted: carried receiver', [...stats.systems.map((s) => s.counters.acceptedCarry), stats.total.acceptedCarry]],
    ...VERDICT_ORDER.map((v): [string, number[]] => [
      `  ${v === 'ACCEPTED' ? 'accepted' : v === 'RETAINED' ? 'retained in tentative plan' : `rejected: ${v}`}`,
      [...stats.systems.map((s) => s.counters.verdicts[v]), stats.total.verdicts[v]],
    ]),
    ['accepted steps: receiver up', [...stats.systems.map((s) => s.counters.acceptedReceiverUp), stats.total.acceptedReceiverUp]],
    ['accepted: donor down', [...stats.systems.map((s) => s.counters.acceptedDonor), stats.total.acceptedDonor]],
    ['rejected, receiver before PI (base) ≤ 0.9', [...stats.systems.map((s) => s.counters.rejectedPiUnder09), stats.total.rejectedPiUnder09]],
    ['rejected, receiver before PI (base) null', [...stats.systems.map((s) => s.counters.rejectedPiNull), stats.total.rejectedPiNull]],
    ["moves reversed by the period's next move", [...stats.systems.map((s) => s.counters.reversed), stats.total.reversed]],
    ['  … within two minutes', [...stats.systems.map((s) => s.counters.reversedWithin2Min), stats.total.reversedWithin2Min]],
    ['  … within two minutes, after another plan pushed it past its goal', [...stats.systems.map((s) => s.counters.reversedAfterHarm), stats.total.reversedAfterHarm]],
    ['assessed on 30 adjustments without a move (episodes)', [...stats.systems.map((s) => s.counters.episodes), stats.total.episodes]],
    ['no-trial streaks of 30+ checks (notfix/recovering)', [...stats.systems.map((s) => s.counters.noTrialStreaks), stats.total.noTrialStreaks]],
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const cell = (x: number) => n0(x).padStart(8);
  const lines = [
    'WLM policy adjustment statistics (sim internals: investigations only)',
    `${' '.repeat(labelWidth)}${columns.map((c) => c.padStart(9)).join('')}`,
    ...rows.map(([label, values]) => `${label.padEnd(labelWidth)}${values.map(cell).join(' ')}`),
  ];
  if (stats.ladderTime !== null) {
    lines.push('', `DP ladder at ${stats.ladderTime} each played day (hex, highest first)`);
    for (const l of stats.ladder) lines.push(`${l.lparId}:`, ...(l.lines.length ? l.lines.map((x) => `  ${x}`) : ['  no adjustment up to that time']));
  }
  lines.push(...detailLines(stats));
  return lines.join('\n');
}

/** Replay a play file and collect every policy adjustment trace from `from` to `to` (exclusive). Returns the tick
 * reached: short of `to` when the log or a day ends first. */
export function replayTraces(file: PlayFile, from: number, to: number, sink: (t: WlmAdjustTrace) => void): number {
  const first = file.log[0];
  if (first?.cmd !== 'new') throw new Error('wlm-stats needs a play-CLI file (seed + command log); a browser save has no log to replay past hours');
  let f = newPlayFile(first.seed, first.difficulty, first.scenario);
  const same = (a: string, b: string) => a === b;
  if (f.run.scenarioId !== file.run.scenarioId || f.run.seed !== file.run.seed || !same(f.run.difficulty, file.run.difficulty)) {
    throw new Error(`the play log starts a different run (${f.run.scenarioId}/seed ${f.run.seed}/${f.run.difficulty}) than the saved state (${file.run.scenarioId}/seed ${file.run.seed}/${file.run.difficulty})`);
  }
  const step = (): boolean => {
    if (f.run.sim.tick >= to) return false;
    // Installed for the hour that overlaps the range: the caller filters traces by their own clock.
    if (f.run.sim.tick + TICKS_PER_HOUR > from) setWlmTraceSink(sink);
    const out = applyPlayCommand(f, { cmd: 'advance', hours: 1 });
    if (!out.ok) throw new Error(`replay failed advancing from ${clockText(f.run.sim.tick)}: ${out.text}`);
    f = out.file;
    // The CLI's multi-hour `advance` stops at the hour a job abends and at the end of a played day. Replaying the
    // same hours it did not run would invent a run that never happened (and mis-time the commands after it).
    return f.run.phase === 'LIVE';
  };
  try {
    for (const c of file.log.slice(1)) {
      if (f.run.sim.tick >= to) break;
      if (c.cmd === 'advance') {
        // A log whose next command is an advance while the day is not live cannot be replayed any further.
        if (f.run.phase !== 'LIVE') break;
        const hours = Math.max(1, Math.min(24, Math.floor(c.hours)));
        replayAdvance(hours, () => abendedSet(f.run), step);
      } else {
        const out = applyPlayCommand(f, c);
        if (!out.ok) throw new Error(`replay failed at ${JSON.stringify(c)}: ${out.text}`);
        f = out.file;
      }
    }
  } finally {
    setWlmTraceSink(null);
  }
  return f.run.sim.tick;
}

/** `inspect … wlm-stats`: the audit's policy adjustment counters over a play file's range (WT-01). */
export function wlmStatsText(
  text: string,
  opts: { system?: string; from?: string; to?: string; ladder?: string; json?: boolean; byClass?: boolean; episodes?: boolean; streaks?: boolean; moves?: boolean } = {},
): string {
  const file = decodePlayFile(text);
  const from = tickOfClock(opts.from ?? 'D1 06:00');
  const to = opts.to === undefined ? file.run.sim.tick : tickOfClock(opts.to);
  // Minutes only, like `tickOfClock`: a seconds field would be silently floored, and a mistyped bound must not fall
  // back to the file's end.
  const timeText = /^D\d+\s+(?:[A-Za-z]{3}\s+)?\d{1,2}:\d{2}$/;
  if (from === null || to === null || (opts.from !== undefined && !timeText.test(opts.from.trim())) || (opts.to !== undefined && !timeText.test(opts.to.trim())) ||
      (opts.ladder !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(opts.ladder)))
    throw new Error("times look like 'D1 06:00', and --ladder like '12:00'");
  if (to <= from) throw new Error('the end of the range must be after its start');
  const lo = tickKey(from), hi = tickKey(to);
  // The ladder is about each played day, so the replay starts at the 06:00 of the range's first day; the counters
  // still apply the exact range.
  const start = from - (from % TICKS_PER_DAY);
  const all: WlmAdjustTrace[] = [];
  const reached = replayTraces(file, start, to, (t) => {
    if (opts.system !== undefined && t.lparId !== opts.system) return;
    all.push(t);
  });
  const traces = all.filter((t) => {
    const when = traceWhen(t.clockText);
    if (!when) return true;
    const key = (Number(when.day.slice(1)) - 1) * 86400 + daySec(when.time);
    return key >= lo && key < hi;
  });
  if (traces.length === 0) return `No policy adjustment traced between ${clockText(from)} and ${clockText(Math.min(to, reached))}; ${reached < to ? `the play log ends at ${clockText(reached)}` : 'check the range and the system'}.`;
  const stats = wlmStats(traces, {
    ...(opts.ladder ? { ladder: opts.ladder, ladderTraces: all } : {}),
    ...(opts.byClass ? { byClass: true } : {}),
    ...(opts.episodes ? { episodes: true } : {}),
    ...(opts.streaks ? { streaks: true } : {}),
    ...(opts.moves ? { moves: true } : {}),
  });
  const systems = stats.systems.map((s) => s.lparId).join(' ');
  const note = `${clockText(from)} → ${clockText(reached)}, ${systems}${opts.system === undefined ? '' : ` (${opts.system} only)`}`;
  const short = reached < to ? `\nThe play log ends at ${clockText(reached)}; the range ${clockText(to)} is not covered.` : '';
  return opts.json
    ? JSON.stringify({ range: { from: clockText(from), to: clockText(reached), covered: reached >= to }, ...stats }, null, 2)
    : `${statsText(stats)}\n${note}${short}`;
}
