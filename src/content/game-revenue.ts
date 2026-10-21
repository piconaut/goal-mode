import type { GameContent } from '../game/run';
import { REVENUE_EVENTS, REVENUE_STORY } from './events/revenue-events';

/** FICTIONAL budgets for the State Revenue Agency run. */
export const REVENUE_GAME: GameContent = {
  events: REVENUE_EVENTS,
  story: REVENUE_STORY,
  opexBudgetMonthly: 760_000,
  capexQuarter: 1_200_000,
  maxDays: 40,
  facets: [
    { id: 'Taxpayers', weight: 1.4 },
    { id: 'Refunds', weight: 1.2 },
    { id: 'Agents', weight: 1 },
    { id: 'Employers', weight: 1 },
    { id: 'Finance', weight: 1 },
    { id: 'Regulator', weight: 1 },
  ],
  batchMissFacet: 'Refunds',
};
