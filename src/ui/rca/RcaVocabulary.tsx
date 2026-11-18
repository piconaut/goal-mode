// Plain-language definitions for the RCA selectors. Split from `Overlays.tsx` (CL-38).

import { MECHANISM_HELP, TRIGGER_HELP, triggerLabel } from '../../content/rca';
import { MECHANISMS, TRIGGERS } from '../../game/sla';

/** Plain-language definitions for the RCA selectors (content/rca.ts), opened once above the incidents. */
export function RcaVocabulary() {
  return (
    <details style={{ fontSize: 12, marginBottom: 8 }}>
      <summary className="muted">What do the mechanism and trigger mean?</summary>
      <p className="muted" style={{ margin: '4px 0' }}>
        Mechanism: where the time went. Trigger: what set it off.
      </p>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <b>Mechanism</b>
          {MECHANISMS.map((x) => (
            <div key={x} style={{ margin: '2px 0' }}>
              <span className="tag">{x}</span> <span className="muted">{MECHANISM_HELP[x]}</span>
            </div>
          ))}
        </div>
        <div>
          <b>Trigger</b>
          {TRIGGERS.map((x) => (
            <div key={x} style={{ margin: '2px 0' }}>
              <b>{triggerLabel(x)}</b> <span className="tag">{x}</span> <span className="muted">{TRIGGER_HELP[x]}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
