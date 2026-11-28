// Ruth's mentor panel (PRO-03, docs/prologue-design.md §6.1–§6.5): the step's words, the hint ladder, Next / Skip
// step, Skip chapter, Leave the prologue and Put it back. Docked bottom right, a bottom sheet at phone width; an ARIA
// live region so a new step is read out. It never blocks the page and adds no single-key shortcut.
import { useEffect, useState } from 'react';
import type { TutorView } from '../../game/tutor/view';
import type { Tab } from '../app/shortcuts';
import { seedOr } from '../newRun/SeedInput';
import type { GameHandle } from '../useGame';
import { leftWith, usePrologueFlag } from './prologueFlag';

export function MentorPanel({ t, game, showTab }: { t: TutorView; game: GameHandle; showTab: (tab: Tab) => void }) {
  const [min, setMin] = useState(false);
  const [flag, setFlag] = usePrologueFlag();
  // Minimised, the panel comes back at the next beat (§6.1).
  useEffect(() => setMin(false), [t.beatId]);
  useEffect(() => {
    if (t.finished && flag !== 'done') setFlag('done');
  }, [t.finished, flag, setFlag]);

  const leave = (why: 'skipped' | 'declined') => {
    setFlag(leftWith(flag, why));
    game.send({ type: 'NEW_RUN', seed: seedOr(''), scenario: 'midwest' });
  };
  const next = t.chapters[t.chapter.index + 1];
  const skipChapter = () => {
    if (next) game.send({ type: 'PROLOGUE_CHAPTER', chapterId: next.id });
    else leave('skipped');
  };
  const s = t.step;
  const counter = t.beatId ? `Beat ${t.beatId}${s ? ` · ${s.number}/${s.of}` : ''}` : '';

  if (min) {
    return (
      <div className="mentor mentor-min" role="region" aria-label="Ruth, your mentor">
        <button type="button" onClick={() => setMin(false)} aria-expanded="false">
          Ruth{s ? ` · ${counter}` : ''} ▴
        </button>
      </div>
    );
  }
  return (
    <div className="mentor" role="region" aria-label="Ruth, your mentor">
      <div className="mentor-head">
        <span className="mentor-portrait" aria-hidden="true">R</span>
        <span>
          <b>Ruth</b> <span className="muted">{t.chapter.title}{counter ? ` · ${counter}` : ''}</span>
        </span>
        <button type="button" className="mentor-x" onClick={() => setMin(true)} aria-expanded="true" title="Minimise (comes back at the next beat)">
          ▾
        </button>
      </div>
      <div className="mentor-say" aria-live="polite" aria-atomic="true">
        {t.finished ? (
          <p>That's the week. Monday it's yours.</p>
        ) : s ? (
          <p>{s.say}</p>
        ) : (
          <p className="muted">{t.beatId ? 'Nothing more for now. Start the clock; I will stop it when there is something to see.' : 'Start the day when you are ready.'}</p>
        )}
        {s && s.hints.length > 0 && (
          <ol className="mentor-hints" aria-label="Hints">
            {s.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        )}
        {t.putBack && (
          <p className="mentor-putback">
            That change hurt more than it helped. Want me to put it back?{' '}
            <button type="button" onClick={() => game.send({ type: 'PROLOGUE_CHAPTER', chapterId: t.chapter.id })} title="Reload this chapter's 06:00 start state">
              Put it back
            </button>
          </p>
        )}
      </div>
      <div className="mentor-actions">
        {t.finished ? (
          <button type="button" className="primary" onClick={() => leave('skipped')}>
            Go to Day 1
          </button>
        ) : (
          <>
            {s && !s.isAck && (
              <button type="button" onClick={() => game.send({ type: 'TUTOR_HINT' })} disabled={!s.moreHints}>
                Hint
              </button>
            )}
            {s?.showMe && (
              <button
                type="button"
                title="Fills the Change Desk draft; nothing is submitted"
                onClick={() => {
                  game.setBasket(s.showMe!.commands);
                  showTab('changes');
                }}
              >
                Show me: {s.showMe.label}
              </button>
            )}
            {s?.isAck && (
              <button type="button" className="primary" onClick={() => game.send({ type: 'TUTOR_ACK' })}>
                Next
              </button>
            )}
            {s && !s.isAck && (
              <button type="button" onClick={() => game.send({ type: 'TUTOR_ACK' })}>
                Skip step
              </button>
            )}
          </>
        )}
        <span className="mentor-spacer" />
        {!t.finished && (
          <button type="button" onClick={skipChapter} title={next ? `Jump to ${next.title}, 06:00` : 'Leave the prologue for Day 1'}>
            Skip chapter
          </button>
        )}
        <button type="button" onClick={() => leave('skipped')} title="Go to the new-run screen">
          Leave the prologue
        </button>
      </div>
    </div>
  );
}
