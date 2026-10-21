// Messages between the UI thread and the game worker.

import type { DifficultyId } from '../content/difficulty';
import type { InquiryKind } from '../content/inquiries';
import type { ResourceGroupDef, ServiceClassDef } from '../sim/wlm/types';
import type { RcAdvice } from '../game/rcAdvisor';
import type { ReportKind } from '../sim/measure/reports';
import type { AlertRule } from '../game/alerts';
import type { AutoRule } from '../game/automation';
import type { ScheduleEntry } from '../game/policies';
import type { PinRequest } from '../game/evidence';
import type { FinanceView } from '../game/finance';
import type { CareerState } from '../game/career';
import type { WhatIfSummary } from '../game/whatif';
import type { Command } from '../sim/core/commands';
import type { ChartMarker, Mon3Sample } from '../game/mon3Charts';
import type { BatchNight, CicsTxnRow, Db2AcctRow, Smf113Row } from '../game/smf';
import type { ChangeRequest } from '../game/run';
import type { CicsGoalIssue, WlmEdit } from '../game/wlmEdit';
import type { Mechanism, Trigger } from '../game/types';
import type { ClassificationExplain } from '../game/classifyExplain';
import type { HistoryPoint } from '../game/history';
import type { ViewModel } from '../game/view';
import type { ClassificationResult } from '../sim/wlm/classify';
import type { WorkAttributes } from '../sim/wlm/types';

/** Summary of the edited-but-not-yet-activated WLM policy. */
export interface PendingPolicyView {
  policyName: string;
  classes: { id: string; periods: string[]; cpuCritical: boolean; resourceGroup: string | null }[];
  resourceGroups: ResourceGroupDef[];
  classDefs: ServiceClassDef[];
  ioPriorityManagement: boolean;
  cicsRegionMode: 'TRANSACTION' | 'REGION';
  rules: { subsystem: string; text: string }[];
  /** CICS transaction classes and what's wrong with their goals. */
  cicsClasses: string[];
  cicsIssues: CicsGoalIssue[];
}

export type SmfKind = 'DB2' | 'CICS' | 'BATCH' | 'SMF113';

export type SmfData =
  | { kind: 'DB2'; hour: string; rows: Db2AcctRow[] }
  | { kind: 'CICS'; hour: string; rows: CicsTxnRow[] }
  | { kind: 'BATCH'; night: BatchNight | null }
  | { kind: 'SMF113'; rows: Smf113Row[] };

export type { ReportKind };

export type ToWorker =
  | { type: 'NEW_RUN'; seed: number; difficulty?: DifficultyId; daily?: string; scenario?: string }
  | { type: 'START_DAY'; auto?: boolean }
  | { type: 'SET_STARTING_PERK'; perkId: string | null }
  /** After VICTORY: keep playing past the quarter (endless mode). */
  | { type: 'CONTINUE_ENDLESS' }
  /** speed AUTO_SPEED runs the day as fast as the worker can (weekend auto-run); 0 pauses. */
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'CHANGE'; req: ChangeRequest }
  | { type: 'DRAFT'; optionId: string | null }
  | { type: 'RCA'; incidentId: number; mechanism: Mechanism; trigger: Trigger; evidenceIds?: number[] }
  | { type: 'PIN'; req: PinRequest }
  | { type: 'UNPIN'; id: number }
  | { type: 'GET_REPORT'; index: number; kind: ReportKind; scKey?: string; system?: string }
  | { type: 'WLM_EDIT'; edit: WlmEdit }
  | { type: 'GET_POLICY' }
  | { type: 'ACTIVATE_JSON'; json: string }
  | { type: 'ACTIVATE_PENDING' }
  | { type: 'DISCARD_PENDING' }
  | { type: 'CLASSIFY'; work: WorkAttributes }
  | { type: 'CONTINUE_SAVED' }
  /** Spectator mode: show this run file (written by tools/play.ts) read-only; replaces the shown run. */
  | { type: 'SPECTATE'; text: string }
  /** Stop spectating and keep the watched run as this browser's own save. */
  | { type: 'SPECTATE_ADOPT' }
  /** The UI's change basket, mirrored so it is saved with the run. */
  | { type: 'SET_BASKET'; basket: Command[] }
  | { type: 'GET_RULES' }
  /** Stage the advisor's suggestion for one workload (or all) into the pending policy. */
  | { type: 'RC_ADVICE_APPLY'; workloadId: string | null }
  | { type: 'CANCEL_CHANGE'; changeId: number }
  | { type: 'GET_SMF'; kind: SmfKind; hour: string }
  | { type: 'GET_FINANCE' }
  | { type: 'ASK_AROUND'; topic: InquiryKind; workloadId: string | null }
  | { type: 'TFP_DECIDE'; accept: boolean }
  | { type: 'DEV_TFP_OFFER' }
  | { type: 'PROJECT_WORK'; id: string; hours: number }
  | { type: 'WHATIF_RUN'; commands: Command[]; label: string }
  | { type: 'GET_MON3_CHARTS'; fromSample: number; fromMarker: number }
  | { type: 'ALERT_ADD'; rule: Omit<AlertRule, 'id'> }
  | { type: 'ALERT_REMOVE'; id: number }
  | { type: 'AUTO_ADD'; rule: Omit<AutoRule, 'id'> }
  | { type: 'AUTO_REMOVE'; id: number }
  | { type: 'SAVE_POLICY'; name: string }
  | { type: 'DELETE_POLICY'; name: string }
  | { type: 'SET_POLICY_SCHEDULE'; schedule: ScheduleEntry[] }
  | { type: 'BUY_TOOL'; toolId: string }
  /** Dev builds only: grant Insight for UI testing. */
  | { type: 'DEV_INSIGHT'; amount: number }
  | { type: 'DEV_FAST_DAYS'; days: number }
  | { type: 'SET_TOOL_ACTIVE'; toolId: string; active: boolean };

export type FromWorker =
  | { type: 'CAREER'; career: CareerState; lastRunXp: number | null }
  | { type: 'VIEW'; view: ViewModel; history: HistoryPoint[] | null; savedRunDay: number | null; pending: PendingPolicyView | null; speed: number }
  | { type: 'CLASSIFIED'; result: ClassificationResult; pending: boolean }
  | { type: 'SMF'; data: SmfData }
  | { type: 'FINANCE'; finance: FinanceView }
  | { type: 'WHATIF_PROGRESS'; frac: number }
  | { type: 'WHATIF_RESULT'; label: string; base: WhatIfSummary; proposal: WhatIfSummary }
  | { type: 'MON3_CHARTS'; fromSample: number; fromMarker: number; samples: Mon3Sample[]; markers: ChartMarker[] }
  | { type: 'RULES'; active: ClassificationExplain; pending: ClassificationExplain | null; classIds: string[]; advice: RcAdvice[] | null }
  | { type: 'REPORT'; text: string }
  | { type: 'POLICY'; json: string }
  /** Restore the change basket (continuing a saved run, new run). */
  | { type: 'BASKET'; basket: Command[] }
  | { type: 'RESULT'; ok: boolean; message: string };

/** Sentinel speed: run the rest of the day as fast as the worker can, then drop back to the last speed. */
export const AUTO_SPEED = 1000;
