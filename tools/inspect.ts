// Investigation views of a run file that the game does not show the player (sim internals).
// For developers and the playtest companion checking a bug; player agents must not use it (docs/agents.md).
// Usage:
//   npm run inspect -- runs/a.json dp <system> [--class ONL] [--from 'D19 20:00'] [--to 'D20 06:00']
//     Dispatching priority (hex) per service class period at the end of each RMF interval, oldest first.
//   npm run inspect -- runs/a.json wlm <system> --at 'D19 22:00' [--ticks 6] [--class ONL]
//     Why WLM did or didn't move DPs: per policy adjustment (10 s), the receiver candidates in order, each trial
//     move and why it was accepted or rejected. A play-CLI run (seed + log) replays to any past time; a browser save
//     has no log, so it traces forward from the saved moment (live day only).
//   npm run inspect -- runs/a.json blame [--json] [--incident N]
//     Counterfactual validator (RT-06): every online incident's opening hour is replayed once per card that affects
//     the hurt workload with that card ended at the hour start. Reports the game's trigger against the cards whose
//     removal met the SLA. Costs an hour of sim per card per incident, so it is offline only; needs a play-CLI file.

import { readFileSync } from 'node:fs';
import { applyPlayCommand, decodePlayFile, clockText, newPlayFile, type PlayFile } from './playCore';
import { tickOfClock } from '../src/sim/core/clock';
import { TICKS_PER_HOUR } from '../src/sim/core/units';
import { packOf } from '../src/content/packs';
import { scenarioFor } from '../src/game/difficulty';
import { advance } from '../src/game/run';
import { blameIncident, summarizeBlame, type IncidentBlame } from '../src/game/counterfactual';
import { BATCH_INCIDENT } from '../src/game/sla';
import type { Incident, RunState } from '../src/game/types';
import { setWlmTraceSink, type WlmAdjustTrace, type WlmCandidateTrace } from '../src/sim/wlm/adjust';

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
  NOT_FIXABLE: 'not assessed: bottleneck is not CPU/zIIP',
  BUDGET: 'not assessed: two receivers already assessed at this importance',
  ASSESSED: '',
};

const SHARE_KEYS = ['CPU', 'ZIIP', 'IO', 'CAP', 'OTHER'] as const;

/** The shares the bottleneck was chosen from: each delay over the period's using + delay. */
const shareText = (c: WlmCandidateTrace) =>
  SHARE_KEYS.map((k) => `${k} ${(100 * c.delayShares[k]).toFixed(0)}%`).join(' ');

function candidateLines(c: WlmCandidateTrace, n: number): string[] {
  const head = `  ${n}. ${c.scKey} imp ${c.importance} PI ${piText(c.sysplexPi)} (local ${piText(c.localPi)}) DP ${hexDp(c.dp)}${c.bottleneck ? ` BTLNK ${c.bottleneck}` : ''}`;
  const shares = [`       delay ${shareText(c)} of using + delay`];
  if (c.outcome !== 'ASSESSED') return [head, ...shares, `       ${OUTCOME_TEXT[c.outcome]}`];
  if (c.trials.length === 0) return [head, ...shares, '       no move to try (DP at the top and no donor at or above it)'];
  return [
    head,
    ...shares,
    ...(c.donors?.length ? [`       donors in order: ${c.donors.join(' ')}`] : []),
    ...c.trials.map((t) => {
      const r = t.receiverPi ? `  rcvr PI ${piText(t.receiverPi[0])}→${piText(t.receiverPi[1])}` : '';
      return `       ${t.move.padEnd(30)} ${t.verdict}${r}${t.detail ? `  ${t.detail}` : ''}`;
    }),
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
  const content = packOf(f.run.scenarioId).game;
  /** One hour, without the play CLI's view-building (the state is identical; the MON3 history is not needed). */
  const stepHour = () => {
    f = { ...f, run: advance(f.run, scOfRun(f.run), content, TICKS_PER_HOUR) };
  };
  const grab = () => {
    const here = byTick.get(f.run.sim.tick);
    if (here && f.run.phase === 'LIVE') at(f.run, here);
  };
  grab();
  for (const c of file.log.slice(1)) {
    if (f.run.sim.tick > last) break;
    if (c.cmd === 'advance') {
      const hours = Math.max(1, Math.min(24, Math.floor(c.hours)));
      const before = abendedNames(f.run);
      // One hour at a time, so each incident hour start is a state we can branch from. The CLI stops an advance at
      // the hour a job newly abends; the commands after it in the log were issued there, so this must stop too.
      for (let h = 0; h < hours && f.run.phase === 'LIVE'; h++) {
        stepHour();
        grab();
        if (f.run.sim.tick > last || f.run.phase !== 'LIVE') break;
        const after = abendedNames(f.run);
        if (after.size !== before.size || [...after].some((x) => !before.has(x))) break;
      }
    } else {
      const out = applyPlayCommand(f, c);
      if (!out.ok) throw new Error(`replay failed at ${JSON.stringify(c)}: ${out.text}`);
      f = out.file;
      grab();
    }
  }
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
  const failed: number[] = [];
  walkToIncidents(file, online, (run, here) => {
    for (const inc of here) {
      try {
        results.push(blameIncident(run, scOfRun(run), packOf(run.scenarioId).game, inc));
      } catch {
        failed.push(inc.id);
      }
    }
  });
  results.sort((a, b) => a.startTick - b.startTick || a.id - b.id);
  const reached = new Set(results.map((r) => r.id));
  const notReached = online.filter((i) => !reached.has(i.id) && !failed.includes(i.id)).map((i) => i.id);
  const summary = summarizeBlame(results);
  if (opts.json) return JSON.stringify({ summary, batchSkipped: batch, notReached, failed, incidents: results }, null, 2);
  const lines: string[] = [
    `Counterfactual blame: each incident's opening hour replayed with one card ended at the hour start (one hour of sim per card per incident).`,
    `${summary.incidents} online incident${summary.incidents === 1 ? '' : 's'}` +
      (batch > 0 ? `, ${batch} batch night${batch === 1 ? '' : 's'} skipped` : '') +
      (notReached.length > 0 ? `, ${notReached.length} outside the replayed log` : '') +
      (failed.length > 0 ? `, ${failed.length} failed` : ''),
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
  const [path, verb, system] = rest;
  const incident = opt(rest, '--incident');
  if (path && verb === 'blame') {
    try {
      console.log(blameText(readFileSync(path, 'utf8'), { json, ...(incident ? { incident: Number(incident) } : {}) }));
    } catch (e) {
      console.error(`blame: ${(e as Error).message}`);
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
