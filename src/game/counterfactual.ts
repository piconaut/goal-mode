// Offline counterfactual validator (RT-06, revised by RT-25; docs/rca-design.md §4.8): because the sim is
// deterministic, an incident's opening SLA hour can be replayed from a kept state with one card ended at the hour
// start. RT-06 tested only the cards whose `affects` names the hurt workload and judged a card by whether the SLA
// would then have been met. RT-25 ends every card active in the hour (so it can see a card hurting work it never
// declared) and judges by the hour's attainment gain against a noise floor measured from red-herring cards, whether
// or not the SLA would then have been met (so a joint cause still counts).
//
// Developer tooling only: an hour of sim per card per incident is far too slow for the worker, and the output is
// hidden truth. Never imported by the game. One card is removed at a time, so two cards that only breach together
// look like bystanders to the old verdict; the attainment gain is what makes each of them count.

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
  /** The card declares no affected work, so it is a red herring by design: a control for the noise floor. */
  control: boolean;
  startTick: number;
  endTick: number | null;
}

export interface CardTest {
  card: CardRef;
  /** The RT-06 verdict: the workload's SLA was met with this card ended at the hour start. */
  met: boolean;
  /** The hour's SLA attainment with this card ended (null = not measurable: no work in the hour). */
  attainmentPct: number | null;
  /** That attainment less the as-run hour's, in percentage points (null = not measurable). */
  gainPct: number | null;
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
  /** Every card active in the hour, tested one at a time. */
  tested: CardTest[];
  /** Tested cards whose removal met the SLA (the RT-06 verdict, kept so the two can be compared). */
  causes: CardRef[];
  /** True when the replay reproduces the miss (a branch result means nothing otherwise). */
  reproduced: boolean;
  /** The RT-06 verdict: the card the game blames is a counterfactual cause (or it blames no card and none is). */
  agrees: boolean;
}

/** An incident judged on attainment gain against the sample's noise floor (RT-25). */
export interface JudgedBlame extends IncidentBlame {
  /** Cards whose attainment gain cleared the noise floor, whether or not the SLA would then have been met. */
  causesGain: CardRef[];
  /** The card the game blames is one of them (or the game blames no card and none cleared the floor). */
  agreesGain: boolean;
}

/**
 * The noise floor: the largest attainment swing a red-herring card produced in the sample. A card that by design
 * hurts nothing (CP_SPARING, or any card with no declared `affects`) still moves the hour a little through the
 * replay and WLM paths, and a gain must beat that to count as a cause.
 */
export interface NoiseFloor {
  scenario: string;
  /** How many control cards the sample held. Fewer than 10 is a weak estimate: the tool says so. */
  controls: number;
  /** The largest control gain in percentage points; null when the sample had no control to measure. */
  floorPct: number | null;
}

/** A red herring by design: the card names no hurt work, so it cannot be the cause of an SLA miss. */
const isControl = (e: ActiveEvent) => e.defId === 'CP_SPARING' || e.affects.length === 0;

const ref = (e: ActiveEvent): CardRef => ({
  uid: e.uid,
  defId: e.defId,
  name: e.name,
  trigger: e.trigger,
  ...(e.mechanisms ? { mechanisms: [...e.mechanisms] } : {}),
  control: isControl(e),
  startTick: e.startTick,
  endTick: e.endTick,
});

/**
 * Every card active in the hour that starts at `startTick`, from the opening and the closing state (a cap's scope
 * changes within the hour, and a card drawn for the day may start inside it). They are tested one at a time, whatever
 * work they declare: RT-25's point is finding a card that hurts work it does not name.
 */
export function cardsActiveInHour(opening: readonly ActiveEvent[], closing: readonly ActiveEvent[], startTick: number): ActiveEvent[] {
  const endTick = startTick + TICKS_PER_HOUR;
  const overlaps = (e: ActiveEvent) => e.startTick < endTick && (e.endTick === null || e.endTick > startTick);
  const seen = new Set<string>();
  const out: ActiveEvent[] = [];
  // The opening state first: it is the one the branch is taken from.
  for (const e of [...opening, ...closing]) {
    if (!overlaps(e) || seen.has(e.uid)) continue;
    seen.add(e.uid);
    out.push(e);
  }
  return out.sort((a, b) => a.startTick - b.startTick || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
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
  // No work in the hour is no SLA to miss (a card whose end removes the workload): then the gain is unknown, and a
  // baseline that loses the workload is reported as not reproduced (its attainment is unknown, not "met").
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
 * Replay one incident's opening hour once unchanged and once per card active in it, ended at the hour start.
 * `run` must be the state at `incident.startTick` (the tool replays the play log to that point).
 */
export function blameIncident(run: RunState, scenario: Scenario, content: GameContent, incident: Incident): IncidentBlame {
  if (incident.workloadId === BATCH_INCIDENT) throw new Error('batch incidents replay a night, not an hour');
  if (run.sim.tick !== incident.startTick) throw new Error(`Run is at tick ${run.sim.tick}, incident starts at ${incident.startTick}`);
  const baselineRun = replayHour(run, scenario, content, incident, null);
  const baseline = hourResult(baselineRun, scenario, incident);
  // Candidates from the opening and closing state, so a cap's expanded scope and a card starting inside the hour
  // are both in; branches from the opening state.
  const candidates = cardsActiveInHour(run.events, baselineRun.events, incident.startTick);
  const blamedEvent = blamedCard(baselineRun.events, incident.workloadId, incident.truth.mechanism, Math.floor(incident.startTick / TICKS_PER_HOUR));
  const tested: CardTest[] = candidates.map((e) => {
    const out = hourResult(replayHour(run, scenario, content, incident, e), scenario, incident);
    const gainPct = out.attainmentPct !== null && baseline.attainmentPct !== null ? out.attainmentPct - baseline.attainmentPct : null;
    return { card: ref(e), met: out.met, attainmentPct: out.attainmentPct, gainPct };
  });
  const causes = tested.filter((t) => t.met).map((t) => t.card);
  const blamed = blamedEvent ? ref(blamedEvent) : null;
  const reproduced = baseline.attainmentPct !== null && !baseline.met;
  const agrees = reproduced && (blamed ? causes.some((c) => c.uid === blamed.uid) : causes.length === 0);
  return { id: incident.id, workloadId: incident.workloadId, day: incident.day, startTick: incident.startTick, truth: incident.truth, blamed, baseline, tested, causes, reproduced, agrees };
}

/** Measure the noise floor from the control cards the sample tested. */
export function noiseFloor(scenario: string, results: readonly IncidentBlame[]): NoiseFloor {
  const gains = results
    .flatMap((r) => r.tested)
    .filter((t) => t.card.control && t.gainPct !== null)
    .map((t) => t.gainPct as number);
  return { scenario, controls: gains.length, floorPct: gains.length > 0 ? Math.max(...gains) : null };
}

/**
 * Judge every incident's cards by attainment gain. A card is a cause when its gain clears the floor, whether or not
 * the SLA would then have been met; the game's card agrees when it is one of them. With no control to measure, the
 * floor is 0 and the tool says the sample had none.
 */
export function judgeGains(results: readonly IncidentBlame[], floor: NoiseFloor): JudgedBlame[] {
  const floorPct = floor.floorPct ?? 0;
  return results.map((r) => {
    // A control is a red herring by design: it is the yardstick, never a cause (and it is in the floor's sample).
    const gainCause = (t: IncidentBlame['tested'][number]) => !t.card.control && t.gainPct !== null && t.gainPct > floorPct;
    const causesGain = r.reproduced ? r.tested.filter(gainCause).map((t) => t.card) : [];
    const agreesGain = r.reproduced && (r.blamed ? causesGain.some((c) => c.uid === r.blamed!.uid) : causesGain.length === 0);
    return { ...r, causesGain, agreesGain };
  });
}

export interface BlameSummary {
  /** Online incidents in the run (batch nights are out of scope). */
  incidents: number;
  /** Incidents whose opening hour the replay reproduced as a miss. */
  reproduced: number;
  /** Incidents with at least one card to test. */
  testable: number;
  /** Incidents where at least one card's removal met the SLA (RT-06). */
  withCause: number;
  agree: number;
  disagree: number;
  /** Reproduced and testable but with no counterfactual cause (no card would have met the SLA). */
  noCause: number;
  noCandidates: number;
  notReproduced: number;
  /** Cards tested across the sample (RT-25 tests every card active in an incident hour). */
  cardsTested: number;
  /** Incidents where at least one card's attainment gain cleared the noise floor (RT-25). */
  withGainCause: number;
  agreeGain: number;
  disagreeGain: number;
}

export function summarizeBlame(results: readonly (IncidentBlame | JudgedBlame)[]): BlameSummary {
  const reproduced = results.filter((r) => r.reproduced);
  const testable = reproduced.filter((r) => r.tested.length > 0);
  const judged = results.filter((r): r is JudgedBlame => 'causesGain' in r && 'agreesGain' in r);
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
    cardsTested: results.reduce((n, r) => n + r.tested.length, 0),
    withGainCause: judged.filter((r) => r.reproduced && r.tested.length > 0 && r.causesGain.length > 0).length,
    agreeGain: judged.filter((r) => r.reproduced && r.tested.length > 0 && r.agreesGain).length,
    disagreeGain: judged.filter((r) => r.reproduced && r.tested.length > 0 && !r.agreesGain).length,
  };
}
