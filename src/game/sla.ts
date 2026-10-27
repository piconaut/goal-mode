// Hourly SLA accounting, incident detection and ground-truth causes (SPEC §10, §12).

import type { NightSummary } from '../sim/subsys/batch';
import type { WorkloadDef } from '../sim/workload/types';
import { SYSOTHER, SYSSTC, SYSTEM, type ServiceDefinition } from '../sim/wlm/types';
import type { ActiveEvent, HourAcc, Incident, Mechanism, Trigger, WorkloadHour } from './types';

export const BASELINE_DECAY = 0.8;
/** FICTIONAL: hour-average busy of a host CPC's general CPs from which a CPU incident can be capacity. */
export const CPU_CAPACITY_BUSY_FRAC = 0.9;
/** FICTIONAL: hour-average share of its available CP (online logical CPs, entitlement plus white space) an image
 * used from which it was full on its own, whatever its CPC shows: PR/SM can't give it more. */
export const CPU_CAPACITY_LPAR_BUSY_FRAC = 0.95;
/** FICTIONAL: below this share of the image's CP going to less important work, WLM had nothing left to donate. */
export const CPU_CAPACITY_DONOR_FRAC = 0.1;

/** Importance rank of a service class period for donor accounting: SYSTEM/SYSSTC 0, goal classes 1–5,
 * discretionary and SYSOTHER 6. APPROX: less important work is where policy adjustment finds CPU donors. */
export function importanceRank(def: ServiceDefinition, scKey: string): number {
  const [cls, n] = scKey.split('#');
  if (cls === SYSTEM || cls === SYSSTC) return 0;
  if (cls === SYSOTHER) return 6;
  const p = def.classes.find((c) => c.id === cls)?.periods[Number(n) - 1];
  return !p || p.goal.kind === 'DISC' ? 6 : p.importance;
}

/** An image a hurt workload runs on, with the importance its first period runs at there. */
export interface IncidentHost {
  lparId: string;
  cpcId: string;
  importance: number;
}

export function hourAttainment(w: WorkloadDef, h: WorkloadHour): { met: boolean; attainmentPct: number; severity: number } | null {
  const total = h.completions + h.failed;
  if (w.sla.kind === 'NONE' || total < 1) return null;
  if (w.sla.kind === 'PCT') {
    const att = (100 * h.withinSla) / total;
    const met = att >= w.sla.pct;
    return { met, attainmentPct: att, severity: met ? 0 : Math.min(3, (w.sla.pct - att) / (100 - w.sla.pct)) };
  }
  const avg = h.completions > 0 ? h.rtSumSec / h.completions : Infinity;
  const failPct = (100 * h.failed) / total;
  const met = avg <= w.sla.rtSec && failPct < 1;
  return { met, attainmentPct: met ? 100 : Math.max(0, Math.min(100, 100 * (w.sla.rtSec / avg)) - failPct), severity: met ? 0 : Math.min(3, avg / w.sla.rtSec - 1 + failPct / 10) };
}

/** Per-transaction parts for the hour. */
export function perTxnParts(h: WorkloadHour): Record<string, number> {
  const n = Math.max(1e-9, h.completions);
  return Object.fromEntries(Object.entries(h.parts).map(([k, v]) => [k, v / n]));
}

const GROUPS: Record<string, string[]> = {
  CPU: ['cpuQueue', 'ziipQueue', 'backlogWait'],
  DEPENDENCY: ['dependency'],
  LOCK_CONTENTION: ['lock'],
  CF_SERVICE: ['cf'],
  QR_TCB: ['qr'],
  THREAD_LIMIT: ['outside'],
  IO: ['io'],
  STORAGE: ['paging'],
};

/** How much each mechanism group grew against the baseline, per transaction. Queueing for MXT or DBATs grows by
 * as much as the time inside the region grows (Little's law: slower tasks hold their slot longer), so only the
 * part beyond the in-region growth is the thread limit's own; the rest is a symptom of whatever slowed the tasks. */
function groupExcess(parts: Record<string, number>, baseline: Record<string, number>): [string, number][] {
  const grew = (k: string) => (parts[k] ?? 0) - (baseline[k] ?? 0);
  const inRegion = Object.keys(parts).reduce((a, k) => (k === 'outside' ? a : a + grew(k)), 0);
  return Object.entries(GROUPS).map(([g, keys]) => [g, g === 'THREAD_LIMIT' ? Math.max(0, grew('outside') - Math.max(0, inRegion)) : keys.reduce((a, k) => a + grew(k), 0)]);
}

/** Mechanism groups ordered by how much they grew against the healthy baseline (AIOps uses the runners-up). */
export function rankedMechanismGroups(parts: Record<string, number>, baseline: Record<string, number>): string[] {
  return groupExcess(parts, baseline)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([g]) => g);
}

/** Which mechanism grew most relative to the workload's healthy baseline. */
export function mechanismOf(
  parts: Record<string, number>,
  baseline: Record<string, number>,
  hour: HourAcc,
  hosts: readonly IncidentHost[],
): Mechanism {
  let best = 'CPU';
  let bestExcess = -Infinity;
  for (const [g, excess] of groupExcess(parts, baseline)) {
    if (excess > bestExcess) {
      best = g;
      bestExcess = excess;
    }
  }
  if (best !== 'CPU') return best as Mechanism;
  // Only capping of the images this workload runs on counts.
  if (hosts.some((h) => (hour.cappedByLpar[h.lparId] ?? 0) > 0.05)) return 'CAPPING';
  // Capacity only when an image was full (its CPC was, as PR/SM shares engines only within one machine, or
  // the image used all the CP it could get, e.g. every online logical CP) and WLM had little less-important
  // work there to take CPU from; otherwise the policy (importance, goals, weights) could have served this work.
  const full = hosts.some((h) => {
    const avg = (sum: number | undefined) => (hour.ticks > 0 ? (sum ?? 0) / hour.ticks : 0);
    const busy = avg(hour.cpcBusyById?.[h.cpcId]) >= CPU_CAPACITY_BUSY_FRAC || avg(hour.lparBusyById?.[h.lparId]) >= CPU_CAPACITY_LPAR_BUSY_FRAC;
    const byImp = hour.cpByImportance?.[h.lparId] ?? [];
    const total = byImp.reduce((a, x) => a + x, 0);
    const donor = byImp.slice(h.importance + 1).reduce((a, x) => a + x, 0);
    return busy && (total <= 0 || donor / total < CPU_CAPACITY_DONOR_FRAC);
  });
  return full ? 'CPU_CAPACITY' : 'CPU_PRIORITY';
}

export function triggerOf(workloadId: string, mechanism: Mechanism, events: readonly ActiveEvent[], hour: HourAcc, isNew: boolean): Trigger {
  const ev = events.find((e) => e.started && !e.ended && e.affects.includes(workloadId) && (!e.mechanisms || e.mechanisms.includes(mechanism)));
  if (ev) return ev.trigger;
  if (isNew) return 'NEW_WORKLOAD';
  const lock = hour.ticks > 0 ? hour.lockIndexSum / hour.ticks : 0;
  if (lock > 1 && (mechanism === 'LOCK_CONTENTION' || mechanism === 'CPU_PRIORITY' || mechanism === 'DEPENDENCY')) return 'BATCH_OVERLAP';
  if (mechanism === 'DEPENDENCY' || mechanism === 'CPU_PRIORITY' || mechanism === 'CAPPING' || mechanism === 'QR_TCB' || mechanism === 'THREAD_LIMIT') return 'POLICY';
  return 'GROWTH';
}

/** Pseudo-workload id of a missed batch window's incident. */
export const BATCH_INCIDENT = 'BATCH';

/** Sums an hour into the night's accumulator (busy sums add, capped fractions keep their max). */
export function addHour(acc: HourAcc | null | undefined, h: HourAcc): HourAcc {
  if (!acc) return { ...h, workloads: {} };
  const sum = (a: Record<string, number> | undefined, b: Record<string, number> | undefined) => {
    const out = { ...(a ?? {}) };
    for (const [k, v] of Object.entries(b ?? {})) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  const cappedByLpar = { ...acc.cappedByLpar };
  for (const [k, v] of Object.entries(h.cappedByLpar)) cappedByLpar[k] = Math.max(cappedByLpar[k] ?? 0, v);
  const cpByImportance = { ...(acc.cpByImportance ?? {}) };
  for (const [k, v] of Object.entries(h.cpByImportance ?? {})) cpByImportance[k] = v.map((x, i) => x + (cpByImportance[k]?.[i] ?? 0));
  return {
    hourIndex: acc.hourIndex,
    ticks: acc.ticks + h.ticks,
    workloads: {},
    maxCappedFrac: Math.max(acc.maxCappedFrac, h.maxCappedFrac),
    cappedByLpar,
    cpcBusySum: acc.cpcBusySum + h.cpcBusySum,
    cpcBusyById: sum(acc.cpcBusyById, h.cpcBusyById),
    lparBusyById: sum(acc.lparBusyById, h.lparBusyById),
    cpByImportance,
    lockIndexSum: acc.lockIndexSum + h.lockIndexSum,
  };
}

/**
 * Ground truth of a missed batch window from the critical jobs' delay accounting (SMF 30-style): an ABEND is a
 * job failure; otherwise the biggest cause of lost elapsed time maps onto the online mechanisms (CPU, Db2 locks,
 * Db2 dependency, DASD, swap as storage, initiator wait as a thread limit), with the CPU split as for online work.
 */
export function batchMissMechanism(night: NightSummary, nightHour: HourAcc, hosts: readonly IncidentHost[]): Mechanism {
  if ((night.criticalAbended ?? []).length > 0) return 'JOB_FAILURE';
  const d = night.criticalDelaySec ?? { cpu: 0, io: 0, lock: 0, db2: 0, swap: 0, init: 0 };
  return mechanismOf({ cpuQueue: d.cpu, lock: d.lock, dependency: d.db2, io: d.io, paging: d.swap, outside: d.init }, {}, nightHour, hosts);
}

/** A card blamed for a missed night: one that affects BATCH, causes this mechanism and ran during the night. */
export function batchMissTrigger(mechanism: Mechanism, events: readonly ActiveEvent[], nightHour: HourAcc, nightStartTick: number): Trigger {
  const ev = events.find((e) => e.started && e.affects.includes(BATCH_INCIDENT) && (!e.mechanisms || e.mechanisms.includes(mechanism)) && (!e.ended || (e.endTick ?? 0) >= nightStartTick));
  if (ev) return ev.trigger;
  return triggerOf(BATCH_INCIDENT, mechanism, [], nightHour, false);
}

export function updateBaseline(prev: Record<string, number> | undefined, parts: Record<string, number>): Record<string, number> {
  if (!prev) return { ...parts };
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(parts)])) {
    out[k] = BASELINE_DECAY * (prev[k] ?? 0) + (1 - BASELINE_DECAY) * (parts[k] ?? 0);
  }
  return out;
}

export const MECHANISMS: Mechanism[] = ['CPU_CAPACITY', 'CPU_PRIORITY', 'CAPPING', 'DEPENDENCY', 'LOCK_CONTENTION', 'CF_SERVICE', 'QR_TCB', 'THREAD_LIMIT', 'IO', 'STORAGE', 'JOB_FAILURE'];
export const TRIGGERS: Trigger[] = ['DEMAND_SURGE', 'ACCESS_PATH_REGRESSION', 'RUNAWAY_WORK', 'BATCH_OVERLAP', 'POLICY', 'HARDWARE_FAULT', 'NEW_WORKLOAD', 'GROWTH'];

/** RCA scoring: 3 points for the mechanism, 2 for the trigger. */
export function scoreRca(truth: Incident['truth'], guess: { mechanism: Mechanism; trigger: Trigger }): number {
  return (truth.mechanism === guess.mechanism ? 3 : 0) + (truth.trigger === guess.trigger ? 2 : 0);
}
