import { FIXES } from '../../game/catalog';
import type { ViewModel } from '../../game/view';
import type { Command } from '../../sim/core/commands';
import { CodexHints } from '../CodexHint';
import { Empty } from '../Empty';
import type { GameHandle } from '../useGame';
import type { Desk } from './shared';
import { costText, preview } from './shared';

/** Multi-day projects: book engineer-hours each briefing for a permanent improvement. */
export function Projects({ v, game }: { v: ViewModel; game: GameHandle }) {
  const briefing = v.phase === 'BRIEFING';
  return (
    <>
      <div className="help">Book engineer-hours during the briefing; each project takes several days and has a daily ceiling. Hours spent here are not there for firefighting.</div>
      {v.projects.map((p) => {
        const left = Math.min(p.maxHoursPerDay - p.hoursToday, p.hours - p.hoursDone);
        return (
          <div key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <div className="row">
              <b>
                {p.name}
                {p.codex && <CodexHints ids={[p.codex]} />}
              </b>
              {p.done ? <span className="tag good">done</span> : <span className="num muted">{p.hoursDone}/{p.hours}h</span>}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{p.description}</div>
            {!p.done && (
              <>
                <span className="bar" style={{ height: 6, display: 'block', margin: '4px 0' }}>
                  <span style={{ width: `${(100 * p.hoursDone) / p.hours}%`, background: 'var(--accent)' }} />
                </span>
                <div className="form">
                  {left <= 0 && <span className="tag">today’s ceiling reached</span>}
                  {left > 0 && [2, 4].filter((h) => h <= p.maxHoursPerDay).map((h) => (
                    <button key={h} disabled={!briefing || left <= 0 || v.hoursLeft < Math.min(h, left)} onClick={() => game.send({ type: 'PROJECT_WORK', id: p.id, hours: h })}>
                      +{Math.min(h, Math.max(0, left))}h today
                    </button>
                  ))}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {p.hoursToday > 0 ? `${p.hoursToday}h booked today · ` : ''}max {p.maxHoursPerDay}h/day{!briefing ? ' · book during the briefing' : ''}
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

export function Ops({ desk, game }: { desk: Desk; game: GameHandle }) {
  const { v } = desk;
  const incidentOpen = v.previewCtx.incidentOpen;
  return (
    <>
      {v.batch.abended.length === 0 && <Empty>No abended jobs.</Empty>}
      {v.batch.abended.map((a) => {
        const commands: Command[] = [{ kind: 'RESTART_JOB', day: a.day, name: a.name }];
        const p = preview(v, { commands });
        return (
          <div className="row" key={`${a.day}:${a.name}`}>
            <span>
              Restart {a.name} <span className="muted">({a.stream})</span> {a.critical && <span className="tag bad">critical path</span>}
            </span>
            <button disabled={!p.ok} title={p.reason ?? undefined} onClick={() => desk.apply(`Restart ${a.name}`, commands)}>
              Restart · {costText(p)}
            </button>
          </div>
        );
      })}
      {FIXES.filter((f) => v.fixIds.includes(f.id)).map((f) => {
        const p = preview(v, { fixId: f.id });
        return (
          <div className="row" key={f.id}>
            <span>
              {f.name}
              <div className="muted" style={{ fontSize: 12 }}>
                {f.description}
                {f.trustCost ? ` Costs ${f.trustCost.amount} ${f.trustCost.facet} trust.` : ''}
                {f.operational ? ' Operator command: no change-board trust cost.' : ''}
              </div>
              {!incidentOpen && <div className="muted" style={{ fontSize: 12 }}>No open incident: only worth it if you have diagnosed this cause.</div>}
            </span>
            <button disabled={!p.ok} title={p.reason ?? undefined} onClick={() => game.send({ type: 'CHANGE', req: { label: f.name, fixId: f.id } })}>
              {costText(p)}
            </button>
          </div>
        );
      })}
    </>
  );
}
