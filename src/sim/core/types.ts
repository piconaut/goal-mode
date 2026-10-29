// Plain-data world configuration and runtime state. Everything here must be
// JSON-serialisable and built in a deterministic order (arrays, not Maps).

import type { CfConfig, CfStructureConfig, CfResult, CfSystemResult } from '../cf/cf';
import type { DasdConfig, DasdResult } from '../io/dasd';
import type { BatchState } from '../subsys/batch';
import type { CostState } from '../cost/mlc';
import type { R4haState } from '../cost/r4ha';
import type { JobEndRecord, RmfAcc, RmfInterval } from '../measure/rmf';
import type { RngState } from './rng';
import type { AddressSpaceDef, WorkloadDef } from '../workload/types';
import type { BurstState } from '../workload/arrivals';
import type { RoutingPolicy } from '../workload/routing';
import type { ReportClassTick, ScpTick } from '../wlm/evaluate';
import type { WlmState } from '../wlm/runtime';

export type PoolType = 'CP' | 'ZIIP' | 'ICF';
export type Polarity = 'VH' | 'VM' | 'VL';

export interface CpcConfig {
  id: string;
  generation: string;          // key into content hardware generations
  capacitySetting: 4 | 5 | 6 | 7;
  /** Active physical engines per pool (shared + dedicated). */
  engines: Record<PoolType, number>;
  memoryGb: number;
  /** Position of the CPC's site along the CF links, km (distance = difference); default 0. */
  siteKm?: number;
}

export interface LparPoolConfig {
  pool: PoolType;
  logical: number;
  /** Logical processors defined but offline (can be configured online dynamically). */
  reserved: number;
  weight: number;
  dedicated: boolean;
  initialCapping: boolean;
  /** Absolute cap in engines (e.g. 2.5); null = none. */
  absoluteCapEngines: number | null;
}

export interface LparConfig {
  id: string;
  cpcId: string;
  kind: 'ZOS' | 'CF';
  pools: LparPoolConfig[];
  memoryGb: number;
  hiperDispatch: boolean;
  /** Defined capacity (soft cap) in MSU; null = none. */
  definedCapacityMsu: number | null;
  capacityGroup: string | null;
}

export interface CapacityGroupConfig {
  id: string;
  cpcId: string;
  limitMsu: number;
}

/** IEAOPTxx-style knobs per z/OS image. */
export interface ZosSystemConfig {
  lparId: string;
  /** BLWLINTHD: seconds starved before blocked-workload promotion. */
  blwlinthdSec: number;
  /** BLWLTRPCT as a fraction of LPAR capacity usable for promotion. */
  blwltrpctFrac: number;
  /** IIPHONORPRIORITY: zIIP-eligible work may overflow to CPs. */
  iipHonorPriority: boolean;
}

export interface Db2MemberConfig {
  ssid: string;
  lparId: string;
  bufferPoolGb: number;
  /** MAXDBAT: concurrent DDF database access threads before requests queue. */
  maxDbat: number;
}

export interface CicsRegionConfig {
  name: string;
  lparId: string;
  /** MXT: maximum concurrent tasks in the region. */
  maxTasks: number;
  /** Fraction of transaction CPU that must run on the single QR TCB (non-threadsafe). */
  qrFrac: number;
}

export interface JobClassConfig {
  jobClass: string;
  /** JES-managed fixed initiators, or WLM-managed (MODE=WLM). */
  mode: 'JES' | 'WLM';
  /** JES mode: initiators per LPAR; WLM mode: LPARs eligible (value = max initiators). */
  initiators: Record<string, number>;
}

export interface WorldConfig {
  cpcs: CpcConfig[];
  lpars: LparConfig[];
  capacityGroups: CapacityGroupConfig[];
  systems: ZosSystemConfig[];
  dasd: DasdConfig;
  cfs: CfConfig[];
  cfStructures: CfStructureConfig[];
  db2: Db2MemberConfig[];
  cics: CicsRegionConfig[];
  jobClasses: JobClassConfig[];
  /** RMF/SMF interval length in minutes (SMF INTVAL). */
  rmfIntervalMin: number;
}

/** Per-LPAR, per-pool PR/SM outcome for one tick. */
export interface LparPoolRuntime {
  pool: PoolType;
  entitlementEngines: number;
  demandEngines: number;
  /** Physical engine capacity delivered by PR/SM this tick. */
  deliveredEngines: number;
  /** Consumed capacity usable by the OS after polarity efficiency and LPAR overhead. */
  effectiveEngines: number;
  /** Physical capacity the image could have used this tick (entitlement + white space). */
  availableEngines: number;
  /** availableEngines after efficiency and overhead: the dispatcher's capacity. */
  availableEffectiveEngines: number;
  vh: number;
  vm: number;
  vl: number;
  unparkedVl: number;
  overheadFrac: number;
  /** Fraction of ready time a logical CP waits for a physical engine (short-engine effect). */
  prsmDelayFrac: number;
  /** Share of demand a binding cap (soft, absolute or initial) removed; PR/SM contention excluded. */
  cappedFrac: number;
  /** The part of cappedFrac due to WLM soft capping (Partition Data WLM%). */
  softCappedFrac: number;
}

export interface LparRuntime {
  id: string;
  pools: LparPoolRuntime[];
  /** MSU consumption rate this tick (general CPs only; zIIPs are not MSU-chargeable). */
  msuRate: number;
}

export interface WorkloadRuntime {
  id: string;
  /** AR(1) log-noise state. */
  noise: number;
  /** Retried requests per second from last tick's timeouts. */
  retryRate: number;
  /** Last tick's mean response time (closed-loop arrivals). */
  lastRtSec: number;
  /** Random burst in progress; present only for workloads whose shape has bursts. */
  burst?: BurstState;
}

export interface WorkloadTick {
  id: string;
  arrivalRate: number;
  completions: number;
  withinSla: number;
  failed: number;
  rtSumSec: number;
  /** Completion-weighted sums of response-time components (seconds × completions). */
  parts: Record<string, number>;
  /** Messages waiting on the workload's MQ queue, per queue manager (LPAR). */
  queueDepth?: Record<string, number>;
}

export interface LparTick {
  lparId: string;
  scps: ScpTick[];
  rcs?: ReportClassTick[];
  roleHealth: Record<string, { health: number; queueRatio: number }>;
}

/** Cross-tick environment carried forward to break circular dependencies (prev-tick values). */
export interface EnvState {
  dasd: DasdResult | null;
  cf: CfResult[];
  /** Sysplex lock contention index from running batch (Σ lock intensity). */
  lockIndex: number;
  /** Mean in-region response time per workload@lpar (excludes MXT/DBAT queueing), for Little's-law concurrency. */
  rtByWorkloadLpar: Record<string, number>;
  /** Paging delay fraction per LPAR. */
  pagingFrac: Record<string, number>;
  /** Failed fraction per workload@lpar; present only while a dynamic routing policy is on. */
  failByWorkloadLpar?: Record<string, number>;
  /** Transactions queued for a task slot (CICS MXT, Db2 MAXDBAT) per `lparId:MXT|DBAT`; absent when empty. */
  slotQueue?: Record<string, number>;
  /** Mean time a transaction holds its task slot per workload@lpar (in-region RT less CPU backlog wait). */
  holdByWorkloadLpar?: Record<string, number>;
  /** CF service each connected z/OS system saw last tick (link distance, own async conversion). */
  cfBySystem?: Record<string, CfSystemResult>;
}

/** Runtime modifiers set by events and fixes (all multiplicative, default 1). */
export interface SimModifiers {
  /** Arrival-rate multiplier per workload. */
  rate: Record<string, number>;
  /** CPU-per-transaction multiplier per workload (regressions, runaway queries). */
  cpu: Record<string, number>;
  /** Base CPU multiplier per address-space jobname (monitor creep, loops). */
  asCpu: Record<string, number>;
  /** Measurement overhead (SMF 101/110 tracing, monitor gatherers) per workload id or jobname; stacks with cpu/asCpu. */
  measureCpu: Record<string, number>;
  /** Permanent per-workload improvements from projects (stack multiplicatively with the others). */
  efficiency?: Record<string, number>;
  /** I/O per transaction multiplier per workload (compression, archiving). */
  ioPerTxn?: Record<string, number>;
  /** Share of a workload's general-CP time made zIIP-eligible (zIIP-enabling projects). */
  ziipShift?: Record<string, number>;
  /** Multiplier on a workload's zIIP-eligible time (1 = normal; below 1 the rest runs on general CPs). */
  ziipEligMult?: Record<string, number>;
  /** Extra lock contention index (lock escalation). */
  lockBoost: number;
  /** Fraction of a workload's transactions failing fast in one image's regions, keyed `workload@lpar` (sick AOR). */
  regionFailFrac?: Record<string, number>;
}

export interface SimState {
  version: 1;
  seed: number;
  tick: number;
  rng: RngState;
  config: WorldConfig;
  lpars: LparRuntime[];
  wlm: WlmState;
  workloads: WorkloadRuntime[];
  /** Backlogged work per slice key, engine-seconds. */
  backlog: Record<string, number>;
  last: { lpars: LparTick[]; workloads: WorkloadTick[] };
  env: EnvState;
  batch: BatchState;
  capping: { lpars: R4haState[]; groups: R4haState[] };
  mods: SimModifiers;
  /** Workloads added during the run (new apps, mergers). */
  extraWorkloads: WorkloadDef[];
  /** Routing overrides per workload (sysplex distributor / CICSPlex SM weights). */
  routing: Record<string, Record<string, number>>;
  /** Non-STATIC routing policies per workload (absent when every workload routes statically). */
  routingPolicies?: Record<string, RoutingPolicy>;
  /** ALTER QLOCAL MAXDEPTH overrides per message-driven workload. */
  mqMaxDepth?: Record<string, number>;
  /** Extra address spaces added during the run (e.g. new CICS AORs). */
  extraAddressSpaces: AddressSpaceDef[];
  /** Messages from the last applied commands (validation errors, notes). */
  commandLog: string[];
  cost: CostState;
  rmf: { acc: RmfAcc; intervals: RmfInterval[]; jobsThisInterval: JobEndRecord[] };
}
