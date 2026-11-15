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
  | 'CPU_PER_TXN'
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
  APPL: { label: 'APPL %', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'CHANGE_REGRESSION'], notableAt: 5, weight: 0.5, relations: OWN_OR_COMPETITOR },
  // The CP/zIIP split of APPL% (A11, ZIIP_LOSS): IIPCP is the zIIP-eligible time that ran on general CPs.
  APPL_CP: { label: 'APPL % CP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'CHANGE_REGRESSION'], notableAt: 5, weight: 0.5, relations: OWN_OR_COMPETITOR },
  APPL_IIP: { label: 'APPL % IIP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'CHANGE_REGRESSION'], notableAt: 5, weight: 0.5, relations: OWN_OR_COMPETITOR },
  IIPCP: { label: 'APPL % IIPCP', unit: '%', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['RUNAWAY_WORK', 'DEMAND_SURGE', 'CHANGE_REGRESSION'], notableAt: 5, weight: 0.5, relations: OWN_OR_COMPETITOR },
  // A co-hosted workload's arrivals are the surge that hurt its neighbour (§4.4's collateral victim), so another class's
  // ended rate is accepted too (RT-13).
  ENDED_RATE: { label: 'ended/s', unit: '/s', mechanisms: [], triggers: ['DEMAND_SURGE'], notableAt: 0, weight: 0.5, relations: OWN_OR_COMPETITOR },
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
  CPU_VS_BASE: { label: 'CPU/txn vs baseline', unit: '×', mechanisms: ['CPU_CAPACITY'], triggers: ['CHANGE_REGRESSION', 'RUNAWAY_WORK'], notableAt: 1.3, weight: 1, relations: OWN },
  // Workload Activity's APPL% CP over END/S (RT-13): the tier-0 CPU per transaction, in CP milliseconds, judged against
  // the row's own recent normal. CP only: APPL% CP already holds the IIPCP subset, and work that lost its zIIP
  // offload costs more CP per transaction (RMF Report Analysis p.530 END/S, p.534 APPL%). FICTIONAL line.
  CPU_PER_TXN: { label: 'CP ms/txn', unit: 'ms', mechanisms: [], triggers: ['CHANGE_REGRESSION'], notableAt: 0, notableMultiple: 1.3, weight: 1, relations: OWN_OR_COMPETITOR },
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
  // 10–14 % (MONAGENT) normal, 90 % under XLOG_LOOP and 30–37 % of an engine under MONITOR_CREEP (the decayed window
  // reads about 30 % an hour after the card starts and settles in the low-to-mid 30s; the reading moves with how much
  // of the window the card fills); READY max 2.5 % midwest / 1.3 % revenue / 85 % harbourline (rows whose healthy
  // scale differs, hence the row's own baseline too); LOCK max 27.9 / 22.5 / 34.5 % normal and 39–54 % under
  // LOCK_ESCALATION; FICTIONAL.
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
  /** Extra Insight for "strong evidence": both filed claims proven by their recipes (RT-13; PROOF has the points). */
  strongInsight: 5,
  // FICTIONAL: a grouped RCA (one cause, several incidents) earns its trust reward once per incident it covers, so
  // grouping removes the write-ups but not the credit (user decision 2026-10-27). Penalties are not scaled.
  groupTrustPerIncident: 1,
};

// ---------------------------------------------------------------------------------------------------------------
// Proof recipes (RT-13, docs/rca-design.md §4.6): evidence supports a claim when the attached pins satisfy both
// predicates of the claim's recipe, the symptom on the right subject and the discriminator against its nearest
// look-alike (or a ruling-out reading where no report shows the cause directly). A pin may serve a predicate in each
// of the two recipes an RCA is judged on (the mechanism's and the trigger's), which is how three pins carry both.

/** How a predicate reads one pin's value. `rate` reads the ended rate printed on the same row as a cost pin (a
 * `CPU_PER_TXN` or `CPU_VS_BASE` pin carries it), so one Workload Activity or Db2 101 row can show "more work at the
 * same cost" or "the same work at more cost" on its own. */
export type PinTest =
  /** value ≥ v */
  | { kind: 'atLeast'; value: number }
  /** value < v: a ruling-out reading ("its CPU delay was low"). */
  | { kind: 'below'; value: number }
  /** past the metric's own notable line (and its row multiple, where the metric has one) */
  | { kind: 'notable' }
  /** value ≥ ratio × the row's recent normal (a ratio metric's normal is 1) */
  | { kind: 'ratioAtLeast'; ratio: number }
  /** within ±band of the row's recent normal */
  | { kind: 'normal'; band: number }
  /** value − the row's recent normal ≥ points (APPL% points: 100 = one engine) */
  | { kind: 'riseBy'; points: number }
  /** value ≥ frac of the pinned image's online logical CPs (APPL% and EAppl %: 100 = one engine) */
  | { kind: 'shareOfImage'; frac: number }
  /** a Workload Activity or SMF row with no earlier report rows, pinned after the report had them for other rows */
  | { kind: 'noHistory' };

export interface PredicateOption {
  metric: EvidenceMetric;
  relations: PinRelation[];
  test: PinTest;
  /** Judge the row's ended rate rather than the pinned value (cost pins only). */
  reading?: 'rate';
  /** The row must be a batch class: one a JES classification rule assigns. */
  batchClass?: true;
  /** The row's period must be less important than the hurt work's (a higher importance number, or discretionary):
   * work WLM could have taken the CPU from. */
  displaceable?: true;
}

export interface ProofPredicate {
  /** What the player must show, in report terms; the reply ticks it. */
  label: string;
  options: PredicateOption[];
}

export interface ProofRecipe {
  /** Symptom first, discriminator second. */
  predicates: [ProofPredicate, ProofPredicate];
}

// FICTIONAL lines, the design's (§4.6 table): roughly where an analyst would call the reading abnormal or flat.
export const PROOF = {
  delayPct: 10,
  jobWaitPct: 25,
  imageShareFrac: 0.1,
  busyPct: 90,
  cappedPct: 5,
  capDelayPct: 5,
  otherDelayPct: 20,
  readyLowPct: 5,
  normalBand: 0.15,
  surgeRatio: 1.25,
  regressionRatio: 1.3,
  /** Half an engine, in APPL% points. */
  runawayPoints: 50,
  /** A complete recipe for the filed, accepted mechanism is worth this many points (three fully relevant pins). */
  recipePoints: 3,
  /** A recipe with one predicate shown is worth what one non-specific pin was (§4.6: "a lone symptom pin"). */
  partialPoints: 0.5,
};

const at = (metric: EvidenceMetric, value: number, relations: PinRelation[], extra: Partial<PredicateOption> = {}): PredicateOption => ({ metric, relations, test: { kind: 'atLeast', value }, ...extra });
const below = (metric: EvidenceMetric, value: number, relations: PinRelation[]): PredicateOption => ({ metric, relations, test: { kind: 'below', value } });
const notable = (metric: EvidenceMetric, relations: PinRelation[]): PredicateOption => ({ metric, relations, test: { kind: 'notable' } });
const normal = (metric: EvidenceMetric, relations: PinRelation[], reading?: 'rate'): PredicateOption => ({ metric, relations, test: { kind: 'normal', band: PROOF.normalBand }, ...(reading ? { reading } : {}) });
const ratio = (metric: EvidenceMetric, r: number, relations: PinRelation[], reading?: 'rate'): PredicateOption => ({ metric, relations, test: { kind: 'ratioAtLeast', ratio: r }, ...(reading ? { reading } : {}) });

const SELF: PinRelation[] = ['self'];
const SELF_OR_COMPETITOR: PinRelation[] = ['self', 'competitor'];

/** The hurt work waited for CPU: its own row or its regions' (a CICS transaction row has no CPU delay of its own). */
const CPU_DELAYED: ProofPredicate = {
  label: 'CPU or zIIP delay ≥ 10 % on the hurt class or its regions (WLMGL, DELAY), or the critical jobs\' CPU wait ≥ 25 % (SMF 30)',
  options: [at('DELAY_CPU', PROOF.delayPct, OWN), at('DELAY_ZIIP', PROOF.delayPct, OWN), at('JOB_CPU', PROOF.jobWaitPct, SELF)],
};

/** A ruling-out reading: the hurt work was not waiting for CPU itself. READY is a CICS transaction class's own
 * CPU-dispatch share (its row carries no CPU delay, RMF Report Analysis p.536–537). */
const OWN_CPU_LOW: ProofPredicate = {
  label: 'the hurt class\'s own CPU delay < 10 % (WLMGL), its READY state < 5 % (CICS), or the jobs\' CPU wait < 25 % (SMF 30)',
  options: [below('DELAY_CPU', PROOF.delayPct, SELF), below('WM_READY', PROOF.readyLowPct, SELF), below('JOB_CPU', PROOF.jobWaitPct, SELF)],
};

/** The hurt work missed: its goal, or a delay or wait past that metric's own line, on its own rows. */
const HURT: ProofPredicate = {
  label: 'the hurt work delayed: PI ≥ 1.2, or any delay or wait past its line, on its own row',
  options: [
    notable('PI', SELF),
    ...(['DELAY_CPU', 'DELAY_ZIIP', 'DELAY_IO', 'DELAY_STO', 'DELAY_CAP', 'DELAY_OTHER', 'WM_LOCK', 'WM_READY', 'LOCK_WAIT', 'SYNC_IO', 'CF_WAIT', 'QR_WAIT', 'MXT_WAIT', 'DBAT_QUEUE', 'FAIL_PCT'] as const)
      .map((m) => notable(m, OWN)),
    ...(['JOB_CPU', 'JOB_IO', 'JOB_LOCK', 'JOB_DB2', 'JOB_SWAP', 'JOB_INIT', 'JOB_ABEND'] as const).map((m) => notable(m, SELF)),
    notable('SOS_MIN', ['server']),
  ],
};

/** Neither more work nor costlier work: the row's ended rate or CPU per transaction at its recent normal. */
const DEMAND_NORMAL: ProofPredicate = {
  label: 'the work itself unchanged: its ended/s or CPU per transaction within ±15 % of normal (WLMGL, Db2 101, CICS 110)',
  options: [normal('ENDED_RATE', SELF), normal('CPU_PER_TXN', SELF), normal('CPU_VS_BASE', SELF), normal('CPU_PER_TXN', SELF, 'rate'), normal('CPU_VS_BASE', SELF, 'rate')],
};

const mechanismRecipes: Record<Mechanism, ProofRecipe> = {
  CPU_CAPACITY: { predicates: [CPU_DELAYED, {
    label: 'the processor full: CPC or image busy ≥ 90 %, or a capacity adjustment below 100 (Partition Data, CPC)',
    options: [at('CPC_BUSY', PROOF.busyPct, HOST_ONLY), at('LPAR_BUSY', PROOF.busyPct, HOST_ONLY), at('CAPACITY_ADJ', 1, HOST_ONLY)],
  }] },
  // A less important period of the work's own class counts too (ADHOC's long queries in DDFPRD#2 behind MOBILE's
  // DDFPRD#1): the row relates as `self`, but WLM could have taken its CPU.
  CPU_PRIORITY: { predicates: [CPU_DELAYED, {
    label: 'a displaceable consumer on that host: a less important class or job using ≥ 10 % of the image (WLMGL APPL, PROCU)',
    options: [
      { metric: 'APPL', relations: SELF_OR_COMPETITOR, test: { kind: 'shareOfImage', frac: PROOF.imageShareFrac }, displaceable: true },
      { metric: 'APPL_CP', relations: SELF_OR_COMPETITOR, test: { kind: 'shareOfImage', frac: PROOF.imageShareFrac }, displaceable: true },
      { metric: 'JOB_APPL', relations: ['competitor'], test: { kind: 'shareOfImage', frac: PROOF.imageShareFrac }, displaceable: true },
    ],
  }] },
  // APPROX: defined capacity and group capacity limit general-CP MSU, so the cap's symptom is CP delay, not zIIP (an
  // absolute cap on a zIIP pool exists but no card here sets one).
  CAPPING: { predicates: [{
    label: 'CPU delay ≥ 10 % on the hurt class or its regions (WLMGL, DELAY), or the critical jobs\' CPU wait ≥ 25 % (SMF 30)',
    options: [at('DELAY_CPU', PROOF.delayPct, OWN), at('JOB_CPU', PROOF.jobWaitPct, SELF)],
  }, {
    label: 'a cap held it: the image capped ≥ 5 % of the interval (Partition Data), or CAP delay ≥ 5 % on the class (WLMGL)',
    options: [at('CAPPED', PROOF.cappedPct, HOST_ONLY), at('DELAY_CAP', PROOF.capDelayPct, SELF)],
  }] },
  DEPENDENCY: { predicates: [{
    label: 'the server slow: a serving region delayed ≥ 10 %, the work waiting outside CPU and I/O (other/UNK ≥ 20 %), or the jobs waiting on Db2 ≥ 25 %',
    options: [at('DELAY_CPU', PROOF.delayPct, ['server']), at('DELAY_ZIIP', PROOF.delayPct, ['server']), at('DELAY_OTHER', PROOF.otherDelayPct, SELF), at('JOB_DB2', PROOF.jobWaitPct, SELF)],
  }, OWN_CPU_LOW] },
  LOCK_CONTENTION: { predicates: [{
    label: 'lock waits on the hurt work: Db2 lock wait ≥ 2 ms/txn (Db2 101), LOCK state ≥ 35 % (WLMGL), or the jobs\' lock wait ≥ 25 % (SMF 30)',
    options: [notable('LOCK_WAIT', SELF), notable('WM_LOCK', SELF), notable('JOB_LOCK', SELF)],
  }, OWN_CPU_LOW] },
  CF_SERVICE: { predicates: [{
    label: 'CF time per transaction ≥ 5 ms (Db2 101)',
    options: [notable('CF_WAIT', SELF)],
  }, {
    label: 'the CF itself slow: sync service time or async conversion past twice its normal (CF Activity)',
    options: [notable('CF_SYNC', ['server']), notable('CF_ASYNC_PCT', ['server'])],
  }] },
  QR_TCB: { predicates: [{
    label: 'QR TCB wait ≥ 5 ms/txn (CICS 110), or the READY state past twice its normal (WLMGL)',
    options: [notable('QR_WAIT', SELF), notable('WM_READY', SELF)],
  }, {
    label: 'not the task limit or the CPU: MXT wait < 5 ms/txn (CICS 110), or the regions\' CPU delay < 10 % (WLMGL)',
    options: [below('MXT_WAIT', 5, SELF), below('DELAY_CPU', PROOF.delayPct, ['server'])],
  }] },
  THREAD_LIMIT: { predicates: [{
    label: 'queued for a slot: MXT wait or DBAT queue ≥ 5 ms/txn, the region short on storage (SOS), or the jobs\' initiator wait ≥ 25 %',
    options: [notable('MXT_WAIT', SELF), notable('DBAT_QUEUE', SELF), notable('SOS_MIN', ['server']), notable('JOB_INIT', SELF)],
  }, {
    label: 'not slower work holding the slots: CPU per transaction within ±15 % of normal, QR wait < 5 ms/txn, or the jobs\' CPU wait < 25 %',
    options: [normal('CPU_VS_BASE', SELF), normal('CPU_PER_TXN', SELF), below('QR_WAIT', 5, SELF), below('JOB_CPU', PROOF.jobWaitPct, SELF)],
  }] },
  ROUTING: { predicates: [{
    label: 'transactions failed: failed share ≥ 1 % (CICS 110)',
    options: [notable('FAIL_PCT', SELF)],
  }, {
    label: 'the work itself unchanged: its CPU per transaction within ±15 % of normal (CICS 110, Db2 101)',
    options: [normal('CPU_VS_BASE', SELF), normal('CPU_PER_TXN', SELF)],
  }] },
  IO: { predicates: [{
    label: 'I/O waits on the hurt work: I/O delay ≥ 10 % (WLMGL), sync I/O ≥ 5 ms/txn (Db2 101), or the jobs\' I/O wait ≥ 25 % (SMF 30)',
    options: [notable('DELAY_IO', SELF), notable('SYNC_IO', SELF), notable('JOB_IO', SELF)],
  }, {
    label: 'DASD itself slow: DISC, IOSQ or response time past twice its normal on an LCU or all volumes (DASD Activity)',
    options: [notable('DASD_DISC', ['server']), notable('DASD_IOSQ', ['server']), notable('DASD_RESP', ['server'])],
  }] },
  STORAGE: { predicates: [{
    label: 'storage waits: storage delay ≥ 5 % (WLMGL), a serving region short on storage (CICS SOS), or the jobs\' swap wait ≥ 25 %',
    options: [notable('DELAY_STO', SELF), notable('SOS_MIN', ['server']), notable('JOB_SWAP', SELF)],
  }, OWN_CPU_LOW] },
  JOB_FAILURE: { predicates: [{
    label: 'critical jobs ABENDed (SMF 30)',
    options: [at('JOB_ABEND', 1, SELF)],
  }, {
    label: 'they failed rather than ran late: the jobs\' CPU or I/O wait < 25 % (SMF 30)',
    options: [below('JOB_CPU', PROOF.jobWaitPct, SELF), below('JOB_IO', PROOF.jobWaitPct, SELF)],
  }] },
};

const triggerRecipes: Record<Trigger, ProofRecipe> = {
  DEMAND_SURGE: { predicates: [{
    label: 'more work: ended/s ≥ 1.25 × its recent normal on the hurt or a co-hosted workload',
    options: [
      ratio('ENDED_RATE', PROOF.surgeRatio, SELF_OR_COMPETITOR),
      ratio('CPU_PER_TXN', PROOF.surgeRatio, SELF_OR_COMPETITOR, 'rate'),
      ratio('CPU_VS_BASE', PROOF.surgeRatio, SELF, 'rate'),
    ],
  }, {
    label: 'at the same cost: CPU per transaction within ±15 % of normal',
    options: [normal('CPU_PER_TXN', SELF_OR_COMPETITOR), normal('CPU_VS_BASE', SELF)],
  }] },
  CHANGE_REGRESSION: { predicates: [{
    label: 'the same work costs more: CPU per transaction ≥ 1.3 × its normal (WLMGL CP ms/txn, Db2 101, CICS 110)',
    options: [ratio('CPU_PER_TXN', PROOF.regressionRatio, SELF_OR_COMPETITOR), ratio('CPU_VS_BASE', PROOF.regressionRatio, SELF)],
  }, {
    label: 'not more of it: its ended/s within ±15 % of normal',
    options: [normal('ENDED_RATE', SELF_OR_COMPETITOR), normal('CPU_PER_TXN', SELF_OR_COMPETITOR, 'rate'), normal('CPU_VS_BASE', SELF, 'rate')],
  }] },
  RUNAWAY_WORK: { predicates: [{
    label: 'one class or job up by half an engine: APPL ≥ 50 points over its normal (WLMGL), or a job at ≥ 50 % EAppl CP (PROCU)',
    options: [
      { metric: 'APPL', relations: SELF_OR_COMPETITOR, test: { kind: 'riseBy', points: PROOF.runawayPoints } },
      { metric: 'APPL_CP', relations: SELF_OR_COMPETITOR, test: { kind: 'riseBy', points: PROOF.runawayPoints } },
      at('JOB_APPL', PROOF.runawayPoints, ['server', 'competitor']),
    ],
  }, {
    label: 'without more work to show for it: that class\'s ended/s flat, or the hurt work\'s own CPU per transaction within ±15 % of normal',
    options: [normal('ENDED_RATE', ['competitor']), normal('CPU_PER_TXN', SELF), normal('CPU_VS_BASE', SELF)],
  }] },
  BATCH_OVERLAP: { predicates: [{
    label: 'lock or I/O waits on the hurt work (Db2 lock wait, LOCK state, I/O delay, the jobs\' lock wait), or IOSQ past twice normal (DASD Activity)',
    options: [notable('LOCK_WAIT', SELF), notable('WM_LOCK', SELF), notable('DELAY_IO', SELF), notable('JOB_LOCK', SELF), notable('DASD_IOSQ', ['server'])],
  }, {
    label: 'batch running then: a batch class using ≥ 10 % of the image (WLMGL APPL)',
    options: [
      { metric: 'APPL', relations: SELF_OR_COMPETITOR, test: { kind: 'shareOfImage', frac: PROOF.imageShareFrac }, batchClass: true },
      { metric: 'APPL_CP', relations: SELF_OR_COMPETITOR, test: { kind: 'shareOfImage', frac: PROOF.imageShareFrac }, batchClass: true },
    ],
  }] },
  POLICY: { predicates: [HURT, DEMAND_NORMAL] },
  // Growth and the configuration are the same state when no card explains the hour (§4.4(4)): no visible data
  // separates them, so they share the recipe "hurt with nothing changed in the work".
  GROWTH: { predicates: [HURT, DEMAND_NORMAL] },
  HARDWARE_FAULT: { predicates: [{
    label: 'the resource\'s own report: CF sync time or async conversion, DASD DISC/IOSQ/response past twice normal, or a capacity adjustment below 100',
    options: [notable('CF_SYNC', ['server']), notable('CF_ASYNC_PCT', ['server']), notable('DASD_DISC', ['server']), notable('DASD_IOSQ', ['server']), notable('DASD_RESP', ['server']), at('CAPACITY_ADJ', 1, HOST_ONLY)],
  }, {
    label: 'the work itself unchanged: its ended/s or CPU per transaction within ±15 % of normal, or its own CPU delay low',
    options: [...DEMAND_NORMAL.options, ...OWN_CPU_LOW.options],
  }] },
  NEW_WORKLOAD: { predicates: [HURT, {
    label: 'work with no history: a class or workload row with no earlier report rows (WLMGL, Db2 101, CICS 110)',
    options: [
      { metric: 'APPL', relations: SELF_OR_COMPETITOR, test: { kind: 'noHistory' } },
      { metric: 'APPL_CP', relations: SELF_OR_COMPETITOR, test: { kind: 'noHistory' } },
      { metric: 'ENDED_RATE', relations: SELF_OR_COMPETITOR, test: { kind: 'noHistory' } },
    ],
  }] },
  APPLICATION_ERROR: { predicates: [{
    label: 'the software misbehaved: failed transactions ≥ 1 % (CICS 110), a region short on storage (SOS), or critical jobs ABENDed (SMF 30)',
    options: [notable('FAIL_PCT', SELF), notable('SOS_MIN', ['server']), at('JOB_ABEND', 1, SELF)],
  }, DEMAND_NORMAL] },
};

export const MECHANISM_RECIPES: Readonly<Record<Mechanism, ProofRecipe>> = mechanismRecipes;
export const TRIGGER_RECIPES: Readonly<Record<Trigger, ProofRecipe>> = triggerRecipes;

/** The lowest tool tier that can pin each metric (0 = Workload Activity, free): the tier-0/1 path test reads it, and a
 * test checks it against the pin sources. WLMGL (0); Monitor III, Partition Data, PROCU (1, RMF Monitor III and the
 * Partition Data report); CF/DASD Activity, Db2 101, CICS 110, SMF 30 (2). */
export const METRIC_TIER: Record<EvidenceMetric, 0 | 1 | 2> = {
  PI: 0, VELOCITY: 1, APPL: 0, APPL_CP: 0, APPL_IIP: 0, IIPCP: 0, ENDED_RATE: 0, CPU_PER_TXN: 0,
  DELAY_CPU: 0, DELAY_ZIIP: 0, DELAY_IO: 0, DELAY_STO: 0, DELAY_CAP: 0, DELAY_OTHER: 0, WM_LOCK: 0, WM_READY: 0,
  PRSM_DELAY: 1, CAPPED: 1, CPC_BUSY: 1, LPAR_BUSY: 1, CAPACITY_ADJ: 1, JOB_APPL: 1,
  CPU_VS_BASE: 2, LOCK_WAIT: 2, SYNC_IO: 2, CF_WAIT: 2, CF_SYNC: 2, CF_ASYNC_PCT: 2, DASD_DISC: 2, DASD_IOSQ: 2, DASD_RESP: 2,
  SOS_MIN: 2, DBAT_QUEUE: 2, QR_WAIT: 2, MXT_WAIT: 2, FAIL_PCT: 2,
  JOB_CPU: 2, JOB_IO: 2, JOB_LOCK: 2, JOB_DB2: 2, JOB_SWAP: 2, JOB_INIT: 2, JOB_ABEND: 2,
};
