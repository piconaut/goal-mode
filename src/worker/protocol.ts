// Messages between the UI thread and the game worker.

import type { ChangeRequest } from '../game/run';
import type { WlmEdit } from '../game/wlmEdit';
import type { Mechanism, Trigger } from '../game/types';
import type { HistoryPoint } from '../game/history';
import type { ViewModel } from '../game/view';
import type { ClassificationResult } from '../sim/wlm/classify';
import type { WorkAttributes } from '../sim/wlm/types';

/** Summary of the edited-but-not-yet-activated WLM policy. */
export interface PendingPolicyView {
  policyName: string;
  classes: { id: string; periods: string[]; cpuCritical: boolean }[];
  rules: { subsystem: string; text: string }[];
}

export type ReportKind = 'WLM_SUMMARY' | 'WLM_DETAIL' | 'PARTITION' | 'CF' | 'DASD';

export type ToWorker =
  | { type: 'NEW_RUN'; seed: number }
  | { type: 'START_DAY' }
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'CHANGE'; req: ChangeRequest }
  | { type: 'DRAFT'; optionId: string | null }
  | { type: 'RCA'; incidentId: number; mechanism: Mechanism; trigger: Trigger }
  | { type: 'GET_REPORT'; index: number; kind: ReportKind; scKey?: string; system?: string }
  | { type: 'WLM_EDIT'; edit: WlmEdit }
  | { type: 'GET_POLICY' }
  | { type: 'ACTIVATE_JSON'; json: string }
  | { type: 'ACTIVATE_PENDING' }
  | { type: 'DISCARD_PENDING' }
  | { type: 'CLASSIFY'; work: WorkAttributes }
  | { type: 'CONTINUE_SAVED' };

export type FromWorker =
  | { type: 'VIEW'; view: ViewModel; history: HistoryPoint[] | null; savedRunDay: number | null; pending: PendingPolicyView | null }
  | { type: 'CLASSIFIED'; result: ClassificationResult; pending: boolean }
  | { type: 'REPORT'; text: string }
  | { type: 'POLICY'; json: string }
  | { type: 'RESULT'; ok: boolean; message: string };
