// The new-run form at the end of a run: scenario, difficulty, seed and the daily challenge. Split from `Overlays.tsx` (CL-38).

import { useState } from 'react';
import { DIFFICULTIES, type DifficultyId } from '../../content/difficulty';
import { PACKS } from '../../content/packs';
import { dailySeed } from '../../game/daily';
import type { GameHandle } from '../useGame';
import { SeedInput, seedOr } from './SeedInput';

export function NewRun({ game }: { game: GameHandle }) {
  const [difficulty, setDifficulty] = useState<DifficultyId>('NORMAL');
  const [scenario, setScenario] = useState('midwest');
  const [seed, setSeed] = useState('');
  return (
    <>
      <div role="radiogroup" aria-label="Scenario">
        {Object.values(PACKS).map((p) => (
          <label key={p.id} style={{ display: 'block', margin: '4px 0' }}>
            <input type="radio" name="scenario" checked={scenario === p.id} onChange={() => setScenario(p.id)} /> <b>{p.name}</b> <span className="muted">{p.blurb}</span>
          </label>
        ))}
      </div>
      <div role="radiogroup" aria-label="Difficulty">
        {Object.values(DIFFICULTIES).map((d) => (
          <label key={d.id} style={{ display: 'block', margin: '4px 0' }}>
            <input type="radio" name="difficulty" checked={difficulty === d.id} onChange={() => setDifficulty(d.id)} /> <b>{d.name}</b>{' '}
            <span className="muted">{d.description}</span>
          </label>
        ))}
      </div>
      <p>
        <SeedInput value={seed} onChange={setSeed} />
      </p>
      <button className="primary" onClick={() => game.send({ type: 'NEW_RUN', seed: seedOr(seed), difficulty, scenario })}>
        New run
      </button>{' '}
      <button
        title="Same seed for everyone today (UTC)"
        onClick={() => {
          const today = new Date().toISOString().slice(0, 10);
          game.send({ type: 'NEW_RUN', seed: dailySeed(today), difficulty, daily: today, scenario });
        }}
      >
        Daily challenge
      </button>
    </>
  );
}
