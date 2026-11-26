import { defineGame } from './defineGame';
import { MIDWEST_EVENTS, MIDWEST_STORY } from './events/midwest-events';
import { MIDWEST_CHANGES } from './otherTeamChanges';

/** FICTIONAL budgets for the Midwest Mutual run. */
export const MIDWEST_GAME = defineGame({
  events: MIDWEST_EVENTS,
  otherTeamChanges: MIDWEST_CHANGES,
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
  // FICTIONAL: the app owners and the business calendar Midwest's people know (PT-49).
  appOwners: {
    RBANK: 'Sam Lee (retail banking)',
    CARDAUTH: 'Ana Costa (cards)',
    MOBILE: 'Jordan Wu (digital channels)',
    TELLER: 'Chris Novak (branch systems)',
    PAYMQ: 'Fatima Haddad (payments)',
    ADHOC: 'Erik Lund (BI and analytics)',
    TSO: 'Robin Shah (development)',
    // Event-added apps keep the team that runs the related service (PT-49).
    ACQBANK: 'Diane Foster (acquired bank integration)',
    BOOKING: 'Chris Novak (branch systems)',
  },
  // PT-50: the team's own TSO goal, the first period's average response aim (the 0.5 s of the shipped WLM class
  // and IBM's TSO/E example). Not an SLA: a slow TSO costs hands-on engineer-hours, not trust.
  internalGoal: { workloadId: 'TSO', avgRtSec: 0.5 },
  calendarFacts: [
    { id: 'payday', text: 'Paydays are the 1st and the 15th: everyone checks their balance and moves money on those days, mostly from their phones.' },
    { id: 'monthend', text: 'Month end (29th–30th) adds about a third more reporting batch on top of the usual night.' },
    { id: 'weekend', text: 'Weekends are quiet for branches, but mobile traffic hardly drops.' },
  ],
});
