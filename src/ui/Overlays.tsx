import { useState } from 'react';
import { EVIDENCE } from '../content/evidence';
import type { Hypothesis } from '../game/aiops';
import { formatClock } from '../sim/core/clock';
import { TICKS_PER_HOUR } from '../sim/core/units';
import { MECHANISMS, TRIGGERS } from '../game/sla';
import type { Mechanism, Trigger } from '../game/types';
import type { ViewModel } from '../game/view';
import type { GameHandle } from './useGame';

export function Overlays({ v, game }: { v: ViewModel; game: GameHandle }) {
  const [hidden, setHidden] = useState(false);
  if (v.phase === 'LIVE') return null;
  if (hidden && v.phase === 'REVIEW')
    return (
      <div className="toast">
        Investigating day {v.day + 1}: pin evidence from Reports or Monitor III.{' '}
        <button className="primary" onClick={() => setHidden(false)}>
          Back to the review
        </button>
      </div>
    );
  if (hidden && v.phase === 'BRIEFING')
    return (
      <div className="toast">
        <button className="primary" onClick={() => game.send({ type: 'START_DAY' })}>
          Start day {v.day + 1} (06:00)
        </button>{' '}
        <button onClick={() => setHidden(false)}>Briefing</button>
      </div>
    );
  return (
    <div className="overlay">
      <div className="modal">
        {v.phase === 'BRIEFING' && <Briefing v={v} game={game} hide={() => setHidden(true)} />}
        {v.phase === 'REVIEW' && <Review v={v} game={game} investigate={() => setHidden(true)} />}
        {(v.phase === 'GAMEOVER' || v.phase === 'VICTORY') && (
          <>
            <h2>{v.phase === 'VICTORY' ? 'Quarter closed' : 'Run over'}</h2>
            <p>{v.endReason}</p>
            <p>
              Final score <b>{v.score}</b> after {v.day + 1} days.
            </p>
            <button className="primary" onClick={() => game.send({ type: 'NEW_RUN', seed: Math.floor(Math.random() * 1e6) })}>
              New run
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Briefing({ v, game, hide }: { v: ViewModel; game: GameHandle; hide: () => void }) {
  const today = v.inbox.filter((m) => m.day === v.day);
  const planned = v.changes.filter((c) => c.status === 'PLANNED' && c.activateDay === v.day);
  return (
    <>
      <h2>Morning briefing: day {v.day + 1}</h2>
      {today.length === 0 && <p className="muted">Quiet inbox this morning.</p>}
      {today.map((m, i) => (
        <div key={i} className="panel" style={{ marginBottom: 8 }}>
          <b>{m.subject}</b> <span className="muted">({m.from})</span>
          <div>{m.body}</div>
        </div>
      ))}
      {v.lastReport && <DaySummary v={v} />}
      <p>
        {v.hoursLeft.toFixed(1)} engineer-hours available.{' '}
        {planned.length > 0 ? `${planned.length} change(s) will activate at 06:00.` : 'No changes planned for today.'}
      </p>
      <div className="form">
        {game.savedRunDay !== null && v.day === 0 && (
          <button onClick={() => game.send({ type: 'CONTINUE_SAVED' })}>Continue saved run (day {game.savedRunDay + 1})</button>
        )}
        <button onClick={hide}>Plan changes / read reports</button>
        <button className="primary" onClick={() => game.send({ type: 'START_DAY' })}>
          Start day (06:00)
        </button>
      </div>
    </>
  );
}

function DaySummary({ v }: { v: ViewModel }) {
  const r = v.lastReport!;
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <h3>Day {r.day + 1} report card</h3>
      <table>
        <tbody>
          {r.sla.map((s) => (
            <tr key={s.workloadId}>
              <td>{s.workloadId}</td>
              <td className="muted">{s.target}</td>
              <td>
                <span className={`tag ${s.breachHours === 0 ? 'good' : 'bad'}`}>{s.breachHours === 0 ? 'met' : `${s.breachHours}h breached`}</span>
              </td>
            </tr>
          ))}
          <tr>
            <td>Batch</td>
            <td className="muted">critical path by {v.batch.deadline}</td>
            <td>
              <span className={`tag ${r.batchMissed ? 'bad' : 'good'}`}>{r.batchMissed ? 'MISSED' : 'on time'}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 6 }}>
        Score {r.score} · MLC estimate ${Math.round(r.mlcEstimate / 1000)}k · events: {r.events.join(', ') || 'none noticed'}
      </div>
    </div>
  );
}

function Review({ v, game, investigate }: { v: ViewModel; game: GameHandle; investigate: () => void }) {
  const open = v.incidents.filter((i) => i.day === v.day && !i.rca);
  return (
    <>
      <h2>End of day {v.day + 1}</h2>
      {v.lastReport && <DaySummary v={v} />}
      {open.length > 0 && (
        <div className="panel" style={{ marginBottom: 8 }}>
          <h3>Root-cause analysis</h3>
          <p className="muted">
            Today&apos;s RMF data is now in the Reports tab. Name where the time went and what set it off, and attach up to {EVIDENCE.perRca} pinned
            data points that prove it. Correct answers earn trust and Insight; evidence that points at the real cause earns more.
          </p>
          <div className="form">
            <button onClick={investigate}>Investigate (pin evidence)</button>
            <span className="muted">{v.pins.length} pinned</span>
          </div>
          {open.map((i) => (
            <Rca key={i.id} incidentId={i.id} label={`#${i.id} ${i.workloadId} · ${windowText(i)} · worst ${i.worstAttainmentPct.toFixed(0)}%`} hypotheses={i.aiops ?? []} v={v} game={game} />
          ))}
        </div>
      )}
      {v.incidents
        .filter((i) => i.day === v.day && i.rca)
        .map((i) => (
          <div key={i.id} style={{ marginBottom: 6 }}>
            <div className="row">
              <span>
                #{i.id} {i.workloadId}: you said {i.rca!.mechanism}/{i.rca!.trigger}
              </span>
              <span className={`tag ${i.rca!.points >= 3 ? 'good' : 'bad'}`}>
                +{i.rca!.points} (was {i.truth.mechanism}/{i.truth.trigger})
              </span>
            </div>
            {(i.rca!.evidence ?? []).map((e) => (
              <div key={e.pinId} className="muted" style={{ fontSize: 12, paddingLeft: 12 }}>
                {e.relevance > 0 ? '✓' : '✗'} {e.text}: {e.why}
              </div>
            ))}
            {(i.rca!.evidencePoints ?? 0) > 0 && <div style={{ fontSize: 12, paddingLeft: 12 }}>Evidence +{i.rca!.evidencePoints}</div>}
          </div>
        ))}
      <h3>Pick one</h3>
      <div className="cards">
        {(v.draft ?? []).map((d) => (
          <div key={d.id} className="card" onClick={() => game.send({ type: 'DRAFT', optionId: d.id })}>
            <b>{d.title}</b>
            <div className="muted">{d.description}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/** When the SLA was breached, so evidence can be taken from the right intervals. */
const windowText = (i: { startTick: number; hours: number }) =>
  `breached ${formatClock(i.startTick).slice(-8, -3)}–${formatClock(i.startTick + i.hours * TICKS_PER_HOUR).slice(-8, -3)}`;

function Rca({ incidentId, label, hypotheses, v, game }: { incidentId: number; label: string; hypotheses: Hypothesis[]; v: ViewModel; game: GameHandle }) {
  const [m, setM] = useState<Mechanism>('CPU_PRIORITY');
  const [t, setT] = useState<Trigger>('POLICY');
  const [ev, setEv] = useState<number[]>([]);
  const toggle = (id: number) => setEv(ev.includes(id) ? ev.filter((x) => x !== id) : ev.length < EVIDENCE.perRca ? [...ev, id] : ev);
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
      <div className="form">
        <span style={{ minWidth: 220 }}>{label}</span>
        <select aria-label="Mechanism" value={m} onChange={(e) => setM(e.target.value as Mechanism)}>
          {MECHANISMS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select aria-label="Trigger" value={t} onChange={(e) => setT(e.target.value as Trigger)}>
          {TRIGGERS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button onClick={() => game.send({ type: 'RCA', incidentId, mechanism: m, trigger: t, evidenceIds: ev })}>Submit{ev.length ? ` with ${ev.length} evidence` : ''}</button>
      </div>
      {hypotheses.length > 0 && (
        <div style={{ fontSize: 12, paddingLeft: 12 }}>
          <span className="muted">AIOps hypotheses (can be wrong):</span>
          {hypotheses.map((h, k) => (
            <div key={k} className="form" style={{ margin: '2px 0' }}>
              <span>
                {k + 1}. {h.mechanism} / {h.trigger} · {Math.round(h.confidence * 100)}%
              </span>
              <button
                onClick={() => {
                  setM(h.mechanism);
                  setT(h.trigger);
                }}
              >
                use
              </button>
            </div>
          ))}
        </div>
      )}
      {v.pins.length > 0 && (
        <div style={{ fontSize: 12, paddingLeft: 12 }}>
          <span className="muted">
            Evidence ({ev.length}/{EVIDENCE.perRca}):
          </span>
          {[...v.pins].reverse().map((p) => (
            <label key={p.id} style={{ display: 'block' }}>
              <input type="checkbox" checked={ev.includes(p.id)} disabled={!ev.includes(p.id) && ev.length >= EVIDENCE.perRca} onChange={() => toggle(p.id)} /> {p.text}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
