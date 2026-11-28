import { useId, useState } from 'react';
import { CANCEL_WARNINGS } from '../../content/operations';
import { operationHours, type OfferedBasis } from '../../game/operations';
import type { ViewModel } from '../../game/view';
import type { Command } from '../../sim/core/commands';
import type { Operation } from '../../sim/core/operations';
import { GATEWAY_MODE_LABEL } from '../labels';
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
      <div className="help">Book engineer-hours during the briefing; each project takes several days and has a daily ceiling. Hours spent here are not there for firefighting.{v.previewCtx.staffSurcharge ? ' A slow TSO makes hands-on changes cost more; planned project time is not surcharged.' : ''}</div>
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
  return (
    <>
      <OperatorCommands v={v} game={game} />
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
    </>
  );
}

type OperationOption = { label: string; op: Operation; warning?: string };

const OFFERED_BASIS_LABEL: Record<OfferedBasis, string> = {
  CLOSED: 'offered avg (last hour)',
  TICK: 'offered now',
  ADMITTED: 'admitted now (no offered history)',
};

const tpsText = (rate: number): string => `${rate >= 10 ? rate.toFixed(0) : rate.toFixed(2)} tps`;

function OperationButton({ op, action, v, game, disabled = false, onSent }: {
  op: Operation | null;
  action: string;
  v: ViewModel;
  game: GameHandle;
  disabled?: boolean;
  onSent?: () => void;
}) {
  const hours = op ? operationHours(op, v.previewCtx.staffSurcharge?.mult) : undefined;
  return (
    <button disabled={v.phase !== 'LIVE' || !op || disabled} onClick={() => {
      if (!op) return;
      game.send({ type: 'OPERATION', op });
      onSent?.();
    }}>
      {action}{hours !== undefined ? ` · ${hours}h` : ''}
    </button>
  );
}

function OperationPicker({ title, action, empty, options, v, game }: {
  title: string;
  action: string;
  empty: string;
  options: OperationOption[];
  v: ViewModel;
  game: GameHandle;
}) {
  const id = useId();
  const [selected, setSelected] = useState('');
  const keyed = options.map((option) => ({ ...option, key: JSON.stringify(option.op) }));
  const choice = keyed.find((option) => option.key === selected);
  return (
    <div className="form">
      <label htmlFor={id}>{title}</label>
      <select id={id} value={choice?.key ?? ''} disabled={!options.length} onChange={(e) => setSelected(e.target.value)}>
        <option value="">{options.length ? 'Select a target' : empty}</option>
        {keyed.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
      </select>
      <OperationButton op={choice?.op ?? null} action={action} v={v} game={game} />
      {choice?.warning && <div className="help">{choice.warning}</div>}
    </div>
  );
}

function OperatorCommands({ v, game }: { v: ViewModel; game: GameHandle }) {
  const { jobs, addressSpaces, tso, threads, utilities, missedUtilities, gateway, recalls } = v.operations;
  const session = ({ kind, id, workloadId, lparId, day }: (typeof tso)[number]): Operation =>
    ({ kind: 'CANCEL_SESSION', target: { kind, id, workloadId, lparId, day } });
  return (
    <>
      {v.phase !== 'LIVE' && <div className="help">Operator commands are available during the live day.</div>}
      <OperationPicker v={v} game={game} title="Job or started task" action="Cancel" empty="No active targets" options={[
        ...jobs.map((j) => ({ label: `${j.jobname} · ${j.lparId} · batch`, op: { kind: 'CANCEL_JOB' as const, ...j } })),
        ...addressSpaces.map((a) => ({ label: `${a.jobname} · ${a.lparId}`, op: { kind: 'CANCEL_ADDRESS_SPACE' as const, ...a }, warning: CANCEL_WARNINGS[a.jobname] })),
      ]} />
      <OperationPicker v={v} game={game} title="TSO user" action="Log off" empty="No logged-on users" options={tso.map((e) => ({
        label: `${e.id} · ${e.lparId} · ${e.cpuSec.toFixed(2)} CPU s`, op: session(e),
      }))} />
      <details>
        <summary>Db2 −DISPLAY THREAD</summary>
        <table>
          <thead><tr><th>Token</th><th>Member</th><th>Workload</th><th>Auth ID</th><th>Correlation ID</th><th>CPU s / tick</th></tr></thead>
          <tbody>{threads.map((e) => (
            <tr key={`${e.workloadId}:${e.lparId}:${e.id}`}><td>{e.id}</td><td>{e.member ?? e.lparId}</td><td>{e.workloadId}</td><td>{e.authid}</td><td>{e.corrid}</td><td>{e.cpuSec.toFixed(2)}</td></tr>
          ))}</tbody>
        </table>
      </details>
      <OperationPicker v={v} game={game} title="Db2 thread" action="Cancel thread" empty="No active threads" options={threads.map((e) => ({
        label: `${e.id} · ${e.member ?? e.lparId} · ${e.workloadId} · ${e.cpuSec.toFixed(2)} CPU s`, op: session(e),
      }))} />
      <details>
        <summary>Db2 −DISPLAY UTILITY</summary>
        {utilities.length ? (
          <table>
            <thead><tr><th>ID</th><th>Utility</th><th>Member</th><th>Object</th><th>Status</th></tr></thead>
            <tbody>{utilities.map((u) => (
              <tr key={`${u.member}:${u.id}`}><td>{u.id}</td><td>{u.kind}</td><td>{u.member}</td><td>{u.object}</td><td>{u.overrun ? 'Past scheduled end' : 'Active'}</td></tr>
            ))}</tbody>
          </table>
        ) : <Empty>No active utilities.</Empty>}
        {missedUtilities.map((u) => (
          <div key={u.id}>
            {u.id} · {u.member} · {u.object} · Day {u.day + 1} run lost. {utilities.some((a) => a.id === u.id) ? 'Replacement running.' : 'Awaiting next scheduled run.'}
          </div>
        ))}
      </details>
      <OperationPicker v={v} game={game} title="Db2 utility" action="Terminate" empty="No active utilities" options={utilities.map(({ id, kind, member, day }) => ({
        label: `${id} · ${member} · ${kind}`, op: { kind: 'TERM_UTILITY', id, member, day },
      }))} />
      <RecycleRegions v={v} game={game} />
      <div className="row"><span>Back out a change</span><a href="#other-team-changes">Other teams’ changes on the Change board</a></div>
      <details>
        <summary>Gateway status</summary>
        {gateway.map((g) => <div className="row" key={g.id}><span>{g.name}</span><span>{g.mode ? GATEWAY_MODE_LABEL[g.mode] : 'Off'} · {OFFERED_BASIS_LABEL[g.offeredBasis]} {tpsText(g.offeredAvgPerSec)}</span></div>)}
      </details>
      <OperationPicker v={v} game={game} title="Gateway protection" action="Apply mode" empty="No external channels"
        options={gateway.flatMap((g) => ([null, 'LIMIT', 'BACKOFF', 'BLOCK'] as const)
          .filter((mode) => g.mode !== mode)
          .map((mode) => ({ label: `${g.name} · ${mode ? GATEWAY_MODE_LABEL[mode] : 'Off'}`, op: { kind: 'SET_GATEWAY', workloadId: g.id, mode } })))
        } />
      <div className="row">
        <span>
          DFSMShsm recalls {recalls.held ? 'HELD' : 'RELEASED'} · {Math.round(recalls.backlogIo).toLocaleString()} queued I/Os · {Math.round(recalls.incomingIops).toLocaleString()} incoming IOPS now
          <CodexHints ids={['hsm-recall-hold']} />
        </span>
        <OperationButton op={{ kind: 'HOLD_HSM_RECALL', held: !recalls.held }} action={recalls.held ? 'Release recalls' : 'Hold recalls'} v={v} game={game} />
      </div>
    </>
  );
}

function RecycleRegions({ v, game }: { v: ViewModel; game: GameHandle }) {
  const [selected, setSelected] = useState<string[]>([]);
  const regions = v.operations.regions.map((r) => ({ ...r, key: `${r.name}@${r.lparId}` }));
  const targets = regions.filter((r) => !r.recycle && selected.includes(r.key)).map(({ name, lparId }) => ({ name, lparId }));
  const op: Operation = { kind: 'RECYCLE_CICS', targets };
  return (
    <details>
      <summary>Recycle CICS regions</summary>
      <div className="form">
        {regions.map((r) => (
          <label key={r.key}>
            <input type="checkbox" disabled={!!r.recycle} checked={!r.recycle && selected.includes(r.key)}
              onChange={(e) => setSelected(e.target.checked ? [...selected, r.key] : selected.filter((key) => key !== r.key))} />
            {r.name} · {r.lparId}{r.recycle ? (r.recycle.startTick > v.tick ? ' · Queued' : ' · Restarting') : ''}
          </label>
        ))}
      </div>
      <OperationButton op={op} action="Recycle selected" v={v} game={game} disabled={!targets.length} onSent={() => setSelected([])} />
      <CodexHints ids={['cics-recycle']} />
    </details>
  );
}
