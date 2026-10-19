import { INSIGHT } from '../content/tools';
import type { ToolView } from '../game/tools';
import type { ViewModel } from '../game/view';
import type { GameHandle } from './useGame';

const TIER_TITLE: Record<number, string> = { 1: 'Tier 1: live visibility', 2: 'Tier 2: deep data', 3: 'Tier 3: planning & automation', 4: 'Tier 4: endgame' };

/** Analytics tool tree: spend Insight on data, pay CPU for measurement (SPEC §8). */
export function Analytics({ v, game }: { v: ViewModel; game: GameHandle }) {
  const name = (id: string) => v.tools.find((t) => t.id === id)?.name ?? id;
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel">
        <h3>Analytics: Insight {v.insight}</h3>
        <p className="muted" style={{ margin: 0 }}>
          You start half blind: yesterday's Workload Activity reports only. Earn Insight by investigating (+{INSIGHT.perReport} per distinct RMF report opened, up to{' '}
          {INSIGHT.reportCapPerDay} a day: {v.reportsOpenedToday}/{INSIGHT.reportCapPerDay} today; correct root-cause analyses; the vendor-trial draft) and spend it on tools.
          Measurement tools cost CPU while they are on; switch them off to save it, and you lose their data.
        </p>
      </div>
      <div className="tree">
        {[1, 2, 3, 4].map((tier) => (
          <div key={tier} className="tier">
            <h4>{TIER_TITLE[tier]}</h4>
            {v.tools
              .filter((t) => t.tier === tier)
              .map((t) => (
                <Tool key={t.id} t={t} name={name} game={game} />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Tool({ t, name, game }: { t: ToolView; name: (id: string) => string; game: GameHandle }) {
  const cls = `tool ${t.owned ? (t.active ? 'owned' : 'off') : t.blocker === null ? 'buyable' : 'locked'}`;
  return (
    <div className={cls}>
      <div className="row">
        <b>{t.name}</b>
        <span className="num">{t.owned ? (t.active ? 'ON' : 'OFF') : `${t.insightCost} ◆`}</span>
      </div>
      <div style={{ fontSize: 12 }}>{t.reveals}</div>
      {t.overhead && <div className="muted" style={{ fontSize: 12 }}>Overhead while on: {t.overhead}</div>}
      {t.prereqs.length > 0 && <div className="muted" style={{ fontSize: 12 }}>Requires {t.prereqs.map(name).join(', ')}</div>}
      <div className="form">
        {!t.owned && (
          <button className="primary" disabled={t.blocker !== null} title={t.blocker ?? undefined} onClick={() => game.send({ type: 'BUY_TOOL', toolId: t.id })}>
            {t.comingSoon ? 'Coming soon' : `Install · ${t.insightCost} Insight`}
          </button>
        )}
        {t.owned && (
          <button onClick={() => game.send({ type: 'SET_TOOL_ACTIVE', toolId: t.id, active: !t.active })}>{t.active ? 'Switch off' : 'Switch on'}</button>
        )}
        {!t.owned && t.blocker && !t.comingSoon && <span className="muted" style={{ fontSize: 12 }}>{t.blocker}</span>}
      </div>
    </div>
  );
}
