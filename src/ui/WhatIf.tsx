import { INSIGHT } from '../content/tools';
import type { WhatIfSummary } from '../game/whatif';
import type { ViewModel } from '../game/view';
import type { Command } from '../sim/core/commands';
import type { GameHandle } from './useGame';

const hhmm = (sec: number | null) => (sec === null ? 'unfinished' : `${String(Math.floor((6 + sec / 3600) % 24)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}${sec >= 18 * 3600 ? ' (+1)' : ''}`);

/** What-if: simulate today with and without the basket (tool WHAT_IF, briefing only). */
export function WhatIf({ v, game, basket, label }: { v: ViewModel; game: GameHandle; basket: Command[]; label: string }) {
  if (!v.features.includes('WHAT_IF')) return null;
  const { progress, result } = game.whatIf;
  const can = v.phase === 'BRIEFING' && progress === null;
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div className="form">
        <button
          disabled={!can}
          title={v.phase !== 'BRIEFING' ? 'What-if runs during the briefing' : undefined}
          onClick={() => game.send({ type: 'WHATIF_RUN', commands: basket, label: basket.length ? label : 'no extra changes' })}
        >
          What-if: simulate today {basket.length ? 'with this basket' : 'as planned'} · {INSIGHT.whatIfHours}h
        </button>
        {progress !== null && (
          <span className="muted" style={{ fontSize: 12, minWidth: 140 }}>
            simulating… {Math.round(progress * 100)}%
            <span className="bar" style={{ height: 4, display: 'block' }}>
              <span style={{ width: `${progress * 100}%`, background: 'var(--accent)' }} />
            </span>
          </span>
        )}
      </div>
      <div className="help">Forecast arrivals only: no hidden events, and a fresh random draw, so real days will differ. Planned changes are assumed to succeed.</div>
      {result && <Compare base={result.base} prop={result.proposal} label={result.label} />}
    </div>
  );
}

function Compare({ base, prop, label }: { base: WhatIfSummary; prop: WhatIfSummary; label: string }) {
  type Row = [string, (s: WhatIfSummary) => number | null, (x: number | null) => string, 'lower' | 'higher' | null];
  const rows: Row[] = [
    ['SLA breach hours', (s) => s.breachHours, (x) => String(x ?? '-'), 'lower'],
    ['Incidents', (s) => s.incidents, (x) => String(x ?? '-'), 'lower'],
    ['Critical batch end', (s) => s.criticalEndSec, (x) => hhmm(x), 'lower'],
    ['Peak CPC busy (online)', (s) => s.peakCpcBusyPct, (x) => `${(x ?? 0).toFixed(0)}%`, null],
    ['Peak sum of R4HA', (s) => s.peakR4haSum, (x) => `${(x ?? 0).toFixed(0)} MSU`, 'lower'],
    ['MLC estimate (month)', (s) => s.mlcEstimate, (x) => `$${Math.round((x ?? 0) / 1000)}k`, 'lower'],
  ];
  const tone = (better: 'lower' | 'higher' | null, a: number | null, b: number | null) => {
    if (better === null || a === null || b === null || Math.abs(a - b) < 1e-9) return undefined;
    const good = better === 'lower' ? b < a : b > a;
    return { color: good ? 'var(--good)' : 'var(--crit)' };
  };
  const breached = [...new Set([...base.sla, ...prop.sla].filter((x) => x.breachHours > 0).map((x) => x.workloadId))].sort();
  return (
    <table style={{ marginTop: 6 }}>
      <thead>
        <tr>
          <th />
          <th className="num">as planned</th>
          <th className="num">with {label.length > 40 ? 'basket' : label}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, get, fmt, better]) => (
          <tr key={name}>
            <td>{name}</td>
            <td className="num">{fmt(get(base))}</td>
            <td className="num" style={tone(better, get(base), get(prop))}>
              {fmt(get(prop))}
            </td>
          </tr>
        ))}
        {breached.map((id) => {
          const a = base.sla.find((x) => x.workloadId === id)?.breachHours ?? 0;
          const b = prop.sla.find((x) => x.workloadId === id)?.breachHours ?? 0;
          return (
            <tr key={id} className="muted">
              <td style={{ paddingLeft: 16 }}>{id} breach hours</td>
              <td className="num">{a}</td>
              <td className="num" style={tone('lower', a, b)}>
                {b}
              </td>
            </tr>
          );
        })}
        <tr className="muted">
          <td>Batch deadline</td>
          <td className="num">{base.batchMissed ? 'missed' : 'met'}</td>
          <td className="num">{prop.batchMissed ? 'missed' : 'met'}</td>
        </tr>
      </tbody>
    </table>
  );
}
