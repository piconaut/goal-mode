import { defineGame } from './defineGame';
import { HARBOURLINE_EVENTS, HARBOURLINE_STORY } from './events/harbourline-events';

/** FICTIONAL budgets for the Harbourline Bank run: a larger estate with two CPCs, so roughly double Midwest's. Opex is set so
 * month-1 bills land ~5–15 % over it (hb40e sweep: textbook $1.52–1.67M, expert $1.55–1.78M; Midwest's run 7–10 % over).
 * Raised $1.5M → $1.6M (user decision 2026-10-26): good play hit the 25 % opex wall on day 28 when a spike day set the
 * month's R4HA peak and the vendor price rise landed in month 1 (expert won 13/20 on Normal). */
export const HARBOURLINE_GAME = defineGame({
  events: HARBOURLINE_EVENTS,
  story: HARBOURLINE_STORY,
  opexBudgetMonthly: 1_600_000,
  capexQuarter: 2_400_000,
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
  // FICTIONAL: the app owners and the trading, cards and mobile calendar Harbourline's people know (PT-49).
  appOwners: {
    MKTORD: 'Helen Marsh (markets order capture)',
    MKTQRY: 'Dev Sharma (markets data)',
    RETAIL: 'Grace Okafor (retail banking)',
    CARDS: 'Tomasz Nowak (cards)',
    PAYMENTS: 'Aisha Rahman (payments)',
    MOBILE: 'Noah Kim (mobile)',
    ADHOC: 'Ingrid Larsen (finance analytics)',
    TSO: 'Peter Novak (development)',
  },
  // PT-50: the team's own TSO goal, the first period's average response aim (the 0.5 s of the shipped WLM class
  // and IBM's TSO/E example). Not an SLA: a slow TSO costs hands-on engineer-hours, not trust.
  internalGoal: { workloadId: 'TSO', avgRtSec: 0.5 },
  calendarFacts: [
    { id: 'trading', text: 'Trading days burst around the 09:30 open and again before the 16:00 close, and the floor notices every slow second.' },
    { id: 'payday', text: 'Paydays are the 1st and the 15th: card spending and mobile banking both jump, and the contact centre hears about it the next morning.' },
    { id: 'monthend', text: 'Month end brings the settlement and reporting runs on top of the usual night.' },
    { id: 'weekend', text: 'Weekends are quiet on the trading floor, but cards and mobile hardly drop.' },
  ],
});
