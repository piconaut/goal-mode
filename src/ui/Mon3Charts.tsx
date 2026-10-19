import { useEffect, useMemo, useState } from 'react';
import type { ChartMarker, Mon3Sample } from '../game/mon3Charts';
import type { ViewModel } from '../game/view';
import { formatClock } from '../sim/core/clock';
import { LineChart, type Series } from './LineChart';
import type { GameHandle } from './useGame';

const color = (i: number) => (i < 8 ? `var(--series-${i + 1})` : 'var(--muted)');
const DELAYS: { key: keyof Mon3Sample['delay'][string]; label: string }[] = [
  { key: 'cpu', label: 'CPU' },
  { key: 'ziip', label: 'zIIP' },
  { key: 'io', label: 'I/O' },
  { key: 'cap', label: 'CAP' },
  { key: 'other', label: 'other/UNK' },
];

/** Monitor III charting tool: today's Mon III history with markers, shared zoom. */
export function Mon3Charts({ v, game }: { v: ViewModel; game: GameHandle }) {
  const meta = v.mon3Charts;
  const { samples: all, markers: allMarkers } = game.charts;
  useEffect(() => {
    if (!meta) return;
    const stale = all.length > meta.samples || (all.length > 0 && all[0]!.tick !== meta.firstTick);
    if (stale) game.send({ type: 'GET_MON3_CHARTS', fromSample: 0, fromMarker: 0 });
    else if (all.length < meta.samples || allMarkers.length < meta.markers) game.send({ type: 'GET_MON3_CHARTS', fromSample: all.length, fromMarker: allMarkers.length });
  }, [meta?.samples, meta?.markers, meta?.firstTick, all, allMarkers.length, game, meta]);

  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [allPeriods, setAllPeriods] = useState(false);
  const [allDdf, setAllDdf] = useState(false);
  const [delayKey, setDelayKey] = useState('');

  const importance = useMemo(() => Object.fromEntries((v.mon3?.rows ?? []).filter((r) => r.system === '*PLEX').map((r) => [r.scKey, r.importance])), [v.mon3]);
  if (!meta)
    return (
      <div className="panel" style={{ marginTop: 12 }}>
        <h3>Charts</h3>
        <div className="muted">Charting today’s Monitor III data is a tier-2 tool (Monitor III charting) on the Analytics tab.</div>
      </div>
    );

  const lo = zoom ? zoom[0] : 0;
  const hi = zoom ? Math.min(zoom[1], all.length - 1) : all.length - 1;
  const samples = all.slice(lo, hi + 1);
  const xLabels = samples.map((s) => formatClock(s.tick).slice(-8, -3));
  const firstTick = samples[0]?.tick ?? 0;
  const lastTick = samples.at(-1)?.tick ?? 0;
  // A marker belongs to the first sample at or after it.
  const markers = allMarkers
    .filter((m) => m.tick >= firstTick && m.tick <= lastTick)
    .map((m: ChartMarker) => ({ ...m, i: Math.max(0, samples.findIndex((s) => s.tick >= m.tick)) }));
  const onZoom = (a: number, b: number) => setZoom([lo + a, lo + b]);
  const common = { xLabels, markers, onZoom, emptyText: 'Collecting samples (one per simulated minute)…' };

  // Fixed colour per entity (sorted), so filtering never repaints the survivors.
  const piKeys = [...new Set(all.flatMap((s) => Object.keys(s.pi)))].sort();
  const shownPi = piKeys.filter((k) => allPeriods || (importance[k] ?? 9) <= 2);
  const piSeries: Series[] = shownPi.slice(0, 8).map((k) => ({ id: k, color: color(piKeys.indexOf(k)), values: samples.map((s) => s.pi[k] ?? null) }));
  const systems = [...new Set(all.flatMap((s) => Object.keys(s.sys)))].sort();
  const busySeries: Series[] = [
    ...systems.map((id, i) => ({ id, color: color(i), values: samples.map((s) => s.sys[id]?.cpPct ?? null) })),
    { id: 'CPC', color: color(systems.length), values: samples.map((s) => s.cpcBusyPct) },
  ];
  const delayKeys = [...new Set(all.flatMap((s) => Object.keys(s.delay)))].sort();
  const dk = delayKey && delayKeys.includes(delayKey) ? delayKey : (delayKeys.find((k) => k.startsWith('ONLHI')) ?? delayKeys[0] ?? '');
  const delaySeries: Series[] = DELAYS.map((d, i) => ({ id: d.label, color: color(i), values: samples.map((s) => s.delay[dk]?.[d.key] ?? null) }));
  const prsmSeries: Series[] = systems.map((id, i) => ({ id, color: color(i), values: samples.map((s) => s.sys[id]?.prsmDelayPct ?? null) }));
  const anyCap = all.some((s) => Object.values(s.sys).some((x) => x.cappedPct > 0));
  const capSeries: Series[] = systems.map((id, i) => ({ id, color: color(i), values: samples.map((s) => s.sys[id]?.cappedPct ?? null) }));
  const ddfKeys = [...new Set(all.flatMap((s) => Object.keys(s.ddf)))].sort();
  // Later periods hold long-running queries (seconds to minutes) that would flatten period 1.
  const ddfRt: Series[] = ddfKeys
    .map((k, i) => ({ id: k, color: color(i), values: samples.map((s) => s.ddf[k]?.rtMs ?? null) }))
    .filter((x) => allDdf || x.id.endsWith('#1'));
  const ddfEng: Series[] = [
    { id: 'zIIP', color: color(0), values: samples.map((s) => Object.values(s.ddf).reduce((a, d) => a + d.ziipEngines, 0)) },
    { id: 'IIPCP (zIIP work on CPs)', color: color(1), values: samples.map((s) => Object.values(s.ddf).reduce((a, d) => a + d.iipcpEngines, 0)) },
  ];

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>Charts: today, one sample per minute</h3>
      <div className="form">
        <span className="muted" style={{ fontSize: 12 }}>
          ▴ WLM decision · ┆ change · ⁝ event or incident (hover for details). Drag across any chart to zoom all of them.{zoom ? ` Showing ${xLabels[0]}–${xLabels.at(-1)}.` : ''}
        </span>
        {zoom && <button onClick={() => setZoom(null)}>Reset zoom</button>}
      </div>
      <div className="grid">
        <div>
          <div className="form">
            <b style={{ fontSize: 13 }}>Performance index</b>
            <label className="muted" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={allPeriods} onChange={(e) => setAllPeriods(e.target.checked)} /> all periods (default: importance 1–2)
            </label>
          </div>
          <LineChart title="PI by service-class period" unit="PI" series={piSeries} reference={{ value: 1, label: 'goal (PI 1)' }} {...common} />
        </div>
        <div>
          <div className="form">
            <b style={{ fontSize: 13 }}>CP busy per system</b>
          </div>
          <LineChart title="CP busy %" unit="%" series={busySeries} reference={{ value: 100, label: '100%' }} {...common} />
        </div>
        <div>
          <div className="form">
            <b style={{ fontSize: 13 }}>Delay breakdown</b>
            <select aria-label="Period for delay breakdown" value={dk} onChange={(e) => setDelayKey(e.target.value)}>
              {delayKeys.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </div>
          <LineChart title={`Delay % of samples for ${dk}`} unit="%" series={delaySeries} stacked {...common} />
        </div>
        <div>
          <div className="form">
            <b style={{ fontSize: 13 }}>PR/SM dispatch delay</b>
          </div>
          <LineChart title="PR/SM delay %" unit="%" series={prsmSeries} {...common} />
        </div>
        <div>
          <div className="form">
            <b style={{ fontSize: 13 }}>Capping</b>
          </div>
          {anyCap ? <LineChart title="% capped" unit="%" series={capSeries} {...common} /> : <div className="muted">No LPAR has been capped today.</div>}
        </div>
        {ddfKeys.length > 0 && (
          <>
            <div>
              <div className="form">
                <b style={{ fontSize: 13 }}>DDF response time</b>
                <label className="muted" style={{ fontSize: 12 }}>
                  <input type="checkbox" checked={allDdf} onChange={(e) => setAllDdf(e.target.checked)} /> later periods too
                </label>
              </div>
              <LineChart title="DDF response time" unit="ms" series={ddfRt} {...common} />
            </div>
            <div>
              <div className="form">
                <b style={{ fontSize: 13 }}>DDF engines: zIIP vs on CPs</b>
              </div>
              <LineChart title="DDF engines" unit="engines" series={ddfEng} stacked {...common} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
