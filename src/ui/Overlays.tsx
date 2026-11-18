// The briefing, review and end-of-run overlay (SPEC §8). The screens themselves live in `overlays/`,
// `newRun/`, `endReport/` and `rca/` (CL-38); this file keeps the shell and the phase shortcuts the header
// shows while the overlay is closed.
import { useEffect } from 'react';
import type { ViewModel } from '../game/view';
import type { GameHandle } from './useGame';
import { useConfirmation } from './Confirmation';
import { Briefing } from './overlays/Briefing';
import { Review } from './overlays/Review';
import { DaySummary } from './overlays/DaySummary';
import { NewRun, CareerLine } from './newRun';
import { EndReportView, ShareBox } from './endReport';

/** Review / briefing shortcuts shown in the header's speed-button slot while the overlay is closed. */
export function PhaseActions({ v, game, open, setOpen }: { v: ViewModel; game: GameHandle; open: boolean; setOpen: (o: boolean) => void }) {
  const ask = useConfirmation();
  return (
    <>
      {!open && v.phase === 'REVIEW' && (
        <span className="phase-actions">
          <span className="muted" title="Pin evidence from Reports or Monitor III, then come back">Day {v.day + 1} review</span>
          <button className="primary" onClick={() => setOpen(true)}>
            Back to the review
          </button>
        </span>
      )}
      {!open && v.phase === 'BRIEFING' && (
        <span className="phase-actions">
          {v.weekendDay && (
            <>
              <button className="primary" title="Run the weekend day at full speed; the report card is the summary" onClick={() => game.send({ type: 'START_DAY', auto: true })}>
                Auto-run the weekend day
              </button>{' '}
            </>
          )}
          <button
          className={v.weekendDay ? '' : 'primary'}
          onClick={async () => {
            if (game.savedRunDay !== null && v.day === 0 && !(await ask(`Start this new run? Your saved run (day ${game.savedRunDay + 1}) is replaced at the end of today. Continue it or export it first to keep it.`, 'Start new run', 'danger'))) return;
            game.send({ type: 'START_DAY' });
          }}
        >
            {v.weekendDay ? 'Play it' : `Start day ${v.day + 1} (06:00)`}
          </button>{' '}
          <button onClick={() => setOpen(true)}>Briefing</button>
        </span>
      )}
    </>
  );
}

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
