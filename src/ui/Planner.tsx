import type { Forecast } from '../game/planner';
import type { ViewModel } from '../game/view';
import { LineChart, type Series } from './LineChart';
import { Empty } from './Empty';

const f1 = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));

/** Capacity planner: recorded daily peaks plus a two-week projection with a 90% band. */
export function Planner({ v }: { v: ViewModel }) {
  const p = v.planner;
  if (!p) return null;
  return (
    <div className="panel">
      <h3>Capacity plan ({p.daysRecorded} days measured)</h3>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        Trends fitted to the daily peaks of the last {Math.min(10, p.daysRecorded)} days and projected two weeks ahead. The band is a 90% prediction interval: it
        widens with the horizon and with day-to-day noise. It knows nothing about tomorrow&apos;s events or month-end.
      </p>
      {p.forecasts.length === 0 && <Empty>Needs at least three measured days.</Empty>}
      <div className="grid">
        {p.forecasts.map((f) => (
          <ForecastChart key={f.id} f={f} />
        ))}
      </div>
    </div>
  );
}

function verdict(f: Forecast): string {
  const g = `${f.growthPerDay >= 0 ? '+' : ''}${(f.growthPerDay * 100).toFixed(1)}%/day`;
  if (f.limit === null) return `Trend ${g}.`;
  if (f.history.at(-1)!.value >= f.limit) return `Trend ${g}: already at or above ${f.limitLabel}.`;
  if (f.crossDay !== null) return `Trend ${g}: reaches ${f.limitLabel} around day ${f.crossDay + 1} (could be as early as day ${f.riskDay! + 1}).`;
  if (f.riskDay !== null) return `Trend ${g}: stays below ${f.limitLabel}, but the upper band touches it from day ${f.riskDay + 1}.`;
  return `Trend ${g}: below ${f.limitLabel} for the next two weeks.`;
}

function ForecastChart({ f }: { f: Forecast }) {
  const days = [...f.history.map((h) => h.day), ...f.points.map((p) => p.day)];
  const at = (d: number) => f.points.find((p) => p.day === d);
  const lastHist = f.history.at(-1)!;
  const series: Series[] = [
    { id: 'measured', color: 'var(--series-1)', values: days.map((d) => f.history.find((h) => h.day === d)?.value ?? null) },
    // The forecast starts from the last measured day so the lines join.
    { id: 'trend', color: 'var(--series-2)', values: days.map((d) => (d === lastHist.day ? lastHist.value : (at(d)?.mid ?? null))) },
    { id: '90% high', color: 'var(--muted)', values: days.map((d) => at(d)?.hi ?? null) },
    { id: '90% low', color: 'var(--muted)', values: days.map((d) => at(d)?.lo ?? null) },
  ];
  const risky = f.riskDay !== null;
  return (
    <div>
      <div className="form">
        <b style={{ fontSize: 13 }}>{f.title}</b>
        {risky && <span className={`tag ${f.crossDay !== null ? 'bad' : 'warn'}`}>{f.crossDay !== null ? 'will cross' : 'at risk'}</span>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        {verdict(f)} Last measured {f1(lastHist.value)} {f.unit}.
      </div>
      <LineChart
        title={f.title}
        unit={f.unit}
        xLabels={days.map((d) => `D${d + 1}`)}
        series={series}
        reference={f.limit !== null ? { value: f.limit, label: f.limitLabel ?? '' } : undefined}
      />
    </div>
  );
}
