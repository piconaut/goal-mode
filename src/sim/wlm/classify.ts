// Classification rule engine. First matching rule wins at each level; nested rules
// refine a match. Unmatched non-STC work goes to SYSOTHER, unmatched STCs to SYSSTC.

import {
  FORCED_SYSTEM_JOBNAMES,
  SYSOTHER,
  SYSSTC,
  SYSTEM,
  type ClassificationRule,
  type RegionMode,
  type ServiceDefinition,
  type WorkAttributes,
} from './types';

const regexCache = new Map<string, RegExp>();
const resultCache = new WeakMap<ServiceDefinition, Map<string, ClassificationResult>>();

export function wildcardMatch(pattern: string, value: string): boolean {
  let rx = regexCache.get(pattern);
  if (!rx) {
    rx = compileWildcard(pattern);
    regexCache.set(pattern, rx);
  }
  return rx.test(value.toUpperCase());
}

// WLM masks: % is one character (trailing % may also match none); * is a wildcard only
// when last or alone, a literal anywhere else (WLM Planning, z/OS 3.1, p.104).
function compileWildcard(pattern: string): RegExp {
  const p = pattern.toUpperCase();
  const trailingPct = p.length - p.replace(/%+$/, '').length;
  let re = '^';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    if (ch === '*' && i === p.length - 1) re += '.*';
    else if (ch === '%') re += i >= p.length - trailingPct ? '.?' : '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

export interface ClassificationResult {
  serviceClass: string;
  reportClass: string | null;
  /** Describes how the result was reached, for the rule test bench. */
  path: string[];
  /** STC/JES only: "Manage Region Using Goals Of" set on the matching rule (or an enclosing one). */
  regionMode?: RegionMode;
}

function walk(
  rules: readonly ClassificationRule[],
  work: WorkAttributes,
  path: string[],
): { sc: string | null; rc: string | null; rm?: RegionMode } | null {
  for (const r of rules) {
    const v = work[r.qualifier];
    if (v === undefined || !wildcardMatch(r.pattern, v)) continue;
    path.push(`${r.qualifier}=${r.pattern}`);
    const deeper = walk(r.children, work, path);
    const rm = deeper?.rm ?? r.regionMode;
    return {
      sc: deeper?.sc ?? r.serviceClass,
      rc: deeper?.rc ?? r.reportClass,
      ...(rm ? { rm } : {}),
    };
  }
  return null;
}

/** Memoised per service definition object; edits produce a new definition object. */
export function classify(def: ServiceDefinition, work: WorkAttributes): ClassificationResult {
  let cache = resultCache.get(def);
  if (!cache) {
    cache = new Map();
    resultCache.set(def, cache);
  }
  const key = `${work.subsystem}|${work.TN ?? ''}|${work.UI ?? ''}|${work.TC ?? ''}|${work.PK ?? ''}|${work.CI ?? ''}|${work.SY ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = classifyUncached(def, work);
  cache.set(key, res);
  return res;
}

export function classifyUncached(def: ServiceDefinition, work: WorkAttributes): ClassificationResult {
  if (work.subsystem === 'STC' && work.TN && FORCED_SYSTEM_JOBNAMES.includes(work.TN.toUpperCase())) {
    return { serviceClass: SYSTEM, reportClass: null, path: ['forced SYSTEM'] };
  }
  const ss = def.subsystems.find((s) => s.subsystem === work.subsystem);
  const path: string[] = [work.subsystem];
  const fallback = work.subsystem === 'STC' ? SYSSTC : SYSOTHER;
  if (!ss) return { serviceClass: fallback, reportClass: null, path: [...path, 'no rules'] };
  const hit = walk(ss.rules, work, path);
  const sc = hit?.sc ?? ss.defaultServiceClass ?? fallback;
  const rc = hit?.rc ?? ss.defaultReportClass;
  if (!hit) path.push('default');
  const known = sc === SYSTEM || sc === SYSSTC || sc === SYSOTHER || def.classes.some((c) => c.id === sc);
  const out: ClassificationResult = { serviceClass: known ? sc : SYSOTHER, reportClass: rc, path };
  if (hit?.rm && (work.subsystem === 'STC' || work.subsystem === 'JES')) out.regionMode = hit.rm;
  return out;
}
