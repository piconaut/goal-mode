import { useEffect, useState } from 'react';
import { MON3_HISTORY } from '../content/tools';
import type { Mon3HistoryRange } from '../game/mon3History';
import type { ViewModel } from '../game/view';
import { formatClock, tickOfClock } from '../sim/core/clock';
import { TICK_SEC, TICKS_PER_HOUR } from '../sim/core/units';
import { Alerts } from './Alerts';
import { Automation } from './Automation';
import { CodexHints } from './CodexHint';
import { AnalyticsLink, Empty } from './Empty';
import { EvidenceBoard } from './Evidence';
import { Mon3Charts } from './Mon3Charts';
import { Cpc } from './monitor/Cpc';
import { Wfex, WlmLog } from './monitor/Exceptions';
import { SysInfo, SysSum } from './monitor/SystemViews';
import { Delay, Enclave, Procu, Wkm } from './monitor/WorkloadViews';
import type { GameHandle } from './useGame';

type View3 = 'SYSSUM' | 'SYSWKM' | 'SYSINFO' | 'DELAY' | 'PROCU' | 'ENCLAVE' | 'CPC' | 'WFEX' | 'WLM';
// Report contents follow z/OS RMF Report Analysis (SC34-2665), "Interactive performance analysis with Monitor III".
const VIEWS: { id: View3; help: string }[] = [
  { id: 'SYSSUM', help: 'Sysplex Summary: goals versus actuals and the performance index for each service-class period, sysplex-wide. Percentile goals show the % of transactions that ended within the goal time.' },
  { id: 'SYSWKM', help: 'Work Manager Delays: for each CICS transaction class, how its response time splits into work manager states, and the AORs serving it. CICS transactions have no address spaces of their own, so their CPU and delays show on the regions: a low velocity or capping on the serving AORs is where CPU trouble for CICS shows up. AORs on one system share its CICS work in this game, so they show the same figures.' },
  { id: 'SYSINFO', help: 'System Information: CPU utilisation (LPAR view and z/OS view), then per period the workflow, response time, rate and the average number of users using or delayed for each resource.' },
  { id: 'DELAY', help: 'Who is waiting, and for what: USG/DLY/UKN % of active samples, and % Delayed for each resource (PRC covers CPs and zIIPs). DLY % also counts WLM capping, which has no column: Primary Reason shows RG-Cap. Otherwise Primary Reason names the job using the processor most, the LCU, or the paging type. Rows are service-class summaries. Response-time work spends much of its time in subsystems (Db2, CF, locks, CICS), which RMF cannot see and shows as UKN; that is normal when the PI is fine. Look for what changed.' },
  { id: 'PROCU', help: 'Processor Usage: the jobs using a processor, heaviest first. Time on CP % (IIP = zIIP-eligible work that ran on CPs) and EAppl % (enclaves included, so DDF work shows on the Db2 DIST address space). 100 = one engine. Click a service class to list only its jobs; Service classes shows the class totals. The sim keeps CPU per class, so a job\'s share is estimated from its expected load.' },
  { id: 'ENCLAVE', help: 'DDF work runs as enclaves, managed by their own goals: CPU on CPs and zIIPs, and the enclave state samples.' },
  { id: 'CPC', help: 'CPC Capacity: MSU and capping for the partition, then logical and physical utilisation of every partition, with PR/SM delay and capping. Weight and polarity are on the Change Desk and in the Partition Data report.' },
  { id: 'WFEX', help: 'Workflow/Exceptions: speed of the system, processors, devices and each period, and the exceptions your criteria flag right now.' },
  { id: 'WLM', help: 'WLM policy adjustment decisions, newest first. Hover a line for an explanation.' },
];
const SYSTEM_VIEWS: View3[] = ['SYSINFO', 'DELAY', 'PROCU', 'CPC', 'WFEX'];

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
    at === null ? game : past ? { ...game, send: (msg) => game.send(msg.type === 'PIN' && (msg.req.source === 'MON3' || msg.req.source === 'CPC' || msg.req.source === 'PROCU') ? { ...msg, req: { ...msg.req, tick: past.tick } } : msg) } : null;
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
        {view === 'SYSWKM' && <Wkm m={m} game={pins} />}
        {view === 'SYSINFO' && <SysInfo m={m} system={system} />}
        {view === 'DELAY' && <Delay rows={m.rows.filter((r) => r.system === system)} game={pins} />}
        {view === 'PROCU' && <Procu rows={m.rows.filter((r) => r.system === system)} jobs={m.procJobs ? m.procJobs.filter((j) => system === '*PLEX' || j.system === system) : null} game={pins} />}
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

/** Monitor III history: step back through past MINTIME intervals (RMF III's BREF/FREF and range commands).
 * The slider spans up to two days of 2-minute ranges, so one pixel skips several of them: Go to (and ◀/▶, or the
 * arrow keys on the slider) reach every range. */
function TimeBar({ range, at, setAt }: { range: Mon3HistoryRange; at: number | null; setAt: (t: number | null) => void }) {
  const step = range.everyTicks;
  const cur = at ?? range.lastTick;
  const [goto, setGoto] = useState('');
  const [bad, setBad] = useState(false);
  const jump = () => {
    const t = tickOfClock(goto);
    if (t === null || t < range.firstTick) return setBad(true);
    setBad(false);
    // Monitor III shows the range ending at or before the chosen time.
    const snapped = Math.floor(t / step) * step;
    setAt(snapped >= range.lastTick ? null : Math.max(range.firstTick, snapped));
  };
  const rangeText = (end: number) => `${formatClock(end - step).slice(0, -3)}–${formatClock(end).slice(-8, -3)}`;
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
      <label title="Jump to the range ending at a time, e.g. D2 23:30 (the small hours belong to the played day before)">
        Go to{' '}
        <input
          size={9}
          placeholder="D2 23:30"
          aria-invalid={bad}
          value={goto}
          onChange={(e) => (setGoto(e.target.value), setBad(false))}
          onKeyDown={(e) => e.key === 'Enter' && jump()}
        />
      </label>
      <button onClick={jump} disabled={goto.trim() === ''}>
        Go
      </button>
      <span className="muted">
        {at === null ? 'live' : rangeText(at)} · held from {formatClock(range.firstTick).slice(0, -3)} ({range.count} ranges of {(step * TICK_SEC).toFixed(0)} s)
        {bad && <span className="bad"> · not a held time (use D2 23:30)</span>}
      </span>
    </div>
  );
}
