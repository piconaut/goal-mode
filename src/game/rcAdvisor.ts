// Report class advisor (tool RC_ADVISOR, SPEC §8 tier 1): one report class per business workload, so
// WLMGL shows each workload on its own row even when it shares a service class (F6). Report classes
// are reporting only: WLM never manages to them, so applying a suggestion doesn't change behaviour.

import { classify } from '../sim/wlm/classify';
import type { Qualifier, ServiceDefinition } from '../sim/wlm/types';
import { explainClassification, type WorkItem } from './classifyExplain';
import { applyWlmEdit, type WlmEdit } from './wlmEdit';

export interface RcAdvice {
  workloadId: string;
  serviceClass: string;
  /** Other work sharing that service class (why it needs its own report class). */
  sharedWith: string[];
  currentReportClass: string | null;
  suggested: string;
  /** How it gets there: retarget the rule that catches only this workload, or add a specific rule. */
  how: string;
  edit: WlmEdit;
}

const QUALIFIER_ORDER: Qualifier[] = ['TN', 'UI', 'PK', 'CI'];

export function adviseReportClasses(def: ServiceDefinition, items: readonly WorkItem[]): RcAdvice[] {
  const ex = explainClassification(def, items);
  const cls = items.map((it) => ({ it, res: classify(def, it.work) }));
  const taken = new Set([...def.classes.map((c) => c.id), ...def.reportClasses]);
  const out: RcAdvice[] = [];
  for (const { it, res } of cls) {
    if (it.kind !== 'workload') continue;
    const peers = cls.filter((x) => x.it !== it && x.res.serviceClass === res.serviceClass).map((x) => x.it.label);
    if (peers.length === 0) continue;
    if (res.reportClass && !cls.some((x) => x.it !== it && x.res.reportClass === res.reportClass)) continue;
    let name = `R${it.label}`.toUpperCase().slice(0, 8);
    for (let i = 2; taken.has(name) && i < 10; i++) name = `${name.slice(0, 7)}${i}`;
    taken.add(name);
    const sub = it.work.subsystem;
    const row = ex.subsystems.find((s) => s.subsystem === sub)?.rows.find((r) => r.catches.includes(it.label));
    let edit: WlmEdit;
    let how: string;
    if (row && row.catches.length === 1) {
      edit = { op: 'SET_RULE_TARGET', subsystem: sub, path: row.path, serviceClass: row.serviceClass, reportClass: name };
      how = `set report class on rule ${row.qualifier}=${row.pattern}`;
    } else {
      const q = QUALIFIER_ORDER.find((k) => it.work[k]);
      if (!q) continue;
      const pattern = it.work[q]!;
      edit = { op: 'ADD_RULE', subsystem: sub, qualifier: q, pattern, serviceClass: res.serviceClass, reportClass: name, at: [0] };
      how = `add rule ${sub} ${q}=${pattern} → ${res.serviceClass} (same service class) at the top`;
    }
    out.push({ workloadId: it.label, serviceClass: res.serviceClass, sharedWith: peers, currentReportClass: res.reportClass, suggested: name, how, edit });
  }
  return out;
}

/** Stage advice for one workload, or for every workload when `workloadId` is null. Re-advises after each
 * edit: an added rule shifts the paths of the ones below it. Returns the edit's error if one is refused. */
export function applyReportClassAdvice(
  def: ServiceDefinition,
  items: readonly WorkItem[],
  workloadId: string | null,
): { def: ServiceDefinition; added: string[] } | string {
  const added: string[] = [];
  for (let guard = 0; guard < 32; guard++) {
    const a = adviseReportClasses(def, items).find((x) => workloadId === null || x.workloadId === workloadId);
    if (!a) break;
    const res = applyWlmEdit(def, a.edit);
    if (typeof res === 'string') return res;
    def = res;
    added.push(a.workloadId);
    if (workloadId !== null) break;
  }
  return { def, added };
}
