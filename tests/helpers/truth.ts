// Hand-built incidents in tests: the truth a fixture stands for, with the accepted set the real rules would give for a
// primary answer, and the empty subjects of work that runs nowhere in particular.
import type { IncidentSubjects, IncidentTruth, Mechanism, Trigger } from '../../src/game/types';

/** The truth of an incident whose primary answer is `mechanism`/`trigger`, accepted alone. */
export function truthOf(mechanism: Mechanism, trigger: Trigger, over: Partial<IncidentTruth> = {}): IncidentTruth {
  return { mechanism, trigger, accepted: { mechanisms: [mechanism], triggers: [trigger] }, cause: `none:${mechanism}:PROD1`, ...over };
}

/** No classes, images, regions or servers recorded: a fixture that does not judge subjects. */
export const EMPTY_SUBJECTS: IncidentSubjects = { classes: [], lpars: [], hosts: [], servers: [], serverClasses: [] };
