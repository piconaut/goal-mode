import { useEffect, useState } from 'react';
import { PACKS } from '../content/packs';
import { DIFFICULTIES, type DifficultyId } from '../content/difficulty';
import { EVIDENCE } from '../content/evidence';
import type { Hypothesis } from '../game/aiops';
import { dailySeed, shareText } from '../game/daily';
import { formatClock } from '../sim/core/clock';
import { TICKS_PER_HOUR } from '../sim/core/units';
import { MECHANISMS, TRIGGERS } from '../game/sla';
import type { Mechanism, Trigger } from '../game/types';
import type { EndReport } from '../game/endReport';
import type { ViewModel } from '../game/view';
import { piColor, seriesColor } from './App';
import { LineChart } from './LineChart';
import type { GameHandle } from './useGame';
import { CAREER_LEVELS } from '../content/career';
import { DRAFT_OPTIONS } from '../content/draft';
import { careerLevel, unlockedPerks } from '../game/career';

export function Overlays({ v, game, open, setOpen }: { v: ViewModel; game: GameHandle; open: boolean; setOpen: (o: boolean) => void }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, setOpen]);
  const ended = v.phase === 'GAMEOVER' || v.phase === 'VICTORY';
  // Mid-day the overlay is just the last report card, opened from the tab bar.
  if (v.phase === 'LIVE' && (!open || !v.lastReport)) return null;
  return (
    <>
      {!open && v.phase === 'REVIEW' && (
        <div className="toast">
          Day {v.day + 1} review: pin evidence from Reports or Monitor III, then come back.{' '}
          <button className="primary" onClick={() => setOpen(true)}>
            Back to the review
          </button>
        </div>
      )}
      {!open && v.phase === 'BRIEFING' && (
        <div className="toast">
          {v.weekendDay && (
            <>
              <button className="primary" title="Run the weekend day at full speed; the report card is the summary" onClick={() => game.send({ type: 'START_DAY', auto: true })}>
                Auto-run the weekend day
              </button>{' '}
            </>
          )}
          <button className={v.weekendDay ? '' : 'primary'} onClick={() => game.send({ type: 'START_DAY' })}>
            {v.weekendDay ? 'Play it' : `Start day ${v.day + 1} (06:00)`}
          </button>{' '}
          <button onClick={() => setOpen(true)}>Briefing</button>
        </div>
      )}
      {/* Kept mounted while hidden so half-filled RCA forms survive flipping back and forth. */}
      <div className="overlay" style={open || ended ? undefined : { display: 'none' }}>
        <div className="modal">
          {!ended && (
            <button className="modal-close" aria-label="Close and go to the interface" title="Close (Esc); reopen from the tab bar" onClick={() => setOpen(false)}>
              ✕
            </button>
          )}
          {v.phase === 'LIVE' && v.lastReport && <DaySummary v={v} />}
          {v.phase === 'BRIEFING' && <Briefing v={v} game={game} hide={() => setOpen(false)} />}
          {v.phase === 'REVIEW' && <Review v={v} game={game} investigate={() => setOpen(false)} />}
          {ended && (
            <>
              <h2>{v.phase === 'VICTORY' ? 'Quarter closed' : v.endlessFromDay !== null ? 'Endless run over' : 'Run over'}</h2>
              <p>{v.endReason}</p>
              <p>
                Final score <b>{v.score}</b> after {v.day + 1} days.
              </p>
              <CareerLine game={game} />
              {v.endReport && <EndReportView r={v.endReport} />}
              {v.endReport && <ShareBox v={v} r={v.endReport} />}
              {v.phase === 'VICTORY' && v.endlessFromDay === null && (
                <p>
                  <button className="primary" onClick={() => game.send({ type: 'CONTINUE_ENDLESS' })}>
                    Keep going (endless)
                  </button>{' '}
                  <span className="muted">Growth keeps compounding and a new capex budget arrives. The run counts as a win whenever it ends.</span>
                </p>
              )}
              <NewRun game={game} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ShareBox({ v, r }: { v: ViewModel; r: EndReport }) {
  const [copied, setCopied] = useState(false);
  const text = shareText({ seed: v.seed, difficulty: v.difficulty.name, daysPlayed: r.daysPlayed, maxDays: v.maxDays, endlessDays: r.endlessDays, grade: r.grade, points: r.points, score: v.score, daily: v.daily });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the text stays selectable */
    }
  };
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <div className="form">
        <input readOnly aria-label="Shareable result" value={text} style={{ fontFamily: 'monospace', flex: 1, minWidth: 0 }} onFocus={(e) => e.target.select()} />
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

function EndReportView({ r }: { r: EndReport }) {
  return (
    <div className="panel" style={{ marginBottom: 8 }}>
      <h3>
        Grade <span style={{ fontSize: '1.6em' }}>{r.grade}</span> <span className="muted">({r.points}/100)</span>
      </h3>
      <p className="muted">
        {r.daysPlayed} of the quarter's days played · mean SLA attainment {r.meanSlaPct.toFixed(1)}% · final trust {Math.round(r.overallTrust)}
        {r.endlessDays !== null && ` · ${r.endlessDays} endless days after the quarter closed`}
        {!r.victory && ' · runs that end early grade B at best'}
      </p>
      {r.biggestIncident && (
        <p>
          Biggest incident: <b>{r.biggestIncident.workloadId}</b> on day {r.biggestIncident.day + 1}, {r.biggestIncident.hours} h: {r.biggestIncident.cause}.
        </p>
      )}
      <p>{r.bestRca ? <>Best RCA: <b>{r.bestRca.workloadId}</b> on day {r.bestRca.day + 1}, {r.bestRca.points} points: {r.bestRca.cause}.</> : 'No root cause analysis scored points.'}</p>
      {r.r4haByLpar.lparIds.length > 0 && r.days.length >= 2 && (
        <LineChart
          title="Daily peak R4HA per LPAR"
          unit="MSU"
          xLabels={r.days.map((d) => `day ${d.day + 1}`)}
          series={r.r4haByLpar.lparIds.map((id, i) => ({ id, color: seriesColor(i), values: r.r4haByLpar.byDay[i]! }))}
        />
      )}
      <details>
        <summary>Day by day</summary>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Score</th>
              <th>Worst SLA</th>
              <th>Peak R4HA sum (MSU)</th>
              <th>Batch</th>
            </tr>
          </thead>
          <tbody>
            {r.days.map((d) => (
              <tr key={d.day}>
                <td>{d.day + 1}</td>
                <td>{d.score}</td>
                <td>{d.worstSlaPct.toFixed(1)}%</td>
                <td>{d.peakR4haSum === null ? <span className="muted">-</span> : Math.round(d.peakR4haSum)}</td>
                <td>{d.batchMissed ? <span className="tag bad">missed</span> : 'on time'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {r.piHeat.scKeys.length > 0 && (
        <details>
          <summary>PI heat map (worst interval per day)</summary>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  {r.days.map((d) => (
                    <th key={d.day} className="num">
                      {d.day + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.piHeat.scKeys.map((k, i) => (
                  <tr key={k}>
                    <td>{k}</td>
                    {r.piHeat.byDay[i]!.map((pi, d) => (
                      <td key={d} className="num" style={{ background: piColor(pi), padding: '2px 4px' }} title={`${k} day ${d + 1}: PI ${pi === null ? '-' : pi.toFixed(2)}`}>
                        {pi === null ? '' : pi.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details>
        <summary>Decisions ({r.decisions.length} changes applied)</summary>
        <ul>
          {r.decisions.map((d, i) => (
            <li key={i}>
              Day {d.day + 1}: {d.label}
              {d.emergency && <span className="tag bad"> emergency</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function NewRun({ game }: { game: GameHandle }) {
  const [difficulty, setDifficulty] = useState<DifficultyId>('NORMAL');
  const [scenario, setScenario] = useState('midwest');
  return (
    <>
      <div role="radiogroup" aria-label="Scenario">
        {Object.values(PACKS).map((p) => (
          <label key={p.id} style={{ display: 'block', margin: '4px 0' }}>
            <input type="radio" name="scenario" checked={scenario === p.id} onChange={() => setScenario(p.id)} /> <b>{p.name}</b> <span className="muted">{p.blurb}</span>
          </label>
        ))}
      </div>
      <div role="radiogroup" aria-label="Difficulty">
        {Object.values(DIFFICULTIES).map((d) => (
          <label key={d.id} style={{ display: 'block', margin: '4px 0' }}>
            <input type="radio" name="difficulty" checked={difficulty === d.id} onChange={() => setDifficulty(d.id)} /> <b>{d.name}</b>{' '}
            <span className="muted">{d.description}</span>
          </label>
        ))}
      </div>
      <button className="primary" onClick={() => game.send({ type: 'NEW_RUN', seed: Math.floor(Math.random() * 1e6), difficulty, scenario })}>
        New run
      </button>{' '}
      <button
        title="Same seed for everyone today (UTC)"
        onClick={() => {
          const today = new Date().toISOString().slice(0, 10);
          game.send({ type: 'NEW_RUN', seed: dailySeed(today), difficulty, daily: today, scenario });
        }}
      >
        Daily challenge
      </button>
    </>
  );
}

const perkTitle = (id: string) => DRAFT_OPTIONS.find((d) => d.id === id)?.title.replace(/^Perk: /, '') ?? id;

function careerTitle(xp: number): string {
  const lvl = careerLevel(xp);
  const next = CAREER_LEVELS[lvl + 1];
  return `${CAREER_LEVELS[lvl]!.title} (level ${lvl + 1}, ${xp} XP${next ? `; ${next.xp} for ${perkTitle(next.unlock ?? '')}` : ''})`;
}

/** Career XP from the run that just ended, and any perk it unlocked. */
function CareerLine({ game }: { game: GameHandle }) {
  const c = game.career;
  if (!c || c.lastRunXp === null) return null;
  const before = c.career.xp - c.lastRunXp;
  const fresh = unlockedPerks(c.career.xp).filter((p) => !unlockedPerks(before).includes(p));
  return (
    <p>
      Career: <b>+{c.lastRunXp} XP</b> · {careerTitle(c.career.xp)}
      {fresh.length > 0 && <> · unlocked starting perk <b>{fresh.map(perkTitle).join(', ')}</b></>}
    </p>
  );
}

// Unlocked career perks: pick one before day 1 starts (not on the daily challenge, where everyone starts alike).
function StartingPerk({ v, game }: { v: ViewModel; game: GameHandle }) {
  const xp = game.career?.career.xp ?? 0;
  const perks = unlockedPerks(xp);
  return (
    <p>
      <span className="muted">Career: {careerTitle(xp)}.</span>{' '}
      {perks.length > 0 && !v.daily && (
        <label>
          Starting perk{' '}
          <select value={v.perks[0] ?? ''} onChange={(e) => game.send({ type: 'SET_STARTING_PERK', perkId: e.target.value || null })}>
            <option value="">None</option>
            {perks.map((p) => (
              <option key={p} value={p}>
                {perkTitle(p)}
              </option>
            ))}
          </select>
        </label>
      )}
    </p>
  );
}

// A fresh page load starts on Midwest Mutual, Normal; until day 1 starts the player can restart on another
// scenario or preset, or switch to today's daily challenge (which then stays daily across those restarts).
function FirstDayDifficulty({ v, game }: { v: ViewModel; game: GameHandle }) {
  const plannedAny = v.changes.length > 0;
  const restart = (scenario: string, difficulty: DifficultyId, daily: boolean) => {
    if (plannedAny && !confirm('Restart? Planned changes are discarded.')) return;
    const today = new Date().toISOString().slice(0, 10);
    game.send(
      daily
        ? { type: 'NEW_RUN', seed: dailySeed(today), difficulty, daily: today, scenario }
        : { type: 'NEW_RUN', seed: Math.floor(Math.random() * 1e6), difficulty, scenario },
    );
  };
  const isDaily = v.daily !== null;
  return (
    <p>
      <label>
        Scenario{' '}
        <select value={v.scenario.id} onChange={(e) => restart(e.target.value, v.difficulty.id, isDaily)}>
          {Object.values(PACKS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        Difficulty{' '}
        <select
          value={v.difficulty.id}
          onChange={(e) => restart(v.scenario.id, e.target.value as DifficultyId, isDaily)}
        >
          {Object.values(DIFFICULTIES).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>{' '}
      <span className="muted">{DIFFICULTIES[v.difficulty.id].description}</span>{' '}
      {isDaily ? (
        <>
          <span className="tag" style={{ whiteSpace: 'nowrap' }}>Daily challenge {v.daily}</span>{' '}
          <button onClick={() => restart(v.scenario.id, v.difficulty.id, false)}>Random seed instead</button>
        </>
      ) : (
        <button title="Same seed for everyone today (UTC)" onClick={() => restart(v.scenario.id, v.difficulty.id, true)}>
          Daily challenge
        </button>
      )}
    </p>
  );
}

function Briefing({ v, game, hide }: { v: ViewModel; game: GameHandle; hide: () => void }) {
  const today = v.inbox.filter((m) => m.day === v.day);
  const planned = v.changes.filter((c) => c.status === 'PLANNED' && c.activateDay === v.day);
  return (
    <>
      <h2>Morning briefing: day {v.day + 1}, {v.weekday}</h2>
      {v.day === 0 && <FirstDayDifficulty v={v} game={game} />}
      {v.day === 0 && <StartingPerk v={v} game={game} />}
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
        {v.weekendDay && (
          <button className="primary" title="Weekend maintenance and REORG batch, light online: run it at full speed and read the report card" onClick={() => game.send({ type: 'START_DAY', auto: true })}>
            Auto-run the weekend day
          </button>
        )}
        <button className={v.weekendDay ? '' : 'primary'} onClick={() => game.send({ type: 'START_DAY' })}>
          {v.weekendDay ? 'Play the weekend day (06:00)' : 'Start day (06:00)'}
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
  const open = v.incidents.filter((i) => i.day === v.day && !i.rca && i.rcaGroup === undefined);
  const linked = (id: number) => {
    const ws = v.incidents.filter((i) => i.rcaGroup === id).map((i) => i.workloadId);
    return ws.length ? ` · same cause: ${ws.join(', ')}` : '';
  };
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
            <Rca key={i.id} incidentId={i.id} label={`#${i.id} ${i.workloadId} · ${windowText(i)} · worst ${i.worstAttainmentPct.toFixed(0)}%${linked(i.id)}`} hypotheses={i.aiops ?? []} v={v} game={game} />
          ))}
        </div>
      )}
      {v.incidents
        .filter((i) => i.day === v.day && i.rca && i.rcaGroup === undefined)
        .map((i) => (
          <div key={i.id} style={{ marginBottom: 6 }}>
            <div className="row">
              <span>
                #{i.id} {i.workloadId}
                {linked(i.id)}: you said {i.rca!.mechanism}/{i.rca!.trigger}
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
