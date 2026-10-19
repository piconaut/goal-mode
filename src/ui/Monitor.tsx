import { useState } from 'react';
import type { EvidenceMetric } from '../content/evidence';
import { explainWlmLog, type Mon3Row, type Mon3View } from '../game/mon3';
import type { ViewModel } from '../game/view';
import { piColor } from './App';
import { EvidenceBoard, PinButton } from './Evidence';
import { Mon3Charts } from './Mon3Charts';
import type { GameHandle } from './useGame';

type View3 = 'SYSINFO' | 'DELAY' | 'PROCU' | 'ENCLAVE' | 'CPC' | 'WFEX' | 'WLM';
const VIEWS: { id: View3; help: string }[] = [
  { id: 'SYSINFO', help: 'Per system: busy, then each service-class period with goal, actual and PI.' },
  { id: 'DELAY', help: 'Who is waiting, and for what: delay % of all samples, split by reason. Response-time work spends much of its time in subsystems (Db2, CF, locks, CICS), which shows as other/UNK; that is normal when the PI is fine. Look for what changed.' },
  { id: 'PROCU', help: 'Top CPU consumers by service-class period (APPL%: 100 = one engine).' },
  { id: 'ENCLAVE', help: 'DDF work runs as enclaves: where each DDF workload lands, and its zIIP vs CP use.' },
  { id: 'CPC', help: 'PR/SM view: weights, logical engines, polarity, PR/SM delay and overhead per LPAR.' },
  { id: 'WFEX', help: 'Exceptions worth a look right now.' },
  { id: 'WLM', help: 'WLM policy adjustment decisions, newest first. Hover a line for an explanation.' },
];

const pct = (f: number) => (f * 100).toFixed(0);
const DELAY_PINS: [keyof Mon3Row['delay'], EvidenceMetric][] = [
  ['cpu', 'DELAY_CPU'],
  ['ziip', 'DELAY_ZIIP'],
  ['io', 'DELAY_IO'],
  ['cap', 'DELAY_CAP'],
  ['other', 'DELAY_OTHER'],
];
const ms = (x: number | null) => (x === null ? '-' : x < 10_000 ? x.toFixed(0) : '∞');
const piCell = (pi: number | null) => <td className="num" style={{ background: piColor(pi) }}>{pi === null ? '-' : pi.toFixed(2)}</td>;

/** RMF Monitor III live views (unlocked by the Monitor III tool). */
export function Monitor({ v, game }: { v: ViewModel; game: GameHandle }) {
  const [view, setView] = useState<View3>('SYSINFO');
  const [system, setSystem] = useState('*PLEX');
  const m = v.mon3;
  if (!m)
    return (
      <div className="panel">
        <h3>RMF Monitor III</h3>
        <div className="muted">Live views need the RMF Monitor III tool (Analytics tab). Until then you diagnose from yesterday's Postprocessor reports.</div>
      </div>
    );
  const systems = ['*PLEX', ...m.systems.map((s) => s.system)];
  return (
    <>
    <div className="panel">
      <h3>
        RMF Monitor III · {v.clock} · range ≈ {m.rangeSec} s
      </h3>
      <div className="form">
        {VIEWS.map((x) => (
          <button key={x.id} className={view === x.id ? 'active' : ''} onClick={() => setView(x.id)}>
            {x.id}
            {x.id === 'WFEX' && m.exceptions.length > 0 ? ` (${m.exceptions.length})` : ''}
          </button>
        ))}
        {(view === 'SYSINFO' || view === 'DELAY' || view === 'PROCU') && (
          <select aria-label="System" value={system} onChange={(e) => setSystem(e.target.value)}>
            {systems.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
      </div>
      <div className="help">{VIEWS.find((x) => x.id === view)!.help}</div>
      <div style={{ overflowX: 'auto' }}>
        {view === 'SYSINFO' && <SysInfo m={m} system={system} game={game} />}
        {view === 'DELAY' && <Delay rows={m.rows.filter((r) => r.system === system)} game={game} />}
        {view === 'PROCU' && <Procu rows={m.rows.filter((r) => r.system === system)} game={game} />}
        {view === 'ENCLAVE' && <Enclave m={m} />}
        {view === 'CPC' && <Cpc m={m} game={game} />}
        {view === 'WFEX' && <Wfex m={m} />}
        {view === 'WLM' && <WlmLog lines={v.wlmLog} />}
      </div>
    </div>
    <Mon3Charts v={v} game={game} />
    <EvidenceBoard v={v} game={game} />
    </>
  );
}

function SysInfo({ m, system, game }: { m: Mon3View; system: string; game: GameHandle }) {
  const sys = m.systems.filter((s) => system === '*PLEX' || s.system === system);
  const rows = m.rows.filter((r) => r.system === system);
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>System</th>
            <th className="num">CP busy %</th>
            <th className="num">zIIP busy %</th>
            <th className="num">MSU</th>
            <th className="num">worst PI</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sys.map((s) => (
            <tr key={s.system}>
              <td>{s.system}</td>
              <td className="num">{s.cpBusyPct.toFixed(0)}</td>
              <td className="num">{s.ziipBusyPct === null ? '-' : s.ziipBusyPct.toFixed(0)}</td>
              <td className="num">{s.msu.toFixed(0)}</td>
              {piCell(s.worstPi)}
              <td>{s.capped && <span className="tag bad">CAPPED</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Period</th>
            <th>Goal</th>
            <th className="num">imp</th>
            <th className="num">actual vel %</th>
            <th className="num">avg RT ms</th>
            <th className="num">ended/s</th>
            <th className="num">PI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.scKey}>
              <td>{r.scKey}</td>
              <td className="muted" style={{ fontSize: 12 }}>{r.goal}</td>
              <td className="num">{r.importance ?? '-'}</td>
              <td className="num">{r.velocity === null ? '-' : r.velocity.toFixed(0)}</td>
              <td className="num">{ms(r.avgRtMs)}</td>
              <td className="num">{r.endedPerSec >= 10 ? r.endedPerSec.toFixed(0) : r.endedPerSec.toFixed(2)}</td>
              <td className="num" style={{ background: piColor(r.pi) }}>
                {r.pi === null ? '-' : r.pi.toFixed(2)}
                {r.pi !== null && <PinButton game={game} req={{ source: 'MON3', system, scKey: r.scKey, metric: 'PI' }} label={`${r.scKey} PI`} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Delay({ rows, game }: { rows: Mon3Row[]; game: GameHandle }) {
  const top = [...rows].filter((r) => r.delayFrac > 0.005).sort((a, b) => b.delayFrac - a.delayFrac || (a.scKey < b.scKey ? -1 : 1));
  if (top.length === 0) return <div className="muted">Nobody is waiting.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Period</th>
          <th className="num">DLY %</th>
          <th className="num">CPU</th>
          <th className="num">zIIP</th>
          <th className="num">I/O</th>
          <th className="num">CAP</th>
          <th className="num">other/UNK</th>
          <th>primary reason</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.scKey}>
            <td>{r.scKey}</td>
            <td className="num">{pct(r.delayFrac)}</td>
            {DELAY_PINS.map(([k, metric]) => (
              <td className="num" key={k}>
                {pct(r.delay[k])}
                {r.delay[k] > 0.005 && <PinButton game={game} req={{ source: 'MON3', system: r.system, scKey: r.scKey, metric }} label={`${r.scKey} ${k} delay`} />}
              </td>
            ))}
            <td>{r.primaryDelay ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Procu({ rows, game }: { rows: Mon3Row[]; game: GameHandle }) {
  const top = [...rows].filter((r) => r.cpuEngines > 0.001).sort((a, b) => b.cpuEngines - a.cpuEngines || (a.scKey < b.scKey ? -1 : 1));
  const total = top.reduce((a, r) => a + r.cpuEngines, 0);
  return (
    <table>
      <thead>
        <tr>
          <th>Period</th>
          <th className="num">APPL %</th>
          <th className="num">share</th>
          <th>imp</th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => (
          <tr key={r.scKey}>
            <td>{r.scKey}</td>
            <td className="num">
              {(r.cpuEngines * 100).toFixed(1)}
              <PinButton game={game} req={{ source: 'MON3', system: r.system, scKey: r.scKey, metric: 'APPL' }} label={`${r.scKey} APPL%`} />
            </td>
            <td className="num">{total > 0 ? pct(r.cpuEngines / total) : '-'}%</td>
            <td>{r.importance ?? (r.goal === 'system' ? 'sys' : 'disc')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Enclave({ m }: { m: Mon3View }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Workload</th>
          <th>Period</th>
          <th className="num">ended/s</th>
          <th className="num">avg RT ms</th>
          <th className="num">PI</th>
          <th className="num">CP eng</th>
          <th className="num">zIIP eng</th>
          <th className="num">IIPCP eng</th>
        </tr>
      </thead>
      <tbody>
        {m.enclaves.map((e) => (
          <tr key={`${e.workloadId}:${e.scKey}`}>
            <td>{e.workloadId}</td>
            <td>{e.scKey}</td>
            <td className="num">{e.endedPerSec.toFixed(1)}</td>
            <td className="num">{ms(e.avgRtMs)}</td>
            {piCell(e.pi)}
            <td className="num">{e.cpEngines.toFixed(2)}</td>
            <td className="num">{e.ziipEngines.toFixed(2)}</td>
            <td className="num">{e.iipcpEngines.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cpc({ m, game }: { m: Mon3View; game: GameHandle }) {
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>LPAR</th>
            <th className="num">weight</th>
            <th className="num">logical</th>
            <th>polarity</th>
            <th className="num">busy %</th>
            <th className="num">PR/SM delay %</th>
            <th className="num">overhead %</th>
            <th className="num">capped %</th>
          </tr>
        </thead>
        <tbody>
          {m.cpc.map((c) => (
            <tr key={c.lparId}>
              <td>
                {c.lparId}
                {c.kind === 'CF' && <span className="muted"> CF</span>}
              </td>
              <td className="num">{c.weight}</td>
              <td className="num">{c.logical}</td>
              <td>{c.polarity}</td>
              <td className="num">{c.busyPct.toFixed(0)}</td>
              <td className="num">
                {c.prsmDelayPct.toFixed(1)}
                {c.kind === 'ZOS' && <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'PRSM_DELAY' }} label={`${c.lparId} PR/SM delay`} />}
              </td>
              <td className="num">{c.overheadPct.toFixed(1)}</td>
              <td className="num">
                {c.cappedPct.toFixed(0)}
                {c.cappedPct > 0 && <PinButton game={game} req={{ source: 'CPC', lparId: c.lparId, metric: 'CAPPED' }} label={`${c.lparId} capped`} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={m.logicalToPhysical > 2 ? 'err' : 'muted'} style={{ fontSize: 12, marginTop: 4 }}>
        Logical:physical (shared z/OS CPs) {m.logicalToPhysical.toFixed(2)}:1{m.logicalToPhysical > 2 ? ', above the 2:1 rule of thumb' : ''}
      </div>
    </>
  );
}

function Wfex({ m }: { m: Mon3View }) {
  if (m.exceptions.length === 0) return <div className="muted">No exceptions.</div>;
  return (
    <table>
      <tbody>
        {m.exceptions.map((e, i) => (
          <tr key={i}>
            <td>
              <span className={`tag ${e.severity === 'crit' ? 'bad' : 'warn'}`}>{e.severity === 'crit' ? 'CRIT' : 'WARN'}</span>
            </td>
            <td>{e.where}</td>
            <td>{e.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WlmLog({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (lines.length === 0) return <div className="muted">No WLM decisions yet.</div>;
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
