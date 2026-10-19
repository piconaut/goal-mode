// Batch (JES2) model (SPEC §5.10.4). Jobs are discrete: a nightly DAG with
// predecessors, earliest start times, job classes and initiators. A running job is
// essentially single-threaded: at full speed it alternates CPU and I/O, so its
// unconstrained elapsed time is cpu + ioCount × ioRt. Contention stretches both parts.

import type { JobClassConfig } from '../core/types';
import { DAY_SEC, TICK_SEC } from '../core/units';

export interface JobDef {
  name: string;
  stream: string;
  jobClass: string;
  /** System affinity; null = any LPAR with an initiator for the class. */
  sysaff: string | null;
  cpuSecRef: number;
  ziipFrac: number;
  ioCount: number;
  /** 0..1: how hard the job hammers Db2 locks shared with online work. */
  lockIntensity: number;
  usesDb2: boolean;
  preds: string[];
  /** Earliest start, seconds after the instance day's 06:00 start. */
  earliestSec: number;
  critical: boolean;
  /** Deadline, seconds after the instance day's 06:00 start (86400 = 06:00 next day). */
  deadlineSec: number;
}

export type JobStatus = 'HELD' | 'QUEUED' | 'RUNNING' | 'DONE' | 'ABENDED';

export interface JobRuntime {
  /** Instance day (played day whose night this job belongs to). */
  day: number;
  def: JobDef;
  status: JobStatus;
  lparId: string | null;
  progress: number;
  queuedTick: number | null;
  startTick: number | null;
  endTick: number | null;
  /** Last tick's elapsed stretch vs unconstrained (for projections and reports). */
  stretch: number;
}

export interface NightSummary {
  day: number;
  jobs: number;
  done: number;
  criticalJobs: number;
  criticalDone: number;
  /** Latest critical job end, seconds after the instance day's 06:00 (null if unfinished). */
  criticalEndSec: number | null;
  missedDeadline: boolean;
}

export interface BatchState {
  jobs: JobRuntime[];
  /** Projected finish of the critical path, seconds after the newest instance's start. */
  projectedCriticalEndSec: number | null;
  nights: NightSummary[];
}

export const emptyBatch = (): BatchState => ({ jobs: [], projectedCriticalEndSec: null, nights: [] });

const jobKey = (j: JobRuntime) => `${j.day}:${j.def.name}`;

/** Instantiate a night's network (called when the instance day reaches its release time). */
export function releaseNetwork(state: BatchState, day: number, defs: readonly JobDef[]): BatchState {
  const fresh: JobRuntime[] = defs.map((def) => ({
    day,
    def,
    status: 'HELD',
    lparId: null,
    progress: 0,
    queuedTick: null,
    startTick: null,
    endTick: null,
    stretch: 1,
  }));
  return { ...state, jobs: [...state.jobs, ...fresh] };
}

const secSinceInstance = (tick: number, day: number) => tick * TICK_SEC - day * DAY_SEC;

/** HELD → QUEUED when predecessors are done and the earliest start has passed. */
export function promoteEligible(jobs: JobRuntime[], tick: number): void {
  const done = new Set(jobs.filter((j) => j.status === 'DONE').map(jobKey));
  for (const j of jobs) {
    if (j.status !== 'HELD') continue;
    if (secSinceInstance(tick, j.day) < j.def.earliestSec) continue;
    if (j.def.preds.every((p) => done.has(`${j.day}:${p}`))) {
      j.status = 'QUEUED';
      j.queuedTick = tick;
    }
  }
}

export interface InitiatorContext {
  jobClasses: readonly JobClassConfig[];
  /** CP busy fraction of each LPAR last tick (for WLM-managed initiator decisions). */
  lparBusy: Readonly<Record<string, number>>;
}

/** Start queued jobs on free initiators. Critical jobs are selected first (JES priority), then FIFO. */
export function startJobs(jobs: JobRuntime[], tick: number, ctx: InitiatorContext): void {
  const running: Record<string, number> = {};
  for (const j of jobs) if (j.status === 'RUNNING' && j.lparId) running[`${j.def.jobClass}@${j.lparId}`] = (running[`${j.def.jobClass}@${j.lparId}`] ?? 0) + 1;
  const queued = jobs
    .filter((j) => j.status === 'QUEUED')
    .sort((a, b) => Number(b.def.critical) - Number(a.def.critical) || (a.queuedTick ?? 0) - (b.queuedTick ?? 0) || (jobKey(a) < jobKey(b) ? -1 : 1));
  let wlmStartsThisTick: Record<string, number> = {};
  for (const j of queued) {
    const jc = ctx.jobClasses.find((c) => c.jobClass === j.def.jobClass);
    if (!jc) continue;
    const lpars = Object.keys(jc.initiators).filter((l) => !j.def.sysaff || l === j.def.sysaff);
    let best: string | null = null;
    let bestFree = 0;
    for (const l of lpars) {
      const used = running[`${jc.jobClass}@${l}`] ?? 0;
      const max = jc.initiators[l] ?? 0;
      let free = max - used;
      if (jc.mode === 'WLM') {
        // APPROX: WLM starts initiators while the image has spare capacity, a couple per interval.
        const busy = ctx.lparBusy[l] ?? 0;
        const started = wlmStartsThisTick[l] ?? 0;
        if (busy > 0.92 || started >= 2) free = 0;
      }
      if (free > bestFree) {
        best = l;
        bestFree = free;
      }
    }
    if (!best) continue;
    j.status = 'RUNNING';
    j.lparId = best;
    j.startTick = tick;
    running[`${jc.jobClass}@${best}`] = (running[`${jc.jobClass}@${best}`] ?? 0) + 1;
    if (jc.mode === 'WLM') wlmStartsThisTick = { ...wlmStartsThisTick, [best]: (wlmStartsThisTick[best] ?? 0) + 1 };
  }
}

/** Unconstrained elapsed seconds and CPU split for a job on a given machine. */
export function jobShape(def: JobDef, cpSpeed: number, ziipSpeed: number, ioRtSec: number) {
  const cpSec = (def.cpuSecRef * (1 - def.ziipFrac)) / cpSpeed;
  const zSec = (def.cpuSecRef * def.ziipFrac) / ziipSpeed;
  const ioSec = def.ioCount * ioRtSec;
  const elapsed = cpSec + zSec + ioSec;
  return { cpSec, zSec, ioSec, elapsed, cpRate: cpSec / elapsed, zRate: zSec / elapsed, ioRate: def.ioCount / elapsed };
}

export interface JobProgressInput {
  cpWanted: number;
  cpGot: number;
  ziipWanted: number;
  ziipGot: number;
  /** Multiplicative slow-down from Db2 server health and lock contention. */
  extraStretch: number;
}

/** Advance a running job one tick; returns true if it finished. */
export function advanceJob(j: JobRuntime, shape: ReturnType<typeof jobShape>, p: JobProgressInput, tick: number): boolean {
  const cpStretch = p.cpWanted > 1e-12 ? p.cpWanted / Math.max(p.cpGot, 1e-9) : 1;
  const zStretch = p.ziipWanted > 1e-12 ? p.ziipWanted / Math.max(p.ziipGot, 1e-9) : 1;
  const eff = (shape.cpSec * Math.min(cpStretch, 1e4) + shape.zSec * Math.min(zStretch, 1e4) + shape.ioSec) * p.extraStretch;
  j.stretch = eff / shape.elapsed;
  j.progress += TICK_SEC / eff;
  if (j.progress >= 1) {
    j.progress = 1;
    j.status = 'DONE';
    j.endTick = tick + 1;
    return true;
  }
  return false;
}

/**
 * Projected finish (seconds after `day`'s start) of all critical jobs of that instance:
 * longest path using remaining elapsed at current stretch.
 */
export function projectCriticalEnd(
  jobs: readonly JobRuntime[],
  day: number,
  tick: number,
  elapsedOf: (j: JobRuntime) => number,
): number | null {
  const inst = jobs.filter((j) => j.day === day);
  if (!inst.some((j) => j.def.critical)) return null;
  const byName: Record<string, JobRuntime> = {};
  for (const j of inst) byName[j.def.name] = j;
  const now = secSinceInstance(tick, day);
  const memo: Record<string, number> = {};
  const finish = (j: JobRuntime, depth = 0): number => {
    const k = j.def.name;
    if (memo[k] !== undefined) return memo[k]!;
    let f: number;
    if (j.status === 'DONE') f = secSinceInstance(j.endTick ?? tick, day);
    else {
      let start = Math.max(now, j.def.earliestSec);
      if (depth < 400) for (const p of j.def.preds) {
        const pj = byName[p];
        if (pj) start = Math.max(start, finish(pj, depth + 1));
      }
      const avgStretch = j.status === 'RUNNING' ? j.stretch : 1.15;
      f = start + (1 - j.progress) * elapsedOf(j) * avgStretch;
    }
    memo[k] = f;
    return f;
  };
  let end = 0;
  for (const j of inst) if (j.def.critical) end = Math.max(end, finish(j));
  return end;
}

/** Summarise a night at its deadline and drop finished jobs of older instances. */
export function closeNight(state: BatchState, day: number): BatchState {
  const inst = state.jobs.filter((j) => j.day === day);
  const crit = inst.filter((j) => j.def.critical);
  const critDone = crit.filter((j) => j.status === 'DONE');
  const critEnd =
    critDone.length === crit.length && crit.length > 0
      ? Math.max(...crit.map((j) => secSinceInstance(j.endTick ?? 0, day)))
      : null;
  const summary: NightSummary = {
    day,
    jobs: inst.length,
    done: inst.filter((j) => j.status === 'DONE').length,
    criticalJobs: crit.length,
    criticalDone: critDone.length,
    criticalEndSec: critEnd,
    missedDeadline: crit.some((j) => j.status !== 'DONE' || secSinceInstance(j.endTick ?? 0, day) > j.def.deadlineSec),
  };
  return {
    ...state,
    jobs: state.jobs.filter((j) => !(j.day <= day && j.status === 'DONE')),
    nights: [...state.nights, summary],
  };
}
