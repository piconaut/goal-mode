// End-of-day review: the report card, the root-cause forms and the draft pick. Split from `Overlays.tsx` (CL-38).

import { EVIDENCE } from '../../content/evidence';
import { idText } from '../../game/ids';
import { pinVerdictLines } from '../../game/proof';
import { groupAcceptedOf, primaryTextOf, rcaAnswerText, rcaGroupOf } from '../../game/run/rca';
import { hhmm } from '../../sim/core/clock';
import { TICKS_PER_HOUR } from '../../sim/core/units';
import type { ViewModel } from '../../game/view';
import type { GameHandle } from '../useGame';
import { AlsoAccepted, ProofView, Rca, RcaVocabulary } from '../rca';
import { DaySummary } from './DaySummary';

export function Review({ v, game, investigate }: { v: ViewModel; game: GameHandle; investigate: () => void }) {
  const open = v.incidents.filter((i) => i.day === v.day && !i.rca && i.rcaGroup === undefined);
  const linked = (id: number) => {
    const ws = rcaGroupOf(v.incidents, id).slice(1).map((i) => i.workloadId);
    return ws.length ? ` · same cause: ${ws.join(', ')}` : '';
  };
  return (
    <>
      <h2>End of day {v.day + 1}</h2>
      {v.lastReport && <DaySummary v={v} />}
      {open.length > 0 && (
        <div className="panel" style={{ marginBottom: 8 }}>
          <h3>Root-cause analysis</h3>
          <p className="muted">
            Today&apos;s RMF data is now in the Reports tab. Name where the time went and what set it off, and attach up to {EVIDENCE.perRca} pinned
            data points that prove it: the symptom on the hurt work, and the reading that tells the cause from its look-alike. Correct answers earn trust and Insight; a
            proof of the right mechanism earns more, and proving the trigger too makes it strong.
          </p>
          <RcaVocabulary />
          <div className="form">
            <button onClick={investigate}>Investigate (pin evidence)</button>
            <span className="muted">{v.pins.length} pinned</span>
          </div>
          {open.map((i) => (
            <Rca key={i.id} incidentId={i.id} label={`#${i.id} ${i.workloadId} · ${windowText(i)} · worst ${i.worstAttainmentPct.toFixed(0)}%${linked(i.id)}`} hypotheses={i.aiops ?? []} v={v} game={game} />
          ))}
        </div>
      )}
      {v.incidents
        .filter((i) => i.day === v.day && i.rca && i.rcaGroup === undefined)
        .map((i) => (
          <div key={i.id} style={{ marginBottom: 6 }}>
            <div className="row">
              <span>
                #{i.id} {i.workloadId}
                {linked(i.id)}: {rcaAnswerText(rcaGroupOf(v.incidents, i.id), i.rca!.mechanism, i.rca!.trigger, groupAcceptedOf(rcaGroupOf(v.incidents, i.id)))}
              </span>
              <span className={`tag ${i.rca!.points >= 3 ? 'good' : 'bad'}`}>
                +{i.rca!.points} (was {primaryTextOf(rcaGroupOf(v.incidents, i.id))})
              </span>
            </div>
            {i.rca!.explain && (
              <div className="muted" style={{ fontSize: 12, paddingLeft: 12 }}>
                {i.rca!.explain}
              </div>
            )}
            <AlsoAccepted group={rcaGroupOf(v.incidents, i.id)} />
            {pinVerdictLines(i.rca!.proof, i.rca!.evidence ?? [], (id) => idText('pin', id)).map((line, k) => (
              <div key={k} className="muted" style={{ fontSize: 12, paddingLeft: 12 }}>
                {line}
              </div>
            ))}
            {i.rca!.proof && <ProofView proof={i.rca!.proof} note={i.rca!.hourNote} />}
            {(i.rca!.evidencePoints ?? 0) > 0 && (
              <div style={{ fontSize: 12, paddingLeft: 12 }}>
                Evidence +{i.rca!.evidencePoints}
                {i.rca!.strong ? ` · strong evidence, +${EVIDENCE.strongInsight} Insight` : ''}
              </div>
            )}
          </div>
        ))}
      <h3>Pick one</h3>
      <div className="cards">
        {(v.draft ?? []).map((d) => (
          <div key={d.id} className="card" onClick={() => game.send({ type: 'DRAFT', optionId: d.id })}>
            <b>{d.title}</b>
            <div className="muted">{d.description}</div>
          </div>
        ))}
      </div>
    </>
  );
}

/** When the SLA was breached, so evidence can be taken from the right intervals. */
const windowText = (i: { startTick: number; hours: number }) =>
  `breached ${hhmm(i.startTick)}–${hhmm(i.startTick + i.hours * TICKS_PER_HOUR)}`;
