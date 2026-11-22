import { abendedSet, applyPlayCommand, decodePlayFile, clockText, newPlayFile, type PlayFile } from '../playCore';
import { packOf } from '../../src/content/packs';
import { scenarioFor } from '../../src/game/difficulty';
import { blameIncident, judgeGains, noiseFloor, summarizeBlame, type IncidentBlame } from '../../src/game/counterfactual';
import { BATCH_INCIDENT } from '../../src/game/sla';
import type { Incident, RunState } from '../../src/game/types';
import { replayAdvance } from './shared';

const scOfRun = (run: RunState) => scenarioFor(packOf(run.scenarioId).scenario, run.difficulty);

/** Replay a play log once, calling `at` at each wanted incident hour start (nothing is kept between calls). */
function walkToIncidents(file: PlayFile, incidents: readonly Incident[], at: (run: RunState, here: readonly Incident[]) => void): void {
  const first = file.log[0];
  if (first?.cmd !== 'new') return;
  const byTick = new Map<number, Incident[]>();
  for (const i of incidents) byTick.set(i.startTick, [...(byTick.get(i.startTick) ?? []), i]);
  const last = Math.max(...byTick.keys());
  let f = newPlayFile(first.seed, first.difficulty, first.scenario);
  const same = (a: string, b: string) => a === b;
  if (f.run.scenarioId !== file.run.scenarioId || f.run.seed !== file.run.seed || !same(f.run.difficulty, file.run.difficulty)) {
    throw new Error(`the play log starts a different run (${f.run.scenarioId}/seed ${f.run.seed}/${f.run.difficulty}) than the saved state (${file.run.scenarioId}/seed ${file.run.seed}/${file.run.difficulty})`);
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
      replayAdvance(hours, () => abendedSet(f.run), () => {
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

/** Counterfactual validator over every online incident of a play file (RT-06, RT-25).
 * `floorPct` passes a scenario's measured noise floor (from a wider seed sample) in percentage points; without it
 * the floor is measured from this file's own control cards. */
export function blameText(text: string, opts: { json?: boolean; incident?: number; floorPct?: number } = {}): string {
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
  // The floor comes from the sample's controls, so it is measured before the incidents are judged by it. A caller
  // that measured it on a wider seed sample passes it in (RT-14 records one floor per scenario).
  const measured = noiseFloor(file.run.scenarioId, results);
  const floor = opts.floorPct === undefined ? measured : { ...measured, floorPct: opts.floorPct };
  const judged = judgeGains(results, floor);
  const summary = summarizeBlame(judged);
  if (opts.json) return JSON.stringify({ summary, noiseFloor: floor, batchSkipped: batch, notReached, failed, incidents: judged }, null, 2);
  const floorText = opts.floorPct !== undefined
    ? `scenario ${floor.scenario}: noise floor ${floor.floorPct!.toFixed(1)} pp passed in (measured on a wider seed sample); this file's own controls: ${measured.controls}`
    : floor.floorPct === null
      ? `scenario ${floor.scenario}: no control card (a card with no footprint) in the sample, so the noise floor is 0 and the gains are uncalibrated`
      : `scenario ${floor.scenario}: noise floor ${floor.floorPct.toFixed(1)} pp from ${floor.controls} control card${floor.controls === 1 ? '' : 's'} (cards with no footprint)` +
        (floor.controls < 10 ? '; fewer than 10 controls, so add seeds until there are' : '');
  const lines: string[] = [
    `Counterfactual blame: every card active in each incident's opening hour is ended at the hour start, one at a time (one hour of sim per card per incident).`,
    floorText,
    `${summary.incidents} online incident${summary.incidents === 1 ? '' : 's'}` +
      (batch > 0 ? `, ${batch} batch night${batch === 1 ? '' : 's'} skipped` : '') +
      (notReached.length > 0 ? `, ${notReached.length} outside the replayed log` : '') +
      (failed.length > 0 ? `, ${failed.length} failed${failed[0] ? ` (${failed[0].message})` : ''}` : ''),
    `${summary.reproduced} reproduced the miss; ${summary.cardsTested} card${summary.cardsTested === 1 ? '' : 's'} tested; ${summary.withCause} had a card whose removal met the SLA (RT-06), ${summary.withGainCause} had a card whose gain cleared the floor (RT-25).`,
    `RT-06: ${summary.agree} agree with the game's trigger, ${summary.disagree} disagree` +
      (summary.noCause > 0 ? `; ${summary.noCause} testable with no cause` : '') +
      (summary.noCandidates > 0 ? `; ${summary.noCandidates} with no card on the workload` : '') +
      (summary.notReproduced > 0 ? `; ${summary.notReproduced} not reproduced` : '') + '.',
    `RT-25: ${summary.agreeGain} agree, ${summary.disagreeGain} disagree.`,
  ];
  for (const r of judged) {
    lines.push('');
    lines.push(`${clockText(r.startTick)}  ${r.workloadId} (incident ${r.id})  game: ${r.truth.mechanism}/${r.truth.trigger}` +
      (r.baseline.attainmentPct !== null ? `, hour ${pctText(r.baseline.attainmentPct)}` : ''));
    lines.push(r.blamed ? `  the game blames ${r.blamed.name} [${r.blamed.uid}] (${r.blamed.trigger})` : `  the game blames no card (${r.truth.trigger})`);
    for (const t of r.tested) {
      const gain = t.gainPct === null ? 'gain unknown' : `gain ${t.gainPct >= 0 ? '+' : ''}${t.gainPct.toFixed(1)} pp`;
      const marks = [t.met ? 'RT-06 cause' : '', !t.card.control && t.gainPct !== null && t.gainPct > (floor.floorPct ?? 0) ? 'gain cause' : ''].filter(Boolean);
      lines.push(`  test ${t.card.name} [${t.card.uid}] (${t.card.trigger}, ${t.card.control ? 'no footprint' : t.footprint ?? 'outside its footprint'}): ended → ${t.met ? 'met' : 'missed'} ${pctText(t.attainmentPct)}, ${gain}${marks.length ? `  <- ${marks.join(', ')}` : ''}${t.card.control ? '  (control)' : ''}`);
    }
    if (r.tested.length === 0) lines.push('  no card was active in this hour');
    if (!r.reproduced) lines.push('  NOT REPRODUCED: the unchanged replay met the SLA, so no verdict');
    else if (r.tested.length > 0) {
      if (r.agrees) lines.push(r.blamed ? `  AGREE: ${r.blamed.name} is a counterfactual cause` : '  AGREE: no card is a counterfactual cause');
      else if (r.causes.length === 0) lines.push(`  DISAGREE: the game blames ${r.blamed?.name ?? 'no card'}, and no card's removal met the SLA`);
      else if (!r.blamed) lines.push(`  DISAGREE: the game blames no card, but ${r.causes.map((c) => c.name).join(', ')} would have met the SLA`);
      else lines.push(`  DISAGREE: the game blames ${r.blamed.name}, but ${r.causes.map((c) => c.name).join(', ')} would have met the SLA`);
      if (r.agreesGain) lines.push(r.blamed ? `  gain: AGREE: ${r.blamed.name} is a cause by attainment gain` : `  gain: AGREE: no card's gain cleared the floor`);
      else if (r.causesGain.length === 0) lines.push(`  gain: DISAGREE: the game blames ${r.blamed?.name ?? 'no card'}, and no card's gain cleared the floor`);
      else if (!r.blamed) lines.push(`  gain: DISAGREE: the game blames no card, but ${r.causesGain.map((c) => c.name).join(', ')} cleared the floor`);
      else lines.push(`  gain: DISAGREE: the game blames ${r.blamed.name}, but ${r.causesGain.map((c) => c.name).join(', ')} cleared the floor`);
    }
  }
  return lines.join('\n');
}
