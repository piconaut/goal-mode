import { EVIDENCE_METRICS, type EvidenceMetric } from '../content/evidence';
import { CodexHints } from './CodexHint';
import { REPORT_FEATURE } from '../game/tools';
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
  const rcKeys = v.reports.find((r) => r.index === sel)?.reportClasses ?? [];
  return (
    <div className="panel">
      <h3>
        RMF Postprocessor
        <CodexHints ids={['rmf']} />
      </h3>
      <div className="form">
        <select value={sel ?? ''} onChange={(e) => setIdx(Number(e.target.value))}>
          {[...v.reports].reverse().map((r) => (
            <option key={r.index} value={r.index}>
              {r.label}
            </option>
          ))}
        </select>
        {KINDS.map((k) => (
          <button
            key={k.kind}
            className={kind === k.kind ? 'active' : ''}
            disabled={REPORT_FEATURE[k.kind] !== null && !v.features.includes(REPORT_FEATURE[k.kind]!)}
            title={REPORT_FEATURE[k.kind] !== null && !v.features.includes(REPORT_FEATURE[k.kind]!) ? 'Unlock on the Analytics tab' : undefined}
            onClick={() => setKind(k.kind)}
          >
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
            {rcKeys.length > 0 && (
              <optgroup label="Report classes">
                {rcKeys.map((k) => (
                  <option key={`rc:${k}`}>{k}</option>
                ))}
              </optgroup>
            )}
          </select>
        )}
      </div>
      {(kind === 'WLM_SUMMARY' || (kind === 'WLM_DETAIL' && scKeys.includes(scKey))) && sel !== null && (
        <PinFromReport index={sel} system={system} scKeys={scKeys} initial={kind === 'WLM_DETAIL' ? scKey : undefined} game={game} />
      )}
      <div className="green">{game.report}</div>
    </div>
  );
}

const WLM_METRICS: EvidenceMetric[] = ['PI', 'APPL', 'ENDED_RATE', 'DELAY_CPU', 'DELAY_ZIIP', 'DELAY_IO', 'DELAY_STO', 'DELAY_CAP', 'DELAY_OTHER'];

/** Pin one value from this Workload Activity interval as RCA evidence. */
function PinFromReport({ index, system, scKeys, initial, game }: { index: number; system: string; scKeys: string[]; initial?: string; game: GameHandle }) {
  const [sc, setSc] = useState(initial ?? scKeys[0] ?? '');
  const [metric, setMetric] = useState<EvidenceMetric>('DELAY_CPU');
  const target = initial ?? sc;
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        game.send({ type: 'PIN', req: { source: 'WLMGL', index, system, scKey: target, metric } });
      }}
    >
      <span className="muted">📌 Pin from this interval:</span>
      {!initial && (
        <select aria-label="Service class period to pin" value={sc} onChange={(e) => setSc(e.target.value)}>
          {scKeys.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      )}
      <select aria-label="Metric to pin" value={metric} onChange={(e) => setMetric(e.target.value as EvidenceMetric)}>
        {WLM_METRICS.map((m) => (
          <option key={m} value={m}>
            {EVIDENCE_METRICS[m].label}
          </option>
        ))}
      </select>
      <button type="submit">Pin {initial ?? sc}</button>
    </form>
  );
}
