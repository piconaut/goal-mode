// Playable scenarios: the sim scenario plus its game content (budgets, story, event deck, facets).

import type { GameContent } from '../game/run';
import type { Scenario } from '../sim/core/scenario';
import { MIDWEST_GAME } from './game-midwest';
import { REVENUE_GAME } from './game-revenue';
import { MIDWEST, REVENUE } from './scenarios';

export interface ScenarioPack {
  id: string;
  name: string;
  blurb: string;
  scenario: Scenario;
  game: GameContent;
}

export const PACKS: Record<string, ScenarioPack> = {
  midwest: { id: 'midwest', name: 'Midwest Mutual', blurb: 'A regional bank: decent but flawed, with a merger on the way.', scenario: MIDWEST, game: MIDWEST_GAME },
  revenue: { id: 'revenue', name: 'State Revenue Agency', blurb: 'Tax season: e-filing grows every day toward the deadline, refunds must reach the Treasury by morning, and the regulator is strict.', scenario: REVENUE, game: REVENUE_GAME },
};

export const packOf = (id: string | undefined): ScenarioPack => PACKS[id ?? 'midwest'] ?? PACKS.midwest!;
