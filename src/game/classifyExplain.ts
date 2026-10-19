// "What lands where": for each subsystem's rules (in evaluation order), which known work each
// rule catches. Mirrors the classification walk in sim/wlm/classify.ts (first match wins at
// each level; a nested match refines its parent) but records the matching rule's path.

import type { AddressSpaceDef, WorkloadDef } from '../sim/workload/types';
import { classify, wildcardMatch } from '../sim/wlm/classify';
import { FORCED_SYSTEM_JOBNAMES, SYSOTHER, SYSSTC, type ClassificationRule, type ServiceDefinition, type SubsystemType, type WorkAttributes } from '../sim/wlm/types';
import type { RulePath } from './wlmEdit';

export interface WorkItem {
  label: string;
  kind: 'workload' | 'address space' | 'batch';
  work: WorkAttributes;
}

export interface RuleRow {
  path: RulePath;
  depth: number;
  qualifier: string;
  pattern: string;
  serviceClass: string | null;
  reportClass: string | null;
  /** Work whose final match is this rule. */
  catches: string[];
  /** Resulting service class for that work (a nested rule may override). */
  effectiveClass: string;
}

export interface SubsystemExplain {
  subsystem: SubsystemType;
  defaultServiceClass: string;
  /** True when the default is the built-in fallback (SYSSTC for STC, SYSOTHER otherwise). */
  builtInDefault: boolean;
  rows: RuleRow[];
  defaultCatches: string[];
}

export interface ClassificationExplain {
  subsystems: SubsystemExplain[];
  forcedSystem: string[];
  sysother: string[];
}

const SUBSYSTEMS: SubsystemType[] = ['STC', 'JES', 'CICS', 'DDF', 'TSO', 'MQ', 'OMVS'];

/** Work items for a scenario: workloads, address spaces (one per jobname), batch streams. */
export function workItems(workloads: readonly WorkloadDef[], addressSpaces: readonly AddressSpaceDef[], jobs: readonly { name: string; jobClass: string; stream: string }[]): WorkItem[] {
  const items: WorkItem[] = workloads.map((w) => ({ label: w.id, kind: 'workload', work: w.work }));
  const seen = new Set<string>();
  for (const a of addressSpaces) {
    if (seen.has(a.jobname)) continue;
    seen.add(a.jobname);
    items.push({ label: a.jobname, kind: 'address space', work: { subsystem: a.subsystem, TN: a.jobname } });
  }
  // One item per batch stream (jobs in a stream share their naming pattern and class).
  const streams: Record<string, { first: string; last: string; jobClass: string; n: number }> = {};
  for (const j of jobs) {
    const s = (streams[`${j.stream}/${j.jobClass}`] ??= { first: j.name, last: j.name, jobClass: j.jobClass, n: 0 });
    s.last = j.name;
    s.n++;
  }
  for (const s of Object.values(streams)) {
    items.push({ label: s.n > 1 ? `${s.first}–${s.last} (${s.n} jobs)` : s.first, kind: 'batch', work: { subsystem: 'JES', TN: s.first, TC: s.jobClass } });
  }
  return items;
}

function matchPath(rules: readonly ClassificationRule[], work: WorkAttributes, prefix: RulePath): RulePath | null {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]!;
    const v = work[r.qualifier as keyof WorkAttributes];
    if (v === undefined || !wildcardMatch(r.pattern, v)) continue;
    const here = [...prefix, i];
    return matchPath(r.children, work, here) ?? here;
  }
  return null;
}

export function explainClassification(def: ServiceDefinition, items: readonly WorkItem[]): ClassificationExplain {
  const forcedSystem: string[] = [];
  const sysother: string[] = [];
  const subsystems: SubsystemExplain[] = [];
  const byKey: Record<string, { catches: string[]; cls: string }> = {};
  const defaults: Record<string, string[]> = {};

  for (const it of items) {
    const res = classify(def, it.work);
    if (res.serviceClass === SYSOTHER) sysother.push(it.label);
    if (it.work.subsystem === 'STC' && it.work.TN && FORCED_SYSTEM_JOBNAMES.includes(it.work.TN.toUpperCase())) {
      forcedSystem.push(it.label);
      continue;
    }
    const ss = def.subsystems.find((x) => x.subsystem === it.work.subsystem);
    const path = ss ? matchPath(ss.rules, it.work, []) : null;
    if (path) {
      const k = `${it.work.subsystem}|${path.join('.')}`;
      const e = (byKey[k] ??= { catches: [], cls: res.serviceClass });
      e.catches.push(it.label);
    } else (defaults[it.work.subsystem] ??= []).push(it.label);
  }

  for (const subsystem of SUBSYSTEMS) {
    const ss = def.subsystems.find((x) => x.subsystem === subsystem);
    const fallback = subsystem === 'STC' ? SYSSTC : SYSOTHER;
    const rows: RuleRow[] = [];
    const walk = (rules: readonly ClassificationRule[], prefix: RulePath) =>
      rules.forEach((r, i) => {
        const path = [...prefix, i];
        const hit = byKey[`${subsystem}|${path.join('.')}`];
        rows.push({
          path,
          depth: prefix.length,
          qualifier: r.qualifier,
          pattern: r.pattern,
          serviceClass: r.serviceClass,
          reportClass: r.reportClass,
          catches: hit?.catches ?? [],
          effectiveClass: hit?.cls ?? r.serviceClass ?? '(parent)',
        });
        walk(r.children, path);
      });
    if (ss) walk(ss.rules, []);
    const catches = defaults[subsystem] ?? [];
    if (!ss && catches.length === 0) continue;
    subsystems.push({
      subsystem,
      defaultServiceClass: ss?.defaultServiceClass ?? fallback,
      builtInDefault: !ss?.defaultServiceClass,
      rows,
      defaultCatches: catches,
    });
  }
  return { subsystems, forcedSystem, sysother };
}

export type RowChange = 'added' | 'changed' | 'same';

/** Compare pending rows against active rows of the same subsystem by rule identity. */
export function diffRows(active: readonly RuleRow[], pending: readonly RuleRow[]): { changes: RowChange[]; removed: RuleRow[] } {
  const key = (r: RuleRow) => `${r.depth}|${r.qualifier}=${r.pattern}`;
  const act = new Map(active.map((r) => [key(r), r] as const));
  const changes = pending.map((r): RowChange => {
    const a = act.get(key(r));
    if (!a) return 'added';
    return a.serviceClass !== r.serviceClass || a.reportClass !== r.reportClass || a.path.join('.') !== r.path.join('.') ? 'changed' : 'same';
  });
  const pend = new Set(pending.map(key));
  return { changes, removed: active.filter((r) => !pend.has(key(r))) };
}
