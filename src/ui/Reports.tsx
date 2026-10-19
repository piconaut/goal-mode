import { useEffect, useState } from 'react';
import type { ViewModel } from '../game/view';
import type { ReportKind } from '../worker/protocol';
import type { GameHandle } from './useGame';

const KINDS: { kind: ReportKind; label: string }[] = [
  { kind: 'WLM_SUMMARY', label: 'Workload Activity' },
  { kind: 'WLM_DETAIL', label: 'WLMGL detail' },
  { kind: 'PARTITION', label: 'Partition Data' },
  { kind: 'CF', label: 'CF Activity' },
  { kind: 'DASD', label: 'DASD Activity' },
];

export function Reports({ v, game }: { v: ViewModel; game: GameHandle }) {
  const [idx, setIdx] = useState<number | null>(null);
  const [kind, setKind] = useState<ReportKind>('WLM_SUMMARY');
  const [system, setSystem] = useState('*PLEX');
  const [scKey, setScKey] = useState('ONLHI#1');
  const last = v.reports[v.reports.length - 1]?.index ?? null;
  const sel = idx ?? last;

  useEffect(() => {
    if (sel !== null) game.send({ type: 'GET_REPORT', index: sel, kind, system, scKey });
  }, [sel, kind, system, scKey, game]);

  if (v.reports.length === 0) {
    return (
      <div className="panel">
        <h3>RMF Postprocessor</h3>
        <div className="muted">
          No reports yet. SMF data is post-processed overnight: yesterday&apos;s intervals become available at the end of each day. (Live
          monitoring with RMF Monitor III is an analytics upgrade.)
        </div>
      </div>
    );
  }
  const scKeys = v.piHeat.map((c) => c.scKey);
  return (
    <div className="panel">
      <h3>RMF Postprocessor</h3>
      <div className="form">
        <select value={sel ?? ''} onChange={(e) => setIdx(Number(e.target.value))}>
          {[...v.reports].reverse().map((r) => (
            <option key={r.index} value={r.index}>
              {r.label}
            </option>
          ))}
        </select>
        {KINDS.map((k) => (
          <button key={k.kind} className={kind === k.kind ? 'active' : ''} onClick={() => setKind(k.kind)}>
            {k.label}
          </button>
        ))}
        {(kind === 'WLM_SUMMARY' || kind === 'WLM_DETAIL') && (
          <select value={system} onChange={(e) => setSystem(e.target.value)}>
            {['*PLEX', ...v.lpars.filter((l) => l.kind === 'ZOS').map((l) => l.id)].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        {kind === 'WLM_DETAIL' && (
          <select value={scKey} onChange={(e) => setScKey(e.target.value)}>
            {scKeys.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        )}
      </div>
      <div className="green">{game.report}</div>
    </div>
  );
}
