// The Ops Console capacity charts: MSU per CPC and the rolling 4-hour average. Split from `App.tsx` (CL-38).

import { hhmm } from '../../sim/core/clock';
import type { HistoryPoint } from '../../game/history';
import type { ViewModel } from '../../game/view';
import { CodexHints } from '../CodexHint';
import { LineChart } from '../LineChart';
import { seriesColor } from '../colors';

/** Day (0-based) a history sample belongs to: the day's ticks run (day·T, (day+1)·T]. */
const sampleDay = (tick: number, ticksPerDay: number) => Math.max(0, Math.ceil(tick / ticksPerDay) - 1);

export function Capacity({ v, history }: { v: ViewModel; history: HistoryPoint[] }) {
  // The played day's samples; before the next day's first sample, keep the last day on screen.
  const last = history.at(-1);
  const day = last && !history.some((p) => sampleDay(p.tick, v.ticksPerDay) === v.day) ? sampleDay(last.tick, v.ticksPerDay) : v.day;
  const pts = history.filter((p) => sampleDay(p.tick, v.ticksPerDay) === day);
  const xLabels = pts.map((p) => hhmm(p.tick));
  const lpars = v.lpars.filter((l) => l.kind === 'ZOS');
  // Colours follow the LPAR across the per-CPC MSU charts and the R4HA chart.
  const series = (key: 'msu' | 'r4ha', ids: string[]) =>
    ids.map((id) => ({ id, color: seriesColor(lpars.findIndex((l) => l.id === id)), values: pts.map((p) => p[key][id] ?? null) }));
  // One MSU chart per CPC: each CPC's LPARs against its own installed capacity.
  const cpcIds = [...new Set(lpars.map((l) => l.cpcId))];
  const note = (text: string) => <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{text}</div>;
  return (
    <div className="panel" style={{ gridColumn: '1 / -1' }}>
      <h3>
        {day === v.day ? 'Capacity today' : `Capacity, day ${day + 1}`}
        <CodexHints ids={['r4ha']} />
      </h3>
      <div className="grid">
        {cpcIds.map((cpcId) => (
          <div key={cpcId}>
            {note(`${cpcIds.length > 1 ? `${cpcId}: ` : ''}MSU per LPAR, stacked (5-minute samples); dashed: installed CP capacity, higher while On/Off CoD is active`)}
            <LineChart
              title={`MSU per LPAR on ${cpcId}`}
              unit="MSU"
              xLabels={xLabels}
              stacked
              series={[
                ...series('msu', lpars.filter((l) => l.cpcId === cpcId).map((l) => l.id)),
                { id: 'CP capacity', color: 'var(--muted)', dashed: true, overlay: true, values: pts.map((p) => p.capacityMsu?.[cpcId] ?? null) },
              ]}
            />
          </div>
        ))}
        <div>
          {note('Rolling 4-hour average per LPAR (drives soft capping and the MLC bill)')}
          <LineChart title="R4HA per LPAR" unit="MSU" xLabels={xLabels} series={series('r4ha', lpars.map((l) => l.id))} />
        </div>
      </div>
    </div>
  );
}
