// The app shell: the tab bar, the page, the overlays and the toast. Its parts live in `console/`, `app/`,
// `Inbox.tsx`, `Overlays.tsx` and the tab modules (CL-38).
import { useCallback, useEffect, useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { Overlays } from './Overlays';
import { Tutorial } from './Tutorial';
import { useGame } from './useGame';
import { Page, TabButtons } from './app/Page';
import { TopBar } from './app/TopBar';
import { useShortcuts, type Tab } from './app/shortcuts';
import { MentorPanel } from './tutor/MentorPanel';
import { Spotlight, spotlightTarget } from './tutor/Spotlight';

export function App() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('console');
  const [overlayOpen, setOverlayOpen] = useState(true);
  const v = game.view;
  const phase = v?.phase;
  // A new briefing, review or end of run opens the overlay; the live day starts with it closed.
  useEffect(() => setOverlayOpen(phase !== 'LIVE'), [phase, v?.day]);
  const send = game.send;
  const inPrologue = !!v?.tutor;
  // The player's own tab changes are prologue navigation (TUTOR_NOTE, design §6.2); the spotlight's are not.
  const openTab = useCallback(
    (t: Tab) => {
      setTab(t);
      if (inPrologue) send({ type: 'TUTOR_NOTE', kind: 'tab', ref: t });
    },
    [inPrologue, send],
  );
  useShortcuts(game, openTab);
  if (!v) return <div className="app">Starting the sysplex…</div>;
  return (
    <div className={v.tutor ? 'app prologue' : 'app'}>
      <TopBar v={v} game={game} open={overlayOpen} setOpen={setOverlayOpen} />
      {game.spectate && (
        <div className="spectate-banner" role="status">
          Spectating <b>{game.spectate.name}</b> (read-only){game.spectate.error ? ` · cannot read the run file: ${game.spectate.error}` : game.spectate.last ? ` · last command ${game.spectate.last}` : ''}
          {game.spectate.note && <div className="spectate-note">“{game.spectate.note}”</div>}
          {!game.spectate.error && (
            <button type="button" className="spectate-adopt" onClick={game.adoptSpectated} title="Stop watching and keep this run as your own save (replaces any saved run)">
              Take over this run
            </button>
          )}
        </div>
      )}
      <div className="tabs">
        <TabButtons v={v} tab={tab} setTab={openTab} />
        {(v.lastReport || v.phase === 'BRIEFING' || v.phase === 'REVIEW') && (
          <button className={overlayOpen ? 'active' : ''} aria-pressed={overlayOpen} onClick={() => setOverlayOpen(!overlayOpen)}>
            {v.phase === 'REVIEW' ? `Day ${v.day + 1} review` : v.phase === 'BRIEFING' ? 'Briefing' : `Day ${v.lastReport!.day + 1} report card`}
          </button>
        )}
      </div>
      <ErrorBoundary key={tab} where={`${tab} tab`} onReset={() => setTab('console')}>
      <Page v={v} game={game} tab={tab} setTab={openTab} />
      </ErrorBoundary>
      {!game.spectate && !v.tutor && <Tutorial v={v} />}
      {v.tutor && !game.spectate && (
        <>
          <Spotlight
            target={v.phase === 'LIVE' || !overlayOpen ? spotlightTarget(v.tutor.step?.target ?? null, v.tutor.step?.opensTab ?? null, tab) : null}
            stepKey={v.tutor.step?.id ?? ''}
            tab={tab}
            showTab={setTab}
          />
          <MentorPanel t={v.tutor} game={game} showTab={setTab} />
        </>
      )}
      <ErrorBoundary where="briefing / review" onReset={() => setOverlayOpen(false)}>
      <Overlays v={v} game={game} open={overlayOpen} setOpen={setOverlayOpen} />
      </ErrorBoundary>
      {game.toast && <div className={`toast ${game.toast.ok ? '' : 'bad'}`}>{game.toast.message}</div>}
    </div>
  );
}
