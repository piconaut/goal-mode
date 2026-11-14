// The identities of the cross-report invariant suite (tests/sim/report-invariants.test.ts). Each one states a
// relation between figures a player can read (RMF interval reports, Partition Data, Monitor III, the SMF views,
// Finance) or between a figure and the sim state it is measured from, and walks whatever the run's reports contain:
// no identity names a scenario, LPAR, service class or workload.
//
// `basis` says what the identity is: 'z/OS' = how the real report behaves (book and page in `source`, checked with
// the zos-docs skill), 'game' = an internal consistency rule of the game (the SPEC section or the reason in
// `source`). A new report field must join an identity here (CLAUDE.md, Testing expectations).

import { tieredMonthlyCost } from '../../src/content/pricing';
import { financeView } from '../../src/game/finance';
import type { Mon3Row } from '../../src/game/mon3';
import { batchNight, cicsMonitoring, cicsStorageStats, db2Accounting, smf113 } from '../../src/game/smf';
import type { RunState } from '../../src/game/types';
import { buildView } from '../../src/game/view';
import { allWorkloads } from '../../src/game/workloads';
import { formatClock } from '../../src/sim/core/clock';
import type { LparConfig, WorldConfig } from '../../src/sim/core/types';
import { R4HA_SLOTS, TICKS_PER_HOUR, TICKS_PER_R4HA_SLOT, TICK_SEC } from '../../src/sim/core/units';
import { billLines, closeMonth, tfpCharge } from '../../src/sim/cost/mlc';
import { msuPerCp } from '../../src/sim/hw/cpc';
import { REPORT_KINDS, renderReport, renderScrt } from '../../src/sim/measure/reports';
import type { RmfInterval, WlmRecord } from '../../src/sim/measure/rmf';
import { classify } from '../../src/sim/wlm/classify';
import { BUCKET_BOUNDS } from '../../src/sim/wlm/goals';
import { ACC_DECAY, goalInfo } from '../../src/sim/wlm/runtime';
import type { Goal, ServiceDefinition } from '../../src/sim/wlm/types';
import type { IntervalObs, ReportRun } from './reportRun';

/** A tolerance and why the two sides may differ by that much. */
export interface Tol {
  rel: number;
  abs: number;
}

/** The same quantity added up in another order, or averaged before or after a division: float rounding only. */
export const ROUNDING: Tol = { rel: 1e-9, abs: 1e-9 };
/** Monitor III reads exponentially decayed sums; the sim drops a decayed remainder below 1e-9 of its size
 * (`reporting.ts` `net`, `decayMoved`), so a flat sum rebuilt from them can be off by that much per tick. */
export const DECAYED: Tol = { rel: 1e-6, abs: 1e-6 };
/** Figures a report prints with a fixed number of decimals: half a unit of the last digit. */
export const printed = (decimals: number): Tol => ({ rel: 0, abs: 0.5 * 10 ** -decimals + 1e-9 });

export class Check {
  /** Comparisons made: an identity that made none on a scenario was not exercised there. */
  n = 0;
  readonly failures: string[] = [];
  private fail(text: string): void {
    if (this.failures.length < 12) this.failures.push(text);
    else if (this.failures.length === 12) this.failures.push('… more');
  }
  close(actual: number, expected: number, tol: Tol, where: () => string): void {
    this.n++;
    const slack = tol.abs + tol.rel * Math.max(Math.abs(actual), Math.abs(expected));
    if (!(Math.abs(actual - expected) <= slack)) this.fail(`${where()}: ${actual} ≠ ${expected}`);
  }
  atMost(actual: number, bound: number, tol: Tol, where: () => string): void {
    this.n++;
    if (!(actual <= bound + tol.abs + tol.rel * Math.abs(bound))) this.fail(`${where()}: ${actual} > ${bound}`);
  }
  ok(cond: boolean, where: () => string): void {
    this.n++;
    if (!cond) this.fail(where());
  }
}

export interface Identity {
  id: string;
  title: string;
  basis: 'z/OS' | 'game';
  source: string;
  check: (run: ReportRun, c: Check) => void;
}

const at = (o: IntervalObs) => `${o.phase} ${formatClock(o.iv.endTick)}`;
const zos = (c: WorldConfig): LparConfig[] => c.lpars.filter((l) => l.kind === 'ZOS');
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const scRows = (iv: RmfInterval, lparId: string) => iv.wlm.filter((r) => r.lparId === lparId);
const systemsOf = (iv: RmfInterval) => [...new Set(iv.wlm.map((r) => r.lparId))].filter((id) => id !== '*PLEX').sort();
const usingOf = (r: WlmRecord) => r.usingPct.cpu + r.usingPct.ziip + r.usingPct.io;
const delayOf = (r: WlmRecord) => r.delayPct.cpu + r.delayPct.ziip + r.delayPct.io + r.delayPct.storage + r.delayPct.cap + (r.delayPct.queue ?? 0);
const goalOf = (def: ServiceDefinition, r: WlmRecord): Goal | null => goalInfo(def, r.members?.length === 1 ? r.members[0]! : r.scKey)?.goal ?? null;

/** The PI a reader works out from a row's own goal and actuals (WLM Planning: velocity goal ÷ actual, actual
 * response time ÷ goal, percentile from the distribution's bucket bounds), without the sim's PI code. */
function piFromRow(goal: Goal, r: { velocity: number | null; avgRtSec: number | null; ended: number; buckets: readonly number[] }): number | null {
  if (goal.kind === 'DISC') return 0.81;
  if (goal.kind === 'VEL') return r.velocity === null ? null : Math.min(99, goal.velocity / Math.max(r.velocity, 0.1));
  // Fluid completions: a remainder below a billionth of a transaction is no transaction (the report shows ENDED 0).
  if (r.ended <= 1e-9) return null;
  if (goal.kind === 'AVG') return r.avgRtSec === null ? null : r.avgRtSec / goal.rtSec;
  const total = sum(r.buckets);
  if (total <= 0) return null;
  let cum = 0;
  for (let i = 0; i < r.buckets.length; i++) {
    cum += r.buckets[i]!;
    if ((100 * cum) / total >= goal.pct - 1e-9) return Math.min(4, Math.max(0.5, BUCKET_BOUNDS[i]!));
  }
  return 4;
}

/** Sysplex rows are the systems' rows added up (rates and counts) for both service and report classes. */
function plexSum(c: Check, o: IntervalObs, rows: readonly WlmRecord[], what: string): void {
  const plex = rows.filter((r) => r.lparId === '*PLEX');
  for (const p of plex) {
    const parts = rows.filter((r) => r.lparId !== '*PLEX' && r.scKey === p.scKey);
    const w = (f: string) => () => `${at(o)} ${what} ${p.scKey} ${f}`;
    c.close(p.ended, sum(parts.map((r) => r.ended)), ROUNDING, w('ENDED'));
    c.close(p.failed, sum(parts.map((r) => r.failed)), ROUNDING, w('FAILED'));
    c.close(p.applCpPct, sum(parts.map((r) => r.applCpPct)), ROUNDING, w('APPL% CP'));
    c.close(p.applIipcpPct, sum(parts.map((r) => r.applIipcpPct)), ROUNDING, w('APPL% IIPCP'));
    c.close(p.applIipPct, sum(parts.map((r) => r.applIipPct)), ROUNDING, w('APPL% IIP'));
    const rt = sum(parts.map((r) => (r.avgRtSec ?? 0) * r.ended));
    if (p.avgRtSec !== null) c.close(p.avgRtSec * p.ended, rt, ROUNDING, w('response time × ENDED'));
    if (!p.reportClass || p.members?.length === 1) p.buckets.forEach((b, i) => c.close(b, sum(parts.map((r) => r.buckets[i] ?? 0)), ROUNDING, w(`bucket ${i}`)));
  }
}

export const IDENTITIES: Identity[] = [
  // ---------------------------------------------------------------- Workload Activity (WLMGL, SMF 72.3)
  {
    id: 'wlmgl-sysplex-sum',
    title: 'WLMGL: a sysplex row is the sum of its systems (ENDED, FAILED, APPL%, response time, distribution)',
    basis: 'z/OS',
    source: 'RMF Report Analysis',
    check: (run, c) => {
      for (const o of run.intervals) {
        plexSum(c, o, o.iv.wlm, 'service class');
        plexSum(c, o, o.iv.wlmRc ?? [], 'report class');
      }
    },
  },
  {
    id: 'wlmgl-end-rate',
    title: 'WLMGL: END/S is ENDED over the interval length',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.530 Table 222',
    check: (run, c) => {
      for (const o of run.intervals) for (const r of [...o.iv.wlm, ...(o.iv.wlmRc ?? [])]) c.close(r.endPerSec * o.iv.intervalSec, r.ended, ROUNDING, () => `${at(o)} ${r.lparId} ${r.scKey}`);
    },
  },
  {
    id: 'wlmgl-states-100',
    title: 'WLMGL: USING %, DELAY % and UNKNOWN of a period add up to 100 % of its state samples',
    basis: 'z/OS',
    source: 'RMF Report Analysis',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const r of [...o.iv.wlm, ...(o.iv.wlmRc ?? [])]) {
          const total = usingOf(r) + delayOf(r) + r.delayPct.other;
          for (const x of [r.usingPct.cpu, r.usingPct.ziip, r.usingPct.io, ...Object.values(r.delayPct)]) c.ok(x >= -1e-9 && x <= 100 + 1e-9, () => `${at(o)} ${r.lparId} ${r.scKey} state ${x} outside 0–100`);
          if (total > 0) c.close(total, 100, ROUNDING, () => `${at(o)} ${r.lparId} ${r.scKey}`);
        }
      }
    },
  },
  {
    id: 'wlmgl-velocity',
    title: 'WLMGL: EX VEL% is USING ÷ (USING + DELAY), I/O counted only with I/O priority management',
    basis: 'z/OS',
    source: 'WLM Planning',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        const io = o.def.ioPriorityManagement !== false;
        for (const r of [...o.iv.wlm, ...(o.iv.wlmRc ?? [])]) {
          if (r.execVelocity === null) continue;
          const u = usingOf(r) - (io ? 0 : r.usingPct.io);
          const d = delayOf(r) - (io ? 0 : r.delayPct.io);
          c.ok(u + d > 0, () => `${at(o)} ${r.lparId} ${r.scKey} velocity without samples`);
          if (u + d > 0) c.close(r.execVelocity, (100 * u) / (u + d), ROUNDING, () => `${at(o)} ${r.lparId} ${r.scKey}`);
        }
      }
    },
  },
  {
    id: 'wlmgl-pi',
    title: "WLMGL: PERF INDX follows from the row's goal and its actual velocity, response time or distribution",
    basis: 'z/OS',
    source: 'WLM Planning',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        const io = o.def.ioPriorityManagement !== false;
        for (const r of [...o.iv.wlm, ...(o.iv.wlmRc ?? [])]) {
          if (r.reportClass && r.members?.length !== 1) {
            c.ok(r.pi === null, () => `${at(o)} ${r.lparId} ${r.scKey}: PI on a report class of ${r.members?.length} periods`);
            continue;
          }
          const goal = goalOf(o.def, r);
          if (!goal) {
            c.ok(r.pi === null, () => `${at(o)} ${r.lparId} ${r.scKey}: PI without a goal`);
            continue;
          }
          // The velocity of the row's samples: EX VEL% is blank where work manager states replace it.
          const u = usingOf(r) - (io ? 0 : r.usingPct.io);
          const d = delayOf(r) - (io ? 0 : r.delayPct.io);
          const expected = piFromRow(goal, { velocity: u + d > 0 ? (100 * u) / (u + d) : null, avgRtSec: r.avgRtSec, ended: r.ended, buckets: r.buckets });
          if (expected === null || r.pi === null) c.ok(expected === r.pi, () => `${at(o)} ${r.lparId} ${r.scKey}: PI ${r.pi}, expected ${expected}`);
          else c.close(r.pi, expected, ROUNDING, () => `${at(o)} ${r.lparId} ${r.scKey} (${goal.kind})`);
        }
      }
    },
  },
  {
    id: 'wlmgl-distribution',
    title: 'WLMGL: the response time distribution of a percentile-goal period holds every ended transaction',
    basis: 'z/OS',
    source: 'RMF Report Analysis',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        for (const r of o.iv.wlm) {
          if (goalOf(o.def, r)?.kind !== 'PCT') continue;
          c.close(sum(r.buckets), r.ended, ROUNDING, () => `${at(o)} ${r.lparId} ${r.scKey}`);
        }
      }
    },
  },
  {
    id: 'wlmgl-iipcp',
    title: 'WLMGL: APPL% IIPCP is part of APPL% CP, and is zero on an image with no zIIP defined',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.534 Table 222; Init & Tuning Reference 3.1 p.431',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const r of [...o.iv.wlm, ...(o.iv.wlmRc ?? [])]) {
          c.atMost(r.applIipcpPct, r.applCpPct, ROUNDING, () => `${at(o)} ${r.lparId} ${r.scKey} IIPCP above CP`);
          const l = o.config.lpars.find((x) => x.id === r.lparId);
          if (l && o.steady && !l.pools.some((p) => p.pool === 'ZIIP' && p.logical + p.reserved > 0)) {
            c.close(r.applIipcpPct, 0, ROUNDING, () => `${at(o)} ${r.lparId} ${r.scKey} IIPCP without a zIIP`);
            c.close(r.applIipPct, 0, ROUNDING, () => `${at(o)} ${r.lparId} ${r.scKey} IIP without a zIIP`);
          }
        }
      }
    },
  },
  {
    id: 'wlmgl-appl-vs-dispatch',
    title: "WLMGL: an image's APPL% adds up to the CPU its work was dispatched for, never more than Partition Data's engines",
    basis: 'game',
    source: 'SPEC §5.12, §17 "WLMGL APPL% CP/IIPCP/IIP"; captured time against dispatch time',
    check: (run, c) => {
      for (const o of run.intervals) {
        const n = o.iv.intervalSec / TICK_SEC;
        for (const id of systemsOf(o.iv)) {
          const rows = scRows(o.iv, id);
          const cp = sum(rows.map((r) => r.applCpPct)) / 100;
          const iip = sum(rows.map((r) => r.applIipPct)) / 100;
          const s = o.lpars[id];
          const pd = o.iv.cpu.find((x) => x.lparId === id);
          if (!s || !pd) continue;
          c.close(cp, s.effectiveCp / n, ROUNDING, () => `${at(o)} ${id} Σ APPL% CP vs sim CP engines`);
          c.close(iip, s.effectiveZiip / n, ROUNDING, () => `${at(o)} ${id} Σ APPL% IIP vs sim zIIP engines`);
          c.atMost(cp, pd.physicalEngines, ROUNDING, () => `${at(o)} ${id} Σ APPL% CP above PHYS ENG`);
          c.atMost(iip, pd.ziipEngines, ROUNDING, () => `${at(o)} ${id} Σ APPL% IIP above zIIP ENG`);
        }
      }
    },
  },
  // ---------------------------------------------------------------- Partition Data / CPU Activity (SMF 70.1)
  {
    id: 'partition-lpar-busy',
    title: 'Partition Data: LPAR BUSY % is the dispatched engines over the online logical CPs, never above them',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.389',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const r of o.iv.cpu) {
          for (const [name, x] of [['LPAR BUSY', r.logicalBusyPct], ['MVS BUSY', r.mvsBusyPct ?? 0], ['LPAR MGMT', r.overheadPct], ['CAPPED', r.cappedPct], ['WLM%', r.wlmCappingPct ?? 0], ['PR/SM DLY', r.prsmDelayPct]] as const)
            c.ok(x >= -1e-9 && x <= 100 + 1e-9, () => `${at(o)} ${r.lparId} ${name} ${x} outside 0–100`);
          if (!o.steady || r.logicalCps === 0) continue;
          c.close((r.logicalBusyPct * r.logicalCps) / 100, r.physicalEngines, ROUNDING, () => `${at(o)} ${r.lparId} LPAR BUSY × LCPs vs PHYS ENG`);
          c.atMost(r.physicalEngines, r.logicalCps, ROUNDING, () => `${at(o)} ${r.lparId} PHYS ENG above LCPs`);
        }
      }
    },
  },
  {
    id: 'partition-physical-busy',
    title: "Partition Data: a CPC pool's PHYSICAL BUSY is its partitions' dispatched engines over the installed engines",
    basis: 'z/OS',
    source: 'RMF Report Analysis',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        for (const b of o.iv.cpcBusy) {
          const cpc = o.config.cpcs.find((x) => x.id === b.cpcId)!;
          const engines = cpc.engines[b.pool as 'CP' | 'ZIIP' | 'ICF'];
          const used = sum(o.iv.cpu.filter((r) => o.config.lpars.find((l) => l.id === r.lparId)?.cpcId === b.cpcId).map((r) => (b.pool === 'CP' ? r.physicalEngines : b.pool === 'ZIIP' ? r.ziipEngines : r.icfEngines)));
          c.close((b.physicalBusyPct * engines) / 100, used, ROUNDING, () => `${at(o)} ${b.cpcId} ${b.pool}`);
          c.atMost(used, engines, ROUNDING, () => `${at(o)} ${b.cpcId} ${b.pool} engines used above installed`);
        }
      }
    },
  },
  {
    id: 'partition-msu',
    title: "Partition Data: MSU AVG is the dispatched CP engines at the CPC's MSU per CP (Monitor III CPC capacity ÷ CPs)",
    basis: 'game',
    source: 'SPEC §5.11.1 (MSU from general-CP dispatch time); Monitor III CPC header',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        const n = o.iv.intervalSec / TICK_SEC;
        for (const r of o.iv.cpu) {
          const h = o.mon3.cpcHeaders.find((x) => x.lparId === r.lparId);
          const cpc = o.config.cpcs.find((x) => x.id === h?.cpcId);
          if (!h || !cpc || cpc.engines.CP === 0) continue;
          c.close(r.msuAvg, (r.physicalEngines * h.cpcCapacityMsu) / cpc.engines.CP, ROUNDING, () => `${at(o)} ${r.lparId} MSU AVG vs PHYS ENG × MSU/CP`);
          c.close(r.msuAvg, o.lpars[r.lparId]!.msu / n, ROUNDING, () => `${at(o)} ${r.lparId} MSU AVG vs sim MSU rate`);
          c.close(r.physicalEngines, o.lpars[r.lparId]!.deliveredCp / n, ROUNDING, () => `${at(o)} ${r.lparId} PHYS ENG vs sim`);
        }
      }
    },
  },
  {
    id: 'partition-r4ha',
    title: "Partition Data: R4HA is the average of the MSU AVG of the last four hours' intervals (zero before the start)",
    basis: 'z/OS',
    source: 'WLM Planning',
    check: (run, c) => {
      const window = R4HA_SLOTS * TICKS_PER_R4HA_SLOT;
      const first = run.intervals[0]!.iv.startTick;
      run.intervals.forEach((o, i) => {
        const from = o.iv.endTick - window;
        // Only where the four hours end on interval boundaries: an interval the window cuts can't be split.
        if (from > first && !run.intervals.some((x) => x.iv.startTick === from)) return;
        for (const r of o.iv.cpu) {
          if (r.logicalCps === 0) continue;
          let msuTicks = 0;
          for (let j = i; j >= 0 && run.intervals[j]!.iv.startTick >= from; j--) {
            const x = run.intervals[j]!.iv;
            msuTicks += (x.cpu.find((y) => y.lparId === r.lparId)?.msuAvg ?? 0) * (x.intervalSec / TICK_SEC);
          }
          c.close(r.r4ha, msuTicks / window, ROUNDING, () => `${at(o)} ${r.lparId}`);
        }
      });
    },
  },
  {
    id: 'partition-capping',
    title: 'Partition Data: WLM% needs a defined capacity or capacity group and is part of the capping; capping needs a cap',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.401',
    check: (run, c) => {
      for (const o of run.intervals) {
        const n = o.iv.intervalSec / TICK_SEC;
        for (const r of o.iv.cpu) {
          if (r.logicalCps === 0) continue;
          const wlm = r.wlmCappingPct ?? 0;
          const s = o.lpars[r.lparId]!;
          c.atMost(wlm, r.cappedPct, ROUNDING, () => `${at(o)} ${r.lparId} WLM% above capping %`);
          // The share of demand a cap removed is at most the share of the time it bound.
          c.atMost(wlm, (100 * s.softCappedTicks) / n, ROUNDING, () => `${at(o)} ${r.lparId} WLM% above the time soft-capped`);
          c.atMost(r.cappedPct, (100 * s.cappedTicks) / n, ROUNDING, () => `${at(o)} ${r.lparId} capping % above the time capped`);
          c.ok(wlm > 0 === s.softCappedTicks > 0, () => `${at(o)} ${r.lparId} WLM% ${wlm} with ${s.softCappedTicks} soft-capped ticks`);
          if (!o.steady) continue;
          const l = o.config.lpars.find((x) => x.id === r.lparId)!;
          const cp = l.pools.find((p) => p.pool === 'CP');
          const soft = l.definedCapacityMsu !== null || l.capacityGroup !== null;
          if (wlm > 0) c.ok(soft, () => `${at(o)} ${r.lparId} WLM% ${wlm} with no defined capacity or group`);
          if (r.cappedPct > 0) c.ok(soft || cp?.absoluteCapEngines != null || !!cp?.initialCapping, () => `${at(o)} ${r.lparId} capped ${r.cappedPct} % with no cap defined`);
          c.ok(r.definedCapacityMsu === l.definedCapacityMsu && (r.absoluteCapEngines ?? null) === (cp?.absoluteCapEngines ?? null), () => `${at(o)} ${r.lparId} DEF CAP / ABS CAP differ from the configuration`);
        }
      }
    },
  },
  {
    id: 'soft-cap-flag',
    title: 'Soft capping: an image is capped exactly while its R4HA is above its defined capacity, and every view says so',
    basis: 'z/OS',
    source: 'WLM Planning',
    check: (run, c) => {
      for (const o of run.intervals) {
        const view = buildView({ ...o.end, tools: ['RMF_MON3'] }, run.scenario);
        for (const r of o.iv.cpu) {
          if (r.logicalCps === 0) continue;
          const sys = o.mon3.systems.find((x) => x.system === r.lparId)!;
          const head = o.mon3.cpcHeaders.find((x) => x.lparId === r.lparId)!;
          const lv = view.lpars.find((x) => x.id === r.lparId)!;
          // Decided at each 5-minute boundary, which every interval end is.
          c.ok(sys.capped === (r.definedCapacityMsu !== null && r.r4ha > r.definedCapacityMsu), () => `${at(o)} ${r.lparId} capped ${sys.capped}, R4HA ${r.r4ha}, DEF CAP ${r.definedCapacityMsu}`);
          c.ok(lv.capped === sys.capped, () => `${at(o)} ${r.lparId} header capped ${lv.capped}, Monitor III ${sys.capped}`);
          c.close(head.r4haMsu, r.r4ha, ROUNDING, () => `${at(o)} ${r.lparId} Monitor III 4h avg vs Partition Data R4HA`);
          c.close(lv.r4ha ?? 0, r.r4ha, ROUNDING, () => `${at(o)} ${r.lparId} header R4HA vs Partition Data`);
          c.atMost(head.r4haMsu, head.max4hMsu, ROUNDING, () => `${at(o)} ${r.lparId} 4h avg above 4h max`);
          c.close(lv.msu, sys.msu, ROUNDING, () => `${at(o)} ${r.lparId} header MSU vs Monitor III`);
        }
      }
    },
  },
  {
    id: 'soft-cap-holds',
    title: 'Soft capping: while an image is capped to its defined capacity its MSU rate stays at or under it',
    basis: 'game',
    source: 'SPEC §5.11.1, §17 "R4HA": the cap is a flat MSU limit (APPROX; real WLM caps by phantom weight)',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        for (const l of zos(o.config)) {
          const s = o.lpars[l.id]!;
          if (l.definedCapacityMsu === null || s.capFlagTicks === 0) continue;
          c.atMost(s.cappedMsuMax, l.definedCapacityMsu, ROUNDING, () => `${at(o)} ${l.id} MSU while capped`);
        }
      }
    },
  },
  {
    id: 'soft-cap-shown',
    title: 'Soft capping: an image WLM is capping (WLM Capping % above zero) shows as capped in SYSINFO and the header',
    basis: 'game',
    source: 'SPEC §8, §14: one capped state for an image in every view',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const h of o.mon3.cpcHeaders) {
          if (h.wlmCappingPct <= 0) continue;
          c.ok(o.mon3.systems.find((x) => x.system === h.lparId)!.capped, () => `${at(o)} ${h.lparId} WLM Capping ${h.wlmCappingPct.toFixed(1)} % but not shown capped`);
        }
      }
    },
  },
  {
    id: 'partition-mvs-busy',
    title: 'Partition Data: MVS BUSY % is never below LPAR BUSY %',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.389',
    check: (run, c) => {
      for (const o of run.intervals) for (const r of o.iv.cpu) if (r.logicalCps > 0 && o.steady) c.atMost(r.logicalBusyPct, r.mvsBusyPct ?? 0, ROUNDING, () => `${at(o)} ${r.lparId} LPAR BUSY above MVS BUSY`);
    },
  },
  // ---------------------------------------------------------------- Finance (SCRT-style bill)
  {
    id: 'bill-hourly-from-r4ha',
    title: "Finance: each hour's product MSU is the sum of its images' R4HA, limited by defined capacity and group limit",
    basis: 'z/OS',
    source: 'SCRT',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (o.iv.endTick % TICKS_PER_HOUR !== 0) continue;
        const cfg = o.end.sim.config;
        const billable: Record<string, number> = {};
        for (const r of o.iv.cpu) billable[r.lparId] = r.definedCapacityMsu !== null ? Math.min(r.r4ha, r.definedCapacityMsu) : r.r4ha;
        for (const g of o.config.capacityGroups) {
          const members = o.config.lpars.filter((l) => l.capacityGroup === g.id).map((l) => l.id);
          const total = sum(members.map((id) => billable[id] ?? 0));
          if (total > g.limitMsu) for (const id of members) billable[id] = ((billable[id] ?? 0) * g.limitMsu) / total;
        }
        const f = financeView(o.end, run.scenario);
        for (const p of run.scenario.products) {
          const series = f.hourly.series[p.id] ?? [];
          c.close(series.at(-1) ?? NaN, sum(p.lpars.map((id) => billable[id] ?? 0)), ROUNDING, () => `${at(o)} ${p.id}`);
          c.ok(series.length === f.hourly.labels.length, () => `${at(o)} ${p.id} hourly labels`);
          c.ok(cfg === o.config || !o.steady, () => `${at(o)} configuration changed inside a steady interval`);
        }
      }
    },
  },
  {
    id: 'bill-peak-and-charge',
    title: "Finance: a product's peak is its highest hour, its images' contributions add up to it, and the charges add up to the bill",
    basis: 'game',
    source: 'SPEC §5.11.2 (peak of sums; FICTIONAL tier prices)',
    check: (run, c) => {
      for (const h of run.hours) {
        const f = financeView(h.end, run.scenario);
        const cost = h.end.sim.cost;
        const where = (x: string) => () => `${h.phase} ${formatClock(h.end.sim.tick)} ${x}`;
        let total = 0;
        for (const p of f.products) {
          const series = f.hourly.series[p.id] ?? [];
          c.close(p.peakMsu, Math.max(0, ...series), ROUNDING, where(`${p.id} peak vs hourly`));
          c.close(sum(Object.values(p.peakByLpar)), p.peakMsu, ROUNDING, where(`${p.id} peak by image`));
          c.ok(Object.keys(p.peakByLpar).every((id) => p.lpars.includes(id)), where(`${p.id} peak names an image outside the product`));
          const factor = run.scenario.products.find((x) => x.id === p.id)!.priceFactor;
          c.close(p.charge, (cost.subcapFrac ?? 1) * (cost.priceMult ?? 1) * tieredMonthlyCost(p.peakMsu, factor), ROUNDING, where(`${p.id} sub-capacity charge`));
          total += f.tfp ? f.tfp.find((x) => x.id === p.id)!.charge : p.charge;
        }
        c.close(f.monthToDate, total, ROUNDING, where('month to date vs product charges'));
        c.close(buildView(h.end, run.scenario).mlcEstimate, f.monthToDate, ROUNDING, where('header MLC estimate vs Finance'));
        const printedTotal = Number(/^TOTAL\s+(-?[\d.]+)\s*$/m.exec(f.scrt)?.[1]);
        c.close(printedTotal, f.monthToDate, printed(0), where('SCRT TOTAL vs month to date'));
      }
    },
  },
  {
    id: 'bill-tfp-consumption',
    title: "Finance: Tailored Fit Pricing MSU-hours are Partition Data's MSU AVG over the intervals since it started",
    basis: 'game',
    source: 'SPEC §5.11.2 (consumption pricing; terms FICTIONAL)',
    check: (run, c) => {
      const start = run.tfpStart?.sim.tick;
      if (start === undefined) return;
      const used: Record<string, number> = {};
      for (const o of run.intervals) {
        if (o.iv.startTick < start) continue;
        for (const p of run.scenario.products) used[p.id] = (used[p.id] ?? 0) + (sum(p.lpars.map((id) => o.iv.cpu.find((r) => r.lparId === id)?.msuAvg ?? 0)) * o.iv.intervalSec) / 3600;
        const f = financeView(o.end, run.scenario);
        const tfp = o.end.sim.cost.tfp!;
        c.ok(f.pricing === 'TFP' && f.tfp !== null, () => `${at(o)} pricing not TFP`);
        for (const row of f.tfp ?? []) {
          c.close(row.msuHours, used[row.id] ?? 0, ROUNDING, () => `${at(o)} ${row.id} MSU-hours`);
          const sub = f.products.find((x) => x.id === row.id)!.charge;
          c.close(row.charge, sub + tfpCharge(row.msuHours, row.baselineMsuHours, tfp.terms.pricePerMsuHour[row.id] ?? 0, tfp.terms.overageFrac), ROUNDING, () => `${at(o)} ${row.id} charge`);
          c.close(row.baselineMsuHours, (tfp.terms.baselineMsuHours[row.id] ?? 0) * tfp.monthFrac, ROUNDING, () => `${at(o)} ${row.id} prorated baseline`);
        }
      }
    },
  },
  {
    id: 'bill-month-close',
    title: 'Finance: the bill a month closes with is the month-to-date estimate, line by line',
    basis: 'game',
    source: 'SPEC §5.11.2',
    check: (run, c) => {
      const cost = run.final.sim.cost;
      const before = billLines(cost, run.scenario.products);
      const closed = closeMonth(cost, run.scenario.products);
      const bill = closed.bills.at(-1)!;
      c.close(bill.total, sum(before.map((l) => l.cost)), ROUNDING, () => 'bill total vs month to date');
      c.close(bill.total, financeView(run.final, run.scenario).monthToDate, ROUNDING, () => 'bill total vs Finance month to date');
      bill.lines.forEach((l, i) => c.close(l.cost, before[i]!.cost, ROUNDING, () => `${l.product} line`));
      const text = renderScrt(closed, run.scenario.products, bill.month, (t) => formatClock(t));
      c.close(Number(/^TOTAL\s+(-?[\d.]+)\s*$/m.exec(text)?.[1]), bill.total, printed(0), () => 'closed SCRT TOTAL');
      for (const pk of closed.peaks) c.close(pk.peakMsu, 0, ROUNDING, () => `${pk.product} peak carried into the new month`);
    },
  },
  // ---------------------------------------------------------------- DASD Activity (SMF 74.1)
  {
    id: 'dasd-response-time',
    title: 'DASD Activity: response time is IOSQ + PEND + DISC + CONN',
    basis: 'z/OS',
    source: 'RMF Report Analysis',
    check: (run, c) => {
      for (const o of run.intervals) {
        const d = o.iv.dasd;
        c.close(d.rtRandomMs, d.iosqMs + d.pendMs + d.discMs + d.connMs, ROUNDING, () => `${at(o)} all volumes`);
        for (const l of o.iv.lcus) c.atMost(l.iosqMs + l.discMs, l.rtMs, ROUNDING, () => `${at(o)} LCU ${l.id} IOSQ + DISC above response time`);
      }
    },
  },
  {
    id: 'dasd-activity-rate',
    title: "DASD Activity: the LCUs' activity rates add up to the total, which is the I/O rate the sim's workloads drove",
    basis: 'z/OS',
    source: 'RMF Report Analysis',
    check: (run, c) => {
      for (const o of run.intervals) {
        const n = o.iv.intervalSec / TICK_SEC;
        c.close(sum(o.iv.lcus.map((l) => l.iops)), o.iv.dasd.iops, ROUNDING, () => `${at(o)} Σ LCU rate vs total`);
        c.close(o.iv.dasd.iops, o.dasdIops / n, ROUNDING, () => `${at(o)} total rate vs sim`);
        if (o.steady) for (const l of o.iv.lcus) {
          const cfg = o.config.dasd.lcus.find((x) => x.id === l.id)!;
          c.ok(l.volumes === cfg.volumes && l.aliases === cfg.aliases, () => `${at(o)} LCU ${l.id} volumes/aliases differ from the configuration`);
        }
      }
    },
  },
  // ---------------------------------------------------------------- Coupling Facility Activity (SMF 74.4)
  {
    id: 'cf-requests-add-up',
    title: 'CF Activity: structure requests add up to their CF, systems to each structure copy and to each subchannel line',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.365–378',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        const iv = o.iv;
        for (const cf of iv.cf) {
          c.close(sum(iv.cfStructures.filter((s) => s.cfLparId === cf.lparId).map((s) => s.reqPerSec)), cf.reqPerSec, ROUNDING, () => `${at(o)} ${cf.lparId} Σ structures vs CF`);
          c.close(sum((iv.cfSystems ?? []).filter((s) => s.cfLparId === cf.lparId).map((s) => s.reqPerSec)), cf.reqPerSec, ROUNDING, () => `${at(o)} ${cf.lparId} Σ systems vs CF`);
          c.ok(cf.busyPct >= 0 && cf.busyPct <= 100 && cf.asyncPct >= -1e-9 && cf.asyncPct <= 100 + 1e-9, () => `${at(o)} ${cf.lparId} UTIL% / ASYNC % outside 0–100`);
        }
        for (const st of iv.cfStructures) {
          c.close(sum((iv.cfStructSystems ?? []).filter((x) => x.name === st.name && x.role === st.role).map((x) => x.reqPerSec)), st.reqPerSec, ROUNDING, () => `${at(o)} ${st.name} ${st.role ?? ''} Σ systems vs structure`);
          c.ok(iv.cf.some((cf) => cf.lparId === st.cfLparId), () => `${at(o)} ${st.name} in ${st.cfLparId}, which has no CF line`);
        }
        for (const s of iv.cfSystems ?? []) {
          c.close(sum((iv.cfStructSystems ?? []).filter((x) => x.cfLparId === s.cfLparId && x.system === s.system).map((x) => x.reqPerSec)), s.reqPerSec, ROUNDING, () => `${at(o)} ${s.system}→${s.cfLparId} Σ structures vs subchannel`);
        }
      }
    },
  },
  {
    id: 'cf-service-times',
    title: "CF Activity: a CF's ASYNC % and service times are the request-weighted figures of its structures and of its systems",
    basis: 'game',
    source: 'One CF line read against the Structure Summary and Subchannel Activity below it',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        const iv = o.iv;
        for (const cf of iv.cf) {
          const sts = iv.cfStructures.filter((s) => s.cfLparId === cf.lparId);
          const req = sum(sts.map((s) => s.reqPerSec));
          if (req <= 0) continue;
          c.close(cf.asyncPct, sum(sts.map((s) => s.reqPerSec * (100 - s.syncPct))) / req, ROUNDING, () => `${at(o)} ${cf.lparId} ASYNC % vs structures`);
          c.close(cf.serviceUs, sum(sts.map((s) => s.reqPerSec * s.serviceUs)) / req, ROUNDING, () => `${at(o)} ${cf.lparId} AVG SERV vs structures`);
        }
      }
    },
  },
  {
    id: 'cf-failed',
    title: 'CF Activity: a failed CF reports no requests and holds no structure; a duplexed structure shows PRIM and SEC in two CFs',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.365',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        for (const cfg of o.config.cfs) {
          if (!cfg.failed) continue;
          c.ok(!o.iv.cf.some((x) => x.lparId === cfg.lparId && x.reqPerSec > 0), () => `${at(o)} failed ${cfg.lparId} reports requests`);
          c.ok(!o.iv.cfStructures.some((s) => s.cfLparId === cfg.lparId), () => `${at(o)} failed ${cfg.lparId} holds a structure`);
        }
        for (const st of o.iv.cfStructures) {
          if (!st.role) continue;
          const other = o.iv.cfStructures.find((x) => x.name === st.name && x.role !== st.role);
          c.ok(!!other && other.cfLparId !== st.cfLparId, () => `${at(o)} ${st.name} ${st.role} without its other copy in another CF`);
          if (other && st.role === 'SEC') c.atMost(st.reqPerSec, other.reqPerSec, ROUNDING, () => `${at(o)} ${st.name} SEC busier than PRIM`);
        }
      }
    },
  },
  // ---------------------------------------------------------------- Resource groups and capping delay
  {
    id: 'resource-group-maximum',
    title: "WLMGL: the general-CP time of a resource group's classes stays within the group's maximum",
    basis: 'z/OS',
    source: 'WLM Planning',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        for (const g of o.def.resourceGroups) {
          if (g.max === null) continue;
          const members = new Set(o.def.classes.filter((x) => x.resourceGroup === g.id).map((x) => x.id));
          const used = (lparId: string) => sum(scRows(o.iv, lparId).filter((r) => members.has(r.serviceClass)).map((r) => r.applCpPct)) / 100;
          if (g.type === 3) {
            // Type 3: hundredths of a CP on each system.
            for (const id of systemsOf(o.iv)) c.atMost(used(id), g.max / 100, RG_SLACK, () => `${at(o)} ${id} group ${g.id} type 3 max ${g.max}`);
          } else if (g.type === 2) {
            // Type 2: percentage of the LPAR share (its weight's share of the CPC's CPs).
            for (const id of systemsOf(o.iv)) {
              const share = o.end.sim.lpars.find((l) => l.id === id)?.pools.find((p) => p.pool === 'CP')?.entitlementEngines ?? 0;
              c.atMost(used(id), (share * g.max) / 100, RG_SLACK, () => `${at(o)} ${id} group ${g.id} type 2 max ${g.max} % of ${share} CPs`);
            }
          } else {
            // Type 1: service units per second across the sysplex.
            const su = sum(systemsOf(o.iv).map((id) => (used(id) * msuPerCp(o.config.cpcs.find((x) => x.id === o.config.lpars.find((l) => l.id === id)!.cpcId)!) * 1e6) / 3600));
            c.atMost(su, g.max, RG_SLACK, () => `${at(o)} group ${g.id} type 1 max ${g.max} SU/s`);
          }
        }
      }
    },
  },
  {
    id: 'cap-delay-needs-a-cap',
    title: 'WLMGL: CAP delay appears only on work a resource-group maximum or discretionary goal management can cap',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.540; WLM Planning 3.1 p.118',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        const capped = new Set(o.def.resourceGroups.filter((g) => g.max !== null).map((g) => g.id));
        for (const r of o.iv.wlm) {
          if (r.lparId === '*PLEX') continue;
          const g = goalInfo(o.def, r.scKey);
          const inGroup = !!g?.resourceGroup && capped.has(g.resourceGroup);
          const loose = !!g && !g.resourceGroup && ((g.goal.kind === 'VEL' && g.goal.velocity <= 30) || ((g.goal.kind === 'AVG' || g.goal.kind === 'PCT') && g.goal.rtSec > 60));
          c.ok(r.delayPct.cap <= 1e-9 || inGroup || loose, () => `${at(o)} ${r.lparId} ${r.scKey} CAP delay ${r.delayPct.cap.toFixed(2)} % with nothing to cap it`);
        }
      }
    },
  },
  // ---------------------------------------------------------------- Report classes
  {
    id: 'report-class-rollup',
    title: "WLMGL: a report class that takes all of a service class's work shows that class's totals, and its goal and PI when it is one period",
    basis: 'z/OS',
    source: 'WLM Planning 3.1 p.113',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady || !o.iv.wlmRc || Object.keys(run.reportClassOf).length === 0) continue;
        const unruled = unruledClasses(run, o);
        for (const [serviceClass, rc] of Object.entries(run.reportClassOf)) {
          for (const lparId of [...systemsOf(o.iv), '*PLEX']) {
            const rows = scRows(o.iv, lparId).filter((r) => r.serviceClass === serviceClass);
            const row = o.iv.wlmRc.find((r) => r.lparId === lparId && r.scKey === rc);
            const w = (f: string) => () => `${at(o)} ${lparId} ${rc} (${serviceClass}) ${f}`;
            const cmp = unruled.has(serviceClass) ? (a: number, b: number, f: string) => c.atMost(a, b, ROUNDING, w(f)) : (a: number, b: number, f: string) => c.close(a, b, ROUNDING, w(f));
            cmp(row?.ended ?? 0, sum(rows.map((r) => r.ended)), 'ENDED');
            cmp(row?.failed ?? 0, sum(rows.map((r) => r.failed)), 'FAILED');
            cmp(row?.applCpPct ?? 0, sum(rows.map((r) => r.applCpPct)), 'APPL% CP');
            cmp(row?.applIipcpPct ?? 0, sum(rows.map((r) => r.applIipcpPct)), 'APPL% IIPCP');
            cmp(row?.applIipPct ?? 0, sum(rows.map((r) => r.applIipPct)), 'APPL% IIP');
            cmp((row?.avgRtSec ?? 0) * (row?.ended ?? 0), sum(rows.map((r) => (r.avgRtSec ?? 0) * r.ended)), 'response time × ENDED');
            if (!row) continue;
            c.ok((row.members ?? []).every((m) => goalInfo(o.def, m)?.serviceClass === serviceClass || !goalInfo(o.def, m)), w('members outside its service class'));
            // One period and all of its work: the same line as the service class period (homogeneous report class).
            if (unruled.has(serviceClass) || row.members?.length !== 1 || rows.length !== 1) continue;
            const sc = rows[0]!;
            c.ok(row.goalText === sc.goalText && row.importance === sc.importance, w('goal'));
            c.ok(row.pi === sc.pi || (row.pi !== null && sc.pi !== null && Math.abs(row.pi - sc.pi) <= 1e-9 * Math.max(1, sc.pi)), w(`PI ${row.pi} vs ${sc.pi}`));
            c.ok(row.execVelocity === sc.execVelocity || (row.execVelocity !== null && sc.execVelocity !== null && Math.abs(row.execVelocity - sc.execVelocity) <= 1e-9 * 100), w(`velocity ${row.execVelocity} vs ${sc.execVelocity}`));
            for (const k of ['cpu', 'ziip', 'io'] as const) c.close(row.usingPct[k], sc.usingPct[k], ROUNDING, w(`USING ${k}`));
            for (const k of ['cpu', 'ziip', 'io', 'storage', 'cap', 'other'] as const) c.close(row.delayPct[k], sc.delayPct[k], ROUNDING, w(`DELAY ${k}`));
          }
        }
      }
    },
  },
  // ---------------------------------------------------------------- SMF 30, 101, 110 against RMF
  {
    id: 'smf30-job-times',
    title: 'SMF 30: a job ran from its start to its end, queued before that, and ended inside the interval that reports it',
    basis: 'game',
    source: 'SPEC §5.10.4, §5.12 (job-end records)',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const j of o.iv.jobs) {
          c.ok(j.endTick > o.iv.startTick && j.endTick <= o.iv.endTick, () => `${at(o)} ${j.name} ended at tick ${j.endTick}, outside its interval`);
          c.ok(j.elapsedSec > 0 && j.queuedSec >= 0 && j.stretch >= 1 - 1e-9, () => `${at(o)} ${j.name} elapsed ${j.elapsedSec}, queued ${j.queuedSec}, stretch ${j.stretch}`);
        }
      }
      const night = batchNight(run.final);
      if (!night) return;
      const records = run.intervals.flatMap((o) => o.iv.jobs);
      for (const j of night.jobs) {
        c.close(j.endSec - j.startSec, j.elapsedSec, ROUNDING, () => `${j.name} end − start vs elapsed`);
        c.close(j.startSec - j.queuedAtSec, j.queuedSec, ROUNDING, () => `${j.name} start − queued vs queue time`);
        c.ok(records.some((r) => r.name === j.name && r.lparId === j.lparId && r.elapsedSec === j.elapsedSec), () => `${j.name} is in the batch view but in no interval`);
      }
      c.ok(night.criticalEnd === null || night.jobs.some((j) => j.critical && j.name === night.criticalEnd), () => 'critical end names no critical job');
    },
  },
  {
    id: 'smf30-vs-wlmgl',
    title: 'SMF 30 against WLMGL: a batch class with a response time goal ends one transaction per job, at queue + elapsed time',
    basis: 'z/OS',
    source: 'WLM Planning 3.1 p.71',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady || o.iv.jobs.length === 0) continue;
        const def = o.def;
        const jobs = o.iv.jobs.map((j) => {
          const rt = o.end.sim.batch.jobs.find((x) => x.def.name === j.name && x.endTick === j.endTick && x.lparId === j.lparId)!;
          return { ...j, serviceClass: classify(def, { subsystem: 'JES', TN: rt.def.name, TC: rt.def.jobClass, SY: j.lparId }).serviceClass };
        });
        for (const lparId of systemsOf(o.iv)) {
          for (const sc of new Set(jobs.filter((j) => j.lparId === lparId).map((j) => j.serviceClass))) {
            const cls = def.classes.find((x) => x.id === sc);
            // Every period a response time goal, and no transaction workload in the class: its ENDED are jobs.
            if (!cls || !cls.periods.every((p) => p.goal.kind === 'AVG' || p.goal.kind === 'PCT') || workloadClasses(run, o).has(sc)) continue;
            const mine = jobs.filter((j) => j.lparId === lparId && j.serviceClass === sc);
            const rows = scRows(o.iv, lparId).filter((r) => r.serviceClass === sc);
            c.close(sum(rows.map((r) => r.ended)), mine.length, ROUNDING, () => `${at(o)} ${lparId} ${sc} ENDED vs jobs ended`);
            c.close(sum(rows.map((r) => (r.avgRtSec ?? 0) * r.ended)), sum(mine.map((j) => j.queuedSec + j.elapsedSec)), ROUNDING, () => `${at(o)} ${lparId} ${sc} response time vs queue + elapsed`);
          }
        }
      }
    },
  },
  {
    id: 'smf-views-agree',
    title: 'SMF 101 and 110: a workload in both views has one rate, response time and CPU, and both match the hour the sim measured',
    basis: 'game',
    source: 'SPEC §8 tier 2 (SMF 101/110 views from one per-workload measurement)',
    check: (run, c) => {
      for (const h of run.hours) {
        const last = h.end.smfHours.at(-1);
        if (!last) continue;
        const key = `${last.day}:${last.hourOfDay}`;
        const where = (x: string) => () => `${h.phase} ${formatClock(h.end.sim.tick)} ${x}`;
        const db2 = db2Accounting(h.end, run.scenario, key);
        const cics = cicsMonitoring(h.end, run.scenario, key);
        for (const r of db2) {
          const w = h.workloads[r.workloadId];
          c.close(r.txnPerSec * 3600, w?.completions ?? 0, ROUNDING, where(`${r.workloadId} SMF 101 rate vs sim completions`));
          const x = cics.find((y) => y.workloadId === r.workloadId);
          if (x) {
            c.close(x.txnPerSec, r.txnPerSec, ROUNDING, where(`${r.workloadId} rate 110 vs 101`));
            c.close(x.avgRtMs, r.class1Ms, ROUNDING, where(`${r.workloadId} response time 110 vs class 1`));
            c.close(x.cpuMs, r.cpuMs, ROUNDING, where(`${r.workloadId} CPU 110 vs 101`));
          }
          c.atMost(r.cpuMs + r.lockMs + r.syncIoMs + r.cfMs + r.notAccountedMs + r.dbatQueueMs, r.class1Ms, ROUNDING, where(`${r.workloadId} SMF 101 components above class 1 elapsed`));
        }
        for (const x of cics) {
          const w = h.workloads[x.workloadId];
          c.close(x.txnPerSec * 3600, w?.completions ?? 0, ROUNDING, where(`${x.workloadId} SMF 110 rate vs sim completions`));
          c.close(x.failed, w?.failed ?? 0, ROUNDING, where(`${x.workloadId} SMF 110 failed vs sim`));
          c.close(x.failedPct * (x.failed + x.txnPerSec * 3600), 100 * x.failed, ROUNDING, where(`${x.workloadId} failed %`));
          c.atMost(x.cpuMs + x.qrWaitMs + x.mxtWaitMs + x.dispMinusCpuMs, x.avgRtMs, ROUNDING, where(`${x.workloadId} SMF 110 components above the response time`));
        }
        for (const s of cicsStorageStats(h.end, key)) {
          c.ok(s.peakMb >= 0 && s.sosSec >= 0 && s.sosSec <= 3600, where(`${s.region} storage statistics`));
        }
      }
    },
  },
  {
    id: 'smf-vs-wlmgl',
    title: "SMF 101/110 against WLMGL: the workloads of a service class end and fail as many transactions as its rows, at the SMF response time less the wait for a thread or task slot",
    basis: 'game',
    source: 'SPEC §17 "Pre-work-manager queueing (MXT, DBAT)": in users\' response time, not in WLM/RMF response time',
    check: (run, c) => {
      run.hours.forEach((h, i) => {
        const last = h.end.smfHours.at(-1);
        const end = h.end.sim.tick;
        const ivs = run.intervals.filter((o) => o.iv.endTick > end - TICKS_PER_HOUR && o.iv.endTick <= end);
        // Classification must hold for the whole hour.
        if (!last || ivs.some((o) => o.def !== ivs[0]!.def) || ivs[0]!.def !== h.end.sim.wlm.definition || i === 0) return;
        const def = ivs[0]!.def;
        if (def.cicsRegionMode === 'REGION' || JSON.stringify(def.subsystems).includes('"regionMode":"REGION"')) return;
        const jobClasses = new Set(ivs.flatMap((o) => o.iv.jobs.map((j) => {
          const rt = o.end.sim.batch.jobs.find((x) => x.def.name === j.name && x.endTick === j.endTick)!;
          return classify(def, { subsystem: 'JES', TN: rt.def.name, TC: rt.def.jobClass, SY: j.lparId }).serviceClass;
        })));
        for (const group of workloadGroups(run, h.end, def)) {
          // A batch job that ended in a class with a response time goal is a transaction there too (smf30-vs-wlmgl).
          if (group.classes.some((sc) => jobClasses.has(sc))) continue;
          const rows = ivs.flatMap((o) => o.iv.wlm.filter((r) => r.lparId === '*PLEX' && group.classes.includes(r.serviceClass)));
          const recs = group.workloads.map((id) => last.workloads[id]).filter((x) => !!x);
          const w = (x: string) => () => `${h.phase} ${formatClock(end)} ${group.workloads.join('+')} in ${group.classes.join('+')} ${x}`;
          c.close(sum(rows.map((r) => r.ended)), sum(recs.map((x) => x.completions)), ROUNDING, w('ENDED'));
          c.close(sum(rows.map((r) => r.failed)), sum(recs.map((x) => x.failed)), ROUNDING, w('FAILED'));
          c.close(sum(rows.map((r) => (r.avgRtSec ?? 0) * r.ended)), sum(recs.map((x) => x.rtSumSec - (x.parts.outside ?? 0))), ROUNDING, w('response time'));
        }
      });
    },
  },
  // ---------------------------------------------------------------- Monitor III
  {
    id: 'mon3-vs-rmf-window',
    title: 'Monitor III against RMF: read every tick of an interval, Monitor III adds up to the interval’s WLMGL row',
    basis: 'game',
    source: 'SPEC §17 "Monitor III views": the same samples through an exponential window (0.85 per tick) instead of the interval',
    check: (run, c) => {
      // A decayed sum S(t) = d·S(t−1) + x(t) gives back the flat sum: Σx = (1−d)·ΣS(t) + d·(S(n) − S(0)).
      // Monitor III shows (1−d)·S, so Σx = Σ reading(t) + d/(1−d)·(reading(n) − reading(0)).
      const k = ACC_DECAY / (1 - ACC_DECAY);
      for (const w of run.windows) {
        const n = w.views.length - 1;
        const index = w.views.map((v) => new Map(v.rows.map((r) => [`${r.system}|${r.scKey}`, r])));
        const flat = (key: string, f: (r: Mon3Row) => number): number => {
          const val = (t: number) => { const r = index[t]!.get(key); return r ? f(r) : 0; };
          let total = k * (val(n) - val(0));
          for (let t = 1; t <= n; t++) total += val(t);
          return total / n;
        };
        for (const r of w.iv.wlm) {
          const key = `${r.lparId}|${r.scKey}`;
          const where = (x: string) => () => `${w.phase} ${formatClock(w.iv.endTick)} ${r.lparId} ${r.scKey} ${x}`;
          c.close(flat(key, (m) => m.cpuEngines), r.applCpPct / 100, DECAYED, where('EAppl CP vs APPL% CP'));
          c.close(flat(key, (m) => m.endedPerSec), r.endPerSec, DECAYED, where('ended/s vs END/S'));
          c.close(flat(key, (m) => m.endedPerSec * (m.avgRtMs ?? 0)), r.endPerSec * (r.avgRtSec ?? 0) * 1000, DECAYED, where('response time'));
          const active = flat(key, (m) => m.avgUsers.active);
          if (r.resourceSamples === false) continue;
          const share = (f: (m: Mon3Row) => number) => (active > 1e-9 ? (100 * flat(key, f)) / active : 0);
          c.close(share((m) => m.avgUsers.active * m.usingFrac), usingOf(r), DECAYED_PCT, where('USG vs USING %'));
          c.close(share((m) => m.avgUsers.delayProc), r.delayPct.cpu + r.delayPct.ziip, DECAYED_PCT, where('delay PRC vs DELAY % CPU + IIP'));
          c.close(share((m) => m.avgUsers.delayDev), r.delayPct.io, DECAYED_PCT, where('delay DEV vs DELAY % I/O'));
          // Initiation queue delay has no Monitor III column and shows with STR (mon3.ts, APPROX).
          c.close(share((m) => m.avgUsers.delayStor), r.delayPct.storage + (r.delayPct.queue ?? 0), DECAYED_PCT, where('delay STR vs DELAY % STO + QMPL'));
          c.close(share((m) => m.avgUsers.active * m.delay.cap), r.delayPct.cap, DECAYED_PCT, where('capping vs DELAY % CAP'));
          c.close(share((m) => m.avgUsers.active * m.unknownFrac), r.delayPct.other, DECAYED_PCT, where('UKN vs unknown'));
        }
      }
    },
  },
  {
    id: 'mon3-sysplex-sum',
    title: 'Monitor III: a sysplex row is the sum of its systems (CPU, zIIP, ended rate, users using and delayed)',
    basis: 'z/OS',
    source: 'RMF Report Analysis',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const p of o.mon3.rows.filter((r) => r.system === '*PLEX')) {
          const parts = o.mon3.rows.filter((r) => r.system !== '*PLEX' && r.scKey === p.scKey);
          const w = (f: string) => () => `${at(o)} ${p.scKey} ${f}`;
          const add = (f: (r: Mon3Row) => number) => sum(parts.map(f));
          c.close(p.cpuEngines, add((r) => r.cpuEngines), DECAYED, w('CP engines'));
          c.close(p.ziipEngines, add((r) => r.ziipEngines), DECAYED, w('zIIP engines'));
          c.close(p.iipcpEngines, add((r) => r.iipcpEngines), DECAYED, w('IIPCP engines'));
          c.close(p.endedPerSec, add((r) => r.endedPerSec), DECAYED, w('ended/s'));
          c.close(p.avgUsers.active, add((r) => r.avgUsers.active), DECAYED, w('active users'));
          c.close(p.avgUsers.proc, add((r) => r.avgUsers.proc), DECAYED, w('users using PROC'));
          c.close(p.avgUsers.dev, add((r) => r.avgUsers.dev), DECAYED, w('users using DEV'));
          c.close(p.avgUsers.delayProc, add((r) => r.avgUsers.delayProc), DECAYED, w('users delayed PROC'));
          c.close(p.avgUsers.delayDev, add((r) => r.avgUsers.delayDev), DECAYED, w('users delayed DEV'));
          c.close(p.avgUsers.delayStor, add((r) => r.avgUsers.delayStor), DECAYED, w('users delayed STOR'));
        }
      }
    },
  },
  {
    id: 'mon3-delay-states',
    title: 'Monitor III DELAY: USG, DLY and UKN add up to the active samples, the delay columns to DLY, the user counts to both',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.106–110',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const r of o.mon3.rows) {
          const w = (f: string) => () => `${at(o)} ${r.system} ${r.scKey} ${f}`;
          const a = r.avgUsers.active;
          for (const x of [r.usingFrac, r.delayFrac, r.unknownFrac, ...Object.values(r.delay)]) c.ok(x >= -1e-9 && x <= 1 + 1e-9, w(`share ${x} outside 0–1`));
          if (a <= 1e-9) continue;
          c.close(r.usingFrac + r.delayFrac + r.unknownFrac, 1, DECAYED, w('USG + DLY + UKN'));
          c.close(r.delay.cpu + r.delay.ziip + r.delay.io + r.delay.stor + r.delay.cap, r.delayFrac, DECAYED, w('delay columns + capping vs DLY'));
          c.close(r.delay.other, r.unknownFrac, DECAYED, w('UKN'));
          c.close(r.avgUsers.proc + r.avgUsers.dev, r.usingFrac * a, DECAYED, w('users using vs USG'));
          c.close(r.avgUsers.delayProc, (r.delay.cpu + r.delay.ziip) * a, DECAYED, w('users delayed PROC'));
          c.close(r.avgUsers.delayDev, r.delay.io * a, DECAYED, w('users delayed DEV'));
          c.close(r.avgUsers.delayStor, r.delay.stor * a, DECAYED, w('users delayed STOR'));
        }
      }
    },
  },
  {
    id: 'mon3-velocity-and-pi',
    title: "Monitor III SYSSUM: velocity is USG ÷ (USG + DLY), and the PI follows from the row's goal and actuals; WFEX speed is the same velocity",
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.50–55; WLM Planning',
    check: (run, c) => {
      for (const o of run.intervals) {
        if (!o.steady) continue;
        const io = o.def.ioPriorityManagement !== false;
        for (const r of o.mon3.rows) {
          const w = (f: string) => () => `${at(o)} ${r.system} ${r.scKey} ${f}`;
          if (io && r.velocity !== null) c.close(r.velocity, (100 * r.usingFrac) / (r.usingFrac + r.delayFrac), DECAYED_PCT, w('velocity vs USG ÷ (USG + DLY)'));
          c.ok(r.velocityAct === (r.workManager ? null : r.velocity), w('Exec Vel Act'));
          if (r.pi === null) continue;
          if (r.goalVelocity !== null && r.velocity !== null) c.close(r.pi, Math.min(99, r.goalVelocity / Math.max(r.velocity, 0.1)), ROUNDING, w('velocity PI'));
          else if (r.goalRtMs !== null && r.goalPct === null && r.avgRtMs !== null) c.close(r.pi, r.avgRtMs / r.goalRtMs, ROUNDING, w('average response time PI'));
          else if (r.goalPct !== null && r.withinGoalPct !== null) c.ok(r.pi <= 1 === r.withinGoalPct >= r.goalPct - 1e-9, w(`percentile PI ${r.pi} with ${r.withinGoalPct} % in goal (goal ${r.goalPct} %)`));
        }
        for (const s of o.mon3.speed) {
          const r = o.mon3.rows.find((x) => x.system === s.system && x.scKey === s.name);
          if (!r || s.servedBy) continue;
          c.ok(s.speed === r.velocity, () => `${at(o)} ${s.system} ${s.name} WFEX speed ${s.speed} vs velocity ${r.velocity}`);
          c.close(s.activeUsers, r.avgUsers.active, ROUNDING, () => `${at(o)} ${s.system} ${s.name} WFEX users`);
        }
      }
    },
  },
  {
    id: 'mon3-sysinfo-cpc',
    title: 'Monitor III SYSINFO and CPC: EAppl% is the rows’ CPU over the online CPs, CPU Util% the CPC report’s logical total, physical total = LPAR + effective',
    basis: 'z/OS',
    source: 'RMF Report Analysis 3.1 p.97–98',
    check: (run, c) => {
      for (const o of run.intervals) {
        const view = buildView({ ...o.end, tools: ['RMF_MON3'] }, run.scenario);
        for (const s of o.mon3.systems) {
          const rows = o.mon3.rows.filter((r) => r.system === s.system);
          const cpc = o.mon3.cpc.find((x) => x.lparId === s.system)!;
          const w = (f: string) => () => `${at(o)} ${s.system} ${f}`;
          c.close((s.eapplPct * s.cpsOnline) / 100, sum(rows.map((r) => r.cpuEngines)), ROUNDING, w('EAppl% vs rows'));
          if (s.applIipPct !== null) c.close((s.applIipPct * s.iipsOnline) / 100, sum(rows.map((r) => r.ziipEngines)), ROUNDING, w('Appl% IIP vs rows'));
          c.atMost(s.applPct, s.eapplPct, ROUNDING, w('Appl% above EAppl%'));
          c.close(s.cpBusyPct, cpc.logicalTotalPct, ROUNDING, w('CPU Util% vs CPC logical total'));
          c.close(view.lpars.find((x) => x.id === s.system)!.cpBusyPct, s.cpBusyPct, ROUNDING, w('header CP busy vs SYSINFO'));
          c.atMost(s.cpBusyPct, s.mvsBusyPct, ROUNDING, w('CPU Util% above MVS Util%'));
          const pis = rows.filter((r) => r.importance !== null && r.pi !== null).map((r) => r.pi!);
          c.ok(s.worstPi === (pis.length ? Math.max(...pis) : null), w('worst PI'));
        }
        for (const x of o.mon3.cpc) {
          const w = (f: string) => () => `${at(o)} ${x.lparId} CPC ${f}`;
          c.close(x.physTotalPct, x.physLparPct + x.physEffectPct, ROUNDING, w('physical total vs LPAR + effective'));
          c.atMost(x.logicalEffectPct, x.logicalTotalPct, ROUNDING, w('logical effective above total'));
          c.atMost(x.logicalTotalPct, 100, ROUNDING, w('logical total above 100'));
          const h = o.mon3.cpcHeaders.find((y) => y.lparId === x.lparId);
          const box = o.end.sim.config.cpcs.find((y) => y.id === x.cpcId)!;
          // MSU Act is from effective dispatch time (p.98): logical effective × processors × the CPC's MSU per CP.
          if (h && x.msuAct !== null && box.engines.CP > 0) c.close(x.msuAct, ((x.logicalEffectPct * x.procNum) / 100) * (h.cpcCapacityMsu / box.engines.CP), ROUNDING, w('MSU Act vs effective dispatch'));
          if (h) c.atMost(h.imageCapacityMsu, (x.procNum + (o.end.sim.config.lpars.find((l) => l.id === x.lparId)!.pools.find((p) => p.pool === 'CP')?.reserved ?? 0)) * (h.cpcCapacityMsu / Math.max(1, box.engines.CP)), ROUNDING, w('image capacity above its logical CPs'));
        }
        const cps = sum(o.end.sim.config.cpcs.map((x) => x.engines.CP));
        if (cps > 0) c.close(view.cpcBusyPct, sum(o.mon3.cpc.filter((x) => x.kind === 'ZOS').map((x) => (x.physTotalPct / 100) * o.end.sim.config.cpcs.find((y) => y.id === x.cpcId)!.engines.CP)) / cps * 100, ROUNDING, () => `${at(o)} header CPC busy vs CPC report`);
      }
    },
  },
  {
    id: 'mon3-procu',
    title: 'Monitor III PROCU: the jobs’ EAppl % adds up to their service classes’ CPU, and Time on CP is within EAppl',
    basis: 'game',
    source: 'SPEC §17 "Monitor III views": PROCU shares each class row’s CPU among its jobs (APPROX)',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const s of o.mon3.systems) {
          const rows = o.mon3.rows.filter((r) => r.system === s.system && r.cpuEngines + r.ziipEngines > 1e-6);
          const jobs = (o.mon3.procJobs ?? []).filter((j) => j.system === s.system);
          c.close(sum(jobs.map((j) => j.eapplCpEngines)), sum(rows.map((r) => r.cpuEngines)), ROUNDING, () => `${at(o)} ${s.system} Σ EAppl CP`);
          c.close(sum(jobs.map((j) => j.eapplZiipEngines)), sum(rows.map((r) => r.ziipEngines)), ROUNDING, () => `${at(o)} ${s.system} Σ EAppl IIP`);
          for (const j of jobs) {
            c.atMost(j.cpEngines, j.eapplCpEngines, ROUNDING, () => `${at(o)} ${s.system} ${j.jobname} Time on CP above EAppl`);
            c.atMost(j.iipcpEngines, j.cpEngines, ROUNDING, () => `${at(o)} ${s.system} ${j.jobname} IIP on CP above Time on CP`);
          }
        }
      }
    },
  },
  {
    id: 'mon3-enclave-wkm',
    title: 'Monitor III ENCLAVE and SYSWKM: enclave lines repeat the sysplex rows, work manager states add to 100 %, an AOR’s Service % adds to 100 %',
    basis: 'game',
    source: 'SPEC §5.12 (CICS reporting), §17 "Monitor III views"',
    check: (run, c) => {
      for (const o of run.intervals) {
        for (const e of o.mon3.enclaves) {
          const r = o.mon3.rows.find((x) => x.system === '*PLEX' && x.scKey === e.scKey);
          c.ok(!!r && r.cpuEngines === e.cpEngines && r.ziipEngines === e.ziipEngines && r.pi === e.pi && r.endedPerSec === e.endedPerSec && r.avgRtMs === e.avgRtMs, () => `${at(o)} enclave ${e.scKey} differs from its sysplex row`);
        }
        const service: Record<string, number> = {};
        for (const k of o.mon3.wkm ?? []) {
          const st = k.states;
          const total = st.active + st.ready + st.lock + st.io + st.prod + st.misc;
          if (total > 0) c.close(total, 100, ROUNDING, () => `${at(o)} SYSWKM ${k.scKey} states`);
          const row = o.mon3.rows.find((x) => x.system === '*PLEX' && x.scKey === k.scKey)!;
          c.ok(row.pi === k.pi && row.avgRtMs === k.avgRtMs && row.endedPerSec === k.endedPerSec, () => `${at(o)} SYSWKM ${k.scKey} differs from its sysplex row`);
          for (const s of k.servers) service[`${s.system} ${s.jobname}`] = (service[`${s.system} ${s.jobname}`] ?? 0) + s.servicePct;
        }
        for (const [who, pct] of Object.entries(service)) c.close(pct, 100, DECAYED_PCT, () => `${at(o)} ${who} Service % over the classes it serves`);
      }
    },
  },
  {
    id: 'pi-one-value',
    title: 'One PI per service class period at one moment: the header heat map and Monitor III’s sysplex row agree',
    basis: 'game',
    source: 'SPEC §14 (PI heat map), §8 (SYSSUM)',
    check: (run, c) => {
      for (const o of run.intervals) {
        const view = buildView({ ...o.end, tools: ['RMF_MON3'] }, run.scenario);
        for (const cell of view.piHeat) {
          const r = o.mon3.rows.find((x) => x.system === '*PLEX' && x.scKey === cell.scKey);
          if (!r) continue;
          c.ok(cell.pi === r.pi || (cell.pi !== null && r.pi !== null && Math.abs(cell.pi - r.pi) <= 1e-9 * Math.max(1, r.pi)), () => `${at(o)} ${cell.scKey} heat map PI ${cell.pi}, SYSSUM ${r.pi}`);
          c.ok(cell.importance === r.importance, () => `${at(o)} ${cell.scKey} importance`);
        }
      }
    },
  },
  // ---------------------------------------------------------------- Every figure
  {
    id: 'figures-finite',
    title: 'Every figure in every report is a finite number, and no rendered report prints NaN, Infinity or undefined',
    basis: 'game',
    source: 'CLAUDE.md, Game-design guardrails: anything a player can see must be explainable',
    check: (run, c) => {
      const walk = (x: unknown, path: string, where: string): void => {
        if (typeof x === 'number') c.ok(Number.isFinite(x), () => `${where} ${path} = ${x}`);
        else if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`, where));
        else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`, where);
      };
      const clean = (text: string, where: string) => c.ok(!/NaN|Infinity|undefined/.test(text), () => `${where} prints ${/.*(NaN|Infinity|undefined).*/.exec(text)?.[0]?.trim()}`);
      for (const o of run.intervals) {
        // Job-end records and the response-time buckets' open-ended bound aside, an interval is numbers and labels.
        walk(o.iv, 'rmf', at(o));
        walk(o.mon3, 'mon3', at(o));
        for (const kind of REPORT_KINDS) {
          if (kind === 'WLM_DETAIL') continue;
          for (const system of kind === 'WLM_SUMMARY' ? ['*PLEX', ...systemsOf(o.iv)] : ['*PLEX']) clean(renderReport(o.iv, kind, '', system), `${at(o)} ${kind} ${system}`);
        }
        for (const r of [...o.iv.wlm, ...(o.iv.wlmRc ?? [])]) if (r.lparId === '*PLEX') clean(renderReport(o.iv, 'WLM_DETAIL', r.scKey, r.lparId), `${at(o)} WLM_DETAIL ${r.scKey}`);
      }
      for (const h of run.hours) {
        const where = `${h.phase} ${formatClock(h.end.sim.tick)}`;
        const f = financeView(h.end, run.scenario);
        walk({ ...f, scrt: null, bills: null }, 'finance', where);
        clean(f.scrt, `${where} SCRT`);
        const last = h.end.smfHours.at(-1);
        const key = last ? `${last.day}:${last.hourOfDay}` : 'current';
        walk(db2Accounting(h.end, run.scenario, key), 'smf101', where);
        walk(cicsMonitoring(h.end, run.scenario, key), 'smf110', where);
        walk(smf113(h.end), 'smf113', where);
        walk(batchNight(h.end)?.jobs ?? [], 'smf30', where);
      }
    },
  },
];

/** Shares of decayed sums, in percent: the same rounding, a hundred times larger. */
const DECAYED_PCT: Tol = { rel: 1e-6, abs: 1e-4 };

/** Resource-group capping works on the group's service over time, so one interval can run a little over. */
const RG_SLACK: Tol = { rel: 0.02, abs: 1e-6 };

/** Service classes holding work no classification rule reaches (forced SYSTEM address spaces, subsystems with no
 * rules), which therefore has no report class. */
function unruledClasses(run: ReportRun, o: IntervalObs): Set<string> {
  const def = o.def;
  const out = new Set<string>();
  const see = (r: { serviceClass: string; reportClass: string | null }) => void (r.reportClass === null && out.add(r.serviceClass));
  for (const a of [...run.scenario.addressSpaces, ...o.end.sim.extraAddressSpaces]) see(classify(def, { subsystem: a.subsystem, TN: a.jobname, SY: a.lparId }));
  for (const w of allWorkloads(run.scenario, o.end)) for (const l of zos(o.config)) see(classify(def, { ...w.work, SY: l.id }));
  for (const j of o.end.sim.batch.jobs) for (const l of zos(o.config)) see(classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: l.id }));
  return out;
}

/** Service classes any transaction workload is classified into, on any image it is routed to. */
function workloadClasses(run: ReportRun, o: IntervalObs): Set<string> {
  return new Set(workloadGroups(run, o.end, o.def).flatMap((g) => g.classes));
}

/** Workloads and the service classes they are classified into, grouped so no class is shared between groups. */
function workloadGroups(run: ReportRun, state: RunState, def: ServiceDefinition): { workloads: string[]; classes: string[] }[] {
  const groups: { workloads: string[]; classes: string[] }[] = [];
  for (const w of allWorkloads(run.scenario, state)) {
    const classes = [...new Set(Object.keys(state.sim.routing[w.id] ?? w.routing).map((lparId) => classify(def, { ...w.work, SY: lparId }).serviceClass))];
    const hit = groups.filter((g) => g.classes.some((x) => classes.includes(x)));
    const merged = { workloads: [w.id, ...hit.flatMap((g) => g.workloads)], classes: [...new Set([...classes, ...hit.flatMap((g) => g.classes)])].sort() };
    for (const g of hit) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  return groups;
}
