// Proof recipes (RT-13, docs/rca-design.md §4.6): the attached pins prove a claim when they satisfy both predicates
// of its recipe in content/evidence.ts. The mechanism's complete recipe replaces the old relevance sum; the trigger's
// makes the evidence strong. Pure; judged against the incident's recorded subjects like the per-pin verdicts.

import { MECHANISM_RECIPES, TRIGGER_RECIPES, type PinRelation, type PredicateOption, type ProofRecipe } from '../content/evidence';
import { triggerLabel } from '../content/rca';
import type { Scenario } from '../sim/core/scenario';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { classify } from '../sim/wlm/classify';
import { incidentSubjects, incidentWindow, notableFloor, pinRelation, smfHourEndTick, type EvidencePin } from './evidence';
import { importanceRank } from './sla';
import type { Incident, IncidentSubjects, Mechanism, RunState, Trigger } from './types';
import { subsystemClasses } from './wlmEdit';

interface PredicateCheck {
  label: string;
  met: boolean;
  /** The attached pins that satisfy it. */
  pinIds: number[];
}

export interface RecipeCheck {
  claim: Mechanism | Trigger;
  complete: boolean;
  predicates: PredicateCheck[];
  /** Whether the truth accepts the claim, set when the RCA is scored (absent in saves from before it). */
  accepted?: boolean;
}

export interface ProofResult {
  mechanism: RecipeCheck;
  trigger: RecipeCheck;
}

/** The pinned image's online general CPs, so an APPL% share can be read as a share of the image. */
function imageCps(run: RunState, lparId: string): number {
  const l = run.sim.config.lpars.find((x) => x.id === lparId);
  return l?.pools.filter((p) => p.pool === 'CP').reduce((a, p) => a + p.logical, 0) ?? 0;
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
  /** The hurt work's most important period importance (null when none of its classes is in the definition). */
  ownImportance: number | null;
  scenario: Scenario;
}

/** A class row's period importance as donor accounting ranks it (SYSTEM and SYSSTC 0, discretionary 6); null for a
 * period the definition does not hold (SYSOTHER, or a class a later policy dropped), which is never displaceable.
 * APPROX: read from the definition active at review time (§4.6's A10 note). */
function periodImportance(run: RunState, scKey: string): number | null {
  const def = run.sim.wlm.definition;
  const [cls, n] = scKey.split('#');
  const builtIn = cls === 'SYSTEM' || cls === 'SYSSTC';
  return builtIn || def.classes.find((c) => c.id === cls)?.periods[Number(n) - 1] ? importanceRank(def, scKey) : null;
}

/** A PROCU job's importance: its address space classified as the STC rules would (SYSTEM and SYSSTC rank above
 * every period, so they are never displaceable). */
function jobImportance(ctx: ProofContext, p: EvidencePin): number | null {
  // The PROCU row names the job's service class (batch jobs and TSO users as well as started tasks). APPROX: it prints
  // no period, so the job is judged at period 1 (a TSO user in period 2 reads as more important than it is).
  if (p.serviceClass !== undefined) return periodImportance(ctx.run, `${p.serviceClass}#1`);
  const a = [...ctx.scenario.addressSpaces, ...ctx.run.sim.extraAddressSpaces].find((x) => x.jobname === p.subject && x.lparId === p.system);
  if (!a) return null;
  const sc = classify(ctx.run.sim.wlm.definition, { subsystem: a.subsystem, TN: a.jobname, SY: a.lparId }).serviceClass;
  return sc ? periodImportance(ctx.run, `${sc}#1`) : null;
}

function ownImportance(run: RunState, s: IncidentSubjects): number | null {
  const own = s.classes.filter((c) => !(s.serverClasses ?? []).includes(c)).map((c) => periodImportance(run, `${c}#1`)).filter((x): x is number => x !== null);
  return own.length > 0 ? Math.min(...own) : null;
}

/** Does this pin, in this relation, satisfy this predicate option? */
function optionHolds(ctx: ProofContext, p: EvidencePin, relation: PinRelation | null, o: PredicateOption): boolean {
  const { run } = ctx;
  if (p.metric !== o.metric || relation === null || !o.relations.includes(relation)) return false;
  if (o.batchClass && !ctx.batch.has(p.subject.split('#')[0]!)) return false;
  if (o.displaceable) {
    // A job row (PROCU's EAppl per jobname) by its job; any class row, Monitor III's PROCU class rows included, by its
    // period.
    const theirs = p.metric === 'JOB_APPL' ? jobImportance(ctx, p) : periodImportance(run, p.subject);
    if (theirs === null || ctx.ownImportance === null || theirs <= ctx.ownImportance) return false;
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
      const cps = imageCps(run, p.system);
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
    return { label: pred.label, met: pinIds.length > 0, pinIds };
  });
  return { claim, complete: predicates.every((x) => x.met), predicates };
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
    const subjects = inc.subjects ?? incidentSubjects(run, scenario, inc.workloadId, inc.day);
    const ctx: ProofContext = { run, batch, ownImportance: ownImportance(run, subjects), scenario };
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
  const unearned = c.complete && c.accepted === false ? ', but it was not the cause, so it earns nothing' : '';
  return `${what} ${name} ${c.complete ? 'proven' : 'not proven'}${unearned}`;
}

/** One predicate in the reply: ticked or not, in report terms, with the pins that showed it. */
export function predicateText(x: PredicateCheck, pinLabel: (id: number) => string): string {
  return `${x.met ? '✓' : '✗'} ${x.label}${x.met ? ` (${x.pinIds.map(pinLabel).join(', ')})` : ''}`;
}

/** One line per recipe for the play CLI's reply. */
export function proofLines(r: ProofResult, pinLabel: (id: number) => string = (id) => `#${id}`): string[] {
  const line = (c: RecipeCheck, what: 'Mechanism' | 'Trigger') => `${recipeHeading(c, what)}: ${c.predicates.map((x) => predicateText(x, pinLabel)).join('; ')}`;
  return [line(r.mechanism, 'Mechanism'), line(r.trigger, 'Trigger')];
}
