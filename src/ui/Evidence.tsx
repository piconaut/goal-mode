import type { PinRequest } from '../game/evidence';
import type { ViewModel } from '../game/view';
import type { GameHandle } from './useGame';

/** Small pin button next to a value: sends the locator; the worker reads the value itself. */
export function PinButton({ game, req, label }: { game: GameHandle; req: PinRequest; label: string }) {
  return (
    <button className="pin" title={`Pin as RCA evidence: ${label}`} aria-label={`Pin ${label}`} onClick={() => game.send({ type: 'PIN', req })}>
      📌
    </button>
  );
}

/** Pinned evidence, attachable to root-cause analyses at the end of the day. */
export function EvidenceBoard({ v, game }: { v: ViewModel; game: GameHandle }) {
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>Evidence board ({v.pins.length})</h3>
      {v.pins.length === 0 ? (
        <div className="muted">Pin values that explain an incident (📌 next to report values). Attach up to three to each root-cause analysis: evidence that points at the real cause earns extra points.</div>
      ) : (
        <ul className="diff">
          {[...v.pins].reverse().map((p) => (
            <li key={p.id}>
              <span>{p.text}</span>
              <button aria-label={`Unpin ${p.text}`} onClick={() => game.send({ type: 'UNPIN', id: p.id })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
