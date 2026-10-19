// Tier-2 "deep data" views (SPEC §8): Db2 accounting (SMF 101), CICS monitoring (SMF 110),
// batch job analytics (SMF 30) and CPU MF counters (SMF 113), built from what the sim measures.

import { DB2_PACKAGES, lsprCategory, SMF113 } from '../content/smf';
import { clockAt, formatClock } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import { TICK_SEC, TICKS_PER_DAY } from '../sim/core/units';
import type { WorkloadDef } from '../sim/workload/types';
import { allWorkloads } from './run';
import type { RunState, WorkloadHour } from './types';

export interface SmfHourRef {
  key: string;
  label: string;
}

/** Selectable hours: the current (open) hour, then closed hours newest first. */
export function smfHourRefs(run: RunState): SmfHourRef[] {
  const out: SmfHourRef[] = [];
  if (run.hour && run.phase === 'LIVE') out.push({ key: 'current', label: `${hh(Math.floor(clockAt(run.sim.tick).hourOfDay))}:00 (this hour, so far)` });
  for (const h of [...run.smfHours].reverse()) out.push({ key: `${h.day}:${h.hourOfDay}`, label: `D${h.day + 1} ${hh(h.hourOfDay)}:00–${hh((h.hourOfDay + 1) % 24)}:00` });
  return out;
}

const hh = (h: number) => String(h).padStart(2, '0');

function hourData(run: RunState, key: string): { workloads: Record<string, WorkloadHour>; seconds: number } | null {
  if (key === 'current') return run.hour ? { workloads: run.hour.workloads, seconds: Math.max(1, run.hour.ticks) * TICK_SEC } : null;
  const h = run.smfHours.find((x) => `${x.day}:${x.hourOfDay}` === key);
  return h ? { workloads: h.workloads, seconds: 3600 } : null;
}

const usesDb2 = (w: WorkloadDef) => w.servers.some((s) => s.role.startsWith('DB2.'));
const perTxnMs = (h: WorkloadHour, k: string) => (h.completions > 0 ? (1000 * (h.parts[k] ?? 0)) / h.completions : 0);

export interface Db2AcctRow {
  workloadId: string;
  package: string;
  connType: 'DDF' | 'CICS' | 'OTHER';
  txnPerSec: number;
  /** Class 1: elapsed in the application, ms per transaction. */
  class1Ms: number;
  /** CPU per transaction, ms, and its ratio to this workload's healthy baseline. */
  cpuMs: number;
  cpuVsBaseline: number | null;
  /** Class 3 suspensions, ms per transaction. */
  lockMs: number;
  syncIoMs: number;
  cfMs: number;
  /** CPU queueing (not a class 3 suspension, but shows in class 2 not-accounted time). */
  notAccountedMs: number;
  /** DDF: waits for a DBAT before Db2 starts the thread (queued at MAXDBAT). */
  dbatQueueMs: number;
}

export function db2Accounting(run: RunState, scenario: Scenario, key: string): Db2AcctRow[] {
  const d = hourData(run, key);
  if (!d) return [];
  return allWorkloads(scenario, run)
    .filter(usesDb2)
    .flatMap((w) => {
      const h = d.workloads[w.id];
      if (!h || h.completions <= 0) return [];
      const base = run.baselines[w.id];
      const cpuMs = perTxnMs(h, 'cpu');
      return [
        {
          workloadId: w.id,
          package: DB2_PACKAGES[w.id] ?? w.work.PK ?? w.id,
          connType: w.subsystem === 'DDF' ? 'DDF' : w.subsystem === 'CICS' ? 'CICS' : 'OTHER',
          txnPerSec: h.completions / d.seconds,
          class1Ms: (1000 * h.rtSumSec) / h.completions,
          cpuMs,
          cpuVsBaseline: base?.cpu ? cpuMs / (1000 * base.cpu) : null,
          lockMs: perTxnMs(h, 'lock'),
          syncIoMs: perTxnMs(h, 'io'),
          cfMs: perTxnMs(h, 'cf'),
          notAccountedMs: perTxnMs(h, 'cpuQueue') + perTxnMs(h, 'ziipQueue') + perTxnMs(h, 'dependency'),
          dbatQueueMs: w.subsystem === 'DDF' ? perTxnMs(h, 'outside') : 0,
        } satisfies Db2AcctRow,
      ];
    });
}

export interface CicsTxnRow {
  workloadId: string;
  tranId: string;
  txnPerSec: number;
  avgRtMs: number;
  cpuMs: number;
  cpuVsBaseline: number | null;
  /** Waiting for the QR TCB (non-threadsafe code serialised on one TCB). */
  qrWaitMs: number;
  /** Waiting for an MXT slot before the task is attached. */
  mxtWaitMs: number;
  dispatchWaitMs: number;
  failed: number;
}

export function cicsMonitoring(run: RunState, scenario: Scenario, key: string): CicsTxnRow[] {
  const d = hourData(run, key);
  if (!d) return [];
  return allWorkloads(scenario, run)
    .filter((w) => w.subsystem === 'CICS')
    .flatMap((w) => {
      const h = d.workloads[w.id];
      if (!h || h.completions <= 0) return [];
      const base = run.baselines[w.id];
      const cpuMs = perTxnMs(h, 'cpu');
      return [
        {
          workloadId: w.id,
          tranId: w.work.TN ?? w.id,
          txnPerSec: h.completions / d.seconds,
          avgRtMs: (1000 * h.rtSumSec) / h.completions,
          cpuMs,
          cpuVsBaseline: base?.cpu ? cpuMs / (1000 * base.cpu) : null,
          qrWaitMs: perTxnMs(h, 'qr'),
          mxtWaitMs: perTxnMs(h, 'outside'),
          dispatchWaitMs: perTxnMs(h, 'cpuQueue'),
          failed: h.failed,
        },
      ];
    });
}

export interface BatchJobRow {
  name: string;
  stream: string;
  lparId: string;
  critical: boolean;
  /** Seconds after the night's 06:00 day start. */
  queuedAtSec: number;
  startSec: number;
  endSec: number;
  queuedSec: number;
  elapsedSec: number;
  stretch: number;
}

export interface BatchNight {
  /** Played day whose night this is (the night that ended at the following 06:00, or is running). */
  day: number;
  dayStartTick: number;
  jobs: BatchJobRow[];
  /** Critical path (longest chain of critical jobs ending last), by job name. */
  criticalEnd: string | null;
}

/** SMF 30-style job records for the most recent night with completed jobs. */
export function batchNight(run: RunState): BatchNight | null {
  const ends = run.sim.rmf.intervals.flatMap((iv) => iv.jobs);
  if (ends.length === 0) return null;
  const lastEnd = Math.max(...ends.map((j) => j.endTick));
  // A night's jobs belong to the played day that started at the 06:00 before they were released.
  const nightDay = Math.floor((lastEnd - TICKS_PER_DAY / 2) / TICKS_PER_DAY);
  const dayStartTick = nightDay * TICKS_PER_DAY;
  const jobs = ends
    .filter((j) => j.endTick > dayStartTick && j.endTick <= dayStartTick + TICKS_PER_DAY * 1.5)
    .map((j) => {
      const endSec = (j.endTick - dayStartTick) * TICK_SEC;
      const startSec = endSec - j.elapsedSec;
      return { name: j.name, stream: j.stream, lparId: j.lparId, critical: j.critical, queuedAtSec: startSec - j.queuedSec, startSec, endSec, queuedSec: j.queuedSec, elapsedSec: j.elapsedSec, stretch: j.stretch };
    })
    .sort((a, b) => a.startSec - b.startSec || (a.name < b.name ? -1 : 1));
  const crit = jobs.filter((j) => j.critical).sort((a, b) => b.endSec - a.endSec)[0];
  return { day: nightDay, dayStartTick, jobs, criticalEnd: crit?.name ?? null };
}

export const nightClock = (n: BatchNight, sec: number) => formatClock(n.dayStartTick + Math.round(sec / TICK_SEC)).slice(-8, -3);

export interface Smf113Row {
  lparId: string;
  l1mpPct: number;
  rni: number;
  cpi: number;
  lspr: 'LOW' | 'AVERAGE' | 'HIGH';
  /** Share of delivered CP capacity running on VM/VL logical CPs. */
  nonVhFrac: number;
}

/** CPU MF counters per z/OS image (FICTIONAL model in content/smf.ts). */
export function smf113(run: RunState): Smf113Row[] {
  const sim = run.sim;
  const cpcEngines = sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  const cpcBusy = cpcEngines > 0 ? sim.lpars.reduce((a, l) => a + (l.pools.find((p) => p.pool === 'CP')?.deliveredEngines ?? 0), 0) / cpcEngines : 0;
  return sim.config.lpars
    .filter((l) => l.kind === 'ZOS')
    .map((l) => {
      const rt = sim.lpars.find((x) => x.id === l.id)?.pools.find((p) => p.pool === 'CP');
      const delivered = rt?.deliveredEngines ?? 0;
      const nonVh = rt && delivered > 0 ? Math.max(0, Math.min(1, (delivered - rt.vh) / delivered)) : 0;
      const l1mp = SMF113.l1mpBase + SMF113.l1mpPerNonVhFrac * nonVh;
      const rni = SMF113.rniBase + SMF113.rniPerNonVhFrac * nonVh + SMF113.rniPerCpcBusyFrac * Math.min(1, cpcBusy);
      return {
        lparId: l.id,
        l1mpPct: l1mp,
        rni,
        cpi: SMF113.cpiBase + SMF113.cpiPerL1mpRni * l1mp * rni,
        lspr: lsprCategory(l1mp, rni),
        nonVhFrac: nonVh,
      };
    });
}
