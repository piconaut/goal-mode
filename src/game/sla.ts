// Hourly SLA accounting, incident detection and ground-truth causes (SPEC §10, §12).

import type { WorkloadDef } from '../sim/workload/types';
import type { ActiveEvent, HourAcc, Incident, Mechanism, Trigger, WorkloadHour } from './types';

export const BASELINE_DECAY = 0.8;

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

/** Mechanism groups ordered by how much they grew against the healthy baseline (AIOps uses the runners-up). */
export function rankedMechanismGroups(parts: Record<string, number>, baseline: Record<string, number>): string[] {
  return Object.entries(GROUPS)
    .map(([g, keys]) => [g, keys.reduce((a, k) => a + (parts[k] ?? 0) - (baseline[k] ?? 0), 0)] as const)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([g]) => g);
}

/** Which mechanism grew most relative to the workload's healthy baseline. */
export function mechanismOf(parts: Record<string, number>, baseline: Record<string, number>, hour: HourAcc, lpars: readonly string[]): Mechanism {
  let best = 'CPU';
  let bestExcess = -Infinity;
  for (const [g, keys] of Object.entries(GROUPS)) {
    const excess = keys.reduce((a, k) => a + (parts[k] ?? 0) - (baseline[k] ?? 0), 0);
    if (excess > bestExcess) {
      best = g;
      bestExcess = excess;
    }
  }
  if (best !== 'CPU') return best as Mechanism;
  // Only capping of the images this workload runs on counts.
  if (lpars.some((l) => (hour.cappedByLpar[l] ?? 0) > 0.05)) return 'CAPPING';
  const busy = hour.ticks > 0 ? hour.cpcBusySum / hour.ticks : 0;
  return busy > 0.95 ? 'CPU_CAPACITY' : 'CPU_PRIORITY';
}

export function triggerOf(workloadId: string, mechanism: Mechanism, events: readonly ActiveEvent[], hour: HourAcc, isNew: boolean): Trigger {
  const ev = events.find((e) => e.started && !e.ended && e.affects.includes(workloadId));
  if (ev) return ev.trigger;
  if (isNew) return 'NEW_WORKLOAD';
  const lock = hour.ticks > 0 ? hour.lockIndexSum / hour.ticks : 0;
  if (lock > 1 && (mechanism === 'LOCK_CONTENTION' || mechanism === 'CPU_PRIORITY' || mechanism === 'DEPENDENCY')) return 'BATCH_OVERLAP';
  if (mechanism === 'DEPENDENCY' || mechanism === 'CPU_PRIORITY' || mechanism === 'CAPPING' || mechanism === 'QR_TCB' || mechanism === 'THREAD_LIMIT') return 'POLICY';
  return 'GROWTH';
}

export function updateBaseline(prev: Record<string, number> | undefined, parts: Record<string, number>): Record<string, number> {
  if (!prev) return { ...parts };
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(parts)])) {
    out[k] = BASELINE_DECAY * (prev[k] ?? 0) + (1 - BASELINE_DECAY) * (parts[k] ?? 0);
  }
  return out;
}

export const MECHANISMS: Mechanism[] = ['CPU_CAPACITY', 'CPU_PRIORITY', 'CAPPING', 'DEPENDENCY', 'LOCK_CONTENTION', 'CF_SERVICE', 'QR_TCB', 'THREAD_LIMIT', 'IO', 'STORAGE'];
export const TRIGGERS: Trigger[] = ['DEMAND_SURGE', 'ACCESS_PATH_REGRESSION', 'RUNAWAY_WORK', 'BATCH_OVERLAP', 'POLICY', 'HARDWARE_FAULT', 'NEW_WORKLOAD', 'GROWTH'];

/** RCA scoring: 3 points for the mechanism, 2 for the trigger. */
export function scoreRca(truth: Incident['truth'], guess: { mechanism: Mechanism; trigger: Trigger }): number {
  return (truth.mechanism === guess.mechanism ? 3 : 0) + (truth.trigger === guess.trigger ? 2 : 0);
}
