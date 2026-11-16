// Grouping incidents by root cause for the one-RCA rule (RT-15, docs/rca-design.md §4.5, A13).
//
// `truth.cause` names the cause (RT-07): the blamed card's `uid`, `new:<workload>`, `change:<id>`, or
// `none:<family>:<host>`. Incidents of equal cause group, and one RCA covers the group:
//  - a card is one cause for a whole played day, however far apart its victims fall (R-7: two mechanisms in one hour;
//    a 48-hour creep hurting MOBILE at 09:00 and RBANK at 15:00);
//  - the fallback causes are only the same episode while the incidents overlap or follow within two hours (R-9).
// A card's later victims inherit a filed RCA: the same card is the same event. A fallback cause's later one does not
// (A13: an RCA filed at 10:00 for a CARDAUTH miss used to cover four incidents at 13:00 unseen); it is listed as new.
// A group never crosses the 06:00 roll: the review files one RCA per played day. Pure.

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
  // One RCA per played day, so a group never crosses the 06:00 roll: an incident left open there is closed and the
  // new day's continuation is written up on its own.
  if (ca !== cb || a.day !== b.day) return false;
  if (!fallbackCause(ca)) return true;
  // Overlap, or follow within GROUP_FOLLOW_HOURS: an incident still open overlaps any later one.
  const [first, later] = a.startTick <= b.startTick ? [a, b] : [b, a];
  return first.endTick === null || later.startTick <= first.endTick + GROUP_FOLLOW_HOURS * TICKS_PER_HOUR;
}

/**
 * The groups the new incident joins, earliest first: every group of its cause that it overlaps or follows, measured
 * from any member — a fallback episode is as long as its group, not its lead. A filed fallback group is left out: its
 * RCA is not inherited and it is not merged into a new one (A13).
 */
function joinableGroups(incidents: readonly Incident[], candidate: CausedIncident): Incident[] {
  const fallback = candidate.truth.cause !== undefined && fallbackCause(candidate.truth.cause);
  const ids = new Set<number>();
  for (const i of incidents) if (sameCause(i, candidate)) ids.add(i.rcaGroup ?? i.id);
  return [...ids]
    .map((id) => incidents.find((i) => i.id === id))
    .filter((lead): lead is Incident => lead !== undefined)
    .filter((lead) => !(fallback && lead.rca !== null))
    .sort((a, b) => a.id - b.id);
}

/** The earliest group the new incident joins, if any: the group whose RCA then covers it (§4.5). */
export function groupLead(incidents: readonly Incident[], candidate: CausedIncident): Incident | null {
  return joinableGroups(incidents, candidate)[0] ?? null;
}

/**
 * `incidents` with `inc` added to its cause's group (§4.5). A retrospective incident — the batch night, which spans
 * hours that hold two unfiled episodes of one cause — coalesces those episodes into one group instead of leaving two
 * RCAs for one cause.
 */
export function addGroupedIncident(incidents: readonly Incident[], inc: Incident): Incident[] {
  const groups = joinableGroups(incidents, inc);
  const root = groups[0];
  if (!root) return [...incidents, inc];
  const superseded = new Set(groups.slice(1).map((g) => g.id));
  const relink = (i: Incident): Incident => (superseded.has(i.rcaGroup ?? i.id) ? { ...i, rcaGroup: root.id } : i);
  return [...incidents.map(relink), { ...inc, rca: root.rca, rcaGroup: root.id }];
}
