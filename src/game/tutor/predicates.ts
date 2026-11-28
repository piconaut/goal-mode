// The prologue's step predicates (PRO-02, docs/prologue-design.md §6.2, §11.2): named pure functions over the run,
// its recorded navigation notes and the undo base. Content names them by id (`TutorPredicateRef`); no closures in
// content. Each chapter's PR adds the predicates its steps need.
import type { TutorPredicateRef } from '../../content/types';
import type { RunState } from '../types';

type Args = Record<string, string | number>;
type Predicate = (run: RunState, args: Args) => boolean;

const str = (args: Args, key: string): string | undefined => (args[key] === undefined ? undefined : String(args[key]));

export const TUTOR_PREDICATES: Record<string, Predicate> = {
  /** Completed only by the player's Next (`TUTOR_ACK`). */
  ack: () => false,
  /** The UI reported this navigation (`TUTOR_NOTE { kind, ref }`); without `ref`, any of that kind. */
  noted: (run, args) => (run.tutor?.notes ?? []).some((n) => n.kind === str(args, 'kind') && (str(args, 'ref') === undefined || n.ref === str(args, 'ref'))),
  /** A card has started (by its id). */
  cardStarted: (run, args) => run.events.some((e) => e.defId === str(args, 'card') && e.started),
  /** A card has ended. */
  cardEnded: (run, args) => run.events.some((e) => e.defId === str(args, 'card') && e.ended),
  /** An incident is open or was opened today, optionally for one workload. */
  incidentOpened: (run, args) => run.incidents.some((i) => i.day === run.day && (str(args, 'workload') === undefined || i.workloadId === str(args, 'workload'))),
  /** An RCA was filed, optionally for an incident of one workload. */
  rcaFiled: (run, args) => run.incidents.some((i) => i.rca && (str(args, 'workload') === undefined || i.workloadId === str(args, 'workload'))),
  /** A pin of a metric exists, optionally of a report source. */
  pinned: (run, args) => run.pins.some((p) => p.metric === str(args, 'metric') && (str(args, 'source') === undefined || p.source === str(args, 'source'))),
  /** A tool is owned. */
  toolOwned: (run, args) => run.tools.includes(String(args.tool)),
  /** The run is in a phase (BRIEFING, LIVE, REVIEW). */
  phase: (run, args) => run.phase === str(args, 'phase'),
};

/** Whether a named predicate holds; an unknown id is a content error. */
export function holds(run: RunState, ref: TutorPredicateRef): boolean {
  const p = TUTOR_PREDICATES[ref.id];
  if (!p) throw new Error(`Unknown tutor predicate ${ref.id}`);
  return p(run, ref.args ?? {});
}
