import { applyPlayCommand, decodePlayFile, clockText, newPlayFile, type PlayFile } from '../playCore';
import { replayDayTrace, traceCovers } from '../../src/game/dayTrace';
import { formatClock, tickOfClock } from '../../src/sim/core/clock';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import { packOf } from '../../src/content/packs';
import { scenarioFor } from '../../src/game/difficulty';
import { advance } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { setWlmTraceSink, type WlmAdjustTrace, type WlmCandidateTrace } from '../../src/sim/wlm/adjust';
import { hexDp } from './shared';

const piText = (p: number | null | undefined) => (p == null ? '-' : p.toFixed(2));

const OUTCOME_TEXT: Record<WlmCandidateTrace['outcome'], string> = {
  SKIP_CLOCK: 'not assessed: skip clock running (every move was rejected at its last assessment)',
  NO_MANAGED_DELAY: 'not assessed: no managed delay (CPU, zIIP, I/O, storage, queue under 2 % of samples)',
  NOT_FIXABLE: 'not assessed: CPU and zIIP delay each under 15 % of the managed delay (BTLNK is the largest)',
  BUDGET: "not assessed: the interval's projection budget is spent (first in line next time)",
  RECOVERING: 'not assessed: projected PI at sustained demand is already ≤ 1 (recovering by itself)',
  ASSESSED: '',
};

const SHARE_KEYS = ['CPU', 'ZIIP', 'IO', 'STORAGE', 'QUEUE', 'CAP', 'OTHER'] as const;

/** The period's delay shares: each delay over its using + delay (OTHER, the waits, is outside both). */
const shareText = (c: WlmCandidateTrace) =>
  SHARE_KEYS.map((k) => `${k} ${(100 * c.delayShares[k]).toFixed(0)}%`).join(' ');

function candidateLines(c: WlmCandidateTrace, n: number): string[] {
  const head = `  ${n}. ${c.scKey}${c.holder ? ` (regions ${c.holder})` : ''} imp ${c.importance} PI ${piText(c.sysplexPi)} (local ${piText(c.localPi)}) DP ${hexDp(c.dp)}${c.bottleneck ? ` BTLNK ${c.bottleneck}` : ''}`;
  const waiting = c.waitingFrac !== undefined && c.waitingFrac > 0.5 ? [`       mostly waiting: waits are ${(100 * c.waitingFrac).toFixed(0)}% of all samples`] : [];
  const shares = [`       delay ${shareText(c)} of using + delay`, ...waiting];
  // To the second: a clock runs in 10-second intervals.
  const nextLook = c.skipUntilTick !== undefined ? `       next look ${clockText(c.skipUntilTick)}${formatClock(c.skipUntilTick).slice(-3)}` : null;
  if (c.outcome !== 'ASSESSED') return [head, ...shares, `       ${OUTCOME_TEXT[c.outcome]}`, ...(nextLook ? [nextLook] : [])];
  if (c.trials.length === 0) return [head, ...shares, '       no move to try (DP at the top and no donor at or above it)', ...(nextLook ? [`${nextLook} (skip clock set)`] : [])];
  return [
    head,
    ...shares,
    ...(c.plans && c.plans.length > 1
      ? [`       plans: ${c.plans.map((p) => `${p.bottleneck} ${p.outcome}${p.donors.length ? ` (donors ${p.donors.join(' ')})` : ''}`).join(', then ')}`]
      : c.donors?.length ? [`       donors in order: ${c.donors.join(' ')}`] : []),
    ...c.trials.map((t) => {
      const r = t.receiverPi ? `  rcvr PI ${piText(t.receiverPi[0])}→${piText(t.receiverPi[1])}` : '';
      return `       ${t.bottleneck ? `${t.bottleneck.padEnd(4)} ` : ''}${t.move.padEnd(30)} ${t.verdict}${r}${t.detail ? `  ${t.detail}` : ''}`;
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

/** Run to `target` (replaying the play log when the file has one, the browser's day trace when it carries
 *  one, and otherwise forward from the saved moment) and return that point's run state. */
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
  // A browser save's day trace (PT-17): a time earlier than the saved moment replays from the day's 06:00 start.
  // Later times are exact from the saved state already, so they keep tracing forward from it.
  if (file.dayTrace && target < file.run.sim.tick && traceCovers(file.dayTrace, file.run.seed, target)) {
    return { run: replayDayTrace(file.dayTrace, target).run, mode: 'replayed from the live day start (browser day trace)' };
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
  if (start.sim.tick > target) {
    // Only reachable without a covering trace: with one, runTo replayed to the target already.
    const t = file.dayTrace;
    return t
      ? `${clockText(target)} is outside the day this save traces (${clockText(t.start.sim.tick)} to ${clockText(t.start.sim.tick + TICKS_PER_DAY)}); only its current day replays, and earlier days need a play-CLI file.`
      : `The save is at ${clockText(start.sim.tick)}; a save without a play log can only be traced forward from there.`;
  }
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
