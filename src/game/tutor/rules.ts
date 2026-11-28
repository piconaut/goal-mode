// Prologue-only rules (PRO-02, docs/prologue-design.md §8.1, §11.2, §14): each is gated on the content's `prologue`
// and the run's `tutor`, so a normal run can never reach one.
import type { GameContent } from '../run/shared';
import { rcaLeadId } from '../run/rca';
import type { Facet, Incident, RunState } from '../types';
import { currentStep } from './engine';

export const inPrologue = (run: RunState, content: GameContent): boolean => !!content.prologue && !!run.tutor;

/** The change failure risk in the prologue: zero, except the first change while a `failFirstChange` beat is current,
 *  which fails (§8.1, §5.3 W4). Null on a normal run, which keeps its own roll. */
export function prologueChangeRisk(run: RunState, content: GameContent): number | null {
  if (!inPrologue(run, content)) return null;
  const beat = currentStep(run, content.prologue!)?.beat;
  return beat?.failFirstChange && !run.tutor!.scriptedFailures.includes(beat.id) ? 1 : 0;
}

/** Record that the current beat's scripted failure has happened. */
export function markScriptedFailure(run: RunState, content: GameContent): RunState {
  const beat = inPrologue(run, content) ? currentStep(run, content.prologue!)?.beat : undefined;
  if (!beat?.failFirstChange || run.tutor!.scriptedFailures.includes(beat.id)) return run;
  return { ...run, tutor: { ...run.tutor!, scriptedFailures: [...run.tutor!.scriptedFailures, beat.id] } };
}

/** Whether this incident's filed RCA may be filed again (one refile per prologue RCA, §14 decision 6). */
export function canRefile(run: RunState, content: GameContent, inc: Incident): boolean {
  if (!inPrologue(run, content) || !inc.rca) return false;
  return (run.tutor!.refiles[String(rcaLeadId(inc))]?.count ?? 0) < content.prologue!.refilesPerRca;
}

/** Take a filing back before the refile: its trust, Insight and score come off, and the group's RCA is cleared. */
export function withdrawRca(run: RunState, inc: Incident): RunState {
  const lead = String(rcaLeadId(inc));
  const rec = run.tutor!.refiles[lead];
  if (!rec) return run;
  const trust = Object.fromEntries(Object.entries(run.trust).map(([f, v]) => [f, v - (rec.trust[f as Facet] ?? 0)])) as Record<Facet, number>;
  return {
    ...run,
    trust,
    insight: run.insight - rec.insight,
    score: run.score - rec.score,
    incidents: run.incidents.map((i) => (String(rcaLeadId(i)) === lead ? { ...i, rca: null } : i)),
    tutor: { ...run.tutor!, refiles: { ...run.tutor!.refiles, [lead]: { ...rec, count: rec.count + 1 } } },
  };
}

/** Keep what a prologue filing changed, so a refile can take it back. */
export function recordFiling(before: RunState, after: RunState, content: GameContent, inc: Incident): RunState {
  if (!inPrologue(after, content)) return after;
  const lead = String(rcaLeadId(inc));
  const count = after.tutor!.refiles[lead]?.count ?? 0;
  const trust = Object.fromEntries(Object.keys(after.trust).map((f) => [f, after.trust[f]! - (before.trust[f] ?? 0)])) as Record<Facet, number>;
  return { ...after, tutor: { ...after.tutor!, refiles: { ...after.tutor!.refiles, [lead]: { count, trust, insight: after.insight - before.insight, score: after.score - before.score } } } };
}

/** The silent trust floor at a day's end (§8.1): no facet ends a prologue day below it. */
export function floorTrust(trust: Record<Facet, number>, content: GameContent): Record<Facet, number> {
  const floor = content.prologue!.trustFloor;
  return Object.fromEntries(Object.entries(trust).map(([f, v]) => [f, Math.max(floor, v)])) as Record<Facet, number>;
}
