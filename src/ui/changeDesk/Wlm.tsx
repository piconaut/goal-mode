import { useEffect, useState, type FormEvent } from 'react';
import type { ViewModel } from '../../game/view';
import type { Qualifier, SubsystemType, WorkAttributes } from '../../sim/wlm/types';
import { CodexHints } from '../CodexHint';
import { ServiceClasses } from '../ServiceClassEditor';
import type { GameHandle } from '../useGame';
import { ACTIVATE_PREVIEW, costText, preview } from './shared';

/** "Where does this work go?" against the pending (or active) policy. */
function ClassifyBench({ game }: { game: GameHandle }) {
  const [ss, setSs] = useState<SubsystemType>('DDF');
  const [attrs, setAttrs] = useState<Record<string, string>>({ UI: 'MOBAPI' });
  const quals: Qualifier[] = ['TN', 'UI', 'TC', 'PK', 'CI', 'SY'];
  const run = (e: FormEvent) => {
    e.preventDefault();
    const work: WorkAttributes = { subsystem: ss };
    for (const q of quals) if (attrs[q]) work[q] = attrs[q]!.toUpperCase();
    game.send({ type: 'CLASSIFY', work });
  };
  const c = game.classified;
  return (
    <>
      <form className="form" onSubmit={run}>
        Test
        <select aria-label="Subsystem" value={ss} onChange={(e) => setSs(e.target.value as SubsystemType)}>
          {(['STC', 'JES', 'CICS', 'DDF', 'TSO', 'OMVS'] as SubsystemType[]).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        {quals.map((q) => (
          <input key={q} aria-label={q} placeholder={q} size={6} value={attrs[q] ?? ''} onChange={(e) => setAttrs({ ...attrs, [q]: e.target.value })} />
        ))}
        <button type="submit">Classify</button>
      </form>
      {c && (
        <div className="muted" style={{ fontSize: 12 }}>
          → <b style={{ color: 'var(--text)' }}>{c.result.serviceClass}</b>
          {c.result.reportClass ? ` (report class ${c.result.reportClass})` : ''} via {c.result.path.join(' › ')} {c.pending ? '[pending policy]' : '[active policy]'}
        </div>
      )}
    </>
  );
}

export function Wlm({ v, game, rulesOpen, toggleRules }: { v: ViewModel; game: GameHandle; rulesOpen: boolean; toggleRules: () => void }) {
  const [showJson, setShowJson] = useState(false);
  // Local JSON edits; cleared whenever the worker sends a newer pending/active policy.
  const [json, setJson] = useState('');
  useEffect(() => setJson(''), [game.policy]);
  useEffect(() => {
    game.send({ type: 'GET_RULES' });
  }, [game, v.policyName, v.day]);
  const jsonEdited = json !== '' && json !== game.policy;
  const p = preview(v, { commands: ACTIVATE_PREVIEW });
  return (
    <>
      {game.pending && <div className="tag warn">editing pending {game.pending.policyName} (not active)</div>}
      <h4>Service classes</h4>
      <ServiceClasses v={v} game={game} />
      <h4>Policy options</h4>
      <IoPriorityToggle v={v} game={game} />
      <h4>Classification</h4>
      <div className="form">
        <button aria-expanded={rulesOpen} aria-controls="classification-rules" className={rulesOpen ? 'active' : ''} onClick={toggleRules}>
          {rulesOpen ? '▾ Hide classification rules' : '▸ Classification rules'}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {game.rules ? `${(game.rules.pending ?? game.rules.active).subsystems.reduce((a, s) => a + s.rows.length, 0)} rules` : ''}
          {game.rules && (game.rules.pending ?? game.rules.active).sysother.length > 0 && (
            <span className="tag bad"> {(game.rules.pending ?? game.rules.active).sysother.length} unclassified → SYSOTHER</span>
          )}
        </span>
      </div>
      <div className="help">Where work goes: rules per subsystem, first match wins. Test a piece of work below to see which rule catches it.</div>
      <ClassifyBench game={game} />
      <h4>Install</h4>
      <div className="help">All edits go to a pending policy until you install and activate it.</div>
      <div className="form">
        <button
          className="primary"
          disabled={(!game.pending && !jsonEdited) || !p.ok}
          title={p.reason ?? undefined}
          onClick={() => (jsonEdited ? game.send({ type: 'ACTIVATE_JSON', json }) : game.send({ type: 'ACTIVATE_PENDING' }))}
        >
          Install &amp; activate{jsonEdited ? ' (edited JSON)' : game.pending ? ` ${game.pending.policyName}` : ''} · {costText(p)}
        </button>
        {(game.pending || jsonEdited) && (
          <button
            onClick={() => {
              setJson('');
              game.send({ type: 'DISCARD_PENDING' });
            }}
          >
            Discard
          </button>
        )}
        <button
          onClick={() => {
            game.send({ type: 'GET_POLICY' });
            setShowJson(!showJson);
          }}
        >
          {showJson ? 'Hide' : 'Review'} policy JSON
        </button>
      </div>
      {showJson && <textarea aria-label="Policy JSON" rows={14} value={jsonEdited ? json : game.policy} onChange={(e) => setJson(e.target.value)} />}
    </>
  );
}

/** Saved service policies and the daily V WLM,POLICY= schedule. */
export function PolicySchedule({ v, game }: { v: ViewModel; game: GameHandle }) {
  const { saved, schedule } = v.policies;
  const [name, setName] = useState('');
  const [rows, setRows] = useState(schedule);
  // Re-sync the editor when the stored schedule changes.
  useEffect(() => setRows(schedule), [JSON.stringify(schedule)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(rows) !== JSON.stringify(schedule);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const nameErr = name && !/^[A-Z][A-Z0-9#@$]{0,7}$/.test(name) ? '1–8 chars, starts with a letter' : null;
  return (
    <>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name && !nameErr) game.send({ type: 'SAVE_POLICY', name });
        }}
      >
        <label>
          Save {game.pending ? `pending ${game.pending.policyName}` : `active ${v.policyName}`} as{' '}
          <input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="e.g. NIGHTPOL" size={9} />
        </label>
        <button type="submit" disabled={!name || nameErr !== null}>
          Save policy
        </button>
        {nameErr && <span className="err">{nameErr}</span>}
      </form>
      {saved.length === 0 ? (
        <div className="muted">No saved policies. Edit the policy above, then save it under a name (DAYPOL, NIGHTPOL…) to schedule it.</div>
      ) : (
        <ul className="diff">
          {saved.map((p) => (
            <li key={p.name}>
              <details>
                <summary>
                  {p.name}
                  {p.name === v.policyName && <span className="tag good"> active</span>}
                </summary>
                <div className="muted" style={{ fontSize: 11, whiteSpace: 'normal' }}>{p.summary}</div>
              </details>
              <button aria-label={`Delete policy ${p.name}`} onClick={() => game.send({ type: 'DELETE_POLICY', name: p.name })}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 8 }}>
        <b style={{ fontSize: 13 }}>Daily switches</b>
        {rows.map((r, i) => (
          <div className="form" key={i}>
            at
            <select aria-label="Switch hour" value={r.hour} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, hour: Number(e.target.value) } : x)))}>
              {hours.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
            activate
            <select aria-label="Policy to activate" value={r.policyName} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, policyName: e.target.value } : x)))}>
              {saved.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
            <button type="button" aria-label="Remove switch" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <div className="form">
          <button type="button" disabled={saved.length === 0 || rows.length >= 4} onClick={() => setRows([...rows, { hour: rows.length ? 20 : 6, policyName: saved[0]!.name }])}>
            + switch
          </button>
          <button type="button" className="primary" disabled={!dirty} onClick={() => game.send({ type: 'SET_POLICY_SCHEDULE', schedule: rows })}>
            Apply schedule · 0.5h
          </button>
          {dirty && <button onClick={() => setRows(schedule)}>Revert</button>}
        </div>
      </div>
      <div className="help">
        Operations automation issues V WLM,POLICY=name at each switch time, every day, at no further cost. A night policy that favours batch helps the window but hurts any online
        work that arrives at night; a manually activated policy is replaced at the next switch.
      </div>
    </>
  );
}

/** Service coefficient option: I/O priority management (YES orders the IOSQ by priority and counts I/O in velocity). */
function IoPriorityToggle({ v, game }: { v: ViewModel; game: GameHandle }) {
  const on = game.pending ? game.pending.ioPriorityManagement : v.ioPriorityManagement;
  return (
    <div className="form">
      <label>
        <input type="checkbox" checked={on} onChange={(e) => game.send({ type: 'WLM_EDIT', edit: { op: 'SET_IO_PRIORITY', on: e.target.checked } })} /> I/O priority management
        <CodexHints ids={['io-priority']} />
      </label>
      <span className="muted" style={{ fontSize: 12 }}>
        {on
          ? 'YES: z/OS queues I/O (IOSQ) by dispatching priority, and I/O using/delay count in execution velocity.'
          : 'NO: I/O is queued first come, first served, and velocity counts CPU and zIIP only (velocity goals read differently).'}
      </span>
    </div>
  );
}
