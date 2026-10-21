// Playable scenarios: the sim scenario plus its game content (budgets, story, event deck, facets).

import type { GameContent } from '../game/run';
import type { Scenario } from '../sim/core/scenario';
import { HARBOURLINE_GAME } from './game-harbourline';
import { MIDWEST_GAME } from './game-midwest';
import { REVENUE_GAME } from './game-revenue';
import { HARBOURLINE, MIDWEST, REVENUE } from './scenarios';

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
  harbourline: { id: 'harbourline', name: 'Harbourline Bank', blurb: 'A large two-CPC bank: spiky trading-day markets, routing set up before the second machine, and a sysplex that is hard to watch in full.', scenario: HARBOURLINE, game: HARBOURLINE_GAME },
};

export const packOf = (id: string | undefined): ScenarioPack => PACKS[id ?? 'midwest'] ?? PACKS.midwest!;
