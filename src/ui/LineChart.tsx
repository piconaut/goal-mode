// Small multi-series line chart: one y-axis, 2px lines, crosshair + tooltip listing every
// series, legend, direct end labels and a table view (dataviz rules).

import { useMemo, useState } from 'react';

export interface Series {
  id: string;
  color: string;
  values: (number | null)[];
}

interface Props {
  title: string;
  unit: string;
  xLabels: string[];
  series: Series[];
  /** Optional horizontal reference line (e.g. defined capacity). */
  reference?: { value: number; label: string };
}

const W = 560;
const H = 180;
const PAD = { l: 44, r: 64, t: 8, b: 22 };

export function LineChart({ title, unit, xLabels, series, reference }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const n = xLabels.length;
  const max = useMemo(() => {
    let m = reference?.value ?? 0;
    for (const s of series) for (const v of s.values) if (v !== null && v > m) m = v;
    return niceMax(m);
  }, [series, reference]);
  if (n < 2) return <div className="muted">Collecting samples (every 5 simulated minutes)…</div>;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / (n - 1);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const xTicks = xLabels.map((l, i) => ({ l, i })).filter((t, i) => i % Math.max(1, Math.ceil(n / 6)) === 0);
  const path = (vals: (number | null)[]) =>
    vals.reduce((d, v, i) => (v === null ? d : `${d}${d === '' || vals[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '');

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="chart">
      <div className="legend" aria-label={`${title} legend`}>
        {series.map((s) => (
          <span key={s.id}>
            <i style={{ background: s.color }} />
            {s.id}
          </span>
        ))}
        {reference && <span>┄ {reference.label}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
              {fmt(t)}
            </text>
          ))}
          {xTicks.map((t) => (
            <text key={t.i} x={x(t.i)} y={H - 6} textAnchor="middle">
              {t.l}
            </text>
          ))}
        </g>
        {reference && <line x1={PAD.l} x2={W - PAD.r} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--muted)" strokeDasharray="4 4" />}
        {series.map((s) => (
          <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const last = lastIndex(s.values);
          if (last < 0) return null;
          return (
            <text key={`l-${s.id}`} x={x(last) + 6} y={y(s.values[last]!) + 4} fontSize={11} fill="var(--text)">
              {s.id}
            </text>
          );
        })}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1} />
            {series.map((s) =>
              s.values[hover] !== null && s.values[hover] !== undefined ? <circle key={s.id} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} /> : null,
            )}
          </>
        )}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 24, transform: x(hover) > W / 2 ? 'translateX(-105%)' : 'translateX(5%)' }}>
          <div className="muted">{xLabels[hover]}</div>
          {series.map((s) => (
            <div key={s.id}>
              <b>{s.values[hover] === null ? '-' : fmt(s.values[hover]!)}</b> <span className="muted">{s.id}</span>
            </div>
          ))}
        </div>
      )}
      <details>
        <summary>Table view</summary>
        <div style={{ maxHeight: 200, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>time</th>
                {series.map((s) => (
                  <th key={s.id} className="num">
                    {s.id} ({unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xLabels.map((l, i) => (
                <tr key={i}>
                  <td className="num">{l}</td>
                  {series.map((s) => (
                    <td key={s.id} className="num">
                      {s.values[i] === null ? '-' : fmt(s.values[i]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function niceMax(m: number): number {
  if (m <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  for (const f of [1, 2, 2.5, 5, 10]) if (m <= f * p) return f * p;
  return 10 * p;
}
const fmt = (v: number) => (v === 0 ? '0' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const lastIndex = (vals: (number | null)[]) => {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return i;
  return -1;
};
