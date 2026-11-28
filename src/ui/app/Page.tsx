// The tab buttons and the tab's page, split from `App.tsx` so the prologue's anchor test can render a tab on its
// own (PRO-03).
import type { ViewModel } from '../../game/view';
import { Actions } from '../Actions';
import { Analytics } from '../Analytics';
import { Codex } from '../Codex';
import { EvidenceBoard } from '../Evidence';
import { Finance } from '../Finance';
import { Inbox } from '../Inbox';
import { Monitor } from '../Monitor';
import { Problems } from '../Problems';
import { Reports } from '../Reports';
import { Smf } from '../Smf';
import type { GameHandle } from '../useGame';
import { Console } from '../console/Console';
import { TABS, type Tab } from './shortcuts';

const tabLabel = (t: Tab, v: ViewModel) =>
  t === 'console' ? 'Ops Console' : t === 'monitor' ? (v.features.includes('MON3') ? `Monitor III${v.mon3?.exceptions.length ? ` (${v.mon3.exceptions.length}!)` : ''}` : 'Monitor III 🔒') : t === 'reports' ? 'RMF Reports' : t === 'changes' ? 'Change Desk' : t === 'finance' ? 'Finance' : t === 'analytics' ? `Analytics (${v.insight}◆)` : t === 'codex' ? 'Codex' : `Inbox (${v.inbox.length})`;

export function TabButtons({ v, tab, setTab }: { v: ViewModel; tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <>
      {TABS.map((t, i) => (
        <button key={t} data-tour={`tab.${t}`} className={tab === t ? 'active' : ''} title={`Alt+${i + 1}`} onClick={() => setTab(t)}>
          {tabLabel(t, v)}
        </button>
      ))}
    </>
  );
}

export function Page({ v, game, tab, setTab }: { v: ViewModel; game: GameHandle; tab: Tab; setTab: (t: Tab) => void }) {
  return (
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
  );
}
