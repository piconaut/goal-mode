// The day's report card, shown in the briefing, the review and the tab-bar overlay.

import type { ViewModel } from '../../game/view';
import { clockAt, hhmm } from '../../sim/core/clock';
import { GATEWAY_MODE_LABEL } from '../labels';

/** A tick as `D2 05:00`: a recall hold can span the 06:00 day boundary, so the time alone would repeat across days. */
const dayClock = (tick: number): string => `D${clockAt(tick).day + 1} ${hhmm(tick)}`;

export function DaySummary({ v }: { v: ViewModel }) {
  const r = v.lastReport!;
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <h3>Day {r.day + 1} report card</h3>
      <table>
        <tbody>
          {r.sla.map((s) => (
            <tr key={s.workloadId}>
              <td>{s.workloadId}</td>
              <td className="muted">{s.target}</td>
              <td>
                <span className={`tag ${s.breachHours === 0 ? 'good' : 'bad'}`}>{s.breachHours === 0 ? 'met' : `${s.breachHours}h breached`}</span>
              </td>
            </tr>
          ))}
          <tr>
            <td>Batch</td>
            <td className="muted">critical path by {v.batch.deadline}</td>
            <td>
              <span className={`tag ${r.batchMissed ? 'bad' : 'good'}`}>{r.batchMissed ? 'MISSED' : 'on time'}</span>
            </td>
          </tr>
          {r.gateway?.map((g) => (
            <tr key={`gateway-${g.id}`}>
              <td>Gateway · {g.name}</td>
              <td className="muted">protection enabled</td>
              <td>
                <span className="tag warn">{GATEWAY_MODE_LABEL[g.mode]}</span>
              </td>
            </tr>
          ))}
          {r.recalls && (
            <tr>
              <td>DFSMShsm recalls</td>
              <td className="muted">{Math.round(r.recalls.backlogIo).toLocaleString()} queued I/Os</td>
              <td>
                {r.recalls.held
                  ? <span className="tag bad">HELD{r.recalls.heldSinceTick !== null ? ` since ${dayClock(r.recalls.heldSinceTick)}` : ''}</span>
                  : <span className="tag warn">released</span>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 6 }}>
        Score {r.score} · MLC estimate ${Math.round(r.mlcEstimate / 1000)}k · events: {r.events.join(', ') || 'none noticed'}
      </div>
    </div>
  );
}
