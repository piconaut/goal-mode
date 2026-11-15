// Proof recipes (RT-13, docs/rca-design.md §4.6): the attached pins prove a claim when they satisfy both predicates
// of its recipe in content/evidence.ts. The mechanism's complete recipe replaces the old relevance sum; the trigger's
// makes the evidence strong. Pure; judged against the incident's recorded subjects like the per-pin verdicts.

import {
  EVIDENCE,
  EVIDENCE_METRICS,
  MECHANISM_RECIPES,
  TRIGGER_RECIPES,
  type PredicateOption,
  type ProofRecipe,
} from '../content/evidence';
import type { Scenario } from '../sim/core/scenario';
import { TICKS_PER_HOUR } from '../sim/core/units';
import type { ClassificationRule } from '../sim/wlm/types';
import { incidentSubjects, pinRelation, type EvidencePin } from './evidence';
import type { Incident, IncidentSubjects, Mechanism, RunState, Trigger } from './types';

export interface PredicateCheck {
  label: string;
  met: boolean;
  /** The attached pins that satisfy it. */
  pinIds: number[];
}

export interface RecipeCheck {
  claim: Mechanism | Trigger;
  complete: boolean;
  predicates: PredicateCheck[];
}

export interface ProofResult {
  mechanism: RecipeCheck;
  trigger: RecipeCheck;
}

/** Service classes a JES rule assigns, the policy's batch classes (BATCH_OVERLAP's "batch running then"). APPROX: read
 * from the definition active at review time, not the one in force when the row was written. */
export function batchClasses(run: RunState): Set<string> {
  const out = new Set<string>();
  const walk = (rules: readonly ClassificationRule[]) => {
    for (const r of rules) {
      if (r.serviceClass) out.add(r.serviceClass);
      walk(r.children);
    }
  };
  for (const s of run.sim.wlm.definition.subsystems) {
    if (s.subsystem !== 'JES') continue;
    if (s.defaultServiceClass) out.add(s.defaultServiceClass);
    walk(s.rules);
  }
  return out;
}

/** The pinned image's online general CPs, so an APPL% share can be read as a share of the image. */
function imageCps(run: RunState, lparId: string): number {
  const l = run.sim.config.lpars.find((x) => x.id === lparId);
  return l?.pools.filter((p) => p.pool === 'CP').reduce((a, p) => a + p.logical, 0) ?? 0;
}

/** A Workload Activity row with no earlier rows, pinned once the report had history: new work's first rows. */
function withoutHistory(run: RunState, p: EvidencePin): boolean {
  if (p.baseline !== undefined) return false;
  if (p.source === 'WLMGL') {
    const index = run.sim.rmf.intervals.findIndex((iv) => iv.endTick === p.tick);
    return index >= EVIDENCE.baselineRows;
  }
  if (p.source === 'Db2 101' || p.source === 'CICS 110') return run.smfHours.length > EVIDENCE.baselineRows;
  return false;
}

/** What an option reads beyond the pin itself. */
export interface ProofContext {
  run: RunState;
  /** The policy's batch classes (BATCH_OVERLAP). */
  batch: Set<string>;
  /** The hurt work's most important period importance (null when none of its classes is in the definition). */
  ownImportance: number | null;
}

/** A class row's period importance, discretionary as 6; null for a class the definition does not hold (SYSTEM,
 * SYSSTC, or one a later policy dropped). APPROX: read from the definition active at review time (§4.6's A10 note). */
function periodImportance(run: RunState, scKey: string): number | null {
  const [cls, n] = scKey.split('#');
  const period = run.sim.wlm.definition.classes.find((c) => c.id === cls)?.periods[Math.max(0, Number(n ?? 1) - 1)];
  if (!period) return null;
  return period.goal.kind === 'DISC' ? 6 : period.importance;
}

function ownImportance(run: RunState, s: IncidentSubjects): number | null {
  const own = s.classes.filter((c) => !(s.serverClasses ?? []).includes(c)).map((c) => periodImportance(run, `${c}#1`)).filter((x): x is number => x !== null);
  return own.length > 0 ? Math.min(...own) : null;
}

/** Does this pin, in this relation, satisfy this predicate option? */
export function optionHolds(ctx: ProofContext, p: EvidencePin, relation: string | null, o: PredicateOption): boolean {
  const { run } = ctx;
  if (p.metric !== o.metric || relation === null || !o.relations.includes(relation as never)) return false;
  if (o.batchClass && !ctx.batch.has(p.subject.split('#')[0]!)) return false;
  if (o.displaceable) {
    const theirs = periodImportance(run, p.subject);
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
      const d = EVIDENCE_METRICS[o.metric];
      const floor = Math.max(d.notableAt, d.notableMultiple !== undefined && baseline !== undefined ? d.notableMultiple * baseline : 0);
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

function checkRecipe(
  run: RunState,
  members: readonly { inc: Incident; subjects: IncidentSubjects; ctx: ProofContext }[],
  claim: Mechanism | Trigger,
  recipe: ProofRecipe,
  pins: readonly EvidencePin[],
): RecipeCheck {
  // Each pin is judged against each incident of the group in that incident's window and subjects; a predicate is met
  // when any pin meets it for any of them, since they share one cause (SPEC §10's grouping).
  const related = members.flatMap(({ inc, subjects, ctx }) => {
    const lo = inc.startTick - EVIDENCE.windowHours * TICKS_PER_HOUR;
    const hi = (inc.endTick ?? run.sim.tick) + EVIDENCE.windowHours * TICKS_PER_HOUR;
    return pins.filter((p) => p.tick >= lo && p.tick <= hi).map((p) => ({ p, ctx, relation: pinRelation(run, inc, p, subjects) }));
  });
  const predicates = recipe.predicates.map((pred): PredicateCheck => {
    const ids = new Set(related.filter(({ p, ctx, relation }) => pred.options.some((o) => optionHolds(ctx, p, relation, o))).map(({ p }) => p.id));
    const pinIds = pins.map((p) => p.id).filter((id) => ids.has(id));
    return { label: pred.label, met: pinIds.length > 0, pinIds };
  });
  return { claim, complete: predicates.every((x) => x.met), predicates };
}

/**
 * The filed claims' recipes over the attached pins, for an RCA covering `group` (each incident with its own workload,
 * window and recorded subjects). Pure.
 */
export function judgeProof(
  run: RunState,
  scenario: Scenario,
  group: readonly Incident[],
  mechanism: Mechanism,
  trigger: Trigger,
  pins: readonly EvidencePin[],
): ProofResult {
  const batch = batchClasses(run);
  const members = group.map((inc) => {
    const subjects = inc.subjects ?? incidentSubjects(run, scenario, inc.workloadId, inc.day);
    return { inc, subjects, ctx: { run, batch, ownImportance: ownImportance(run, subjects) } };
  });
  return {
    mechanism: checkRecipe(run, members, mechanism, MECHANISM_RECIPES[mechanism], pins),
    trigger: checkRecipe(run, members, trigger, TRIGGER_RECIPES[trigger], pins),
  };
}

/** One line per recipe for the reply: the claim, then each predicate ticked or not with the pins that showed it. */
export function proofLines(r: ProofResult, pinLabel: (id: number) => string = (id) => `#${id}`): string[] {
  const line = (c: RecipeCheck, what: string) =>
    `${what} ${c.claim} ${c.complete ? 'proven' : 'not proven'}: ${c.predicates
      .map((x) => `${x.met ? '✓' : '✗'} ${x.label}${x.met ? ` (${x.pinIds.map(pinLabel).join(', ')})` : ''}`)
      .join('; ')}`;
  return [line(r.mechanism, 'Mechanism'), line(r.trigger, 'Trigger')];
}
