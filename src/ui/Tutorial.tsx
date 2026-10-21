import { useEffect } from 'react';
import type { ViewModel } from '../game/view';
import { useStored } from './useStored';

// Stages only move forward; 'off' hides the guide for good (skipped or finished).
type Stage = 'start' | 'pi' | 'run' | 'reports' | 'fix' | 'day2' | 'off';
const ORDER: Stage[] = ['start', 'pi', 'run', 'reports', 'fix', 'day2', 'off'];

function reached(v: ViewModel, stage: Stage): Stage {
  const dayOver = v.phase === 'REVIEW' || v.day >= 1;
  let next: Stage = stage;
  const bump = (s: Stage) => {
    if (ORDER.indexOf(s) > ORDER.indexOf(next)) next = s;
  };
  if (v.phase === 'LIVE' || v.day >= 1) bump('pi');
  if (dayOver) bump('reports');
  if (dayOver && v.reportsOpenedToday > 0) bump('fix');
  if (v.tutorialDb2Fixed && dayOver) bump('day2');
  return next;
}

const TEXT: Record<Exclude<Stage, 'off'>, { title: string; body: string }> = {
  start: {
    title: 'Day 1: look before you touch',
    body: "Read the briefing, then start the day. RMF reports only cover intervals that ended before today's 06:00, so today you watch the Ops Console.",
  },
  pi: {
    title: 'The PI heat map',
    body: 'Each row is a service class period. Orange means it is missing its goal (PI above 1). Note which classes struggle at the morning peak.',
  },
  run: {
    title: 'Let the day run',
    body: 'Speed up with the 8× button. When the day closes you get a report card and the RMF intervals become readable.',
  },
  reports: {
    title: 'Find the cause',
    body: 'Open RMF Reports › WLM summary. Compare the Db2 address spaces (STCMED, importance 3) with the CICS regions and DDF work they serve (importance 1–2).',
  },
  fix: {
    title: 'Fix the policy',
    body: 'Change Desk › WLM › Classification rules: point the STC rule DB* at STCHI (or SYSSTC), then Install & activate. Policy changes apply from the next day.',
  },
  day2: {
    title: 'Check your work',
    body: 'Start day 2 and watch the PI heat map at the peak. The Codex explains any term you meet; the rest is diagnosis.',
  },
};

export function Tutorial({ v }: { v: ViewModel }) {
  const [stored, setStage] = useStored<Stage>('goalmode.tutorial', 'start');
  const stage = stored === 'off' ? 'off' : reached(v, ORDER.includes(stored) ? stored : 'start');
  useEffect(() => {
    if (stage !== stored) setStage(stage);
  });
  const ended = v.phase === 'GAMEOVER' || v.phase === 'VICTORY';
  if (stage === 'off' || ended || v.day > 1) return null;
  const done = v.day === 1 && v.phase === 'LIVE';
  const t = done ? { title: 'Tutorial complete', body: 'From here on it is your sysplex. Good luck.' } : TEXT[stage];
  const step = ORDER.indexOf(stage) + 1;
  return (
    <aside className="tutorial" aria-label="Tutorial">
      <div className="tutorial-head">
        <b>{t.title}</b>
        {!done && <span className="dim"> {step}/6</span>}
      </div>
      <p>{t.body}</p>
      <div className="tutorial-buttons">
        {stage === 'pi' && !done && <button onClick={() => setStage('run')}>Next</button>}
        <button onClick={() => setStage('off')}>{done ? 'Close' : 'Skip tutorial'}</button>
      </div>
    </aside>
  );
}
