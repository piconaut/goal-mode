import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { HARDWARE } from '../content/hardware-catalog';
import { FIXES, previewChange, type ChangePreview } from '../game/catalog';
import { addToBasket, basketLabel, describeCommand, nextAorName, validateDefinedCapacity, validateLogical, validateMemory, validateRouting, validateWeight } from '../game/changeDesk';
import type { PlannedChange } from '../game/types';
import type { ConfigView, ViewModel } from '../game/view';
import type { Command } from '../sim/core/commands';
import { entitlements, polarity } from '../sim/hw/prsm';
import type { Goal, Importance, Qualifier, SubsystemType, WorkAttributes } from '../sim/wlm/types';
import { RulesView } from './RulesView';
import type { GameHandle } from './useGame';

/** Everything a control needs to preview, stage or apply a change. */
interface Desk {
  v: ViewModel;
  cfg: ConfigView;
  apply: (label: string, commands: Command[]) => void;
  stage: (commands: Command[]) => void;
}

// Only the command kind matters for the hours estimate.
const ACTIVATE_PREVIEW = [{ kind: 'ACTIVATE_POLICY' } as Command];

export function Actions({ v, game }: { v: ViewModel; game: GameHandle }) {
  const [basket, setBasket] = useState<Command[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const desk: Desk = {
    v,
    cfg: v.config,
    apply: (label, commands) => game.send({ type: 'CHANGE', req: { label, commands } }),
    stage: (commands) => setBasket((b) => addToBasket(b, commands)),
  };
  return (
    <>
      {game.pending && <PendingBanner v={v} game={game} />}
      <div className="grid">
        <Board v={v} game={game} />
        <Basket desk={desk} basket={basket} setBasket={setBasket} />
        <Results game={game} />
        <Section title="HMC: LPAR image profile">
          <Prsm desk={desk} />
        </Section>
        <Section title={`WLM policy: active ${v.policyName}`}>
          <Wlm v={v} game={game} rulesOpen={rulesOpen} toggleRules={() => setRulesOpen(!rulesOpen)} />
        </Section>
        {rulesOpen && <RulesView v={v} game={game} onClose={() => setRulesOpen(false)} />}
        <Section title="z/OS and coupling facilities">
          <Systems desk={desk} />
        </Section>
        <Section title="Db2 and CICS">
          <Subsystems desk={desk} />
        </Section>
        <Section title="Routing and batch initiators">
          <Routing desk={desk} />
          <JobClasses desk={desk} />
        </Section>
        <Section title={`Hardware orders (capex $${Math.round(v.capexRemaining / 1000)}k left)`}>
          <Hardware v={v} game={game} />
        </Section>
        <Section title="Operations">
          <Ops desk={desk} game={game} />
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="panel section" open>
      <summary>
        <h3>{title}</h3>
      </summary>
      {children}
    </details>
  );
}

const costText = (p: ChangePreview): string => {
  const parts = [`${p.hours}h`];
  if (p.capex) parts.push(`$${Math.round(p.capex / 1000)}k`);
  if (p.emergency) parts.push(`EMERG −${p.trustCostEach} trust each`);
  if (p.failRisk > 0) parts.push(`${(p.failRisk * 100).toFixed(0)}% fail risk`);
  return parts.join(' · ');
};

const preview = (v: ViewModel, req: Parameters<typeof previewChange>[1]) => previewChange(v.previewCtx, req);

/** Apply / add-to-basket buttons with the cost on the button and the reason when it can't be done. */
function ChangeButtons({ desk, label, commands, error }: { desk: Desk; label: string; commands: Command[]; error: string | null }) {
  const p = preview(desk.v, { commands });
  const reason = error ?? p.reason;
  return (
    <>
      <button type="submit" disabled={error !== null} title="Enter adds to the basket">
        + basket
      </button>
      <button type="button" className="apply" disabled={reason !== null} title={reason ?? (p.emergency ? 'Emergency change: applied within seconds' : 'Planned: takes effect at 06:00')} onClick={() => desk.apply(label, commands)}>
        Apply · {costText(p)}
      </button>
      {reason && <span className="err">{reason}</span>}
    </>
  );
}

/** A form row: Enter stages the change in the basket. */
function ChangeForm({ desk, label, commands, error, children }: { desk: Desk; label: string; commands: Command[]; error: string | null; children: ReactNode }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (error === null) desk.stage(commands);
  };
  return (
    <form className="form" onSubmit={submit}>
      {children}
      <ChangeButtons desk={desk} label={label} commands={commands} error={error} />
    </form>
  );
}

const Now = ({ children }: { children: ReactNode }) => <span className="now">now {children}</span>;

function PendingBanner({ v, game }: { v: ViewModel; game: GameHandle }) {
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

function Board({ v, game }: { v: ViewModel; game: GameHandle }) {
  const live = v.phase === 'LIVE';
  const planned = v.changes.filter((c) => c.status === 'PLANNED');
  const done = v.changes.filter((c) => c.status !== 'PLANNED');
  const days = [...new Set(planned.map((c) => c.activateDay))].sort((a, b) => a - b);
  const codActive = done.filter((c) => c.status === 'APPLIED' && c.revertDay !== null && c.revertDay > v.day);
  return (
    <div className="panel" style={{ gridColumn: '1 / -1' }}>
      <h3>Change board</h3>
      <div className="muted">
        {live
          ? 'Live day: changes are EMERGENCY changes, applied within seconds, at a trust cost.'
          : v.phase === 'BRIEFING'
            ? 'Briefing: changes are planned and take effect at 06:00 when the day starts.'
            : 'Changes can be made during the briefing or the live day.'}{' '}
        {v.constraints.includes('FREEZE') && <span className="tag bad">CHANGE FREEZE</span>} Hours left: {v.hoursLeft.toFixed(1)} · fatigue {v.fatigue.toFixed(0)}
      </div>
      {days.length === 0 && <div className="muted" style={{ marginTop: 8 }}>Nothing planned.</div>}
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
      <td>
        {c.label}
        {c.capex > 0 && c.status === 'PLANNED' && <span className="tag"> on order · arrives day {c.activateDay + 1}</span>}
      </td>
      <td className="muted">day {c.activateDay + 1}</td>
      <td className="muted num">{c.hours}h</td>
      <td>
        <span className={`tag ${c.status === 'APPLIED' ? 'good' : c.status === 'FAILED' ? 'bad' : 'warn'}`}>{c.status}</span>
        {c.emergency && <span className="tag bad"> EMERG</span>}
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

function Basket({ desk, basket, setBasket }: { desk: Desk; basket: Command[]; setBasket: (b: Command[]) => void }) {
  const p = preview(desk.v, { commands: basket });
  return (
    <div className="panel">
      <h3>Change basket ({basket.length})</h3>
      {basket.length === 0 ? (
        <div className="muted">Stage several edits (press Enter in any field, or “+ basket”) and submit them as one change: one approval, one failure roll.</div>
      ) : (
        <>
          <ul className="diff">
            {basket.map((c, i) => (
              <li key={i}>
                <span>{describeCommand(c, desk.cfg)}</span>
                <button aria-label="Remove from basket" onClick={() => setBasket(basket.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="form">
            <button
              className="primary"
              disabled={!p.ok}
              title={p.reason ?? undefined}
              onClick={() => {
                desk.apply(basketLabel(basket, desk.cfg), basket);
                setBasket([]);
              }}
            >
              Submit as one change · {costText(p)}
            </button>
            <button onClick={() => setBasket([])}>Clear</button>
            {p.reason && <span className="err">{p.reason}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Results({ game }: { game: GameHandle }) {
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

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

function Prsm({ desk }: { desk: Desk }) {
  const zos = desk.cfg.lpars.filter((l) => l.kind === 'ZOS');
  const [lpar, setLpar] = useState(zos[0]?.id ?? '');
  return (
    <>
      <div className="form">
        <label>
          LPAR{' '}
          <select value={lpar} onChange={(e) => setLpar(e.target.value)}>
            {zos.map((x) => (
              <option key={x.id}>{x.id}</option>
            ))}
          </select>
        </label>
        <span className="muted">{desk.v.lpars.find((x) => x.id === lpar)?.polarity}</span>
      </div>
      <LparProfile key={`${lpar}:${JSON.stringify(desk.cfg.lpars.find((x) => x.id === lpar))}`} desk={desk} lparId={lpar} />
      <div className="help">
        Weight shares the shared pool under contention; HiperDispatch polarity follows entitlement. Logical CPs beyond online + reserved need an IPL. Defined capacity soft-caps the
        LPAR when its R4HA exceeds the limit.
      </div>
    </>
  );
}

function LparProfile({ desk, lparId }: { desk: Desk; lparId: string }) {
  const l = desk.cfg.lpars.find((x) => x.id === lparId);
  const [weight, setWeight] = useState(String(l?.weight ?? 100));
  const [lcp, setLcp] = useState(String(l?.cpLogical ?? 1));
  const [ziip, setZiip] = useState(String(l?.ziipLogical ?? 0));
  const [dc, setDc] = useState(l?.definedCapacity === null || !l ? '' : String(l.definedCapacity));
  const [mem, setMem] = useState(String(l?.memoryGb ?? 0));
  if (!l) return null;
  const dcVal = dc.trim() === '' ? null : num(dc);
  return (
    <>
      <PolarityPreview v={desk.v} lpar={lparId} weight={num(weight) || 0} logical={num(lcp) || 0} />
      <ChangeForm desk={desk} label={`${lparId} CP weight ${weight}`} commands={[{ kind: 'SET_WEIGHT', lparId, pool: 'CP', weight: num(weight) }]} error={validateWeight(num(weight))}>
        <label>
          CP weight <input value={weight} onChange={(e) => setWeight(e.target.value)} size={4} inputMode="numeric" />
        </label>
        <Now>{l.weight}</Now>
      </ChangeForm>
      <ChangeForm desk={desk} label={`${lparId} logical CPs ${lcp}`} commands={[{ kind: 'SET_LOGICAL', lparId, pool: 'CP', logical: num(lcp) }]} error={validateLogical(desk.cfg, lparId, 'CP', num(lcp))}>
        <label>
          Logical CPs <input value={lcp} onChange={(e) => setLcp(e.target.value)} size={3} inputMode="numeric" />
        </label>
        <Now>
          {l.cpLogical} online + {l.cpReserved} reserved
        </Now>
      </ChangeForm>
      <ChangeForm desk={desk} label={`${lparId} logical zIIPs ${ziip}`} commands={[{ kind: 'SET_LOGICAL', lparId, pool: 'ZIIP', logical: num(ziip) }]} error={validateLogical(desk.cfg, lparId, 'ZIIP', num(ziip))}>
        <label>
          Logical zIIPs <input value={ziip} onChange={(e) => setZiip(e.target.value)} size={3} inputMode="numeric" />
        </label>
        <Now>
          {l.ziipLogical} online + {l.ziipReserved} reserved
        </Now>
      </ChangeForm>
      <ChangeForm
        desk={desk}
        label={`${lparId} defined capacity ${dcVal ?? 'none'}`}
        commands={[{ kind: 'SET_DEFINED_CAPACITY', lparId, msu: dcVal }]}
        error={validateDefinedCapacity(dcVal)}
      >
        <label>
          Defined capacity (MSU, blank = none) <input value={dc} onChange={(e) => setDc(e.target.value)} size={5} inputMode="numeric" />
        </label>
        <Now>{l.definedCapacity ?? 'none'}</Now>
      </ChangeForm>
      <ChangeForm desk={desk} label={`${lparId} memory ${mem} GB`} commands={[{ kind: 'SET_LPAR_MEMORY', lparId, memoryGb: num(mem) }]} error={validateMemory(desk.cfg, lparId, num(mem))}>
        <label>
          Memory (GB) <input value={mem} onChange={(e) => setMem(e.target.value)} size={5} inputMode="numeric" />
        </label>
        <Now>
          {l.memoryGb} GB · {desk.cfg.unassignedMemoryGb} GB unassigned
        </Now>
      </ChangeForm>
    </>
  );
}

/** Live HiperDispatch preview while editing a weight or logical count (SPEC §5.3.3). */
function PolarityPreview({ v, lpar, weight, logical }: { v: ViewModel; lpar: string; weight: number; logical: number }) {
  const shared = v.lpars.filter((l) => l.kind === 'ZOS');
  const claims = shared.map((l) => ({
    weight: l.id === lpar ? weight : l.weight,
    logical: l.id === lpar ? logical : l.logicalCps,
    demandEngines: 0,
    capEngines: Infinity,
  }));
  const ents = entitlements(claims, v.cpcEngines.CP);
  const totalLogical = claims.reduce((a, c) => a + c.logical, 0);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ margin: '6px 0' }}>
        <thead>
          <tr>
            <th>LPAR</th>
            <th className="num">weight</th>
            <th className="num">entitled CPs</th>
            <th>polarity (preview)</th>
          </tr>
        </thead>
        <tbody>
          {shared.map((l, i) => {
            const p = polarity(ents[i] ?? 0, claims[i]!.logical);
            const changed = l.id === lpar;
            return (
              <tr key={l.id} style={changed ? { color: 'var(--accent)' } : undefined}>
                <td>{l.id}</td>
                <td className="num">{claims[i]!.weight}</td>
                <td className="num">{(ents[i] ?? 0).toFixed(2)}</td>
                <td>
                  {p.vh}VH {p.vm}VM {p.vl}VL
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={4} className="muted" style={{ fontSize: 12 }}>
              Logical:physical {totalLogical}:{v.cpcEngines.CP} = {(totalLogical / v.cpcEngines.CP).toFixed(2)}
              {totalLogical / v.cpcEngines.CP > 2 ? ' (above the 2:1 rule of thumb)' : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

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

const IMPS: Importance[] = [1, 2, 3, 4, 5];

function goalError(kind: Goal['kind'], val: number, pct: number): string | null {
  if (kind === 'DISC') return null;
  if (kind === 'VEL') return val >= 1 && val <= 99 ? null : 'Velocity is 1–99';
  if (!(val > 0)) return 'Response time must be > 0 s';
  if (kind === 'PCT' && !(pct >= 1 && pct <= 99)) return 'Percentile is 1–99';
  return null;
}

function Wlm({ v, game, rulesOpen, toggleRules }: { v: ViewModel; game: GameHandle; rulesOpen: boolean; toggleRules: () => void }) {
  const classes = game.pending?.classes ?? v.serviceClasses.map((c) => ({ ...c, cpuCritical: false }));
  const [cls, setCls] = useState(v.serviceClasses[0]?.id ?? '');
  const [period, setPeriod] = useState('1');
  const [kind, setKind] = useState<Goal['kind']>('VEL');
  const [val, setVal] = useState('50');
  const [pct, setPct] = useState('95');
  const [imp, setImp] = useState<Importance>(2);
  const [newId, setNewId] = useState('');
  const [showJson, setShowJson] = useState(false);
  // Local JSON edits; cleared whenever the worker sends a newer pending/active policy.
  const [json, setJson] = useState('');
  useEffect(() => setJson(''), [game.policy]);
  useEffect(() => {
    game.send({ type: 'GET_RULES' });
  }, [game, v.policyName, v.day]);
  const jsonEdited = json !== '' && json !== game.policy;
  const goal = (): Goal => (kind === 'VEL' ? { kind, velocity: Number(val) } : kind === 'AVG' ? { kind, rtSec: Number(val) } : kind === 'PCT' ? { kind, rtSec: Number(val), pct: Number(pct) } : { kind: 'DISC' });
  const gErr = goalError(kind, Number(val), Number(pct));
  const selected = classes.find((c) => c.id === cls);
  const pIdx = Number(period) - 1;
  const periodErr = !selected ? 'Pick a class' : !(Number.isInteger(pIdx) && pIdx >= 0 && pIdx <= selected.periods.length) ? `Period 1–${selected.periods.length + 1}` : null;
  const idErr = !/^[A-Z][A-Z0-9#@$]{0,7}$/.test(newId) ? '1–8 chars, starts with a letter' : classes.some((c) => c.id === newId) ? 'Class exists' : null;
  const p = preview(v, { commands: ACTIVATE_PREVIEW });
  return (
    <>
      {game.pending && <div className="tag warn">editing pending {game.pending.policyName} (not active)</div>}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <tbody>
            {classes.map((c) => {
              const active = v.serviceClasses.find((a) => a.id === c.id);
              const changed = game.pending !== null && (!active || active.periods.join('|') !== c.periods.join('|'));
              return (
                <tr key={c.id} style={changed ? { color: 'var(--warn)' } : undefined}>
                  <td>
                    {c.id}
                    {c.cpuCritical && <span className="muted"> (CPU crit)</span>}
                  </td>
                  <td style={{ fontSize: 12 }} className={changed ? '' : 'muted'}>
                    {c.periods.map((x, i) => `P${i + 1}: ${x}`).join(' · ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!gErr && !periodErr) game.send({ type: 'WLM_EDIT', edit: { op: 'SET_PERIOD', classId: cls, period: pIdx, goal: goal(), importance: imp } });
        }}
      >
        <select aria-label="Service class" value={cls} onChange={(e) => setCls(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id}>{c.id}</option>
          ))}
        </select>
        <label>
          period <input value={period} onChange={(e) => setPeriod(e.target.value)} size={2} inputMode="numeric" />
        </label>
        <select aria-label="Goal type" value={kind} onChange={(e) => setKind(e.target.value as Goal['kind'])}>
          <option value="VEL">velocity</option>
          <option value="PCT">percentile RT</option>
          <option value="AVG">average RT</option>
          <option value="DISC">discretionary</option>
        </select>
        {kind === 'PCT' && (
          <label>
            <input value={pct} onChange={(e) => setPct(e.target.value)} size={3} inputMode="numeric" />% within
          </label>
        )}
        {kind !== 'DISC' && (
          <label>
            <input value={val} onChange={(e) => setVal(e.target.value)} size={5} inputMode="decimal" /> {kind === 'VEL' ? '(velocity %)' : 's'}
          </label>
        )}
        {kind !== 'DISC' && (
          <label>
            importance{' '}
            <select value={imp} onChange={(e) => setImp(Number(e.target.value) as Importance)}>
              {IMPS.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" disabled={gErr !== null || periodErr !== null}>
          Edit period
        </button>
        {(gErr ?? periodErr) && <span className="err">{gErr ?? periodErr}</span>}
        {selected && <Now>{selected.periods[pIdx] ?? 'new period'}</Now>}
      </form>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!idErr && !gErr) game.send({ type: 'WLM_EDIT', edit: { op: 'ADD_CLASS', classId: newId, description: newId, goal: goal(), importance: imp, cpuCritical: false } });
        }}
      >
        <label>
          New class <input value={newId} onChange={(e) => setNewId(e.target.value.toUpperCase())} size={8} />
        </label>
        <button type="submit" disabled={idErr !== null || gErr !== null}>
          Add (uses goal above)
        </button>
        {newId && idErr && <span className="err">{idErr}</span>}
        <button type="button" disabled={!selected || selected.cpuCritical} onClick={() => game.send({ type: 'WLM_EDIT', edit: { op: 'SET_FLAGS', classId: cls, cpuCritical: true } })}>
          CPU critical on {cls}
        </button>
      </form>
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
      <div className="help">Where work goes: rules per subsystem, first match wins. All edits go to a pending policy until you install it.</div>
      <ClassifyBench game={game} />
      <div className="form">
        <button
          onClick={() => {
            game.send({ type: 'GET_POLICY' });
            setShowJson(!showJson);
          }}
        >
          {showJson ? 'Hide' : 'Review'} policy JSON
        </button>
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
      </div>
      {showJson && <textarea aria-label="Policy JSON" rows={14} value={jsonEdited ? json : game.policy} onChange={(e) => setJson(e.target.value)} />}
    </>
  );
}

function Systems({ desk }: { desk: Desk }) {
  const { cfg } = desk;
  return (
    <>
      <div className="form">
        RMF interval
        {[5, 15, 30].map((m) => (
          <ChangeButtonsInline key={m} desk={desk} commands={[{ kind: 'SET_RMF_INTERVAL', minutes: m }]} disabled={m === cfg.rmfIntervalMin} text={`${m} min`} />
        ))}
        <Now>{cfg.rmfIntervalMin} min</Now>
      </div>
      <div className="help">Shorter intervals give finer reports at the cost of SMF volume.</div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>System</th>
              <th>BLWLINTHD</th>
              <th>IIPHONORPRIORITY</th>
            </tr>
          </thead>
          <tbody>
            {cfg.systems.map((s) => (
              <tr key={s.lparId}>
                <td>{s.lparId}</td>
                <td>
                  {s.blwlinthdSec}s{' '}
                  {[5, 20].map((sec) => (
                    <ChangeButtonsInline key={sec} desk={desk} commands={[{ kind: 'SET_IEAOPT', lparId: s.lparId, changes: { blwlinthdSec: sec } }]} disabled={s.blwlinthdSec === sec} text={`${sec}s`} />
                  ))}
                </td>
                <td>
                  {s.iipHonorPriority ? 'YES' : 'NO'}{' '}
                  <ChangeButtonsInline
                    desk={desk}
                    commands={[{ kind: 'SET_IEAOPT', lparId: s.lparId, changes: { iipHonorPriority: !s.iipHonorPriority } }]}
                    disabled={false}
                    text={s.iipHonorPriority ? 'NO' : 'YES'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="help">BLWLINTHD: seconds a starved unit of work waits before blocked-workload promotion. IIPHONORPRIORITY=YES lets zIIP work overflow to CPs.</div>
      {cfg.cfs.map((c) => (
        <CfRow key={`${c.lparId}:${c.thinInterrupts}`} desk={desk} lparId={c.lparId} />
      ))}
      <div className="help">Thin interrupts let a CF on shared engines wake on demand instead of waiting for a dispatch interval.</div>
      <Structures desk={desk} />
    </>
  );
}

/** Compact button pair for one-click choices: click applies, shift-click (or the + button) stages. */
function ChangeButtonsInline({ desk, commands, disabled, text }: { desk: Desk; commands: Command[]; disabled: boolean; text: string }) {
  const p = preview(desk.v, { commands });
  const label = describeCommand(commands[0]!, desk.cfg);
  const title = disabled ? 'Already set' : p.reason ?? `${label}: ${costText(p)} (shift-click adds to basket)`;
  return (
    <button disabled={disabled || !p.ok} title={title} onClick={(e) => (e.shiftKey ? desk.stage(commands) : desk.apply(label, commands))}>
      {text}
    </button>
  );
}

function CfRow({ desk, lparId }: { desk: Desk; lparId: string }) {
  const c = desk.cfg.cfs.find((x) => x.lparId === lparId)!;
  const share = desk.cfg.cfStructures.filter((x) => x.cfLparId === lparId).reduce((a, x) => a + x.requestShare, 0);
  return (
    <div className="form">
      <b>{lparId}</b> thin interrupts {c.thinInterrupts ? 'on' : 'off'}
      <ChangeButtonsInline desk={desk} commands={[{ kind: 'SET_CF', lparId, thinInterrupts: !c.thinInterrupts }]} disabled={false} text={c.thinInterrupts ? 'turn off' : 'turn on'} />
      <Now>{Math.round(share * 100)}% of CF requests</Now>
    </div>
  );
}

/** Structure placement (SETXCF START,REBUILD): which CF each structure lives in. */
function Structures({ desk }: { desk: Desk }) {
  const cfs = desk.cfg.cfs.map((c) => c.lparId);
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Structure</th>
              <th>Type</th>
              <th className="num">share of requests</th>
              <th>CF</th>
            </tr>
          </thead>
          <tbody>
            {desk.cfg.cfStructures.map((st) => (
              <tr key={st.name}>
                <td>{st.name}</td>
                <td>{st.type}</td>
                <td className="num">{Math.round(st.requestShare * 100)}%</td>
                <td>
                  {cfs.map((cf) => (
                    <ChangeButtonsInline key={cf} desk={desk} commands={[{ kind: 'MOVE_STRUCTURE', name: st.name, cfLparId: cf }]} disabled={st.cfLparId === cf} text={cf} />
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="help">
        Rebuilding a structure moves its requests to the other CF. Cache and list requests that get slow are converted to asynchronous; lock requests are not, so a lock structure on a slow
        or shared CF makes every Db2 transaction spin. The CF Activity report shows each structure.
      </div>
    </>
  );
}

function Subsystems({ desk }: { desk: Desk }) {
  const { cfg } = desk;
  const prodLpars = [...new Set(cfg.cics.map((r) => r.lparId))].sort();
  return (
    <>
      {cfg.db2.map((d) => (
        <Db2Row key={`${d.ssid}:${d.bufferPoolGb}:${d.maxDbat}`} desk={desk} ssid={d.ssid} />
      ))}
      <div className="help">Bigger buffer pools raise the hit ratio (fewer sync I/Os) but use LPAR memory. MAXDBAT caps concurrent DDF threads; above it requests queue.</div>
      <div style={{ overflowX: 'auto' }}>
        {cfg.cics.map((r) => (
          <CicsRow key={`${r.name}:${r.maxTasks}:${r.qrFrac}`} desk={desk} name={r.name} />
        ))}
      </div>
      <AddAor desk={desk} lpars={prodLpars} />
      <div className="help">MXT limits concurrent tasks per region. The QR share is CPU that must run on the single QR TCB (non-threadsafe code), so one region tops out near one engine.</div>
    </>
  );
}

function Db2Row({ desk, ssid }: { desk: Desk; ssid: string }) {
  const d = desk.cfg.db2.find((x) => x.ssid === ssid)!;
  const [bp, setBp] = useState(String(d.bufferPoolGb));
  const [dbat, setDbat] = useState(String(d.maxDbat));
  const lpar = desk.cfg.lpars.find((l) => l.id === d.lparId);
  const bpN = num(bp);
  const bpErr = !(bpN > 0) ? 'Must be > 0 GB' : lpar && bpN > lpar.memoryGb * 0.6 ? `More than 60% of ${d.lparId}'s ${lpar.memoryGb} GB` : null;
  const dbatN = num(dbat);
  return (
    <>
      <ChangeForm desk={desk} label={`${ssid} BP ${bp} GB`} commands={[{ kind: 'SET_DB2', ssid, bufferPoolGb: bpN }]} error={bpErr}>
        <label>
          <b>{ssid}</b> <span className="muted">({d.lparId})</span> buffer pools (GB) <input value={bp} onChange={(e) => setBp(e.target.value)} size={4} inputMode="numeric" />
        </label>
        <Now>{d.bufferPoolGb} GB</Now>
      </ChangeForm>
      <ChangeForm
        desk={desk}
        label={`${ssid} MAXDBAT ${dbat}`}
        commands={[{ kind: 'SET_DB2', ssid, maxDbat: dbatN }]}
        error={Number.isInteger(dbatN) && dbatN >= 1 ? null : 'MAXDBAT is a whole number ≥ 1'}
      >
        <label>
          {ssid} MAXDBAT <input value={dbat} onChange={(e) => setDbat(e.target.value)} size={5} inputMode="numeric" />
        </label>
        <Now>{d.maxDbat}</Now>
      </ChangeForm>
    </>
  );
}

function CicsRow({ desk, name }: { desk: Desk; name: string }) {
  const r = desk.cfg.cics.find((x) => x.name === name)!;
  const [mxt, setMxt] = useState(String(r.maxTasks));
  const n = num(mxt);
  return (
    <ChangeForm desk={desk} label={`${name} MXT ${mxt}`} commands={[{ kind: 'SET_CICS', name, maxTasks: n }]} error={Number.isInteger(n) && n >= 10 && n <= 2000 ? null : 'MXT is 10–2000'}>
      <label>
        <b>{name}</b> <span className="muted">({r.lparId}, QR {Math.round(r.qrFrac * 100)}%)</span> MXT <input value={mxt} onChange={(e) => setMxt(e.target.value)} size={4} inputMode="numeric" />
      </label>
      <Now>{r.maxTasks}</Now>
    </ChangeForm>
  );
}

function AddAor({ desk, lpars }: { desk: Desk; lpars: string[] }) {
  const [lpar, setLpar] = useState(lpars[0] ?? '');
  const names = desk.cfg.cics.map((r) => r.name);
  const [name, setName] = useState('');
  const effective = name || nextAorName(names);
  const err = !/^[A-Z][A-Z0-9#@$]{0,7}$/.test(effective) ? '1–8 chars, starts with a letter' : names.includes(effective) ? 'Region exists' : null;
  return (
    <ChangeForm desk={desk} label={`New AOR ${effective} on ${lpar}`} commands={[{ kind: 'ADD_AOR', lparId: lpar, name: effective, maxTasks: 200, qrFrac: 0.6 }]} error={err}>
      New CICS AOR on
      <select aria-label="LPAR for the new region" value={lpar} onChange={(e) => setLpar(e.target.value)}>
        {lpars.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <input aria-label="Region name" placeholder={nextAorName(names)} value={name} onChange={(e) => setName(e.target.value.toUpperCase())} size={9} />
    </ChangeForm>
  );
}

function Routing({ desk }: { desk: Desk }) {
  const routed = desk.cfg.routing.filter((r) => Object.keys(r.shares).length > 1);
  const [wid, setWid] = useState(routed[0]?.workloadId ?? '');
  const r = routed.find((x) => x.workloadId === wid);
  return (
    <>
      <div className="form">
        <label>
          Routing for{' '}
          <select value={wid} onChange={(e) => setWid(e.target.value)}>
            {routed.map((x) => (
              <option key={x.workloadId} value={x.workloadId}>
                {x.workloadId} ({x.name})
              </option>
            ))}
          </select>
        </label>
      </div>
      {r && <RoutingEditor key={`${wid}:${JSON.stringify(r.shares)}`} desk={desk} workloadId={wid} current={r.shares} />}
      <div className="help">Share of arriving work sent to each LPAR (Sysplex Distributor / workload balancing weights). Must add up to 100%.</div>
    </>
  );
}

function RoutingEditor({ desk, workloadId, current }: { desk: Desk; workloadId: string; current: Record<string, number> }) {
  const lpars = Object.keys(current).sort();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(lpars.map((l) => [l, String(Math.round(current[l]! * 100))])));
  const routing = Object.fromEntries(lpars.map((l) => [l, num(vals[l] ?? '') / 100]));
  return (
    <ChangeForm desk={desk} label={`${workloadId} routing`} commands={[{ kind: 'SET_ROUTING', workloadId, routing }]} error={validateRouting(routing)}>
      {lpars.map((l) => (
        <label key={l}>
          {l} <input value={vals[l]} onChange={(e) => setVals({ ...vals, [l]: e.target.value })} size={3} inputMode="numeric" />%
        </label>
      ))}
      <Now>{lpars.map((l) => `${Math.round(current[l]! * 100)}%`).join(' / ')}</Now>
    </ChangeForm>
  );
}

function JobClasses({ desk }: { desk: Desk }) {
  const classes = desk.cfg.jobClasses;
  const [jc, setJc] = useState(classes[0]?.jobClass ?? '');
  const j = classes.find((x) => x.jobClass === jc);
  return (
    <>
      <div className="form">
        <label>
          Job class{' '}
          <select value={jc} onChange={(e) => setJc(e.target.value)}>
            {classes.map((x) => (
              <option key={x.jobClass}>{x.jobClass}</option>
            ))}
          </select>
        </label>
      </div>
      {j && <JobClassEditor key={`${jc}:${j.mode}:${JSON.stringify(j.initiators)}`} desk={desk} jobClass={jc} />}
      <div className="help">JES mode: a fixed number of initiators per system. WLM mode: WLM starts initiators to meet the batch goals, up to the limit shown per system.</div>
    </>
  );
}

function JobClassEditor({ desk, jobClass }: { desk: Desk; jobClass: string }) {
  const j = desk.cfg.jobClasses.find((x) => x.jobClass === jobClass)!;
  const lpars = desk.cfg.systems.map((s) => s.lparId).sort();
  const [mode, setMode] = useState(j.mode);
  const [inits, setInits] = useState<Record<string, string>>(Object.fromEntries(lpars.map((l) => [l, String(j.initiators[l] ?? 0)])));
  const initiators = Object.fromEntries(lpars.map((l) => [l, num(inits[l] ?? '')]).filter(([, n]) => (n as number) > 0)) as Record<string, number>;
  const bad = lpars.some((l) => {
    const n = num(inits[l] ?? '');
    return !(Number.isInteger(n) && n >= 0 && n <= 99);
  });
  const err = bad ? 'Initiators are 0–99 per system' : Object.keys(initiators).length === 0 ? 'At least one system needs initiators' : null;
  return (
    <ChangeForm desk={desk} label={`Class ${jobClass} ${mode}`} commands={[{ kind: 'SET_JOB_CLASS', jobClass, mode, initiators }]} error={err}>
      <select aria-label="Initiator mode" value={mode} onChange={(e) => setMode(e.target.value as 'JES' | 'WLM')}>
        <option value="JES">JES-managed</option>
        <option value="WLM">WLM-managed</option>
      </select>
      {lpars.map((l) => (
        <label key={l}>
          {l} <input value={inits[l]} onChange={(e) => setInits({ ...inits, [l]: e.target.value })} size={2} inputMode="numeric" />
        </label>
      ))}
      <Now>
        {j.mode}{' '}
        {Object.keys(j.initiators)
          .sort()
          .map((k) => `${k}:${j.initiators[k]}`)
          .join(' ')}
      </Now>
    </ChangeForm>
  );
}

function Hardware({ v, game }: { v: ViewModel; game: GameHandle }) {
  return (
    <>
      {HARDWARE.map((h) => {
        const p = preview(v, { hardwareId: h.id });
        return (
          <div className="row" key={h.id}>
            <span>
              {h.name}
              <div className="muted" style={{ fontSize: 12 }}>
                {h.description} {h.leadDays > 0 ? `Lead time ${h.leadDays} days.` : 'Immediate.'}
                {h.opexPerDay > 0 ? ` $${Math.round(h.opexPerDay / 1000)}k/day while active.` : ''}
              </div>
              {p.reason && <div className="err">{p.reason}</div>}
            </span>
            <button disabled={!p.ok} title={p.reason ?? costText(p)} onClick={() => game.send({ type: 'CHANGE', req: { label: h.name, hardwareId: h.id } })}>
              {h.capex > 0 ? `$${Math.round(h.capex / 1000)}k` : `$${Math.round(h.opexPerDay / 1000)}k/day`} · {p.hours}h
            </button>
          </div>
        );
      })}
    </>
  );
}

function Ops({ desk, game }: { desk: Desk; game: GameHandle }) {
  const { v } = desk;
  const incidentOpen = v.previewCtx.incidentOpen;
  return (
    <>
      {v.batch.abended.length === 0 && <div className="muted">No abended jobs.</div>}
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
      {FIXES.map((f) => {
        const p = preview(v, { fixId: f.id });
        return (
          <div className="row" key={f.id}>
            <span>
              {f.name}
              <div className="muted" style={{ fontSize: 12 }}>
                {f.description}
                {f.trustCost ? ` Costs ${f.trustCost.amount} ${f.trustCost.facet} trust.` : ''}
              </div>
              {!incidentOpen && <div className="muted" style={{ fontSize: 12 }}>No open incident: only worth it if you have diagnosed this cause.</div>}
            </span>
            <button disabled={!p.ok} title={p.reason ?? undefined} onClick={() => game.send({ type: 'CHANGE', req: { label: f.name, fixId: f.id } })}>
              {costText(p)}
            </button>
          </div>
        );
      })}
    </>
  );
}
