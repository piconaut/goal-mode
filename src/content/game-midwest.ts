import type { GameContent } from '../game/run';
import { MIDWEST_EVENTS, MIDWEST_STORY } from './events/midwest-events';

/** FICTIONAL budgets for the Midwest Mutual run. */
export const MIDWEST_GAME: GameContent = {
  events: MIDWEST_EVENTS,
  story: MIDWEST_STORY,
  opexBudgetMonthly: 780_000,
  capexQuarter: 1_500_000,
  maxDays: 40,
};
