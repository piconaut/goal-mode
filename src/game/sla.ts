// Hourly SLA accounting, incident detection and ground-truth causes (SPEC §10, §12).

import { NEW_WORKLOAD_DAYS } from '../content/sla';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import { DB2_CONNECT_FAIL, type NightSummary } from '../sim/subsys/batch';
import type { WorkloadDef } from '../sim/workload/types';
import { SYSOTHER, SYSSTC, SYSTEM, type ServiceDefinition } from '../sim/wlm/types';
import { CAPPING, CPU_CAPACITY } from '../content/incidents';
import { ALL_MECHANISMS } from '../content/footprint';
import { regionKey } from './footprint';
import type { Accepted, ActiveEvent, CapacityBasis, HourAcc, Mechanism, Trigger, WorkloadHour } from './types';
import { sumCapSamples, sumCpuGrants, sumCpuWaits, sumRecords } from './hourAccounting';

export const BASELINE_DECAY = 0.8;

/** Importance rank of a service class period for donor accounting: SYSTEM/SYSSTC 0, goal classes 1–5,
 * discretionary and SYSOTHER 6. APPROX: less important work is where policy adjustment finds CPU donors; since WT-07
 * it also takes from happy more important work, which this does not count (RT-32). */
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
 * the hour. */
export function cappedForHour(hour: HourAcc, lparId: string): boolean {
  if (hour.ticks <= 0) return false;
  return (hour.cappedTicksByLpar[lparId] ?? 0) >= CAPPING.minHourShare * hour.ticks;
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
    const cpc = avg(hour.cpcBusyById[h.cpcId]);
    const lpar = avg(hour.lparBusyById[h.lparId]);
    const byImp = hour.cpByImportance[h.lparId] ?? [];
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
  const window = hourWindow(hour.hourIndex);
  return events.find((e) => activeIn(e, window) && e.failureMechanism && e.affects.includes(w.id))?.failureMechanism ?? null;
}

/** Where the hurt work runs, for a card's footprint: its images, and the CICS regions serving it (RT-04's snapshot). */
export interface WorkScope {
  hosts: readonly { lparId: string }[];
  servers?: readonly { jobname: string; lparId: string }[];
}

/** The scope of work recorded by image id (an incident's `subjects`, a night's critical-job images). */
export function workScopeOf(s: { hosts: readonly string[]; servers?: readonly { jobname: string; lparId: string }[] }): WorkScope {
  return { hosts: s.hosts.map((lparId) => ({ lparId })), ...(s.servers ? { servers: s.servers } : {}) };
}

/** An SLA hour as a tick window, half-open. */
export const hourWindow = (hourIndex: number): { startTick: number; endTick: number } =>
  ({ startTick: hourIndex * TICKS_PER_HOUR, endTick: (hourIndex + 1) * TICKS_PER_HOUR });

/** A card was active in a half-open window: one ending at its start or starting at its end does not overlap, and a
 * card fixed or expired inside it still does (SPEC §10). */
export const activeIn = (e: ActiveEvent, w: { startTick: number; endTick: number }): boolean =>
  e.started && e.startTick < w.endTick && (e.endTick === null || e.endTick > w.startTick);

/** How a card's footprint (RT-14, docs/rca-design.md §4.4(1)) meets the work: listed (direct), or the work's images or
 * its servers' images or regions are in the card's reach (collateral). */
export function footprintRelation(e: ActiveEvent, workloadId: string, scope: WorkScope): 'direct' | 'collateral' | null {
  if (e.affects.includes(workloadId)) return 'direct';
  const reach = e.reach;
  if (!reach || reach.length === 0) return null;
  const hit = scope.hosts.some((h) => reach.includes(h.lparId)) ||
    (scope.servers ?? []).some((s) => reach.includes(s.lparId) || reach.includes(regionKey(s.jobname, s.lparId)));
  return hit ? 'collateral' : null;
}

export interface QualifiedCard {
  card: ActiveEvent;
  direct: boolean;
  /** The work closed a met hour with the card already running: the card is the new normal for it. */
  background: boolean;
  overlapTicks: number;
}

/**
 * The cards that can explain a mechanism in the work in a window, ranked (docs/rca-design.md §4.4(2)): direct before
 * collateral, fresh before background, then longer overlap with the window. Cards equal on all three are a tie: each
 * trigger is accepted and the earlier-starting card leads (then the run's card order, which is the draw order; no
 * alphabetical tie-break).
 */
export function qualifyingCards(
  events: readonly ActiveEvent[],
  workloadId: string,
  mechanism: Mechanism,
  window: { startTick: number; endTick: number },
  scope: WorkScope,
): QualifiedCard[] {
  const { startTick, endTick } = window;
  const out: QualifiedCard[] = [];
  for (const e of events) {
    // A fix or natural expiry before the window closes must not erase the card that caused the breach.
    if (!activeIn(e, window)) continue;
    if (e.trigger === 'NEW_WORKLOAD' && startTick >= e.startTick + NEW_WORKLOAD_DAYS * TICKS_PER_DAY) continue;
    if (!e.mechanisms.includes(mechanism)) continue;
    const rel = footprintRelation(e, workloadId, scope);
    if (!rel) continue;
    out.push({
      card: e,
      direct: rel === 'direct',
      background: e.metWith?.includes(workloadId) ?? false,
      overlapTicks: Math.min(e.endTick ?? endTick, endTick) - Math.max(e.startTick, startTick),
    });
  }
  return out.sort((a, b) =>
    Number(b.direct) - Number(a.direct) || Number(a.background) - Number(b.background) ||
    b.overlapTicks - a.overlapTicks || a.card.startTick - b.card.startTick,
  );
}

/** Record that these workloads met a goal over a period that opened at `fromTick` with a card already running whose
 * footprint reached them: that card is background for them from now on (§4.4(2)). A card that did not reach the work
 * stays fresh for it, so a later routing change that brings the work into its reach still finds it news. Sorted, so
 * state stays order-independent. */
export function markMet(events: readonly ActiveEvent[], workloadIds: readonly string[], fromTick: number, scopeOf: (workloadId: string) => WorkScope): ActiveEvent[] {
  return events.map((e) => {
    if (!e.started || e.startTick > fromTick || (e.endTick !== null && e.endTick <= fromTick)) return e;
    const add = workloadIds.filter((w) => !(e.metWith ?? []).includes(w) && footprintRelation(e, w, scopeOf(w)) !== null);
    return add.length > 0 ? { ...e, metWith: [...(e.metWith ?? []), ...add].sort() } : e;
  });
}

/** The trigger with no card to blame (and the one a collateral victim also accepts: the policy or headroom that left
 * it exposed, §4.4(3)). */
export function fallbackTrigger(mechanism: Mechanism, hour: HourAcc, isNew: boolean): Trigger {
  if (isNew) return 'NEW_WORKLOAD';
  const lock = hour.ticks > 0 ? hour.lockIndexSum / hour.ticks : 0;
  // Batch overlap is the lock clash between batch and online (the DASD/lock clue path). Without a card, a CPU
  // priority or dependency miss is the policy's, even at night with batch running: importance, goals and
  // classification decide who waits (playtest 2026-11-03: misrouted critical batch was labelled BATCH_OVERLAP).
  if (lock > 1 && mechanism === 'LOCK_CONTENTION') return 'BATCH_OVERLAP';
  if (mechanism === 'DEPENDENCY' || mechanism === 'CPU_PRIORITY' || mechanism === 'CAPPING' || mechanism === 'QR_TCB' || mechanism === 'THREAD_LIMIT' || mechanism === 'ROUTING') return 'POLICY';
  return 'GROWTH';
}

export function triggerOf(workloadId: string, mechanism: Mechanism, events: readonly ActiveEvent[], hour: HourAcc, isNew: boolean, scope: WorkScope): Trigger {
  // The card the hour's truth blames, if any (the counterfactual validator reads the same choice, RT-06).
  return qualifyingCards(events, workloadId, mechanism, hourWindow(hour.hourIndex), scope)[0]?.card.trigger ?? fallbackTrigger(mechanism, hour, isNew);
}

/** Pseudo-workload id of a missed batch window's incident. */
export const BATCH_INCIDENT = 'BATCH';

/** Sums an hour into the night's accumulator (counts, busy sums and capped ticks add, capped fractions keep their max). */
export function addHour(acc: HourAcc | null | undefined, h: HourAcc): HourAcc {
  if (!acc) return { ...h, workloads: {} };
  const sum = (a: Record<string, number> | undefined, b: Record<string, number> | undefined) => {
    const out = { ...(a ?? {}) };
    for (const [k, v] of Object.entries(b ?? {})) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  const cappedByLpar = { ...acc.cappedByLpar };
  for (const [k, v] of Object.entries(h.cappedByLpar)) cappedByLpar[k] = Math.max(cappedByLpar[k] ?? 0, v);
  const dbatQueuedByLpar = sum(acc.dbatQueuedByLpar, h.dbatQueuedByLpar);
  const cappedTicksByLpar = sum(acc.cappedTicksByLpar, h.cappedTicksByLpar);
  const cpByImportance = { ...acc.cpByImportance };
  for (const [k, v] of Object.entries(h.cpByImportance)) cpByImportance[k] = v.map((x, i) => x + (cpByImportance[k]?.[i] ?? 0));
  return {
    hourIndex: acc.hourIndex,
    ticks: acc.ticks + h.ticks,
    workloads: {},
    maxCappedFrac: Math.max(acc.maxCappedFrac, h.maxCappedFrac),
    cappedByLpar,
    cappedTicksByLpar,
    cpcBusySum: acc.cpcBusySum + h.cpcBusySum,
    cpcBusyById: sum(acc.cpcBusyById, h.cpcBusyById),
    lparBusyById: sum(acc.lparBusyById, h.lparBusyById),
    cpByImportance,
    cpuWaitByWorkloadLpar: sumRecords(acc.cpuWaitByWorkloadLpar, h.cpuWaitByWorkloadLpar, sumCpuWaits),
    cpByScpLpar: sumRecords(acc.cpByScpLpar, h.cpByScpLpar, sumCpuGrants),
    cpByRoleLpar: sumRecords(acc.cpByRoleLpar, h.cpByRoleLpar, sumCpuGrants),
    cpByWorkloadLpar: sumRecords(acc.cpByWorkloadLpar, h.cpByWorkloadLpar, sumCpuGrants),
    capDelayByScpLpar: sumRecords(acc.capDelayByScpLpar, h.capDelayByScpLpar, sumCapSamples),
    roleCappedTicks: sum(acc.roleCappedTicks, h.roleCappedTicks),
    ziipBusyById: sum(acc.ziipBusyById, h.ziipBusyById),
    ziipLparBusyById: sum(acc.ziipLparBusyById, h.ziipLparBusyById),
    lockIndexSum: acc.lockIndexSum + h.lockIndexSum,
    dbatQueuedByLpar,
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

/** A played day's batch night starts at 18:00, twelve hours after the day's 06:00 start, and runs to the day end. */
export const nightStartTick = (day: number): number => day * TICKS_PER_DAY + 12 * TICKS_PER_HOUR;
const nightWindow = (startTick: number) => ({ startTick, endTick: startTick + 12 * TICKS_PER_HOUR });

/** A card blamed for a missed night: one whose footprint reaches BATCH (listed, or on a critical job's image), causes
 * this mechanism and ran during the night (RT-14: BATCH is a workload like any other). */
export function batchMissCard(mechanism: Mechanism, events: readonly ActiveEvent[], nightStart: number, scope: WorkScope): ActiveEvent | undefined {
  return qualifyingCards(events, BATCH_INCIDENT, mechanism, nightWindow(nightStart), scope)[0]?.card;
}

export function batchMissTrigger(mechanism: Mechanism, events: readonly ActiveEvent[], nightHour: HourAcc, nightStart: number, scope: WorkScope, night?: NightSummary): Trigger {
  const ev = batchMissCard(mechanism, events, nightStart, scope);
  if (ev) return ev.trigger;
  // A Db2 job failing to connect was sent to an image without Db2 by the initiator setup.
  if (mechanism === 'JOB_FAILURE' && Object.values(night?.criticalFailCodes ?? {}).includes(DB2_CONNECT_FAIL)) return 'POLICY';
  return fallbackTrigger(mechanism, nightHour, false);
}

export function updateBaseline(prev: Record<string, number> | undefined, parts: Record<string, number>): Record<string, number> {
  if (!prev) return { ...parts };
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(parts)])) {
    out[k] = BASELINE_DECAY * (prev[k] ?? 0) + (1 - BASELINE_DECAY) * (parts[k] ?? 0);
  }
  return out;
}

export const MECHANISMS: Mechanism[] = [...ALL_MECHANISMS];
export const TRIGGERS: Trigger[] = ['DEMAND_SURGE', 'CHANGE_REGRESSION', 'RUNAWAY_WORK', 'BATCH_OVERLAP', 'POLICY', 'HARDWARE_FAULT', 'NEW_WORKLOAD', 'GROWTH', 'APPLICATION_ERROR'];

/** RCA scoring: 3 points for an accepted mechanism, 2 for an accepted trigger (RT-07; docs/rca-design.md §4.1). For a
 * group, `accepted` is the union of its members' (§4.5). */
export function scoreAccepted(accepted: Accepted, guess: { mechanism: Mechanism; trigger: Trigger }): number {
  return (accepted.mechanisms.includes(guess.mechanism) ? 3 : 0) + (accepted.triggers.includes(guess.trigger) ? 2 : 0);
}
