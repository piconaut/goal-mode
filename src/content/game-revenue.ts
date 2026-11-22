import { defineGame } from './defineGame';
import { REVENUE_EVENTS, REVENUE_STORY } from './events/revenue-events';

/** FICTIONAL budgets for the State Revenue Agency run. */
export const REVENUE_GAME = defineGame({
  events: REVENUE_EVENTS,
  story: REVENUE_STORY,
  opexBudgetMonthly: 760_000,
  capexQuarter: 1_200_000,
  facets: [
    { id: 'Taxpayers', weight: 1.4 },
    { id: 'Refunds', weight: 1.2 },
    { id: 'Agents', weight: 1 },
    { id: 'Employers', weight: 1 },
    { id: 'Finance', weight: 1 },
    { id: 'Regulator', weight: 1 },
  ],
  batchMissFacet: 'Refunds',
  appOwners: {
    EFILE: 'Maya Chen (online filing)',
    ACCOUNT: 'Luis Ortega (taxpayer accounts)',
    REFSTAT: 'Dana Whitfield (refunds)',
    AGENTS: 'Nadia Osei (contact centre)',
    EMPLOYER: 'Graham Ellis (employer services)',
    ANALYTICS: 'Rosa Delgado (compliance analytics)',
    TSO: 'Samir Patel (development)',
  },
  calendarFacts: [
    { id: 'deadline', text: 'Filing season runs to the deadline next month: e-filing climbs about 2 % a day until then, and the last week is the busiest of the year.' },
    { id: 'refunds', text: 'The refund file goes to the Treasury overnight and must be done by 05:00: the status page is busiest the morning after each run.' },
    { id: 'payday', text: 'Payday is the 15th: employers file their withholding and taxpayers check their refunds, so the portal and the contact centre both peak.' },
    { id: 'monthend', text: 'Month end adds the monthly withholding and reconciliation runs on top of the nightly refund file.' },
  ],
});
