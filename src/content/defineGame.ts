// Defaults shared by all three scenarios' game content (CL-39).

import type { GameContent } from './types';

/**
 * Build a scenario's game content from what makes that scenario different.
 *
 * `maxDays` is 40 in every shipped run, so it lives here rather than in three files. The other
 * defaults stay *absent* on purpose: `facets`, `batchMissFacet` and `startTools` are resolved by
 * the game layer, and writing the defaults into the content would add `facetWeights` to a saved
 * RunState (a golden and bench-hash change) for no gameplay difference.
 */
export const defineGame = (content: Omit<GameContent, 'maxDays'>): GameContent => ({
  maxDays: 40,
  ...content,
});
