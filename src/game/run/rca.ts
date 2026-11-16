import { EVIDENCE, PROOF } from '../../content/evidence';
import type { Scenario } from '../../sim/core/scenario';
import { judgeGroupEvidence } from '../evidence';
import { judgeProof } from '../proof';
import { mechanismExplanation } from '../rcaExplain';
import { acceptedOf, scoreAccepted } from '../sla';
import {
  type Incident,
  type Mechanism,
  type RunState,
  type Trigger
} from '../types';
import { mapTrust } from './shared';

/** The incident whose RCA covers this one (itself unless linked to an earlier same-cause incident that day). */
export function rcaLeadId(inc: Incident): number {
  return inc.rcaGroup ?? inc.id;
}

/** The incidents one RCA covers: the group's lead first, then its members in the order they opened. Takes the id of
 * any incident of the group. */
export function rcaGroupOf(incidents: readonly Incident[], incidentId: number): Incident[] {
  const target = incidents.find((i) => i.id === incidentId);
  if (!target) return [];
  const leadId = rcaLeadId(target);
  const group = incidents.filter((i) => rcaLeadId(i) === leadId);
  const lead = group.find((i) => i.id === leadId);
  return lead ? [lead, ...group.filter((i) => i !== lead)] : group;
}

/** A group's accepted answers: the union of its members', led by the lead's primary (docs/rca-design.md §4.5). One
 * RCA covers one cause, so an answer that is right for any victim is right for the filing. */
export function groupAcceptedOf(group: readonly Incident[]): { mechanisms: Mechanism[]; triggers: Trigger[]; notes: Record<string, string> } {
  const mechanisms: Mechanism[] = [];
  const triggers: Trigger[] = [];
  const notes: Record<string, string> = {};
  for (const inc of group) {
    const accepted = acceptedOf(inc.truth);
    for (const m of accepted.mechanisms) if (!mechanisms.includes(m)) mechanisms.push(m);
    for (const t of accepted.triggers) if (!triggers.includes(t)) triggers.push(t);
    // The first reason offered for an answer is the one shown, and the lead's comes first.
    for (const [answer, why] of Object.entries(inc.truth.notes ?? {})) notes[answer] ??= why;
  }
  return { mechanisms, triggers, notes };
}

/** The group's answers that are not the lead's primary, each with its reason: the reply's "also accepted" (RT-07). */
export function alsoAcceptedOf(group: readonly Incident[]): { answer: Mechanism | Trigger; why?: string }[] {
  const lead = group[0];
  if (!lead) return [];
  const accepted = groupAcceptedOf(group);
  return [
    ...accepted.mechanisms.filter((m) => m !== lead.truth.mechanism).map((m) => ({ answer: m, why: accepted.notes[m] })),
    ...accepted.triggers.filter((t) => t !== lead.truth.trigger).map((t) => ({ answer: t, why: accepted.notes[t] })),
  ];
}

/** Root-cause analysis for an incident and every incident linked to it; scored once against the ground truth. */
export function submitRca(run: RunState, incidentId: number, mechanism: Mechanism, trigger: Trigger, scenario?: Scenario, evidenceIds: readonly number[] = []): RunState {
  const inc = run.incidents.find((i) => i.id === incidentId);
  if (!inc || inc.rca) return run;
  const leadId = rcaLeadId(inc);
  const group = rcaGroupOf(run.incidents, incidentId);
  // The group's accepted set is the union of its members' (§4.5): the victims of one card can show different
  // mechanisms, and each is a full answer for the cause.
  const accepted = groupAcceptedOf(group);
  const points = scoreAccepted(accepted, { mechanism, trigger });
  const pins = (run.pins ?? []).filter((p) => evidenceIds.includes(p.id)).slice(0, EVIDENCE.perRca);
  // A pin counts if it is evidence for any incident in the group (each has its own workload and window).
  const verdicts = scenario
    ? judgeGroupEvidence(run, scenario, group, pins)
    : [];
  // Evidence is a proof (RT-13, docs/rca-design.md §4.6): a complete recipe for the filed mechanism earns what three
  // fully relevant pins did, one predicate shown earns what a non-specific pin did, and a complete recipe for the filed
  // trigger on top makes the evidence strong. Only for accepted answers (RT-07): proving a wrong claim earns nothing.
  const mechanismAccepted = accepted.mechanisms.includes(mechanism);
  const triggerAccepted = accepted.triggers.includes(trigger);
  const judged = scenario && pins.length > 0 ? judgeProof(run, scenario, group, mechanism, trigger, pins) : null;
  // The reply says whether a proof earned anything, so record which claims the truth accepts beside the recipes.
  const proof = judged && {
    mechanism: { ...judged.mechanism, accepted: mechanismAccepted },
    trigger: { ...judged.trigger, accepted: triggerAccepted },
  };
  const mechanismProven = mechanismAccepted && !!proof?.mechanism.complete;
  const mechanismShown = mechanismAccepted && !!proof?.mechanism.predicates.some((x) => x.met);
  const evidencePoints = mechanismProven ? PROOF.recipePoints : mechanismShown ? PROOF.partialPoints : 0;
  const strong = mechanismProven && triggerAccepted && !!proof?.trigger.complete;
  const baseTrust = points >= 3 ? 2 : points > 0 ? 0.5 : -1;
  const facetTrust = baseTrust > 0 ? baseTrust * (1 + (group.length - 1) * EVIDENCE.groupTrustPerIncident) : baseTrust;
  const trust = mapTrust(run, (t) => t + facetTrust / 2);
  const total = points + evidencePoints;
  // The line describes the hour that backs the filed mechanism: in a group the victims' hours differ, and the lead's
  // would otherwise rule out an answer another victim proves (N1). A single incident keeps the unlabelled wording.
  const explainInc = group.find((m) => m.truth.mechanism === mechanism) ?? group[0]!;
  const explain = mechanismExplanation(explainInc, group.length > 1 ? explainInc.workloadId : undefined);
  const rca = { mechanism, trigger, points: total, evidence: verdicts, evidencePoints, ...(strong ? { strong } : {}), ...(proof ? { proof } : {}), ...(explain ? { explain } : {}) };
  return {
    ...run,
    trust,
    insight: run.insight + total + (strong ? EVIDENCE.strongInsight : 0),
    score: run.score + total,
    incidents: run.incidents.map((i) => (rcaLeadId(i) === leadId ? { ...i, rca } : i)),
  };
}
