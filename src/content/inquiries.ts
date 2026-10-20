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
};

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
