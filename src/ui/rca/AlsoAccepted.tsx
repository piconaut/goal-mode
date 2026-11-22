// The other accepted trigger answers for an incident group. Split from `Overlays.tsx` (CL-38).

import { TRIGGER_LABEL } from '../../content/rca';
import { alsoAcceptedOf } from '../../game/run/rca';
import type { Incident, Trigger } from '../../game/types';

/** The reply names the group's primary and its other accepted answers, one line of reasoning each (RT-07, §4.5). */
export function AlsoAccepted({ group }: { group: readonly Incident[] }) {
  const rest = alsoAcceptedOf(group);
  if (rest.length === 0) return null;
  return (
    <>
      {rest.map(({ answer, why }) => (
        <div key={answer} className="muted" style={{ fontSize: 12, paddingLeft: 12 }}>
          also accepted: <b>{TRIGGER_LABEL[answer as Trigger] ?? answer}</b>
          {why ? ` — ${why}` : ''}
        </div>
      ))}
    </>
  );
}
