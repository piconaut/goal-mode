// Messages between the UI thread and the game worker.

import type { ChangeRequest } from '../game/run';
import type { WlmEdit } from '../game/wlmEdit';
import type { Mechanism, Trigger } from '../game/types';
import type { ViewModel } from '../game/view';

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
  | { type: 'ACTIVATE_JSON'; json: string };

export type FromWorker =
  | { type: 'VIEW'; view: ViewModel }
  | { type: 'REPORT'; text: string }
  | { type: 'POLICY'; json: string }
  | { type: 'RESULT'; ok: boolean; message: string };
