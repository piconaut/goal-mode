import { useEffect, useState } from 'react';
import { nightClock, type BatchNight } from '../game/smf';
import { SMF_FEATURE } from '../game/tools';
import type { ViewModel } from '../game/view';
import type { SmfKind } from '../worker/protocol';
import { PinButton } from './Evidence';
import type { GameHandle } from './useGame';

const KINDS: { kind: SmfKind; label: string; help: string }[] = [
  { kind: 'DB2', label: 'Db2 accounting (101)', help: 'Per package: class 1 elapsed, CPU per transaction vs its healthy baseline, class 3 suspensions (lock, sync I/O, CF), and DBAT queueing.' },
  { kind: 'CICS', label: 'CICS monitoring (110)', help: 'Per transaction: CPU vs baseline, QR TCB wait (non-threadsafe code), MXT wait, CPU dispatch wait.' },
  { kind: 'BATCH', label: 'Batch (SMF 30)', help: 'Last night’s jobs: initiator queue time (grey) and elapsed (bar), critical jobs highlighted.' },
  { kind: 'SMF113', label: 'CPU MF (113)', help: 'Hardware counters per image: L1 misses, Relative Nest Intensity, cycles per instruction, LSPR category. Work on VM/VL engines loses cache affinity.' },
];

const f1 = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
const ratio = (r: number | null) =>
  r === null ? <span className="muted">-</span> : <span className={r > 1.5 ? 'err' : r > 1.15 ? '' : 'muted'} style={r > 1.15 && r <= 1.5 ? { color: 'var(--warn)' } : undefined}>×{r.toFixed(2)}</span>;

/** SMF-based deep data (tier 2 tools). */
export function Smf({ v, game }: { v: ViewModel; game: GameHandle }) {
  const owned = KINDS.filter((k) => v.features.includes(SMF_FEATURE[k.kind]));
  const [kind, setKind] = useState<SmfKind | null>(null);
  const [hour, setHour] = useState('');
  const k = kind && owned.some((o) => o.kind === kind) ? kind : (owned[0]?.kind ?? null);
  const h = hour && v.smfHours.some((x) => x.key === hour) ? hour : (v.smfHours[0]?.key ?? '');
  const refresh = Math.floor(v.tickOfDay / 30);
  useEffect(() => {
    if (k) game.send({ type: 'GET_SMF', kind: k, hour: h });
  }, [k, h, refresh, game]);
  if (owned.length === 0)
    return (
      <div className="panel" style={{ marginTop: 12 }}>
        <h3>SMF analytics</h3>
        <div className="muted">Db2 accounting, CICS monitoring, batch job analytics and CPU MF counters are tier-2 tools on the Analytics tab.</div>
      </div>
    );
  const d = game.smf && game.smf.kind === k ? game.smf : null;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>SMF analytics</h3>
      <div className="form">
        {owned.map((o) => (
          <button key={o.kind} className={k === o.kind ? 'active' : ''} onClick={() => setKind(o.kind)}>
            {o.label}
          </button>
        ))}
        {(k === 'DB2' || k === 'CICS') && (
          <select aria-label="Hour" value={h} onChange={(e) => setHour(e.target.value)}>
            {v.smfHours.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="help">{KINDS.find((x) => x.kind === k)?.help}</div>
      <div style={{ overflowX: 'auto' }}>
        {!d && <div className="muted">Loading…</div>}
        {d?.kind === 'DB2' &&
          (d.rows.length === 0 ? (
            <div className="muted">No Db2 work in this hour.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Conn</th>
                  <th className="num">txn/s</th>
                  <th className="num">class 1 ms</th>
                  <th className="num">CPU ms</th>
                  <th className="num">vs base</th>
                  <th className="num">lock ms</th>
                  <th className="num">sync I/O ms</th>
                  <th className="num">CF ms</th>
                  <th className="num">not acct ms</th>
                  <th className="num">DBAT queue ms</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.workloadId}>
                    <td>
                      {r.package} <span className="muted">({r.workloadId})</span>
                    </td>
                    <td>{r.connType}</td>
                    <td className="num">{f1(r.txnPerSec)}</td>
                    <td className="num">{f1(r.class1Ms)}</td>
                    <td className="num">{f1(r.cpuMs)}</td>
                    <td className="num">
                      {ratio(r.cpuVsBaseline)}
                      {r.cpuVsBaseline !== null && <PinButton game={game} req={{ source: 'DB2', hour: h, workloadId: r.workloadId, metric: 'CPU_VS_BASE' }} label={`${r.package} CPU vs baseline`} />}
                    </td>
                    <td className="num">
                      {f1(r.lockMs)}
                      <PinButton game={game} req={{ source: 'DB2', hour: h, workloadId: r.workloadId, metric: 'LOCK_WAIT' }} label={`${r.package} lock wait`} />
                    </td>
                    <td className="num">
                      {f1(r.syncIoMs)}
                      <PinButton game={game} req={{ source: 'DB2', hour: h, workloadId: r.workloadId, metric: 'SYNC_IO' }} label={`${r.package} sync I/O`} />
                    </td>
                    <td className="num">
                      {f1(r.cfMs)}
                      <PinButton game={game} req={{ source: 'DB2', hour: h, workloadId: r.workloadId, metric: 'CF_WAIT' }} label={`${r.package} CF time`} />
                    </td>
                    <td className="num">{f1(r.notAccountedMs)}</td>
                    <td className="num">
                      {f1(r.dbatQueueMs)}
                      {r.connType === 'DDF' && <PinButton game={game} req={{ source: 'DB2', hour: h, workloadId: r.workloadId, metric: 'DBAT_QUEUE' }} label={`${r.package} DBAT queue`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {d?.kind === 'CICS' &&
          (d.rows.length === 0 ? (
            <div className="muted">No CICS work in this hour.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tran</th>
                  <th className="num">txn/s</th>
                  <th className="num">resp ms</th>
                  <th className="num">CPU ms</th>
                  <th className="num">vs base</th>
                  <th className="num">QR wait ms</th>
                  <th className="num">MXT wait ms</th>
                  <th className="num">dispatch wait ms</th>
                  <th className="num">failed</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.workloadId}>
                    <td>
                      {r.tranId}* <span className="muted">({r.workloadId})</span>
                    </td>
                    <td className="num">{f1(r.txnPerSec)}</td>
                    <td className="num">{f1(r.avgRtMs)}</td>
                    <td className="num">{f1(r.cpuMs)}</td>
                    <td className="num">
                      {ratio(r.cpuVsBaseline)}
                      {r.cpuVsBaseline !== null && <PinButton game={game} req={{ source: 'CICS', hour: h, workloadId: r.workloadId, metric: 'CPU_VS_BASE' }} label={`${r.tranId} CPU vs baseline`} />}
                    </td>
                    <td className="num">
                      {f1(r.qrWaitMs)}
                      <PinButton game={game} req={{ source: 'CICS', hour: h, workloadId: r.workloadId, metric: 'QR_WAIT' }} label={`${r.tranId} QR wait`} />
                    </td>
                    <td className="num">
                      {f1(r.mxtWaitMs)}
                      <PinButton game={game} req={{ source: 'CICS', hour: h, workloadId: r.workloadId, metric: 'MXT_WAIT' }} label={`${r.tranId} MXT wait`} />
                    </td>
                    <td className="num">{f1(r.dispatchWaitMs)}</td>
                    <td className="num">{Math.round(r.failed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {d?.kind === 'BATCH' && (d.night ? <Gantt n={d.night} /> : <div className="muted">No batch has run yet.</div>)}
        {d?.kind === 'SMF113' && (
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th className="num">L1MP %</th>
                <th className="num">RNI</th>
                <th className="num">CPI</th>
                <th>LSPR category</th>
                <th className="num">on VM/VL %</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.lparId}>
                  <td>{r.lparId}</td>
                  <td className="num">{r.l1mpPct.toFixed(1)}</td>
                  <td className="num">{r.rni.toFixed(2)}</td>
                  <td className="num">{r.cpi.toFixed(2)}</td>
                  <td>{r.lspr}</td>
                  <td className="num">{(r.nonVhFrac * 100).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Gantt({ n }: { n: BatchNight }) {
  const [stream, setStream] = useState('');
  const streams = [...new Set(n.jobs.map((j) => j.stream))].sort();
  const jobs = n.jobs.filter((j) => !stream || j.stream === stream);
  if (jobs.length === 0) return <div className="muted">No jobs.</div>;
  const t0 = Math.min(...jobs.map((j) => j.queuedAtSec));
  const t1 = Math.max(...jobs.map((j) => j.endSec));
  const span = Math.max(60, t1 - t0);
  const x = (s: number) => `${(100 * (s - t0)) / span}%`;
  const w = (a: number, b: number) => `${Math.max(0.3, (100 * (b - a)) / span)}%`;
  return (
    <>
      <div className="form">
        <select aria-label="Stream" value={stream} onChange={(e) => setStream(e.target.value)}>
          <option value="">all streams ({n.jobs.length} jobs)</option>
          {streams.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="muted" style={{ fontSize: 12 }}>
          Night of day {n.day + 1}: {nightClock(n, t0)}–{nightClock(n, t1)}
          {n.criticalEnd ? ` · last critical job ${n.criticalEnd}` : ''}
        </span>
      </div>
      <div className="gantt">
        {jobs.map((j) => (
          <div className="gantt-row" key={`${j.name}:${j.startSec}`} title={`${j.name} (${j.stream}) on ${j.lparId}: queued ${Math.round(j.queuedSec / 60)} min, ran ${nightClock(n, j.startSec)}–${nightClock(n, j.endSec)}, stretch ×${j.stretch.toFixed(2)}`}>
            <span className="gantt-name">
              {j.name}
              {j.critical && <span className="tag bad"> C</span>}
            </span>
            <span className="gantt-track">
              <span className="gantt-queue" style={{ left: x(j.queuedAtSec), width: w(j.queuedAtSec, j.startSec) }} />
              <span className={`gantt-run ${j.critical ? 'crit' : ''}`} style={{ left: x(j.startSec), width: w(j.startSec, j.endSec) }} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
