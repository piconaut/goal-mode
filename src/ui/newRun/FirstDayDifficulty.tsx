// Before day 1 the player may restart on another scenario, difficulty or seed, or today's daily challenge.
// Split from `Overlays.tsx` (CL-38).

import { useState } from 'react';
import { DIFFICULTIES, type DifficultyId } from '../../content/difficulty';
import { PACKS } from '../../content/packs';
import { dailySeed } from '../../game/daily';
import type { ViewModel } from '../../game/view';
import type { GameHandle } from '../useGame';
import { useConfirmation } from '../Confirmation';
import { SeedInput, seedOr } from './SeedInput';

// A fresh page load starts on Midwest Mutual, Normal; until day 1 starts the player can restart on another
// scenario or preset, or switch to today's daily challenge (which then stays daily across those restarts).
export function FirstDayDifficulty({ v, game }: { v: ViewModel; game: GameHandle }) {
  const ask = useConfirmation();
  const plannedAny = v.changes.length > 0;
  const [seed, setSeed] = useState('');
  const restart = async (scenario: string, difficulty: DifficultyId, daily: boolean, typed = '') => {
    if (plannedAny && !(await ask('Restart? Planned changes are discarded.', 'Restart run', 'danger'))) return;
    const today = new Date().toISOString().slice(0, 10);
    game.send(
      daily
        ? { type: 'NEW_RUN', seed: dailySeed(today), difficulty, daily: today, scenario }
        : { type: 'NEW_RUN', seed: seedOr(typed), difficulty, scenario },
    );
  };
  const isDaily = v.daily !== null;
  return (
    <p>
      <label>
        Scenario{' '}
        <select value={v.scenario.id} onChange={(e) => restart(e.target.value, v.difficulty.id, isDaily)}>
          {Object.values(PACKS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        Difficulty{' '}
        <select
          value={v.difficulty.id}
          onChange={(e) => restart(v.scenario.id, e.target.value as DifficultyId, isDaily)}
        >
          {Object.values(DIFFICULTIES).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>{' '}
      <span className="muted">{DIFFICULTIES[v.difficulty.id].description}</span>{' '}
      {isDaily ? (
        <>
          <span className="tag" style={{ whiteSpace: 'nowrap' }}>Daily challenge {v.daily}</span>{' '}
          <button onClick={() => restart(v.scenario.id, v.difficulty.id, false)}>Random seed instead</button>
        </>
      ) : (
        <button title="Same seed for everyone today (UTC)" onClick={() => restart(v.scenario.id, v.difficulty.id, true)}>
          Daily challenge
        </button>
      )}{' '}
      <span className="muted" style={{ whiteSpace: 'nowrap' }}>seed {v.seed}</span>{' '}
      <span style={{ whiteSpace: 'nowrap' }}>
        <SeedInput value={seed} onChange={setSeed} />{' '}
        <button disabled={seed === ''} onClick={() => restart(v.scenario.id, v.difficulty.id, false, seed)}>
          Use seed
        </button>
      </span>
    </p>
  );
}
