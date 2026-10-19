// FICTIONAL event deck for Midwest Mutual (SPEC §9). Every event has symptoms, clues and fixes.

import type { Command } from '../../sim/core/commands';
import type { Trigger } from '../../game/types';
import type { WorkloadDef } from '../../sim/workload/types';

export interface EventDef {
  id: string;
  name: string;
  category: 'WORKLOAD' | 'SOFTWARE' | 'HARDWARE' | 'ORG';
  minDay: number;
  /** Draw weight (scaled by run progress for harder cards). */
  weight: number;
  trigger: Trigger;
  affects: string[];
  /** Wall-clock start hour range and duration in hours (null = until fixed). Events with a
   * fix still end on their own eventually; fixing them early limits the damage. */
  startHour: [number, number];
  durationHours: number | null;
  begin: Command[];
  end: Command[];
  /** Game fix id that ends this event early (see game/catalog.ts). */
  fix: string | null;
  /** Inbox hint the day before (null = surprise). */
  forewarning: string | null;
  /** Message when it starts (null = silent; players must notice symptoms). */
  announcement: string | null;
  clue: string;
}

const mod = (m: 'rate' | 'cpu' | 'asCpu', key: string, value: number): Command => ({ kind: 'SET_MODIFIER', mod: m, key, value });

export const ACQUIRED_APP: WorkloadDef = {
  id: 'ACQBANK',
  name: 'Acquired bank: account API',
  stakeholder: 'Retail',
  subsystem: 'OMVS',
  work: { subsystem: 'OMVS', UI: 'ACQSVC' },
  peakRatePerSec: 120,
  shape: { floor: 0.05, peaks: [{ hour: 11, height: 1, widthHours: 2.5 }, { hour: 15, height: 0.9, widthHours: 2 }], weekly: [1, 1, 1, 1, 1, 0.4, 0.3], payday: 1.2, monthEnd: 1.1 },
  growthPerDay: 0.01,
  noiseSigma: 0.1,
  noisePhi: 0.95,
  routing: { PROD2: 1 },
  cpuMsRef: 4,
  cpuSigma: 0.6,
  ziipFrac: 0.5,
  ioPerTxn: 6,
  baseLatencySec: 0.05,
  rtSigma: 0.6,
  timeoutSec: 10,
  retryFrac: 0.5,
  servers: [
    { role: 'TCPIP', cpuMsRef: 0.02, latencySec: 0.0005 },
    { role: 'DB2.DBM1', cpuMsRef: 0.15, latencySec: 0.012 },
    { role: 'DB2.MSTR', cpuMsRef: 0.03, latencySec: 0.006 },
    { role: 'DB2.IRLM', cpuMsRef: 0.02, latencySec: 0.004 },
  ],
  sla: { kind: 'PCT', pct: 90, rtSec: 0.5 },
};

export const MIDWEST_EVENTS: EventDef[] = [
  {
    id: 'CAMPAIGN',
    name: 'Mobile marketing campaign',
    category: 'WORKLOAD',
    minDay: 2,
    weight: 3,
    trigger: 'DEMAND_SURGE',
    affects: ['MOBILE'],
    startHour: [11, 18],
    durationHours: 2,
    begin: [mod('rate', 'MOBILE', 2.5)],
    end: [mod('rate', 'MOBILE', 1)],
    fix: null,
    forewarning: 'Digital: "Heads up, marketing is pushing a mobile promo tomorrow. Could be big."',
    announcement: null,
    clue: 'DDF END/S jumps ×2–3 on both systems; CPU per transaction unchanged.',
  },
  {
    id: 'RUNAWAY',
    name: 'Runaway ad-hoc query',
    category: 'WORKLOAD',
    minDay: 1,
    weight: 3,
    trigger: 'RUNAWAY_WORK',
    affects: ['MOBILE', 'ADHOC'],
    startHour: [9, 15],
    durationHours: 5, // Db2 RLF governor eventually cancels it
    begin: [mod('cpu', 'ADHOC', 10)],
    end: [mod('cpu', 'ADHOC', 1)],
    fix: 'CANCEL_RUNAWAY',
    forewarning: null,
    announcement: null,
    clue: 'DDFPRD period 2 APPL% soars on PROD2; IIPCP up (no zIIPs there); BI end rate flat.',
  },
  {
    id: 'REGRESSION',
    name: 'Access-path regression after REBIND',
    category: 'SOFTWARE',
    minDay: 4,
    weight: 2,
    trigger: 'ACCESS_PATH_REGRESSION',
    affects: ['RBANK'],
    startHour: [6.5, 8],
    durationHours: 30, // someone on the DBA team notices eventually
    begin: [mod('cpu', 'RBANK', 3)],
    end: [mod('cpu', 'RBANK', 1)],
    fix: 'REBIND_REVERT',
    forewarning: 'Change board: "Db2 package REBINDs for the retail app are scheduled overnight."',
    announcement: null,
    clue: 'ONLHI service per transaction ×3 (APPL% up, END/S flat). Db2 accounting by package would point at RB01.',
  },
  {
    id: 'BOT_ATTACK',
    name: 'Credential-stuffing bot traffic',
    category: 'WORKLOAD',
    minDay: 6,
    weight: 2,
    trigger: 'DEMAND_SURGE',
    affects: ['MOBILE'],
    startHour: [0, 23],
    durationHours: 1.5,
    begin: [mod('rate', 'MOBILE', 4), mod('cpu', 'MOBILE', 0.4)],
    end: [mod('rate', 'MOBILE', 1), mod('cpu', 'MOBILE', 1)],
    fix: 'BLOCK_BOTS',
    forewarning: null,
    announcement: null,
    clue: 'Mobile END/S ×4 with lower CPU per transaction; TCP/IP busier; DBAT usage spikes.',
  },
  {
    id: 'CF_LINK',
    name: 'Degraded CF link to CF01',
    category: 'HARDWARE',
    minDay: 5,
    weight: 1.5,
    trigger: 'HARDWARE_FAULT',
    affects: ['RBANK', 'CARDAUTH', 'MOBILE', 'TELLER', 'PAYMQ'],
    startHour: [7, 20],
    durationHours: 4,
    begin: [{ kind: 'SET_CF', lparId: 'CF01', degrade: 6 }],
    end: [{ kind: 'SET_CF', lparId: 'CF01', degrade: 1 }],
    fix: null,
    forewarning: null,
    announcement: 'HMC: "Channel path to CF01 reporting errors; link running degraded."',
    clue: 'CF Activity: CF01 sync service ×6 and async conversion rising; z/OS CPU per Db2 txn up.',
  },
  {
    id: 'DASD_DEGRADED',
    name: 'Storage array back-end degraded',
    category: 'HARDWARE',
    minDay: 8,
    weight: 1.2,
    trigger: 'HARDWARE_FAULT',
    affects: ['RBANK', 'TELLER', 'PAYMQ', 'MOBILE'],
    startHour: [8, 22],
    durationHours: 3,
    begin: [{ kind: 'SET_DASD', changes: { backendDegrade: 5 } }],
    end: [{ kind: 'SET_DASD', changes: { backendDegrade: 1 } }],
    fix: null,
    forewarning: null,
    announcement: null,
    clue: 'DASD Activity: DISC time ×5; RESP up; IOSQ follows on hot volumes.',
  },
  {
    id: 'JOB_ABEND',
    name: 'Critical batch job abend',
    category: 'SOFTWARE',
    minDay: 1,
    weight: 2.5,
    trigger: 'POLICY',
    affects: [],
    startHour: [21, 26],
    durationHours: 0,
    begin: [{ kind: 'ABEND_JOB', critical: true }],
    end: [],
    fix: null,
    forewarning: null,
    announcement: 'Operations: "Critical batch job ABENDed (S0C7). Restart needed."',
    clue: 'Batch Gantt shows a critical job stopped; successors held.',
  },
  {
    id: 'MONITOR_CREEP',
    name: 'Monitoring agent CPU creep',
    category: 'SOFTWARE',
    minDay: 10,
    weight: 1,
    trigger: 'POLICY',
    affects: ['MOBILE', 'RBANK'],
    startHour: [6, 7],
    durationHours: 48,
    begin: [mod('asCpu', 'MONAGENT', 12)],
    end: [mod('asCpu', 'MONAGENT', 1)],
    fix: 'ROLLBACK_MONITOR',
    forewarning: 'Vendor: "New monitoring agent release deployed overnight with richer tracing!"',
    announcement: null,
    clue: 'STCMED APPL% up sharply on every system; MONAGENT is the top CPU consumer in the class.',
  },
  {
    id: 'LOCK_ESCALATION',
    name: 'Lock escalation in settlement',
    category: 'SOFTWARE',
    minDay: 12,
    weight: 1.2,
    trigger: 'BATCH_OVERLAP',
    affects: ['RBANK', 'CARDAUTH'],
    startHour: [20.5, 23],
    durationHours: 3,
    begin: [{ kind: 'SET_LOCK_BOOST', value: 6 }],
    end: [{ kind: 'SET_LOCK_BOOST', value: 0 }],
    fix: null,
    forewarning: null,
    announcement: null,
    clue: 'Card auth response time up with little CPU delay; UNK delay up; IRLM healthy; batch running.',
  },
];

/** Scripted story beats: constraints and big events on fixed days (SPEC §11.1). */
export interface ScriptedBeat {
  day: number;
  id: string;
  title: string;
  body: string;
  from: string;
  constraint?: string;
  commands?: Command[];
}

export const MIDWEST_STORY: ScriptedBeat[] = [
  { day: 0, id: 'WELCOME', from: 'CIO', title: 'Welcome aboard', body: 'Keep the bank running and the bill sane. The previous team left a working setup… mostly. RMF reports land after each day.' },
  { day: 12, id: 'CFO_MANDATE', from: 'CFO', title: 'Software costs must come down', body: 'Next month the MLC bill must be 10% lower than this month. Finance trust depends on it.', constraint: 'CFO_MANDATE' },
  { day: 20, id: 'REG_DEADLINE', from: 'Regulator', title: 'Earlier reporting deadline', body: 'Critical batch must now complete by 05:00.', constraint: 'DEADLINE_0500' },
  {
    day: 26,
    id: 'MERGER',
    from: 'CIO',
    title: 'Acquired bank goes live on PROD2',
    body: 'The acquired bank\'s account API moves onto our sysplex today. Their team says "it just runs on USS".',
    commands: [{ kind: 'ADD_WORKLOAD', workload: ACQUIRED_APP }],
  },
  { day: 33, id: 'FREEZE', from: 'Change board', title: 'Quarter-end change freeze', body: 'Only emergency changes until the quarter closes.', constraint: 'FREEZE' },
];
