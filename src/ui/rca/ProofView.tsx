// Each filed claim's proof recipe and its two predicates. Split from `Overlays.tsx` (CL-38).

import { idText } from '../../game/ids';
import { predicateText, recipeHeading, type ProofResult } from '../../game/proof';

/** Each filed claim's proof recipe, its two predicates ticked or not (RT-13), worded as the play CLI's reply; the
 *  hour-base note was recorded at filing (RT-30), so a later unpin cannot change it. */
export function ProofView({ proof, note }: { proof: ProofResult; note?: string }) {
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
