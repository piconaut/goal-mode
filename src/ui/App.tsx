// The app shell: the tab bar, the page, the overlays and the toast. Its parts live in `console/`, `app/`,
// `Inbox.tsx`, `Overlays.tsx` and the tab modules (CL-38).
import { useEffect, useState } from 'react';
import { Actions } from './Actions';
import { Analytics } from './Analytics';
import { Codex } from './Codex';
import { ErrorBoundary } from './ErrorBoundary';
import { EvidenceBoard } from './Evidence';
import { Finance } from './Finance';
import { Inbox } from './Inbox';
import { Monitor } from './Monitor';
import { Overlays } from './Overlays';
import { Reports } from './Reports';
import { Problems } from './Problems';
import { Smf } from './Smf';
import { Tutorial } from './Tutorial';
import { useGame } from './useGame';
import { TopBar } from './app/TopBar';
import { TABS, useShortcuts, type Tab } from './app/shortcuts';
import { Console } from './console/Console';

export function App() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('console');
  const [overlayOpen, setOverlayOpen] = useState(true);
  const v = game.view;
  const phase = v?.phase;
  // A new briefing, review or end of run opens the overlay; the live day starts with it closed.
  useEffect(() => setOverlayOpen(phase !== 'LIVE'), [phase, v?.day]);
  useShortcuts(game, setTab);
  if (!v) return <div className="app">Starting the sysplex…</div>;
  return (
    <div className="app">
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
        {TABS.map((t, i) => (
          <button key={t} className={tab === t ? 'active' : ''} title={`Alt+${i + 1}`} onClick={() => setTab(t)}>
            {t === 'console' ? 'Ops Console' : t === 'monitor' ? (v.features.includes('MON3') ? `Monitor III${v.mon3?.exceptions.length ? ` (${v.mon3.exceptions.length}!)` : ''}` : 'Monitor III 🔒') : t === 'reports' ? 'RMF Reports' : t === 'changes' ? 'Change Desk' : t === 'finance' ? 'Finance' : t === 'analytics' ? `Analytics (${v.insight}◆)` : t === 'codex' ? 'Codex' : `Inbox (${v.inbox.length})`}
          </button>
        ))}
        {(v.lastReport || v.phase === 'BRIEFING' || v.phase === 'REVIEW') && (
          <button className={overlayOpen ? 'active' : ''} aria-pressed={overlayOpen} onClick={() => setOverlayOpen(!overlayOpen)}>
            {v.phase === 'REVIEW' ? `Day ${v.day + 1} review` : v.phase === 'BRIEFING' ? 'Briefing' : `Day ${v.lastReport!.day + 1} report card`}
          </button>
        )}
      </div>
      <ErrorBoundary key={tab} where={`${tab} tab`} onReset={() => setTab('console')}>
      <div className="page">
        {tab === 'console' && <Console v={v} history={game.history} />}
        {tab === 'monitor' && <Monitor v={v} game={game} openAnalytics={() => setTab('analytics')} />}
        {tab === 'reports' && (
          <>
            <Reports v={v} game={game} />
            <Smf v={v} game={game} openAnalytics={() => setTab('analytics')} />
            <EvidenceBoard v={v} game={game} />
            <Problems v={v} game={game} />
          </>
        )}
        {tab === 'changes' && <Actions v={v} game={game} />}
        {tab === 'analytics' && <Analytics v={v} game={game} />}
        {tab === 'finance' && <Finance v={v} game={game} />}
        {tab === 'codex' && <Codex v={v} />}
        {tab === 'inbox' && <Inbox v={v} game={game} />}
      </div>
      </ErrorBoundary>
      {!game.spectate && <Tutorial v={v} />}
      <ErrorBoundary where="briefing / review" onReset={() => setOverlayOpen(false)}>
      <Overlays v={v} game={game} open={overlayOpen} setOpen={setOverlayOpen} />
      </ErrorBoundary>
      {game.toast && <div className={`toast ${game.toast.ok ? '' : 'bad'}`}>{game.toast.message}</div>}
    </div>
  );
}
