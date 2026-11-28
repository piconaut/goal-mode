// The per-viewer prologue flag (design §6.5): whether this browser has seen the offer, and whether the player has
// finished or skipped the shadow week once (which unlocks the chapter list).
import { useStored } from '../useStored';

export type PrologueFlag = '' | 'declined' | 'skipped' | 'done';
export const PROLOGUE_FLAG_KEY = 'goalmode.prologue';

export const usePrologueFlag = () => useStored<PrologueFlag>(PROLOGUE_FLAG_KEY, '');

/** Record a skip or a leave without overwriting a finish. */
export const leftWith = (flag: PrologueFlag, next: PrologueFlag): PrologueFlag => (flag === 'done' ? 'done' : next);
