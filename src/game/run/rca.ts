import { EVIDENCE, PROOF } from '../../content/evidence';
import type { Scenario } from '../../sim/core/scenario';
import { judgeGroupEvidence } from '../evidence';
import { judgeProof } from '../proof';
import { mechanismExplanation } from '../rcaExplain';
import { acceptedOf, scoreRca } from '../sla';
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

/** Root-cause analysis for an incident and every incident linked to it; scored once against the ground truth. */
export function submitRca(run: RunState, incidentId: number, mechanism: Mechanism, trigger: Trigger, scenario?: Scenario, evidenceIds: readonly number[] = []): RunState {
  const inc = run.incidents.find((i) => i.id === incidentId);
  if (!inc || inc.rca) return run;
  const leadId = rcaLeadId(inc);
  const group = run.incidents.filter((i) => rcaLeadId(i) === leadId);
  const points = scoreRca(inc.truth, { mechanism, trigger });
  const pins = (run.pins ?? []).filter((p) => evidenceIds.includes(p.id)).slice(0, EVIDENCE.perRca);
  // A pin counts if it is evidence for any incident in the group (each has its own workload and window).
  const verdicts = scenario
    ? judgeGroupEvidence(run, scenario, group, pins)
    : [];
  // Evidence is a proof (RT-13, docs/rca-design.md §4.6): a complete recipe for the filed mechanism earns what three
  // fully relevant pins did, one predicate shown earns what a non-specific pin did, and a complete recipe for the filed
  // trigger on top makes the evidence strong. Only for accepted answers (RT-07): proving a wrong claim earns nothing.
  const accepted = acceptedOf(inc.truth);
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
  const explain = mechanismExplanation(inc);
  const rca = { mechanism, trigger, points: total, evidence: verdicts, evidencePoints, ...(strong ? { strong } : {}), ...(proof ? { proof } : {}), ...(explain ? { explain } : {}) };
  return {
    ...run,
    trust,
    insight: run.insight + total + (strong ? EVIDENCE.strongInsight : 0),
    score: run.score + total,
    incidents: run.incidents.map((i) => (rcaLeadId(i) === leadId ? { ...i, rca } : i)),
  };
}
