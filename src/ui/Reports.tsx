import { EVIDENCE_METRICS, type EvidenceMetric } from '../content/evidence';
import { CodexHints } from './CodexHint';
import { REPORT_FEATURE } from '../game/tools';
import { useEffect, useState } from 'react';
import type { ViewModel } from '../game/view';
import type { ReportKind } from '../worker/protocol';
import type { GameHandle } from './useGame';
import { Empty } from './Empty';

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
  }, [sel, kind, system, scKey, game.send]);

  if (v.reports.length === 0) {
    return (
      <div className="panel">
        <h3>RMF Postprocessor</h3>
        <Empty>
          No reports yet. SMF data is post-processed overnight: yesterday&apos;s intervals become available at the end of each day. (Live
          monitoring with RMF Monitor III is an analytics upgrade.)
        </Empty>
      </div>
    );
  }
  const scKeys = v.piHeat.map((c) => c.scKey);
  const rcKeys = v.reports.find((r) => r.index === sel)?.reportClasses ?? [];
  return (
    <div className="panel">
      <h3>
        RMF Postprocessor
        <CodexHints ids={['rmf', 'end-rate']} />
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
      {(kind === 'CF' || kind === 'DASD') && sel !== null && (
        <PinFromCfDasd kind={kind} index={sel} cfs={v.config.lpars.filter((l) => l.kind === 'CF').map((l) => l.id)} lcus={v.config.dasd.lcus.map((l) => l.id)} game={game} />
      )}
      <div className="green">{game.report}</div>
    </div>
  );
}

/** Pin one value from a CF Activity or DASD Activity interval as RCA evidence (RT-10). The CF (or LCU) row names the
 * subject; the ALL VOLUMES row has DISC only. */
function PinFromCfDasd({ kind, index, cfs, lcus, game }: { kind: 'CF' | 'DASD'; index: number; cfs: string[]; lcus: string[]; game: GameHandle }) {
  const [cf, setCf] = useState(cfs[0] ?? '');
  const [lcu, setLcu] = useState(lcus[0] ?? 'ALL');
  const [metric, setMetric] = useState<EvidenceMetric>(kind === 'CF' ? 'CF_SYNC' : 'DASD_DISC');
  const metrics: EvidenceMetric[] = kind === 'CF' ? ['CF_SYNC', 'CF_ASYNC_PCT'] : ['DASD_DISC', 'DASD_IOSQ', 'DASD_RESP'];
  // The ALL VOLUMES row reports DISC only; IOSQ and response need an LCU.
  const subjects = kind === 'CF' ? cfs : ['ALL', ...lcus];
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        game.send({
          type: 'PIN',
          req: kind === 'CF'
            ? { source: 'CF', cfLparId: cf, metric: metric as 'CF_SYNC' | 'CF_ASYNC_PCT', index }
            : { source: 'DASD', lcuId: lcu, metric: metric as 'DASD_DISC' | 'DASD_IOSQ' | 'DASD_RESP', index },
        });
      }}
    >
      <span className="muted">📌 Pin from this interval:</span>
      <select aria-label={kind === 'CF' ? 'Coupling facility to pin' : 'LCU to pin'} value={kind === 'CF' ? cf : lcu}
        onChange={(e) => {
          const v = e.target.value;
          if (kind === 'CF') setCf(v);
          else {
            setLcu(v);
            if (v === 'ALL') setMetric('DASD_DISC');
          }
        }}>
        {subjects.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <select aria-label="Metric to pin" value={metric} onChange={(e) => setMetric(e.target.value as EvidenceMetric)}>
        {metrics.filter((m) => kind === 'CF' || lcu !== 'ALL' || m === 'DASD_DISC').map((m) => (
          <option key={m} value={m}>
            {EVIDENCE_METRICS[m].label}
          </option>
        ))}
      </select>
      <button type="submit">Pin {kind === 'CF' ? cf : lcu}</button>
    </form>
  );
}

const WLM_METRICS: EvidenceMetric[] = ['PI', 'APPL', 'APPL_CP', 'APPL_IIP', 'IIPCP', 'ENDED_RATE', 'DELAY_CPU', 'DELAY_ZIIP', 'DELAY_IO', 'DELAY_STO', 'DELAY_CAP', 'DELAY_OTHER'];

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
