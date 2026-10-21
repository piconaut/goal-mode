// State Revenue Agency story beats and event deck. The deck reuses the Midwest cards that name no
// Midwest workload; agency-specific cards (with their own symptoms and clues) come later.

import type { Command } from '../../sim/core/commands';
import type { WorkloadDef } from '../../sim/workload/types';
import { MIDWEST_EVENTS, type EventDef, type ScriptedBeat } from './midwest-events';

const NEUTRAL_CARDS = ['REORG_OVERRUN', 'JOB_ABEND', 'CP_SPARING', 'HIRING_FREEZE', 'GREEN_IT_COD', 'SMF_AUDIT', 'AUDIT_UNCLASSIFIED'];
// A strict regulator: audit cards come up more often than at the bank.
const WEIGHT_MULT: Record<string, number> = { SMF_AUDIT: 1.5, AUDIT_UNCLASSIFIED: 1.5 };

export const REVENUE_EVENTS: EventDef[] = MIDWEST_EVENTS.filter((e) => NEUTRAL_CARDS.includes(e.id)).map((e) => ({ ...e, weight: e.weight * (WEIGHT_MULT[e.id] ?? 1) }));

// FICTIONAL: pre-filled returns, a Java service on USS that no REVPOL rule classifies (it lands in SYSOTHER).
export const PREFILL_APP: WorkloadDef = {
  id: 'PREFILL',
  name: 'Pre-filled returns API',
  stakeholder: 'Taxpayers',
  subsystem: 'OMVS',
  work: { subsystem: 'OMVS', UI: 'PFILSVC' },
  peakRatePerSec: 90,
  shape: { floor: 0.05, peaks: [{ hour: 12.5, height: 0.7, widthHours: 1.5 }, { hour: 20, height: 1, widthHours: 2.2 }], weekly: [0.9, 0.9, 0.9, 0.9, 0.85, 1.05, 1.1], payday: 1, monthEnd: 1 },
  growthPerDay: 0.02,
  noiseSigma: 0.1,
  noisePhi: 0.95,
  routing: { PROD1: 0.5, PROD2: 0.5 },
  cpuMsRef: 4,
  cpuSigma: 0.6,
  ziipFrac: 0.5,
  ioPerTxn: 6,
  baseLatencySec: 0.06,
  rtSigma: 0.6,
  timeoutSec: 15,
  retryFrac: 0.6,
  servers: [
    { role: 'TCPIP', cpuMsRef: 0.02, latencySec: 0.0005 },
    { role: 'DB2.DBM1', cpuMsRef: 0.15, latencySec: 0.012 },
    { role: 'DB2.MSTR', cpuMsRef: 0.03, latencySec: 0.006 },
    { role: 'DB2.IRLM', cpuMsRef: 0.02, latencySec: 0.004 },
  ],
  sla: { kind: 'PCT', pct: 90, rtSec: 0.5 },
};

const rate = (key: string, value: number): Command => ({ kind: 'SET_MODIFIER', mod: 'rate', key, value });

/** FICTIONAL: the deadline-week surge, on top of the season's daily growth. */
export const DEADLINE_SURGE = { EFILE: 1.35, PREFILL: 1.35, REFSTAT: 1.25, AGENTS: 1.2 } as Record<string, number>;

export const REVENUE_STORY: ScriptedBeat[] = [
  { day: 0, id: 'WELCOME', from: 'Commissioner', title: 'Welcome to filing season', body: 'Six weeks to the filing deadline. Keep the e-filing site up, the refunds flowing and the auditors happy. The previous team tuned this sysplex in the summer, when it was quiet.' },
  { day: 14, id: 'REG_DEADLINE', from: 'Regulator', title: 'Refund files due by 05:00', body: 'The Treasury now takes the nightly refund file at 05:00, not 06:00. Critical batch must complete by then.', constraint: 'DEADLINE_0500' },
  { day: 16, id: 'CFO_MANDATE', from: 'Finance', title: 'Appropriations cut', body: 'The legislature trimmed our IT appropriation. Next month the software bill must be 10% lower than this month.', constraint: 'CFO_MANDATE' },
  {
    day: 22,
    id: 'PREFILL',
    from: 'Commissioner',
    title: 'Pre-filled returns go live',
    body: 'The pre-filled returns API launches today on both production images. The vendor says "it just runs on USS".',
    commands: [{ kind: 'ADD_WORKLOAD', workload: PREFILL_APP }],
  },
  {
    day: 33,
    id: 'DEADLINE_WEEK',
    from: 'Commissioner',
    title: 'Deadline week',
    body: 'Filing closes in four days. Expect a third more e-filing traffic than last week, and the call centre on overtime. Only emergency changes until the deadline passes.',
    constraint: 'FREEZE',
    commands: Object.entries(DEADLINE_SURGE).map(([k, v]) => rate(k, v)),
  },
  { day: 37, id: 'DEADLINE_PASSED', from: 'Commissioner', title: 'Filing deadline passed', body: 'The deadline has passed. Late filers and refund enquiries carry on, but the surge is over.', commands: Object.keys(DEADLINE_SURGE).map((k) => rate(k, 1)) },
];
