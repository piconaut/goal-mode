import { useState } from 'react';
import type { InquiryKind } from '../content/inquiries';
import type { ViewModel } from '../game/view';
import type { GameHandle } from './useGame';

/** Ask people in the organisation: costs a little time, answers arrive hours later, one fragment at a time. */
export function AskAround({ v, game }: { v: ViewModel; game: GameHandle }) {
  const q = v.inquiries;
  const [topic, setTopic] = useState<InquiryKind>(q.topics[0]!.id);
  const [wid, setWid] = useState(q.apps[0]?.id ?? '');
  const t = q.topics.find((x) => x.id === topic)!;
  const full = q.pending.length >= q.maxOpen;
  return (
    <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
      <h3>Ask around</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        People know things the reports don&apos;t show. Answers take a few hours, arrive during office hours, and rarely tell the whole story. Business people answer as well as they trust you; your IT colleagues just answer.
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          game.send({ type: 'ASK_AROUND', topic, workloadId: t.perWorkload ? wid : null });
        }}
      >
        <select aria-label="Question" value={topic} onChange={(e) => setTopic(e.target.value as InquiryKind)}>
          {q.topics.map((x) => (
            <option key={x.id} value={x.id}>
              {x.question}
            </option>
          ))}
        </select>
        {t.perWorkload && (
          <select aria-label="Application" value={wid} onChange={(e) => setWid(e.target.value)}>
            {q.apps.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={full || v.hoursLeft < t.hours || (v.phase !== 'BRIEFING' && v.phase !== 'LIVE')}>
          Ask {t.perWorkload ? 'the owner' : t.contact.split(' (')[0]} · {t.hours}h
        </button>
      </form>
      {q.pending.length > 0 && (
        <div className="muted" style={{ fontSize: 12 }}>
          Waiting on ({q.pending.length}/{q.maxOpen}):{' '}
          {q.pending.map((p) => `${p.who}${p.workloadId ? ` about ${p.workloadId}` : ''}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
