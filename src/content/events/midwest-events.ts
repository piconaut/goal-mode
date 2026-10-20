// FICTIONAL event deck for Midwest Mutual (SPEC §9). Every event has symptoms, clues and fixes.

import type { Command } from '../../sim/core/commands';
import type { Mechanism, Trigger } from '../../game/types';
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
  /** Mechanisms the card causes; RCA ground truth blames it only for incidents with one of these (absent = any). */
  mechanisms?: Mechanism[];
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
  /** Draw at most once per run (cards that add a workload). */
  oncePerRun?: boolean;
  /** Drop the CPC this many capacity settings at start and restore the setting it had then at the end
   * (resolved when the card begins, so a player's upgrade is neither skipped nor undone). */
  capacityDrop?: number;
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

// FICTIONAL: a small internal Java service on USS; modest rate, no zIIP offload, no BASEPOL rule matches OMVS.
export const BOOKING_APP: WorkloadDef = {
  id: 'BOOKING',
  name: 'Branch appointment booking',
  stakeholder: 'Retail',
  subsystem: 'OMVS',
  work: { subsystem: 'OMVS', UI: 'BOOKSVC' },
  peakRatePerSec: 60,
  shape: { floor: 0.05, peaks: [{ hour: 10, height: 1, widthHours: 2.5 }, { hour: 14, height: 0.8, widthHours: 2 }], weekly: [1, 1, 1, 1, 1, 0.4, 0.3], payday: 1, monthEnd: 1 },
  growthPerDay: 0,
  noiseSigma: 0.1,
  noisePhi: 0.95,
  routing: { PROD1: 1 },
  cpuMsRef: 3,
  cpuSigma: 0.6,
  ziipFrac: 0,
  ioPerTxn: 4,
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
    mechanisms: ['CF_SERVICE', 'LOCK_CONTENTION'],
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
    id: 'CF_FAILURE',
    name: 'Coupling facility CF01 failure',
    category: 'HARDWARE',
    minDay: 10,
    weight: 0.6,
    trigger: 'HARDWARE_FAULT',
    affects: ['RBANK', 'CARDAUTH', 'MOBILE', 'TELLER', 'PAYMQ'],
    startHour: [8, 18],
    durationHours: 3,
    begin: [{ kind: 'FAIL_CF', lparId: 'CF01', failed: true }],
    end: [{ kind: 'FAIL_CF', lparId: 'CF01', failed: false }],
    fix: null,
    forewarning: null,
    announcement: 'HMC: "CF01 has stopped responding. XES is rebuilding its structures."',
    clue: 'CF Activity: CF01 missing; its structures now in CF02 (shared, slow) with high sync service and async conversion. Any structure that could not be rebuilt is lost (console). After CF01 is back, structures stay where they were rebuilt until moved.',
  },
  {
    id: 'DASD_DEGRADED',
    name: 'Storage array back-end degraded',
    category: 'HARDWARE',
    minDay: 8,
    weight: 1.2,
    trigger: 'HARDWARE_FAULT',
    affects: ['RBANK', 'TELLER', 'PAYMQ', 'MOBILE'],
    mechanisms: ['IO'],
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
    id: 'REORG_OVERRUN',
    name: 'Db2 REORG overruns into the batch window',
    category: 'SOFTWARE',
    minDay: 6,
    weight: 1,
    trigger: 'BATCH_OVERLAP',
    affects: [],
    startHour: [20.5, 22.5],
    durationHours: 3,
    // FICTIONAL magnitude: enough utility I/O on LCU 21's hot volumes to exhaust its 21 aliases.
    begin: [{ kind: 'SET_LCU', lcuId: '21', extraIops: { SEQ: 55_000 } }],
    end: [{ kind: 'SET_LCU', lcuId: '21', extraIops: {} }],
    fix: 'TERM_UTILITY',
    forewarning: 'DBA team: "Online REORG of the settlement table spaces tonight; it should finish before batch."',
    announcement: null,
    clue: 'DASD Activity LCU summary: LCU 21 IOSQ high with ~0.7 aliases per hot volume while other LCUs are idle; batch elapsed stretches (SMF 30). Fixes: move aliases to LCU 21, or -TERM UTILITY.',
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
    mechanisms: ['LOCK_CONTENTION'],
    startHour: [20.5, 23],
    durationHours: 3,
    begin: [{ kind: 'SET_LOCK_BOOST', value: 6 }],
    end: [{ kind: 'SET_LOCK_BOOST', value: 0 }],
    fix: null,
    forewarning: null,
    announcement: null,
    clue: 'Card auth response time up with little CPU delay; UNK delay up; IRLM healthy; batch running.',
  },
  {
    // A data-science team runs model training from TSO. On DEVT (uncapped, F9) it steals CPC capacity from PROD
    // through PR/SM; on PROD the developers' importance-2 class (F5) competes directly.
    id: 'SHADOW_IT',
    name: 'Unapproved model training on TSO',
    category: 'WORKLOAD',
    minDay: 5,
    weight: 1.5,
    trigger: 'NEW_WORKLOAD',
    affects: ['MOBILE', 'RBANK'],
    startHour: [8, 11],
    durationHours: 8,
    begin: [mod('cpu', 'TSO', 8)],
    end: [mod('cpu', 'TSO', 1)],
    fix: 'STOP_SHADOW_IT',
    forewarning: null,
    announcement: null,
    clue: 'Partition Data: DEVT MSU jumps while PROD LPARs lose share; TSO APPL% ×8 with END/S flat. Capping DEVT or lowering TSO importance also contains it.',
  },
  {
    // A teller program release that is not threadsafe runs on the QR TCB (CICS serialises it there).
    id: 'QR_RELEASE',
    name: 'Non-threadsafe teller release',
    category: 'SOFTWARE',
    minDay: 7,
    weight: 1.2,
    trigger: 'POLICY',
    affects: ['TELLER', 'RBANK'],
    mechanisms: ['QR_TCB', 'THREAD_LIMIT'],
    startHour: [6.5, 7.5],
    durationHours: 36,
    begin: [
      { kind: 'SET_CICS', name: 'CICSAOR1', qrFrac: 0.95 },
      { kind: 'SET_CICS', name: 'CICSAOR3', qrFrac: 0.95 },
    ],
    end: [
      { kind: 'SET_CICS', name: 'CICSAOR1', qrFrac: 0.6 },
      { kind: 'SET_CICS', name: 'CICSAOR3', qrFrac: 0.6 },
    ],
    fix: 'ROLLBACK_TELLER_RELEASE',
    forewarning: 'Change board: "Teller front-end release 4.2 goes into the PROD1 regions overnight."',
    announcement: null,
    clue: 'CICS report: QR wait per transaction up in CICSAOR1/3 (PROD1) only, CPU delay low; PROD2 regions fine. Routing more work to PROD2 or adding a region also helps.',
  },
  {
    // A new internal app goes live with no classification rule, so its work lands in SYSOTHER (discretionary).
    id: 'NEW_APP_GOLIVE',
    name: 'New branch booking app goes live',
    category: 'WORKLOAD',
    minDay: 9,
    weight: 1.2,
    trigger: 'NEW_WORKLOAD',
    affects: ['BOOKING'],
    startHour: [8, 10],
    durationHours: null, // the app stays; the fix is a classification rule
    oncePerRun: true,
    begin: [{ kind: 'ADD_WORKLOAD', workload: BOOKING_APP }],
    end: [],
    fix: null,
    forewarning: 'Retail: "Branch booking goes live tomorrow, it\'s a small Java service, nothing to worry about."',
    announcement: null,
    clue: 'WLMGL: SYSOTHER service ≠ 0 on PROD1; the new work has no classification rule. Fixes: add a rule into a goal class, or a report class first to measure it.',
  },
  {
    // FICTIONAL: a cooling fault drops the CPC one capacity setting for the afternoon.
    id: 'POWER_CAP',
    name: 'Data centre power cap',
    category: 'HARDWARE',
    minDay: 10,
    weight: 0.8,
    trigger: 'HARDWARE_FAULT',
    affects: ['MOBILE', 'RBANK'],
    startHour: [12, 16],
    durationHours: 6,
    capacityDrop: 1,
    begin: [],
    end: [],
    fix: null,
    forewarning: null,
    announcement: 'Facilities: "Cooling fault on the raised floor; the CPC is running at reduced capacity until the chiller is fixed."',
    clue: 'SYSINFO / Partition Data: same engines but every LPAR delivers less MSU; CPU delay rises everywhere at once. Fixes: cap or quiesce DEVT, defer discretionary batch, protect importance-1 work.',
  },
  {
    // A month-old HSM migration policy change makes hundreds of users' data sets recall from ML2 at once.
    id: 'HSM_RECALL_STORM',
    name: 'DFSMShsm recall storm',
    category: 'SOFTWARE',
    minDay: 4,
    weight: 1,
    // Closest existing trigger: a surge of user-driven demand (no dedicated policy-side trigger fits a month-old change).
    trigger: 'DEMAND_SURGE',
    // I/O only: without the mechanism filter this card stole the blame for an unrelated CPU meltdown (textbook seed 7).
    affects: ['RBANK', 'TELLER', 'PAYMQ', 'MOBILE'],
    mechanisms: ['IO'],
    startHour: [7, 10],
    durationHours: 2.5,
    // FICTIONAL magnitude: 60_000 random I/Os per second on LCU 30 roughly doubles its response at day-0 load. The
    // curve is a cliff just above (75k ≈ 15×), and nightly growth moves the cliff closer, so stay below it.
    begin: [{ kind: 'SET_LCU', lcuId: '30', extraIops: { RANDOM: 60_000 } }],
    end: [{ kind: 'SET_LCU', lcuId: '30', extraIops: {} }],
    fix: 'HOLD_HSM_RECALLS',
    forewarning: null,
    announcement: null,
    clue: 'DASD Activity: LCU 30 (system + catalogs) IOSQ and RESP up with random I/O ×n while Db2 LCUs are normal; everything that opens data sets slows. Fixes: hold HSM recalls, or move aliases to LCU 30.',
  },
  {
    id: 'CP_SPARING',
    name: 'CP failure, transparent sparing',
    category: 'HARDWARE',
    minDay: 3,
    weight: 0.6,
    trigger: 'HARDWARE_FAULT',
    affects: [],
    startHour: [0, 23],
    durationHours: 0.1,
    begin: [{ kind: 'NOTE', text: 'HMC: CP 05 failed; spare PU assigned transparently. No action needed.' }],
    end: [],
    fix: null,
    forewarning: null,
    announcement: 'Hardware: "HMC reported a CP failure; the spare took over. IBM will replace the part at the next service window."',
    clue: 'HMC message only: no performance impact. A red herring if you are chasing another problem.',
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
