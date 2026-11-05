// "What lands where": for each subsystem's rules (in evaluation order), which known work each
// rule catches. Mirrors the classification walk in sim/wlm/classify.ts (first match wins at
// each level; a nested match refines its parent) but records the matching rule's path.

import type { AddressSpaceDef, WorkloadDef } from '../sim/workload/types';
import { classify, wildcardMatch } from '../sim/wlm/classify';
import { FORCED_SYSTEM_JOBNAMES, SYSOTHER, SYSSTC, type ClassificationRule, type RegionMode, type ServiceDefinition, type SubsystemType, type WorkAttributes } from '../sim/wlm/types';
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
  /** STC/JES rules: "Manage Region Using Goals Of" set on this rule (absent: inherited). */
  regionMode?: RegionMode;
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
  /** "Manage Region Using Goals Of" for rules that set none (the legacy policy-wide value, else TRANSACTION). */
  regionModeDefault: 'TRANSACTION' | 'REGION';
  forcedSystem: string[];
  sysother: string[];
}

const SUBSYSTEMS: SubsystemType[] = ['STC', 'JES', 'CICS', 'DDF', 'TSO', 'MQ', 'OMVS'];

/** Work items for a scenario: workloads, address spaces (one per jobname/system), batch streams. */
export function workItems(workloads: readonly WorkloadDef[], addressSpaces: readonly AddressSpaceDef[], jobs: readonly { name: string; jobClass: string; stream: string }[]): WorkItem[] {
  const items: WorkItem[] = workloads.map((w) => ({ label: w.id, kind: 'workload', work: w.work }));
  const systemsByJobname = new Map<string, Set<string>>();
  for (const a of addressSpaces) {
    let systems = systemsByJobname.get(a.jobname);
    if (!systems) systemsByJobname.set(a.jobname, (systems = new Set()));
    systems.add(a.lparId);
  }
  const seen = new Set<string>();
  for (const a of addressSpaces) {
    const key = `${a.jobname}/${a.lparId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = systemsByJobname.get(a.jobname)!.size > 1 ? `${a.jobname} (${a.lparId})` : a.jobname;
    items.push({ label, kind: 'address space', work: { subsystem: a.subsystem, TN: a.jobname, SY: a.lparId } });
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

  const destinationsByJobname = new Map<string, Set<string>>();
  const classified = items.map((it) => {
    const res = classify(def, it.work);
    const forced = it.work.subsystem === 'STC' && !!it.work.TN && FORCED_SYSTEM_JOBNAMES.includes(it.work.TN.toUpperCase());
    const ss = def.subsystems.find((x) => x.subsystem === it.work.subsystem);
    const path = !forced && ss ? matchPath(ss.rules, it.work, []) : null;
    const destination = forced ? 'forced' : `${it.work.subsystem}|${path?.join('.') ?? 'default'}`;
    if (it.kind === 'address space' && it.work.TN) {
      let destinations = destinationsByJobname.get(it.work.TN);
      if (!destinations) destinationsByJobname.set(it.work.TN, (destinations = new Set()));
      destinations.add(destination);
    }
    return { it, res, forced, path };
  });
  const collapsed = new Set<string>();
  for (const { it, res, forced, path } of classified) {
    let label = it.label;
    // Keep systems visible when their final rule paths differ, even if the class is the same.
    if (it.kind === 'address space' && it.work.TN && destinationsByJobname.get(it.work.TN)!.size === 1) {
      if (collapsed.has(it.work.TN)) continue;
      collapsed.add(it.work.TN);
      label = it.work.TN;
    }
    if (res.serviceClass === SYSOTHER) sysother.push(label);
    if (forced) {
      forcedSystem.push(label);
      continue;
    }
    if (path) {
      const k = `${it.work.subsystem}|${path.join('.')}`;
      const e = (byKey[k] ??= { catches: [], cls: res.serviceClass });
      e.catches.push(label);
    } else (defaults[it.work.subsystem] ??= []).push(label);
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
          ...(r.regionMode ? { regionMode: r.regionMode } : {}),
        });
        walk(r.children, path);
      });
    if (ss) walk(ss.rules, []);
    const catches = defaults[subsystem] ?? [];
    subsystems.push({
      subsystem,
      defaultServiceClass: ss?.defaultServiceClass ?? fallback,
      builtInDefault: !ss?.defaultServiceClass,
      rows,
      defaultCatches: catches,
    });
  }
  return { subsystems, regionModeDefault: def.cicsRegionMode ?? 'TRANSACTION', forcedSystem, sysother };
}

export type RowChange = 'added' | 'changed' | 'same';

/** Compare pending rows against active rows of the same subsystem by rule identity. */
export function diffRows(active: readonly RuleRow[], pending: readonly RuleRow[]): { changes: RowChange[]; removed: RuleRow[] } {
  const key = (r: RuleRow) => `${r.depth}|${r.qualifier}=${r.pattern}`;
  const act = new Map(active.map((r) => [key(r), r] as const));
  const changes = pending.map((r): RowChange => {
    const a = act.get(key(r));
    if (!a) return 'added';
    return a.serviceClass !== r.serviceClass || a.reportClass !== r.reportClass || a.regionMode !== r.regionMode || a.path.join('.') !== r.path.join('.') ? 'changed' : 'same';
  });
  const pend = new Set(pending.map(key));
  return { changes, removed: active.filter((r) => !pend.has(key(r))) };
}
