import type { ResourceGroupDef } from '../sim/wlm/types';
import type { RcAdvice } from '../game/rcAdvisor';
// Messages between the UI thread and the game worker.

import type { AlertRule } from '../game/alerts';
import type { AutoRule } from '../game/automation';
import type { ScheduleEntry } from '../game/policies';
import type { PinRequest } from '../game/evidence';
import type { FinanceView } from '../game/finance';
import type { WhatIfSummary } from '../game/whatif';
import type { Command } from '../sim/core/commands';
import type { ChartMarker, Mon3Sample } from '../game/mon3Charts';
import type { BatchNight, CicsTxnRow, Db2AcctRow, Smf113Row } from '../game/smf';
import type { ChangeRequest } from '../game/run';
import type { WlmEdit } from '../game/wlmEdit';
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
  rules: { subsystem: string; text: string }[];
}

export type SmfKind = 'DB2' | 'CICS' | 'BATCH' | 'SMF113';

export type SmfData =
  | { kind: 'DB2'; hour: string; rows: Db2AcctRow[] }
  | { kind: 'CICS'; hour: string; rows: CicsTxnRow[] }
  | { kind: 'BATCH'; night: BatchNight | null }
  | { kind: 'SMF113'; rows: Smf113Row[] };

export type ReportKind = 'WLM_SUMMARY' | 'WLM_DETAIL' | 'PARTITION' | 'CF' | 'DASD';

export type ToWorker =
  | { type: 'NEW_RUN'; seed: number }
  | { type: 'START_DAY' }
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
  | { type: 'GET_RULES' }
  /** Stage the advisor's suggestion for one workload (or all) into the pending policy. */
  | { type: 'RC_ADVICE_APPLY'; workloadId: string | null }
  | { type: 'CANCEL_CHANGE'; changeId: number }
  | { type: 'GET_SMF'; kind: SmfKind; hour: string }
  | { type: 'GET_FINANCE' }
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
  | { type: 'RESULT'; ok: boolean; message: string };
