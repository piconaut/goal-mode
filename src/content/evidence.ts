import type { Mechanism, Trigger } from '../game/types';

/** How a pinned value relates to the incident it is filed against (RT-12, docs/rca-design.md §4.6). A pin can only be
 * evidence for the relation its metric accepts: the hurt work's own delay is not another class's delay, and another
 * class's CPU is only the competitor's share. */
export type PinRelation = 'self' | 'server' | 'competitor' | 'host';

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
  | 'CF_SYNC'
  | 'CF_ASYNC_PCT'
  | 'DASD_DISC'
  | 'DASD_IOSQ'
  | 'DASD_RESP'
  | 'SOS_MIN'
  | 'JOB_APPL'
  | 'WM_LOCK'
  | 'WM_READY'
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
  /** Also require this multiple of the pin's own recent baseline, where one exists: one absolute line cannot serve
   * rows whose healthy scale differs (CF02's chronically slow ICF engine, one LCU against another). FICTIONAL. */
  notableMultiple?: number;
  /** Specific clues count fully; catch-all ones (other/UNK delay) count half. */
  weight: number;
  /** The relations this metric is evidence for; a pin outside them scores nothing, whatever its size. */
  relations: PinRelation[];
}

/** Symptom metrics: they say the work was hurt, not why, so any relation is "about" the incident (weight 0). */
const SYMPTOM: PinRelation[] = ['self', 'server', 'competitor', 'host'];
/** The hurt work's own rows: its class or period, a region serving it, its Db2/CICS accounting. */
const OWN: PinRelation[] = ['self', 'server'];
/** Another class's share of a host image: the competitor the policy passed over (half weight, never full). */
const OWN_OR_COMPETITOR: PinRelation[] = ['self', 'server', 'competitor'];
/** Image and processor facts. */
const HOST_ONLY: PinRelation[] = ['host'];

// FICTIONAL thresholds: roughly where a performance analyst would start to call a value abnormal.
export const EVIDENCE_METRICS: Record<EvidenceMetric, EvidenceMetricDef> = {
  PI: { label: 'PI', unit: '', mechanisms: [], triggers: [], notableAt: 1.2, weight: 0, relations: SYMPTOM },
  VELOCITY: { label: 'velocity %', unit: '%', mechanisms: [], triggers: [], notableAt: 0, weight: 0, relations: SYMPTOM },
  // A competing class's CPU is evidence for CPU_PRIORITY too ("who was ahead of it in the queue?", playtest D4/D19):
  // APPL is accepted on the hurt work, its servers and a competitor, at half weight, because it only shows the work
  // existed, not that it was ahead (RT-12 makes that relation explicit; §4.6's recipe is RT-13's). A competitor's row
  // must be pinned from an image the hurt work runs on or not at all: a `*PLEX` row cannot show where it ran. A row
  // below 5 % is too small to be the contender ("SYSP SYSTEM#1 APPL 3.4 %" says nothing about MOBILE).
  APPL: { label: 'APPL %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'ACCESS_PATH_REGRESSION'], notableAt: 5, weight: 0.5, relations: OWN_OR_COMPETITOR },
  // The CP/zIIP split of APPL% (A11, ZIIP_LOSS): IIPCP is the zIIP-eligible time that ran on general CPs.
  APPL_CP: { label: 'APPL % CP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'ACCESS_PATH_REGRESSION'], notableAt: 5, weight: 0.5, relations: OWN_OR_COMPETITOR },
  APPL_IIP: { label: 'APPL % IIP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'ACCESS_PATH_REGRESSION'], notableAt: 5, weight: 0.5, relations: OWN_OR_COMPETITOR },
  IIPCP: { label: 'APPL % IIPCP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'ACCESS_PATH_REGRESSION'], notableAt: 5, weight: 0.5, relations: OWN_OR_COMPETITOR },
  ENDED_RATE: { label: 'ended/s', unit: '/s', mechanisms: [], triggers: ['DEMAND_SURGE'], notableAt: 0, weight: 0.5, relations: OWN },
  DELAY_CPU: { label: 'CPU delay %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY', 'DEPENDENCY'], triggers: [], notableAt: 10, weight: 1, relations: OWN },
  DELAY_ZIIP: { label: 'zIIP delay %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: [], notableAt: 10, weight: 1, relations: OWN },
  DELAY_IO: { label: 'I/O delay %', unit: '%', mechanisms: ['IO'], triggers: ['HARDWARE_FAULT'], notableAt: 10, weight: 1, relations: OWN },
  DELAY_STO: { label: 'storage delay %', unit: '%', mechanisms: ['STORAGE'], triggers: [], notableAt: 5, weight: 1, relations: OWN },
  DELAY_CAP: { label: 'CAP delay %', unit: '%', mechanisms: ['CAPPING'], triggers: [], notableAt: 5, weight: 1, relations: OWN },
  DELAY_OTHER: { label: 'other/UNK delay %', unit: '%', mechanisms: ['DEPENDENCY', 'LOCK_CONTENTION', 'CF_SERVICE', 'QR_TCB', 'THREAD_LIMIT'], triggers: [], notableAt: 20, weight: 0.5, relations: OWN },
  PRSM_DELAY: { label: 'PR/SM delay %', unit: '%', mechanisms: ['CPU_CAPACITY'], triggers: [], notableAt: 8, weight: 1, relations: HOST_ONLY },
  CAPPED: { label: '% capped', unit: '%', mechanisms: ['CAPPING'], triggers: [], notableAt: 5, weight: 1, relations: HOST_ONLY },
  // The facts that separate capacity from priority (A11): a busy CPC or image is capacity; capping and PR/SM delay
  // are the other two. The CPC's two are about the processor, so they relate through the incident's images.
  CPC_BUSY: { label: 'CP busy %', unit: '%', mechanisms: ['CPU_CAPACITY'], triggers: [], notableAt: 90, weight: 1, relations: HOST_ONLY },
  LPAR_BUSY: { label: 'image busy %', unit: '%', mechanisms: ['CPU_CAPACITY'], triggers: [], notableAt: 95, weight: 1, relations: HOST_ONLY },
  /** 100 − SMF70CAI: how much capacity the processor lost against its normal setting (POWER_CAP). */
  CAPACITY_ADJ: { label: 'capacity adjusted %', unit: '%', mechanisms: ['CPU_CAPACITY'], triggers: ['HARDWARE_FAULT'], notableAt: 1, weight: 1, relations: HOST_ONLY },
  CPU_VS_BASE: { label: 'CPU/txn vs baseline', unit: '×', mechanisms: ['CPU_CAPACITY'], triggers: ['ACCESS_PATH_REGRESSION', 'RUNAWAY_WORK'], notableAt: 1.3, weight: 1, relations: OWN },
  LOCK_WAIT: { label: 'lock wait ms/txn', unit: 'ms', mechanisms: ['LOCK_CONTENTION'], triggers: ['BATCH_OVERLAP'], notableAt: 2, weight: 1, relations: OWN },
  SYNC_IO: { label: 'sync I/O ms/txn', unit: 'ms', mechanisms: ['IO'], triggers: ['HARDWARE_FAULT'], notableAt: 5, weight: 1, relations: OWN },
  CF_WAIT: { label: 'CF ms/txn', unit: 'ms', mechanisms: ['CF_SERVICE'], triggers: ['HARDWARE_FAULT'], notableAt: 5, weight: 1, relations: OWN },
  // CF Activity and DASD Activity (RT-10, A11): the resource the work waits on, so `server` clues. The CF row's own
  // recent normal is the second line (CF02 runs on a weak shared ICF), and so is the LCU's: a normal rate on one LCU
  // must not count for another's problem. Lines start at twice the busiest scenario's day-0 value (18–23 µs sync,
  // 0 % async, 0.07 ms DISC, 0 ms IOSQ, 0.22 ms response); FICTIONAL.
  CF_SYNC: { label: 'CF sync service time', unit: 'µs', mechanisms: ['CF_SERVICE'], triggers: ['HARDWARE_FAULT'], notableAt: 50, notableMultiple: 2, weight: 1, relations: ['server'] },
  CF_ASYNC_PCT: { label: 'CF async conversion', unit: '%', mechanisms: ['CF_SERVICE'], triggers: [], notableAt: 1, notableMultiple: 2, weight: 1, relations: ['server'] },
  DASD_DISC: { label: 'DISC time', unit: 'ms', mechanisms: ['IO'], triggers: ['HARDWARE_FAULT'], notableAt: 0.14, notableMultiple: 2, weight: 1, relations: ['server'] },
  DASD_IOSQ: { label: 'IOSQ time', unit: 'ms', mechanisms: ['IO'], triggers: ['DEMAND_SURGE', 'BATCH_OVERLAP'], notableAt: 0.1, notableMultiple: 2, weight: 1, relations: ['server'] },
  DASD_RESP: { label: 'device response time', unit: 'ms', mechanisms: ['IO'], triggers: [], notableAt: 0.44, notableMultiple: 2, weight: 1, relations: ['server'] },
  // CICS region storage, top-consumer job and work-manager states (RT-11, A11). SOS time is the region's, so its row
  // is the server's; a job's CPU is a specific consumer (a competitor, or a region serving the work); the two state
  // shares are the transaction class's own. READY estimates QR dispatch waits, so it is half weight (RMF Report
  // Analysis p.536–537). Lines measured on day 0 over seeds 1–5: SOS 0 min normal, 35+ min under CICS_SOS; a job
  // 10–14 % (MONAGENT) normal, 90 % under XLOG_LOOP and 33–37 % of an engine under MONITOR_CREEP once the card has
  // run an hour (its first hour is transitional); READY max 2.5 % midwest / 1.3 % revenue / 85 % harbourline (rows
  // whose healthy scale differs, hence the row's own baseline too); LOCK max 27.9 / 22.5 / 34.5 % normal and 39–54 %
  // under LOCK_ESCALATION; FICTIONAL.
  SOS_MIN: { label: 'SOS minutes', unit: 'min', mechanisms: ['THREAD_LIMIT', 'STORAGE'], triggers: ['APPLICATION_ERROR'], notableAt: 1, weight: 1, relations: ['server'] },
  JOB_APPL: { label: 'job EAppl CPU', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK'], notableAt: 25, weight: 1, relations: ['server', 'competitor'] },
  WM_LOCK: { label: 'LOCK state', unit: '%', mechanisms: ['LOCK_CONTENTION'], triggers: [], notableAt: 35, weight: 1, relations: OWN },
  WM_READY: { label: 'READY state', unit: '%', mechanisms: ['CPU_PRIORITY', 'CPU_CAPACITY', 'QR_TCB'], triggers: [], notableAt: 5, notableMultiple: 2, weight: 0.5, relations: OWN },
  DBAT_QUEUE: { label: 'DBAT queue ms/txn', unit: 'ms', mechanisms: ['THREAD_LIMIT'], triggers: [], notableAt: 5, weight: 1, relations: OWN },
  QR_WAIT: { label: 'QR wait ms/txn', unit: 'ms', mechanisms: ['QR_TCB'], triggers: [], notableAt: 5, weight: 1, relations: OWN },
  MXT_WAIT: { label: 'MXT wait ms/txn', unit: 'ms', mechanisms: ['THREAD_LIMIT'], triggers: [], notableAt: 5, weight: 1, relations: OWN },
  FAIL_PCT: { label: 'failed % of transactions', unit: '%', mechanisms: ['ROUTING'], triggers: [], notableAt: 1, weight: 1, relations: OWN },
  // SMF 30 batch night (critical jobs): share of their lost elapsed time by cause, mapped as batchMissMechanism does.
  JOB_CPU: { label: 'critical jobs CPU wait %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: [], notableAt: 25, weight: 1, relations: ['self'] },
  JOB_IO: { label: 'critical jobs I/O wait %', unit: '%', mechanisms: ['IO'], triggers: ['HARDWARE_FAULT'], notableAt: 25, weight: 1, relations: ['self'] },
  JOB_LOCK: { label: 'critical jobs Db2 lock wait %', unit: '%', mechanisms: ['LOCK_CONTENTION'], triggers: ['BATCH_OVERLAP'], notableAt: 25, weight: 1, relations: ['self'] },
  JOB_DB2: { label: 'critical jobs Db2 wait %', unit: '%', mechanisms: ['DEPENDENCY'], triggers: [], notableAt: 25, weight: 1, relations: ['self'] },
  JOB_SWAP: { label: 'critical jobs swap wait %', unit: '%', mechanisms: ['STORAGE'], triggers: [], notableAt: 25, weight: 1, relations: ['self'] },
  JOB_INIT: { label: 'critical jobs initiator wait %', unit: '%', mechanisms: ['THREAD_LIMIT'], triggers: [], notableAt: 25, weight: 1, relations: ['self'] },
  JOB_ABEND: { label: 'critical jobs ABENDed', unit: '', mechanisms: ['JOB_FAILURE'], triggers: ['APPLICATION_ERROR'], notableAt: 1, weight: 1, relations: ['self'] },
};

/** SMF 30 night metric → cause key in the night summary's critical delay accounting. */
export const JOB_DELAY_METRICS = { JOB_CPU: 'cpu', JOB_IO: 'io', JOB_LOCK: 'lock', JOB_DB2: 'db2', JOB_SWAP: 'swap', JOB_INIT: 'init' } as const;

// FICTIONAL: RCA evidence economy.
export const EVIDENCE = {
  /** Pins kept on the board. */
  maxPins: 12,
  /** Pins attachable to one RCA. */
  perRca: 3,
  // FICTIONAL: compare with six earlier report rows to smooth short spikes while following recent load.
  baselineRows: 6,
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
