// Offline counterfactual validator (RT-06, docs/rca-design.md §4.8): because the sim is deterministic, an incident's
// opening SLA hour can be replayed from a kept state with one card ended at the hour start. A card whose removal
// turns the miss into a met SLA is a cause; the game's trigger names a card only if it is one of them.
//
// Developer tooling only: an hour of sim per card per incident is far too slow for the worker, and the output is
// hidden truth. Never imported by the game. One card is removed at a time, so two cards that only breach together
// look like bystanders: the validator keeps footprints honest, it is not an oracle for joint causes.

import { TICKS_PER_HOUR } from '../sim/core/units';
import type { Scenario } from '../sim/core/scenario';
import type { GameContent } from './run/shared';
import { advance } from './run';
import { BATCH_INCIDENT, blamedCard, hourAttainment } from './sla';
import { allWorkloads } from './workloads';
import type { ActiveEvent, Incident, Mechanism, RunState, Trigger } from './types';

/** One card as the validator names it (the uid distinguishes repeats of a card in a run). */
export interface CardRef {
  uid: string;
  defId: string;
  name: string;
  trigger: Trigger;
  /** What the card declares it causes (absent = any mechanism: pre-RT-02 saves). */
  mechanisms?: Mechanism[];
  startTick: number;
  endTick: number | null;
}

export interface CardTest {
  card: CardRef;
  /** True when the workload's SLA was met with this card ended at the hour start. */
  met: boolean;
  attainmentPct: number | null;
}

export interface IncidentBlame {
  id: number;
  workloadId: string;
  day: number;
  startTick: number;
  truth: Incident['truth'];
  /** The card the game's trigger names, by the same choice `triggerOf` makes at close (null = a fallback trigger). */
  blamed: CardRef | null;
  /** The hour replayed unchanged: the incident's opening hour, re-derived. */
  baseline: { met: boolean; attainmentPct: number | null };
  /** Every card that affects the hurt workload and overlaps the hour, tested one at a time. */
  tested: CardTest[];
  /** Tested cards whose removal met the SLA. */
  causes: CardRef[];
  /** True when the replay reproduces the miss (a branch result means nothing otherwise). */
  reproduced: boolean;
  /** The card the game blames is a counterfactual cause (or it blames no card and none is causal). */
  agrees: boolean;
}

const ref = (e: ActiveEvent): CardRef => ({
  uid: e.uid,
  defId: e.defId,
  name: e.name,
  trigger: e.trigger,
  ...(e.mechanisms ? { mechanisms: [...e.mechanisms] } : {}),
  startTick: e.startTick,
  endTick: e.endTick,
});

/** A card whose `begin` puts the workload live: its `affects` names the old work, not the workload it adds. */
function addsWorkload(e: ActiveEvent, content: GameContent, workloadId: string): boolean {
  const def = content.events.find((d) => d.id === e.defId);
  return def?.begin.some((c) => c.kind === 'ADD_WORKLOAD' && c.workload.id === workloadId) ?? false;
}

/**
 * The cards to test: any that affected the workload during the hour. `endEvents` is the hour's closing state — a
 * running power cap's scope is the union seen in the hour, so work routed onto the capped CPC mid-hour counts — and
 * `startEvents` supplies the state the branch starts from.
 */
export function counterfactualCandidates(
  startEvents: readonly ActiveEvent[],
  endEvents: readonly ActiveEvent[],
  workloadId: string,
  startTick: number,
  content: GameContent,
): ActiveEvent[] {
  const endTick = startTick + TICKS_PER_HOUR;
  const uids = new Set(
    endEvents
      .filter((e) => e.startTick < endTick && (e.endTick === null || e.endTick > startTick))
      .filter((e) => e.affects.includes(workloadId) || addsWorkload(e, content, workloadId))
      .map((e) => e.uid),
  );
  return startEvents.filter((e) => uids.has(e.uid));
}

/** The card did not exist for this hour: one that already ran is ended at the first tick, one that starts inside
 * the hour is marked run and ended so it never applies its begin commands (ending it at the hour start would let it
 * take hold for one tick). */
export const endedAtHourStart = (e: ActiveEvent, startTick: number): ActiveEvent =>
  e.startTick >= startTick ? { ...e, started: true, ended: true, endTick: startTick } : { ...e, endTick: startTick, ended: false };

/** The workload's SLA in the hour that ended at `run.sim.tick` (the last closed hour of the branch). */
function hourResult(run: RunState, scenario: Scenario, incident: Incident): { met: boolean; attainmentPct: number | null } {
  const w = allWorkloads(scenario, run).find((x) => x.id === incident.workloadId);
  const wh = run.smfHours.at(-1)?.workloads[incident.workloadId];
  const att = w && wh ? hourAttainment(w, wh) : null;
  // No work in the hour is no SLA to miss (a card whose end removes the workload): then no cause, and a baseline
  // that loses the workload is reported as not reproduced (its attainment is unknown, not "met").
  return att ? { met: att.met, attainmentPct: att.attainmentPct } : { met: true, attainmentPct: null };
}

function replayHour(
  run: RunState,
  scenario: Scenario,
  content: GameContent,
  incident: Incident,
  end: ActiveEvent | null,
): RunState {
  const start = structuredClone(run);
  const state = end === null ? start : { ...start, events: start.events.map((e) => (e.uid === end.uid ? endedAtHourStart(e, incident.startTick) : e)) };
  return advance(state, scenario, content, TICKS_PER_HOUR);
}

/**
 * Replay one incident's opening hour once unchanged and once per qualifying card ended at the hour start.
 * `run` must be the state at `incident.startTick` (the tool replays the play log to that point).
 */
export function blameIncident(run: RunState, scenario: Scenario, content: GameContent, incident: Incident): IncidentBlame {
  if (incident.workloadId === BATCH_INCIDENT) throw new Error('batch incidents replay a night, not an hour');
  if (run.sim.tick !== incident.startTick) throw new Error(`Run is at tick ${run.sim.tick}, incident starts at ${incident.startTick}`);
  const baselineRun = replayHour(run, scenario, content, incident, null);
  const baseline = hourResult(baselineRun, scenario, incident);
  // Candidates from the closing state, so a cap's expanded scope is included; branches from the opening state.
  const candidates = counterfactualCandidates(run.events, baselineRun.events, incident.workloadId, incident.startTick, content);
  const blamedEvent = blamedCard(baselineRun.events, incident.workloadId, incident.truth.mechanism, Math.floor(incident.startTick / TICKS_PER_HOUR));
  const tested: CardTest[] = candidates.map((e) => {
    const out = hourResult(replayHour(run, scenario, content, incident, e), scenario, incident);
    return { card: ref(e), met: out.met, attainmentPct: out.attainmentPct };
  });
  const causes = tested.filter((t) => t.met).map((t) => t.card);
  const blamed = blamedEvent ? ref(blamedEvent) : null;
  const reproduced = baseline.attainmentPct !== null && !baseline.met;
  const agrees = reproduced && (blamed ? causes.some((c) => c.uid === blamed.uid) : causes.length === 0);
  return { id: incident.id, workloadId: incident.workloadId, day: incident.day, startTick: incident.startTick, truth: incident.truth, blamed, baseline, tested, causes, reproduced, agrees };
}

export interface BlameSummary {
  /** Online incidents in the run (batch nights are out of scope). */
  incidents: number;
  /** Incidents whose opening hour the replay reproduced as a miss. */
  reproduced: number;
  /** Incidents with at least one qualifying card to test. */
  testable: number;
  /** Incidents where at least one card's removal met the SLA. */
  withCause: number;
  agree: number;
  disagree: number;
  /** Reproduced and testable but with no counterfactual cause (no card would have met the SLA). */
  noCause: number;
  noCandidates: number;
  notReproduced: number;
}

export function summarizeBlame(results: readonly IncidentBlame[]): BlameSummary {
  const reproduced = results.filter((r) => r.reproduced);
  const testable = reproduced.filter((r) => r.tested.length > 0);
  return {
    incidents: results.length,
    reproduced: reproduced.length,
    testable: testable.length,
    withCause: testable.filter((r) => r.causes.length > 0).length,
    agree: testable.filter((r) => r.agrees).length,
    disagree: testable.filter((r) => !r.agrees).length,
    noCause: testable.filter((r) => r.causes.length === 0).length,
    noCandidates: reproduced.filter((r) => r.tested.length === 0).length,
    notReproduced: results.length - reproduced.length,
  };
}
