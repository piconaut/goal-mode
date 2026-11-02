import { EVIDENCE } from '../../content/evidence';
import type { Scenario } from '../../sim/core/scenario';
import { judgeEvidence } from '../evidence';
import { scoreRca } from '../sla';
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
    ? group.map((g) => judgeEvidence(run, scenario, g, pins)).reduce((best, vs) => best.map((b, k) => (vs[k]!.relevance > b.relevance ? vs[k]! : b)))
    : [];
  const relevance = verdicts.reduce((a, v) => a + v.relevance, 0);
  // Evidence only earns points when it supports the right mechanism (SPEC §10).
  const evidencePoints = mechanism === inc.truth.mechanism ? Math.round(relevance * EVIDENCE.pointsPerRelevance * 2) / 2 : 0;
  const strong = evidencePoints > 0 && relevance >= EVIDENCE.strongAt;
  const baseTrust = points >= 3 ? 2 : points > 0 ? 0.5 : -1;
  const facetTrust = baseTrust > 0 ? baseTrust * (1 + (group.length - 1) * EVIDENCE.groupTrustPerIncident) : baseTrust;
  const trust = mapTrust(run, (t) => t + facetTrust / 2);
  const total = points + evidencePoints;
  const rca = { mechanism, trigger, points: total, evidence: verdicts, evidencePoints };
  return {
    ...run,
    trust,
    insight: run.insight + total + (strong ? EVIDENCE.strongInsight : 0),
    score: run.score + total,
    incidents: run.incidents.map((i) => (rcaLeadId(i) === leadId ? { ...i, rca } : i)),
  };
}
