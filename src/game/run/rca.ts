import { EVIDENCE } from '../../content/evidence';
import type { Scenario } from '../../sim/core/scenario';
import { scoreEvidence } from '../evidence';
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
  const scored = scenario
    ? scoreEvidence(run, scenario, inc, group, { mechanism, trigger }, pins)
    : { verdicts: [], proof: [], relevance: 0, points: 0, strong: false };
  // Evidence only earns points when it supports an accepted mechanism (RT-07): a defensible reading is proof too.
  const evidencePoints = acceptedOf(inc.truth).mechanisms.includes(mechanism) ? scored.points : 0;
  const strong = evidencePoints > 0 && scored.strong;
  const baseTrust = points >= 3 ? 2 : points > 0 ? 0.5 : -1;
  const facetTrust = baseTrust > 0 ? baseTrust * (1 + (group.length - 1) * EVIDENCE.groupTrustPerIncident) : baseTrust;
  const trust = mapTrust(run, (t) => t + facetTrust / 2);
  const total = points + evidencePoints;
  const explain = mechanismExplanation(inc);
  const rca = { mechanism, trigger, points: total, evidence: scored.verdicts, evidencePoints, proof: scored.proof, ...(explain ? { explain } : {}) };
  return {
    ...run,
    trust,
    insight: run.insight + total + (strong ? EVIDENCE.strongInsight : 0),
    score: run.score + total,
    incidents: run.incidents.map((i) => (rcaLeadId(i) === leadId ? { ...i, rca } : i)),
  };
}
