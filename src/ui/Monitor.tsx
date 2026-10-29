import { useEffect, useState } from 'react';
import { CodexHints } from './CodexHint';
import type { EvidenceMetric } from '../content/evidence';
import { explainWlmLog, type Mon3Cpc, type Mon3Row, type Mon3View } from '../game/mon3';
import type { ViewModel } from '../game/view';
import { piColor } from './App';
import { Alerts } from './Alerts';
import { Automation } from './Automation';
import { EvidenceBoard, PinButton } from './Evidence';
import { Mon3Charts } from './Mon3Charts';
import type { GameHandle } from './useGame';
import { TICKS_PER_HOUR } from '../sim/core/units';
import { formatClock } from '../sim/core/clock';
import { MON3_HISTORY } from '../content/tools';
import type { Mon3HistoryRange } from '../game/mon3History';
import { AnalyticsLink, Empty } from './Empty';

type View3 = 'SYSSUM' | 'SYSINFO' | 'DELAY' | 'PROCU' | 'ENCLAVE' | 'CPC' | 'WFEX' | 'WLM';
// Report contents follow z/OS RMF Report Analysis (SC34-2665), "Interactive performance analysis with Monitor III".
const VIEWS: { id: View3; help: string }[] = [
  { id: 'SYSSUM', help: 'Sysplex Summary: goals versus actuals and the performance index for each service-class period, sysplex-wide. Percentile goals show the % of transactions that ended within the goal time.' },
  { id: 'SYSINFO', help: 'System Information: CPU utilisation (LPAR view and z/OS view), then per period the workflow, response time, rate and the average number of users using or delayed for each resource.' },
  { id: 'DELAY', help: 'Who is waiting, and for what: USG/DLY/UKN % of active samples, and % Delayed for each resource. Response-time work spends much of its time in subsystems (Db2, CF, locks, CICS), which RMF cannot see and shows as UKN; that is normal when the PI is fine. Look for what changed.' },
  { id: 'PROCU', help: 'Processor Usage by service-class period: Time on CP % (IIP = zIIP-eligible work that ran on CPs) and EAppl % (enclaves included). 100 = one engine.' },
  { id: 'ENCLAVE', help: 'DDF work runs as enclaves, managed by their own goals: CPU on CPs and zIIPs, and the enclave state samples.' },
  { id: 'CPC', help: 'CPC Capacity: MSU and capping for the partition, then logical and physical utilisation of every partition. Weight, polarity and PR/SM delay come from the Partition Data view.' },
  { id: 'WFEX', help: 'Workflow/Exceptions: speed of the system, processors, devices and each period, and the exceptions your criteria flag right now.' },
  { id: 'WLM', help: 'WLM policy adjustment decisions, newest first. Hover a line for an explanation.' },
];
const SYSTEM_VIEWS: View3[] = ['SYSINFO', 'DELAY', 'PROCU', 'CPC', 'WFEX'];

const pct = (f: number) => (f * 100).toFixed(0);
const n1 = (x: number) => x.toFixed(1);
const DELAY_PINS: [keyof Mon3Row['delay'], EvidenceMetric][] = [
  ['cpu', 'DELAY_CPU'],
  ['ziip', 'DELAY_ZIIP'],
  ['io', 'DELAY_IO'],
  ['stor', 'DELAY_STO'],
  ['cap', 'DELAY_CAP'],
];
// RMF scales anything above 99999 ms with K/M (SYSINFO RESP Time, SYSSUM).
const ms = (x: number | null) => (x === null ? '-' : x < 100_000 ? x.toFixed(0) : x < 1e8 ? `${(x / 1000).toFixed(0)}K` : `${(x / 1e6).toFixed(0)}M`);
const sameClass = (rows: Mon3Row[], i: number) => i > 0 && rows[i - 1]!.serviceClass === rows[i]!.serviceClass;

/** RMF Monitor III live views (unlocked by the Monitor III tool). */
export function Monitor({ v, game, openAnalytics }: { v: ViewModel; game: GameHandle; openAnalytics: () => void }) {
  const [view, setView] = useState<View3>('SYSSUM');
  const [system, setSystem] = useState('*PLEX');
  /** Tick of the past interval on screen; null = live. */
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (at !== null) game.send({ type: 'GET_MON3_AT', tick: at });
  }, [at, game.send]);
  const past = at === null ? null : game.mon3At;
  const m = at === null ? v.mon3 : (past?.view ?? null);
  // A pin on a past range carries its end tick; the worker reads that range from its history.
  const pins: GameHandle | null =
    at === null ? game : past ? { ...game, send: (msg) => game.send(msg.type === 'PIN' && (msg.req.source === 'MON3' || msg.req.source === 'CPC') ? { ...msg, req: { ...msg.req, tick: past.tick } } : msg) } : null;
  if (!v.mon3)
    return (
      <div className="panel">
        <h3>RMF Monitor III</h3>
        <Empty>
          Live views need the RMF Monitor III tool (<AnalyticsLink open={openAnalytics} />). Until then you diagnose from yesterday's Postprocessor reports.
        </Empty>
      </div>
    );
  const systems = ['*PLEX', ...(m ?? v.mon3).systems.map((s) => s.system)];
  return (
    <>
    {/* Charts (when unlocked) sit above the live views; the locked teaser stays below. */}
    {v.mon3Charts && <Mon3Charts v={v} game={game} openAnalytics={openAnalytics} />}
    <div className="panel">
      <h3>
        RMF Monitor III · {at === null ? v.clock : past ? `${formatClock(past.tick)} (history)` : '…'} · Range: {(m ?? v.mon3).rangeSec} Sec · Policy: {(m ?? v.mon3).policy}
        <CodexHints ids={['rmf', 'blocked-workload']} />
      </h3>
      {game.mon3Range && <TimeBar range={game.mon3Range} at={at} setAt={setAt} />}
      <div className="form">
        {VIEWS.map((x) => (
          <button key={x.id} className={view === x.id ? 'active' : ''} onClick={() => setView(x.id)}>
            {x.id}
            {x.id === 'WFEX' && m && m.exceptions.length > 0 ? ` (${m.exceptions.length})` : ''}
          </button>
        ))}
        {(SYSTEM_VIEWS.includes(view) || view === 'ENCLAVE') && (
          <select aria-label="System" value={system} onChange={(e) => setSystem(e.target.value)}>
            {systems.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
      </div>
      <div className="help">{VIEWS.find((x) => x.id === view)!.help}</div>
      {!m && <div className="muted">That interval is no longer held (Monitor III keeps {MON3_HISTORY.retentionHours} hours).</div>}
      {m && <div style={{ overflowX: 'auto' }}>
        {view === 'SYSSUM' && <SysSum m={m} game={pins} />}
        {view === 'SYSINFO' && <SysInfo m={m} system={system} />}
        {view === 'DELAY' && <Delay rows={m.rows.filter((r) => r.system === system)} game={pins} />}
        {view === 'PROCU' && <Procu rows={m.rows.filter((r) => r.system === system)} game={pins} />}
        {view === 'ENCLAVE' && <Enclave m={m} system={system} />}
        {view === 'CPC' && <Cpc m={m} system={system} game={pins} />}
        {view === 'WFEX' && <Wfex m={m} system={system} />}
        {view === 'WLM' && <WlmLog lines={v.wlmLog} />}
      </div>}
    </div>
    {!v.mon3Charts && <Mon3Charts v={v} game={game} openAnalytics={openAnalytics} />}
    <Alerts v={v} game={game} openAnalytics={openAnalytics} />
    <Automation v={v} game={game} />
    <EvidenceBoard v={v} game={game} />
    </>
  );
}

/** Monitor III history: step back through past MINTIME intervals (RMF III's BREF/FREF and range commands). */
function TimeBar({ range, at, setAt }: { range: Mon3HistoryRange; at: number | null; setAt: (t: number | null) => void }) {
  const step = range.everyTicks;
  const cur = at ?? range.lastTick;
  const back = (n: number) => setAt(Math.max(range.firstTick, (at ?? range.lastTick + step) - n * step));
  const fwd = () => (at === null || at + step > range.lastTick ? setAt(null) : setAt(at + step));
  return (
    <div className="form" aria-label="Monitor III time">
      <button onClick={() => back(Math.round(TICKS_PER_HOUR / step))} disabled={cur <= range.firstTick} title="Back one hour">
        ◀◀
      </button>
      <button onClick={() => back(1)} disabled={cur <= range.firstTick} title="Back one interval (BREF)">
        ◀
      </button>
      <input
        type="range"
        aria-label="Interval"
        min={range.firstTick}
        max={range.lastTick}
        step={step}
        value={cur}
        onChange={(e) => {
          const t = Number(e.target.value);
          setAt(t >= range.lastTick && at === null ? null : t);
        }}
      />
      <button onClick={fwd} disabled={at === null} title="Forward one interval (FREF)">
        ▶
      </button>
      <button className={at === null ? 'active' : ''} onClick={() => setAt(null)}>
        Live
      </button>
      <span className="muted">
        {at === null ? 'live' : formatClock(at)} · held from {formatClock(range.firstTick)} ({range.count} intervals)
      </span>
    </div>
  );
}

function SysSum({ m, game }: { m: Mon3View; game: GameHandle | null }) {
  const rows = m.rows.filter((r) => r.system === '*PLEX');
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>T</th>
          <th>I</th>
          <th className="num">Exec Vel Goal</th>
          <th className="num">Exec Vel Act</th>
          <th className="num" colSpan={2}>Resp Time Goal</th>
          <th className="num">Resp Time Actual</th>
          <th className="num">Perf Indx</th>
          <th className="num">Trans Ended Rate</th>
          <th className="num">Avg Resp Time ms</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.scKey}>
            <td>{sameClass(rows, i) ? '' : r.serviceClass}</td>
            <td>{r.period}</td>
            <td>{r.importance ?? (r.goal === 'DISCRETIONARY' ? 'D' : '')}</td>
            <td className="num">{r.goalVelocity ?? (r.goal === 'system' ? 'N/A' : '')}</td>
            <td className="num">{r.velocityAct === null ? (r.velocity === null ? '' : 'N/A') : r.velocityAct.toFixed(0)}</td>
            <td className="num">{r.goalRtMs === null ? (r.goal === 'system' ? 'N/A' : '') : ms(r.goalRtMs)}</td>
            <td>{r.goalRtMs === null ? '' : r.goalPct === null ? 'AVG' : `${r.goalPct}%`}</td>
            <td className="num">{r.goalRtMs === null ? '' : r.goalPct === null ? `${ms(r.avgRtMs)} AVG` : r.withinGoalPct === null ? '-' : `${r.withinGoalPct.toFixed(0)}%`}</td>
            <td className="num" style={{ background: piColor(r.importance === null ? null : r.pi) }}>
              {r.importance === null || r.pi === null ? '' : r.pi.toFixed(1)}
              {r.importance !== null && r.pi !== null && <PinButton game={game} req={{ source: 'MON3', system: '*PLEX', scKey: r.scKey, metric: 'PI' }} label={`${r.scKey} PI`} />}
            </td>
            <td className="num">{n1(r.endedPerSec)}</td>
            <td className="num">{ms(r.avgRtMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SysInfo({ m, system }: { m: Mon3View; system: string }) {
  const sys = m.systems.filter((s) => system === '*PLEX' || s.system === system);
  const rows = m.rows.filter((r) => r.system === system);
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Partition</th>
            <th className="num">CPs Online</th>
            <th className="num">IIPs Online</th>
            <th className="num">Avg CPU Util%</th>
            <th className="num">Avg MVS Util%</th>
            <th className="num">Appl%</th>
            <th className="num">EAppl%</th>
            <th className="num">Appl% IIP</th>
            <th className="num">MSU</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sys.map((s) => (
            <tr key={s.system}>
              <td>{s.system}</td>
              <td className="num">{n1(s.cpsOnline)}</td>
              <td className="num">{n1(s.iipsOnline)}</td>
              <td className="num">{s.cpBusyPct.toFixed(0)}</td>
              <td className="num">{s.mvsBusyPct.toFixed(0)}</td>
              <td className="num">{s.applPct.toFixed(0)}</td>
              <td className="num">{s.eapplPct.toFixed(0)}</td>
              <td className="num">{s.applIipPct === null ? '-' : s.applIipPct.toFixed(0)}</td>
              <td className="num">{s.msu.toFixed(0)}</td>
              <td>{s.capped && <span className="tag bad">CAPPED</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Group</th>
            <th>T</th>
            <th className="num">WFL %</th>
            <th className="num">Users ACT</th>
            <th className="num">RESP Time ms</th>
            <th className="num">TRANS /SEC</th>
            <th className="num">AVG USG PROC</th>
            <th className="num">DEV</th>
            <th className="num">Avg Delayed PROC</th>
            <th className="num">DEV</th>
            <th className="num">STOR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.scKey}>
              <td>{sameClass(rows, i) ? '' : r.serviceClass}</td>
              <td>{r.period}</td>
              <td className="num">{r.velocity === null ? '' : r.velocity.toFixed(0)}</td>
              <td className="num">{n1(r.avgUsers.active)}</td>
              <td className="num">{ms(r.avgRtMs)}</td>
              <td className="num">{r.endedPerSec >= 10 ? r.endedPerSec.toFixed(0) : r.endedPerSec.toFixed(2)}</td>
              <td className="num">{n1(r.avgUsers.proc)}</td>
              <td className="num">{n1(r.avgUsers.dev)}</td>
              <td className="num">{n1(r.avgUsers.delayProc)}</td>
              <td className="num">{n1(r.avgUsers.delayDev)}</td>
              <td className="num">{n1(r.avgUsers.delayStor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Delay({ rows, game }: { rows: Mon3Row[]; game: GameHandle | null }) {
  const top = [...rows].filter((r) => r.delayFrac + r.unknownFrac > 0.005).sort((a, b) => b.delayFrac - a.delayFrac || (a.scKey < b.scKey ? -1 : 1));
  if (top.length === 0) return <Empty>Nobody is waiting.</Empty>;
  return (
    <table>
      <thead>
        <tr>
          <th>Service Class</th>
          <th className="num">WFL %</th>
          <th className="num">USG %</th>
          <th className="num">DLY %</th>
          <th className="num">UKN %</th>
          <th className="num">PRC CP</th>
          <th className="num">PRC IIP</th>
          <th className="num">DEV</th>
          <th className="num">STR</th>
          <th className="num">CAP</th>
          <th>Primary Reason</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.scKey}>
            <td>{r.scKey}</td>
            <td className="num">{r.velocity === null ? '' : r.velocity.toFixed(0)}</td>
            <td className="num">{pct(r.usingFrac)}</td>
            <td className="num">{pct(r.delayFrac)}</td>
            <td className="num">
              {pct(r.unknownFrac)}
              {r.unknownFrac > 0.005 && <PinButton game={game} req={{ source: 'MON3', system: r.system, scKey: r.scKey, metric: 'DELAY_OTHER' }} label={`${r.scKey} UKN`} />}
            </td>
            {DELAY_PINS.map(([k, metric]) => (
              <td className="num" key={k}>
                {pct(r.delay[k])}
                {r.delay[k] > 0.005 && <PinButton game={game} req={{ source: 'MON3', system: r.system, scKey: r.scKey, metric }} label={`${r.scKey} ${k} delay`} />}
              </td>
            ))}
            <td>{r.primaryDelay ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Procu({ rows, game }: { rows: Mon3Row[]; game: GameHandle | null }) {
  const top = [...rows].filter((r) => r.cpuEngines + r.ziipEngines > 0.001).sort((a, b) => b.cpuEngines - a.cpuEngines || (a.scKey < b.scKey ? -1 : 1));
  const p2 = (engines: number) => (engines * 100).toFixed(1);
  return (
    <table>
      <thead>
        <tr>
          <th>Service Class</th>
          <th className="num">Time on CP % Total</th>
          <th className="num">IIP</th>
          <th className="num">EAppl % CP</th>
          <th className="num">IIP</th>
          <th>imp</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.scKey}>
            <td>{r.scKey}</td>
            <td className="num">{p2(r.cpuEngines)}</td>
            <td className="num">{p2(r.iipcpEngines)}</td>
            <td className="num">
              {p2(r.cpuEngines)}
              <PinButton game={game} req={{ source: 'MON3', system: r.system, scKey: r.scKey, metric: 'APPL' }} label={`${r.scKey} EAppl%`} />
            </td>
            <td className="num">{p2(r.ziipEngines)}</td>
            <td>{r.importance ?? (r.goal === 'system' ? 'sys' : 'disc')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Enclave({ m, system }: { m: Mon3View; system: string }) {
  const s = m.systems.filter((x) => system === '*PLEX' || x.system === system);
  const cps = s.reduce((a, x) => a + x.cpsOnline, 0);
  const appl = cps > 0 ? s.reduce((a, x) => a + x.applPct * x.cpsOnline, 0) / cps : 0;
  const eappl = cps > 0 ? s.reduce((a, x) => a + x.eapplPct * x.cpsOnline, 0) / cps : 0;
  const rows =
    system === '*PLEX'
      ? m.enclaves
      : m.enclaves.flatMap((e) => {
          const r = m.rows.find((x) => x.system === system && x.scKey === e.scKey);
          return r ? [{ ...e, cpEngines: r.cpuEngines, ziipEngines: r.ziipEngines, usingFrac: r.usingFrac, delayFrac: r.delayFrac, unknownFrac: r.unknownFrac }] : [];
        });
  return (
    <>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        Subsystem Type: DDF · CPU Util Appl% {appl.toFixed(1)} · EAppl% {eappl.toFixed(1)}
      </div>
      <table>
        <thead>
          <tr>
            <th>Attribute</th>
            <th>CLS/GRP</th>
            <th>P</th>
            <th>Goal</th>
            <th className="num">EAppl% CP</th>
            <th className="num">zIIP %</th>
            <th className="num">USG</th>
            <th className="num">DLY</th>
            <th className="num">UNK</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.scKey}>
              <td>DDF {e.workloadIds.join(',')}</td>
              <td>{e.serviceClass}</td>
              <td>{e.period}</td>
              <td className="muted" style={{ fontSize: 12 }}>{e.goal}</td>
              <td className="num">{(100 * e.cpEngines).toFixed(1)}</td>
              <td className="num">{(100 * e.ziipEngines).toFixed(1)}</td>
              <td className="num">{pct(e.usingFrac)}</td>
              <td className="num">{pct(e.delayFrac)}</td>
              <td className="num">{pct(e.unknownFrac)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Cpc({ m, system, game }: { m: Mon3View; system: string; game: GameHandle | null }) {
  const ids = [...new Set(m.cpc.map((c) => c.cpcId))];
  if (ids.length <= 1) return <CpcTables m={m} system={system} game={game} cpcId={null} />;
  return (
    <>
      {ids.map((id) => (
        <section key={id} style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 4px' }}>CPC {id}</h4>
          <CpcTables m={m} system={system} game={game} cpcId={id} />
        </section>
      ))}
    </>
  );
}

function CpcTables({ m, system, game, cpcId }: { m: Mon3View; system: string; game: GameHandle | null; cpcId: string | null }) {
  const inCpc = (x: { cpcId: string }) => cpcId === null || x.cpcId === cpcId;
  const heads = m.cpcHeaders.filter((h) => inCpc(h) && (system === '*PLEX' || h.lparId === system));
  const cpcRows = m.cpc.filter(inCpc);
  const zos = cpcRows.filter((c) => c.kind === 'ZOS');
  const ratio = cpcId === null ? m.logicalToPhysical : m.logicalToPhysicalByCpc[cpcId] ?? 0;
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Partition</th>
            <th className="num">CPC Capacity</th>
            <th className="num">Image Capacity</th>
            <th className="num">WLM Capping %</th>
            <th className="num">4h Avg</th>
            <th className="num">4h Max</th>
            <th>Group</th>
            <th className="num">Limit</th>
          </tr>
        </thead>
        <tbody>
          {heads.map((h) => (
            <tr key={h.lparId}>
              <td>{h.lparId}</td>
              <td className="num">{h.cpcCapacityMsu.toFixed(0)}</td>
              <td className="num">{h.imageCapacityMsu.toFixed(0)}</td>
              <td className="num">{n1(h.wlmCappingPct)}</td>
              <td className="num">{h.r4haMsu.toFixed(0)}</td>
              <td className="num">{h.max4hMsu.toFixed(0)}</td>
              <td>{h.group ?? 'N/A'}</td>
              <td className="num">{h.groupLimitMsu ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Partition</th>
            <th className="num">MSU Def</th>
            <th className="num">MSU Act</th>
            <th className="num">Proc Num</th>
            <th className="num">Logical Util % Effect</th>
            <th className="num">Total</th>
            <th className="num">Physical Util % LPAR</th>
            <th className="num">Effect</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {(['ZOS', 'CF'] as const).map((kind) => {
            const part = cpcRows.filter((c) => c.kind === kind);
            if (part.length === 0) return null;
            const sum = (f: (c: Mon3Cpc) => number) => part.reduce((a, c) => a + f(c), 0);
            return [
              <tr key={kind}>
                <td>{kind === 'ZOS' ? '*CP' : '*ICF'}</td>
                <td />
                <td />
                <td className="num">{n1(sum((c) => c.procNum))}</td>
                <td />
                <td />
                <td className="num">{n1(sum((c) => c.physLparPct))}</td>
                <td className="num">{n1(sum((c) => c.physEffectPct))}</td>
                <td className="num">{n1(sum((c) => c.physTotalPct))}</td>
              </tr>,
              ...part.map((c) => (
                <tr key={c.lparId}>
                  <td>{c.lparId}</td>
                  <td className="num">{c.kind === 'CF' ? '' : c.msuDef ?? 'N/A'}</td>
                  <td className="num">{c.msuAct === null ? '' : c.msuAct.toFixed(0)}</td>
                  <td className="num">{n1(c.procNum)}</td>
                  <td className="num">{n1(c.logicalEffectPct)}</td>
                  <td className="num">{n1(c.logicalTotalPct)}</td>
                  <td className="num">{n1(c.physLparPct)}</td>
                  <td className="num">{n1(c.physEffectPct)}</td>
                  <td className="num">{n1(c.physTotalPct)}</td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Partition</th>
            <th className="num">weight</th>
            <th>polarity</th>
            <th className="num" title="Not an RMF field: RMF shows it only indirectly, as Avg MVS Util% above Avg CPU Util% in SYSINFO">PR/SM delay %*</th>
            <th className="num">capped %</th>
          </tr>
        </thead>
        <tbody>
          {zos.map((c) => (
            <tr key={c.lparId}>
              <td>{c.lparId}</td>
              <td className="num">{c.weight}</td>
              <td>{c.polarity}</td>
              <td className="num">
                {c.prsmDelayPct.toFixed(1)}
                <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'PRSM_DELAY' }} label={`${c.lparId} PR/SM delay`} />
              </td>
              <td className="num">
                {c.cappedPct.toFixed(0)}
                {c.cappedPct > 0 && <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'CAPPED' }} label={`${c.lparId} capped`} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={ratio > 2 ? 'err' : 'muted'} style={{ fontSize: 12, marginTop: 4 }}>
        Logical:physical (shared z/OS CPs) {ratio.toFixed(2)}:1{ratio > 2 ? ', above the 2:1 rule of thumb' : ''}. *PR/SM delay is the game's direct reading of the short-engine wait; on a real system you infer it from MVS Util% above CPU Util%.
      </div>
    </>
  );
}

function Wfex({ m, system }: { m: Mon3View; system: string }) {
  const speed = m.speed.filter((s) => system === '*PLEX' || s.system === system);
  return (
    <>
      <table>
        <thead>
          <tr>
            {system === '*PLEX' && <th>System</th>}
            <th>Name</th>
            <th className="num">Active</th>
            <th className="num">Speed</th>
          </tr>
        </thead>
        <tbody>
          {speed.map((s) => (
            <tr key={`${s.system}:${s.name}`}>
              {system === '*PLEX' && <td>{s.system}</td>}
              <td>{s.name}</td>
              <td className="num">{n1(s.activeUsers)}</td>
              <td className="num">{s.speed === null ? 'No work' : s.speed.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.exceptions.length === 0 ? (
        <div className="muted" style={{ marginTop: 8 }}>No exceptions.</div>
      ) : (
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Reason</th>
              <th className="num">Critical val.</th>
              <th>Possible cause or action</th>
            </tr>
          </thead>
          <tbody>
            {m.exceptions.map((e, i) => (
              <tr key={i}>
                <td>
                  <span className={`tag ${e.severity === 'crit' ? 'bad' : 'warn'}`}>{e.severity === 'crit' ? 'RED' : 'YEL'}</span>
                </td>
                <td>{e.where}</td>
                <td>{e.reason}</td>
                <td className="num">{e.value}</td>
                <td>{e.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function WlmLog({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (lines.length === 0) return <Empty>No WLM decisions yet.</Empty>;
  const rev = [...lines].reverse();
  return (
    <div className="log">
      {rev.map((l, i) => (
        <div key={i} title={explainWlmLog(l)} onClick={() => setOpen(open === i ? null : i)} style={{ cursor: 'pointer' }}>
          {l}
          {open === i && <div className="muted" style={{ whiteSpace: 'normal', margin: '2px 0 6px 12px' }}>{explainWlmLog(l)}</div>}
        </div>
      ))}
    </div>
  );
}
