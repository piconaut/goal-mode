// Game-layer state (SPEC §2, §7–§12). Wraps the deterministic sim; plain data.

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

export interface HourAcc {
  hourIndex: number;
  ticks: number;
  workloads: Record<string, WorkloadHour>;
  maxCappedFrac: number;
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
  rca: { mechanism: Mechanism; trigger: Trigger; points: number } | null;
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
  seed: number;
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
