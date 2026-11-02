import { type Mon3View } from '../../game/mon3';
import { piColor } from '../App';
import { PinButton } from '../Evidence';
import type { GameHandle } from '../useGame';
import { ms, n1, sameClass } from './shared';

export function SysSum({ m, game }: { m: Mon3View; game: GameHandle | null }) {
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

export function SysInfo({ m, system }: { m: Mon3View; system: string }) {
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
