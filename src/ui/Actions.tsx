import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CodexHints } from './CodexHint';
import { cfUsedGb, duplexSecondary, type CfConfig, type CfStructureConfig } from '../sim/cf/cf';
import { ServiceClasses } from './ServiceClassEditor';
import { useStored } from './useStored';
import { DASD_REBALANCE, HARDWARE } from '../content/hardware-catalog';
import { LCU_MAX_DEVICES } from '../sim/io/dasd';
import { FIXES, previewChange, type ChangePreview } from '../game/catalog';
import { addToBasket, basketLabel, commandTarget, describeCommand, orderBasket, spareAfterBasket, nextAorName, routingPolicyLabel, validateDefinedCapacity, validateLogical, validateMemory, validateRouting, validateWeight } from '../game/changeDesk';
import type { PlannedChange } from '../game/types';
import type { ConfigView, ViewModel } from '../game/view';
import type { Command } from '../sim/core/commands';
import type { RoutingPolicy } from '../sim/workload/routing';
import { entitlements, polarity } from '../sim/hw/prsm';
import type { Qualifier, SubsystemType, WorkAttributes } from '../sim/wlm/types';
import { RulesView } from './RulesView';
import { WhatIf } from './WhatIf';
import type { GameHandle } from './useGame';
import { Empty } from './Empty';

/** Everything a control needs to preview, stage or apply a change. */
interface Desk {
  v: ViewModel;
  cfg: ConfigView;
  basket: Command[];
  apply: (label: string, commands: Command[]) => void;
  stage: (commands: Command[]) => void;
  /** Put a draft for one target into the change request, or drop it (null). */
  setDraft: (target: string, cmd: Command | null) => void;
  /** Report a field whose typed value is invalid (or null when it is fixed or gone), so the request can't be submitted past it. */
  setInvalid: (target: string, message: string | null) => void;
  invalid: Record<string, string>;
}

// Only the command kind matters for the hours estimate.
const ACTIVATE_PREVIEW = [{ kind: 'ACTIVATE_POLICY' } as Command];

export function Actions({ v, game }: { v: ViewModel; game: GameHandle }) {
  const { basket, setBasket } = game;
  const [rulesOpen, setRulesOpen] = useState(false);
  const [invalid, setInvalidMap] = useState<Record<string, string>>({});
  const desk: Desk = {
    v,
    cfg: v.config,
    basket,
    apply: (label, commands) => game.send({ type: 'CHANGE', req: { label, commands } }),
    stage: (commands) => setBasket((b) => addToBasket(b, commands)),
    setDraft: (target, cmd) => setBasket((b) => (cmd ? addToBasket(b, [cmd]) : b.filter((c) => commandTarget(c) !== target))),
    invalid,
    setInvalid: (target, message) =>
      setInvalidMap((m) => {
        if ((m[target] ?? null) === message) return m;
        const { [target]: _, ...rest } = m;
        return message === null ? rest : { ...rest, [target]: message };
      }),
  };
  const [area, setArea] = useStored<Area>('goalmode.desk.area', 'wlm');
  const pendingProjects = v.projects.filter((p) => p.hoursDone > 0 && !p.done).length;
  const counts: Partial<Record<Area, ReactNode>> = {
    wlm: game.pending ? <span className="tag warn">pending</span> : null,
    ops: v.batch.abended.length > 0 ? <span className="tag bad">{v.batch.abended.length} abended</span> : null,
    projects: pendingProjects > 0 ? <span className="tag">{pendingProjects} in progress</span> : null,
  };
  const up = v.config.cfs.filter((c) => !c.failed).map((c) => c.lparId);
  const cfUsed = cfUsedGb(v.config.cfStructures, up);
  const summary = {
    wlm: `${(game.pending?.classDefs ?? v.classDefs).length} service classes · ${game.rules ? (game.rules.pending ?? game.rules.active).subsystems.reduce((a, x) => a + x.rows.length, 0) : '…'} classification rules`,
    policies: `${v.policies.saved.length} saved · ${v.policies.schedule.length} scheduled switch${v.policies.schedule.length === 1 ? '' : 'es'}`,
    hmc: v.config.lpars
      .filter((l) => l.kind === 'ZOS')
      .map((l) => `${l.id} w${l.weight}`)
      .join(' · '),
    hardware: `$${Math.round(v.capexRemaining / 1000)}k capex left`,
    systems: `RMF interval ${v.config.rmfIntervalMin} min · IEAOPT per system`,
    cf: v.config.cfs.map((c) => (c.failed ? `${c.lparId} DOWN` : `${c.lparId} ${Math.round(cfUsed[c.lparId] ?? 0)} GB used`)).join(' · ') + ` · ${v.config.cfStructures.filter((x) => x.lost).length} lost`,
    dasd: `${v.config.dasd.lcus.length} LCUs · ${v.config.dasd.spareAliases} spare aliases`,
    db2: `${v.config.db2.length} subsystem${v.config.db2.length === 1 ? '' : 's'}`,
    mq: `${v.config.mq.length} queue${v.config.mq.length === 1 ? '' : 's'}`,
    cics: `${v.config.cics.length} AORs`,
    routing: `${v.config.routing.length} workloads · ${v.config.jobClasses.length} job classes`,
    projects: `${v.projects.filter((p) => p.done).length} done · ${pendingProjects} in progress · ${v.projects.length} available`,
    ops: v.batch.abended.length ? `${v.batch.abended.length} abended job(s) to restart` : 'no abended jobs · event fixes',
  };
  return (
    <>
      <div className="desk-banners">
        {game.pending && <PendingBanner v={v} game={game} />}
        <ChangeRequestBar desk={desk} setBasket={setBasket} game={game} />
      </div>
      <div className="grid desk-top">
        <Board v={v} game={game} />
        <Results game={game} />
      </div>
      <div className="subtabs" role="tablist" aria-label="Change Desk areas">
        {AREAS.map((a) => (
          <button key={a.id} role="tab" aria-selected={area === a.id} className={area === a.id ? 'active' : ''} onClick={() => setArea(a.id)} title={a.hint}>
            {a.label} {counts[a.id]}
          </button>
        ))}
      </div>
      <div className="muted desk-hint">{AREAS.find((a) => a.id === area)?.hint}</div>
      <div className={area === 'systems' ? 'grid grid-wide' : 'grid'}>
        {area === 'wlm' && (
          <>
            <Section id="wlm" title={`WLM policy: active ${v.policyName}`} summary={summary.wlm} codex={['service-class', 'importance', 'velocity', 'perf-index']} wide>
              <Wlm v={v} game={game} rulesOpen={rulesOpen} toggleRules={() => setRulesOpen(!rulesOpen)} />
            </Section>
            {rulesOpen && <RulesView v={v} game={game} onClose={() => setRulesOpen(false)} />}
            <Section id="policies" title="WLM service policies and daily schedule" summary={summary.policies} codex={['service-policies']} wide>
              <PolicySchedule v={v} game={game} />
            </Section>
          </>
        )}
        {area === 'lpars' && (
          <>
            <Section id="hmc" title="HMC: LPAR image profile" summary={summary.hmc} codex={['lpar-weights', 'logical-physical', 'hiperdispatch', 'absolute-capping']}>
              <Prsm desk={desk} />
            </Section>
            <Section id="hardware" title="Hardware orders" summary={summary.hardware} codex={['ziip', 'cod']}>
              <Hardware v={v} game={game} />
            </Section>
          </>
        )}
        {area === 'systems' && (
          <>
            <Section id="cf" title="Coupling facilities and structures" summary={summary.cf} codex={['cf-sync-async', 'cf-failure']} wide>
              <CouplingFacilities desk={desk} />
            </Section>
            {/* Two independent stacks so a short card doesn't leave a hole beside a tall one; MQ sits left to balance their heights. */}
            <div className="desk-stack">
              <Section id="systems" title="z/OS options" summary={summary.systems}>
                <Systems desk={desk} />
              </Section>
              <Section id="dasd" title="DASD: HyperPAV aliases per LCU" summary={summary.dasd} codex={['hyperpav']}>
                <Dasd desk={desk} />
              </Section>
              <Section id="mq" title="MQ" summary={summary.mq} codex={['mq-queues']}>
                <MqSection desk={desk} />
              </Section>
            </div>
            <div className="desk-stack">
              <Section id="db2" title="Db2" summary={summary.db2} codex={['db2-velocity']}>
                <Db2Section desk={desk} />
              </Section>
              <Section id="cics" title="CICS regions" summary={summary.cics} codex={['qr-tcb']}>
                <CicsSection desk={desk} />
              </Section>
            </div>
          </>
        )}
        {area === 'ops' && (
          <>
            <Section id="ops" title="Operations" summary={summary.ops}>
              <Ops desk={desk} game={game} />
            </Section>
            <Section id="routing" title="Routing and batch initiators" summary={summary.routing} codex={['sd-wlm-weights', 'cpsm-routing', 'storm-drain', 'arrival-bursts']}>
              <Routing desk={desk} />
              <JobClasses desk={desk} />
            </Section>
          </>
        )}
        {area === 'projects' && (
          <Section id="projects" title="Projects (multi-day)" summary={summary.projects} wide>
            <Projects v={v} game={game} />
          </Section>
        )}
      </div>
    </>
  );
}

type Area = 'wlm' | 'lpars' | 'systems' | 'ops' | 'projects';
const AREAS: { id: Area; label: string; hint: string }[] = [
  { id: 'wlm', label: 'WLM', hint: 'Service classes, goals, resource groups, classification rules, report classes and the daily policy schedule.' },
  { id: 'lpars', label: 'LPARs & hardware', hint: 'PR/SM weights, logical CPs, capping and memory per LPAR; capacity and hardware orders.' },
  { id: 'systems', label: 'Systems, CF & I/O', hint: 'z/OS options, coupling facilities and structures, DASD aliases, Db2, MQ and CICS settings.' },
  { id: 'ops', label: 'Batch & operations', hint: 'Restart abended jobs and apply event fixes; workload routing and batch initiators.' },
  { id: 'projects', label: 'Projects', hint: 'Multi-day improvements booked during the briefing.' },
];


const CLOSED_KEY = 'goalmode.desk.closed';
const loadClosed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

function Section({ id, title, summary, codex = [], wide = false, children }: { id: string; title: string; summary?: string; codex?: string[]; wide?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => !loadClosed().includes(id));
  return (
    <details
      className="panel section"
      open={open}
      style={wide ? { gridColumn: '1 / -1' } : undefined}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        try {
          const closed = loadClosed().filter((x) => x !== id);
          localStorage.setItem(CLOSED_KEY, JSON.stringify(o ? closed : [...closed, id]));
        } catch {
          // Storage blocked: fine.
        }
      }}
    >
      <summary>
        <h3>
          {title}
          <CodexHints ids={codex} />
        </h3>
        {summary && <span className="section-summary">{summary}</span>}
      </summary>
      {children}
    </details>
  );
}

const costText = (p: ChangePreview): string => {
  const parts = [`${p.hours}h`];
  if (p.capex) parts.push(`$${Math.round(p.capex / 1000)}k`);
  if (p.emergency && p.trustCostEach > 0) parts.push(`EMERG −${p.trustCostEach} trust each`);
  if (p.failRisk > 0) parts.push(`${(p.failRisk * 100).toFixed(0)}% fail risk`);
  return parts.join(' · ');
};

const preview = (v: ViewModel, req: Parameters<typeof previewChange>[1]) => previewChange(v.previewCtx, req);

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
function ChangeRequestBar({ desk, setBasket, game }: { desk: Desk; setBasket: (b: Command[]) => void; game: GameHandle }) {
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
  const cpcIds = [...new Set(zos.map((x) => x.cpcId))];
  const [lpar, setLpar] = useState(zos[0]?.id ?? '');
  return (
    <>
      <div className="form">
        <label>
          LPAR{' '}
          <select value={lpar} onChange={(e) => setLpar(e.target.value)}>
            {cpcIds.length > 1
              ? cpcIds.map((id) => (
                  <optgroup key={id} label={`CPC ${id}`}>
                    {zos.filter((x) => x.cpcId === id).map((x) => (
                      <option key={x.id}>{x.id}</option>
                    ))}
                  </optgroup>
                ))
              : zos.map((x) => <option key={x.id}>{x.id}</option>)}
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
  if (!l) return null;
  const draftWeight = draftFor(desk, `SET_WEIGHT:${lparId}:CP`);
  const draftLogical = draftFor(desk, `SET_LOGICAL:${lparId}:CP`);
  const weight = draftWeight?.kind === 'SET_WEIGHT' ? draftWeight.weight : l.weight;
  const logical = draftLogical?.kind === 'SET_LOGICAL' ? draftLogical.logical : l.cpLogical;
  return (
    <>
      <PolarityPreview v={desk.v} lpar={lparId} weight={weight} logical={logical} />
      <div style={{ overflowX: 'auto' }}>
        <table>
          <tbody>
            <tr>
              <td>CP weight</td>
              <td>
                <DraftNumber
                  desk={desk}
                  label={`${lparId} CP weight`}
                  live={l.weight}
                  size={4}
                  make={(n) => ({ kind: 'SET_WEIGHT', lparId, pool: 'CP', weight: n })}
                  read={(c) => (c.kind === 'SET_WEIGHT' ? c.weight : l.weight)}
                  validate={validateWeight}
                />
              </td>
              <td />
            </tr>
            <tr>
              <td>Logical CPs</td>
              <td>
                <DraftNumber
                  desk={desk}
                  label={`${lparId} logical CPs`}
                  live={l.cpLogical}
                  size={3}
                  make={(n) => ({ kind: 'SET_LOGICAL', lparId, pool: 'CP', logical: n })}
                  read={(c) => (c.kind === 'SET_LOGICAL' ? c.logical : l.cpLogical)}
                  validate={(n) => validateLogical(desk.cfg, lparId, 'CP', n)}
                />
              </td>
              <td className="muted">
                {l.cpLogical} online + {l.cpReserved} reserved
              </td>
            </tr>
            <tr>
              <td>Logical zIIPs</td>
              <td>
                <DraftNumber
                  desk={desk}
                  label={`${lparId} logical zIIPs`}
                  live={l.ziipLogical}
                  size={3}
                  make={(n) => ({ kind: 'SET_LOGICAL', lparId, pool: 'ZIIP', logical: n })}
                  read={(c) => (c.kind === 'SET_LOGICAL' ? c.logical : l.ziipLogical)}
                  validate={(n) => validateLogical(desk.cfg, lparId, 'ZIIP', n)}
                />
              </td>
              <td className="muted">
                {l.ziipLogical} online + {l.ziipReserved} reserved
              </td>
            </tr>
            <tr>
              <td>Defined capacity (MSU)</td>
              <td>
                <DraftNumber<number | null>
                  desk={desk}
                  label={`${lparId} defined capacity (MSU)`}
                  live={l.definedCapacity}
                  size={5}
                  blank="none"
                  make={(n) => ({ kind: 'SET_DEFINED_CAPACITY', lparId, msu: n })}
                  read={(c) => (c.kind === 'SET_DEFINED_CAPACITY' ? c.msu : l.definedCapacity)}
                  validate={validateDefinedCapacity}
                />
              </td>
              <td className="muted">blank = none</td>
            </tr>
            <tr>
              <td>Memory (GB)</td>
              <td>
                <DraftNumber
                  desk={desk}
                  label={`${lparId} memory (GB)`}
                  live={l.memoryGb}
                  size={5}
                  make={(n) => ({ kind: 'SET_LPAR_MEMORY', lparId, memoryGb: n })}
                  read={(c) => (c.kind === 'SET_LPAR_MEMORY' ? c.memoryGb : l.memoryGb)}
                  validate={(n) => validateMemory(desk.cfg, lparId, n)}
                />
              </td>
              <td className="muted">{desk.cfg.unassignedMemoryGb} GB unassigned</td>
            </tr>
          </tbody>
        </table>
      </div>
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


function Wlm({ v, game, rulesOpen, toggleRules }: { v: ViewModel; game: GameHandle; rulesOpen: boolean; toggleRules: () => void }) {
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
      <CicsModeToggle v={v} game={game} />
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
function PolicySchedule({ v, game }: { v: ViewModel; game: GameHandle }) {
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

const draftFor = (desk: Desk, target: string): Command | undefined => desk.basket.find((c) => commandTarget(c) === target);

/**
 * "was <live value>" next to a drafted control. It is always rendered so table columns size for it up front and nothing
 * shifts when a draft starts; until then it is invisible and has no height (where a column is too narrow it wraps onto a
 * line of its own, which only takes room once the draft shows it).
 */
const Was = ({ shown = true, children }: { shown?: boolean; children: ReactNode }) => (
  <span className={shown ? 'was' : 'was idle'} aria-hidden={!shown}>
    was {children}
  </span>
);

/**
 * One of a few values (or on/off). Picking a value drafts it into the change request; picking the live value again drops the
 * draft. Nothing is applied until the request is submitted, so the control needs no buttons or cost of its own.
 */
function DraftChoice<T>({
  desk,
  live,
  options,
  make,
  read,
  label,
}: {
  desk: Desk;
  live: T;
  options: { value: T; text: string; disabled?: boolean }[];
  make: (value: T) => Command;
  read: (draft: Command) => T;
  label: string;
}) {
  const target = commandTarget(make(options[0]!.value));
  const d = draftFor(desk, target);
  const value = d ? read(d) : live;
  const liveText = options.find((o) => o.value === live)?.text;
  return (
    <span className={d ? 'seg drafted' : 'seg'} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.text}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : undefined}
          disabled={o.disabled}
          onClick={() => desk.setDraft(target, o.value === live ? null : make(o.value))}
        >
          {o.text}
        </button>
      ))}
      {liveText && <Was shown={!!d}>{liveText}</Was>}
    </span>
  );
}

/** A number setting. A valid value that differs from the live one is drafted into the change request as you type. */
function DraftNumber<T extends number | null = number>({
  desk,
  live,
  make,
  read,
  validate,
  label,
  size,
  format = String,
  blank,
}: {
  desk: Desk;
  live: T;
  make: (value: T) => Command;
  read: (draft: Command) => T;
  validate: (value: T) => string | null;
  label: string;
  size: number;
  format?: (value: T) => string;
  /** Placeholder when an empty field means "none" (null). */
  blank?: string;
}) {
  const target = commandTarget(make(live));
  const d = draftFor(desk, target);
  const show = (x: T) => (x === null ? '' : String(x));
  const parse = (t: string): T => (blank !== undefined && t.trim() === '' ? null : num(t)) as T;
  const [text, setText] = useState(show(d ? read(d) : live));
  const err = validate(parse(text));
  useEffect(() => {
    desk.setInvalid(target, err && `${label}: ${err}`);
    return () => desk.setInvalid(target, null);
  }, [err]); // eslint-disable-line react-hooks/exhaustive-deps
  // Submitted or cleared elsewhere: show the live value again.
  useEffect(() => {
    if (!d && !err && parse(text) !== live) setText(show(live));
  }, [d, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const onChange = (s: string) => {
    setText(s);
    const n = parse(s);
    desk.setDraft(target, validate(n) !== null || n === live ? null : make(n));
  };
  return (
    <span className={d ? 'draft drafted' : 'draft'}>
      <input aria-label={label} aria-invalid={err !== null} value={text} onChange={(e) => onChange(e.target.value)} size={size} inputMode="numeric" placeholder={blank} />
      <Was shown={!!d}>{live === null ? blank : format(live)}</Was>
      {err && <span className="err">{err}</span>}
    </span>
  );
}

/** A one-off action (not a setting): ticking it drafts it into the change request. */
function DraftAction({ desk, command, disabled, label, title }: { desk: Desk; command: Command; disabled: boolean; label: string; title?: string }) {
  const target = commandTarget(command);
  const d = draftFor(desk, target);
  return (
    <label className={d ? 'draft-action drafted' : 'draft-action'} title={title}>
      <input type="checkbox" checked={!!d} disabled={disabled} onChange={(e) => desk.setDraft(target, e.target.checked ? command : null)} /> {label}
    </label>
  );
}

/**
 * A draft built from several fields (routing policy, routing shares, job class). Form state stays local; whenever it is
 * valid and differs from the live value its command is drafted, otherwise the draft is dropped.
 */
function useDraftForm<S>(desk: Desk, target: string, label: string, init: (draft: Command | undefined) => S, build: (s: S) => { cmd: Command | null; error: string | null }) {
  const d = draftFor(desk, target);
  const [s, setS] = useState<S>(() => init(d));
  const { cmd, error } = build(s);
  useEffect(() => {
    desk.setInvalid(target, error && `${label}: ${error}`);
    return () => desk.setInvalid(target, null);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  // Submitted or cleared elsewhere: back to the live value.
  useEffect(() => {
    if (!d && !error && cmd) setS(init(undefined));
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next: S) => {
    setS(next);
    const b = build(next);
    desk.setDraft(target, b.error || !b.cmd ? null : b.cmd);
  };
  return { s, update, drafted: !!d, error };
}

function Systems({ desk }: { desk: Desk }) {
  const { cfg } = desk;
  return (
    <>
      <div className="form">
        RMF interval
        <DraftChoice
          desk={desk}
          label="RMF interval"
          live={cfg.rmfIntervalMin}
          options={[5, 15, 30].map((m) => ({ value: m, text: `${m} min` }))}
          make={(m) => ({ kind: 'SET_RMF_INTERVAL', minutes: m })}
          read={(c) => (c.kind === 'SET_RMF_INTERVAL' ? c.minutes : cfg.rmfIntervalMin)}
        />
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
                  <DraftChoice
                    desk={desk}
                    label={`${s.lparId} BLWLINTHD`}
                    live={s.blwlinthdSec}
                    options={[5, 20].map((sec) => ({ value: sec, text: `${sec}s` }))}
                    make={(sec) => ({ kind: 'SET_IEAOPT', lparId: s.lparId, changes: { blwlinthdSec: sec } })}
                    read={(c) => (c.kind === 'SET_IEAOPT' ? c.changes.blwlinthdSec ?? s.blwlinthdSec : s.blwlinthdSec)}
                  />
                </td>
                <td>
                  <DraftChoice
                    desk={desk}
                    label={`${s.lparId} IIPHONORPRIORITY`}
                    live={s.iipHonorPriority}
                    options={[
                      { value: true, text: 'YES' },
                      { value: false, text: 'NO' },
                    ]}
                    make={(on) => ({ kind: 'SET_IEAOPT', lparId: s.lparId, changes: { iipHonorPriority: on } })}
                    read={(c) => (c.kind === 'SET_IEAOPT' ? c.changes.iipHonorPriority ?? s.iipHonorPriority : s.iipHonorPriority)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="help">BLWLINTHD: seconds a starved unit of work waits before blocked-workload promotion. IIPHONORPRIORITY=YES lets zIIP work overflow to CPs.</div>
    </>
  );
}

function CouplingFacilities({ desk }: { desk: Desk }) {
  const up = desk.cfg.cfs.filter((x) => !x.failed).map((x) => x.lparId);
  const used = cfUsedGb(desk.cfg.cfStructures, up);
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>CF</th>
              <th>Thin interrupts</th>
              <th className="num">share of requests</th>
              <th className="num">storage used</th>
            </tr>
          </thead>
          <tbody>
            {desk.cfg.cfs.map((c) => {
              const share = desk.cfg.cfStructures.filter((x) => x.cfLparId === c.lparId && !x.lost).reduce((a, x) => a + x.requestShare, 0);
              const mem = desk.cfg.lpars.find((l) => l.id === c.lparId)?.memoryGb ?? 0;
              return (
                <tr key={c.lparId}>
                  <td>
                    <b>{c.lparId}</b> {c.failed && <span className="tag bad">DOWN</span>}
                  </td>
                  <td>
                    <DraftChoice
                      desk={desk}
                      label={`${c.lparId} thin interrupts`}
                      live={c.thinInterrupts}
                      options={[
                        { value: true, text: 'on' },
                        { value: false, text: 'off' },
                      ]}
                      make={(on) => ({ kind: 'SET_CF', lparId: c.lparId, thinInterrupts: on })}
                      read={(x) => (x.kind === 'SET_CF' ? x.thinInterrupts ?? c.thinInterrupts : c.thinInterrupts)}
                    />
                  </td>
                  <td className="num">{Math.round(share * 100)}%</td>
                  <td className="num">
                    {(used[c.lparId] ?? 0).toFixed(0)} of {mem} GB
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="help">Thin interrupts let a CF on shared engines wake on demand instead of waiting for a dispatch interval.</div>
      <Structures desk={desk} />
    </>
  );
}

function structureStatus(st: CfStructureConfig, cfs: readonly CfConfig[], tick: number): ReactNode {
  if (st.lost) return <span className="tag bad">LOST</span>;
  if (st.rebuildUntilTick !== undefined && st.rebuildUntilTick > tick) return <span className="tag warn">rebuilding</span>;
  const sec = duplexSecondary(st, cfs.filter((c) => !c.failed).map((c) => c.lparId));
  return sec ? <span className="tag good">duplexed into {sec}</span> : <span className="muted">simplex</span>;
}

/** Structure placement (SETXCF START,REBUILD): which CF each structure lives in. */
function Structures({ desk }: { desk: Desk }) {
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Structure</th>
              <th>Type</th>
              <th className="num">share of requests</th>
              <th className="num">size</th>
              <th>status</th>
              <th>in CF</th>
              <th>duplex</th>
            </tr>
          </thead>
          <tbody>
            {desk.cfg.cfStructures.map((st) => (
              <tr key={st.name}>
                <td>{st.name}</td>
                <td>{st.type}</td>
                <td className="num">{Math.round(st.requestShare * 100)}%</td>
                <td className="num">{st.sizeGb ?? '-'} GB</td>
                <td>{structureStatus(st, desk.cfg.cfs, desk.v.tick)}</td>
                <td>
                  <DraftChoice
                    desk={desk}
                    label={`${st.name} CF`}
                    // A lost structure is in no CF: any CF that is up rebuilds it.
                    live={st.lost ? null : st.cfLparId}
                    options={desk.cfg.cfs.map((c) => ({ value: c.lparId, text: c.lparId, disabled: c.failed }))}
                    make={(cf) => ({ kind: 'MOVE_STRUCTURE', name: st.name, cfLparId: cf ?? st.cfLparId })}
                    read={(c) => (c.kind === 'MOVE_STRUCTURE' ? c.cfLparId : st.cfLparId)}
                  />
                </td>
                <td>
                  <DraftChoice
                    desk={desk}
                    label={`${st.name} duplexing`}
                    live={!!st.duplexed}
                    options={[
                      { value: false, text: 'off', disabled: !!st.lost },
                      { value: true, text: 'on', disabled: !!st.lost },
                    ]}
                    make={(on) => ({ kind: 'SET_DUPLEX', name: st.name, on })}
                    read={(c) => (c.kind === 'SET_DUPLEX' ? c.on : !!st.duplexed)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="help">
        Rebuilding a structure moves its requests to the other CF. Requests that get slow are converted to asynchronous (lock requests a little later than cache and list), so a lock
        structure on a slow or shared CF makes every Db2 transaction spin or wait. The CF Activity report shows each structure. If a CF fails, its structures are rebuilt into the other CF only if it has white space
        for them; a structure that doesn&apos;t fit is lost (lock or SCA: Db2 is down; GBP: pages in recovery; MQ admin: shared queues stop). Duplexing keeps a copy in the other CF, so a
        failure costs nothing, but every request then waits for both CFs.
      </div>
    </>
  );
}

function Dasd({ desk }: { desk: Desk }) {
  const { lcus, spareAliases } = desk.cfg.dasd;
  return (
    <>
      <div className="form">
        <span>
          Spare aliases: <b>{spareAliases}</b>
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Lower an LCU to free aliases and raise another to use them; both edits go into the same change request.
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>LCU</th>
              <th className="num">Vols</th>
              <th>Aliases</th>
              <th className="num">max</th>
              <th>Hot data sets</th>
            </tr>
          </thead>
          <tbody>
            {lcus.map((l) => {
              // Aliases freed by drafts on other LCUs count as spare here.
              const spare = spareAfterBasket(desk.cfg, desk.basket, l.id);
              const max = Math.min(LCU_MAX_DEVICES - l.volumes, l.aliases + spare);
              const skew = Math.max(DASD_REBALANCE.minSkew, l.hotSkew * DASD_REBALANCE.skewFactor);
              return (
                <tr key={l.id}>
                  <td>
                    <b>LCU {l.id}</b> <span className="muted">{l.label}</span>
                  </td>
                  <td className="num">{l.volumes}</td>
                  <td>
                    <DraftNumber
                      desk={desk}
                      label={`LCU ${l.id} aliases`}
                      live={l.aliases}
                      size={3}
                      make={(n) => ({ kind: 'SET_LCU', lcuId: l.id, aliases: n })}
                      read={(c) => (c.kind === 'SET_LCU' ? c.aliases ?? l.aliases : l.aliases)}
                      validate={(n) =>
                        !(Number.isInteger(n) && n >= 0) ? 'Whole number ≥ 0' : n > LCU_MAX_DEVICES - l.volumes ? `Max ${LCU_MAX_DEVICES - l.volumes} (256 devices per LCU)` : n - l.aliases > spare ? `Only ${spare} spare` : null
                      }
                    />
                  </td>
                  <td className="num">{max}</td>
                  <td>
                    <DraftAction
                      desk={desk}
                      label="rebalance"
                      command={{ kind: 'SET_LCU', lcuId: l.id, hotSkew: skew }}
                      disabled={l.hotSkew <= DASD_REBALANCE.minSkew}
                      title={l.hotSkew <= DASD_REBALANCE.minSkew ? 'Already balanced' : 'Move hot data sets off the busiest volumes'}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="help">
        HyperPAV aliases are pooled per logical control unit (LCU) and cannot be borrowed across LCUs; an LCU addresses at most {LCU_MAX_DEVICES} devices
        (volumes + aliases). IOSQ in the DASD Activity LCU summary means an LCU has run out. Rebalancing moves hot data sets off its busiest volumes.
      </div>
    </>
  );
}

function Db2Section({ desk }: { desk: Desk }) {
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Subsystem</th>
              <th>Buffer pools (GB)</th>
              <th>MAXDBAT</th>
            </tr>
          </thead>
          <tbody>
            {desk.cfg.db2.map((d) => {
              const lpar = desk.cfg.lpars.find((l) => l.id === d.lparId);
              return (
                <tr key={d.ssid}>
                  <td>
                    <b>{d.ssid}</b> <span className="muted">({d.lparId})</span>
                  </td>
                  <td>
                    <DraftNumber
                      desk={desk}
                      label={`${d.ssid} buffer pools (GB)`}
                      live={d.bufferPoolGb}
                      size={4}
                      make={(n) => ({ kind: 'SET_DB2', ssid: d.ssid, bufferPoolGb: n })}
                      read={(c) => (c.kind === 'SET_DB2' ? c.bufferPoolGb ?? d.bufferPoolGb : d.bufferPoolGb)}
                      validate={(n) => (!(n > 0) ? 'Must be > 0 GB' : lpar && n > lpar.memoryGb * 0.6 ? `More than 60% of ${d.lparId}'s ${lpar.memoryGb} GB` : null)}
                    />
                  </td>
                  <td>
                    <DraftNumber
                      desk={desk}
                      label={`${d.ssid} MAXDBAT`}
                      live={d.maxDbat}
                      size={5}
                      make={(n) => ({ kind: 'SET_DB2', ssid: d.ssid, maxDbat: n })}
                      read={(c) => (c.kind === 'SET_DB2' ? c.maxDbat ?? d.maxDbat : d.maxDbat)}
                      validate={(n) => (Number.isInteger(n) && n >= 1 ? null : 'Whole number ≥ 1')}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="help">Bigger buffer pools raise the hit ratio (fewer sync I/Os) but use LPAR memory. MAXDBAT caps concurrent DDF threads; above it requests queue.</div>
    </>
  );
}

function MqSection({ desk }: { desk: Desk }) {
  const { mq } = desk.cfg;
  if (mq.length === 0) return <Empty>No MQ queues in this estate.</Empty>;
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Queue</th>
              <th>MAXDEPTH</th>
            </tr>
          </thead>
          <tbody>
            {mq.map((q) => (
              <tr key={q.workloadId}>
                <td>
                  <b>{q.queue}</b> <span className="muted">({q.workloadId})</span>
                </td>
                <td>
                  <DraftNumber
                    desk={desk}
                    label={`${q.queue} MAXDEPTH`}
                    live={q.maxDepth}
                    size={9}
                    format={(n) => n.toLocaleString()}
                    make={(n) => ({ kind: 'SET_MQ', workloadId: q.workloadId, maxDepthMsgs: n })}
                    read={(c) => (c.kind === 'SET_MQ' ? c.maxDepthMsgs : q.maxDepth)}
                    validate={(n) => (Number.isInteger(n) && n >= 1 && n <= 999_999_999 ? null : 'Whole number 1–999999999')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="help">
        Messages wait on the queue instead of timing out, so a slow consumer shows up as queue depth and end-to-end latency. Past MAXDEPTH, puts fail (MQRC 2053) and the
        sender retries. A deeper queue rides out longer bursts but holds more messages in memory.
      </div>
    </>
  );
}

function CicsSection({ desk }: { desk: Desk }) {
  const { cfg } = desk;
  const prodLpars = [...new Set(cfg.cics.map((r) => r.lparId))].sort();
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Region</th>
              <th>LPAR</th>
              <th className="num">QR share</th>
              <th>MXT</th>
            </tr>
          </thead>
          <tbody>
            {cfg.cics.map((r) => (
              <tr key={r.name}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td className="muted">{r.lparId}</td>
                <td className="num">{Math.round(r.qrFrac * 100)}%</td>
                <td>
                  <DraftNumber
                    desk={desk}
                    label={`${r.name} MXT`}
                    live={r.maxTasks}
                    size={4}
                    make={(n) => ({ kind: 'SET_CICS', name: r.name, maxTasks: n })}
                    read={(c) => (c.kind === 'SET_CICS' ? c.maxTasks ?? r.maxTasks : r.maxTasks)}
                    validate={(n) => (Number.isInteger(n) && n >= 10 && n <= 2000 ? null : 'MXT is 10–2000')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>New region</h4>
      <AddAor desk={desk} lpars={prodLpars} />
      <div className="help">MXT limits concurrent tasks per region. The QR share is CPU that must run on the single QR TCB (non-threadsafe code), so one region tops out near one engine.</div>
    </>
  );
}

function AddAor({ desk, lpars }: { desk: Desk; lpars: string[] }) {
  const [lpar, setLpar] = useState(lpars[0] ?? '');
  const names = desk.cfg.cics.map((r) => r.name);
  const [name, setName] = useState('');
  const effective = name || nextAorName(names);
  const err = !/^[A-Z][A-Z0-9#@$]{0,7}$/.test(effective) ? '1–8 chars, starts with a letter' : names.includes(effective) ? 'Region exists' : null;
  const cmd: Command = { kind: 'ADD_AOR', lparId: lpar, name: effective, maxTasks: 200, qrFrac: 0.6 };
  const drafted = !!draftFor(desk, commandTarget(cmd));
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (err === null) desk.setDraft(commandTarget(cmd), cmd);
      }}
    >
      <label>
        LPAR{' '}
        <select aria-label="LPAR for the new region" value={lpar} onChange={(e) => setLpar(e.target.value)}>
          {lpars.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label>
        Name <input aria-label="Region name" placeholder={nextAorName(names)} value={name} onChange={(e) => setName(e.target.value.toUpperCase())} size={9} />
      </label>
      <button type="submit" disabled={err !== null || drafted}>
        {drafted ? 'In the change request' : 'Add to change request'}
      </button>
      {err && <span className="err">{err}</span>}
    </form>
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
      {r && <RoutingPolicyEditor key={`${wid}:p:${JSON.stringify(r.policy)}`} desk={desk} workloadId={wid} lpars={Object.keys(r.shares).sort()} current={r.policy} />}
      {r && r.policy.method === 'STATIC' && <RoutingEditor key={`${wid}:${JSON.stringify(r.shares)}`} desk={desk} workloadId={wid} current={r.shares} />}
      <div className="help">
        Static: fixed share of arriving work per LPAR (must add up to 100%). WLM weights: Sysplex Distributor follows each system's idle CP capacity
        (BASEWLM), or each server's capacity at the work's importance, CP and zIIP (SERVERWLM). CPSM goal: CICSPlex SM routes by each region's response time; set ABENDTHRESH/ABENDCRIT so a
        region that fails fast is not mistaken for a fast one, and quiesce a region to drain it.
      </div>
    </>
  );
}

function RoutingPolicyEditor({ desk, workloadId, lpars, current }: { desk: Desk; workloadId: string; lpars: string[]; current: RoutingPolicy }) {
  type Form = { method: RoutingPolicy['method']; distMethod: 'BASEWLM' | 'SERVERWLM'; thresh: string; crit: string; quiesced: string[] };
  const pct = (f: number | null | undefined) => (f != null ? String(Math.round(f * 100)) : '');
  const frac = (v: string) => (v.trim() === '' ? null : num(v) / 100);
  const bad = (v: string) => v.trim() !== '' && !(num(v) > 0 && num(v) <= 100);
  const { s: f, update, drafted, error } = useDraftForm<Form>(
    desk,
    `SET_ROUTING_POLICY:${workloadId}`,
    `${workloadId} routing policy`,
    (d) => {
      const p = d?.kind === 'SET_ROUTING_POLICY' ? d.policy : current;
      const cpsm = p.method === 'CPSM_GOAL' ? p : null;
      return { method: p.method, distMethod: p.method === 'WLM' ? p.distMethod : 'SERVERWLM', thresh: pct(cpsm?.abendThreshFrac), crit: pct(cpsm?.abendCritFrac), quiesced: cpsm?.quiesced ?? [] };
    },
    (f) => {
      const policy: RoutingPolicy =
        f.method === 'STATIC'
          ? { method: f.method }
          : f.method === 'WLM'
            ? { method: f.method, distMethod: f.distMethod }
            : { method: f.method, abendThreshFrac: frac(f.thresh), abendCritFrac: frac(f.crit), quiesced: [...f.quiesced].sort() };
      const error =
        f.method === 'CPSM_GOAL' && (bad(f.thresh) || bad(f.crit)) ? 'Abend limits are 1–100%' : f.method === 'CPSM_GOAL' && f.quiesced.length >= lpars.length ? 'Leave at least one region open' : null;
      return { cmd: JSON.stringify(policy) === JSON.stringify(current) ? null : { kind: 'SET_ROUTING_POLICY', workloadId, policy }, error };
    },
  );
  return (
    <div className={drafted ? 'form drafted-form' : 'form'}>
      <select aria-label="Routing method" value={f.method} onChange={(e) => update({ ...f, method: e.target.value as RoutingPolicy['method'] })}>
        <option value="STATIC">Static weights</option>
        <option value="WLM">WLM weights (Sysplex Distributor)</option>
        <option value="CPSM_GOAL">CPSM goal routing</option>
      </select>
      {f.method === 'WLM' && (
        <select aria-label="DISTMETHOD" value={f.distMethod} onChange={(e) => update({ ...f, distMethod: e.target.value as 'BASEWLM' | 'SERVERWLM' })}>
          <option value="BASEWLM">BASEWLM (system CP capacity)</option>
          <option value="SERVERWLM">SERVERWLM (server, CP + zIIP)</option>
        </select>
      )}
      {f.method === 'CPSM_GOAL' && (
        <>
          <label>
            ABENDTHRESH <input value={f.thresh} onChange={(e) => update({ ...f, thresh: e.target.value })} size={3} inputMode="numeric" placeholder="off" />%
          </label>
          <label>
            ABENDCRIT <input value={f.crit} onChange={(e) => update({ ...f, crit: e.target.value })} size={3} inputMode="numeric" placeholder="off" />%
          </label>
          {lpars.map((l) => (
            <label key={l}>
              <input type="checkbox" checked={f.quiesced.includes(l)} onChange={(e) => update({ ...f, quiesced: e.target.checked ? [...f.quiesced, l] : f.quiesced.filter((x) => x !== l) })} /> quiesce {l}
            </label>
          ))}
        </>
      )}
      {drafted ? <Was>{routingPolicyLabel(current)}</Was> : <Now>{routingPolicyLabel(current)}</Now>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

function RoutingEditor({ desk, workloadId, current }: { desk: Desk; workloadId: string; current: Record<string, number> }) {
  const lpars = Object.keys(current).sort();
  const pct = (r: Record<string, number>) => Object.fromEntries(lpars.map((l) => [l, String(Math.round((r[l] ?? 0) * 100))]));
  const { s: vals, update, drafted, error } = useDraftForm<Record<string, string>>(
    desk,
    `SET_ROUTING:${workloadId}`,
    `${workloadId} routing`,
    (d) => pct(d?.kind === 'SET_ROUTING' ? d.routing : current),
    (vals) => {
      const routing = Object.fromEntries(lpars.map((l) => [l, num(vals[l] ?? '') / 100]));
      const same = lpars.every((l) => Math.round(routing[l]! * 100) === Math.round(current[l]! * 100));
      return { cmd: same ? null : { kind: 'SET_ROUTING', workloadId, routing }, error: validateRouting(routing) };
    },
  );
  return (
    <div className={drafted ? 'form drafted-form' : 'form'}>
      {lpars.map((l) => (
        <label key={l}>
          {l} <input aria-label={`${workloadId} share on ${l}`} value={vals[l]} onChange={(e) => update({ ...vals, [l]: e.target.value })} size={3} inputMode="numeric" />%
        </label>
      ))}
      {drafted ? <Was>{lpars.map((l) => `${Math.round(current[l]! * 100)}%`).join(' / ')}</Was> : <Now>{lpars.map((l) => `${Math.round(current[l]! * 100)}%`).join(' / ')}</Now>}
      {error && <span className="err">{error}</span>}
    </div>
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
  type Form = { mode: 'JES' | 'WLM'; inits: Record<string, string> };
  const nowText = `${j.mode} ${Object.keys(j.initiators)
    .sort()
    .map((k) => `${k}:${j.initiators[k]}`)
    .join(' ')}`;
  const { s: f, update, drafted, error } = useDraftForm<Form>(
    desk,
    `SET_JOB_CLASS:${jobClass}`,
    `Class ${jobClass}`,
    (d) => {
      const mode = (d?.kind === 'SET_JOB_CLASS' ? d.mode : undefined) ?? j.mode;
      const initiators = (d?.kind === 'SET_JOB_CLASS' ? d.initiators : undefined) ?? j.initiators;
      return { mode, inits: Object.fromEntries(lpars.map((l) => [l, String(initiators[l] ?? 0)])) };
    },
    (f) => {
      const initiators = Object.fromEntries(lpars.map((l) => [l, num(f.inits[l] ?? '')]).filter(([, n]) => (n as number) > 0)) as Record<string, number>;
      const bad = lpars.some((l) => {
        const n = num(f.inits[l] ?? '');
        return !(Number.isInteger(n) && n >= 0 && n <= 99);
      });
      const error = bad ? 'Initiators are 0–99 per system' : Object.keys(initiators).length === 0 ? 'At least one system needs initiators' : null;
      const same = f.mode === j.mode && lpars.every((l) => (initiators[l] ?? 0) === (j.initiators[l] ?? 0));
      return { cmd: same ? null : { kind: 'SET_JOB_CLASS', jobClass, mode: f.mode, initiators }, error };
    },
  );
  return (
    <div className={drafted ? 'form drafted-form' : 'form'}>
      <select aria-label="Initiator mode" value={f.mode} onChange={(e) => update({ ...f, mode: e.target.value as 'JES' | 'WLM' })}>
        <option value="JES">JES-managed</option>
        <option value="WLM">WLM-managed</option>
      </select>
      {lpars.map((l) => (
        <label key={l}>
          {l} <input aria-label={`Class ${jobClass} initiators on ${l}`} value={f.inits[l]} onChange={(e) => update({ ...f, inits: { ...f.inits, [l]: e.target.value } })} size={2} inputMode="numeric" />
        </label>
      ))}
      {drafted ? <Was>{nowText}</Was> : <Now>{nowText}</Now>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

function Hardware({ v, game }: { v: ViewModel; game: GameHandle }) {
  const cpcs = v.previewCtx.cpcs ?? [];
  const [cpcId, setCpcId] = useState(cpcs[0]?.id ?? '');
  return (
    <>
      {cpcs.length > 1 && (
        <div className="row">
          <span>Engines, memory and capacity go on</span>
          <select value={cpcId} onChange={(e) => setCpcId(e.target.value)}>
            {cpcs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} ({c.generation}, setting {c.capacitySetting})
              </option>
            ))}
          </select>
        </div>
      )}
      {HARDWARE.map((h) => {
        const target = h.perCpc && cpcs.length > 1 ? cpcId : undefined;
        const p = preview(v, { hardwareId: h.id, ...(target ? { cpcId: target } : {}) });
        const label = target ? `${h.name} on ${target}` : h.name;
        return (
          <div className="row" key={h.id}>
            <span>
              {label}
              <div className="muted" style={{ fontSize: 12 }}>
                {h.description} {p.leadDays > 0 ? `Lead time ${p.leadDays} days.` : 'Immediate.'}
                {h.opexPerDay > 0 ? ` $${Math.round(h.opexPerDay / 1000)}k/day while active.` : ''}
              </div>
              {p.reason && <div className="err">{p.reason}</div>}
            </span>
            <button disabled={!p.ok} title={p.reason ?? costText(p)} onClick={() => game.send({ type: 'CHANGE', req: { label, hardwareId: h.id, ...(target ? { cpcId: target } : {}) } })}>
              {p.capex > 0 ? `$${Math.round(p.capex / 1000)}k` : `$${Math.round(h.opexPerDay / 1000)}k/day`} · {p.hours}h
            </button>
          </div>
        );
      })}
    </>
  );
}

/** Multi-day projects: book engineer-hours each briefing for a permanent improvement. */
function Projects({ v, game }: { v: ViewModel; game: GameHandle }) {
  const briefing = v.phase === 'BRIEFING';
  return (
    <>
      <div className="help">Book engineer-hours during the briefing; each project takes several days and has a daily ceiling. Hours spent here are not there for firefighting.</div>
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

function Ops({ desk, game }: { desk: Desk; game: GameHandle }) {
  const { v } = desk;
  const incidentOpen = v.previewCtx.incidentOpen;
  return (
    <>
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
      {FIXES.filter((f) => v.fixIds.includes(f.id)).map((f) => {
        const p = preview(v, { fixId: f.id });
        return (
          <div className="row" key={f.id}>
            <span>
              {f.name}
              <div className="muted" style={{ fontSize: 12 }}>
                {f.description}
                {f.trustCost ? ` Costs ${f.trustCost.amount} ${f.trustCost.facet} trust.` : ''}
                {f.operational ? ' Operator command: no change-board trust cost.' : ''}
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

/** "Manage regions using goals of": how WLM manages the CICS regions that run the transactions. */
function CicsModeToggle({ v, game }: { v: ViewModel; game: GameHandle }) {
  const mode = game.pending ? game.pending.cicsRegionMode : v.cicsRegionMode;
  return (
    <div className="form">
      <span>
        Manage CICS regions using goals of
        <CodexHints ids={['cics-region-mode']} />
      </span>
      <select aria-label="CICS region management" value={mode} onChange={(e) => game.send({ type: 'WLM_EDIT', edit: { op: 'SET_CICS_MODE', mode: e.target.value as 'TRANSACTION' | 'REGION' } })}>
        <option value="TRANSACTION">TRANSACTION</option>
        <option value="REGION">REGION</option>
      </select>
      <span className="muted" style={{ fontSize: 12 }}>
        {mode === 'TRANSACTION'
          ? 'Regions run at the priority the most demanding transaction class they serve needs; less important transactions in the same regions get a free ride.'
          : 'Regions run at their own started-task class priority; transaction goals are only reported, not used to manage the regions.'}
      </span>
    </div>
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
