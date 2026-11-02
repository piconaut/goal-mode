import { STRAIN, WLM_DISAGREE_HINTS } from '../../content/hints';
import type { Scenario } from '../../sim/core/scenario';
import { TICKS_PER_DAY } from '../../sim/core/units';
import type { RmfInterval } from '../../sim/measure/rmf';
import { classify } from '../../sim/wlm/classify';
import type { ClassificationRule, ServiceDefinition } from '../../sim/wlm/types';
import { type StrainedClass } from '../hints';
import {
type Incident,
type RunState
} from '../types';
import { allWorkloads } from '../workloads';

/**
 * Incident workloads whose service class never missed its goal in WLMGL that day (every host's class had a
 * worst sysplex PI ≤ 1): the class average or region goal hid the slide. Only subsystems with a
 * per-transaction record to point at count. Workload id → subsystem.
 */
export function wlmHidSlides(r: RunState, scenario: Scenario, incidents: readonly Incident[], piWorst: Readonly<Record<string, number>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of allWorkloads(scenario, r)) {
    const sub = w.work.subsystem;
    if (!sub || !(sub in WLM_DISAGREE_HINTS) || !incidents.some((i) => i.workloadId === w.id)) continue;
    const pis = Object.entries(r.sim.routing[w.id] ?? w.routing)
      .filter(([, f]) => f > 0)
      .map(([lparId]) => piWorst[`${classify(r.sim.wlm.definition, { ...w.work, SY: lparId }).serviceClass}#1`]);
    if (pis.length > 0 && pis.every((p) => p !== undefined && p <= 1)) out[w.id] = sub;
  }
  return out;
}

/**
 * Service-class periods whose worst PI rose to STRAIN.minPi and STRAIN.riseFactor × the day before, excluding the
 * classes of workloads that raised an incident (their own hint covers them) and batch classes. Worst first.
 */
export function strainedClasses(r: RunState, scenario: Scenario, incidents: readonly Incident[], piWorst: Readonly<Record<string, number>>, prevPiWorst: Readonly<Record<string, number>> | undefined): StrainedClass[] {
  if (!prevPiWorst) return [];
  const covered = jesClasses(r.sim.wlm.definition);
  for (const w of allWorkloads(scenario, r)) {
    if (!incidents.some((i) => i.workloadId === w.id)) continue;
    for (const lparId of Object.keys(r.sim.routing[w.id] ?? w.routing)) covered.add(classify(r.sim.wlm.definition, { ...w.work, SY: lparId }).serviceClass);
  }
  return Object.keys(piWorst)
    .sort()
    .flatMap((scKey) => {
      const pi = piWorst[scKey]!;
      const prevPi = prevPiWorst[scKey] ?? 0;
      return pi >= STRAIN.minPi && pi >= STRAIN.riseFactor * prevPi && !covered.has(scKey.split('#')[0]!) ? [{ scKey, pi, prevPi }] : [];
    })
    .sort((a, b) => b.pi - a.pi);
}

/**
 * Worst sysplex PI per service-class period across the RMF intervals that closed within the day. With minEnded,
 * response-time periods count only in intervals where at least that many transactions ended.
 */
export function worstPiOfDay(intervals: readonly RmfInterval[], day: number, minEnded = 0): Record<string, number> {
  const out: Record<string, number> = {};
  for (const iv of intervals) {
    if (iv.endTick <= day * TICKS_PER_DAY || iv.endTick > (day + 1) * TICKS_PER_DAY) continue;
    for (const w of iv.wlm) {
      if (w.lparId !== '*PLEX' || w.pi === null || w.pi <= (out[w.scKey] ?? -Infinity)) continue;
      if (minEnded > 0 && RT_GOAL.test(w.goalText) && w.ended < minEnded) continue;
      out[w.scKey] = w.pi;
    }
  }
  return out;
}
const RT_GOAL = /^AVG |% </;

/** Service classes the JES rules can assign (batch; the batch-window hint speaks for them). */
function jesClasses(def: ServiceDefinition): Set<string> {
  const out = new Set<string>();
  const walk = (rs: readonly ClassificationRule[]) => rs.forEach((x) => (x.serviceClass && out.add(x.serviceClass), walk(x.children)));
  for (const ss of def.subsystems.filter((x) => x.subsystem === 'JES')) {
    if (ss.defaultServiceClass) out.add(ss.defaultServiceClass);
    walk(ss.rules);
  }
  return out;
}

/** Peak SYSOTHER APPL CP% per LPAR (periods summed within an interval) across the day's closed RMF intervals. */
export function sysotherByLpar(intervals: readonly RmfInterval[], day: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const iv of intervals) {
    if (iv.endTick <= day * TICKS_PER_DAY || iv.endTick > (day + 1) * TICKS_PER_DAY) continue;
    const here: Record<string, number> = {};
    for (const w of iv.wlm) if (w.serviceClass === 'SYSOTHER' && w.lparId !== '*PLEX') here[w.lparId] = (here[w.lparId] ?? 0) + w.applCpPct;
    for (const [id, v] of Object.entries(here)) if (v > (out[id] ?? 0)) out[id] = v;
  }
  return out;
}
