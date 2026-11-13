// Hourly SLA accounting, incident detection and ground-truth causes (SPEC §10, §12).

import { NEW_WORKLOAD_DAYS } from '../content/sla';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { DB2_CONNECT_FAIL, type NightSummary } from '../sim/subsys/batch';
import type { WorkloadDef } from '../sim/workload/types';
import { SYSOTHER, SYSSTC, SYSTEM, type ServiceDefinition } from '../sim/wlm/types';
import { CAPPING, CPU_CAPACITY } from '../content/incidents';
import type { ActiveEvent, CapacityBasis, HourAcc, Incident, Mechanism, Trigger, WorkloadHour } from './types';

export const BASELINE_DECAY = 0.8;

/** Importance rank of a service class period for donor accounting: SYSTEM/SYSSTC 0, goal classes 1–5,
 * discretionary and SYSOTHER 6. APPROX: less important work is where policy adjustment finds CPU donors; since WT-07
 * it also takes from happy more important work, which this does not count (RT-16). */
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
  THREAD_LIMIT: ['outsideRef'],
  IO: ['io'],
  STORAGE: ['paging'],
};

/** How much each mechanism group grew against the baseline, per transaction. Slower tasks hold their MXT or DBAT
 * slot longer (Little's law), so the queue also grows when something else slowed them; only the queue the work
 * would build at its unqueued service time (`outsideRef`) is the thread limit's own. */
function groupExcess(parts: Record<string, number>, baseline: Record<string, number>): [string, number][] {
  const grew = (k: string) => (parts[k] ?? 0) - (baseline[k] ?? 0);
  return Object.entries(GROUPS).map(([g, keys]) => [g, keys.reduce((a, k) => a + grew(k), 0)]);
}

/** Mechanism groups ordered by how much they grew against the healthy baseline (AIOps uses the runners-up). */
export function rankedMechanismGroups(parts: Record<string, number>, baseline: Record<string, number>): string[] {
  return groupExcess(parts, baseline)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([g]) => g);
}

/** Was this image capped for enough of the hour that the hour counts as capped? A time measure, not the worst tick
 * (SPEC §10, docs/rca-design.md §4.3): the ticks in which its CP demand was cut, at least `CAPPING.minHourShare` of
 * the hour. An hour accumulated before RT-08 has no tick count, so it keeps the reading it was decided on. */
export function cappedForHour(hour: HourAcc, lparId: string): boolean {
  const ticksCapped = hour.cappedTicksByLpar?.[lparId];
  if (ticksCapped === undefined || hour.ticks <= 0) return (hour.cappedByLpar[lparId] ?? 0) > CAPPING.minHourShare;
  return ticksCapped >= CAPPING.minHourShare * hour.ticks;
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
  if (hosts.some((h) => cappedForHour(hour, h.lparId))) return 'CAPPING';
  // Capacity only when an image was full (its CPC was, as PR/SM shares engines only within one machine, or
  // the image used all the CP it could get, e.g. every online logical CP) and WLM had little less-important
  // work there to take CPU from; otherwise the policy (importance, goals, weights) could have served this work.
  return capacityBasis(hour, hosts)?.full ? 'CPU_CAPACITY' : 'CPU_PRIORITY';
}

export function capacityBasis(hour: HourAcc, hosts: readonly IncidentHost[]): CapacityBasis | null {
  const avg = (sum: number | undefined) => (hour.ticks > 0 ? (sum ?? 0) / hour.ticks : 0);
  let best: CapacityBasis | null = null;
  for (const h of hosts) {
    const cpc = avg(hour.cpcBusyById?.[h.cpcId]);
    const lpar = avg(hour.lparBusyById?.[h.lparId]);
    const byImp = hour.cpByImportance?.[h.lparId] ?? [];
    const total = byImp.reduce((a, x) => a + x, 0);
    const donor = byImp.slice(h.importance + 1).reduce((a, x) => a + x, 0);
    const donorFrac = total > 0 ? donor / total : 0;
    const busy = cpc >= CPU_CAPACITY.cpcBusyFrac || lpar >= CPU_CAPACITY.lparBusyFrac;
    const b: CapacityBasis = {
      lparId: h.lparId,
      cpcId: h.cpcId,
      cpcBusyPct: 100 * cpc,
      lparBusyPct: 100 * lpar,
      donorPct: 100 * donorFrac,
      full: busy && (total <= 0 || donorFrac < CPU_CAPACITY.donorFrac),
    };
    // A host that made the verdict capacity wins; otherwise the busiest CPC explains the policy verdict best.
    if (!best || (b.full && !best.full) || (b.full === best.full && b.cpcBusyPct > best.cpcBusyPct)) best = b;
  }
  return best;
}

/** An incident whose hour failed its SLA only through failures (with none it would have met it) gets the
 * mechanism a card affecting the workload declares for its failures; no delay grew to point at one. The card must
 * overlap the incident's opening SLA hour (half-open, like triggerOf): a card fixed or expired inside the hour still
 * names it, while one that ended at the hour's start does not. */
export function failureMechanismOf(w: WorkloadDef, h: WorkloadHour, events: readonly ActiveEvent[], hour: HourAcc): Mechanism | null {
  if (h.failed <= 0 || !hourAttainment(w, { ...h, failed: 0 })?.met) return null;
  const startTick = hour.hourIndex * TICKS_PER_HOUR;
  const endTick = startTick + TICKS_PER_HOUR;
  return events.find((e) =>
    e.started && e.startTick < endTick && (e.endTick === null || e.endTick > startTick) &&
    e.failureMechanism && e.affects.includes(w.id),
  )?.failureMechanism ?? null;
}

export function blamedCard(events: readonly ActiveEvent[], workloadId: string, mechanism: Mechanism, hourIndex: number): ActiveEvent | undefined {
  const startTick = hourIndex * TICKS_PER_HOUR;
  const endTick = startTick + TICKS_PER_HOUR;
  // A fix or natural expiry before hour close must not erase the card that caused the breach.
  const overlapTicks = (e: ActiveEvent) => Math.min(e.endTick ?? endTick, endTick) - Math.max(e.startTick, startTick);
  const activeAtClose = (e: ActiveEvent) => e.endTick === null || e.endTick > endTick;
  // A card active in a save written before RT-02 carries no `mechanisms`; treat that as "any mechanism" so the
  // old save keeps its previous blame until the card ends (new cards always declare the list, RT-02).
  return events.filter((e) =>
    e.started && e.startTick < endTick && (e.endTick === null || e.endTick > startTick) &&
    (e.trigger !== 'NEW_WORKLOAD' || startTick < e.startTick + NEW_WORKLOAD_DAYS * TICKS_PER_DAY) &&
    e.affects.includes(workloadId) && (!e.mechanisms || e.mechanisms.includes(mechanism)),
  ).sort((a, b) =>
    Number(activeAtClose(b)) - Number(activeAtClose(a)) || overlapTicks(b) - overlapTicks(a) ||
    (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0),
  )[0];
}

export function triggerOf(workloadId: string, mechanism: Mechanism, events: readonly ActiveEvent[], hour: HourAcc, isNew: boolean): Trigger {
  // The card the hour's truth blames, if any (the counterfactual validator reads the same choice, RT-06).
  const ev = blamedCard(events, workloadId, mechanism, hour.hourIndex);
  if (ev) return ev.trigger;
  if (isNew) return 'NEW_WORKLOAD';
  const lock = hour.ticks > 0 ? hour.lockIndexSum / hour.ticks : 0;
  // Batch overlap is the lock clash between batch and online (the DASD/lock clue path). Without a card, a CPU
  // priority or dependency miss is the policy's, even at night with batch running: importance, goals and
  // classification decide who waits (playtest 2026-11-03: misrouted critical batch was labelled BATCH_OVERLAP).
  if (lock > 1 && mechanism === 'LOCK_CONTENTION') return 'BATCH_OVERLAP';
  if (mechanism === 'DEPENDENCY' || mechanism === 'CPU_PRIORITY' || mechanism === 'CAPPING' || mechanism === 'QR_TCB' || mechanism === 'THREAD_LIMIT' || mechanism === 'ROUTING') return 'POLICY';
  return 'GROWTH';
}

/** Pseudo-workload id of a missed batch window's incident. */
export const BATCH_INCIDENT = 'BATCH';

/** Sums an hour into the night's accumulator (busy sums and capped ticks add, capped fractions keep their max). */
export function addHour(acc: HourAcc | null | undefined, h: HourAcc): HourAcc {
  if (!acc) return { ...h, workloads: {} };
  const sum = (a: Record<string, number> | undefined, b: Record<string, number> | undefined) => {
    const out = { ...(a ?? {}) };
    for (const [k, v] of Object.entries(b ?? {})) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  const cappedByLpar = { ...acc.cappedByLpar };
  for (const [k, v] of Object.entries(h.cappedByLpar)) cappedByLpar[k] = Math.max(cappedByLpar[k] ?? 0, v);
  // A night with any hour accumulated before RT-08 has no tick count for that hour, so it keeps the worst-tick
  // reading the whole night was working to (a night is decided once, at its end).
  const cappedTicksByLpar = acc.cappedTicksByLpar && h.cappedTicksByLpar
    ? sum(acc.cappedTicksByLpar, h.cappedTicksByLpar)
    : undefined;
  const cpByImportance = { ...(acc.cpByImportance ?? {}) };
  for (const [k, v] of Object.entries(h.cpByImportance ?? {})) cpByImportance[k] = v.map((x, i) => x + (cpByImportance[k]?.[i] ?? 0));
  return {
    hourIndex: acc.hourIndex,
    ticks: acc.ticks + h.ticks,
    workloads: {},
    maxCappedFrac: Math.max(acc.maxCappedFrac, h.maxCappedFrac),
    cappedByLpar,
    ...(cappedTicksByLpar ? { cappedTicksByLpar } : {}),
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
  return mechanismOf({ cpuQueue: d.cpu, lock: d.lock, dependency: d.db2, io: d.io, paging: d.swap, outsideRef: d.init }, {}, nightHour, hosts);
}

/** A card blamed for a missed night: one that affects BATCH, causes this mechanism and ran during the night. */
export function batchMissCard(mechanism: Mechanism, events: readonly ActiveEvent[], nightStartTick: number): ActiveEvent | undefined {
  return events.find((e) => e.started && e.affects.includes(BATCH_INCIDENT) && (!e.mechanisms || e.mechanisms.includes(mechanism)) && (!e.ended || (e.endTick ?? 0) >= nightStartTick));
}

export function batchMissTrigger(mechanism: Mechanism, events: readonly ActiveEvent[], nightHour: HourAcc, nightStartTick: number, night?: NightSummary): Trigger {
  const ev = batchMissCard(mechanism, events, nightStartTick);
  if (ev) return ev.trigger;
  // A Db2 job failing to connect was sent to an image without Db2 by the initiator setup.
  if (mechanism === 'JOB_FAILURE' && Object.values(night?.criticalFailCodes ?? {}).includes(DB2_CONNECT_FAIL)) return 'POLICY';
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

export const MECHANISMS: Mechanism[] = ['CPU_CAPACITY', 'CPU_PRIORITY', 'CAPPING', 'DEPENDENCY', 'LOCK_CONTENTION', 'CF_SERVICE', 'QR_TCB', 'THREAD_LIMIT', 'ROUTING', 'IO', 'STORAGE', 'JOB_FAILURE'];
export const TRIGGERS: Trigger[] = ['DEMAND_SURGE', 'ACCESS_PATH_REGRESSION', 'RUNAWAY_WORK', 'BATCH_OVERLAP', 'POLICY', 'HARDWARE_FAULT', 'NEW_WORKLOAD', 'GROWTH', 'APPLICATION_ERROR'];

/** The accepted answers of a truth: the primary alone in saves written before RT-07. */
export function acceptedOf(truth: Incident['truth']): { mechanisms: Mechanism[]; triggers: Trigger[] } {
  return truth.accepted ?? { mechanisms: [truth.mechanism], triggers: [truth.trigger] };
}

/** RCA scoring: 3 points for an accepted mechanism, 2 for an accepted trigger (RT-07; docs/rca-design.md §4.1). */
export function scoreRca(truth: Incident['truth'], guess: { mechanism: Mechanism; trigger: Trigger }): number {
  const accepted = acceptedOf(truth);
  return (accepted.mechanisms.includes(guess.mechanism) ? 3 : 0) + (accepted.triggers.includes(guess.trigger) ? 2 : 0);
}
