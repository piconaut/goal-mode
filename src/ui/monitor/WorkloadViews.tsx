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
