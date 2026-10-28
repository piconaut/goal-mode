// Small multi-series line chart: one y-axis, 2px lines, crosshair + tooltip listing every
// series, legend, direct end labels and a table view (dataviz rules).

import { useMemo, useState } from 'react';

export interface Series {
  id: string;
  color: string;
  values: (number | null)[];
  /** Drawn dashed (limits and capacities rather than measurements). */
  dashed?: boolean;
  /** On a stacked chart: drawn as a line over the stack (e.g. a capacity), not added to it. */
  overlay?: boolean;
}

interface Props {
  title: string;
  unit: string;
  xLabels: string[];
  series: Series[];
  /** Optional horizontal reference line (e.g. defined capacity). */
  reference?: { value: number; label: string };
  /** Stacked areas (values are drawn cumulatively; tooltips show each part). */
  stacked?: boolean;
  /** Event markers at sample indices (WLM decisions, changes, events). */
  markers?: { i: number; kind: 'WLM' | 'CHANGE' | 'EVENT'; text: string }[];
  /** Drag across the plot to zoom; called with the selected index range. */
  onZoom?: (from: number, to: number) => void;
  emptyText?: string;
}

const W = 560;
const H = 180;
const PAD = { l: 44, r: 64, t: 8, b: 22 };
const LABEL_GAP = 12;
const MAX_END_LABELS = 8;

export function LineChart({ title, unit, xLabels, series, reference, stacked, markers, onZoom, emptyText }: Props) {
  const [hoverRaw, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const n = xLabels.length;
  // Stacked charts draw running totals; tooltips and the table keep the raw parts.
  const drawn = useMemo(() => {
    if (!stacked) return series.map((s) => s.values);
    const acc = new Array<number>(n).fill(0);
    return series.map((s) =>
      s.overlay ? s.values : s.values.map((v, i) => {
        acc[i] = (acc[i] ?? 0) + (v ?? 0);
        return acc[i]!;
      }),
    );
  }, [series, stacked, n]);
  // Each stacked band's lower edge is the previous stacked (non-overlay) series.
  const below = series.map((_, k) => {
    for (let j = k - 1; j >= 0; j--) if (!series[j]!.overlay) return j;
    return -1;
  });
  const line = (s: Series) => <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />;
  const max = useMemo(() => {
    let m = reference?.value ?? 0;
    for (const vals of drawn) for (const v of vals) if (v !== null && v > m) m = v;
    return niceMax(m);
  }, [drawn, reference]);
  // The series can shrink under a stale hover (zoom, day change).
  const hover = hoverRaw !== null && hoverRaw < n ? hoverRaw : null;
  if (n < 2) return <div className="muted">{emptyText ?? 'Collecting samples (every 5 simulated minutes)…'}</div>;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / (n - 1);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const xTicks = xLabels.map((l, i) => ({ l, i })).filter((t, i) => i % Math.max(1, Math.ceil(n / 6)) === 0);
  const path = (vals: (number | null)[]) =>
    vals.reduce((d, v, i) => (v === null ? d : `${d}${d === '' || vals[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '');

  const indexAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = indexAt(e);
    setHover(i);
    if (drag) setDrag({ ...drag, to: i });
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onZoom) return;
    const i = indexAt(e);
    setDrag({ from: i, to: i });
  };
  const onUp = () => {
    if (drag && onZoom && Math.abs(drag.to - drag.from) >= 2) onZoom(Math.min(drag.from, drag.to), Math.max(drag.from, drag.to));
    setDrag(null);
  };
  const markersAt = (i: number) => (markers ?? []).filter((m) => m.i === i);
  const area = (top: number[], bottom: number[] | null) =>
    `M${top.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('L')}L${(bottom ?? top.map(() => 0))
      .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .reverse()
      .join('L')}Z`;

  return (
    <div className="chart">
      <div className="legend" aria-label={`${title} legend`}>
        {series.map((s) => (
          <span key={s.id}>
            <i style={s.dashed ? { background: `repeating-linear-gradient(90deg, ${s.color} 0 3px, transparent 3px 5px)` } : { background: s.color }} />
            {s.id}
          </span>
        ))}
        {reference && <span>┄ {reference.label}</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={() => {
          setHover(null);
          setDrag(null);
        }}
        style={onZoom ? { cursor: 'crosshair', touchAction: 'pan-y' } : undefined}
      >
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
        {stacked &&
          series.map((s, k) =>
            s.overlay ? null : (
              <path key={`a-${s.id}`} d={area(drawn[k] as number[], below[k]! >= 0 ? (drawn[below[k]!] as number[]) : null)} fill={s.color} fillOpacity={0.55} stroke="var(--panel)" strokeWidth={1} />
            ),
          )}
        {series.filter((s) => !stacked || s.overlay).map(line)}
        {series.length <= MAX_END_LABELS &&
          endLabels(series.map((s, k) => ({ id: s.id, i: lastIndex(drawn[k]!), vals: drawn[k]! })).filter((l) => l.i >= 0).map((l) => ({ id: l.id, x: x(l.i), y: y(l.vals[l.i]!) })), PAD.t + 4, H - PAD.b).map((l) => (
            <text key={`l-${l.id}`} x={l.x + 6} y={l.y + 4} fontSize={11} fill="var(--text)">
              {l.id}
            </text>
          ))}
        {(markers ?? []).map((m, k) =>
          m.kind === 'WLM' ? (
            <line key={k} x1={x(m.i)} x2={x(m.i)} y1={PAD.t} y2={PAD.t + 5} stroke="var(--muted)" strokeWidth={1} />
          ) : (
            <line key={k} x1={x(m.i)} x2={x(m.i)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text)" strokeWidth={1} strokeDasharray={m.kind === 'EVENT' ? '1 3' : '4 3'} opacity={0.7} />
          ),
        )}
        {drag && drag.to !== drag.from && (
          <rect x={x(Math.min(drag.from, drag.to))} width={Math.abs(x(drag.to) - x(drag.from))} y={PAD.t} height={H - PAD.t - PAD.b} fill="var(--accent)" opacity={0.15} />
        )}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1} />
            {series.map((s, k) =>
              drawn[k]![hover] !== null && drawn[k]![hover] !== undefined ? <circle key={s.id} cx={x(hover)} cy={y(drawn[k]![hover]!)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} /> : null,
            )}
          </>
        )}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 24, transform: x(hover) > W / 2 ? 'translateX(-105%)' : 'translateX(5%)' }}>
          <div className="muted">{xLabels[hover]}</div>
          {series.map((s) => (
            <div key={s.id}>
              <i className="swatch" style={{ background: s.color }} /> <b>{s.values[hover] == null ? '-' : fmt(s.values[hover]!)}</b> <span className="muted">{s.id}</span>
            </div>
          ))}
          {markersAt(hover).map((m, k) => (
            <div key={`m${k}`} className="muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>
              {m.kind === 'WLM' ? '▴' : m.kind === 'CHANGE' ? '┆' : '⁝'} {m.text}
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
/** Spread end labels vertically so none overlap: sort by y, push down, then pull back inside the plot. */
export function endLabels<T extends { y: number }>(labels: T[], top: number, bottom: number): T[] {
  const out = [...labels].sort((a, b) => a.y - b.y).map((l) => ({ ...l }));
  for (let k = 0; k < out.length; k++) out[k]!.y = Math.max(out[k]!.y, k === 0 ? top : out[k - 1]!.y + LABEL_GAP);
  for (let k = out.length - 1; k >= 0; k--) out[k]!.y = Math.min(out[k]!.y, k === out.length - 1 ? bottom : out[k + 1]!.y - LABEL_GAP);
  return out;
}

const lastIndex = (vals: (number | null)[]) => {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return i;
  return -1;
};
