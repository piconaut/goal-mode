import { useState } from 'react';
import { explainWlmLog, type Mon3View } from '../../game/mon3';
import { Empty } from '../Empty';
import { n1 } from './shared';

export function Wfex({ m, system }: { m: Mon3View; system: string }) {
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

export function WlmLog({ lines }: { lines: string[] }) {
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
