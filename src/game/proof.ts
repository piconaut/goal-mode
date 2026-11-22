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
  /** When it fails, the related pin's closest reading, so the reply can say what the pin showed (RT-30). */
  failedReading?: { pinId: number; metric: EvidenceMetric; value: number };
}

export interface RecipeCheck {
  claim: Mechanism | Trigger;
  complete: boolean;
  predicates: PredicateCheck[];
  /** Whether the truth accepts the claim: set when the RCA is scored (a bare `judgeProof` result has not been). */
  accepted?: boolean;
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
  }
}

/** The row a pin reads, across report views: the same class on the same image (WLMGL or Monitor III), or the same
 * workload's accounting row. */
const workOf = (p: EvidencePin): string => `${p.system}|${p.subject}`;

interface Related {
  p: EvidencePin;
  ctx: ProofContext;
  relation: PinRelation | null;
}

function checkRecipe(related: readonly Related[], claim: Mechanism | Trigger, recipe: ProofRecipe, pins: readonly EvidencePin[]): RecipeCheck {
  const holding = (pred: ProofRecipe['predicates'][number], ok: (o: PredicateOption, p: EvidencePin) => boolean) =>
    new Set(related.filter(({ p, ctx, relation }) => pred.options.some((o) => ok(o, p) && optionHolds(ctx, p, relation, o))).map(({ p }) => p.id));
  // An option marked `sameWork` must read the same row (image and class, or workload) as a pin meeting the first
  // predicate: a cost rise on one class and a flat rate on another are not one regression. Group pooling is untouched,
  // since the tie is between pins, whichever incident each was judged for.
  const first = holding(recipe.predicates[0], () => true);
  const firstWork = new Set(pins.filter((p) => first.has(p.id)).map(workOf));
  const predicates = recipe.predicates.map((pred, k): PredicateCheck => {
    const ids = k === 0 ? first : holding(pred, (o, p) => !o.sameWork || firstWork.has(workOf(p)));
    const pinIds = pins.map((p) => p.id).filter((id) => ids.has(id));
    const failed = pinIds.length > 0 ? undefined : failedReadingOf(pred, related);
    return { label: pred.label, met: pinIds.length > 0, pinIds, ...(failed ? { failedReading: failed } : {}) };
  });
  return { claim, complete: predicates.every((x) => x.met), predicates };
}

/** The related pin closest to a failing predicate (the largest reading of its metrics), for the reply's quote. */
function failedReadingOf(pred: ProofRecipe['predicates'][number], related: readonly Related[]): PredicateCheck['failedReading'] {
  let best: PredicateCheck['failedReading'];
  for (const { p } of related) {
    const o = pred.options.find((x) => x.metric === p.metric);
    if (!o) continue;
    const value = o.reading === 'rate' ? p.rate?.value : p.value;
    if (value === undefined) continue;
    if (!best || Math.abs(value) > Math.abs(best.value)) best = { pinId: p.id, metric: o.metric, value };
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
  const related = group.flatMap((inc): Related[] => {
    const subjects = inc.subjects;
    const ctx: ProofContext = { run, batch, subjects, scenario, pool: inc.basis?.pool ?? 'CP' };
    const { lo, hi } = incidentWindow(run, inc);
    return pins.filter((p) => p.tick >= lo && p.tick <= hi).map((p) => ({ p, ctx, relation: pinRelation(run, inc, p, subjects) }));
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
  const unearned = c.complete && c.accepted === false ? ', and it earns nothing: it was not the cause' : '';
  return `${what} ${name}: ${verdict}${unearned}`;
}

/** One predicate in the reply: ticked or not, in report terms, with the pins that showed it. A failed predicate
 *  quotes the closest pinned reading, so the player can see which number missed the line (RT-30). */
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

/** Every filed pin's line: the ones a predicate counted, and why the rest did not (RT-30). */
export function pinVerdictLines(proof: ProofResult | undefined, verdicts: readonly PinVerdict[], pinLabel: (id: number) => string): string[] {
  const counted = new Set((proof ? [...proof.mechanism.predicates, ...proof.trigger.predicates] : []).flatMap((x) => x.pinIds));
  return verdicts.map((v) => `${pinLabel(v.pinId)} ${counted.has(v.pinId) ? 'counted' : `did not count: ${v.relevance > 0 ? 'it fits the cause but proves no predicate' : v.why}`}`);
}

/** When a met CPU predicate's pin is over a line the hour average misses, the truth reads the clock hour
 *  (RT-30; RT-31 decides the time base itself). */
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
