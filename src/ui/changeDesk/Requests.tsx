import { useState } from 'react';
import { basketLabel, commandTarget, describeCommand, orderBasket } from '../../game/changeDesk';
import type { PlannedChange } from '../../game/types';
import type { ViewModel } from '../../game/view';
import type { Command } from '../../sim/core/commands';
import { Empty } from '../Empty';
import { WhatIf } from '../WhatIf';
import type { GameHandle } from '../useGame';
import type { Desk } from './shared';
import { ACTIVATE_PREVIEW, costText, preview } from './shared';

export function PendingBanner({ v, game }: { v: ViewModel; game: GameHandle }) {
  const p = preview(v, { commands: ACTIVATE_PREVIEW });
  return (
    <div className="banner">
      <span>
        Pending WLM policy <b>{game.pending!.policyName}</b> is not active yet.
      </span>
      <button className="primary" disabled={!p.ok} title={p.reason ?? undefined} onClick={() => game.send({ type: 'ACTIVATE_PENDING' })}>
        Install &amp; activate · {costText(p)}
      </button>
      <button onClick={() => game.send({ type: 'DISCARD_PENDING' })}>Discard</button>
      {p.reason && <span className="err">{p.reason}</span>}
    </div>
  );
}

export function Board({ v, game }: { v: ViewModel; game: GameHandle }) {
  const live = v.phase === 'LIVE';
  const planned = v.changes.filter((c) => c.status === 'PLANNED');
  const done = v.changes.filter((c) => c.status !== 'PLANNED');
  const days = [...new Set(planned.map((c) => c.activateDay))].sort((a, b) => a - b);
  const codActive = done.filter((c) => c.status === 'APPLIED' && c.revertDay !== null && c.revertDay > v.day);
  return (
    <div className="panel">
      <h3>Change board</h3>
      <div className="muted">
        {live
          ? 'Live day: changes are EMERGENCY changes, applied within seconds, at a trust cost.'
          : v.phase === 'BRIEFING'
            ? 'Briefing: changes are planned and take effect at 06:00 when the day starts.'
            : 'Changes can be made during the briefing or the live day.'}{' '}
        {v.constraints.includes('FREEZE') && <span className="tag bad">CHANGE FREEZE</span>} Hours left: {v.hoursLeft.toFixed(1)} · fatigue {v.fatigue.toFixed(0)}
      </div>
      {days.length === 0 && <Empty>Nothing planned.</Empty>}
      {days.map((d) => (
        <div key={d} style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {d === v.day ? (live ? 'Today' : 'Today at 06:00') : d === v.day + 1 ? 'Tomorrow at 06:00' : `Day ${d + 1} at 06:00`}
            {d > v.day + 1 ? ` (in ${d - v.day} days)` : ''}
          </div>
          <table>
            <tbody>
              {planned
                .filter((c) => c.activateDay === d)
                .map((c) => (
                  <ChangeRow key={c.id} c={c} v={v} game={game} />
                ))}
            </tbody>
          </table>
        </div>
      ))}
      {codActive.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {codActive.map((c) => (
            <div className="row" key={c.id}>
              <span>{c.label}</span>
              <span className="tag warn">temporary · reverts at day {c.revertDay! + 1} 06:00</span>
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <details>
          <summary>History ({done.length})</summary>
          <table>
            <tbody>
              {[...done].reverse().map((c) => (
                <ChangeRow key={c.id} c={c} v={v} game={game} />
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function ChangeRow({ c, v, game }: { c: PlannedChange; v: ViewModel; game: GameHandle }) {
  const cancellable = c.status === 'PLANNED' && !(c.activateDay === v.day && v.phase !== 'BRIEFING');
  const refund = c.plannedDay === v.day ? `${c.hours}h back` : 'hours already spent';
  return (
    <tr>
      <td className="change-label">
        {c.label}
        {c.capex > 0 && c.status === 'PLANNED' && <span className="tag"> on order · arrives day {c.activateDay + 1}</span>}
      </td>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
        day {c.activateDay + 1}
      </td>
      <td className="muted num">{c.hours}h</td>
      <td className="change-status">
        <span className={`tag ${c.status === 'APPLIED' ? 'good' : c.status === 'FAILED' ? 'bad' : 'warn'}`}>{c.status}</span>
        {c.emergency && <span className="tag bad">EMERG</span>}
      </td>
      <td style={{ textAlign: 'right' }}>
        {cancellable && (
          <button title={`Cancel (${refund}${c.capex ? `, $${Math.round(c.capex / 1000)}k capex back` : ''})`} onClick={() => game.send({ type: 'CANCEL_CHANGE', changeId: c.id })}>
            Cancel
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * The change request: every drafted edit, one line each with its own hours, and the request-level cost (emergency trust
 * and the one failure roll) once, next to Submit. Stays on screen at the bottom of the Change Desk.
 */
export function ChangeRequestBar({ desk, setBasket, game }: { desk: Desk; setBasket: (b: Command[]) => void; game: GameHandle }) {
  const [open, setOpen] = useState(false);
  const { basket, cfg, v } = desk;
  const bad = Object.values(desk.invalid);
  if (basket.length === 0 && bad.length === 0) return null;
  const ordered = orderBasket(cfg, basket);
  const p = preview(v, { commands: ordered });
  const request = [
    p.emergency ? (p.trustCostEach > 0 ? `emergency: −${p.trustCostEach} trust each` : 'emergency') : 'planned: takes effect at 06:00',
    ...(p.failRisk > 0 ? [`${(p.failRisk * 100).toFixed(0)}% fail risk (one roll)`] : []),
  ].join(' · ');
  return (
    <div className="banner change-bar" role="region" aria-label="Change request">
      {open && (
        <div className="change-bar-list">
          <ul className="diff">
            {basket.map((c) => (
              <li key={commandTarget(c)}>
                <span>{describeCommand(c, cfg)}</span>
                <span className="cost">{preview(v, { commands: [c] }).hours}h</span>
                <button aria-label={`Remove ${describeCommand(c, cfg)}`} onClick={() => desk.setDraft(commandTarget(c), null)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <WhatIf v={v} game={game} basket={ordered} label={basketLabel(basket, cfg)} />
        </div>
      )}
      <div className="change-bar-row">
        <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Change request · {basket.length} change{basket.length === 1 ? '' : 's'}
        </button>
        <span className="cost">
          {p.hours}h of {v.previewCtx.hoursLeft.toFixed(1)}h left · {request}
        </span>
        <span className="change-bar-acts">
          {bad.length > 0 ? (
            <span className="err" title={bad.join('\n')}>
              Fix or undo {bad.length === 1 ? bad[0] : `${bad.length} invalid fields`}
            </span>
          ) : (
            p.reason && basket.length > 0 && <span className="err">{p.reason}</span>
          )}
          <button onClick={() => setBasket([])}>Clear</button>
          <button
            className="primary"
            disabled={!p.ok || bad.length > 0}
            title={bad.length ? 'A field has an invalid value' : p.reason ?? undefined}
            onClick={() => {
              desk.apply(basketLabel(basket, cfg), ordered);
              setBasket([]);
            }}
          >
            Submit as one change
          </button>
        </span>
      </div>
    </div>
  );
}

export function Results({ game }: { game: GameHandle }) {
  return (
    <div className="panel">
      <h3>Results</h3>
      {game.results.length === 0 ? (
        <div className="muted">Outcomes of your requests appear here.</div>
      ) : (
        <div className="log">
          {[...game.results].reverse().map((r, i) => (
            <div key={i} style={r.ok ? undefined : { color: 'var(--crit)' }}>
              <span className="muted">{r.clock}</span> {r.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
