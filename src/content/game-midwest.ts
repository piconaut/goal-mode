import { defineGame } from './defineGame';
import { MIDWEST_EVENTS, MIDWEST_STORY } from './events/midwest-events';

/** FICTIONAL budgets for the Midwest Mutual run. */
export const MIDWEST_GAME = defineGame({
  events: MIDWEST_EVENTS,
  story: MIDWEST_STORY,
  opexBudgetMonthly: 780_000,
  capexQuarter: 1_500_000,
  // Story keeps the WLM and PR/SM flaws (the diagnosis) but hands over the infrastructure ones fixed.
  startingFixes: {
    STORY: [
      { flaw: 'F7', label: 'a zIIP is online on PROD2', commands: [{ kind: 'SET_LOGICAL', lparId: 'PROD2', pool: 'ZIIP', logical: 1 }] },
      { flaw: 'F8', label: 'thin interrupts are on for CF02', commands: [{ kind: 'SET_CF', lparId: 'CF02', thinInterrupts: true }] },
      { flaw: 'F11', label: 'RMF records every 15 minutes', commands: [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }] },
    ],
  },
  appOwners: {
    RBANK: 'Sam Lee (retail banking)',
    CARDAUTH: 'Ana Costa (cards)',
    MOBILE: 'Jordan Wu (digital channels)',
    TELLER: 'Chris Novak (branch systems)',
    PAYMQ: 'Fatima Haddad (payments)',
    ADHOC: 'Erik Lund (BI and analytics)',
    TSO: 'Robin Shah (development)',
  },
  calendarFacts: [
    { id: 'payday', text: 'Payday is the 15th: everyone checks their balance and moves money that day, mostly from their phones.' },
    { id: 'monthend', text: 'Month end (29th–30th) adds about a third more reporting batch on top of the usual night.' },
    { id: 'weekend', text: 'Weekends are quiet for branches, but mobile traffic hardly drops.' },
  ],
});
