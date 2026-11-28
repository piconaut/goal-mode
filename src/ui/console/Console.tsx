// The Ops Console tab: capacity, processor, service levels, the PI heat map, incidents, batch and the log.
// Split from `App.tsx` (CL-38).

import { idText } from '../../game/ids';
import type { HistoryPoint } from '../../game/history';
import type { ViewModel } from '../../game/view';
import { CodexHints } from '../CodexHint';
import { Empty } from '../Empty';
import { piColor } from '../colors';
import { Capacity } from './Capacity';
import { OpsLog } from './OpsLog';

export function Console({ v, history }: { v: ViewModel; history: HistoryPoint[] }) {
  return (
    <div className="grid console-grid">
      <Capacity v={v} history={history} />
      <div className="panel">
        <h3>
          Processor (CPC busy {v.cpcBusyPct.toFixed(0)}%)
          <CodexHints ids={['lpar-weights', 'hiperdispatch']} />
        </h3>
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
        {v.config.mq.length > 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6, fontFamily: 'var(--mono)' }}>
            {v.config.mq.map((q) => (
              <div key={q.workloadId}>
                DIS QL({q.queue}) CURDEPTH{' '}
                {Object.keys(q.depthByLpar).length === 0
                  ? '0'
                  : Object.keys(q.depthByLpar)
                      .sort()
                      .map((l) => `${l} ${Math.round(q.depthByLpar[l]!).toLocaleString()}`)
                      .join(' · ')}{' '}
                / MAXDEPTH {q.maxDepth.toLocaleString()} each
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel" data-tour="console.pi-heatmap">
        <h3>
          WLM performance index (sysplex)
          <CodexHints ids={['perf-index', 'policy-adjustment']} />
        </h3>
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

      {/* Incidents and the batch window are the at-a-glance health panels: first on narrow screens (styles.css). */}
      <div className="stack console-health">
        <div className="panel">
          <h3>Incidents</h3>
          {v.incidents.length === 0 && <Empty>No SLA breaches yet.</Empty>}
          {[...v.incidents].reverse().slice(0, 12).map((i) => (
            <div className="row" key={i.id}>
              <span>
                {idText('incident', i.id)} {i.workloadId} <span className="muted">day {i.day + 1}</span>
              </span>
              <span className={`tag ${i.endTick === null ? 'bad' : 'warn'}`}>
                {i.endTick === null ? 'OPEN' : 'closed'} · {i.hours}h · worst {i.worstAttainmentPct.toFixed(0)}%
              </span>
              {i.aiops?.[0] && (
                <span className="muted" style={{ fontSize: 11 }} title="AIOps top hypothesis (can be wrong)">
                  AIOps: {i.aiops[0].mechanism} ({Math.round(i.aiops[0].confidence * 100)}%)
                </span>
              )}
            </div>
          ))}
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
              <span className="tag bad">
                {a.failCode?.startsWith('DSN') ? 'FAILED' : 'ABEND'} {a.name}
                {a.failCode ? ` ${a.failCode}` : ''}
                {a.lparId ? ` on ${a.lparId}` : ''}
              </span>
              <span className="muted">restart from the Change Desk</span>
            </div>
          ))}
        </div>
        <OpsLog v={v} className="console-log-wide" />
      </div>
      <OpsLog v={v} className="console-log-narrow" />
    </div>
  );
}
