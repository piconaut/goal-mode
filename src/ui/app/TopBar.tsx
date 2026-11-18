// The header: clock, day, speed, trust, hours, the phase actions and the display toggles. Split from `App.tsx` (CL-38).

import type { ViewModel } from '../../game/view';
import { AUTO_SPEED } from '../../worker/protocol';
import { PhaseActions } from '../Overlays';
import type { GameHandle } from '../useGame';
import { RunFileButtons } from '../RunFiles';
import { SoundToggle } from './SoundToggle';
import { ThemeToggle } from './ThemeToggle';

const trustColor = (t: number) => (t >= 60 ? 'var(--good)' : t >= 35 ? 'var(--warn)' : 'var(--crit)');


export function TopBar({ v, game, open, setOpen }: { v: ViewModel; game: GameHandle; open: boolean; setOpen: (o: boolean) => void }) {
  const speed = game.speed;
  const set = (s: number) => game.send({ type: 'SET_SPEED', speed: s });
  const progress = (100 * v.tickOfDay) / v.ticksPerDay;
  return (
    <div className="topbar">
      <span className="brand">GOAL MODE</span>
      <span className="clock">{v.clock}</span>
      <span className="stat">
        Day <b>{v.endlessFromDay !== null ? <>{v.day + 1} (endless)</> : <>{Math.min(v.day + 1, v.maxDays)} / {v.maxDays}</>}</b> <span className="muted">· {v.weekday.slice(0, 3)} · {v.difficulty.name}</span>{v.daily && <span className="muted"> · Daily {v.daily}</span>}
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
            <button
              key={s}
              className={speed === s ? 'active' : ''}
              disabled={s === 0 && !v.difficulty.pauseAllowed}
              title={s === 0 && !v.difficulty.pauseAllowed ? 'Ironman: no pause during the live day' : s === 0 ? 'Space' : `key ${[0.5, 1, 2, 4, 8].indexOf(s) + 1}`}
              onClick={() => set(s)}
            >
              {s === 0 ? '❚❚' : `${s}×`}
            </button>
          ))}
          {(v.weekendDay || speed === AUTO_SPEED) && (
            <button className={speed === AUTO_SPEED ? 'active' : ''} title="Run the rest of the weekend day at full speed" onClick={() => set(AUTO_SPEED)}>
              Auto ⏩
            </button>
          )}
        </span>
      )}
      <PhaseActions v={v} game={game} open={open} setOpen={setOpen} />
      <span className="stat">
        Trust <b style={{ color: trustColor(v.trustOverall) }}>{v.trustOverall.toFixed(0)}</b>
      </span>
      {Object.keys(v.trust).map((f) => (
        <span className="stat" key={f}>
          {f} <b style={{ color: trustColor(v.trust[f]!) }}>{v.trust[f]!.toFixed(0)}</b>
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
        Score <b>{v.score}</b>
      </span>
      <SoundToggle v={v} />
      <RunFileButtons game={game} />
      <ThemeToggle />
    </div>
  );
}
