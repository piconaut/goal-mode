// Each filed claim's proof recipe and its two predicates. Split from `Overlays.tsx` (CL-38).

import { idText } from '../../game/ids';
import { hourBaseNote, predicateText, recipeHeading, type ProofResult } from '../../game/proof';
import type { CapacityBasis } from '../../game/types';
import type { EvidencePin } from '../../game/evidence';

/** Each filed claim's proof recipe, its two predicates ticked or not (RT-13), worded as the play CLI's reply. */
export function ProofView({ proof, pins, basis }: { proof: ProofResult; pins: readonly EvidencePin[]; basis?: CapacityBasis | null }) {
  const note = hourBaseNote(proof, pins, basis);
  return (
    <>
      {([['Mechanism', proof.mechanism], ['Trigger', proof.trigger]] as const).map(([what, c]) => (
        <div key={what} style={{ fontSize: 12, paddingLeft: 12 }}>
          <div>{recipeHeading(c, what)}</div>
          {c.predicates.map((x, k) => (
            <div key={k} className="muted" style={{ paddingLeft: 12 }}>
              {predicateText(x, (id) => idText('pin', id))}
            </div>
          ))}
        </div>
      ))}
      {note && (
        <div className="muted" style={{ fontSize: 12, paddingLeft: 12 }}>
          {note}
        </div>
      )}
    </>
  );
}
