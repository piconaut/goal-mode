import type { ClockInfo } from '../core/clock';
import { TICK_SEC } from '../core/units';

export type Db2Isolation = 'CS' | 'UR' | 'RR';

export interface Db2ContentionProfile {
  object: string;
  /** Explicitly shared resource. A member outside this list sees none of its locks or claims. */
  members: readonly string[];
  reader: string;
  /** Each client issues a new query only after its previous query ends. */
  clientConcurrency: number;
  /** Fractions of the workload's writes that encounter the modeled page set / partition. */
  writes: Readonly<Record<string, number>>;
  isolation: Db2Isolation;
  lockSecPerReader: Readonly<Record<Db2Isolation, number>>;
  maxLockSec: Readonly<Record<Db2Isolation, number>>;
  claimTimeoutSec: number;
  drain: {
    name: string;
    member: string;
    startMinute: number;
    kind: 'ALL' | 'WRITERS';
    waitSec: number;
    runSec: number;
  };
}

export interface Db2PeriodWork {
  cpRefSec: number;
  ziipRefSec: number;
}

/** One fluid cohort per member. CPU balances are reference-engine seconds by eligibility. */
export interface Db2Reader {
  count: number;
  cpRefSec: number;
  ziipRefSec: number;
  ageSec: number;
  cpuDelayFrac: number;
  capFrac: number;
  /** Unfinished service stays in the slice period where it was demanded. */
  workByPeriod: readonly Db2PeriodWork[];
  /** Active queries cancelled by a command before this tick's accounting. */
  cancelled?: number;
  /** This reader's share of the member queue before DBAT attachment. */
  dbatQueued: number;
  pending: number;
  pendingClaims: readonly { tick: number; count: number }[];
}

export interface Db2Drain {
  startedTick: number;
  phase: 'WAITING' | 'DRAINED';
  untilTick: number;
}

export interface Db2ContentionState {
  readers: Record<string, Db2Reader>;
  drain?: Db2Drain;
}

/** Interval deltas. Claim-release waits are utility seconds; drain-lock waits are reader-seconds. */
export interface Db2ContentionCounters {
  claims: number;
  failedClaims: number;
  drains: number;
  failedDrains: number;
  drainLockWaitSec: number;
  claimReleaseWaitSec: number;
}

export const emptyDb2Counters = (): Db2ContentionCounters => ({
  claims: 0, failedClaims: 0, drains: 0, failedDrains: 0, drainLockWaitSec: 0, claimReleaseWaitSec: 0,
});

export function addDb2Counters(to: Db2ContentionCounters, from: Db2ContentionCounters): void {
  to.claims += from.claims;
  to.failedClaims += from.failedClaims;
  to.drains += from.drains;
  to.failedDrains += from.failedDrains;
  to.drainLockWaitSec += from.drainLockWaitSec;
  to.claimReleaseWaitSec += from.claimReleaseWaitSec;
}

export interface Db2ContentionTick {
  profile: Db2ContentionProfile;
  before: Db2ContentionState | undefined;
  readers: Record<string, Db2Reader>;
  drain: Db2Drain | undefined;
  counters: Record<string, Db2ContentionCounters>;
  lockSec: number;
  availableClientSlots: number;
}

export function db2Counters(t: Db2ContentionTick, member: string): Db2ContentionCounters {
  return (t.counters[member] ??= emptyDb2Counters());
}

// Claims prevent drains until commit. IBM Db2 13 Managing Performance PDF pp.249–250 (printed 229–230).
export function startDb2Contention(
  profile: Db2ContentionProfile,
  before: Db2ContentionState | undefined,
  clock: ClockInfo,
  tick: number,
): Db2ContentionTick {
  let count = 0;
  let outstanding = 0;
  if (before) for (const member of profile.members) {
    const reader = before.readers[member];
    if (!reader) continue;
    count += reader.count;
    outstanding += reader.count + reader.pending + reader.dbatQueued;
  }
  const t: Db2ContentionTick = {
    profile, before, readers: {}, drain: before?.drain, counters: {},
    lockSec: Math.min(profile.maxLockSec[profile.isolation], count * profile.lockSecPerReader[profile.isolation]),
    availableClientSlots: Math.max(0, profile.clientConcurrency - outstanding),
  };
  const d = profile.drain;
  const startSec = d.startMinute * 60;
  const second = Math.round(clock.hourOfDay * 3600);
  if (!t.drain && !clock.isWeekend && second >= startSec && second < startSec + TICK_SEC) {
    db2Counters(t, d.member).drains++;
    t.drain = { startedTick: tick, phase: 'WAITING', untilTick: tick + Math.ceil(d.waitSec / TICK_SEC) };
  }
  const drain = t.drain;
  if (drain?.phase === 'WAITING') {
    if (d.kind === 'WRITERS' || count <= 1e-9) {
      t.drain = { ...drain, phase: 'DRAINED', untilTick: tick + Math.ceil(d.runSec / TICK_SEC) };
    } else if (tick >= drain.untilTick) {
      db2Counters(t, d.member).failedDrains++;
      t.drain = undefined;
    } else {
      db2Counters(t, d.member).claimReleaseWaitSec += TICK_SEC;
    }
  } else if (drain && tick >= drain.untilTick) {
    t.drain = undefined;
  }
  return t;
}

const NO_PENDING_CLAIMS: Db2Reader['pendingClaims'] = [];

/** Admit the share that got a DBAT. An all-class drain blocks new read claims while existing readers finish. */
export function readClaims(t: Db2ContentionTick, member: string, admitted: number, tick: number) {
  const old = t.before?.readers[member];
  const blocked = t.drain !== undefined && t.profile.drain.kind === 'ALL';
  if (admitted > 0) db2Counters(t, member).claims += admitted;
  if (!blocked && !old?.pending) {
    return { starting: admitted, pending: 0, pendingClaims: NO_PENDING_CLAIMS, failed: 0, waitSec: 0 };
  }
  const pendingClaims: { tick: number; count: number }[] = [];
  let pending = 0;
  let failed = 0;
  let waitTotalSec = 0;
  for (const claim of old?.pendingClaims ?? []) {
    const ageSec = (tick - claim.tick) * TICK_SEC;
    if (ageSec >= t.profile.claimTimeoutSec) {
      failed += claim.count;
    } else {
      pendingClaims.push(claim);
      pending += claim.count;
      waitTotalSec += claim.count * ageSec;
    }
  }
  if (failed > 0) db2Counters(t, member).failedClaims += failed;
  if (blocked) {
    if (admitted > 0) pendingClaims.push({ tick, count: admitted });
    pending += admitted;
    if (pending > 0) db2Counters(t, member).drainLockWaitSec += pending * TICK_SEC;
    return { starting: 0, pending, pendingClaims, failed, waitSec: 0 };
  }
  const starting = admitted + pending;
  const waitSec = starting > 0 ? waitTotalSec / starting : 0;
  return { starting, pending: 0, pendingClaims: NO_PENDING_CLAIMS, failed, waitSec };
}

/** One FIFO fluid cohort. Carryover consumes its pool's service first. Average age is weighted by remaining
 * readers; a finite client timeout also clears a cohort that gets no service. */
export function paceDb2Reader(
  old: Db2Reader | undefined,
  intake: ReturnType<typeof readClaims>,
  freshCpRefSec: number, freshZiipRefSec: number,
  cpRefSec: number, ziipRefSec: number,
  oldCpGrant: number, oldZiipGrant: number,
  capFrac: number,
  timeoutSec: number,
): { reader: Omit<Db2Reader, 'dbatQueued' | 'workByPeriod'>; aborted: number; completedOld: number; completedFresh: number } {
  const oldCp = old?.cpRefSec ?? 0;
  const oldZiip = old?.ziipRefSec ?? 0;
  const oldLeftCp = Math.max(0, oldCp - oldCpGrant);
  const oldLeftZiip = Math.max(0, oldZiip - oldZiipGrant);
  const freshLeftCp = Math.max(0, freshCpRefSec - (cpRefSec - oldCpGrant));
  const freshLeftZiip = Math.max(0, freshZiipRefSec - (ziipRefSec - oldZiipGrant));
  const residual = (cp: number, ziip: number, cpLeft: number, ziipLeft: number) =>
    Math.max(cp > 0 ? cpLeft / cp : 0, ziip > 0 ? ziipLeft / ziip : 0);
  let oldCount = (old?.count ?? 0) * residual(oldCp, oldZiip, oldLeftCp, oldLeftZiip);
  const oldAge = oldCount > 0 ? (old?.ageSec ?? 0) + TICK_SEC : 0;
  const aborted = oldAge >= timeoutSec ? oldCount : 0;
  oldCount -= aborted;
  const freshCount = intake.starting * residual(
    freshCpRefSec, freshZiipRefSec, freshLeftCp, freshLeftZiip,
  );
  const count = oldCount + freshCount;
  const wanted = oldCp + oldZiip + freshCpRefSec + freshZiipRefSec;
  return {
    reader: {
      count, cpRefSec: freshLeftCp + (aborted > 0 ? 0 : oldLeftCp), ziipRefSec: freshLeftZiip + (aborted > 0 ? 0 : oldLeftZiip),
      ageSec: count > 0 ? (oldCount * oldAge + freshCount * TICK_SEC / 2) / count : 0,
      cpuDelayFrac: wanted > 0 ? (freshLeftCp + freshLeftZiip + oldLeftCp + oldLeftZiip) / wanted : 0, capFrac,
      pending: intake.pending, pendingClaims: intake.pendingClaims,
    },
    aborted,
    completedOld: Math.max(0, (old?.count ?? 0) - oldCount - aborted),
    completedFresh: Math.max(0, intake.starting - freshCount),
  };
}
