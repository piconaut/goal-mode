import { EVIDENCE, PROOF } from '../../content/evidence';
import { triggerLabel } from '../../content/rca';
import type { Scenario } from '../../sim/core/scenario';
import { judgeGroupEvidence } from '../evidence';
import { judgeProof, hourBaseNote } from '../proof';
import { mechanismExplanation } from '../rcaExplain';
import { scoreAccepted } from '../sla';
import {
  type CauseEpisode,
  type Incident,
  type Mechanism,
  type RunState,
  type Trigger
} from '../types';
import { mapTrust } from './shared';
import { GROUP_FOLLOW_HOURS, sameEpisode } from './grouping';
import { fallbackCause } from '../rcaTruth';
import { TICKS_PER_HOUR } from '../../sim/core/units';

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
export function groupAcceptedOf(group: readonly Incident[]): {
  mechanisms: Mechanism[];
  triggers: Trigger[];
  notes: Record<string, string>;
  noteFrom: Record<string, string>;
} {
  const mechanisms: Mechanism[] = [];
  const triggers: Trigger[] = [];
  const notes: Record<string, string> = {};
  const noteFrom: Record<string, string> = {};
  for (const inc of group) {
    const accepted = inc.truth.accepted;
    for (const m of accepted.mechanisms) if (!mechanisms.includes(m)) mechanisms.push(m);
    for (const t of accepted.triggers) if (!triggers.includes(t)) triggers.push(t);
    // The first reason offered for an answer is the one shown, and the lead's comes first.
    for (const [answer, why] of Object.entries(inc.truth.notes ?? {})) {
      if (notes[answer] !== undefined) continue;
      notes[answer] = why;
      noteFrom[answer] = inc.workloadId;
    }
  }
  return { mechanisms, triggers, notes, noteFrom };
}

/** The group's answers that are not the lead's primary, each with its reason: the reply's "also accepted" (RT-07).
 *  A reason belongs to one victim's hour, so in a group it names the victim it came from (RT-28). */
export function alsoAcceptedOf(group: readonly Incident[]): { answer: Mechanism | Trigger; why?: string }[] {
  const lead = group[0];
  if (!lead) return [];
  const accepted = groupAcceptedOf(group);
  const whyOf = (answer: string) => {
    const why = accepted.notes[answer];
    if (why === undefined) return undefined;
    return group.length > 1 ? `${accepted.noteFrom[answer]}: ${why}` : why;
  };
  return [
    ...accepted.mechanisms.filter((m) => m !== lead.truth.mechanism).map((m) => ({ answer: m, why: whyOf(m) })),
    ...accepted.triggers.filter((t) => t !== lead.truth.trigger).map((t) => ({ answer: t, why: whyOf(t) })),
  ];
}

/** One distinct primary of a group, with the workloads whose truth it is. */
export interface GroupPrimary {
  mechanism: Mechanism;
  trigger: Trigger;
  workloads: string[];
}

/** The group's distinct primaries, the lead's first (RT-28). */
export function groupPrimariesOf(group: readonly Incident[]): GroupPrimary[] {
  const out: GroupPrimary[] = [];
  for (const inc of group) {
    const same = out.find((p) => p.mechanism === inc.truth.mechanism && p.trigger === inc.truth.trigger);
    if (same) {
      if (!same.workloads.includes(inc.workloadId)) same.workloads.push(inc.workloadId);
    } else out.push({ mechanism: inc.truth.mechanism, trigger: inc.truth.trigger, workloads: [inc.workloadId] });
  }
  return out;
}

/** The reply's header text for the group's primary: one primary as before, or each distinct primary with the
 *  workloads whose truth it is (RT-28). A single incident, or a group whose members agree, reads unchanged. */
export function primaryTextOf(group: readonly Incident[]): string {
  const primaries = groupPrimariesOf(group);
  const one = (p: GroupPrimary) => `${p.mechanism}/${triggerLabel(p.trigger)}`;
  if (primaries.length <= 1) return primaries.length ? one(primaries[0]!) : '';
  return primaries.map((p) => `${one(p)}: ${p.workloads.join(', ')}`).join('; ');
}

/** The reply's answer line: what was filed, accepted or not, and the primary when it was not that (RT-30). The play
 *  CLI and the RCA card both render this, so the answer wording cannot drift. */
export function rcaAnswerText(
  group: readonly Incident[],
  mechanism: Mechanism,
  trigger: Trigger,
  accepted: { mechanisms: Mechanism[]; triggers: Trigger[] },
): string {
  const lead = group[0];
  if (!lead) return '';
  const offPrimary = mechanism !== lead.truth.mechanism || trigger !== lead.truth.trigger;
  const primary = offPrimary || groupPrimariesOf(group).length > 1 ? ` (primary ${primaryTextOf(group)})` : '';
  return `Mechanism ${mechanism} ${accepted.mechanisms.includes(mechanism) ? 'accepted' : 'not accepted'}, trigger ${triggerLabel(trigger)} ${accepted.triggers.includes(trigger) ? 'accepted' : 'not accepted'}${primary}`;
}

/** Expand a cause episode through the run's quiet hours and incidents of the same cause, chaining back-to-back
 *  hours into one episode (RT-22): a standing fault's 09:00–14:00 quiet hours are one episode even though the first
 *  and last hours are more than `GROUP_FOLLOW_HOURS` apart. A card cause is one episode for a played day. */
export function episodeOf(run: RunState, seed: CauseEpisode): CauseEpisode {
  if (!fallbackCause(seed.cause)) return seed;
  const intervals: { start: number; end: number }[] = [{ start: seed.startTick, end: seed.endTick ?? run.sim.tick }];
  for (const f of run.quietHours ?? []) {
    if (f.day === seed.day && f.truth.cause === seed.cause) intervals.push({ start: f.startTick, end: f.endTick });
  }
  for (const i of run.incidents) {
    if (i.day === seed.day && i.truth.cause === seed.cause) intervals.push({ start: i.startTick, end: i.endTick ?? run.sim.tick });
  }
  let start = seed.startTick;
  let end = seed.endTick ?? run.sim.tick;
  let changed = true;
  while (changed) {
    changed = false;
    for (const x of intervals) {
      const follow = GROUP_FOLLOW_HOURS * TICKS_PER_HOUR;
      if (x.start > end + follow || x.end < start - follow) continue;
      if (x.start < start || x.end > end) {
        start = Math.min(start, x.start);
        end = Math.max(end, x.end);
        changed = true;
      }
    }
  }
  return { cause: seed.cause, day: seed.day, startTick: start, endTick: end };
}

/** The incident or problem record that already earned this cause episode, or null. One episode pays once: an RCA and a
 * record filing of the same §4.5 episode earn between them, while a later episode of the same cause is new. */
export function creditedEpisode(run: RunState, episode: CauseEpisode): number | null {
  const target = episodeOf(run, episode);
  const inc = run.incidents.find((i) => (i.rca?.points ?? 0) > 0
    && sameEpisode(episodeOf(run, { cause: i.truth.cause, day: i.day, startTick: i.startTick, endTick: i.endTick }), target));
  if (inc) return inc.id;
  const rec = run.problemRecords?.find((r) => r.filings.some((f) => f.points > 0 && sameEpisode(episodeOf(run, f.episode), target)));
  return rec?.id ?? null;
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
  // Why a proven claim still earns nothing: the truth's near miss (RT-35: a peer-slow CF below the response share).
  const nearMiss = group.map((i) => i.truth.nearMiss?.[mechanism]).find((x) => x !== undefined);
  // The reply says whether a proof earned anything, so record which claims the truth accepts beside the recipes.
  const proof = judged && {
    mechanism: { ...judged.mechanism, accepted: mechanismAccepted, ...(nearMiss ? { why: nearMiss } : {}) },
    trigger: { ...judged.trigger, accepted: triggerAccepted },
  };
  const mechanismProven = mechanismAccepted && !!proof?.mechanism.complete;
  const mechanismShown = mechanismAccepted && !!proof?.mechanism.predicates.some((x) => x.met);
  const evidencePoints = mechanismProven ? PROOF.recipePoints : mechanismShown ? PROOF.partialPoints : 0;
  const strong = mechanismProven && triggerAccepted && !!proof?.trigger.complete;
  const baseTrust = points >= 3 ? 2 : points > 0 ? 0.5 : -1;
  const cause = group[0]?.truth.cause ?? '';
  // RT-22: one episode pays once (§4.5: a card is one episode for a played day; a fallback cause only while its hours
  // overlap or follow within GROUP_FOLLOW_HOURS). A later episode of the same cause is new and pays.
  const episode: CauseEpisode = { cause, day: inc.day, startTick: inc.startTick, endTick: inc.endTick };
  const duplicateOf = points > 0 ? creditedEpisode(run, episode) : null;
  // Only a correct answer can be a duplicate: a wrong answer still costs its trust, even on an already-earned cause.
  const duplicate = duplicateOf !== null && points > 0;
  const awarded = !duplicate;
  const facetTrust = baseTrust > 0 ? baseTrust * (1 + (group.length - 1) * EVIDENCE.groupTrustPerIncident) : baseTrust;
  const trust = awarded ? mapTrust(run, (t) => t + facetTrust / 2) : run.trust;
  const total = awarded ? points + evidencePoints : 0;
  // The line describes the hour that backs the filed mechanism: in a group the victims' hours differ, and the lead's
  // would otherwise rule out an answer another victim proves (N1). A single incident keeps the unlabelled wording.
  const explainInc = group.find((m) => m.truth.mechanism === mechanism) ?? group[0]!;
  const explain = mechanismExplanation(explainInc, group.length > 1 ? explainInc.workloadId : undefined);
  // The hour-base note is recorded now, from the filed pins, so a later unpin or a rolled-off pin cannot change the
  // reply (RT-30). A group's victims have their own hours, so the note is only for a single incident.
  const hourNote = judged && group.length === 1 ? hourBaseNote(judged, pins, group[0]!.basis) : null;
  const rca = { mechanism, trigger, points: total, evidence: verdicts, evidencePoints: awarded ? evidencePoints : 0, ...(awarded && strong ? { strong } : {}), ...(proof ? { proof } : {}), ...(explain ? { explain } : {}), ...(hourNote ? { hourNote } : {}), ...(duplicate ? { duplicateOf } : {}) };
  return {
    ...run,
    trust,
    insight: run.insight + total + (awarded && strong ? EVIDENCE.strongInsight : 0),
    score: run.score + total,
    incidents: run.incidents.map((i) => (rcaLeadId(i) === leadId ? { ...i, rca } : i)),
  };
}
