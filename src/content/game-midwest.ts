import type { GameContent } from '../game/run';
import { MIDWEST_EVENTS, MIDWEST_STORY } from './events/midwest-events';

/** FICTIONAL budgets for the Midwest Mutual run. */
export const MIDWEST_GAME: GameContent = {
  events: MIDWEST_EVENTS,
  story: MIDWEST_STORY,
  opexBudgetMonthly: 780_000,
  capexQuarter: 1_500_000,
  maxDays: 40,
  // Story keeps the WLM and PR/SM flaws (the diagnosis) but hands over the infrastructure ones fixed.
  startingFixes: {
    STORY: [
      { flaw: 'F7', label: 'a zIIP is online on PROD2', commands: [{ kind: 'SET_LOGICAL', lparId: 'PROD2', pool: 'ZIIP', logical: 1 }] },
      { flaw: 'F8', label: 'thin interrupts are on for CF02', commands: [{ kind: 'SET_CF', lparId: 'CF02', thinInterrupts: true }] },
      { flaw: 'F11', label: 'RMF records every 15 minutes', commands: [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }] },
    ],
  },
};
