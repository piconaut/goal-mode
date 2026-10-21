import type { GameContent } from '../game/run';
import { HARBOURLINE_EVENTS, HARBOURLINE_STORY } from './events/harbourline-events';

/** FICTIONAL budgets for the Harbourline Bank run: a larger estate with two CPCs, so roughly double Midwest's. */
export const HARBOURLINE_GAME: GameContent = {
  events: HARBOURLINE_EVENTS,
  story: HARBOURLINE_STORY,
  opexBudgetMonthly: 1_400_000,
  capexQuarter: 2_400_000,
  maxDays: 40,
  facets: [
    { id: 'Markets', weight: 1.4 },
    { id: 'Cards', weight: 1.3 },
    { id: 'Retail', weight: 1.1 },
    { id: 'Payments', weight: 1 },
    { id: 'Finance', weight: 1 },
    { id: 'Regulator', weight: 1 },
  ],
  batchMissFacet: 'Payments',
  // SPEC §13.5: a large shop already runs the tier-1 data collectors; SMF 113, planners and automation are still bought.
  startTools: ['RMF_MON3', 'PARTITION_DATA', 'CF_DASD', 'CICS_MON', 'DB2_ACCT'],
};
