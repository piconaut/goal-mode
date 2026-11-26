// The Inbox tab. Split from `App.tsx` (CL-38).

import type { ViewModel } from '../game/view';
import type { GameHandle } from './useGame';
import { AskAround } from './AskAround';
import { Empty } from './Empty';

export function InboxReply({ message, game }: { message: ViewModel['inbox'][number]; game: GameHandle }) {
  const { reply, replyToEventUid } = message;
  if (!reply || !replyToEventUid) return null;
  return (
    <button disabled={!reply.affordable} onClick={() => game.send({ type: 'EVENT_REPLY', eventUid: replyToEventUid })}>
      {reply.label} · {reply.hours}h · {reply.facet} trust −{reply.trust}
    </button>
  );
}

export function Inbox({ v, game }: { v: ViewModel; game: GameHandle }) {
  return (
    <div className="panel">
      <AskAround v={v} game={game} />
      <h3>Inbox</h3>
      {v.inbox.length === 0 && <Empty>No messages yet.</Empty>}
      {[...v.inbox].reverse().map((m, i) => (
        <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div className="row">
            <b>{m.subject}</b>
            <span className="muted">
              {m.from} · day {m.day + 1}
            </span>
          </div>
          <div>{m.body}</div>
          <InboxReply message={m} game={game} />
        </div>
      ))}
    </div>
  );
}
