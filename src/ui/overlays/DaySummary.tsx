// The day's report card, shown in the briefing, the review and the tab-bar overlay.

import type { ViewModel } from '../../game/view';

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
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 6 }}>
        Score {r.score} · MLC estimate ${Math.round(r.mlcEstimate / 1000)}k · events: {r.events.join(', ') || 'none noticed'}
      </div>
    </div>
  );
}
