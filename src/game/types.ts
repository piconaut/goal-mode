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
import type { Mon3ChartState } from './mon3Charts';
import type { Command } from '../sim/core/commands';
import type { RngState } from '../sim/core/rng';
import type { SimState } from '../sim/core/types';
import type { NightSummary } from '../sim/subsys/batch';

export type Phase = 'BRIEFING' | 'LIVE' | 'REVIEW' | 'GAMEOVER' | 'VICTORY';
export type Facet = 'Retail' | 'Cards' | 'Digital' | 'Payments' | 'Finance' | 'Regulator';
export const FACETS: readonly Facet[] = ['Retail', 'Cards', 'Digital', 'Payments', 'Finance', 'Regulator'];

export type Mechanism =
  | 'CPU_CAPACITY'
  | 'CPU_PRIORITY'
  | 'CAPPING'
  | 'DEPENDENCY'
  | 'LOCK_CONTENTION'
  | 'CF_SERVICE'
  | 'QR_TCB'
  | 'THREAD_LIMIT'
  | 'IO'
  | 'STORAGE';

export type Trigger =
  | 'DEMAND_SURGE'
  | 'ACCESS_PATH_REGRESSION'
  | 'RUNAWAY_WORK'
  | 'BATCH_OVERLAP'
  | 'POLICY'
  | 'HARDWARE_FAULT'
  | 'NEW_WORKLOAD'
  | 'GROWTH';

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
  /** Game-level fix that ends an active event (e.g. cancel a runaway query). */
  endsEvent: string | null;
}

export interface ActiveEvent {
  uid: string;
  defId: string;
  name: string;
  startTick: number;
  /** null = persists until fixed. */
  endTick: number | null;
  trigger: Trigger;
  affects: string[];
  /** Mechanisms the card causes; it only takes the blame for incidents with one of these (absent = any). */
  mechanisms?: Mechanism[];
  endCommands: Command[];
  started: boolean;
  ended: boolean;
}

export interface WorkloadHour {
  completions: number;
  withinSla: number;
  failed: number;
  rtSumSec: number;
  parts: Record<string, number>;
}

export interface SmfHour {
  day: number;
  /** Hour of day at the start of the hour (0..23). */
  hourOfDay: number;
  workloads: Record<string, WorkloadHour>;
}

/** One played day's capacity peaks (hourly averages), kept for the capacity planner. */
export interface CapacityDay {
  day: number;
  /** Highest hourly CPC busy during the online prime shift. */
  peakCpcBusyPct: number;
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
  cpcBusySum: number;
  lockIndexSum: number;
}

export interface Incident {
  id: number;
  workloadId: string;
  day: number;
  startTick: number;
  endTick: number | null;
  hours: number;
  worstAttainmentPct: number;
  truth: { mechanism: Mechanism; trigger: Trigger };
  /** AIOps hypotheses when the incident opened (tool AIOPS), best first. */
  aiops?: Hypothesis[];
  rca: { mechanism: Mechanism; trigger: Trigger; points: number; evidence?: PinVerdict[]; evidencePoints?: number } | null;
  trustLost: number;
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
  /** Worst sysplex PI per service-class period over the day's RMF intervals (absent in old saves). */
  piWorst?: Record<string, number>;
}

export interface Message {
  day: number;
  from: string;
  subject: string;
  body: string;
}

export interface DraftOption {
  id: string;
  title: string;
  description: string;
}

export interface RunState {
  version: 1;
  scenarioId: string;
  /** Absent in saves from before difficulty presets (= Normal). */
  difficulty?: DifficultyId;
  seed: number;
  /** ISO date (UTC) when this is a daily-challenge run. */
  daily?: string;
  rng: RngState;
  sim: SimState;
  phase: Phase;
  day: number;
  maxDays: number;
  trust: Record<Facet, number>;
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
  /** Closed hours of per-workload measurements (SMF 101/110-style detail), newest last, ~2 days. */
  smfHours: SmfHour[];
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
  nextId: number;
  events: ActiveEvent[];
  pendingCommands: Command[];
  hour: HourAcc | null;
  /** EWMA of healthy-hour response-time parts per workload (incident baselines). */
  baselines: Record<string, Record<string, number>>;
  incidents: Incident[];
  reports: DayReport[];
  inbox: Message[];
  draft: DraftOption[] | null;
  score: number;
  consecutiveBatchMisses: number;
  billsSeen: number;
  log: string[];
  endReason: string | null;
}
