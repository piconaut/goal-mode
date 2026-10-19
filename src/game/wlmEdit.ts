// Small structured edits to a WLM service definition (the UI's policy editor builds
// ACTIVATE_POLICY commands from these). Pure: returns a new definition.

import type { Goal, Importance, ServiceDefinition, SubsystemType, Qualifier } from '../sim/wlm/types';

export type WlmEdit =
  | { op: 'SET_PERIOD'; classId: string; period: number; goal: Goal; importance: Importance; durationSu?: number | null }
  | { op: 'ADD_CLASS'; classId: string; description: string; goal: Goal; importance: Importance; cpuCritical: boolean }
  | { op: 'SET_FLAGS'; classId: string; cpuCritical?: boolean; storageCritical?: boolean }
  | { op: 'ADD_RULE'; subsystem: SubsystemType; qualifier: Qualifier; pattern: string; serviceClass: string }
  | { op: 'REMOVE_RULE'; subsystem: SubsystemType; index: number };

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
    case 'SET_FLAGS': {
      const c = d.classes.find((x) => x.id === e.classId);
      if (!c) return `No class ${e.classId}`;
      if (e.cpuCritical !== undefined) c.cpuCritical = e.cpuCritical;
      if (e.storageCritical !== undefined) c.storageCritical = e.storageCritical;
      return d;
    }
    case 'ADD_RULE': {
      if (!['SYSTEM', 'SYSSTC', 'SYSOTHER'].includes(e.serviceClass) && !d.classes.some((c) => c.id === e.serviceClass)) return `No class ${e.serviceClass}`;
      let ss = d.subsystems.find((x) => x.subsystem === e.subsystem);
      if (!ss) {
        ss = { subsystem: e.subsystem, defaultServiceClass: null, defaultReportClass: null, rules: [] };
        d.subsystems.push(ss);
      }
      // New rules go first so they take precedence (first match wins).
      ss.rules.unshift({ qualifier: e.qualifier, pattern: e.pattern.toUpperCase(), serviceClass: e.serviceClass, reportClass: null, children: [] });
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
