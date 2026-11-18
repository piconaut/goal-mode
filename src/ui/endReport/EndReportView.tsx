// The end-of-run report: grade, biggest incident, best RCA, the daily charts and the decision list.
// Split from `Overlays.tsx` (CL-38).

import { piColor, seriesColor } from '../colors';
import { LineChart } from '../LineChart';
import type { EndReport } from '../../game/endReport';

export function EndReportView({ r }: { r: EndReport }) {
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <h3>
        Grade <span style={{ fontSize: '1.6em' }}>{r.grade}</span> <span className="muted">({r.points}/100)</span>
      </h3>
      <p className="muted">
        {r.daysPlayed} of the quarter's days played · mean SLA attainment {r.meanSlaPct.toFixed(1)}% · final trust {Math.round(r.overallTrust)}
        {r.endlessDays !== null && ` · ${r.endlessDays} endless days after the quarter closed`}
        {!r.victory && ' · runs that end early grade B at best'}
      </p>
      {r.biggestIncident && (
        <p>
          Biggest incident: <b>{r.biggestIncident.workloadId}</b> on day {r.biggestIncident.day + 1}, {r.biggestIncident.hours} h: {r.biggestIncident.cause}.
        </p>
      )}
      <p>{r.bestRca ? <>Best RCA: <b>{r.bestRca.workloadId}</b> on day {r.bestRca.day + 1}, {r.bestRca.points} points: {r.bestRca.cause}.</> : 'No root cause analysis scored points.'}</p>
      {r.r4haByLpar.lparIds.length > 0 && r.days.length >= 2 && (
        <LineChart
          title="Daily peak R4HA per LPAR"
          unit="MSU"
          xLabels={r.days.map((d) => `day ${d.day + 1}`)}
          series={r.r4haByLpar.lparIds.map((id, i) => ({ id, color: seriesColor(i), values: r.r4haByLpar.byDay[i]! }))}
        />
      )}
      <details>
        <summary>Day by day</summary>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Score</th>
              <th>Worst SLA</th>
              <th>Peak R4HA sum (MSU)</th>
              <th>Batch</th>
            </tr>
          </thead>
          <tbody>
            {r.days.map((d) => (
              <tr key={d.day}>
                <td>{d.day + 1}</td>
                <td>{d.score}</td>
                <td>{d.worstSlaPct.toFixed(1)}%</td>
                <td>{d.peakR4haSum === null ? <span className="muted">-</span> : Math.round(d.peakR4haSum)}</td>
                <td>{d.batchMissed ? <span className="tag bad">missed</span> : 'on time'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {r.piHeat.scKeys.length > 0 && (
        <details>
          <summary>PI heat map (worst interval per day)</summary>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  {r.days.map((d) => (
                    <th key={d.day} className="num">
                      {d.day + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.piHeat.scKeys.map((k, i) => (
                  <tr key={k}>
                    <td>{k}</td>
                    {r.piHeat.byDay[i]!.map((pi, d) => (
                      <td key={d} className="num" style={{ background: piColor(pi), padding: '2px 4px' }} title={`${k} day ${d + 1}: PI ${pi === null ? '-' : pi.toFixed(2)}`}>
                        {pi === null ? '' : pi.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details>
        <summary>Decisions ({r.decisions.length} changes applied)</summary>
        <ul>
          {r.decisions.map((d, i) => (
            <li key={i}>
              Day {d.day + 1}: {d.label}
              {d.emergency && <span className="tag bad"> emergency</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
