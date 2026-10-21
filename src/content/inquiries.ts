// "Ask around" (Inbox): people in the organisation know fragments of what the game hides.
// Asking costs a little time, the answer comes hours later, and each reply gives one piece at best.

export type InquiryKind = 'CRITICAL_PATH' | 'LOCK_HEAVY' | 'JOB_CLASSES' | 'APP_ENTRY' | 'GROWTH' | 'CALENDAR';

export interface InquiryTopic {
  id: InquiryKind;
  contact: string;
  question: string;
  /** Engineer-hours to track the right person down and ask. */
  hours: number;
  /** Reply arrives this many sim-hours later (seeded within the range). */
  replyHours: [number, number];
  /** Chance the reply is a shrug ("not sure, try X"). */
  dontKnowFrac: number;
  /** The question is about one business workload. */
  perWorkload?: boolean;
}

// FICTIONAL: costs, delays and how often people don't know.
export const INQUIRY_TOPICS: InquiryTopic[] = [
  { id: 'CRITICAL_PATH', contact: 'Dana Okafor (batch scheduling)', question: 'Which batch jobs are on the critical path to the 06:00 deadline?', hours: 0.25, replyHours: [2, 6], dontKnowFrac: 0.15 },
  { id: 'LOCK_HEAVY', contact: 'Priya Raman (Db2 DBA)', question: 'Which batch jobs fight online work for Db2 locks?', hours: 0.25, replyHours: [3, 8], dontKnowFrac: 0.2 },
  { id: 'JOB_CLASSES', contact: 'Tom Becker (JES operations)', question: 'What are the job classes used for, and which jobs run where?', hours: 0.25, replyHours: [1, 5], dontKnowFrac: 0.1 },
  { id: 'APP_ENTRY', contact: 'the application owner', question: 'How does this application reach the mainframe (transaction codes, user IDs, packages)?', hours: 0.5, replyHours: [2, 7], dontKnowFrac: 0.2, perWorkload: true },
  { id: 'GROWTH', contact: 'Marco Bianchi (business planning)', question: 'How fast is this business volume expected to grow?', hours: 0.25, replyHours: [4, 10], dontKnowFrac: 0.25, perWorkload: true },
  { id: 'CALENDAR', contact: 'Lena Fischer (business relationship manager)', question: 'Is anything coming up that could hit the systems?', hours: 0.25, replyHours: [1, 4], dontKnowFrac: 0.1 },
];

export const INQUIRY = {
  /** Questions waiting for an answer at once. */
  maxOpen: 3,
  /** Growth estimates are off by up to this fraction. */
  growthNoiseFrac: 0.35,
  /** Replies only arrive between these wall-clock hours. */
  officeHours: [8, 18] as [number, number],
  /** Business contacts answer according to their trust in you (0–100). IT colleagues don't. */
  mood: {
    /** Below this they are rude and tell you nothing. */
    hostileBelow: 25,
    /** Below this they may be rude (more likely the lower it is), else curt and less helpful. */
    grumpyBelow: 45,
    /** At or above this they are friendly and rarely shrug. */
    friendlyFrom: 80,
    grumpyDontKnowMult: 1.5,
    friendlyDontKnowMult: 0.4,
  },
};

/** FICTIONAL: what a stakeholder who has lost patience with you says instead of answering. */
export const RUDE_REPLIES: string[] = [
  'After the week we have had? Figure it out yourself.',
  'You want MY help? Maybe keep the systems up first and then we can talk.',
  'I am not answering questions from the team that took us down twice this week.',
  'Read the documentation. Oh wait, there is none, because you never wrote it.',
  'No. And I have copied my director on this reply.',
  'I have an outage report to write, thanks to you. Ask someone else.',
];

export const CURT_PREFIX: string[] = ['Fine. ', 'Briefly, because I am busy: ', 'For what it is worth: ', 'This once: '];
export const FRIENDLY_PREFIX: string[] = ['Happy to help, thanks for keeping things running! ', 'Good question. ', 'Anything for the team that saved payday: ', 'Sure thing. '];

/** What each critical stream feeds, in business words (Midwest). */
export const STREAM_STORY: Record<string, string> = {
  STL: 'nightly settlement',
  CRD: 'card settlement',
  GLF: 'the general ledger close',
  STM: 'customer statements',
};

/** Who owns each workload (Midwest). */
export const APP_OWNERS: Record<string, string> = {
  RBANK: 'Sam Lee (retail banking)',
  CARDAUTH: 'Ana Costa (cards)',
  MOBILE: 'Jordan Wu (digital channels)',
  TELLER: 'Chris Novak (branch systems)',
  PAYMQ: 'Fatima Haddad (payments)',
  ADHOC: 'Erik Lund (BI and analytics)',
  TSO: 'Robin Shah (development)',
};

/** Facts about the calendar anyone in the business knows (Midwest). */
export const CALENDAR_FACTS: { id: string; text: string }[] = [
  { id: 'payday', text: 'Payday is the 15th: everyone checks their balance and moves money that day, mostly from their phones.' },
  { id: 'monthend', text: 'Month end (29th–30th) adds about a third more reporting batch on top of the usual night.' },
  { id: 'weekend', text: 'Weekends are quiet for branches, but mobile traffic hardly drops.' },
];

/** Rumours the business has heard about upcoming events (only events someone could know about). */
export const EVENT_RUMOURS: Record<string, string> = {
  CAMPAIGN: 'marketing is about to push a mobile promotion',
  RUNAWAY: 'the analytics team is building a very big ad-hoc report',
  REGRESSION: 'the retail app team has Db2 REBINDs scheduled',
  REORG_OVERRUN: 'the DBAs are planning an online REORG of the settlement table spaces',
  MONITOR_CREEP: 'a new monitoring agent release is being rolled out',
  LOCK_ESCALATION: 'settlement volumes are unusually high this week',
  SHADOW_IT: 'the data-science team found free CPU on the test system',
  QR_RELEASE: 'the teller app team has a front-end release lined up',
  HSM_RECALL_STORM: 'the storage team changed the HSM migration rules last month',
  ZIIP_LOSS: 'the mobile API team is rewriting its stored procedures in COBOL',
  CICS_SOS: 'the PROD2 CICS regions have been logging storage warnings',
  RETRY_STORM: 'the card network has had slow authorisations at lunchtime',
  ENCRYPTION_MANDATE: 'the regulator has been asking about encryption at rest',
  MARKET_OPEN_SURGE: 'the trading desk expects an index rebalance and a central bank announcement around the open',
  HOLIDAY_CARD_SPIKE: 'the card team is expecting a big shopping-holiday afternoon',
  FILE_EARLY_CAMPAIGN: 'communications is about to push a "file early, get your refund sooner" campaign',
  RUNAWAY_COMPLIANCE: 'the compliance analytics team is building a very big ad-hoc report',
  EFILE_REGRESSION: 'the e-filing app team has Db2 REBINDs scheduled',
  FILING_BOTS: 'the security team has seen odd login attempts on the taxpayer portal',
  REFUND_RETRY_STORM: 'taxpayers keep refreshing the refund status page, and the call centre is hearing about it',
  TAXDATA_ENCRYPTION: 'the regulator has been asking about encryption of taxpayer data at rest',
  GREEN_IT_COD: 'facilities say the data centre is over its power budget',
  XLOG_LOOP: 'operations put a new CICS journal archiver into production this week',
  SMF_AUDIT: 'the regulator has asked how long we keep detailed SMF data',
  NEW_APP_GOLIVE: 'retail is about to launch a small new booking app',
  HIRING_FREEZE: 'HR is reviewing contractor budgets for next week',
  AUDIT_UNCLASSIFIED: 'the regulator is planning an audit of system management',
};

/** Rumours about upcoming story beats (heard up to a few days ahead). */
export const STORY_RUMOURS: Record<string, string> = {
  CFO_MANDATE: 'the CFO is about to demand a cut in software costs',
  REG_DEADLINE: 'the regulator wants batch results earlier in the morning',
  MERGER: 'the acquisition is closing and their systems will move onto ours',
  FREEZE: 'a quarter-end change freeze is coming',
};

/** What each JES job class means, as operations would put it (Midwest). */
export const JOB_CLASS_MEANING: Record<string, string> = {
  A: 'class A is all production batch: settlement, ledger, statements, reports, backups and the warehouse loads share it',
  D: 'class D is developer batch; only DEVT has initiators for it',
};
