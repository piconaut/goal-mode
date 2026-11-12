// Investigation views of a run file that the game does not show the player (sim internals).
// For developers and the playtest companion checking a bug; player agents must not use it (docs/agents.md).
// Usage:
//   npm run inspect -- runs/a.json dp <system> [--class ONL] [--from 'D19 20:00'] [--to 'D20 06:00']
//     Dispatching priority (hex) per service class period at the end of each RMF interval, oldest first.
//   npm run inspect -- runs/a.json wlm <system> --at 'D19 22:00' [--ticks 6] [--class ONL]
//     Why WLM did or didn't move DPs: per policy adjustment (10 s), the receiver candidates in order, each trial
//     move and why it was accepted or rejected. A play-CLI run (seed + log) replays to any past time; a browser save
//     has no log, so it traces forward from the saved moment (live day only).
//   npm run inspect -- runs/a.json wlm-stats [system] [--from 'D1 06:00'] [--to 'D3 06:00'] [--ladder '12:00'] [--by-class] [--episodes] [--moves] [--json]
//     Policy adjustment statistics over a range of a play file (WT-01): adjustments, candidates by outcome, trials by
//     verdict, accepted moves, receivers assessed on 30 adjustments without a move, and the DP ladder at a clock
//     time. --by-class adds each period's outcomes, --episodes lists those 30-assessment runs, --moves lists every
//     accepted move. A whole-run replay costs about 6 s per played day, like `blame`.
//   npm run inspect -- runs/a.json blame [--json] [--incident N]
//     Counterfactual validator (RT-06): every online incident's opening hour is replayed once per card that affects
//     the hurt workload with that card ended at the hour start. Reports the game's trigger against the cards whose
//     removal met the SLA. Costs an hour of sim per card per incident, so it is offline only; needs a play-CLI file.

import { readFileSync } from 'node:fs';
import { applyPlayCommand, decodePlayFile, clockText, newPlayFile, type PlayFile } from './playCore';
import { formatClock, tickOfClock } from '../src/sim/core/clock';
import { TICK_SEC, TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/core/units';
import { packOf } from '../src/content/packs';
import { scenarioFor } from '../src/game/difficulty';
import { advance } from '../src/game/run';
import { blameIncident, summarizeBlame, type IncidentBlame } from '../src/game/counterfactual';
import { BATCH_INCIDENT } from '../src/game/sla';
import type { Incident, RunState } from '../src/game/types';
import { setWlmTraceSink, type WlmAdjustTrace, type WlmCandidateTrace, type WlmTrialVerdict } from '../src/sim/wlm/adjust';

process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
}

/** DP per scKey per RMF interval on one system: one line per interval, `CLASS#p=HEX` pairs. */
export function dpText(text: string, system: string, opts: { cls?: string; from?: string; to?: string } = {}): string {
  const run = decodePlayFile(text).run;
  const from = opts.from ? tickOfClock(opts.from) : null;
  const to = opts.to ? tickOfClock(opts.to) : null;
  if ((opts.from && from === null) || (opts.to && to === null)) throw new Error('times look like D19 20:00');
  const cls = opts.cls?.toUpperCase();
  const ivs = run.sim.rmf.intervals.filter((iv) => (from === null || iv.endTick > from) && (to === null || iv.startTick < to));
  const systems = [...new Set(run.sim.rmf.intervals.flatMap((iv) => iv.wlm.map((w) => w.lparId)))].filter((s) => s !== '*PLEX').sort();
  if (!systems.includes(system)) return `No system ${system}; one of ${systems.join(' ')}`;
  const lines = ivs.map((iv) => {
    const rows = iv.wlm
      .filter((w) => w.lparId === system && w.dp !== null && (!cls || w.scKey.toUpperCase().includes(cls)))
      .sort((a, b) => b.dp! - a.dp! || (a.scKey < b.scKey ? -1 : 1));
    return `${clockText(iv.endTick)}  ${rows.map((w) => `${w.scKey}=${w.dp!.toString(16).toUpperCase()}`).join(' ')}`;
  });
  return [`${system} dispatching priority at each RMF interval end (highest first; hex)`, ...(lines.length ? lines : ['no intervals in range'])].join('\n');
}

const hexDp = (n: number) => n.toString(16).toUpperCase();
const piText = (p: number | null | undefined) => (p == null ? '-' : p.toFixed(2));

const OUTCOME_TEXT: Record<WlmCandidateTrace['outcome'], string> = {
  SKIP_CLOCK: 'not assessed: skip clock running (every move was rejected at its last assessment)',
  NO_MANAGED_DELAY: 'not assessed: no managed delay (CPU, zIIP, I/O, storage, queue under 2 % of samples)',
  NOT_FIXABLE: 'not assessed: bottleneck is not CPU/zIIP',
  BUDGET: "not assessed: the interval's projection budget is spent (first in line next time)",
  RECOVERING: 'not assessed: projected PI at sustained demand is already ≤ 1 (recovering by itself)',
  ASSESSED: '',
};

const SHARE_KEYS = ['CPU', 'ZIIP', 'IO', 'CAP', 'OTHER'] as const;

/** The shares the bottleneck was chosen from: each delay over the period's using + delay. */
const shareText = (c: WlmCandidateTrace) =>
  SHARE_KEYS.map((k) => `${k} ${(100 * c.delayShares[k]).toFixed(0)}%`).join(' ');

function candidateLines(c: WlmCandidateTrace, n: number): string[] {
  const head = `  ${n}. ${c.scKey} imp ${c.importance} PI ${piText(c.sysplexPi)} (local ${piText(c.localPi)}) DP ${hexDp(c.dp)}${c.bottleneck ? ` BTLNK ${c.bottleneck}` : ''}`;
  const shares = [`       delay ${shareText(c)} of using + delay`];
  // To the second: a clock runs in 10-second intervals.
  const nextLook = c.skipUntilTick !== undefined ? `       next look ${clockText(c.skipUntilTick)}${formatClock(c.skipUntilTick).slice(-3)}` : null;
  if (c.outcome !== 'ASSESSED') return [head, ...shares, `       ${OUTCOME_TEXT[c.outcome]}`, ...(nextLook ? [nextLook] : [])];
  if (c.trials.length === 0) return [head, ...shares, '       no move to try (DP at the top and no donor at or above it)', ...(nextLook ? [`${nextLook} (skip clock set)`] : [])];
  return [
    head,
    ...shares,
    ...(c.donors?.length ? [`       donors in order: ${c.donors.join(' ')}`] : []),
    ...c.trials.map((t) => {
      const r = t.receiverPi ? `  rcvr PI ${piText(t.receiverPi[0])}→${piText(t.receiverPi[1])}` : '';
      return `       ${t.move.padEnd(30)} ${t.verdict}${r}${t.detail ? `  ${t.detail}` : ''}`;
    }),
    ...(c.planOutcome && c.planOutcome !== 'ACCEPTED' ? [`       plan ended: ${c.planOutcome}; no tentative moves committed`] : []),
    ...(nextLook ? [`${nextLook} (${c.planOutcome ? 'plan not committed' : 'all rejected'}: skip clock set)`] : []),
  ];
}

/** Render one policy adjustment; cls narrows the candidates shown (the action is always shown). */
export function traceText(t: WlmAdjustTrace, cls?: string): string[] {
  const shown = t.candidates.map((c, i) => [c, i + 1] as const).filter(([c]) => !cls || c.scKey.toUpperCase().includes(cls));
  const action = t.action ? t.action.slice(t.action.indexOf('RCVR=')) : 'no DP change';
  const prot = t.protection.length > 0 ? [`  CPU protection restored first: ${t.protection.join(', ')}`] : [];
  return [`${t.clockText} ${t.lparId}  → ${action}`, ...prot, ...(t.candidates.length === 0 ? ['  no candidate (every goal period meets its goal)'] : shown.flatMap(([c, n]) => candidateLines(c, n)))];
}

const scOf = (run: RunState) => scenarioFor(packOf(run.scenarioId).scenario, run.difficulty);

/** Run to `target` (replaying the play log when the file has one) and return that point's run state. */
function runTo(file: PlayFile, target: number): { run: RunState; mode: string } {
  const first = file.log[0];
  if (first?.cmd === 'new') {
    let f = newPlayFile(first.seed, first.difficulty, first.scenario);
    for (const c of file.log.slice(1)) {
      if (c.cmd === 'advance' && f.run.phase === 'LIVE' && f.run.sim.tick + Math.floor(c.hours) * TICKS_PER_HOUR > target) break;
      const out = applyPlayCommand(f, c);
      if (!out.ok) throw new Error(`replay failed at ${JSON.stringify(c)}: ${out.text}`);
      f = out.file;
      if (f.run.sim.tick > target) throw new Error(`${clockText(target)} is not inside a live day of this run`);
    }
    return { run: f.run, mode: 'replayed from seed + log' };
  }
  return { run: file.run, mode: 'forward from the saved moment (no log to replay)' };
}

/** Policy adjustment traces on one system from `at` for `ticks` ticks. */
export function wlmText(text: string, system: string, opts: { at: string; ticks?: number; cls?: string }): string {
  const file = decodePlayFile(text);
  const target = tickOfClock(opts.at);
  if (target === null) throw new Error('times look like D19 22:00');
  const ticks = Math.max(1, Math.min(360, opts.ticks ?? 6));
  const { run: start, mode } = runTo(file, target);
  if (start.phase !== 'LIVE') return `${clockText(start.sim.tick)} is not a live day (phase ${start.phase}); pick a time inside a played day.`;
  if (start.sim.tick > target) return `The save is at ${clockText(start.sim.tick)}; a save without a play log can only be traced forward from there.`;
  const content = packOf(start.scenarioId).game;
  let r = start;
  if (target > r.sim.tick) r = advance(r, scOf(r), content, target - r.sim.tick);
  const systems = r.sim.wlm.systems.map((s) => s.lparId);
  if (!systems.includes(system)) return `No system ${system}; one of ${systems.join(' ')}`;
  const traces: WlmAdjustTrace[] = [];
  setWlmTraceSink((t) => { if (t.lparId === system) traces.push(t); });
  try {
    r = advance(r, scOf(r), content, ticks);
  } finally {
    setWlmTraceSink(null);
  }
  const cls = opts.cls?.toUpperCase();
  const out: string[] = [`WLM policy adjustment on ${system}, ${mode}; candidates in assessment order (sim internals: investigations only)`];
  let last = '';
  for (const t of traces) {
    const lines = traceText(t, cls);
    const body = lines.slice(1).join('\n') + (t.action ?? '');
    if (body === last) out.push(`${lines[0]}  (candidates and verdicts as above)`);
    else out.push(...lines);
    last = body;
  }
  if (traces.length === 0) out.push(`no policy adjustment ran (the day ended at ${clockText(r.sim.tick)}?)`);
  return out.join('\n');
}

/** Per-system and total counts from a run's policy adjustment traces (WT-01); the audit's S-1 … S-3 table. */
export interface WlmStatsCounters {
  /** Policy adjustments in the range (one per system per tick). */
  adjustments: number;
  /** Adjustments where every goal period met its goal, so no candidate was assessed. */
  noCandidate: number;
  /** Candidates with an outcome of `ASSESSED` (trials were built for them). */
  assessed: number;
  /** `NOT_FIXABLE` candidates by the bottleneck they were skipped for. */
  notFixable: Record<'IO' | 'OTHER' | 'CAP' | 'NONE', number>;
  /** `SKIP_CLOCK` and `NO_MANAGED_DELAY` candidates (WT-05). */
  skipClock: number;
  noManagedDelay: number;
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
   * a turn every few minutes on a full image (docs/wlm-design.md §9.4 point 6). */
  reversedWithin2Min: number;
  /** Candidates whose projected PI at the current DPs (`base`) was already ≤ 1: no trials (WT-04). */
  recovering: number;
  /** Periods assessed on 30 adjustments without being the receiver of an accepted move (one per run). A donor move
   * on the period does not reset the run, and neither does an adjustment that skipped it: the count is of
   * assessments, in the order they happened. */
  episodes: number;
}

export interface WlmStats {
  total: WlmStatsCounters;
  systems: { lparId: string; counters: WlmStatsCounters }[];
  /** With `ladder`, each system's DP ladder (hex, highest first) at that clock time each played day. */
  ladder: { lparId: string; lines: string[] }[];
  ladderTime: string | null;
  /** With `byClass`, `episodes` or `moves` (the CLI's `--by-class`, `--episodes`, `--moves`). */
  byClass?: WlmClassRow[];
  episodes?: WlmEpisode[];
  moves?: WlmMoveRow[];
}

const emptyCounters = (): WlmStatsCounters => ({
  adjustments: 0, noCandidate: 0, assessed: 0, notFixable: { IO: 0, OTHER: 0, CAP: 0, NONE: 0 }, budget: 0, recovering: 0, skipClock: 0, noManagedDelay: 0, clocksSet: 0, trials: 0, projections: 0, acceptedPlans: 0, acceptedSteps: 0, acceptedCarry: 0,
  verdicts: { ACCEPTED: 0, RETAINED: 0, CPU_CRITICAL: 0, NO_RECEIVER_GAIN: 0, SMALL_GAIN: 0, MORE_IMPORTANT_HARMED: 0, EQUAL_DISPARITY: 0, NO_NET_VALUE: 0, PROJECTION_DISAGREES: 0 },
  acceptedReceiverUp: 0, acceptedDonor: 0, rejectedPiUnder09: 0, rejectedPiNull: 0, reversed: 0, reversedWithin2Min: 0, episodes: 0,
});

const VERDICT_ORDER: WlmTrialVerdict[] = ['ACCEPTED', 'RETAINED', 'CPU_CRITICAL', 'NO_RECEIVER_GAIN', 'SMALL_GAIN', 'MORE_IMPORTANT_HARMED', 'EQUAL_DISPARITY', 'NO_NET_VALUE', 'PROJECTION_DISAGREES'];

const notFixableKey = (b: WlmCandidateTrace['bottleneck']): keyof WlmStatsCounters['notFixable'] => {
  switch (b) {
    case 'IO':
    case 'CAP':
    case 'OTHER':
    case 'NONE':
      return b;
    case null:
      return 'NONE';
    // A CPU/zIIP bottleneck is assessable, so `policyAdjust` never records it as NOT_FIXABLE: if that changes, the
    // audit table needs a column for it rather than quietly folding it into "no bottleneck".
    case 'CPU':
    case 'ZIIP':
      throw new Error(`a ${b} bottleneck cannot be NOT_FIXABLE`);
    default: {
      const never: never = b;
      return never;
    }
  }
};

/** A trial's move text names the period and its new DP: `ONLHI#1 DP 20→21` or `DONOR X DP 20→1F`. */
const MOVED = /^(DONOR\s+)?(\S+)\s+DP\s+([0-9A-F]+)→([0-9A-F]+)$/;

/** One episode (`--episodes`): a period's run of assessments without being the receiver of an accepted move, once
 * it reached 30. `end` is the clock of the receiver move that ended it, or null when the range ended first. */
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

/** Count one system's adjustments in trace order: totals, and the two cross-adjustment patterns (reversals, runs).
 * `episodes`, when given, receives each episode the counter counts, in the order they end. */
function countSystem(traces: readonly WlmAdjustTrace[], episodes?: WlmEpisode[]): WlmStatsCounters {
  const c = emptyCounters();
  const lastDirection = new Map<string, { dir: 1 | -1; at: number }>();
  let at = -1;
  const runs = new Map<string, { n: number; counted: boolean; first: string; last: string; verdicts: Partial<Record<WlmTrialVerdict, number>> }>();
  const close = (period: string, end: string | null) => {
    const run = runs.get(period);
    if (run?.counted && episodes) episodes.push({ lparId: traces[0]!.lparId, scKey: period, first: run.first, last: run.last, assessments: run.n, verdicts: run.verdicts, end });
    runs.delete(period);
  };
  for (const t of traces) {
    c.adjustments++;
    at++;
    if (t.candidates.length === 0) c.noCandidate++;
    const assessed = new Set<string>();
    const moved = new Map<string, 1 | -1>();
    const receiverMoved = new Set<string>();
    for (const cand of t.candidates) {
      if (cand.outcome === 'NOT_FIXABLE') c.notFixable[notFixableKey(cand.bottleneck)]++;
      else if (cand.outcome === 'BUDGET') c.budget++;
      else if (cand.outcome === 'RECOVERING') c.recovering++;
      else if (cand.outcome === 'SKIP_CLOCK') c.skipClock++;
      else if (cand.outcome === 'NO_MANAGED_DELAY') c.noManagedDelay++;
      else {
        c.assessed++;
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
        if (at - was.at <= 12) c.reversedWithin2Min++;
      }
      lastDirection.set(period, { dir, at });
    }
    // A receiver move ends its own run; a donor move does not, and neither does an adjustment that skipped the period.
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
  return c;
}

/** `--by-class`: each period's candidate outcomes, trials and accepted receiver moves over the range, per system. */
export interface WlmClassRow {
  lparId: string;
  scKey: string;
  outcomes: Record<WlmCandidateTrace['outcome'], number>;
  trials: number;
  /** Accepted moves with this period as the receiver raised. */
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
        if (tr.verdict === 'ACCEPTED') out.push({ clockText: t.clockText, lparId: t.lparId, receiver: cand.scKey, move: tr.move, receiverPi: [...(tr.receiverPi ?? [])] });
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
    total.episodes += c.episodes;
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
  opts: { ladder?: string; ladderTraces?: readonly WlmAdjustTrace[]; byClass?: boolean; episodes?: boolean; moves?: boolean } = {},
): WlmStats {
  const bySystem = new Map<string, WlmAdjustTrace[]>();
  for (const t of traces) {
    const list = bySystem.get(t.lparId);
    if (list) list.push(t);
    else bySystem.set(t.lparId, [t]);
  }
  const episodes: WlmEpisode[] = [];
  const systems = [...bySystem.keys()].sort().map((lparId) => ({ lparId, counters: countSystem(bySystem.get(lparId)!, episodes) }));
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
    ...(opts.moves ? { moves: moveRows(traces) } : {}),
  };
}

const piPath = (pi: readonly (number | null)[]) => pi.map((x) => (x === null ? '-' : x.toFixed(2))).join('→');
const verdictText = (v: Partial<Record<WlmTrialVerdict, number>>) =>
  VERDICT_ORDER.filter((k) => v[k]).map((k) => `${k} ${v[k]}`).join(', ') || 'no trials';
const CLASS_OUTCOMES: WlmCandidateTrace['outcome'][] = ['ASSESSED', 'SKIP_CLOCK', 'RECOVERING', 'NOT_FIXABLE', 'NO_MANAGED_DELAY', 'BUDGET'];

/** The optional `--by-class`, `--episodes` and `--moves` sections, in that order. */
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
    ['  not assessed: I/O bottleneck', [...stats.systems.map((s) => s.counters.notFixable.IO), stats.total.notFixable.IO]],
    ['  not assessed: other bottleneck', [...stats.systems.map((s) => s.counters.notFixable.OTHER), stats.total.notFixable.OTHER]],
    ['  not assessed: capping bottleneck', [...stats.systems.map((s) => s.counters.notFixable.CAP), stats.total.notFixable.CAP]],
    ['  not assessed: no bottleneck', [...stats.systems.map((s) => s.counters.notFixable.NONE), stats.total.notFixable.NONE]],
    ['  not assessed: budget', [...stats.systems.map((s) => s.counters.budget), stats.total.budget]],
    ['  not assessed: already recovering (base ≤ 1)', [...stats.systems.map((s) => s.counters.recovering), stats.total.recovering]],
    ['  not assessed: skip clock running', [...stats.systems.map((s) => s.counters.skipClock), stats.total.skipClock]],
    ['  not assessed: no managed delay', [...stats.systems.map((s) => s.counters.noManagedDelay), stats.total.noManagedDelay]],
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
    ['accepted: receiver up', [...stats.systems.map((s) => s.counters.acceptedReceiverUp), stats.total.acceptedReceiverUp]],
    ['accepted: donor down', [...stats.systems.map((s) => s.counters.acceptedDonor), stats.total.acceptedDonor]],
    ['rejected, receiver before PI (base) ≤ 0.9', [...stats.systems.map((s) => s.counters.rejectedPiUnder09), stats.total.rejectedPiUnder09]],
    ['rejected, receiver before PI (base) null', [...stats.systems.map((s) => s.counters.rejectedPiNull), stats.total.rejectedPiNull]],
    ["moves reversed by the period's next move", [...stats.systems.map((s) => s.counters.reversed), stats.total.reversed]],
    ['  … within two minutes', [...stats.systems.map((s) => s.counters.reversedWithin2Min), stats.total.reversedWithin2Min]],
    ['assessed on 30 adjustments without a move (episodes)', [...stats.systems.map((s) => s.counters.episodes), stats.total.episodes]],
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

/** The play CLI's `advance` stops after the hour in which a job abends that was not abended when the advance began
 * (and at the end of a played day); the commands after that point in the log were issued there, so a faithful replay
 * stops too. `before` is the set at the start of the logged advance, not of the hour: a restart that clears an abend
 * mid-advance does not stop the CLI, and neither does a re-abend of a job that was abended at the start. */
export const stoppedEarly = (before: ReadonlySet<string>, after: ReadonlySet<string>): boolean =>
  [...after].some((name) => !before.has(name));

/** Replay one logged `advance` of `hours` an hour at a time, stopping where the play CLI did (`stoppedEarly` against
 * the abended set at the start of the advance). `hour` runs one hour and returns false when the replay must stop for
 * its own reasons (end of range, day over); it may return false before running anything. Returns the number of `hour`
 * calls, which counts such a call too. */
export function replayAdvance(hours: number, abended: () => ReadonlySet<string>, hour: () => boolean): number {
  const before = abended();
  let ran = 0;
  while (ran < hours) {
    ran++;
    if (!hour() || stoppedEarly(before, abended())) break;
  }
  return ran;
}

/** Replay a play file and collect every policy adjustment trace from `from` to `to` (exclusive). Returns the tick
 * reached: short of `to` when the log or a day ends first. */
export function replayTraces(file: PlayFile, from: number, to: number, sink: (t: WlmAdjustTrace) => void): number {
  const first = file.log[0];
  if (first?.cmd !== 'new') throw new Error('wlm-stats needs a play-CLI file (seed + command log); a browser save has no log to replay past hours');
  let f = newPlayFile(first.seed, first.difficulty, first.scenario);
  const same = (a: string | undefined, b: string | undefined) => (a ?? 'NORMAL') === (b ?? 'NORMAL');
  if (f.run.scenarioId !== file.run.scenarioId || f.run.seed !== file.run.seed || !same(f.run.difficulty, file.run.difficulty)) {
    throw new Error(`the play log starts a different run (${f.run.scenarioId}/seed ${f.run.seed}/${f.run.difficulty ?? 'NORMAL'}) than the saved state (${file.run.scenarioId}/seed ${file.run.seed}/${file.run.difficulty ?? 'NORMAL'})`);
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
        replayAdvance(hours, () => abendedNames(f.run), step);
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
  opts: { system?: string; from?: string; to?: string; ladder?: string; json?: boolean; byClass?: boolean; episodes?: boolean; moves?: boolean } = {},
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
    ...(opts.moves ? { moves: true } : {}),
  });
  const systems = stats.systems.map((s) => s.lparId).join(' ');
  const note = `${clockText(from)} → ${clockText(reached)}, ${systems}${opts.system === undefined ? '' : ` (${opts.system} only)`}`;
  const short = reached < to ? `\nThe play log ends at ${clockText(reached)}; the range ${clockText(to)} is not covered.` : '';
  return opts.json
    ? JSON.stringify({ range: { from: clockText(from), to: clockText(reached), covered: reached >= to }, ...stats }, null, 2)
    : `${statsText(stats)}\n${note}${short}`;
}

const scOfRun = (run: RunState) => scenarioFor(packOf(run.scenarioId).scenario, run.difficulty);

/** Names of the jobs abended at this moment, to see where the play CLI's `advance` stopped. */
const abendedNames = (run: RunState) => new Set(run.sim.batch.jobs.filter((j) => j.status === 'ABENDED').map((j) => `${j.day}:${j.def.name}`));

/** Replay a play log once, calling `at` at each wanted incident hour start (nothing is kept between calls). */
function walkToIncidents(file: PlayFile, incidents: readonly Incident[], at: (run: RunState, here: readonly Incident[]) => void): void {
  const first = file.log[0];
  if (first?.cmd !== 'new') return;
  const byTick = new Map<number, Incident[]>();
  for (const i of incidents) byTick.set(i.startTick, [...(byTick.get(i.startTick) ?? []), i]);
  const last = Math.max(...byTick.keys());
  let f = newPlayFile(first.seed, first.difficulty, first.scenario);
  const same = (a: string | undefined, b: string | undefined) => (a ?? 'NORMAL') === (b ?? 'NORMAL');
  if (f.run.scenarioId !== file.run.scenarioId || f.run.seed !== file.run.seed || !same(f.run.difficulty, file.run.difficulty)) {
    throw new Error(`the play log starts a different run (${f.run.scenarioId}/seed ${f.run.seed}/${f.run.difficulty ?? 'NORMAL'}) than the saved state (${file.run.scenarioId}/seed ${file.run.seed}/${file.run.difficulty ?? 'NORMAL'})`);
  }
  /** One hour through the play CLI's own advance, so the Monitor III history a later `pin … --at` reads is recorded. */
  const stepHour = () => {
    const out = applyPlayCommand(f, { cmd: 'advance', hours: 1 });
    if (!out.ok) throw new Error(`replay failed advancing from ${clockText(f.run.sim.tick)}: ${out.text}`);
    f = out.file;
  };
  // An incident's hour start is the state after every command issued at that tick: a command in the log at the hour
  // boundary (a WLM activation, a pin, a note) is part of the hour, so the snapshot waits for the next advance.
  let pending = false;
  const snapshot = () => {
    const here = byTick.get(f.run.sim.tick);
    if (here && f.run.phase === 'LIVE') at(f.run, here);
  };
  const flush = () => {
    if (!pending) return;
    pending = false;
    snapshot();
  };
  const mark = () => {
    if (byTick.has(f.run.sim.tick)) pending = true;
  };
  mark();
  for (const c of file.log.slice(1)) {
    if (f.run.sim.tick > last) break;
    if (c.cmd === 'advance') {
      const hours = Math.max(1, Math.min(24, Math.floor(c.hours)));
      // One hour at a time, so each incident hour start is a state we can branch from. The CLI stops an advance at
      // the hour a job newly abends; the commands after it in the log were issued there, so this must stop too.
      replayAdvance(hours, () => abendedNames(f.run), () => {
        if (f.run.phase !== 'LIVE') return false;
        flush();
        stepHour();
        mark();
        return f.run.sim.tick <= last && f.run.phase === 'LIVE';
      });
    } else {
      const out = applyPlayCommand(f, c);
      if (!out.ok) throw new Error(`replay failed at ${JSON.stringify(c)}: ${out.text}`);
      f = out.file;
      mark();
    }
  }
  flush();
}

const pctText = (x: number | null) => (x === null ? '-' : `${x.toFixed(1)}%`);

/** Counterfactual validator over every online incident of a play file (RT-06). */
export function blameText(text: string, opts: { json?: boolean; incident?: number } = {}): string {
  const file = decodePlayFile(text);
  const batch = file.run.incidents.filter((i) => i.workloadId === BATCH_INCIDENT).length;
  const online = file.run.incidents.filter((i) => i.workloadId !== BATCH_INCIDENT && (opts.incident === undefined || i.id === opts.incident));
  if (file.log[0]?.cmd !== 'new') throw new Error('blame needs a play-CLI file (seed + command log); a browser save has no log to replay past hours');
  if (opts.incident !== undefined && online.length === 0) throw new Error(`No online incident ${opts.incident} in this run (batch nights are out of scope)`);
  const results: IncidentBlame[] = [];
  const failed: { id: number; message: string }[] = [];
  walkToIncidents(file, online, (run, here) => {
    for (const inc of here) {
      try {
        results.push(blameIncident(run, scOfRun(run), packOf(run.scenarioId).game, inc));
      } catch (e) {
        failed.push({ id: inc.id, message: (e as Error).message });
      }
    }
  });
  results.sort((a, b) => a.startTick - b.startTick || a.id - b.id);
  const reached = new Set(results.map((r) => r.id));
  const failedIds = new Set(failed.map((f) => f.id));
  const notReached = online.filter((i) => !reached.has(i.id) && !failedIds.has(i.id)).map((i) => i.id);
  const summary = summarizeBlame(results);
  if (opts.json) return JSON.stringify({ summary, batchSkipped: batch, notReached, failed, incidents: results }, null, 2);
  const lines: string[] = [
    `Counterfactual blame: each incident's opening hour replayed with one card ended at the hour start (one hour of sim per card per incident).`,
    `${summary.incidents} online incident${summary.incidents === 1 ? '' : 's'}` +
      (batch > 0 ? `, ${batch} batch night${batch === 1 ? '' : 's'} skipped` : '') +
      (notReached.length > 0 ? `, ${notReached.length} outside the replayed log` : '') +
      (failed.length > 0 ? `, ${failed.length} failed${failed[0] ? ` (${failed[0].message})` : ''}` : ''),
    `${summary.reproduced} reproduced the miss; ${summary.testable} had a card to test; ${summary.withCause} had a counterfactual cause.`,
    `${summary.agree} agree with the game's trigger, ${summary.disagree} disagree` +
      (summary.noCause > 0 ? `; ${summary.noCause} testable with no cause` : '') +
      (summary.noCandidates > 0 ? `; ${summary.noCandidates} with no card on the workload` : '') +
      (summary.notReproduced > 0 ? `; ${summary.notReproduced} not reproduced` : '') + '.',
  ];
  for (const r of results) {
    lines.push('');
    lines.push(`${clockText(r.startTick)}  ${r.workloadId} (incident ${r.id})  game: ${r.truth.mechanism}/${r.truth.trigger}` +
      (r.baseline.attainmentPct !== null ? `, hour ${pctText(r.baseline.attainmentPct)}` : ''));
    lines.push(r.blamed ? `  the game blames ${r.blamed.name} [${r.blamed.uid}] (${r.blamed.trigger})` : `  the game blames no card (${r.truth.trigger})`);
    for (const t of r.tested) {
      const mark = t.met ? '  <- cause' : '';
      lines.push(`  test ${t.card.name} [${t.card.uid}] (${t.card.trigger}): removed → ${t.met ? 'met' : 'missed'} ${pctText(t.attainmentPct)}${mark}`);
    }
    if (r.tested.length === 0) lines.push('  no card affected the workload in this hour');
    if (!r.reproduced) lines.push('  NOT REPRODUCED: the unchanged replay met the SLA, so no verdict');
    else if (r.tested.length > 0) {
      if (r.agrees) lines.push(r.blamed ? `  AGREE: ${r.blamed.name} is a counterfactual cause` : '  AGREE: no card is a counterfactual cause');
      else if (r.causes.length === 0) lines.push(`  DISAGREE: the game blames ${r.blamed?.name ?? 'no card'}, and no card's removal met the SLA`);
      else if (!r.blamed) lines.push(`  DISAGREE: the game blames no card, but ${r.causes.map((c) => c.name).join(', ')} would have met the SLA`);
      else lines.push(`  DISAGREE: the game blames ${r.blamed.name}, but ${r.causes.map((c) => c.name).join(', ')} would have met the SLA`);
    }
  }
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('inspect.ts')) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const rest = args.filter((a) => a !== '--json');
  const cls = opt(rest, '--class'), from = opt(rest, '--from'), to = opt(rest, '--to'), at = opt(rest, '--at'), ticks = opt(rest, '--ticks');
  const incident = opt(rest, '--incident');
  const [path, verb, system] = rest;
  if (path && verb === 'blame') {
    try {
      console.log(blameText(readFileSync(path, 'utf8'), { json, ...(incident ? { incident: Number(incident) } : {}) }));
    } catch (e) {
      console.error(`blame: ${(e as Error).message}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (path && verb === 'wlm-stats') {
    const ladder = opt(rest, '--ladder');
    const flag = (name: string) => (rest.includes(name) ? true : undefined);
    const details = { byClass: flag('--by-class'), episodes: flag('--episodes'), moves: flag('--moves') };
    const sys = system?.startsWith('--') ? undefined : system;
    try {
      console.log(wlmStatsText(readFileSync(path, 'utf8'), { ...(sys ? { system: sys } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(ladder ? { ladder } : {}), json,
        ...Object.fromEntries(Object.entries(details).filter(([, v]) => v)) }));
    } catch (e) {
      console.error(`wlm-stats: ${(e as Error).message}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (path && verb === 'wlm' && system && at) {
    console.log(wlmText(readFileSync(path, 'utf8'), system, { at, ...(ticks ? { ticks: Number(ticks) } : {}), ...(cls ? { cls } : {}) }));
    process.exit(0);
  }
  if (!path || verb !== 'dp' || !system) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
    process.exit(1);
  }
  console.log(dpText(readFileSync(path, 'utf8'), system, { ...(cls ? { cls } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }));
}
