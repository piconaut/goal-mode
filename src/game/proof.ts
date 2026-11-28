// Proof recipes (RT-13, docs/rca-design.md §4.6): the attached pins prove a claim when they satisfy both predicates
// of its recipe in content/evidence.ts. The mechanism's complete recipe replaces the old relevance sum; the trigger's
// makes the evidence strong. Pure; judged against the incident's recorded subjects like the per-pin verdicts.

import { EVIDENCE_METRICS, MECHANISM_RECIPES, PROOF, TRIGGER_RECIPES, type EvidenceMetric, type PinRelation, type PredicateOption, type ProofRecipe } from '../content/evidence';
import { triggerLabel } from '../content/rca';
import type { Scenario } from '../sim/core/scenario';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { classify } from '../sim/wlm/classify';
import { incidentWindow, notableFloor, pinRelation, smfHourEndTick, fmtValue, type EvidencePin, type PinVerdict } from './evidence';
import { displaceable } from './displaceable';
import type { CapacityBasis, Incident, IncidentSubjects, Mechanism, RunState, Trigger } from './types';
import { subsystemClasses } from './wlmEdit';

interface PredicateCheck {
  label: string;
  met: boolean;
  /** The attached pins that satisfy it. */
  pinIds: number[];
  /** When it fails, the largest reading among the related pins that fail it, so the reply can say what the pin showed (RT-30). */
  failedReading?: { pinId: number; metric: EvidenceMetric; value: number };
}

export interface RecipeCheck {
  claim: Mechanism | Trigger;
  complete: boolean;
  predicates: PredicateCheck[];
  /** Whether the truth accepts the claim: set when the RCA is scored (a bare `judgeProof` result has not been). */
  accepted?: boolean;
  /** Why a proven claim earns nothing (RT-35's peer rule below the response share), shown beside the verdict. */
  why?: string;
}

export interface ProofResult {
  mechanism: RecipeCheck;
  trigger: RecipeCheck;
}

/** The pinned image's online general CPs, so an APPL% share can be read as a share of the image. */
function imageCps(run: RunState, lparId: string, pool: 'CP' | 'ZIIP' = 'CP'): number {
  const l = run.sim.config.lpars.find((x) => x.id === lparId);
  return l?.pools.filter((p) => p.pool === pool).reduce((a, p) => a + p.logical, 0) ?? 0;
}

/** New work's rows: a Workload Activity row, or a workload's Db2 101/CICS 110 row, that first appeared within the day
 * before the pin, after the report had held a full day without it. A day, because work with a daily shape (the batch
 * night, a morning peak) first appears hours into the report and is not new. Read from the rows themselves, not from
 * the pin's baseline: an ended rate's slot baseline is absent all through day 1 for every row. Day 1 cannot show new
 * work this way. */
function withoutHistory(run: RunState, p: EvidencePin): boolean {
  const fresh = (reportStart: number, firstSeen: number | undefined) =>
    firstSeen !== undefined && firstSeen - reportStart >= TICKS_PER_DAY && p.tick - firstSeen < TICKS_PER_DAY;
  if (p.source === 'WLMGL') {
    const ivs = run.sim.rmf.intervals;
    if (!ivs.some((iv) => iv.endTick === p.tick)) return false;
    const first = ivs.find((iv) => iv.endTick <= p.tick && iv.wlm.some((w) => w.lparId === p.system && w.scKey === p.subject));
    return ivs.length > 0 && fresh(ivs[0]!.startTick, first?.endTick);
  }
  if (p.source === 'Db2 101' || p.source === 'CICS 110') {
    const hours = run.smfHours.map((h, i) => ({ h, end: smfHourEndTick(run, i) })).filter((x) => x.end <= p.tick);
    const first = hours.find((x) => (x.h.workloads[p.subject]?.completions ?? 0) > 0);
    return hours.length > 0 && fresh(hours[0]!.end - TICKS_PER_HOUR, first?.end);
  }
  return false;
}

/** What an option reads beyond the pin itself. */
interface ProofContext {
  run: RunState;
  /** The policy's batch classes: those a JES rule assigns (BATCH_OVERLAP's "batch running then"). APPROX: read from
   * the definition active at review time, not the one in force when the row was written. */
  batch: Set<string>;
  /** Exclusions recorded when the incident opened. */
  subjects: IncidentSubjects;
  pool: 'CP' | 'ZIIP';
  scenario: Scenario;
}

/** Does this pin, in this relation, satisfy this predicate option? */
function optionHolds(ctx: ProofContext, p: EvidencePin, relation: PinRelation | null, o: PredicateOption): boolean {
  const { run } = ctx;
  if (p.metric !== o.metric || relation === null || !o.relations.includes(relation)) return false;
  if (o.batchClass && !ctx.batch.has(p.subject.split('#')[0]!)) return false;
  if (o.displaceable) {
    // A job row (PROCU's EAppl per jobname) by its job; any class row, Monitor III's PROCU class rows included, by its
    // period.
    const pool = p.metric === 'APPL_IIP' ? 'ZIIP' : 'CP';
    if (pool !== ctx.pool) return false;
    const ratio = displaceable(ctx.subjects, p.system, pool, { name: p.subject, job: p.metric === 'JOB_APPL' });
    if (ratio === null) {
      // Old incidents cannot reconstruct workload/role grants. Conservatively exclude own and server classes;
      // never infer exclusions from today's importance or attainment.
      const space = [...ctx.scenario.addressSpaces, ...run.sim.extraAddressSpaces]
        .find((a) => a.lparId === p.system && a.jobname === p.subject);
      const cls = p.metric === 'JOB_APPL'
        ? p.serviceClass ?? (space ? classify(run.sim.wlm.definition, { subsystem: space.subsystem, TN: space.jobname, SY: p.system }).serviceClass : undefined)
        : p.subject.split('#')[0]!;
      if (!cls) return false;
      if (['SYSTEM', 'SYSSTC'].includes(cls) || ctx.subjects.classes.includes(cls) || ctx.subjects.servers.some((s) => s.jobname === p.subject)) return false;
    } else {
      if (ratio <= 0) return false;
      // Only the eligible part of a mixed class is evidence. Use the same observed pool denominator as truth.
      if (o.test.kind === 'shareOfImage') {
        const engines = ctx.subjects.cpu?.[p.system]?.[pool].engines ?? 0;
        const row = ctx.subjects.cpu?.[p.system]?.CP.classes[p.subject];
        const ziip = ctx.subjects.cpu?.[p.system]?.ZIIP.classes[p.subject]?.used ?? 0;
        const cpFraction = p.metric === 'APPL' && p.source === 'WLMGL' && row ? row.used / Math.max(1e-9, row.used + ziip) : 1;
        return engines > 0 && p.value * cpFraction * ratio >= o.test.frac * 100 * engines;
      }
    }
  }
  const reading = o.reading === 'rate' ? p.rate : { value: p.value, baseline: p.baseline };
  if (!reading) return false;
  const { value, baseline } = reading;
  const t = o.test;
  switch (t.kind) {
    case 'atLeast':
      return value >= t.value;
    case 'below':
      return value < t.value;
    case 'notable': {
      const floor = notableFloor(o.metric, baseline);
      // A line of 0 would count any reading: the metric needs a row multiple and a baseline to be notable.
      return floor > 0 && value >= floor;
    }
    case 'ratioAtLeast':
      return baseline !== undefined && baseline > 0 && value >= t.ratio * baseline;
    case 'normal':
      return baseline !== undefined && baseline > 0 && Math.abs(value / baseline - 1) <= t.band;
    case 'riseBy':
      return baseline !== undefined && value - baseline >= t.points;
    case 'shareOfImage': {
      // The pin's own pool: a batch class's CP APPL row stays a share of the CPs on a zIIP-judged incident.
      const cps = imageCps(run, p.system, p.metric === 'APPL_IIP' ? 'ZIIP' : 'CP');
      return cps > 0 && value >= t.frac * 100 * cps;
    }
    case 'noHistory':
      return withoutHistory(run, p);
    case 'peerSlow':
      // A resource far slower than its peers (RT-35): the peer reading was frozen on the pin when it was taken.
      return p.peer !== undefined && p.peer.value > 0 && value >= t.ratio * p.peer.value;
  }
}

/** The row a pin reads, across report views: the same class on the same image (WLMGL or Monitor III), or the same
 * workload's accounting row. */
const workOf = (p: EvidencePin): string => `${p.system}|${p.subject}`;

interface Related {
  p: EvidencePin;
  ctx: ProofContext;
  relation: PinRelation | null;
  /** Index in the judged group: a tied ruling-out option must read the same incident as the symptom it rules out. */
  incident: number;
}

type Predicate = ProofRecipe['predicates'][number];

function checkRecipe(related: readonly Related[], claim: Mechanism | Trigger, recipe: ProofRecipe, pins: readonly EvidencePin[]): RecipeCheck {
  const meets = (pred: Predicate, e: Related): boolean => pred.options.some((o) => optionHolds(e.ctx, e.p, e.relation, o));
  const holding = (pred: Predicate, ok: (o: PredicateOption, p: EvidencePin, e: Related) => boolean) =>
    new Set(related.filter((e) => pred.options.some((o) => ok(o, e.p, e) && optionHolds(e.ctx, e.p, e.relation, o))).map((e) => e.p.id));
  // An option marked `sameWork` must read the same row (image and class, or workload) as a pin meeting the first
  // predicate: a cost rise on one class and a flat rate on another are not one regression. Group pooling is untouched,
  // since the tie is between pins, whichever incident each was judged for.
  const first = holding(recipe.predicates[0], () => true);
  const firstWork = new Set(pins.filter((p) => first.has(p.id)).map(workOf));
  // Which symptoms met the first predicate, per incident, for a ruling-out option tied to one of them (RT-34): the QR
  // wait rules out a CICS slot queue, CPU per transaction a DBAT queue. A grouped RCA pools rows from several
  // incidents, so the tie is per incident: a QR reading on another workload cannot rule out this one's slot queue.
  const firstMetrics = new Map<number, Set<EvidenceMetric>>();
  for (const e of related) {
    if (e.relation === null || !meets(recipe.predicates[0], e)) continue;
    const s = firstMetrics.get(e.incident) ?? new Set<EvidenceMetric>();
    s.add(e.p.metric);
    firstMetrics.set(e.incident, s);
  }
  const predicates = recipe.predicates.map((pred, k): PredicateCheck => {
    // A predicate without tied options keeps the ordinary any-option rule; a tied one must cover every met symptom
    // on its own incident, so a CICS slot queue needs its QR reading even when a DBAT queue also shows.
    if (k === 0 || !pred.options.some((o) => o.rulesOut)) {
      const ids = k === 0 ? first : holding(pred, (o, p) => !o.sameWork || firstWork.has(workOf(p)));
      const pinIds = pins.map((p) => p.id).filter((id) => ids.has(id));
      const failed = pinIds.length > 0 ? undefined : failedReadingOf(pred, related);
      return { label: pred.label, met: pinIds.length > 0, pinIds, ...(failed ? { failedReading: failed } : {}) };
    }
    const uncovered = new Map<number, Set<EvidenceMetric>>();
    const cover = new Set<number>();
    for (const [incident, symptoms] of firstMetrics) {
      for (const m of symptoms) {
        const entries = related.filter((e) => e.incident === incident && e.relation !== null
          && pred.options.some((o) => o.rulesOut?.includes(m) && optionHolds(e.ctx, e.p, e.relation, o)
            && (!o.sameWork || firstWork.has(workOf(e.p)))));
        if (entries.length === 0) {
          const u = uncovered.get(incident) ?? new Set<EvidenceMetric>();
          u.add(m);
          uncovered.set(incident, u);
        } else for (const e of entries) cover.add(e.p.id);
      }
    }
    const met = uncovered.size === 0 && firstMetrics.size > 0;
    const pinIds = pins.map((p) => p.id).filter((id) => cover.has(id));
    const failed = met ? undefined : failedReadingOf(pred, related, uncovered);
    return { label: pred.label, met, pinIds, ...(failed ? { failedReading: failed } : {}) };
  });
  return { claim, complete: predicates.every((x) => x.met), predicates };
}

/** The largest reading among the related pins that fail a predicate, for the reply's quote. Largest, not closest
 *  to the line: for a ruling-out predicate ("< 25 %") it is the pin furthest over, which is why it failed.
 *  Only a pin the predicate's own relation and option allow is quoted: a wrong-class row must not explain the
 *  failure (RT-30). A rate reading is an ended rate, whatever metric carries the cost. With `required` (a tied
 *  predicate), only an option that rules out one of the uncovered symptoms on that pin's incident is quoted. */
function failedReadingOf(pred: Predicate, related: readonly Related[], required?: ReadonlyMap<number, Set<EvidenceMetric>>): PredicateCheck['failedReading'] {
  let best: PredicateCheck['failedReading'];
  for (const { p, ctx, relation, incident } of related) {
    if (relation === null) continue;
    const o = pred.options.find((x) => x.metric === p.metric && x.relations.includes(relation));
    if (!o) continue;
    if (required) {
      const needing = required.get(incident);
      if (!o.rulesOut || !needing || !o.rulesOut.some((m) => needing.has(m))) continue;
    }
    if (optionHolds(ctx, p, relation, o)) continue;
    const value = o.reading === 'rate' ? p.rate?.value : p.value;
    if (value === undefined) continue;
    if (!best || Math.abs(value) > Math.abs(best.value)) best = { pinId: p.id, metric: o.reading === 'rate' ? 'ENDED_RATE' : o.metric, value };
  }
  return best;
}

/**
 * The filed claims' recipes over the attached pins, for an RCA covering `group` (each incident with its own workload,
 * window and recorded subjects). Each pin is judged against each incident in that incident's window and subjects; a
 * predicate is met when any pin meets it for any of them, since they share one cause (SPEC §10's grouping). Pure.
 */
export function judgeProof(
  run: RunState,
  scenario: Scenario,
  group: readonly Incident[],
  mechanism: Mechanism,
  trigger: Trigger,
  pins: readonly EvidencePin[],
): ProofResult {
  const batch = new Set(subsystemClasses(run.sim.wlm.definition, 'JES'));
  const related = group.flatMap((inc, incident): Related[] => {
    const subjects = inc.subjects;
    const ctx: ProofContext = { run, batch, subjects, scenario, pool: inc.basis?.pool ?? 'CP' };
    const { lo, hi } = incidentWindow(run, inc);
    return pins.filter((p) => p.tick >= lo && p.tick <= hi).map((p) => ({ p, ctx, relation: pinRelation(run, inc, p, subjects), incident }));
  });
  return {
    mechanism: checkRecipe(related, mechanism, MECHANISM_RECIPES[mechanism], pins),
    trigger: checkRecipe(related, trigger, TRIGGER_RECIPES[trigger], pins),
  };
}

/** A recipe's heading in the reply: the claim, whether the pins prove it, and whether a proof earns anything. */
export function recipeHeading(c: RecipeCheck, what: 'Mechanism' | 'Trigger'): string {
  const name = what === 'Trigger' ? triggerLabel(c.claim as Trigger) : c.claim;
  const verdict = c.complete ? 'proven' : 'your pins did not prove it';
  const unearned = c.complete && c.accepted === false ? `, and it earns nothing: it was not the cause${c.why ? ` — ${c.why}` : ''}` : '';
  return `${what} ${name}: ${verdict}${unearned}`;
}

/** One predicate in the reply: ticked or not, in report terms, with the pins that showed it. A failed predicate
 *  quotes the largest failing pinned reading, so the player can see which number missed the line (RT-30). */
export function predicateText(x: PredicateCheck, pinLabel: (id: number) => string): string {
  if (x.met) return `✓ ${x.label} (${x.pinIds.map(pinLabel).join(', ')})`;
  const quote = x.failedReading
    ? ` — your pin ${pinLabel(x.failedReading.pinId)}: ${EVIDENCE_METRICS[x.failedReading.metric].label.replace(/ %$/, '')} ${fmtValue(x.failedReading.metric, x.failedReading.value)}`
    : '';
  return `✗ ${x.label}${quote}`;
}

/** One line per recipe for the play CLI's reply. */
export function proofLines(r: ProofResult, pinLabel: (id: number) => string = (id) => `#${id}`): string[] {
  const line = (c: RecipeCheck, what: 'Mechanism' | 'Trigger') => `${recipeHeading(c, what)}: ${c.predicates.map((x) => predicateText(x, pinLabel)).join('; ')}`;
  return [line(r.mechanism, 'Mechanism'), line(r.trigger, 'Trigger')];
}

/** Every filed pin's line: the clause it counted for (mechanism, trigger, or both), and why the rest did not
 *  count (RT-30). */
export function pinVerdictLines(proof: ProofResult | undefined, verdicts: readonly PinVerdict[], pinLabel: (id: number) => string): string[] {
  const mech = new Set(proof?.mechanism.predicates.flatMap((x) => x.pinIds));
  const trig = new Set(proof?.trigger.predicates.flatMap((x) => x.pinIds));
  return verdicts.map((v) => {
    const where = [mech.has(v.pinId) ? 'mechanism' : '', trig.has(v.pinId) ? 'trigger' : ''].filter(Boolean).join(' and ');
    return `${pinLabel(v.pinId)} ${where ? `counted for the ${where}` : `did not count: ${v.relevance > 0 ? 'it fits the cause but proves no predicate' : v.why}`}`;
  });
}

/** When a met CPU predicate's pin is over a line the hour average misses, the truth reads the clock hour
 *  (RT-30). The clock-hour average is the truth's time base by decision (RT-31, SPEC §10). */
export function hourBaseNote(proof: ProofResult, pins: readonly EvidencePin[], basis: CapacityBasis | null | undefined): string | null {
  if (!basis) return null;
  const met = new Set(proof.mechanism.predicates.filter((x) => x.met).flatMap((x) => x.pinIds));
  const pct = (x: number) => `${x.toFixed(1)} %`;
  for (const p of pins) {
    if (!met.has(p.id)) continue;
    if (p.metric === 'CPC_BUSY' && p.value >= PROOF.busyPct && basis.cpcBusyPct < PROOF.busyPct)
      return `The truth reads the clock hour: CPC ${basis.cpcId} averaged ${pct(basis.cpcBusyPct)} busy, under the ${PROOF.busyPct} % line your pin met.`;
    if (p.metric === 'LPAR_BUSY' && p.value >= PROOF.busyPct && basis.lparBusyPct < PROOF.busyPct)
      return `The truth reads the clock hour: LPAR ${basis.lparId} averaged ${pct(basis.lparBusyPct)} busy, under the ${PROOF.busyPct} % line your pin met.`;
  }
  return null;
}
