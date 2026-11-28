// The prologue's entry point on the new-run screens (PRO-03, design §6.5): the first-launch offer, then a smaller
// button, and a chapter list once the player has finished or skipped the week.
import { PROLOGUE_SCENARIOS } from '../../content/packs';
import { PROLOGUE_REFERENCE } from '../../game/tutor/reference';
import { useConfirmation } from '../Confirmation';
import type { GameHandle } from '../useGame';
import { usePrologueFlag } from './prologueFlag';

const PROLOGUE_ID = 'midwest-prologue';
const CHAPTERS = PROLOGUE_SCENARIOS[PROLOGUE_ID]!.game.prologue?.chapters ?? [];

/** `replaces`: the offer sits on a run that hasn't ended (the Day 1 briefing, which may be an imported or Ironman
 *  run), so starting the week or a chapter asks first. */
export function PrologueOffer({ game, replaces = false }: { game: GameHandle; replaces?: boolean }) {
  const [flag, setFlag] = usePrologueFlag();
  const ask = useConfirmation();
  const ok = async () => !replaces || (await ask('Start the shadow week? The run on screen is replaced and cannot be resumed.', 'Start the shadow week', 'danger'));
  // The reference log's seed and difficulty, so a fresh start and a chapter replay are the same week.
  const start = async () => {
    if (await ok()) game.send({ type: 'NEW_RUN', seed: PROLOGUE_REFERENCE.seed, difficulty: PROLOGUE_REFERENCE.difficulty, scenario: PROLOGUE_ID });
  };
  const chapter = async (id: string) => {
    if (id && (await ok())) game.send({ type: 'PROLOGUE_CHAPTER', chapterId: id });
  };
  if (flag === '') {
    return (
      <div className="panel prologue-offer">
        <b>New to the shop?</b> Spend the week before Day 1 beside Ruth, who hands the plant over to you on Monday.
        <div className="form">
          <button type="button" className="primary" onClick={start}>
            Shadow week with Ruth (recommended, ~70 min)
          </button>
          <button type="button" onClick={() => setFlag('declined')}>
            Go straight to Day 1
          </button>
        </div>
      </div>
    );
  }
  return (
    <p className="prologue-offer-min">
      <button type="button" onClick={start}>
        Shadow week with Ruth (~70 min)
      </button>
      {(flag === 'done' || flag === 'skipped') && CHAPTERS.length > 1 && (
        <label>
          {' '}Replay a chapter{' '}
          <select value="" onChange={(e) => void chapter(e.target.value)}>
            <option value="">choose…</option>
            {CHAPTERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}
    </p>
  );
}
