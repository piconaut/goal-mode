// Small structured edits to a WLM service definition (the UI's policy editor builds
// ACTIVATE_POLICY commands from these). Pure: returns a new definition.

import type { ResourceGroupDef, ClassificationRule, Goal, Importance, ServiceDefinition, SubsystemRules, SubsystemType, Qualifier } from '../sim/wlm/types';

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
  /** Append a period; the previous last period needs a duration (service units) to hand work on. */
  | { op: 'ADD_PERIOD'; classId: string; goal: Goal; importance: Importance; previousDurationSu: number }
  | { op: 'REMOVE_PERIOD'; classId: string }
  | { op: 'DELETE_CLASS'; classId: string };

/** Validate a report class name and register it in the definition (report classes are just names). */
function useReportClass(d: ServiceDefinition, rc: string | null | undefined): string | null {
  if (rc === undefined || rc === null) return null;
  if (!/^[A-Z][A-Z0-9#@$]{0,7}$/.test(rc)) return 'Report class names are 1–8 characters, starting with a letter';
  if (d.classes.some((c) => c.id === rc)) return `${rc} is a service class; report classes need their own names`;
  if (!d.reportClasses.includes(rc)) d.reportClasses.push(rc);
  return null;
}

export function applyWlmEdit(def: ServiceDefinition, e: WlmEdit): ServiceDefinition | string {
  const d = structuredClone(def);
  switch (e.op) {
    case 'SET_PERIOD': {
      const c = d.classes.find((x) => x.id === e.classId);
      const p = c?.periods[e.period];
      if (!c || !p) return `No period ${e.period + 1} in ${e.classId}`;
      if (e.goal.kind === 'DISC' && e.period !== c.periods.length - 1) return 'Discretionary is only allowed in the last period';
      p.goal = e.goal;
      p.importance = e.importance;
      if (e.durationSu !== undefined) p.durationSu = e.durationSu;
      return d;
    }
    case 'ADD_CLASS':
      if (d.classes.some((x) => x.id === e.classId) || ['SYSTEM', 'SYSSTC', 'SYSOTHER'].includes(e.classId)) return `${e.classId} already exists`;
      if (!/^[A-Z][A-Z0-9]{0,7}$/.test(e.classId)) return 'Service class names are 1–8 characters, A–Z/0–9';
      d.classes.push({ id: e.classId, description: e.description, periods: [{ goal: e.goal, importance: e.importance, durationSu: null }], cpuCritical: e.cpuCritical, storageCritical: false, resourceGroup: null, honorPriority: true });
      return d;
    case 'ADD_PERIOD': {
      const c = d.classes.find((x) => x.id === e.classId);
      if (!c) return `No class ${e.classId}`;
      if (c.periods.length >= 8) return 'At most 8 periods';
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
      if (e.cpuCritical !== undefined) c.cpuCritical = e.cpuCritical;
      if (e.storageCritical !== undefined) c.storageCritical = e.storageCritical;
      return d;
    }
    case 'ADD_RULE': {
      if (!knownClass(d, e.serviceClass)) return `No class ${e.serviceClass}`;
      if (!e.pattern.trim()) return 'A rule needs a pattern';
      const rcErr = useReportClass(d, e.reportClass);
      if (rcErr) return rcErr;
      let ss = d.subsystems.find((x) => x.subsystem === e.subsystem);
      if (!ss) {
        ss = { subsystem: e.subsystem, defaultServiceClass: null, defaultReportClass: null, rules: [] };
        d.subsystems.push(ss);
      }
      // Default position is first, so the new rule takes precedence (first match wins).
      const at = e.at ?? [0];
      const list = listAt(ss, at.slice(0, -1));
      if (!list) return 'No such rule position';
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
      let ss = d.subsystems.find((x) => x.subsystem === e.subsystem);
      if (!ss) {
        ss = { subsystem: e.subsystem, defaultServiceClass: null, defaultReportClass: null, rules: [] };
        d.subsystems.push(ss);
      }
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
