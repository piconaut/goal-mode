import type { Mechanism, Trigger } from '../game/types';

/** What a pinned data point measures, and which root causes it is evidence for (SPEC §10). */
export type EvidenceMetric =
  | 'PI'
  | 'VELOCITY'
  | 'APPL'
  | 'ENDED_RATE'
  | 'DELAY_CPU'
  | 'DELAY_ZIIP'
  | 'DELAY_IO'
  | 'DELAY_STO'
  | 'DELAY_CAP'
  | 'DELAY_OTHER'
  | 'PRSM_DELAY'
  | 'CAPPED'
  | 'CPC_BUSY'
  | 'LPAR_BUSY'
  | 'CAPACITY_ADJ'
  | 'APPL_CP'
  | 'APPL_IIP'
  | 'IIPCP'
  | 'CPU_VS_BASE'
  | 'LOCK_WAIT'
  | 'SYNC_IO'
  | 'CF_WAIT'
  | 'DBAT_QUEUE'
  | 'QR_WAIT'
  | 'MXT_WAIT'
  | 'FAIL_PCT'
  | 'JOB_CPU'
  | 'JOB_IO'
  | 'JOB_LOCK'
  | 'JOB_DB2'
  | 'JOB_SWAP'
  | 'JOB_INIT'
  | 'JOB_ABEND';

export interface EvidenceMetricDef {
  label: string;
  unit: string;
  mechanisms: Mechanism[];
  triggers: Trigger[];
  /** Below this the value is not notable enough to count as evidence. */
  notableAt: number;
  /** Specific clues count fully; catch-all ones (other/UNK delay) count half. */
  weight: number;
  /** Server-side clues may sit on a different subject than the hurt workload (e.g. Db2 address spaces). */
  anySubject?: boolean;
  /** The subject is a CPC, not a service class or image: relevant when one of the incident's images is on it. */
  cpcSubject?: boolean;
}

// FICTIONAL thresholds: roughly where a performance analyst would start to call a value abnormal.
export const EVIDENCE_METRICS: Record<EvidenceMetric, EvidenceMetricDef> = {
  PI: { label: 'PI', unit: '', mechanisms: [], triggers: [], notableAt: 1.2, weight: 0 },
  VELOCITY: { label: 'velocity %', unit: '%', mechanisms: [], triggers: [], notableAt: 0, weight: 0 },
  // A competing class's CPU is evidence for CPU_PRIORITY too ("who was ahead of it in the queue?", playtest D4/D19):
  // APPL is accepted on any subject at half weight because it only shows the work existed, not that it was ahead.
  // Like every `anySubject` metric it must still be pinned from an image the hurt work runs on (RT-03), and a row
  // below 5 % is too small to be the contender ("SYSP SYSTEM#1 APPL 3.4 %" says nothing about MOBILE).
  APPL: { label: 'APPL %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'ACCESS_PATH_REGRESSION'], notableAt: 5, weight: 0.5, anySubject: true },
  // The CP/zIIP split of APPL% (A11, ZIIP_LOSS): IIPCP is the zIIP-eligible time that ran on general CPs.
  APPL_CP: { label: 'APPL % CP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'ACCESS_PATH_REGRESSION'], notableAt: 5, weight: 0.5, anySubject: true },
  APPL_IIP: { label: 'APPL % IIP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'ACCESS_PATH_REGRESSION'], notableAt: 5, weight: 0.5, anySubject: true },
  IIPCP: { label: 'APPL % IIPCP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'ACCESS_PATH_REGRESSION'], notableAt: 5, weight: 0.5, anySubject: true },
  ENDED_RATE: { label: 'ended/s', unit: '/s', mechanisms: [], triggers: ['DEMAND_SURGE'], notableAt: 0, weight: 0.5 },
  DELAY_CPU: { label: 'CPU delay %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY', 'DEPENDENCY'], triggers: [], notableAt: 10, weight: 1, anySubject: true },
  DELAY_ZIIP: { label: 'zIIP delay %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: [], notableAt: 10, weight: 1 },
  DELAY_IO: { label: 'I/O delay %', unit: '%', mechanisms: ['IO'], triggers: ['HARDWARE_FAULT'], notableAt: 10, weight: 1 },
  DELAY_STO: { label: 'storage delay %', unit: '%', mechanisms: ['STORAGE'], triggers: [], notableAt: 5, weight: 1 },
  DELAY_CAP: { label: 'CAP delay %', unit: '%', mechanisms: ['CAPPING'], triggers: [], notableAt: 5, weight: 1 },
  DELAY_OTHER: { label: 'other/UNK delay %', unit: '%', mechanisms: ['DEPENDENCY', 'LOCK_CONTENTION', 'CF_SERVICE', 'QR_TCB', 'THREAD_LIMIT'], triggers: [], notableAt: 20, weight: 0.5 },
  PRSM_DELAY: { label: 'PR/SM delay %', unit: '%', mechanisms: ['CPU_CAPACITY'], triggers: [], notableAt: 8, weight: 1 },
  CAPPED: { label: '% capped', unit: '%', mechanisms: ['CAPPING'], triggers: [], notableAt: 5, weight: 1 },
  // The facts that separate capacity from priority (A11): a busy CPC or image is capacity; capping and PR/SM delay
  // are the other two. The CPC's two are about the processor, so they relate through the incident's images.
  CPC_BUSY: { label: 'CP busy %', unit: '%', mechanisms: ['CPU_CAPACITY'], triggers: [], notableAt: 90, weight: 1, cpcSubject: true },
  LPAR_BUSY: { label: 'image busy %', unit: '%', mechanisms: ['CPU_CAPACITY'], triggers: [], notableAt: 95, weight: 1 },
  /** 100 − SMF70CAI: how much capacity the processor lost against its normal setting (POWER_CAP). */
  CAPACITY_ADJ: { label: 'capacity adjusted %', unit: '%', mechanisms: ['CPU_CAPACITY'], triggers: ['HARDWARE_FAULT'], notableAt: 1, weight: 1, cpcSubject: true },
  CPU_VS_BASE: { label: 'CPU/txn vs baseline', unit: '×', mechanisms: ['CPU_CAPACITY'], triggers: ['ACCESS_PATH_REGRESSION', 'RUNAWAY_WORK'], notableAt: 1.3, weight: 1 },
  LOCK_WAIT: { label: 'lock wait ms/txn', unit: 'ms', mechanisms: ['LOCK_CONTENTION'], triggers: ['BATCH_OVERLAP'], notableAt: 2, weight: 1, anySubject: true },
  SYNC_IO: { label: 'sync I/O ms/txn', unit: 'ms', mechanisms: ['IO'], triggers: ['HARDWARE_FAULT'], notableAt: 5, weight: 1 },
  CF_WAIT: { label: 'CF ms/txn', unit: 'ms', mechanisms: ['CF_SERVICE'], triggers: ['HARDWARE_FAULT'], notableAt: 5, weight: 1, anySubject: true },
  DBAT_QUEUE: { label: 'DBAT queue ms/txn', unit: 'ms', mechanisms: ['THREAD_LIMIT'], triggers: [], notableAt: 5, weight: 1 },
  QR_WAIT: { label: 'QR wait ms/txn', unit: 'ms', mechanisms: ['QR_TCB'], triggers: [], notableAt: 5, weight: 1 },
  MXT_WAIT: { label: 'MXT wait ms/txn', unit: 'ms', mechanisms: ['THREAD_LIMIT'], triggers: [], notableAt: 5, weight: 1 },
  FAIL_PCT: { label: 'failed % of transactions', unit: '%', mechanisms: ['ROUTING'], triggers: [], notableAt: 1, weight: 1 },
  // SMF 30 batch night (critical jobs): share of their lost elapsed time by cause, mapped as batchMissMechanism does.
  JOB_CPU: { label: 'critical jobs CPU wait %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: [], notableAt: 25, weight: 1 },
  JOB_IO: { label: 'critical jobs I/O wait %', unit: '%', mechanisms: ['IO'], triggers: ['HARDWARE_FAULT'], notableAt: 25, weight: 1 },
  JOB_LOCK: { label: 'critical jobs Db2 lock wait %', unit: '%', mechanisms: ['LOCK_CONTENTION'], triggers: ['BATCH_OVERLAP'], notableAt: 25, weight: 1 },
  JOB_DB2: { label: 'critical jobs Db2 wait %', unit: '%', mechanisms: ['DEPENDENCY'], triggers: [], notableAt: 25, weight: 1 },
  JOB_SWAP: { label: 'critical jobs swap wait %', unit: '%', mechanisms: ['STORAGE'], triggers: [], notableAt: 25, weight: 1 },
  JOB_INIT: { label: 'critical jobs initiator wait %', unit: '%', mechanisms: ['THREAD_LIMIT'], triggers: [], notableAt: 25, weight: 1 },
  JOB_ABEND: { label: 'critical jobs ABENDed', unit: '', mechanisms: ['JOB_FAILURE'], triggers: ['APPLICATION_ERROR'], notableAt: 1, weight: 1 },
};

/** SMF 30 night metric → cause key in the night summary's critical delay accounting. */
export const JOB_DELAY_METRICS = { JOB_CPU: 'cpu', JOB_IO: 'io', JOB_LOCK: 'lock', JOB_DB2: 'db2', JOB_SWAP: 'swap', JOB_INIT: 'init' } as const;

// FICTIONAL: RCA evidence economy.
export const EVIDENCE = {
  /** Pins kept on the board. */
  maxPins: 12,
  /** Pins attachable to one RCA. */
  perRca: 3,
  /** A pin counts if taken within this many hours of the incident window. */
  windowHours: 1,
  /** Score points per unit of evidence relevance (only with the right mechanism). */
  pointsPerRelevance: 1,
  /** Extra Insight for "strong evidence": total relevance at least this. */
  strongAt: 2,
  strongInsight: 5,
  // FICTIONAL: a grouped RCA (one cause, several incidents) earns its trust reward once per incident it covers, so
  // grouping removes the write-ups but not the credit (user decision 2026-10-27). Penalties are not scaled.
  groupTrustPerIncident: 1,
};
