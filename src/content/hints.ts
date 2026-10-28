import type { Mechanism } from '../game/types';

// Morning hints (SPEC §11.2): point at the report and the question to ask, never the cause or the fix.
// `{w}` is replaced by the hurt workload's id.

export interface HintText {
  /** Story: names the workload, the report and the question. */
  clear: string;
  /** Normal: only the report to open. */
  vague: string;
}

export const MECHANISM_HINTS: Record<Mechanism, HintText> = {
  CPU_CAPACITY: {
    clear: '{w} missed its SLA yesterday. Partition Data and the DELAY breakdown in WLMGL might show what it was waiting for, and whether anything was using more CPU than usual.',
    vague: 'Yesterday was rough for {w}. Partition Data is worth a look.',
  },
  CPU_PRIORITY: {
    clear: '{w} missed its SLA yesterday. In WLMGL, compare its CPU delay and PI with the classes running alongside it. Who was ahead of it in the queue?',
    vague: 'Yesterday was rough for {w}. WLMGL might tell you more.',
  },
  CAPPING: {
    clear: '{w} missed its SLA yesterday. Check the CAP delay in WLMGL and the capped columns in Partition Data around the peak hour.',
    vague: 'Yesterday was rough for {w}. Partition Data around the peak might tell you more.',
  },
  DEPENDENCY: {
    clear: '{w} missed its SLA yesterday, but its own delays may not tell the whole story. What do the servers it depends on look like in the DELAY report?',
    vague: 'Yesterday was rough for {w}. The DELAY report might tell you more.',
  },
  LOCK_CONTENTION: {
    clear: '{w} missed its SLA yesterday. The Db2 report shows lock waits per transaction. What else was running against the same tables then?',
    vague: 'Yesterday was rough for {w}. The Db2 report might tell you more.',
  },
  CF_SERVICE: {
    clear: '{w} missed its SLA yesterday. CF Activity shows sync and async service times. Were requests to its structures slower than usual?',
    vague: 'Yesterday was rough for {w}. CF Activity might tell you more.',
  },
  QR_TCB: {
    clear: '{w} missed its SLA yesterday. The CICS report splits wait time per region. Where did its transactions spend the time?',
    vague: 'Yesterday was rough for {w}. The CICS report might tell you more.',
  },
  THREAD_LIMIT: {
    clear: '{w} missed its SLA yesterday. Was work queueing before it even got to run? The Db2 and CICS reports show the queue time.',
    vague: 'Yesterday was rough for {w}. The Db2 and CICS reports might tell you more.',
  },
  IO: {
    clear: '{w} missed its SLA yesterday. The DASD report shows response time per volume. Did any of them look different from the day before?',
    vague: 'Yesterday was rough for {w}. The DASD report might tell you more.',
  },
  STORAGE: {
    clear: '{w} missed its SLA yesterday. Storage delay in WLMGL, or the STOR delayed users in Monitor III SYSINFO, might show what it was waiting for.',
    vague: 'Yesterday was rough for {w}. SYSINFO might tell you more.',
  },
  JOB_FAILURE: {
    clear: '{w} missed its window. The Batch view lists jobs that ABENDed. Did a critical one stop, how long were its successors held, and what does its ABEND code say?',
    vague: 'Yesterday was rough for {w}. The Batch view might tell you more.',
  },
};

// Appended when a workload missed its SLA while WLMGL had its service class meeting the goal all day: a class
// average, or CICS regions managed to their own goal, can hide one workload, so the hint points at the
// per-transaction records instead (SPEC §11.2). Keyed by the workload's subsystem.
export const WLM_DISAGREE_HINTS: Record<string, HintText> = {
  CICS: {
    clear: ' Yet WLMGL showed its service class meeting its goal all day. When the two disagree, CICS monitoring (SMF 110) times each transaction rather than the class.',
    vague: ' WLMGL may disagree; CICS SMF 110 might not.',
  },
  DDF: {
    clear: ' Yet WLMGL showed its service class meeting its goal all day. When the two disagree, Db2 accounting (SMF 101) times each thread rather than the class.',
    vague: ' WLMGL may disagree; Db2 SMF 101 might not.',
  },
};

// A class whose worst PI jumped while none of its work broke an SLA: something new is pressing on it before it
// shows on the report card (playtest finding H). `{sc}`, `{pi}` and `{prev}` are filled in.
export const STRAIN_HINT: HintText = {
  clear: '{sc} peaked at PI {pi} in WLMGL yesterday, against {prev} the day before, though none of its work broke an SLA. What was new pressing on it?',
  vague: '{sc} looked strained in WLMGL yesterday.',
};

// FICTIONAL: a strain hint needs a worst PI of at least minPi and riseFactor × the day before, so classes that
// run hot every night (velocity goals on a busy batch window) stay quiet.
export const STRAIN = { minPi: 3, riseFactor: 2 };

export const BATCH_HINTS = {
  late: {
    clear: 'Critical batch finished late. In the Batch view, which jobs on the critical path waited longest, and for what?',
    vague: 'Critical batch finished late. The Batch view might tell you more.',
  },
  tight: {
    clear: 'Critical batch made it with only {slack} to spare. In the Batch view, which jobs on the critical path waited for an initiator or for CPU?',
    vague: 'Critical batch made it, but not by much.',
  },
};

// FICTIONAL: slack below which the batch window counts as "tight" for a hint.
export const BATCH_TIGHT_SLACK_SEC = 30 * 60;

/** Most hints a single morning shows, per hint level. */
export const MAX_HINTS = { CLEAR: 2, VAGUE: 1, NONE: 0 } as const;

export const HINT_SENDER = 'Senior sysprog';

/** Advance warnings for story beats on Story and Normal (SPEC §11.2): a question that points at the risk, days ahead. */
export const STORY_BEAT_HINTS: Record<string, { daysBefore: number; from: string; subject: string; body: string }> = {
  MERGER: {
    daysBefore: 2,
    from: HINT_SENDER,
    subject: 'Before the acquired bank moves in',
    body:
      "The acquired bank's account API lands on PROD2 in two days. It runs under USS (subsystem OMVS) as userid ACQSVC, " +
      'and Retail will judge us on its response times from day one. Do any of our classification rules catch that work, ' +
      'or will it end up in SYSOTHER? Change Desk › WLM › Classification rules shows where it would go today.',
  },
  PREFILL: {
    daysBefore: 2,
    from: HINT_SENDER,
    subject: 'Before pre-filled returns go live',
    body:
      'The pre-filled returns API launches on both production images in two days. It runs under USS (subsystem OMVS) as userid PFILSVC, ' +
      'and taxpayers will judge us on it in the middle of the season. Does any REVPOL rule catch that work, ' +
      'or will it end up in SYSOTHER? Change Desk › WLM › Classification rules shows where it would go today.',
  },
};
