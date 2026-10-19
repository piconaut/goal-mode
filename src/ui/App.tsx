import { useState } from 'react';
import { FACETS } from '../game/types';
import type { ViewModel } from '../game/view';
import type { HistoryPoint } from '../game/history';
import { Actions } from './Actions';
import { Analytics } from './Analytics';
import { LineChart } from './LineChart';
import { Overlays } from './Overlays';
import { Reports } from './Reports';
import { RulesView } from './RulesView';
import { useGame, type GameHandle } from './useGame';

type Tab = 'console' | 'reports' | 'changes' | 'rules' | 'analytics' | 'inbox';

export function App() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('console');
  const v = game.view;
  if (!v) return <div className="app">Starting the sysplex…</div>;
  return (
    <div className="app">
      <TopBar v={v} game={game} />
      <div className="tabs">
        {(['console', 'reports', 'changes', 'rules', 'analytics', 'inbox'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'console' ? 'Ops Console' : t === 'reports' ? 'RMF Reports' : t === 'changes' ? 'Change Desk' : t === 'rules' ? 'Classification' : t === 'analytics' ? `Analytics (${v.insight}◆)` : `Inbox (${v.inbox.length})`}
          </button>
        ))}
      </div>
      {tab === 'console' && <Console v={v} history={game.history} />}
      {tab === 'reports' && <Reports v={v} game={game} />}
      {tab === 'changes' && <Actions v={v} game={game} />}
      {tab === 'rules' && <RulesView v={v} game={game} />}
      {tab === 'analytics' && <Analytics v={v} game={game} />}
      {tab === 'inbox' && <Inbox v={v} />}
      <Overlays v={v} game={game} />
      {game.toast && <div className={`toast ${game.toast.ok ? '' : 'bad'}`}>{game.toast.message}</div>}
    </div>
  );
}

function TopBar({ v, game }: { v: ViewModel; game: GameHandle }) {
  const [speed, setSpeed] = useState(1);
  const set = (s: number) => {
    setSpeed(s);
    game.send({ type: 'SET_SPEED', speed: s });
  };
  const progress = (100 * v.tickOfDay) / v.ticksPerDay;
  return (
    <div className="topbar">
      <span className="brand">GOAL MODE</span>
      <span className="clock">{v.clock}</span>
      <span className="stat">
        Day <b>{Math.min(v.day + 1, v.maxDays)} / {v.maxDays}</b>
      </span>
      <span className="stat" style={{ minWidth: 120 }}>
        {v.phase}
        <span className="bar" style={{ height: 6, marginTop: 4 }}>
          <span style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </span>
      </span>
      {v.phase === 'LIVE' && (
        <span className="speed">
          {[0, 0.5, 1, 2, 4, 8].map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => set(s)}>
              {s === 0 ? '❚❚' : `${s}×`}
            </button>
          ))}
        </span>
      )}
      <span className="stat">
        Trust <b style={{ color: trustColor(v.trustOverall) }}>{v.trustOverall.toFixed(0)}</b>
      </span>
      {FACETS.map((f) => (
        <span className="stat" key={f}>
          {f} <b style={{ color: trustColor(v.trust[f]) }}>{v.trust[f].toFixed(0)}</b>
        </span>
      ))}
      <span className="stat">
        Hours <b>{v.hoursLeft.toFixed(1)}</b>
      </span>
      <span className="stat">
        Insight <b>{v.insight}</b>
      </span>
      <span className="stat">
        Fatigue <b>{v.fatigue.toFixed(0)}</b>
      </span>
      <span className="stat">
        MLC est <b>${Math.round(v.mlcEstimate / 1000)}k</b>
      </span>
      <span className="stat">
        Budget <b>${Math.round(v.opexBudget / 1000)}k</b>
      </span>
      <span className="stat">
        Capex <b>${Math.round(v.capexRemaining / 1000)}k</b>
      </span>
      <span className="stat">
        Score <b>{v.score}</b>
      </span>
    </div>
  );
}

const trustColor = (t: number) => (t >= 60 ? 'var(--good)' : t >= 35 ? 'var(--warn)' : 'var(--crit)');

/** Blue (overachieving) ↔ neutral ↔ orange/red (missing goal): colour-blind safe diverging scale. */
export function piColor(pi: number | null): string {
  if (pi === null) return 'var(--panel-2)';
  if (pi < 0.8) return 'rgba(88,166,255,0.35)';
  if (pi <= 1) return 'rgba(88,166,255,0.15)';
  if (pi <= 1.5) return 'rgba(240,136,62,0.35)';
  return 'rgba(255,107,107,0.55)';
}

const SERIES_LPARS = ['PROD1', 'PROD2', 'DEVT', 'SYSP'];
const seriesColor = (i: number) => `var(--series-${i + 1})`;

function hhmm(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function Capacity({ v, history }: { v: ViewModel; history: HistoryPoint[] }) {
  // Today's samples only (since the played day's 06:00).
  const dayStart = v.day * v.ticksPerDay;
  const pts = history.filter((p) => p.tick > dayStart);
  const xLabels = pts.map((p) => hhmm(p.hourOfDay));
  const mk = (key: 'msu' | 'r4ha') => SERIES_LPARS.map((id, i) => ({ id, color: seriesColor(i), values: pts.map((p) => p[key][id] ?? null) }));
  return (
    <div className="panel" style={{ gridColumn: '1 / -1' }}>
      <h3>Capacity today</h3>
      <div className="grid">
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>MSU consumption per LPAR (5-minute samples)</div>
          <LineChart title="MSU per LPAR" unit="MSU" xLabels={xLabels} series={mk('msu')} />
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Rolling 4-hour average per LPAR (drives soft capping and the MLC bill)</div>
          <LineChart title="R4HA per LPAR" unit="MSU" xLabels={xLabels} series={mk('r4ha')} />
        </div>
      </div>
    </div>
  );
}

function Console({ v, history }: { v: ViewModel; history: HistoryPoint[] }) {
  return (
    <div className="grid">
      <Capacity v={v} history={history} />
      <div className="panel">
        <h3>Processor (CPC busy {v.cpcBusyPct.toFixed(0)}%)</h3>
        {v.lpars.map((l) => (
          <div key={l.id} style={{ marginBottom: 8 }}>
            <div className="row">
              <b>{l.id}</b>
              <span className="muted" style={{ fontSize: 12 }}>
                {l.kind === 'ZOS' ? `w${l.weight} · ${l.logicalCps} LCP · ${l.polarity}` : `CF · ${l.polarity}`}
              </span>
            </div>
            <div className="row">
              <span className="muted" style={{ width: 34 }}>{l.kind === 'CF' ? 'ICF' : 'CP'}</span>
              <span className="bar">
                <span style={{ width: `${Math.min(100, l.cpBusyPct)}%`, background: l.cpBusyPct > 90 ? 'var(--crit)' : l.cpBusyPct > 75 ? 'var(--warn)' : 'var(--good)' }} />
              </span>
              <span className="num" style={{ width: 44, textAlign: 'right' }}>{l.cpBusyPct.toFixed(0)}%</span>
            </div>
            {l.ziipBusyPct !== null && (
              <div className="row">
                <span className="muted" style={{ width: 34 }}>zIIP</span>
                <span className="bar">
                  <span style={{ width: `${Math.min(100, l.ziipBusyPct)}%`, background: 'var(--accent)' }} />
                </span>
                <span className="num" style={{ width: 44, textAlign: 'right' }}>{l.ziipBusyPct.toFixed(0)}%</span>
              </div>
            )}
            {l.kind === 'ZOS' && (
              <div className="row muted" style={{ fontSize: 12 }}>
                <span>
                  MSU {l.msu.toFixed(0)} · R4HA {l.r4ha?.toFixed(0) ?? '-'}
                  {l.definedCapacity !== null ? ` / DC ${l.definedCapacity}` : ''}
                </span>
                {l.capped && <span className="tag bad">CAPPED</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Service levels (this hour)</h3>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Target</th>
              <th className="num">tps</th>
              <th className="num">avg ms</th>
              <th className="num">in SLA</th>
            </tr>
          </thead>
          <tbody>
            {v.sla.map((s) => (
              <tr key={s.workloadId}>
                <td>
                  {s.workloadId}
                  <div className="muted" style={{ fontSize: 11 }}>{s.name}</div>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{s.target}</td>
                <td className="num">{s.ratePerSec >= 10 ? s.ratePerSec.toFixed(0) : s.ratePerSec.toFixed(2)}</td>
                <td className="num">{s.avgRtMs === null ? '-' : s.avgRtMs < 10_000 ? s.avgRtMs.toFixed(0) : '∞'}</td>
                <td className="num">
                  {s.hourPct === null ? <span className="muted">-</span> : <span className={`tag ${s.met ? 'good' : 'bad'}`}>{s.hourPct.toFixed(1)}%</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>WLM performance index (sysplex)</h3>
        <div className="heat">
          {v.piHeat.map((c) => (
            <div className="cell" key={c.scKey} style={{ background: piColor(c.pi) }} title={c.goal}>
              <div className="row">
                <span>{c.scKey}</span>
                <span className="muted">{c.importance !== null ? `imp ${c.importance}` : 'disc'}</span>
              </div>
              <div className="pi">{c.pi === null ? '—' : c.pi.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Batch window</h3>
        <div className="row">
          <span>Critical path projected end</span>
          <b className="num" style={{ color: v.batch.atRisk ? 'var(--crit)' : 'var(--text)' }}>{v.batch.projectedCriticalEnd ?? '—'}</b>
        </div>
        <div className="row">
          <span>Deadline</span>
          <b className="num">{v.batch.deadline}</b>
        </div>
        <div className="row muted">
          <span>
            running {v.batch.running} · queued {v.batch.queued} · held {v.batch.held} · done {v.batch.done}
          </span>
        </div>
        {v.batch.abended.map((a) => (
          <div className="row" key={`${a.day}:${a.name}`}>
            <span className="tag bad">ABEND {a.name}</span>
            <span className="muted">restart from the Change Desk</span>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Incidents</h3>
        {v.incidents.length === 0 && <div className="muted">No SLA breaches yet.</div>}
        {[...v.incidents].reverse().slice(0, 12).map((i) => (
          <div className="row" key={i.id}>
            <span>
              #{i.id} {i.workloadId} <span className="muted">day {i.day + 1}</span>
            </span>
            <span className={`tag ${i.endTick === null ? 'bad' : 'warn'}`}>
              {i.endTick === null ? 'OPEN' : 'closed'} · {i.hours}h · worst {i.worstAttainmentPct.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Operations log</h3>
        <div className="log">
          {[...v.log].reverse().map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Inbox({ v }: { v: ViewModel }) {
  return (
    <div className="panel">
      <h3>Inbox</h3>
      {[...v.inbox].reverse().map((m, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div className="row">
            <b>{m.subject}</b>
            <span className="muted">
              {m.from} · day {m.day + 1}
            </span>
          </div>
          <div>{m.body}</div>
        </div>
      ))}
    </div>
  );
}
