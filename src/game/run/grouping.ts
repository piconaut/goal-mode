// Grouping incidents by root cause for the one-RCA rule (RT-15, docs/rca-design.md §4.5, A13).
//
// `truth.cause` names the cause (RT-07): the blamed card's `uid`, `new:<workload>`, `change:<id>`, or
// `none:<family>:<host>`. Incidents of equal cause group, and one RCA covers the group:
//  - a card is one cause for a whole played day, however far apart its victims fall (R-7: two mechanisms in one hour;
//    a 48-hour creep hurting MOBILE at 09:00 and RBANK at 15:00);
//  - the fallback causes are only the same episode while the incidents overlap or follow within two hours (R-9).
// A card's later victims inherit a filed RCA: the same card is the same event. A fallback cause's later one does not
// (A13: an RCA filed at 10:00 for a CARDAUTH miss used to cover four incidents at 13:00 unseen); it is listed as new.
// Pure.

import { TICKS_PER_HOUR } from '../../sim/core/units';
import { fallbackCause } from '../rcaTruth';
import type { Incident } from '../types';

/** How long after a fallback-caused incident ends a later one of the same cause still joins its group. */
export const GROUP_FOLLOW_HOURS = 2;

/** What grouping and the group's lead need from an incident: a new one has no `rcaGroup` yet. */
export type CausedIncident = Pick<Incident, 'day' | 'startTick' | 'endTick' | 'truth'>;

/** Whether two incidents share one root cause and therefore one RCA (§4.5). */
export function sameCause(a: CausedIncident, b: CausedIncident): boolean {
  const ca = a.truth.cause;
  const cb = b.truth.cause;
  // Saves written before RT-07 carry no cause: keep the labels' grouping they were judged by.
  if (ca === undefined || cb === undefined) {
    return a.day === b.day && a.truth.mechanism === b.truth.mechanism && a.truth.trigger === b.truth.trigger;
  }
  if (ca !== cb) return false;
  if (!fallbackCause(ca)) return a.day === b.day;
  // Overlap, or follow within GROUP_FOLLOW_HOURS: an incident still open overlaps any later one.
  const [first, later] = a.startTick <= b.startTick ? [a, b] : [b, a];
  return first.endTick === null || later.startTick <= first.endTick + GROUP_FOLLOW_HOURS * TICKS_PER_HOUR;
}

/**
 * The earlier incident a new one joins, if any, and whose RCA then covers it. A filed RCA is inherited only through the
 * same card; a fallback cause whose group is filed is listed as new instead (§4.5).
 */
export function groupLead(incidents: readonly Incident[], candidate: CausedIncident): Incident | null {
  const cause = candidate.truth.cause;
  const fallback = cause !== undefined && fallbackCause(cause);
  for (const lead of incidents) {
    if (lead.rcaGroup !== undefined || !sameCause(lead, candidate)) continue;
    // A filed fallback group is no longer the same episode (A13), so a later incident joins an unfiled one of it.
    if (fallback && lead.rca !== null) continue;
    return lead;
  }
  return null;
}

/** The incident with its group link and, when the group already has an RCA, that RCA (§4.5). */
export function groupIncident(incidents: readonly Incident[], inc: Incident): Incident {
  const lead = groupLead(incidents, inc);
  return lead ? { ...inc, rca: lead.rca, rcaGroup: lead.id } : inc;
}
