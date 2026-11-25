// Problem records (RT-22): a diagnosis the player opens on a subject and a window when no incident paged. The same
// form and judge as an RCA; a filing costs engineer-hours and the anti-fishing limits apply. It unlocks no fix yet.

import { useEffect, useMemo, useState } from 'react';
import type { ViewModel } from '../game/view';
import type { ProblemSubject } from '../game/types';
import type { GameHandle } from './useGame';
import { Empty } from './Empty';
import { DiagnosisForm } from './rca';

const KIND_LABEL: Record<ProblemSubject['kind'], string> = {
  WORKLOAD: 'Workload',
  CLASS: 'Service class',
  IMAGE: 'Image',
  JOB: 'Job or address space',
};

export function Problems({ v, game }: { v: ViewModel; game: GameHandle }) {
  const subjects = v.problems.subjects;
  const [kind, setKind] = useState<ProblemSubject['kind']>('WORKLOAD');
  const [subjectId, setSubjectId] = useState(subjects.find((s) => s.kind === 'WORKLOAD')?.id ?? '');
  const [fromKey, setFromKey] = useState(v.problems.hours.at(-1)?.key ?? '');
  const [toKey, setToKey] = useState(v.problems.hours.at(-1)?.key ?? '');
  const choices = subjects.filter((s) => s.kind === kind);
  const from = v.problems.hours.find((h) => h.key === fromKey);
  const to = v.problems.hours.find((h) => h.key === toKey);
  const ordered = from && to ? from.startTick <= to.startTick : false;
  const subject = useMemo(() => choices.find((s) => s.id === subjectId) ?? choices[0], [choices, subjectId]);
  // When the newest closed hour arrives (or a save loads with different hours), follow it unless the player has
  // chosen a window that still exists.
  const newest = v.problems.hours.at(-1)?.key ?? '';
  useEffect(() => {
    if (!v.problems.hours.some((h) => h.key === fromKey)) setFromKey(newest);
    if (!v.problems.hours.some((h) => h.key === toKey)) setToKey(newest);
  }, [v.problems.hours, fromKey, toKey, newest]);

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <h3>Problems</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        An incident is a problem record the game opened. Open your own record when no page has fired: a card that has
        not breached an SLA, a resource far slower than its peers, or a quiet regression you can see in the reports.
        Pick a subject and whole closed clock hours (up to {v.problems.maxWindowHours}), then file a mechanism, a trigger and the pins that prove them. A
        filing costs <b>{v.problems.costHours} engineer-hours</b> and earns what a correct RCA earns; a wrong mechanism
        costs trust once a day, and a record allows {v.problems.filingsPerDay} filings a day, one an hour. A record
        unlocks no fix yet (D1 is a separate design call).
      </p>
      {v.problems.hours.length === 0 ? (
        <Empty>No closed hours yet: finish an hour, then come back.</Empty>
      ) : (
        <div className="form">
          <select aria-label="Subject kind" value={kind} onChange={(e) => {
            const k = e.target.value as ProblemSubject['kind'];
            setKind(k);
            setSubjectId(subjects.find((s) => s.kind === k)?.id ?? '');
          }}>
            {(Object.keys(KIND_LABEL) as ProblemSubject['kind'][]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <select aria-label="Subject" value={subject?.id ?? ''} onChange={(e) => setSubjectId(e.target.value)}>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <span className="muted">from</span>
          <select aria-label="Window start" value={fromKey} onChange={(e) => setFromKey(e.target.value)}>
            {v.problems.hours.map((h) => (
              <option key={h.key} value={h.key}>{h.label}</option>
            ))}
          </select>
          <span className="muted">to</span>
          <select aria-label="Window end" value={toKey} onChange={(e) => setToKey(e.target.value)}>
            {v.problems.hours.map((h) => (
              <option key={h.key} value={h.key}>{h.label}</option>
            ))}
          </select>
          <button
            disabled={!subject || !ordered}
            title={!ordered ? 'Pick a start before the end' : undefined}
            onClick={() => {
              if (!subject || !from || !to) return;
              const out: ProblemSubject = { kind: subject.kind, id: subject.id } as ProblemSubject;
              game.send({ type: 'OPEN_PROBLEM', subject: out, fromTick: from.startTick, toTick: to.endTick });
            }}
          >
            Open record
          </button>
          {!ordered && <span className="err">The start must be before the end.</span>}
        </div>
      )}
      {v.problems.records.length === 0 ? (
        <Empty>No problem records yet.</Empty>
      ) : (
        v.problems.records.map((r) => (
          <div key={r.id} className="panel" style={{ marginTop: 8 }}>
            <div className="row">
              <span>
                <b>REC{r.id}</b> {r.subjectLabel} · {r.windowLabel}
              </span>
              <span className="muted">
                {r.attemptsToday}/{v.problems.filingsPerDay} filed today
                {r.nextAt ? ` · next after ${r.nextAt}` : ''}
              </span>
            </div>
            {r.filings.map((f, i) => (
              <div key={i} style={{ marginTop: 4 }}>
                <div className="row">
                  <span>
                    <b>{f.mechanism}</b> / {f.trigger} · {f.points} point{f.points === 1 ? '' : 's'}
                    {f.trust ? ` · trust ${f.trust > 0 ? '+' : ''}${f.trust}` : ''}
                  </span>
                  <span className={`tag ${f.duplicateOf !== undefined || f.noProblem ? 'bad' : f.points >= 5 ? 'good' : ''}`}>
                    {f.duplicateOf !== undefined ? 'no second credit' : f.noProblem ? 'no problem' : `${f.points}`}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, paddingLeft: 12, whiteSpace: 'pre-wrap' }}>
                  {f.reply.slice(1).join('\n')}
                </div>
              </div>
            ))}
            <DiagnosisForm
              key={r.id}
              label={`REC${r.id} ${r.subjectLabel} · ${r.windowLabel}`}
              v={v}
              submitLabel="File diagnosis"
              disabled={!r.canFile}
              note={
                r.canFile
                  ? `Costs ${v.problems.costHours} engineer-hours. ${v.problems.filingsPerDay - r.attemptsToday} filing${v.problems.filingsPerDay - r.attemptsToday === 1 ? '' : 's'} left today.`
                  : r.nextAt
                    ? `The next filing is allowed after ${r.nextAt}.`
                    : r.attemptsToday >= v.problems.filingsPerDay
                      ? 'No filings left today.'
                      : `A filing costs ${v.problems.costHours} engineer-hours; not enough left.`
              }
              submit={(mechanism, trigger, evidenceIds) => game.send({ type: 'FILE_PROBLEM', recordId: r.id, mechanism, trigger, evidenceIds })}
            />
          </div>
        ))
      )}
    </div>
  );
}
