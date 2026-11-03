// Small structured edits to a WLM service definition (the UI's policy editor builds
// ACTIVATE_POLICY commands from these). Pure: returns a new definition.

import type { ResourceGroupDef, ClassificationRule, Goal, Importance, RegionMode, ServiceDefinition, SubsystemRules, SubsystemType, Qualifier } from '../sim/wlm/types';

/** Address of a rule: indices from the top-level list down through `children`. */
export type RulePath = number[];

export type WlmEdit =
  | { op: 'SET_PERIOD'; classId: string; period: number; goal: Goal; importance: Importance; durationSu?: number | null }
  | { op: 'ADD_CLASS'; classId: string; description: string; goal: Goal; importance: Importance; cpuCritical: boolean }
  | { op: 'SET_FLAGS'; classId: string; cpuCritical?: boolean; storageCritical?: boolean }
  | {
      op: 'ADD_RULE';
      subsystem: SubsystemType;
      qualifier: Qualifier;
      pattern: string;
      serviceClass: string;
      reportClass?: string | null;
      /** Insert at this path (default: first top-level rule). A path into a rule's children nests it. */
      at?: RulePath;
    }
  | { op: 'REMOVE_RULE'; subsystem: SubsystemType; index: number }
  | { op: 'DELETE_RULE'; subsystem: SubsystemType; path: RulePath }
  | { op: 'MOVE_RULE'; subsystem: SubsystemType; path: RulePath; delta: -1 | 1 }
  | { op: 'SET_RULE_TARGET'; subsystem: SubsystemType; path: RulePath; serviceClass: string | null; reportClass?: string | null }
  | { op: 'SET_DEFAULT'; subsystem: SubsystemType; serviceClass: string | null }
  /** Put a class in a resource group (created or updated with these limits), or take it out (group null). */
  | { op: 'SET_RESOURCE_GROUP'; classId: string; group: ResourceGroupDef | null }
  | { op: 'SET_IO_PRIORITY'; on: boolean }
  /** "Manage Region Using Goals Of" on an STC/JES rule; null inherits (the enclosing rule's, else TRANSACTION). */
  | { op: 'SET_RULE_REGION_MODE'; subsystem: SubsystemType; path: RulePath; mode: RegionMode | null }
  /** Append a period; the previous last period needs a duration (service units) to hand work on. */
  | { op: 'ADD_PERIOD'; classId: string; goal: Goal; importance: Importance; previousDurationSu: number }
  | { op: 'REMOVE_PERIOD'; classId: string }
  | { op: 'DELETE_CLASS'; classId: string };

// Work qualifiers each subsystem type supports, limited to the ones the sim models (WLM Planning p.84 Table 7).
const VALID_QUALIFIERS: Record<SubsystemType, readonly Qualifier[]> = {
  STC: ['TN', 'UI', 'SY'],
  JES: ['TN', 'UI', 'TC'],
  CICS: ['TN', 'UI', 'TC'],
  DDF: ['UI', 'PK', 'CI'],
  TSO: ['UI', 'SY'],
  MQ: ['TN', 'UI', 'TC'],
  OMVS: ['TN', 'UI', 'SY'],
};
// SYSSTC only in ASCH, JES, OMVS, STC and TSO rules; SYSTEM only in STC (WLM Planning p.102).
const SYSSTC_SUBSYSTEMS: readonly SubsystemType[] = ['JES', 'OMVS', 'STC', 'TSO'];

const MAX_RT_SEC = 24 * 3600;

/** Goal ranges from WLM Planning p.67: velocity and percentile 1–99, response time 1 ms–24 h. */
export function goalError(g: Goal): string | null {
  const rtOk = (rt: number) => Number.isFinite(rt) && rt >= 0.001 && rt <= MAX_RT_SEC;
  switch (g.kind) {
    case 'VEL':
      return Number.isFinite(g.velocity) && g.velocity >= 1 && g.velocity <= 99 ? null : 'Velocity ranges from 1 to 99';
    case 'PCT':
      if (!(Number.isFinite(g.pct) && g.pct >= 1 && g.pct <= 99)) return 'Percentile boundaries vary from 1 to 99';
      return rtOk(g.rtSec) ? null : 'Response time ranges from 1 millisecond to 24 hours';
    case 'AVG':
      return rtOk(g.rtSec) ? null : 'Response time varies from 1 millisecond to 24 hours';
    case 'DISC':
      return null;
  }
}

const importanceError = (i: number) => (Number.isInteger(i) && i >= 1 && i <= 5 ? null : 'Importance is 1 (highest) to 5');

// CPU Critical: "the service class must have only one period, and it cannot have a discretionary goal" (WLM Planning p.120).
const CPU_CRITICAL_RULE = 'CPU Critical needs a single-period service class without a discretionary goal';

function classTargetError(subsystem: SubsystemType, sc: string | null): string | null {
  if (sc === 'SYSTEM' && subsystem !== 'STC') return 'SYSTEM can only be assigned in STC classification rules';
  if (sc === 'SYSSTC' && !SYSSTC_SUBSYSTEMS.includes(subsystem)) return `SYSSTC can only be assigned in ${SYSSTC_SUBSYSTEMS.join(', ')} classification rules`;
  return null;
}

function ensureSubsystem(d: ServiceDefinition, subsystem: SubsystemType): SubsystemRules {
  let ss = d.subsystems.find((x) => x.subsystem === subsystem);
  if (!ss) {
    ss = { subsystem, defaultServiceClass: null, defaultReportClass: null, rules: [] };
    d.subsystems.push(ss);
  }
  return ss;
}

/** Qualifiers of the rules on the path to a list position ([] = top level). */
function ancestorQualifiers(ss: SubsystemRules, parent: RulePath): Qualifier[] {
  const out: Qualifier[] = [];
  let list = ss.rules;
  for (const i of parent) {
    const r = list[i];
    if (!r) break;
    out.push(r.qualifier);
    list = r.children;
  }
  return out;
}

/** BASEPOL → BASEPOL2 → BASEPOL3 …, so RMF reports show which policy was active. The stem gives way to keep
 * the name within 8 characters (BASEPOL9 → BASEPO10). */
export function nextPolicyName(name: string): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  const n = String(m ? Number(m[2]) + 1 : 2);
  return `${(m ? m[1]! : name).slice(0, 8 - n.length)}${n}`;
}

/** Where WLM edits accumulate: the pending policy, or else a renamed copy of the active one. */
export function pendingBase(pending: ServiceDefinition | null, active: ServiceDefinition): ServiceDefinition {
  return pending ?? { ...active, policyName: nextPolicyName(active.policyName) };
}

/** Validate a report class name and register it in the definition (report classes are just names). */
function useReportClass(d: ServiceDefinition, rc: string | null | undefined): string | null {
  if (rc === undefined || rc === null) return null;
  if (!/^[A-Z][A-Z0-9#@$]{0,7}$/.test(rc)) return 'Report class names are 1–8 characters, starting with a letter';
  if (d.classes.some((c) => c.id === rc)) return `${rc} is a service class; report classes need their own names`;
  if (!d.reportClasses.includes(rc)) d.reportClasses.push(rc);
  return null;
}

export function applyWlmEdit(def: ServiceDefinition, e: WlmEdit): ServiceDefinition | string {
  const res = applyEdit(def, e);
  if (typeof res === 'string') return res;
  // Only refuse errors this edit introduces, so an older policy that already has one stays editable.
  const before = new Set(cicsGoalIssues(def).filter((i) => i.severity === 'error').map((i) => i.message));
  const added = cicsGoalIssues(res).find((i) => i.severity === 'error' && !before.has(i.message));
  return added ? added.message : res;
}

/** Service classes that CICS transactions are classified into (CICS rules and default), built-ins excluded. */
export function cicsTransactionClasses(def: ServiceDefinition): string[] {
  const ids = new Set<string>();
  const walk = (rules: readonly ClassificationRule[]) => {
    for (const r of rules) {
      if (r.serviceClass) ids.add(r.serviceClass);
      walk(r.children);
    }
  };
  for (const ss of def.subsystems) {
    if (ss.subsystem !== 'CICS') continue;
    if (ss.defaultServiceClass) ids.add(ss.defaultServiceClass);
    walk(ss.rules);
  }
  return def.classes.map((c) => c.id).filter((id) => ids.has(id));
}

export interface CicsGoalIssue {
  classId: string;
  severity: 'error' | 'warning';
  message: string;
}

/** CICS transaction classes take only single-period response-time goals and no resource group
 * (WLM Planning ch. 9–10, SG24-6472). IBM documents an ISPF error only for the resource group;
 * velocity and multi-period are just "not supported", so those stay warnings. */
export function cicsGoalIssues(def: ServiceDefinition): CicsGoalIssue[] {
  const out: CicsGoalIssue[] = [];
  for (const id of cicsTransactionClasses(def)) {
    const c = def.classes.find((x) => x.id === id)!;
    if (c.resourceGroup)
      out.push({ classId: id, severity: 'error', message: `${id} serves CICS transactions, which can't be in a resource group (WLM Planning). Take it out of ${c.resourceGroup} or classify the CICS work into another class.` });
    if (c.periods.length > 1)
      out.push({ classId: id, severity: 'warning', message: `${id} serves CICS transactions but has ${c.periods.length} periods: not supported (WLM Planning ch. 9–10). Service is accounted to the regions, so WLM can't track a period duration for a transaction.` });
    const kinds = [...new Set(c.periods.map((p) => p.goal.kind).filter((k) => k === 'VEL' || k === 'DISC'))];
    for (const k of kinds)
      out.push({
        classId: id,
        severity: 'warning',
        message: `${id} serves CICS transactions but has a ${k === 'VEL' ? 'velocity' : 'discretionary'} goal: not supported (WLM Planning ch. 9–10). ${k === 'VEL' ? 'Velocity data is accounted to the regions; ' : ''}CICS transactions take only response-time goals (average or percentile).`,
      });
  }
  return out;
}

function applyEdit(def: ServiceDefinition, e: WlmEdit): ServiceDefinition | string {
  const d = structuredClone(def);
  switch (e.op) {
    case 'SET_PERIOD': {
      const c = d.classes.find((x) => x.id === e.classId);
      const p = c?.periods[e.period];
      if (!c) return `No service class ${e.classId}`;
      if (!p) return `No period index ${e.period} in ${e.classId} (period is 0-based; it has ${c.periods.length} period${c.periods.length === 1 ? '' : 's'}: index 0${c.periods.length > 1 ? `..${c.periods.length - 1}` : ''})`;
      if (e.goal.kind === 'DISC' && e.period !== c.periods.length - 1) return 'Discretionary is only allowed in the last period';
      const gErr = goalError(e.goal) ?? importanceError(e.importance);
      if (gErr) return gErr;
      if (e.goal.kind === 'DISC' && c.cpuCritical) return CPU_CRITICAL_RULE;
      if (e.durationSu !== undefined) {
        const last = e.period === c.periods.length - 1;
        if (last && e.durationSu !== null) return 'The last period has no duration';
        if (!last && !(e.durationSu !== null && Number.isFinite(e.durationSu) && e.durationSu > 0)) return 'Duration must be a number of service units above 0';
      }
      p.goal = e.goal;
      p.importance = e.importance;
      if (e.durationSu !== undefined) p.durationSu = e.durationSu;
      return d;
    }
    case 'ADD_CLASS':
      if (d.classes.some((x) => x.id === e.classId) || ['SYSTEM', 'SYSSTC', 'SYSOTHER'].includes(e.classId)) return `${e.classId} already exists`;
      if (!/^[A-Z][A-Z0-9]{0,7}$/.test(e.classId)) return 'Service class names are 1–8 characters, A–Z/0–9';
      {
        const gErr = goalError(e.goal) ?? importanceError(e.importance);
        if (gErr) return gErr;
      }
      if (e.cpuCritical && e.goal.kind === 'DISC') return CPU_CRITICAL_RULE;
      d.classes.push({ id: e.classId, description: e.description, periods: [{ goal: e.goal, importance: e.importance, durationSu: null }], cpuCritical: e.cpuCritical, storageCritical: false, resourceGroup: null, honorPriority: true });
      return d;
    case 'ADD_PERIOD': {
      const c = d.classes.find((x) => x.id === e.classId);
      if (!c) return `No class ${e.classId}`;
      if (c.periods.length >= 8) return 'At most 8 periods';
      if (c.cpuCritical) return CPU_CRITICAL_RULE;
      const gErr = goalError(e.goal) ?? importanceError(e.importance);
      if (gErr) return gErr;
      const last = c.periods[c.periods.length - 1]!;
      if (last.goal.kind === 'DISC') return 'Discretionary must stay the last period';
      if (!(Number.isFinite(e.previousDurationSu) && e.previousDurationSu > 0)) return `Give period ${c.periods.length} a duration (service units) first`;
      last.durationSu = Math.round(e.previousDurationSu);
      c.periods.push({ goal: e.goal, importance: e.importance, durationSu: null });
      return d;
    }
    case 'REMOVE_PERIOD': {
      const c = d.classes.find((x) => x.id === e.classId);
      if (!c) return `No class ${e.classId}`;
      if (c.periods.length <= 1) return 'A class needs at least one period';
      c.periods.pop();
      c.periods[c.periods.length - 1]!.durationSu = null;
      return d;
    }
    case 'DELETE_CLASS': {
      const i = d.classes.findIndex((x) => x.id === e.classId);
      if (i < 0) return `No class ${e.classId}`;
      const uses = (rules: readonly ClassificationRule[]): boolean => rules.some((r) => r.serviceClass === e.classId || uses(r.children));
      const used = d.subsystems.filter((ss) => ss.defaultServiceClass === e.classId || uses(ss.rules)).map((ss) => ss.subsystem);
      if (used.length) return `${e.classId} is still used by classification rules (${used.join(', ')}); retarget them first`;
      const rg = d.classes[i]!.resourceGroup;
      d.classes.splice(i, 1);
      if (rg && !d.classes.some((x) => x.resourceGroup === rg)) d.resourceGroups = d.resourceGroups.filter((g) => g.id !== rg);
      return d;
    }
    case 'SET_RULE_REGION_MODE': {
      // "This option can be used only in STC and JES classification rules" (WLM Planning p.122).
      if (e.subsystem !== 'STC' && e.subsystem !== 'JES') return 'Manage Region Using Goals Of can only be set in STC and JES classification rules';
      const ss = d.subsystems.find((x) => x.subsystem === e.subsystem);
      const list = ss && listAt(ss, e.path.slice(0, -1));
      const r = list?.[e.path[e.path.length - 1] ?? -1];
      if (!r) return 'No such rule';
      if (e.mode === null) delete r.regionMode;
      else r.regionMode = e.mode;
      return d;
    }
    case 'SET_IO_PRIORITY':
      d.ioPriorityManagement = e.on;
      return d;
    case 'SET_RESOURCE_GROUP': {
      const c = d.classes.find((x) => x.id === e.classId);
      if (!c) return `No class ${e.classId}`;
      const old = c.resourceGroup;
      if (e.group) {
        const g = e.group;
        if (!/^[A-Z][A-Z0-9#@$]{0,7}$/.test(g.id)) return 'Resource group names are 1–8 characters, starting with a letter';
        const bad = (x: number | null) => x !== null && !(Number.isFinite(x) && x >= 0);
        if (bad(g.min) || bad(g.max)) return 'Minimum and maximum must be numbers ≥ 0 (or blank)';
        if (g.min === null && g.max === null) return 'Set a minimum, a maximum or both';
        if (g.min !== null && g.max !== null && g.min > g.max) return 'Minimum is above maximum';
        if (g.type === 2 && (g.max ?? 0) > 100) return 'Type 2 is a percentage of the LPAR share (≤ 100)';
        const i = d.resourceGroups.findIndex((x) => x.id === g.id);
        if (i < 0 && d.resourceGroups.length >= 32) return 'At most 32 resource groups';
        if (i < 0) d.resourceGroups.push({ ...g });
        else d.resourceGroups[i] = { ...g };
        c.resourceGroup = g.id;
      } else c.resourceGroup = null;
      // A group nobody uses any more is dropped.
      if (old && !d.classes.some((x) => x.resourceGroup === old)) d.resourceGroups = d.resourceGroups.filter((x) => x.id !== old);
      return d;
    }
    case 'SET_FLAGS': {
      const c = d.classes.find((x) => x.id === e.classId);
      if (!c) return `No class ${e.classId}`;
      if (e.cpuCritical && (c.periods.length !== 1 || c.periods[0]!.goal.kind === 'DISC')) return CPU_CRITICAL_RULE;
      if (e.cpuCritical !== undefined) c.cpuCritical = e.cpuCritical;
      if (e.storageCritical !== undefined) c.storageCritical = e.storageCritical;
      return d;
    }
    case 'ADD_RULE': {
      if (!knownClass(d, e.serviceClass)) return `No class ${e.serviceClass}`;
      if (!e.pattern.trim()) return 'A rule needs a pattern';
      if (!VALID_QUALIFIERS[e.subsystem].includes(e.qualifier)) return `${e.qualifier} is not a work qualifier for ${e.subsystem} (valid: ${VALID_QUALIFIERS[e.subsystem].join(', ')})`;
      if (e.pattern.trim().length > 8) return 'Qualifier names are at most 8 characters';
      const tErr = classTargetError(e.subsystem, e.serviceClass);
      if (tErr) return tErr;
      const rcErr = useReportClass(d, e.reportClass);
      if (rcErr) return rcErr;
      const ss = ensureSubsystem(d, e.subsystem);
      // Default position is first, so the new rule takes precedence (first match wins).
      const at = e.at ?? [0];
      const list = listAt(ss, at.slice(0, -1));
      if (!list) return 'No such rule position';
      // Only qualifiers longer than 8 characters can be nested in themselves (WLM Planning p.99).
      if (ancestorQualifiers(ss, at.slice(0, -1)).includes(e.qualifier)) return `${e.qualifier} cannot be nested under another ${e.qualifier} rule`;
      const idx = Math.min(Math.max(0, at[at.length - 1] ?? 0), list.length);
      list.splice(idx, 0, { qualifier: e.qualifier, pattern: e.pattern.trim().toUpperCase(), serviceClass: e.serviceClass, reportClass: e.reportClass ?? null, children: [] });
      return d;
    }
    case 'DELETE_RULE': {
      const ss = d.subsystems.find((x) => x.subsystem === e.subsystem);
      const list = ss && listAt(ss, e.path.slice(0, -1));
      const i = e.path[e.path.length - 1];
      if (!list || i === undefined || !list[i]) return 'No such rule';
      list.splice(i, 1);
      return d;
    }
    case 'MOVE_RULE': {
      const ss = d.subsystems.find((x) => x.subsystem === e.subsystem);
      const list = ss && listAt(ss, e.path.slice(0, -1));
      const i = e.path[e.path.length - 1];
      if (!list || i === undefined || !list[i]) return 'No such rule';
      const j = i + e.delta;
      if (j < 0 || j >= list.length) return e.delta < 0 ? 'Already the first rule at this level' : 'Already the last rule at this level';
      [list[i], list[j]] = [list[j]!, list[i]!];
      return d;
    }
    case 'SET_RULE_TARGET': {
      if (e.serviceClass !== null && !knownClass(d, e.serviceClass)) return `No class ${e.serviceClass}`;
      const tErr = classTargetError(e.subsystem, e.serviceClass);
      if (tErr) return tErr;
      const ss = d.subsystems.find((x) => x.subsystem === e.subsystem);
      const list = ss && listAt(ss, e.path.slice(0, -1));
      const r = list?.[e.path[e.path.length - 1] ?? -1];
      if (!r) return 'No such rule';
      const rcErr = useReportClass(d, e.reportClass);
      if (rcErr) return rcErr;
      r.serviceClass = e.serviceClass;
      if (e.reportClass !== undefined) r.reportClass = e.reportClass;
      return d;
    }
    case 'SET_DEFAULT': {
      if (e.serviceClass !== null && !knownClass(d, e.serviceClass)) return `No class ${e.serviceClass}`;
      {
        const tErr = classTargetError(e.subsystem, e.serviceClass);
        if (tErr) return tErr;
      }
      const ss = ensureSubsystem(d, e.subsystem);
      ss.defaultServiceClass = e.serviceClass;
      return d;
    }
    case 'REMOVE_RULE': {
      const ss = d.subsystems.find((x) => x.subsystem === e.subsystem);
      if (!ss || !ss.rules[e.index]) return 'No such rule';
      ss.rules.splice(e.index, 1);
      return d;
    }
  }
}

const knownClass = (d: ServiceDefinition, id: string) => ['SYSTEM', 'SYSSTC', 'SYSOTHER'].includes(id) || d.classes.some((c) => c.id === id);

/** The rule list at a parent path ([] = top level). */
function listAt(ss: SubsystemRules, parent: RulePath): ClassificationRule[] | null {
  let list = ss.rules;
  for (const i of parent) {
    const r = list[i];
    if (!r) return null;
    list = r.children;
  }
  return list;
}
