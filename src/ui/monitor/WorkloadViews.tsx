import { type Mon3Row, type Mon3View } from '../../game/mon3';
import { Empty } from '../Empty';
import { PinButton } from '../Evidence';
import type { GameHandle } from '../useGame';
import { DELAY_COLS, pct } from './shared';

export function Delay({ rows, game }: { rows: Mon3Row[]; game: GameHandle | null }) {
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
          <th className="num">IDL %</th>
          <th className="num">UKN %</th>
          {DELAY_COLS.map((c) => (
            <th className="num" key={c.label}>
              {c.label}
            </th>
          ))}
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
            <td className="num" title="Idle state is not modelled"></td>
            <td className="num">
              {pct(r.unknownFrac)}
              {r.unknownFrac > 0.005 && <PinButton game={game} req={{ source: 'MON3', system: r.system, scKey: r.scKey, metric: 'DELAY_OTHER' }} label={`${r.scKey} UKN`} />}
            </td>
            {DELAY_COLS.map((c) => (
              <td className="num" key={c.label}>
                {pct(c.parts.reduce((a, [k]) => a + r.delay[k], 0))}
                {c.parts.map(([k, metric, name]) => r.delay[k] > 0.005 && <PinButton key={k} game={game} req={{ source: 'MON3', system: r.system, scKey: r.scKey, metric }} label={`${r.scKey} ${name} delay`} />)}
              </td>
            ))}
            <td>
              {r.primaryReason ?? ''}
              {r.primaryDelay === 'CAP' && <PinButton game={game} req={{ source: 'MON3', system: r.system, scKey: r.scKey, metric: 'DELAY_CAP' }} label={`${r.scKey} capping delay`} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Procu({ rows, game }: { rows: Mon3Row[]; game: GameHandle | null }) {
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

export function Enclave({ m, system }: { m: Mon3View; system: string }) {
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

/** SYSWKM Work Manager Delays (RMF Report Analysis p.204–207): one block per CICS transaction class period. */
export function Wkm({ m, game }: { m: Mon3View; game: GameHandle | null }) {
  const list = m.wkm ?? [];
  if (list.length === 0) return <Empty>No transaction class has work manager data (CICS regions managed as REGION report response times to report classes only).</Empty>;
  const f = (x: number | null) => (x === null ? '-' : x.toFixed(0));
  return (
    <>
      {list.map((w) => (
        <div key={w.scKey} style={{ marginBottom: '1em' }}>
          <div>
            <b>Class: {w.serviceClass}</b> Period: {w.period} · Goal: {w.goal} · Avg. Resp. time: {w.avgRtMs === null ? '-' : `${w.avgRtMs.toFixed(0)} ms`} · {w.endedPerSec.toFixed(1)} TRX/s · PI {w.pi === null ? '-' : w.pi.toFixed(1)}
          </div>
          <table>
            <thead>
              <tr>
                <th>Sub P</th>
                <th className="num" title="Running in the region, from CICS's point of view (SUB and APPL combined)">ACTIVE</th>
                <th className="num" title="Dispatchable but CICS ran another task first">READY</th>
                <th className="num" title="Not modelled">IDLE</th>
                <th className="num">LOCK</th>
                <th className="num">I/O</th>
                <th className="num" title="Not modelled">CONV</th>
                <th className="num" title="Waiting for another product (Db2, MQ, a slow server)">PROD</th>
                <th className="num">MISC</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>CICS EXE</td>
                <td className="num">{f(w.states.active)}</td>
                <td className="num">{f(w.states.ready)}</td>
                <td className="num">{f(w.states.idle)}</td>
                <td className="num">{f(w.states.lock)}</td>
                <td className="num">{f(w.states.io)}</td>
                <td className="num">{f(w.states.conv)}</td>
                <td className="num">{f(w.states.prod)}</td>
                <td className="num">{f(w.states.misc)}</td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th colSpan={10}>Address Spaces Serving this Service Class</th>
              </tr>
              <tr>
                <th>Jobname</th>
                <th>M</th>
                <th>System</th>
                <th>Service Class</th>
                <th className="num">Service %</th>
                <th className="num">Veloc</th>
                <th className="num">Proc-Usg</th>
                <th className="num">I/O-Usg</th>
                <th className="num">Capp</th>
                <th className="num" title="Operator quiesce is not modelled">Quies</th>
              </tr>
            </thead>
            <tbody>
              {w.servers.map((s) => (
                <tr key={`${s.system}|${s.jobname}`}>
                  <td>{s.jobname}</td>
                  <td title={`Managed as ${s.mgmt}`}>{s.mgmt === 'TRANSACTION' ? 'T' : s.mgmt === 'REGION' ? 'R' : 'B'}</td>
                  <td>{s.system}</td>
                  <td>{s.serviceClass}</td>
                  <td className="num">{s.servicePct.toFixed(0)}</td>
                  <td className="num">
                    {f(s.velocity)}
                    {s.rowKey && <PinButton game={game} req={{ source: 'MON3', system: s.system, scKey: s.rowKey, metric: 'DELAY_CPU' }} label={`${s.rowKey} CPU delay on ${s.system}`} />}
                  </td>
                  <td className="num">{s.procUsgPct.toFixed(0)}</td>
                  <td className="num">{s.ioUsgPct.toFixed(0)}</td>
                  <td className="num">
                    {s.cappPct.toFixed(0)}
                    {s.rowKey && s.cappPct > 0.5 && <PinButton game={game} req={{ source: 'MON3', system: s.system, scKey: s.rowKey, metric: 'DELAY_CAP' }} label={`${s.rowKey} capping delay on ${s.system}`} />}
                  </td>
                  <td className="num">{s.quiescePct.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
