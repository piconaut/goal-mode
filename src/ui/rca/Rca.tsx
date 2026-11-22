// One incident's root-cause form: mechanism, trigger and the pinned evidence to submit. Split from `Overlays.tsx` (CL-38).

import { useState } from 'react';
import { EVIDENCE } from '../../content/evidence';
import { MECHANISM_HELP, TRIGGER_HELP, triggerLabel } from '../../content/rca';
import type { Hypothesis } from '../../game/aiops';
import { MECHANISMS, TRIGGERS } from '../../game/sla';
import type { Mechanism, Trigger } from '../../game/types';
import type { ViewModel } from '../../game/view';
import type { GameHandle } from '../useGame';

export function Rca({ incidentId, label, hypotheses, v, game }: { incidentId: number; label: string; hypotheses: Hypothesis[]; v: ViewModel; game: GameHandle }) {
  const [m, setM] = useState<Mechanism>('CPU_PRIORITY');
  const [t, setT] = useState<Trigger>('POLICY');
  const [ev, setEv] = useState<number[]>([]);
  const toggle = (id: number) => setEv(ev.includes(id) ? ev.filter((x) => x !== id) : ev.length < EVIDENCE.perRca ? [...ev, id] : ev);
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
      <div className="form">
        <span style={{ minWidth: 220 }}>{label}</span>
        <select aria-label="Mechanism" value={m} onChange={(e) => setM(e.target.value as Mechanism)}>
          {MECHANISMS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select aria-label="Trigger" value={t} onChange={(e) => setT(e.target.value as Trigger)}>
          {TRIGGERS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button onClick={() => game.send({ type: 'RCA', incidentId, mechanism: m, trigger: t, evidenceIds: ev })}>Submit{ev.length ? ` with ${ev.length} evidence` : ''}</button>
      </div>
      <div className="muted" style={{ fontSize: 11, paddingLeft: 12 }}>
        <div>
          <b>{m}</b>: {MECHANISM_HELP[m]}
        </div>
        <div>
          <b>{triggerLabel(t)}</b>: {TRIGGER_HELP[t]}
        </div>
      </div>
      {hypotheses.length > 0 && (
        <div style={{ fontSize: 12, paddingLeft: 12 }}>
          <span className="muted">AIOps hypotheses (can be wrong):</span>
          {hypotheses.map((h, k) => (
            <div key={k} className="form" style={{ margin: '2px 0' }}>
              <span>
                {k + 1}. {h.mechanism} / {triggerLabel(h.trigger)} · {Math.round(h.confidence * 100)}%
              </span>
              <button
                onClick={() => {
                  setM(h.mechanism);
                  setT(h.trigger);
                }}
              >
                use
              </button>
            </div>
          ))}
        </div>
      )}
      {v.pins.length > 0 && (
        <div style={{ fontSize: 12, paddingLeft: 12 }}>
          <span className="muted">
            Evidence ({ev.length}/{EVIDENCE.perRca}):
          </span>
          {[...v.pins].reverse().map((p) => (
            <label key={p.id} style={{ display: 'block' }}>
              <input type="checkbox" checked={ev.includes(p.id)} disabled={!ev.includes(p.id) && ev.length >= EVIDENCE.perRca} onChange={() => toggle(p.id)} /> {p.text}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
