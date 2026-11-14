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
  // The arrival rate is the surging work's own row, a region serving it, or (RT-13, §4.4) a co-hosted workload's:
  // collateral work pays for a burst that is not its own, and the rate is the only visible trace of it there.
  ENDED_RATE: { label: 'ended/s', unit: '/s', mechanisms: [], triggers: ['DEMAND_SURGE'], notableAt: 0, weight: 0.5, relations: ['self', 'server', 'competitor'] },
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
  // The tier-0 service-per-transaction path (RT-13): the Workload Activity report prints APPL% (CP, including the
  // IIPCP subset) and END/S, and CPU per transaction is the first divided by the second at 100 % = one engine — the
  // division the Codex END/S entry teaches. The pin is that quotient against the same row's six preceding intervals,
  // so it follows the work's own recent cost without needing Db2 or CICS accounting. APPROX: the report prints the
  // two columns, not their quotient, and a report class row needs RC_ADVISOR to stand alone.
  CPU_PER_TXN: { label: 'APPL÷ENDED vs baseline', unit: '×', mechanisms: ['CPU_CAPACITY', 'CPU_PRIORITY'], triggers: ['CHANGE_REGRESSION', 'RUNAWAY_WORK'], notableAt: 1.3, weight: 1, relations: OWN },
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
  // RT-13 replaced the per-unit line: a complete mechanism recipe pays `recipeRelevance`, an incomplete one its pins'
  // own weights (`pointsPerRelevance` would have been the multiplier and is gone with the sum it multiplied).
  /** Extra Insight for "strong evidence": total relevance at least this. */
  strongAt: 2,
  strongInsight: 5,
  // FICTIONAL: what a complete proof recipe is worth, i.e. three fully specific pins (RT-13, §4.6). A complete recipe
  // for the trigger on top of it makes the evidence strong.
  recipeRelevance: 3,
  // FICTIONAL: a lone symptom pin (PI, velocity) proves nothing about a cause, so it is worth the half weight a
  // non-specific pin earns (§4.6).
  symptomRelevance: 0.5,
  // FICTIONAL: a grouped RCA (one cause, several incidents) earns its trust reward once per incident it covers, so
  // grouping removes the write-ups but not the credit (user decision 2026-10-27). Penalties are not scaled.
  groupTrustPerIncident: 1,
};

/** How a recipe predicate tests one pinned value (RT-13, docs/rca-design.md §4.6). */
export type PredicateTest =
  /** The value is at least this big: a symptom or a specific clue. `multipleOf` also requires that multiple of the
   * row's own recent normal where a baseline exists, as the metric's `notableMultiple` does (a chronically slow CF
   * or LCU must clear its own line too). */
  | { kind: 'atLeast'; value: number; multipleOf?: number }
  /** The value is this small or smaller: a ruling-out pin ("the work's own CPU delay stayed low"). */
  | { kind: 'atMost'; value: number }
  /** The value is at least this multiple of the row's own recent normal: an arrival rate or a regression. */
  | { kind: 'multipleAtLeast'; multiple: number }
  /** The value is within this fraction of the row's own recent normal: "each transaction still cost the same". */
  | { kind: 'within'; frac: number };

/** One row that can satisfy a predicate, and the cheapest tool that reports it. */
export interface RecipeOption {
  metric: EvidenceMetric;
  /** The pin relations this option accepts (RT-12): the same row means different things by whose it is. */
  relations: PinRelation[];
  test: PredicateTest;
  /** 0 = Workload Activity (WLMGL, no tool), 1 = Monitor III or Partition Data, 2 = a paid analytics report.
   * The gate must never need tier 3 (§5.5), and every common recipe has a tier-0/1 path (user decision Q3). */
  tier: 0 | 1 | 2;
}

/** Half of a proof: a symptom on the right subject, or the discriminator that separates the claim from its
 * nearest look-alike. Satisfied when any attached pin matches one of its options. */
export interface RecipePredicate {
  label: string;
  options: RecipeOption[];
}

/** Two predicates that together prove a mechanism or a trigger from pinned report data (§4.6). */
export interface ProofRecipe {
  claim: { mechanism: Mechanism } | { trigger: Trigger };
  predicates: [RecipePredicate, RecipePredicate];
}

const SELF: PinRelation[] = ['self'];
const SELF_SERVER: PinRelation[] = ['self', 'server'];
const SERVER: PinRelation[] = ['server'];
const HOST: PinRelation[] = ['host'];
const COMPETITOR: PinRelation[] = ['competitor'];
const SELF_SERVER_COMPETITOR: PinRelation[] = ['self', 'server', 'competitor'];

const atLeast = (metric: EvidenceMetric, relations: PinRelation[], value: number, tier: RecipeOption['tier'], multipleOf?: number): RecipeOption =>
  ({ metric, relations, test: { kind: 'atLeast', value, ...(multipleOf !== undefined ? { multipleOf } : {}) }, tier });
const atMost = (metric: EvidenceMetric, relations: PinRelation[], value: number, tier: RecipeOption['tier']): RecipeOption =>
  ({ metric, relations, test: { kind: 'atMost', value }, tier });
const multipleAtLeast = (metric: EvidenceMetric, relations: PinRelation[], multiple: number, tier: RecipeOption['tier']): RecipeOption =>
  ({ metric, relations, test: { kind: 'multipleAtLeast', multiple }, tier });
const within = (metric: EvidenceMetric, relations: PinRelation[], frac: number, tier: RecipeOption['tier']): RecipeOption =>
  ({ metric, relations, test: { kind: 'within', frac }, tier });

/** The symptom half of the CPU family, from Workload Activity alone: a delay share, a cost per transaction that
 * rose, or more arrivals than the work's normal hour. The three are how the same shortage shows on the hurt work, and
 * a pin already attached for the trigger's recipe may satisfy this one too (the three-pin limit, §4.6). */
const CPU_HURT: RecipePredicate = {
  label: 'the work was hurt: CPU delay, more CPU per transaction, or more arrivals than normal',
  options: [
    atLeast('DELAY_CPU', SELF_SERVER, 10, 0),
    atLeast('DELAY_ZIIP', SELF_SERVER, 10, 0),
    atLeast('CPU_PER_TXN', SELF, 1.3, 0),
    multipleAtLeast('ENDED_RATE', SELF_SERVER, 1.25, 0),
    // A single class or job using half an engine (the runaway's own signature), and a batch night losing a quarter
    // of its critical-path time to CPU waits (the batch overlap's): both show the machine's shortage on the work.
    atLeast('APPL', SELF_SERVER_COMPETITOR, 50, 0),
    atLeast('JOB_CPU', SELF, 25, 2),
  ],
};
/** "The work itself was not the problem": the ruling-out half of the mechanisms that are not CPU. A normal reading in
 * any of these dimensions rules out the look-alike it belongs to (a CPU wait, a change, a surge), so one pin can also
 * satisfy a trigger recipe's normal half — that is how a mechanism+trigger proof stays inside the three-pin limit. */
const WORK_NORMAL: RecipePredicate = {
  label: 'the work itself was not the problem: no CPU wait, and its rate or cost per transaction was its normal',
  options: [atMost('DELAY_CPU', SELF, 10, 0), within('ENDED_RATE', SELF, 0.15, 0), within('CPU_PER_TXN', SELF, 0.15, 0)],
};
/** "The work was hurt", in any report's terms: the fallback trigger accompanies every mechanism, so its symptom half
 * cannot name one resource. */
const HURT: RecipePredicate = {
  label: "the work was hurt in some report's terms",
  options: [
    atLeast('PI', SELF_SERVER, 1.2, 0),
    atLeast('DELAY_CPU', SELF_SERVER, 10, 0),
    atLeast('DELAY_ZIIP', SELF_SERVER, 10, 0),
    atLeast('DELAY_IO', SELF_SERVER, 10, 0),
    atLeast('DELAY_STO', SELF_SERVER, 5, 0),
    atLeast('DELAY_CAP', SELF_SERVER, 5, 0),
    atLeast('DELAY_OTHER', SELF, 20, 0),
    atLeast('CPU_PER_TXN', SELF, 1.3, 0),
    multipleAtLeast('ENDED_RATE', SELF_SERVER, 1.25, 0),
    atLeast('APPL', SELF_SERVER_COMPETITOR, 50, 0),
    atLeast('LOCK_WAIT', SELF, 2, 2),
    atLeast('QR_WAIT', SELF, 5, 2),
    atLeast('MXT_WAIT', SELF, 5, 2),
    atLeast('DBAT_QUEUE', SELF, 5, 2),
    atLeast('FAIL_PCT', SELF, 1, 2),
    atLeast('SOS_MIN', SERVER, 1, 2),
    atLeast('JOB_ABEND', SELF, 1, 2),
    atLeast('JOB_CPU', SELF, 25, 2),
  ],
};

/** "Nothing about the work changed": POLICY's and a hardware fault's second half. */
const NOT_CHANGED: RecipePredicate = {
  label: 'nothing about the work changed: its rate or its cost per transaction was its normal',
  options: [within('ENDED_RATE', SELF, 0.15, 0), within('CPU_PER_TXN', SELF, 0.15, 0)],
};

/**
 * The proof recipes (RT-13, docs/rca-design.md §4.6): one per mechanism and trigger the RCA form offers. Predicate 1
 * puts the symptom on the right subject; predicate 2 is the discriminator against the nearest look-alike, or a
 * ruling-out reading where no report can show the cause directly. Every threshold here is FICTIONAL and matches the
 * design table; the metric-level `notableAt` lines stay the scoring lines (§4.6). A claim with no recipe would let
 * evidence pass with nothing ticked, so the vocabulary test asserts the two lists have the same claims.
 */
export const RECIPES: ProofRecipe[] = [
  {
    claim: { mechanism: 'CPU_CAPACITY' },
    predicates: [
      CPU_HURT,
      {
        label: 'the processor or the image was full',
        options: [
          atLeast('CPC_BUSY', HOST, 90, 1),
          atLeast('LPAR_BUSY', HOST, 95, 1),
          atLeast('PRSM_DELAY', HOST, 8, 1),
          atLeast('CAPACITY_ADJ', HOST, 1, 1),
        ],
      },
    ],
  },
  {
    claim: { mechanism: 'CPU_PRIORITY' },
    predicates: [
      CPU_HURT,
      {
        label: 'another class was using a host image',
        options: [
          atLeast('APPL', COMPETITOR, 10, 0),
          atLeast('APPL_CP', COMPETITOR, 10, 0),
          atLeast('IIPCP', COMPETITOR, 10, 0),
          atLeast('JOB_APPL', COMPETITOR, 25, 1),
        ],
      },
    ],
  },
  {
    claim: { mechanism: 'CAPPING' },
    predicates: [
      CPU_HURT,
      {
        label: 'a cap held the image or the class',
        options: [atLeast('CAPPED', HOST, 5, 1), atLeast('DELAY_CAP', SELF_SERVER, 5, 0)],
      },
    ],
  },
  {
    claim: { mechanism: 'DEPENDENCY' },
    predicates: [
      {
        label: "a server's class was delayed",
        options: [
          atLeast('DELAY_CPU', SERVER, 10, 0),
          atMost('VELOCITY', SERVER, 90, 1),
          atLeast('DELAY_OTHER', SELF, 20, 0),
        ],
      },
            WORK_NORMAL,
    ],
  },
  {
    claim: { mechanism: 'LOCK_CONTENTION' },
    predicates: [
      {
        label: 'the work waited on locks',
        options: [
          atLeast('WM_LOCK', SELF, 35, 0),
          atLeast('LOCK_WAIT', SELF, 2, 2),
          atLeast('JOB_LOCK', SELF, 25, 2),
        ],
      },
      {
        label: 'the wait was not CPU and nothing about the work changed',
        options: [...WORK_NORMAL.options, atLeast('DELAY_OTHER', SELF, 20, 0)],
      },
    ],
  },
  {
    claim: { mechanism: 'CF_SERVICE' },
    predicates: [
      {
        label: 'CF requests were slow',
        options: [atLeast('CF_WAIT', SELF, 5, 2), atLeast('CF_SYNC', SERVER, 50, 2, 2)],
      },
      {
        label: 'the work itself was not the limit',
        options: [...WORK_NORMAL.options, atLeast('DELAY_OTHER', SELF, 20, 0)],
      },
    ],
  },
  {
    claim: { mechanism: 'QR_TCB' },
    predicates: [
      { label: 'QR TCB dispatch waits were high', options: [atLeast('QR_WAIT', SELF, 5, 2)] },
      {
        label: 'the work was neither short of CPU nor queued for a task slot',
        options: [...WORK_NORMAL.options, atMost('MXT_WAIT', SELF, 5, 2)],
      },
    ],
  },
  {
    claim: { mechanism: 'THREAD_LIMIT' },
    predicates: [
      {
        label: 'work queued for a thread, task slot or the region storage',
        options: [
          atLeast('MXT_WAIT', SELF, 5, 2),
          atLeast('DBAT_QUEUE', SELF, 5, 2),
          atLeast('JOB_INIT', SELF, 25, 2),
          atLeast('SOS_MIN', SERVER, 1, 2),
        ],
      },
            WORK_NORMAL,
    ],
  },
  {
    claim: { mechanism: 'ROUTING' },
    predicates: [
      { label: 'one region or route failed work', options: [atLeast('FAIL_PCT', SELF, 1, 2)] },
            WORK_NORMAL,
    ],
  },
  {
    claim: { mechanism: 'IO' },
    predicates: [
      {
        label: 'I/O waits or I/O queueing were high',
        options: [
          atLeast('DELAY_IO', SELF_SERVER, 10, 0),
          atLeast('SYNC_IO', SELF, 5, 2),
          atLeast('JOB_IO', SELF, 25, 2),
          atLeast('DASD_IOSQ', SERVER, 0.1, 2, 2),
        ],
      },
            WORK_NORMAL,
    ],
  },
  {
    claim: { mechanism: 'STORAGE' },
    predicates: [
      {
        label: 'the work waited on storage',
        options: [
          atLeast('DELAY_STO', SELF_SERVER, 5, 0),
          atLeast('JOB_SWAP', SELF, 25, 2),
          atLeast('SOS_MIN', SERVER, 1, 2),
        ],
      },
            WORK_NORMAL,
    ],
  },
  {
    claim: { mechanism: 'JOB_FAILURE' },
    predicates: [
      { label: 'critical jobs abended', options: [atLeast('JOB_ABEND', SELF, 1, 2)] },
      { label: 'they did not lose their time to waits, and nothing about the work changed', options: [atMost('JOB_CPU', SELF, 25, 2), ...NOT_CHANGED.options] },
    ],
  },
  {
    claim: { trigger: 'DEMAND_SURGE' },
    predicates: [
      {
        label: 'the work arrived faster than its normal hour',
        // The surging work, a region serving it, or the co-hosted work that paid for the burst (§4.4).
        options: [multipleAtLeast('ENDED_RATE', SELF_SERVER_COMPETITOR, 1.25, 0)],
      },
      {
        label: 'each transaction still cost its normal CPU',
        options: [within('CPU_PER_TXN', SELF, 0.15, 0), within('CPU_VS_BASE', SELF, 0.15, 2)],
      },
    ],
  },
  {
    claim: { trigger: 'CHANGE_REGRESSION' },
    predicates: [
      {
        label: 'each transaction cost more CPU',
        options: [atLeast('CPU_PER_TXN', SELF, 1.3, 0), atLeast('CPU_VS_BASE', SELF, 1.3, 2)],
      },
      {
        label: 'the work did not arrive faster',
        options: [within('ENDED_RATE', SELF, 0.15, 0)],
      },
    ],
  },
  {
    claim: { trigger: 'RUNAWAY_WORK' },
    predicates: [
      {
        label: 'one class or job used at least half an engine',
        // The runaway can be a class of its own (a competitor on the host) as easily as the hurt work's.
        options: [atLeast('APPL', SELF_SERVER_COMPETITOR, 50, 0), atLeast('JOB_APPL', ['server', 'competitor'], 50, 1)],
      },
      {
        label: "that work's rate did not rise",
        options: [within('ENDED_RATE', SELF, 0.15, 0)],
      },
    ],
  },
  {
    claim: { trigger: 'BATCH_OVERLAP' },
    predicates: [
      {
        label: 'the work waited on a lock, or the batch night lost its time to CPU waits',
        options: [
          atLeast('WM_LOCK', SELF, 35, 0),
          atLeast('LOCK_WAIT', SELF, 2, 2),
          atLeast('JOB_LOCK', SELF, 25, 2),
          atLeast('JOB_CPU', SELF, 25, 2),
        ],
      },
      NOT_CHANGED,
    ],
  },
  {
    claim: { trigger: 'POLICY' },
    predicates: [
      HURT,
      {
        // The fallback claim: the work was hurt while nothing about it changed, so the configuration as set — no
        // headroom, a goal or importance that passed it over, a cap, routing — is what is left.
        label: 'nothing about the work changed, so the configuration as set was what was left',
        options: NOT_CHANGED.options,
      },
    ],
  },
  {
    claim: { trigger: 'HARDWARE_FAULT' },
    predicates: [
      {
        label: "the resource's own report showed a fault",
        options: [
          atLeast('CF_SYNC', SERVER, 50, 2, 2),
          atLeast('DASD_DISC', SERVER, 0.14, 2, 2),
          atLeast('CAPACITY_ADJ', HOST, 1, 1),
          atLeast('FAIL_PCT', SELF, 1, 2),
        ],
      },
      {
        // The report shows the resource, not the work's share of it: a fault shows while nothing about the work
        // changed, and one predicate can only hold one of those normal readings.
        label: 'nothing about the work changed',
        options: NOT_CHANGED.options,
      },
    ],
  },
  {
    claim: { trigger: 'NEW_WORKLOAD' },
    predicates: [
      {
        label: 'work that was not there before was using a host image',
        options: [atLeast('APPL', COMPETITOR, 5, 0)],
      },
      NOT_CHANGED,
    ],
  },
  {
    claim: { trigger: 'GROWTH' },
    predicates: [
      CPU_HURT,
      {
        // Growth is a rise in arrivals that the work's own recent hour does not explain. One predicate, so the
        // options are alternatives: an arrival rise is the signature, and a flat cost alone is not.
        label: 'more work arrived than its normal hour',
        options: [multipleAtLeast('ENDED_RATE', SELF, 1.05, 0)],
      },
    ],
  },
  {
    claim: { trigger: 'APPLICATION_ERROR' },
    predicates: [
      {
        label: 'work failed or a region ran short of its own storage',
        options: [atLeast('FAIL_PCT', SELF, 1, 2), atLeast('JOB_ABEND', SELF, 1, 2), atLeast('SOS_MIN', SERVER, 1, 2)],
      },
            WORK_NORMAL,
    ],
  },
];

/** The claims whose recipe must be provable with tier-0/1 reports only (user decision Q3, 2026-11-10): the CPU
 * family, a dependency, and the three triggers the early cards carry. A test enforces the path. */
export const COMMON_RECIPES: ProofRecipe['claim'][] = [
  { mechanism: 'CPU_CAPACITY' },
  { mechanism: 'CPU_PRIORITY' },
  { mechanism: 'CAPPING' },
  { mechanism: 'DEPENDENCY' },
  { trigger: 'DEMAND_SURGE' },
  { trigger: 'CHANGE_REGRESSION' },
  { trigger: 'RUNAWAY_WORK' },
];

export const recipeFor = (claim: ProofRecipe['claim']): ProofRecipe | undefined =>
  RECIPES.find((r) => ('mechanism' in claim ? 'mechanism' in r.claim && r.claim.mechanism === claim.mechanism : 'trigger' in r.claim && r.claim.trigger === claim.trigger));
