import { useState, type ReactNode } from 'react';
import { addToBasket, commandTarget } from '../game/changeDesk';
import type { ViewModel } from '../game/view';
import { cfUsedGb } from '../sim/cf/cf';
import { CodexHints } from './CodexHint';
import { RulesView } from './RulesView';
import { Hardware, Prsm } from './changeDesk/Hardware';
import { Ops, Projects } from './changeDesk/Operations';
import { Board, ChangeRequestBar, PendingBanner, Results } from './changeDesk/Requests';
import { JobClasses, Routing } from './changeDesk/Routing';
import { CicsSection, CouplingFacilities, Dasd, Db2Section, MqSection, Systems } from './changeDesk/Subsystems';
import { PolicySchedule, Wlm } from './changeDesk/Wlm';
import type { Desk } from './changeDesk/shared';
import type { GameHandle } from './useGame';
import { useStored } from './useStored';

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
