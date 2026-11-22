// The day's operations log. Split from `App.tsx` (CL-38).

import type { ViewModel } from '../../game/view';
import { Empty } from '../Empty';

export function OpsLog({ v, className }: { v: ViewModel; className: string }) {
  return (
    <div className={`panel ${className}`}>
      <h3>Operations log</h3>
      {v.log.length === 0 ? (
        <Empty>Nothing logged yet today.</Empty>
      ) : (
        <div className="log">
          {[...v.log].reverse().map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
