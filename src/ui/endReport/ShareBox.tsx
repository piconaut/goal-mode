// The shareable result line at the end of a run. Split from `Overlays.tsx` (CL-38).

import { useState } from 'react';
import { shareText } from '../../game/daily';
import type { EndReport } from '../../game/endReport';
import type { ViewModel } from '../../game/view';

export function ShareBox({ v, r }: { v: ViewModel; r: EndReport }) {
  const [copied, setCopied] = useState(false);
  const text = shareText({ seed: v.seed, difficulty: v.difficulty.name, daysPlayed: r.daysPlayed, maxDays: v.maxDays, endlessDays: r.endlessDays, grade: r.grade, points: r.points, score: v.score, daily: v.daily });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the text stays selectable */
    }
  };
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <div className="form">
        <input readOnly aria-label="Shareable result" value={text} style={{ fontFamily: 'monospace', flex: 1, minWidth: 0 }} onFocus={(e) => e.target.select()} />
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}
