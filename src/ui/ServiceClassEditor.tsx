import { useState } from 'react';
import type { ViewModel } from '../game/view';
import { goalText } from '../sim/wlm/goals';
import type { Goal, Importance, PeriodDef, ResourceGroupDef, ServiceClassDef } from '../sim/wlm/types';
import type { CicsGoalIssue } from '../game/wlmEdit';
import { CodexHints } from './CodexHint';
import { Empty } from './Empty';
import type { GameHandle } from './useGame';

const IMPS: Importance[] = [1, 2, 3, 4, 5];
const RG_TYPES: { type: 1 | 2 | 3; label: string; unit: string }[] = [
  { type: 3, label: 'type 3: CPs × 100', unit: 'CPs×100' },
  { type: 2, label: 'type 2: % of LPAR share', unit: '% share' },
  { type: 1, label: 'type 1: SU/s, sysplex', unit: 'SU/s' },
];
const rgUnit = (t: 1 | 2 | 3) => RG_TYPES.find((x) => x.type === t)!.unit;
const NEW_RG = '__new__';

type Edit = Parameters<GameHandle['send']>[0];

/** Service classes as a table you edit in place, plus their resource groups. */
export function ServiceClasses({ v, game }: { v: ViewModel; game: GameHandle }) {
  const defs = game.pending?.classDefs ?? v.classDefs;
  const groups = game.pending?.resourceGroups ?? v.resourceGroups;
  const cicsClasses = game.pending?.cicsClasses ?? v.cicsClasses;
  const cicsIssues = game.pending?.cicsIssues ?? v.cicsIssues;
  const [sel, setSel] = useState<string | null>(null);
  const selected = defs.find((c) => c.id === sel) ?? null;
  const send = (e: Edit) => game.send(e);
  const activeJson = (id: string) => JSON.stringify(v.classDefs.find((c) => c.id === id) ?? null);
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table className="sc-table">
          <thead>
            <tr>
              <th>Service class</th>
              <th>Periods (goal · importance · duration)</th>
              <th>Flags</th>
              <th>Resource group</th>
            </tr>
          </thead>
          <tbody>
            {defs.map((c) => {
              const changed = game.pending !== null && activeJson(c.id) !== JSON.stringify(c);
              return (
                <tr key={c.id} className={c.id === sel ? 'selected' : undefined} onClick={() => setSel(c.id === sel ? null : c.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <b>{c.id}</b>
                    {changed && <span className="tag warn"> edited</span>}
                    {cicsClasses.includes(c.id) && (
                      <span className={`tag${cicsIssues.some((i) => i.classId === c.id) ? ' bad' : ''}`} title="CICS transactions are classified into this class">
                        {' '}
                        CICS txn
                      </span>
                    )}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {c.description}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {c.periods.map((p, i) => (
                      <div key={i}>
                        <span className="muted">P{i + 1}</span> {goalText(p)}
                        {p.durationSu != null && <span className="muted"> · for {p.durationSu.toLocaleString()} SU</span>}
                      </div>
                    ))}
                  </td>
                  <td style={{ fontSize: 12 }}>{[c.cpuCritical && 'CPU critical', c.storageCritical && 'storage critical'].filter(Boolean).join(', ') || <span className="muted">-</span>}</td>
                  <td style={{ fontSize: 12 }}>{c.resourceGroup ?? <span className="muted">-</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
        {selected ? 'Edits go to the pending policy.' : 'Click a class to edit its periods, flags and resource group.'}
      </div>
      <CicsIssues issues={cicsIssues} />
      {selected && <ClassEditor key={`${selected.id}:${JSON.stringify(selected)}`} c={selected} groups={groups} cics={cicsClasses.includes(selected.id)} send={send} />}
      <NewClass taken={defs.map((c) => c.id)} send={send} />
      <ResourceGroups groups={groups} defs={defs} send={send} />
    </>
  );
}

function GoalFields({ kind, setKind, val, setVal, pct, setPct, imp, setImp, allowDisc }: { kind: Goal['kind']; setKind: (k: Goal['kind']) => void; val: string; setVal: (s: string) => void; pct: string; setPct: (s: string) => void; imp: Importance; setImp: (i: Importance) => void; allowDisc: boolean }) {
  return (
    <>
      <select aria-label="Goal type" value={kind} onChange={(e) => setKind(e.target.value as Goal['kind'])}>
        <option value="VEL">velocity</option>
        <option value="PCT">percentile RT</option>
        <option value="AVG">average RT</option>
        {allowDisc && <option value="DISC">discretionary</option>}
      </select>
      {kind === 'PCT' && (
        <label>
          <input aria-label="Percentile" value={pct} onChange={(e) => setPct(e.target.value)} size={3} inputMode="numeric" />% within
        </label>
      )}
      {kind !== 'DISC' && (
        <label>
          <input aria-label={kind === 'VEL' ? 'Velocity' : 'Response time (s)'} value={val} onChange={(e) => setVal(e.target.value)} size={5} inputMode="decimal" /> {kind === 'VEL' ? '% velocity' : 's'}
        </label>
      )}
      {kind !== 'DISC' && (
        <label>
          imp{' '}
          <select aria-label="Importance" value={imp} onChange={(e) => setImp(Number(e.target.value) as Importance)}>
            {IMPS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function goalOf(kind: Goal['kind'], val: string, pct: string): Goal {
  return kind === 'VEL' ? { kind, velocity: Number(val) } : kind === 'AVG' ? { kind, rtSec: Number(val) } : kind === 'PCT' ? { kind, rtSec: Number(val), pct: Number(pct) } : { kind: 'DISC' };
}

function goalError(kind: Goal['kind'], val: number, pct: number): string | null {
  if (kind === 'DISC') return null;
  if (kind === 'VEL') return val >= 1 && val <= 99 ? null : 'Velocity is 1–99';
  if (!(val > 0)) return 'Response time must be > 0 s';
  if (kind === 'PCT' && !(pct >= 1 && pct <= 99)) return 'Percentile is 1–99';
  return null;
}

function useGoalState(p?: PeriodDef) {
  const g = p?.goal;
  const [kind, setKind] = useState<Goal['kind']>(g?.kind ?? 'VEL');
  const [val, setVal] = useState(g?.kind === 'VEL' ? String(g.velocity) : g && 'rtSec' in g ? String(g.rtSec) : '30');
  const [pct, setPct] = useState(g?.kind === 'PCT' ? String(g.pct) : '90');
  const [imp, setImp] = useState<Importance>(p?.importance ?? 4);
  return { kind, setKind, val, setVal, pct, setPct, imp, setImp, err: goalError(kind, Number(val), Number(pct)), goal: () => goalOf(kind, val, pct) };
}

function PeriodRow({ c, i, send }: { c: ServiceClassDef; i: number; send: (e: Edit) => void }) {
  const p = c.periods[i]!;
  const last = i === c.periods.length - 1;
  const g = useGoalState(p);
  const [dur, setDur] = useState(p.durationSu == null ? '' : String(p.durationSu));
  const durErr = !last && !(Number(dur) > 0) ? 'Duration (SU) > 0' : null;
  const err = g.err ?? durErr;
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!err) send({ type: 'WLM_EDIT', edit: { op: 'SET_PERIOD', classId: c.id, period: i, goal: g.goal(), importance: g.imp, durationSu: last ? null : Number(dur) } });
      }}
    >
      <b style={{ minWidth: 28 }}>P{i + 1}</b>
      <GoalFields {...g} allowDisc={last} />
      {!last && (
        <label>
          for <input aria-label="Duration (service units)" value={dur} onChange={(e) => setDur(e.target.value)} size={7} inputMode="numeric" /> SU
        </label>
      )}
      <button type="submit" disabled={err !== null}>
        Save P{i + 1}
      </button>
      {err && <span className="err">{err}</span>}
    </form>
  );
}

function CicsIssues({ issues }: { issues: CicsGoalIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div style={{ margin: '4px 0' }}>
      {issues.map((i) => (
        <div key={i.message} className={i.severity === 'error' ? 'err' : 'warn-text'}>
          {i.severity === 'error' ? '✖ ' : '⚠ '}
          {i.message}
        </div>
      ))}
    </div>
  );
}

function ClassEditor({ c, groups, cics, send }: { c: ServiceClassDef; groups: ResourceGroupDef[]; cics: boolean; send: (e: Edit) => void }) {
  const add = useGoalState();
  const last = c.periods[c.periods.length - 1]!;
  const [prevDur, setPrevDur] = useState('2000');
  const canAdd = last.goal.kind !== 'DISC' && c.periods.length < 8;
  const [rg, setRg] = useState(c.resourceGroup ?? '');
  const [rgId, setRgId] = useState(`RG${c.id}`.slice(0, 8));
  const [rgType, setRgType] = useState<1 | 2 | 3>(3);
  const [rgMin, setRgMin] = useState('');
  const [rgMax, setRgMax] = useState('');
  const n = (x: string) => (x.trim() === '' ? null : Number(x));
  const flag = (k: 'cpuCritical' | 'storageCritical', on: boolean) => send({ type: 'WLM_EDIT', edit: { op: 'SET_FLAGS', classId: c.id, [k]: on } });
  const assign = () => {
    if (rg === '') send({ type: 'WLM_EDIT', edit: { op: 'SET_RESOURCE_GROUP', classId: c.id, group: null } });
    else if (rg === NEW_RG) send({ type: 'WLM_EDIT', edit: { op: 'SET_RESOURCE_GROUP', classId: c.id, group: { id: rgId.trim().toUpperCase(), type: rgType, min: n(rgMin), max: n(rgMax) } } });
    else send({ type: 'WLM_EDIT', edit: { op: 'SET_RESOURCE_GROUP', classId: c.id, group: groups.find((x) => x.id === rg)! } });
  };
  return (
    <div className="sc-editor">
      <div className="row">
        <b>
          {c.id} <span className="muted">{c.description}</span>
        </b>
        <button type="button" onClick={() => send({ type: 'WLM_EDIT', edit: { op: 'DELETE_CLASS', classId: c.id } })} title="Only if no classification rule uses it">
          Delete class
        </button>
      </div>
      <h4>
        Periods
        {cics && <CodexHints ids={['cics-transaction-goals']} />}
      </h4>
      {cics && <div className="muted" style={{ fontSize: 12 }}>CICS transactions are classified here: use one period with a response-time goal and no resource group.</div>}
      {c.periods.map((_, i) => (
        <PeriodRow key={i} c={c} i={i} send={send} />
      ))}
      <div className="form">
        {canAdd && (
          <>
            <span className="muted">Add P{c.periods.length + 1} after P{c.periods.length} uses</span>
            <input aria-label="Previous period duration (SU)" value={prevDur} onChange={(e) => setPrevDur(e.target.value)} size={7} inputMode="numeric" />
            <span className="muted">SU:</span>
            <GoalFields {...add} allowDisc />
            <button
              type="button"
              disabled={add.err !== null || !(Number(prevDur) > 0)}
              onClick={() => send({ type: 'WLM_EDIT', edit: { op: 'ADD_PERIOD', classId: c.id, goal: add.goal(), importance: add.imp, previousDurationSu: Number(prevDur) } })}
            >
              Add period
            </button>
          </>
        )}
        {c.periods.length > 1 && (
          <button type="button" onClick={() => send({ type: 'WLM_EDIT', edit: { op: 'REMOVE_PERIOD', classId: c.id } })}>
            Remove P{c.periods.length}
          </button>
        )}
      </div>
      <h4>Attributes</h4>
      <div className="form">
        <label>
          <input type="checkbox" checked={c.cpuCritical} onChange={(e) => flag('cpuCritical', e.target.checked)} /> CPU critical
        </label>
        <label>
          <input type="checkbox" checked={c.storageCritical} onChange={(e) => flag('storageCritical', e.target.checked)} /> Storage critical
        </label>
        <span className="muted" style={{ fontSize: 12 }}>
          CPU critical keeps lower-importance work below this class&apos;s priority; storage critical exempts it from paging.
        </span>
      </div>
      <h4>
        Resource group
        <CodexHints ids={['resource-groups']} />
      </h4>
      <div className="form">
        <select aria-label="Resource group" value={rg} onChange={(e) => setRg(e.target.value)}>
          <option value="">(none)</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.id} ({rgUnit(g.type)} min {g.min ?? '-'} max {g.max ?? '-'})
            </option>
          ))}
          <option value={NEW_RG}>new group…</option>
        </select>
        {rg === NEW_RG && (
          <>
            <input aria-label="New resource group name" value={rgId} onChange={(e) => setRgId(e.target.value.toUpperCase())} size={8} />
            <select aria-label="Resource group type" value={rgType} onChange={(e) => setRgType(Number(e.target.value) as 1 | 2 | 3)}>
              {RG_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
            <label>
              min <input aria-label="Resource group minimum" value={rgMin} onChange={(e) => setRgMin(e.target.value)} size={6} placeholder="none" />
            </label>
            <label>
              max <input aria-label="Resource group maximum" value={rgMax} onChange={(e) => setRgMax(e.target.value)} size={6} placeholder="none" />
            </label>
          </>
        )}
        <button type="button" disabled={rg === (c.resourceGroup ?? '')} onClick={assign}>
          {rg === '' ? `Take ${c.id} out of ${c.resourceGroup ?? 'its group'}` : `Put ${c.id} in ${rg === NEW_RG ? rgId || 'the new group' : rg}`}
        </button>
      </div>
    </div>
  );
}

function NewClass({ taken, send }: { taken: string[]; send: (e: Edit) => void }) {
  const [id, setId] = useState('');
  const [desc, setDesc] = useState('');
  const g = useGoalState();
  const idErr = !/^[A-Z][A-Z0-9]{0,7}$/.test(id) ? '1–8 characters A–Z/0–9, starting with a letter' : taken.includes(id) || ['SYSTEM', 'SYSSTC', 'SYSOTHER'].includes(id) ? 'Class exists' : null;
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!idErr && !g.err) {
          send({ type: 'WLM_EDIT', edit: { op: 'ADD_CLASS', classId: id, description: desc || id, goal: g.goal(), importance: g.imp, cpuCritical: false } });
          setId('');
          setDesc('');
        }
      }}
    >
      <b>New class</b>
      <input aria-label="New class name" value={id} onChange={(e) => setId(e.target.value.toUpperCase())} size={8} placeholder="NAME" />
      <input aria-label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} size={18} placeholder="description" />
      <GoalFields {...g} allowDisc />
      <button type="submit" disabled={idErr !== null || g.err !== null}>
        Add class
      </button>
      {id && (idErr ?? g.err) && <span className="err">{idErr ?? g.err}</span>}
    </form>
  );
}

function ResourceGroups({ groups, defs, send }: { groups: ResourceGroupDef[]; defs: ServiceClassDef[]; send: (e: Edit) => void }) {
  if (groups.length === 0) return <Empty>No resource groups. Create one from a class&apos;s editor (Resource group › new group…).</Empty>;
  return (
    <>
      <h4>Resource groups</h4>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Type</th>
              <th>Min</th>
              <th>Max</th>
              <th>Classes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RgRow key={`${g.id}:${g.type}:${g.min}:${g.max}`} g={g} members={defs.filter((c) => c.resourceGroup === g.id).map((c) => c.id)} send={send} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>Max is always enforced (CAP delay). Min is guaranteed only while the group misses its goals, even ahead of more important work.</div>
    </>
  );
}

function RgRow({ g, members, send }: { g: ResourceGroupDef; members: string[]; send: (e: Edit) => void }) {
  const [type, setType] = useState(g.type);
  const [min, setMin] = useState(g.min === null ? '' : String(g.min));
  const [max, setMax] = useState(g.max === null ? '' : String(g.max));
  const n = (x: string) => (x.trim() === '' ? null : Number(x));
  const dirty = type !== g.type || n(min) !== g.min || n(max) !== g.max;
  return (
    <tr>
      <td>
        <b>{g.id}</b>
      </td>
      <td>
        <select aria-label={`${g.id} type`} value={type} onChange={(e) => setType(Number(e.target.value) as 1 | 2 | 3)}>
          {RG_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input aria-label={`${g.id} minimum`} value={min} onChange={(e) => setMin(e.target.value)} size={6} placeholder="none" /> <span className="muted">{rgUnit(type)}</span>
      </td>
      <td>
        <input aria-label={`${g.id} maximum`} value={max} onChange={(e) => setMax(e.target.value)} size={6} placeholder="none" /> <span className="muted">{rgUnit(type)}</span>
      </td>
      <td style={{ fontSize: 12 }}>{members.join(', ')}</td>
      <td>
        <button
          type="button"
          disabled={!dirty || members.length === 0}
          onClick={() => send({ type: 'WLM_EDIT', edit: { op: 'SET_RESOURCE_GROUP', classId: members[0]!, group: { id: g.id, type, min: n(min), max: n(max) } } })}
        >
          Save
        </button>
      </td>
    </tr>
  );
}
