// Morning briefing: the day meets its inbox, planned changes and the start-day actions. Split from `Overlays.tsx` (CL-38).

import type { ViewModel } from '../../game/view';
import type { GameHandle } from '../useGame';
import { FirstDayDifficulty, StartingPerk } from '../newRun';
import { InboxReply } from '../Inbox';
import { DaySummary } from './DaySummary';

export function Briefing({ v, game, hide }: { v: ViewModel; game: GameHandle; hide: () => void }) {
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
          <InboxReply message={m} game={game} />
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
