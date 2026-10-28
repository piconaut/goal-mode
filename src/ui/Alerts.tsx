import { useState, type FormEvent } from 'react';
import { ALERT_METRICS, ALERTS, type AlertMetric } from '../content/alerts';
import type { ViewModel } from '../game/view';
import type { GameHandle } from './useGame';
import { AnalyticsLink, Empty } from './Empty';

const SUGGESTED: { metric: AlertMetric; subject: string; threshold: number; forMin: number; pause: boolean }[] = [
  { metric: 'PI', subject: 'ONLHI#1', threshold: 1.5, forMin: 5, pause: true },
  { metric: 'CPC_BUSY', subject: '', threshold: 97, forMin: 15, pause: false },
  { metric: 'BATCH_SLACK', subject: '', threshold: 30, forMin: 10, pause: true },
];

/** Alerting rules (tool ALERTS): thresholds over Monitor III data that page you. */
export function Alerts({ v, game, openAnalytics }: { v: ViewModel; game: GameHandle; openAnalytics: () => void }) {
  const a = v.alerts;
  const [metric, setMetric] = useState<AlertMetric>('PI');
  const def = ALERT_METRICS[metric];
  const periods = (v.mon3?.rows ?? []).filter((r) => r.system === '*PLEX' && r.importance !== null).map((r) => r.scKey);
  const lpars = v.lpars.filter((l) => l.kind === 'ZOS').map((l) => l.id);
  const subjects = def.subject === 'period' ? periods : def.subject === 'lpar' ? lpars : [];
  const [subject, setSubject] = useState('');
  const [threshold, setThreshold] = useState(String(def.defaultThreshold));
  const [forMin, setForMin] = useState('5');
  const [pause, setPause] = useState(false);
  if (!a)
    return (
      <div className="panel">
        <h3>Alert rules</h3>
        <Empty>
          Paging on thresholds is a tier-3 tool (Alerting rules) on the <AnalyticsLink open={openAnalytics} />.
        </Empty>
      </div>
    );
  const subj = subjects.includes(subject) ? subject : (subjects[0] ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    game.send({ type: 'ALERT_ADD', rule: { metric, subject: subj, threshold: Number(threshold), forMin: Number(forMin), pause } });
  };
  return (
    <div className="panel">
      <h3>
        Alert rules ({a.rules.length}/{ALERTS.maxRules})
      </h3>
      <div className="help">
        Checked every sim-minute against Monitor III data. A rule pages once when its condition has held for the set time, and again only after it clears. Pages between{' '}
        {ALERTS.nightStart}:00 and 0{ALERTS.nightEnd}:00 wake someone up (+{ALERTS.nightFatigue} fatigue each): noisy rules cost you.
      </div>
      {a.rules.length === 0 && (
        <div className="form">
          <Empty>No rules yet.</Empty>
          <button onClick={() => SUGGESTED.forEach((rule) => game.send({ type: 'ALERT_ADD', rule }))}>Add suggested rules</button>
        </div>
      )}
      <ul className="diff">
        {a.rules.map((r) => (
          <li key={r.id}>
            <span>
              {a.firing.includes(r.id) && <span className="tag bad">FIRING</span>} {r.text}
              {r.pause ? <span className="muted"> · pauses</span> : ''}
            </span>
            <button aria-label={`Remove alert ${r.text}`} onClick={() => game.send({ type: 'ALERT_REMOVE', id: r.id })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={submit}>
        <select
          aria-label="Metric"
          value={metric}
          onChange={(e) => {
            const m = e.target.value as AlertMetric;
            setMetric(m);
            setThreshold(String(ALERT_METRICS[m].defaultThreshold));
          }}
        >
          {(Object.keys(ALERT_METRICS) as AlertMetric[]).map((m) => (
            <option key={m} value={m}>
              {ALERT_METRICS[m].label}
            </option>
          ))}
        </select>
        {subjects.length > 0 && (
          <select aria-label="Subject" value={subj} onChange={(e) => setSubject(e.target.value)}>
            {subjects.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        )}
        <label>
          {def.op} <input aria-label="Threshold" value={threshold} onChange={(e) => setThreshold(e.target.value)} size={4} inputMode="decimal" />
          {def.unit}
        </label>
        <label>
          for <input aria-label="Minutes" value={forMin} onChange={(e) => setForMin(e.target.value)} size={3} inputMode="numeric" /> min
        </label>
        <label>
          <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} /> pause the game
        </label>
        <button type="submit" disabled={a.rules.length >= ALERTS.maxRules}>
          Add rule
        </button>
      </form>
      <div className="muted" style={{ fontSize: 12 }}>{def.help}</div>
      {a.log.length > 0 && (
        <div className="log" style={{ marginTop: 6 }}>
          {[...a.log].reverse().map((e, i) => (
            <div key={i} style={e.kind === 'FIRED' ? { color: 'var(--crit)' } : undefined}>
              {e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
