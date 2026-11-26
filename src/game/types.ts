import type { Db2ContentionCounters } from '../sim/subsys/db2Contention';
import type { DifficultyId } from '../content/difficulty';
import type { InquiryState } from './inquiries';
import type { TfpOffer } from './tfp';
// Game-layer state (SPEC §2, §7–§12). Wraps the deterministic sim; plain data.

import type { Hypothesis } from './aiops';
import type { AlertsState } from './alerts';
import type { AutomationState } from './automation';
import type { PolicyBook } from './policies';
import type { ProjectState } from './projects';
import type { EvidencePin, PinVerdict } from './evidence';
import type { ProofResult } from './proof';
import type { Mon3ChartState } from './mon3Charts';
import type { Command } from '../sim/core/commands';
import type { CpuGrant, CpuWait, SimState } from '../sim/core/types';
import type { NightSummary } from '../sim/subsys/batch';
import type { Facet, DraftOption, Mechanism, Trigger } from '../content/types';

export type Phase = 'BRIEFING' | 'LIVE' | 'REVIEW' | 'GAMEOVER' | 'VICTORY';
// The content layer owns this vocabulary (src/content/types.ts) so it need not import from the game layer.
export type { DraftOption, Facet, Mechanism, Trigger } from '../content/types';

/** Midwest Mutual's facets (the default when a scenario names none). */
export const FACETS: readonly Facet[] = ['Retail', 'Cards', 'Digital', 'Payments', 'Finance', 'Regulator'];
/** The facets this run tracks, in display order. */
export const facetsOf = (run: { trust: Record<Facet, number> }): Facet[] => Object.keys(run.trust);

export interface PlannedChange {
  id: number;
  label: string;
  commands: Command[];
  hours: number;
  capex: number;
  opexPerDay: number;
  /** Played day on whose start the change takes effect. */
  activateDay: number;
  /** Played day the change was requested (hours can be refunded only on that day). */
  plannedDay: number;
  emergency: boolean;
  status: 'PLANNED' | 'APPLIED' | 'FAILED';
  /** Temporary changes (On/Off CoD) revert at the start of this day. */
  revertDay: number | null;
  revertCommands: Command[];
  /** An in-flight request imported from a save made before operator commands replaced fixes. */
  migratedEventId?: string;
  /** Other-team rollout targeted by this Change Desk request. */
  backoutChangeId?: string;
}

export interface OtherTeamChange {
  id: string;
  eventId: string;
  eventUid?: string;
  startTick: number;
  endTick: number | null;
  status: 'SCHEDULED' | 'APPLIED' | 'COMPLETE' | 'BACKED_OUT';
}

export interface ActiveEvent {
  uid: string;
  defId: string;
  name: string;
  startTick: number;
  /** null = persists until fixed. */
  endTick: number | null;
  trigger: Trigger;
  /** The footprint's direct set (RT-14): the workloads whose own demand or path the card changes. */
  affects: string[];
  /** The footprint's reach while the card runs: image ids, and `JOB@LPAR` for a region reach. Re-resolved every tick
   * and kept as the union over the hour (`affectsHour`), like a power cap's scope (absent = direct only: a card that
   * loads nothing shared). */
  reach?: string[];
  /** Workloads that closed a met SLA hour (or BATCH a met night) with the card already running at its start: the card
   * is background for them, and ranks after a fresh one (docs/rca-design.md §4.4(2)). Sorted. */
  metWith?: string[];
  /** Mechanisms the card causes; it only takes the blame for incidents with one of these (empty = none, so a card
   * whose footprint loads nothing never takes blame). */
  mechanisms: Mechanism[];
  /** Mechanism the card causes through failures rather than delay (copied from the card). */
  failureMechanism?: Mechanism;
  /** Hardware items refused while the card runs (copied from the card). */
  blocksHardware?: string[];
  /** A power cap: the CPCs whose capacity it dropped. Their workloads (the card's `affects`) are re-resolved
   * from the effective routing every tick while the cap runs, and each hour keeps the union of the scopes seen
   * in it, so a mid-cap move or added workload is attributed for that hour. */
  capacityCpcs?: string[];
  /** Start tick of the hour whose union `affects` (a power cap's scope follows the routing) and `reach` hold. */
  affectsHour?: number;
  endCommands: Command[];
  /** Last tick carrying a relieved card’s effect, exclusive, including a storm’s backlog replay. */
  footprintReplay?: { startTick: number; endTick: number };
  /** A matching rolling recycle takes effect when the target shutdowns have started. */
  endOnRecycleTick?: number;
  /** Roster entities the card loaded when it began (thread tokens or userids), for its truth and later operations. */
  culprits?: string[];
  started: boolean;
  ended: boolean;
}

export interface WorkloadHour {
  completions: number;
  withinSla: number;
  failed: number;
  rtSumSec: number;
  parts: Record<string, number>;
  /** Units of work that ended in rollback rather than commit (RT-23); absent when every unit committed. */
  rolledBack?: number;
}

export interface SmfHour {
  day: number;
  /** Hour of day at the start of the hour (0..23). */
  hourOfDay: number;
  workloads: Record<string, WorkloadHour>;
  /** Per workload, CPU per transaction ÷ the healthy baseline in force at close. Frozen when the hour closes so
   * a past row keeps its "vs base" ratio however later hours move the EWMA (absent when no workload closed a rate). */
  cpuVsBase?: Record<string, number>;
  /** CICS storage manager statistics per AOR (absent without the CICS monitoring tool). */
  cicsStorage?: Record<string, CicsStorageHour>;
  /** Cumulative count of DBAT requests that waited for a slot during the hour, per LPAR that runs a Db2 member
   * (QUEDBAT/QDSTQDBT, Db2 13 Command Reference p.303). */
  dbatQueuedByLpar?: Record<string, number>;
  /** Db2 rollbacks during the hour, per LPAR that runs a Db2 member (Q3STABRT, RT-23), frozen at close so a later
   * routing change cannot rewrite a historical report. Absent before RT-23 and when no unit rolled back. */
  db2RollbacksByLpar?: Record<string, number>;
  db2Contention?: Record<string, Db2ContentionCounters>;
}

/** CICS storage manager statistics for one region over an hour. */
export interface CicsStorageHour {
  peakMb: number;
  limitMb: number;
  /** Seconds the region spent short on storage. */
  sosSec: number;
  /** Transactions that abended in this region (the region's transaction statistics, XMRAENDC); absent when none. */
  abends?: number;
}

/** One played day's capacity peaks (hourly averages), kept for the capacity planner. */
export interface CapacityDay {
  day: number;
  /** Highest hourly CPC busy during the online prime shift. */
  peakCpcBusyPct: number;
  /** Highest hourly MSU demand in the online prime shift (busy × installed capacity). Absent on days recorded
   *  before PT-16, so readers derive or skip it. */
  peakDemandMsu?: number;
  /** Installed CP MSU capacity at the end of the day (Σ msuPerCp × CP engines). Absent before PT-16. */
  installedMsu?: number;
  peakR4ha: Record<string, number>;
  /** Peak of the sum of R4HAs across LPARs (what the MLC bill uses). */
  peakR4haSum: number;
  definedCapacity: Record<string, number | null>;
  /** Critical batch end, seconds after the day's 06:00 (null if unfinished). */
  criticalEndSec: number | null;
}

export interface HourAcc {
  hourIndex: number;
  ticks: number;
  workloads: Record<string, WorkloadHour>;
  maxCappedFrac: number;
  /** Max capped fraction per LPAR during the hour. */
  cappedByLpar: Record<string, number>;
  /** Per LPAR: ticks of the hour in which the image's CP demand was capped (`cappedFrac > 0`). */
  cappedTicksByLpar: Record<string, number>;
  cpcBusySum: number;
  /** Per CPC: sum over the hour's ticks of general-CP busy. */
  cpcBusyById: Record<string, number>;
  /** Per LPAR: sum over the hour's ticks of CP delivered ÷ CP available to it (logical CPs, weight, white space). */
  lparBusyById: Record<string, number>;
  /** Per LPAR: sum of CP engines consumed by importance rank 0–6 (see `importanceRank`). */
  cpByImportance: Record<string, number[]>;
  // RT-16 report ledgers (read by RT-32's game judge, never by the sim). Old hours lack these;
  // accumulation starts at the first new tick (no backfill).
  // A loaded mid-hour remains partial until the next full hour; merged nights likewise include only observed data.
  /** Workload → image → completion-weighted wait seconds and completions. */
  cpuWaitByWorkloadLpar?: Record<string, Record<string, CpuWait>>;
  /** Image → period → CP/zIIP/IIPCP engine-ticks (CP-pool use = cp + iipcp). */
  cpByScpLpar?: Record<string, Record<string, CpuGrant>>;
  /** Image → server role → CP/zIIP/IIPCP engine-ticks. */
  cpByRoleLpar?: Record<string, Record<string, CpuGrant>>;
  /** Image → workload → CP/zIIP/IIPCP engine-ticks. */
  cpByWorkloadLpar?: Record<string, Record<string, CpuGrant>>;
  /** Image → period → CAP and total using + delay samples; includes the synthetic server period. */
  capDelayByScpLpar?: Record<string, Record<string, { cap: number; samples: number }>>;
  /** Ticks with capped server-role CPU, keyed by "lparId:role". */
  roleCappedTicks?: Record<string, number>;
  /** Per CPC: sum of zIIP delivered / installed engines, fraction-ticks. */
  ziipBusyById?: Record<string, number>;
  /** Per image: sum of min(1, zIIP delivered / available engines), fraction-ticks. */
  ziipLparBusyById?: Record<string, number>;
  lockIndexSum: number;
  cicsStorage?: Record<string, CicsStorageHour>;
  /** Cumulative count of DBAT requests that waited for a slot during the hour, per LPAR that runs a Db2 member. */
  dbatQueuedByLpar: Record<string, number>;
  db2Contention?: Record<string, Db2ContentionCounters>;
}

/** The figures the capacity decision used, for the verdict the player is shown. Kept on the incident when the
 * truth is set: the RMF intervals don't carry the image measure, and the routing can change before the RCA. */
export interface CapacityBasis {
  /** Largest CPU-wait excess; legacy hours choose a full host, else the busiest CPC. */
  lparId: string;
  cpcId: string;
  /** Hour-average CPC busy on `pool` (CP for old incidents), %. */
  cpcBusyPct: number;
  /** Hour-average delivered ÷ available engines of the image's judged pool, %. */
  lparBusyPct: number;
  /** Legacy donor reading: share of the image's CP that went to less important work, %. Kept for saved incidents. */
  donorPct: number;
  /** Absent on saved incidents predating RT-32; those retain their CP/donor reading. */
  pool?: 'CP' | 'ZIIP';
  excessSharePct?: number;
  excessSharesPct?: Record<string, number>;
  displaceablePct?: number;
  topConsumers?: { name: string; kind: 'class' | 'job' | 'space'; pct: number; scKey?: string }[];
  /** zIIP could not overflow despite CP room. */
  overflowBlocked?: boolean;
  /** A capacity line was reached with little displaceable use: the verdict is CPU_CAPACITY. */
  full: boolean;
  /** A CAPPING verdict (RT-33): what held the work back. IMAGE is the image's own cap, GROUP a resource-group
   * maximum on the hurt work's periods or on the server period holding its regions, and SERVER a resource-group cap
   * on a server role the work depends on. Absent on saved incidents that predate RT-33. */
  capBy?: 'IMAGE' | 'GROUP' | 'SERVER';
  /** The resource group behind a GROUP or SERVER cap: the capped class's `resourceGroup`. */
  capGroup?: string;
}

/** What the evidence judge derived when the incident opened (RT-04): the hurt work's service classes (including the
 * classes of its CICS regions), the images it ran on (and, separately, the images it actually runs on), and the
 * region jobnames serving it. Judging against these means a later reclassification or rerouting cannot turn a pin
 * that was good when the incident opened into "not about X". */
export interface IncidentSubjects {
  classes: string[];
  /** Routing-table images: every routing key, including a zero weight. Kept because incidents record it and saved
   * runs carry it; the relation test reads `hosts`. */
  lpars: string[];
  /** Images the work actually runs on: routing keys with a positive share (RT-12's host relation, and where a
   * competitor's row can be placed). */
  hosts: string[];
  /** CICS regions (AOR/TOR) serving the transactions, by jobname and image. */
  servers: { jobname: string; lparId: string }[];
  /** The region classes among `classes` (RT-12): a row on one of them is the server's, not the hurt work's. */
  serverClasses: string[];
  /** Frozen RT-32 consumer accounting: proof and truth read the same exclusions after policy edits. */
  cpu?: Record<string, Record<'CP' | 'ZIIP', CpuConsumers>>;
}

export interface CpuConsumers {
  /** Pool engines averaged across the observed hour ticks. */
  engines: number;
  classes: Record<string, { used: number; displaceable: number; workloads: string[] }>;
  jobs: Record<string, { used: number; displaceable: number }>;
}

/** The answers a fair expert could defend from visible data, always including the primary (RT-07): one incident's, or
 * the union of a group's (RT-15). */
export interface Accepted {
  mechanisms: readonly Mechanism[];
  triggers: readonly Trigger[];
}

/** An incident's hidden ground truth: the primary answer, the accepted set, and the cause's identity. */
export interface IncidentTruth {
  mechanism: Mechanism;
  trigger: Trigger;
  /** Answers a fair expert could defend from visible data, always including the primary (RT-07). */
  accepted: Accepted;
  /** One line per accepted answer that is not the primary, keyed by the answer, for the post-RCA reply. */
  notes?: Record<string, string>;
  /** Why a mechanism the evidence can prove is not accepted (RT-35's peer rule below the response share): shown
   *  beside "proven, and it earns nothing" so the player sees the number that missed the line. */
  nearMiss?: Partial<Record<Mechanism, string>>;
  /** Identity of the cause for grouping (docs/rca-design.md §4.5): the blamed card's `uid`, `new:<workload>`,
   * `change:<id>`, or `none:<mechanism family>:<host>`. Recorded here by RT-07; RT-15 groups incidents by it. */
  cause: string;
}

export interface Incident {
  id: number;
  workloadId: string;
  day: number;
  startTick: number;
  endTick: number | null;
  hours: number;
  worstAttainmentPct: number;
  truth: IncidentTruth;
  /** The capacity figures behind a CPU mechanism verdict, taken when the truth was set (absent for other
   * mechanisms). */
  basis?: CapacityBasis;
  /** AIOps hypotheses when the incident opened (tool AIOPS), best first. */
  aiops?: Hypothesis[];
  /** Classes, images and serving regions as they were when the incident opened (RT-04). */
  subjects: IncidentSubjects;
  /** `explain` is the CPU verdict's numbers, filled in when the RCA is filed. `proof` is the filed claims' recipes
   * over the attached pins (RT-13; absent when no pin was attached). */
  rca: { mechanism: Mechanism; trigger: Trigger; points: number; evidence?: PinVerdict[]; evidencePoints?: number; strong?: boolean; proof?: ProofResult; explain?: string; /** The hour-base note at filing (RT-30), when a met pin was over a line the hour average missed. */ hourNote?: string; /** RT-22: the cause already earned a diagnosis (a problem record or another incident), so this filing earned nothing. */ duplicateOf?: number } | null;
  trustLost: number;
  /** Id of the group's lead, the first incident of its cause (docs/rca-design.md §4.5): one RCA covers the group,
   * scored once (SPEC §10). Absent on a lead and on an incident listed as new. */
  rcaGroup?: number;
}

/** A closed hour that met its SLA but still shows a problem a problem record can name (RT-22): a card's footprint
 *  reached the work, a delay group grew past the floor, or a CF/LCU is far slower than its peers. The truth is
 *  frozen with the hour, like an incident's, so a later baseline or policy cannot rewrite it. */
export interface QuietHour {
  day: number;
  hourOfDay: number;
  /** The closed hour's half-open tick range, from the accumulator that closed it. */
  startTick: number;
  endTick: number;
  workloadId: string;
  /** Why the hour is notable: a card touched it, a delay group grew, or a resource is peer-slow. */
  reason: 'CARD' | 'DELAY' | 'PEER';
  truth: IncidentTruth;
  subjects: IncidentSubjects;
  basis?: CapacityBasis;
}

/** What a problem record is opened on (RT-22): a workload, a service-class period, an image or a job. */
export type ProblemSubject =
  | { kind: 'WORKLOAD'; id: string }
  | { kind: 'CLASS'; id: string }
  | { kind: 'IMAGE'; id: string }
  | { kind: 'JOB'; id: string };

/** A record's window: whole closed clock hours, half-open [fromTick, toTick). `day`/`hourOfDay` are the first hour's
 *  clock position (the played day and wall-clock hour), the same key `smfHours` uses. */
export interface ProblemWindow {
  fromTick: number;
  toTick: number;
  day: number;
  hourOfDay: number;
  hours: number;
}

/** The answer a problem window accepts. A null mechanism means the window shows no problem (RT-22). */
export interface ProblemTruth {
  mechanism: Mechanism | null;
  trigger: Trigger | null;
  accepted: Accepted;
  /** One line per accepted answer that is not the primary. */
  notes?: Record<string, string>;
  /** Why a proven mechanism is not accepted (RT-35's peer-share near miss). */
  nearMiss?: Partial<Record<Mechanism, string>>;
  /** The cause's identity for grouping and the no-double-credit rule (same vocabulary as an incident's). */
  cause: string;
}

/** One root-cause episode for the one-payment rule (RT-22): the same cause in one §4.5 group. A card is one episode
 *  for a played day; a fallback cause is one while its hours overlap or follow within `GROUP_FOLLOW_HOURS`. */
export interface CauseEpisode {
  cause: string;
  day: number;
  startTick: number;
  endTick: number | null;
}

/** One hour's frozen truth inside a record's window, with the subjects pins are judged against. */
export interface ProblemCandidate {
  workloadId: string;
  day: number;
  startTick: number;
  endTick: number;
  truth: IncidentTruth;
  subjects: IncidentSubjects;
  basis?: CapacityBasis;
}

/** One filed diagnosis on a problem record (RT-22): the answer, the proof over the attached pins, and its reward. */
export interface ProblemFiling {
  day: number;
  tick: number;
  mechanism: Mechanism;
  trigger: Trigger;
  points: number;
  evidence?: PinVerdict[];
  evidencePoints?: number;
  strong?: boolean;
  proof?: ProofResult;
  /** Trust change applied to `trustFacet`; 0 when the subject has no facet or the episode already earned. */
  trust: number;
  trustFacet: Facet | null;
  /** The cause and §4.5 episode this filing was judged against, for the one-episode-pays-once rule. */
  cause: string;
  episode: CauseEpisode;
  /** The window shows no problem, so every mechanism is wrong. */
  noProblem?: true;
  /** The episode already earned elsewhere: the filing is recorded but earns no trust, insight or score. */
  duplicateOf?: number;
  /** The reply, one line per part, shared by the card and the CLI. */
  reply: string[];
}

/** A diagnosis the player opened on a subject and a time window (RT-22). An incident is the record the game opened;
 *  a player record can name a quiet card, a standing fault or no problem at all. */
export interface ProblemRecord {
  id: number;
  subject: ProblemSubject;
  window: ProblemWindow;
  openedDay: number;
  openedTick: number;
  /** The window's truth, frozen when the record opened and hidden until a filing. */
  truth: ProblemTruth;
  candidates: ProblemCandidate[];
  filings: ProblemFiling[];
}

export interface SlaDay {
  workloadId: string;
  target: string;
  attainmentPct: number;
  breachHours: number;
}

export interface DayReport {
  day: number;
  sla: SlaDay[];
  batch: NightSummary | null;
  batchMissed: boolean;
  trustDelta: Record<Facet, number>;
  score: number;
  mlcEstimate: number;
  events: string[];
  /** Worst sysplex PI per service-class period over the day's RMF intervals. */
  piWorst: Record<string, number>;
}

export interface Message {
  day: number;
  from: string;
  subject: string;
  body: string;
  replyToEventUid?: string;
}

export interface RunState {
  /** `SAVE_VERSION` (game/runFile.ts): another version is refused at load. */
  version: 2;
  scenarioId: string;
  difficulty: DifficultyId;
  seed: number;
  /** ISO date (UTC) when this is a daily-challenge run. */
  daily?: string;
  /** Set once the run's end has been added to the career (so endless or reloads don't count it twice). */
  careerRecorded?: boolean;
  /** Day the quarter closed when the player kept going (endless mode). */
  endlessFromDay?: number;
  sim: SimState;
  phase: Phase;
  day: number;
  maxDays: number;
  trust: Record<Facet, number>;
  /** Trust loss multiplier per facet for SLA breaches; absent = Midwest weights. */
  facetWeights?: Record<Facet, number>;
  /** Facet that also loses trust when critical batch misses its deadline; absent = Retail. */
  batchMissFacet?: Facet;
  hoursLeft: number;
  baseHours: number;
  bonusHours: { hours: number; untilDay: number }[];
  fatigue: number;
  opexBudgetMonthly: number;
  capexRemaining: number;
  opexSpentThisMonth: number;
  insight: number;
  /** Analytics tools bought (content/tools.ts) and the ones switched off to save their CPU. */
  tools: string[];
  toolsOff: string[];
  /** Tools on a free vendor trial (draft reward): in `tools` until the end of day untilDay − 1 unless bought. */
  toolTrials?: { id: string; untilDay: number }[];
  /** Closed hours of per-workload measurements (SMF 101/110-style detail), newest last, ~2 days. */
  smfHours: SmfHour[];
  /** The slow-internal-work episode already complained about (`day:hourOfDay` of its first missed hour, PT-50):
   *  one inbox complaint per episode. It is cleared when a closed hour meets the goal, so a later episode complains
   *  again. The surcharge itself is derived from `smfHours`, never from this marker. */
  tsoEpisode?: string;
  /** An internal-work episode has happened at least once in this run, for the Codex discovery (PT-50). */
  tsoSlowSeen?: true;
  /** Daily capacity peaks so far (all days), and today's running peaks. */
  capacityDays: CapacityDay[];
  capacityToday: CapacityDay | null;
  /** Multi-day engineering projects in progress or done. */
  projects: ProjectState[];
  /** "Ask around" questions and fragments already given. */
  inquiries?: InquiryState;
  /** Tailored Fit Pricing offer, once made. */
  tfpOffer?: TfpOffer | null;
  /** Saved WLM service policies and the daily switch schedule. */
  policies: PolicyBook;
  /** Automation rules and their state (tool AUTOMATION). */
  automation: AutomationState;
  /** Alerting rules and their state (tool ALERTS). */
  alerts: AlertsState;
  /** Evidence pinned from reports for RCAs (oldest drop off). */
  pins: EvidencePin[];
  /** Monitor III chart history for the played day (only while the charting tool is on). */
  mon3Charts: Mon3ChartState | null;
  /** Report kinds ever opened (for Codex discovery). */
  codexReports: string[];
  /** Distinct reports opened this played day (Insight is earned per report, capped per day). */
  reportsOpenedToday: string[];
  perks: string[];
  constraints: string[];
  /** Critical batch deadline, seconds after the played day's 06:00 start. */
  batchDeadlineSec: number;
  changes: PlannedChange[];
  otherTeamChanges?: OtherTeamChange[];
  nextId: number;
  events: ActiveEvent[];
  pendingCommands: Command[];
  hour: HourAcc | null;
  /** The batch night's hours (18:00–06:00) summed, for a missed night's incident truth; reset at day end. */
  nightHour?: HourAcc | null;
  /** EWMA of healthy-hour response-time parts per workload (incident baselines). */
  baselines: Record<string, Record<string, number>>;
  /** EWMA of the same parts per workload per clock hour of day (0–23), folded only from met, undisturbed hours;
   *  `baselines` is the rolling fallback until a slot has data (RT-17, docs/rca-design.md §4.2(1)). Absent in saves
   *  from before RT-17, which then read the rolling baseline everywhere. */
  hourBaselines?: Record<string, Record<string, Record<string, number>>>;
  incidents: Incident[];
  /** Closed hours that met their SLA but still show a named problem (RT-22), newest last, the same ~2-day window as
   *  `smfHours`. A record opened on a quiet hour reads these; absent in saves from before RT-22. */
  quietHours?: QuietHour[];
  /** Player-opened problem records (RT-22), oldest first. */
  problemRecords?: ProblemRecord[];
  reports: DayReport[];
  inbox: Message[];
  draft: DraftOption[] | null;
  score: number;
  consecutiveBatchMisses: number;
  billsSeen: number;
  log: string[];
  endReason: string | null;
}
