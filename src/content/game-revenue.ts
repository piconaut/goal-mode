import { defineGame } from './defineGame';
import { REVENUE_EVENTS, REVENUE_STORY } from './events/revenue-events';
import { REVENUE_CHANGES } from './otherTeamChanges';

/** FICTIONAL budgets for the State Revenue Agency run. */
export const REVENUE_GAME = defineGame({
  events: REVENUE_EVENTS,
  otherTeamChanges: REVENUE_CHANGES,
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
  // FICTIONAL: the app owners, including the pre-filled returns team, and the filing-season calendar (PT-49).
  appOwners: {
    EFILE: 'Maya Chen (online filing)',
    ACCOUNT: 'Luis Ortega (taxpayer accounts)',
    REFSTAT: 'Dana Whitfield (refunds)',
    AGENTS: 'Nadia Osei (contact centre)',
    EMPLOYER: 'Graham Ellis (employer services)',
    ANALYTICS: 'Rosa Delgado (compliance analytics)',
    TSO: 'Samir Patel (development)',
    // Event-added app: the same team that owns online filing (PT-49).
    PREFILL: 'Maya Chen (online filing)',
  },
  // PT-50: the team's own TSO goal, the first period's average response aim (the 0.5 s of the shipped WLM class
  // and IBM's TSO/E example). Not an SLA: a slow TSO costs hands-on engineer-hours, not trust.
  internalGoal: { workloadId: 'TSO', avgRtSec: 0.5 },
  calendarFacts: [
    { id: 'deadline', text: 'Filing season runs to the deadline next month: e-filing climbs about 2 % a day until then, and the last week is the busiest of the year.' },
    { id: 'refunds', text: 'The refund file goes to the Treasury overnight and must be done before the morning cut-off: the status page is busiest the morning after each run.' },
    { id: 'payday', text: 'Paydays are the 1st and the 15th: employers file their withholding on those days, so the employer filing service peaks; taxpayers do not file any more than usual.' },
    { id: 'monthend', text: 'Month end adds the monthly withholding and reconciliation runs on top of the nightly refund file.' },
  ],
});
