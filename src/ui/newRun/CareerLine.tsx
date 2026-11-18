// Career XP after a run and the starting-perk picker. Split from `Overlays.tsx` (CL-38).

import { CAREER_LEVELS } from '../../content/career';
import { DRAFT_OPTIONS } from '../../content/draft';
import { careerLevel, unlockedPerks } from '../../game/career';
import type { ViewModel } from '../../game/view';
import type { GameHandle } from '../useGame';

const perkTitle = (id: string) => DRAFT_OPTIONS.find((d) => d.id === id)?.title.replace(/^Perk: /, '') ?? id;

function careerTitle(xp: number): string {
  const lvl = careerLevel(xp);
  const next = CAREER_LEVELS[lvl + 1];
  return `${CAREER_LEVELS[lvl]!.title} (level ${lvl + 1}, ${xp} XP${next ? `; ${next.xp} for ${perkTitle(next.unlock ?? '')}` : ''})`;
}

/** Career XP from the run that just ended, and any perk it unlocked. */
export function CareerLine({ game }: { game: GameHandle }) {
  const c = game.career;
  if (!c || c.lastRunXp === null) return null;
  const before = c.career.xp - c.lastRunXp;
  const fresh = unlockedPerks(c.career.xp).filter((p) => !unlockedPerks(before).includes(p));
  return (
    <p>
      Career: <b>+{c.lastRunXp} XP</b> · {careerTitle(c.career.xp)}
      {fresh.length > 0 && <> · unlocked starting perk <b>{fresh.map(perkTitle).join(', ')}</b></>}
    </p>
  );
}

// Unlocked career perks: pick one before day 1 starts (not on the daily challenge, where everyone starts alike).
export function StartingPerk({ v, game }: { v: ViewModel; game: GameHandle }) {
  const xp = game.career?.career.xp ?? 0;
  const perks = unlockedPerks(xp);
  return (
    <p>
      <span className="muted">Career: {careerTitle(xp)}.</span>{' '}
      {perks.length > 0 && !v.daily && (
        <label>
          Starting perk{' '}
          <select value={v.perks[0] ?? ''} onChange={(e) => game.send({ type: 'SET_STARTING_PERK', perkId: e.target.value || null })}>
            <option value="">None</option>
            {perks.map((p) => (
              <option key={p} value={p}>
                {perkTitle(p)}
              </option>
            ))}
          </select>
        </label>
      )}
    </p>
  );
}
