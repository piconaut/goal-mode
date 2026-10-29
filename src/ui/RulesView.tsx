import type { RcAdvice } from '../game/rcAdvisor';
import { useEffect, useState } from 'react';
import { CodexHints } from './CodexHint';
import { diffRows, type RowChange, type RuleRow, type SubsystemExplain } from '../game/classifyExplain';
import type { ViewModel } from '../game/view';
import type { RulePath } from '../game/wlmEdit';
import type { Qualifier, SubsystemType } from '../sim/wlm/types';
import type { GameHandle } from './useGame';

const QUALIFIERS: { q: Qualifier; label: string }[] = [
  { q: 'TN', label: 'TN transaction / job name' },
  { q: 'UI', label: 'UI userid' },
  { q: 'TC', label: 'TC job / transaction class' },
  { q: 'PK', label: 'PK Db2 package' },
  { q: 'CI', label: 'CI correlation id' },
  { q: 'SY', label: 'SY system name' },
];

/** Classification rules per subsystem, in evaluation order, with what each rule catches (Change Desk, WLM section). */
export function RulesView({ v, game, onClose }: { v: ViewModel; game: GameHandle; onClose: () => void }) {
  useEffect(() => {
    document.getElementById('classification-rules')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const r = game.rules;
  const shown = r ? (r.pending ?? r.active) : null;
  return (
    <div className="panel rules" style={{ gridColumn: '1 / -1' }} id="classification-rules">
      <div className="row">
        <h3 style={{ margin: 0 }}>
          Classification rules: {game.pending ? <span className="tag warn">pending {game.pending.policyName} (not active)</span> : `active ${v.policyName}`}
          <CodexHints ids={['classification', 'system-classes']} />
        </h3>
        <button onClick={onClose} aria-label="Close classification rules">
          Close ✕
        </button>
      </div>
      <p className="muted" style={{ margin: '6px 0 8px' }}>
        Work is classified by subsystem type. Rules are checked top to bottom and the first match wins; an indented rule refines the
        rule above it. Work that matches nothing gets the subsystem default. Edits go to the pending policy; install it from the banner
        at the top.
      </p>
      {!r || !shown ? (
        <div className="muted">Loading classification rules…</div>
      ) : (
        <>
          {shown.sysother.length > 0 && (
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <span className="tag bad">Unclassified → SYSOTHER (discretionary)</span>
              <span>{shown.sysother.join(', ')}</span>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <span className="tag">Always SYSTEM (z/OS forces these)</span>
            <span className="muted" style={{ fontSize: 12 }}>{shown.forcedSystem.join(', ')}</span>
          </div>
          {r.advice && <RcAdvisor advice={r.advice} game={game} />}
          <div className="rules-grid">
            {shown.subsystems.map((ss) => (
              <Subsystem
                key={ss.subsystem}
                ss={ss}
                active={r.pending ? r.active.subsystems.find((x) => x.subsystem === ss.subsystem) : undefined}
                classIds={r.classIds}
                game={game}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const MARK: Record<RowChange, { label: string; cls: string } | null> = {
  added: { label: 'new', cls: 'good' },
  changed: { label: 'changed', cls: 'warn' },
  same: null,
};

function Subsystem({ ss, active, classIds, game }: { ss: SubsystemExplain; active: SubsystemExplain | undefined; classIds: string[]; game: GameHandle }) {
  const diff = active ? diffRows(active.rows, ss.rows) : null;
  const edit = (e: Parameters<GameHandle['send']>[0]) => game.send(e);
  const sub = ss.subsystem;
  return (
    <div className="subsys">
      <h4>Subsystem {sub}</h4>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Rule</th>
              <th>Service class</th>
              <th>Report class</th>
              <th>Catches now</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ss.rows.map((row, i) => {
              const mark = diff ? MARK[diff.changes[i]!] : null;
              return (
                <tr key={row.path.join('.')}>
                  <td className="num muted">{row.path.map((p) => p + 1).join('.')}</td>
                  <td style={{ paddingLeft: 6 + row.depth * 18, whiteSpace: 'nowrap' }}>
                    {row.depth > 0 && <span className="muted">└ </span>}
                    <span className="num">
                      {row.qualifier}={row.pattern}
                    </span>
                    {mark && <span className={`tag ${mark.cls}`}> {mark.label}</span>}
                  </td>
                  <td>
                    <select
                      aria-label={`Service class for rule ${row.qualifier}=${row.pattern}`}
                      value={row.serviceClass ?? ''}
                      onChange={(e) => edit({ type: 'WLM_EDIT', edit: { op: 'SET_RULE_TARGET', subsystem: sub, path: row.path, serviceClass: e.target.value || null } })}
                    >
                      {row.depth > 0 && <option value="">(inherit)</option>}
                      {classIds.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    {row.catches.length > 0 && row.effectiveClass !== row.serviceClass && <span className="muted"> → {row.effectiveClass}</span>}
                  </td>
                  <td>
                    <ReportClassInput
                      key={`${row.path.join('.')}:${row.reportClass ?? ''}`}
                      current={row.reportClass}
                      label={`Report class for rule ${row.qualifier}=${row.pattern}`}
                      onSet={(rc) => edit({ type: 'WLM_EDIT', edit: { op: 'SET_RULE_TARGET', subsystem: sub, path: row.path, serviceClass: row.serviceClass, reportClass: rc } })}
                    />
                  </td>
                  <td style={{ fontSize: 12, minWidth: 160 }}>{row.catches.length ? row.catches.join(', ') : <span className="muted">nothing today</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <RowActions sub={sub} row={row} edit={edit} />
                  </td>
                </tr>
              );
            })}
            {diff?.removed.map((row) => (
              <tr key={`removed-${row.path.join('.')}`} style={{ textDecoration: 'line-through' }} className="muted">
                <td className="num">–</td>
                <td style={{ paddingLeft: 6 + row.depth * 18 }}>
                  {row.qualifier}={row.pattern} <span className="tag bad">removed</span>
                </td>
                <td>{row.serviceClass}</td>
                <td>{row.reportClass ?? '-'}</td>
                <td style={{ fontSize: 12 }}>{row.catches.join(', ')}</td>
                <td />
              </tr>
            ))}
            <tr>
              <td className="num muted">∗</td>
              <td className="muted">default (no rule matched)</td>
              <td>
                <select
                  aria-label={`Default service class for ${sub}`}
                  value={ss.builtInDefault ? '' : ss.defaultServiceClass}
                  onChange={(e) => edit({ type: 'WLM_EDIT', edit: { op: 'SET_DEFAULT', subsystem: sub, serviceClass: e.target.value || null } })}
                >
                  <option value="">{sub === 'STC' ? 'SYSSTC' : 'SYSOTHER'} (built-in)</option>
                  {classIds.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td />
              <td style={{ fontSize: 12 }}>{ss.defaultCatches.length ? ss.defaultCatches.join(', ') : <span className="muted">nothing today</span>}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <AddRule sub={sub} count={ss.rows.filter((r) => r.depth === 0).length} classIds={classIds} edit={edit} />
    </div>
  );
}

/** Report class: type a name and press Enter (or leave the field); blank clears it. */
function ReportClassInput({ current, label, onSet }: { current: string | null; label: string; onSet: (rc: string | null) => void }) {
  const [val, setVal] = useState(current ?? '');
  const commit = () => {
    const rc = val.trim().toUpperCase() || null;
    if (rc !== current) onSet(rc);
  };
  return (
    <input
      aria-label={label}
      placeholder="none"
      size={8}
      value={val}
      onChange={(e) => setVal(e.target.value.toUpperCase())}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

function RowActions({ sub, row, edit }: { sub: SubsystemType; row: RuleRow; edit: (e: Parameters<GameHandle['send']>[0]) => void }) {
  const move = (delta: -1 | 1) => edit({ type: 'WLM_EDIT', edit: { op: 'MOVE_RULE', subsystem: sub, path: row.path, delta } });
  return (
    <>
      <button title="Move up (evaluated earlier)" aria-label="Move rule up" onClick={() => move(-1)}>
        ↑
      </button>{' '}
      <button title="Move down (evaluated later)" aria-label="Move rule down" onClick={() => move(1)}>
        ↓
      </button>{' '}
      <button title="Delete rule" aria-label="Delete rule" onClick={() => edit({ type: 'WLM_EDIT', edit: { op: 'DELETE_RULE', subsystem: sub, path: row.path } })}>
        ✕
      </button>
    </>
  );
}

function AddRule({ sub, count, classIds, edit }: { sub: SubsystemType; count: number; classIds: string[]; edit: (e: Parameters<GameHandle['send']>[0]) => void }) {
  const [q, setQ] = useState<Qualifier>(sub === 'DDF' || sub === 'TSO' || sub === 'OMVS' ? 'UI' : 'TN');
  const [pattern, setPattern] = useState('');
  const [cls, setCls] = useState(classIds[3] ?? 'SYSSTC');
  const [pos, setPos] = useState('1');
  const [parent, setParent] = useState('');
  const [rc, setRc] = useState('');
  const submit = () => {
    const at: RulePath = parent.trim()
      ? [...parent.split('.').map((x) => Number(x) - 1), Math.max(0, Number(pos) - 1)]
      : [Math.max(0, Math.min(count, Number(pos) - 1))];
    edit({ type: 'WLM_EDIT', edit: { op: 'ADD_RULE', subsystem: sub, qualifier: q, pattern, serviceClass: cls, reportClass: rc.trim() || null, at } });
    setPattern('');
    setRc('');
  };
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="muted">Add rule</span>
      <select aria-label="Qualifier type" value={q} onChange={(e) => setQ(e.target.value as Qualifier)}>
        {QUALIFIERS.map((x) => (
          <option key={x.q} value={x.q}>
            {x.label}
          </option>
        ))}
      </select>
      <input aria-label="Pattern" placeholder="pattern, e.g. DB1* or AUTH%" value={pattern} onChange={(e) => setPattern(e.target.value)} size={14} />
      →
      <select aria-label="Service class" value={cls} onChange={(e) => setCls(e.target.value)}>
        {classIds.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      report class
      <input aria-label="Report class (optional)" placeholder="none" value={rc} onChange={(e) => setRc(e.target.value.toUpperCase())} size={8} />
      at position
      <input aria-label="Position" value={pos} onChange={(e) => setPos(e.target.value)} size={2} />
      under rule
      <input aria-label="Parent rule number (blank for top level)" placeholder="top" value={parent} onChange={(e) => setParent(e.target.value)} size={4} />
      <button type="submit" disabled={!pattern.trim()}>
        Add
      </button>
    </form>
  );
}

/** Report class advisor tool: one report class per business workload so WLMGL can tell them apart. */
function RcAdvisor({ advice, game }: { advice: RcAdvice[]; game: GameHandle }) {
  return (
    <details className="rc-advisor" open={advice.length > 0}>
      <summary>
        Report class advisor{' '}
        {advice.length > 0 ? <span className="tag warn">{advice.length} suggestion{advice.length > 1 ? 's' : ''}</span> : <span className="tag good">every business workload has its own row</span>}
        <CodexHints ids={['report-classes']} />
      </summary>
      {advice.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
            Report classes only change reporting (WLMGL and Monitor III rows); WLM still manages the service class. Suggestions go to the pending policy.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Workload</th>
                  <th>service class</th>
                  <th>shares it with</th>
                  <th>report class</th>
                  <th>change</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {advice.map((a) => (
                  <tr key={a.workloadId}>
                    <td>{a.workloadId}</td>
                    <td>{a.serviceClass}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {a.sharedWith.slice(0, 4).join(', ')}
                      {a.sharedWith.length > 4 ? ` +${a.sharedWith.length - 4}` : ''}
                    </td>
                    <td>
                      {a.currentReportClass ?? '-'} → <b>{a.suggested}</b>
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {a.how}
                    </td>
                    <td>
                      <button onClick={() => game.send({ type: 'RC_ADVICE_APPLY', workloadId: a.workloadId })}>Stage</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => game.send({ type: 'RC_ADVICE_APPLY', workloadId: null })}>Stage all</button>
        </>
      )}
    </details>
  );
}
