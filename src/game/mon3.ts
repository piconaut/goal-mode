// RMF Monitor III style live views (SPEC §8 tier 1), built from WLM's smoothed per-period
// accumulators. ACC_DECAY 0.85 per 10 s tick weights roughly the last minute or two, close to
// Monitor III's 120 s MINTIME range (APPROX: exponential rather than a fixed MINTIME window).
// Field names, columns and formulas follow z/OS RMF Report Analysis (SC34-2665, z/OS 2.5), ch. 2.
// Samples here are time-average concurrency (average number of users in each state), so RMF's
// group formulas ∑ samples ÷ (# samples × avg # address spaces) become state ÷ active users.

import { mergeWorkManager, noResources, reportedAccs, reportedTicks, workManagerStatePct, type WorkManagerSamples, type WorkManagerState } from '../sim/wlm/reporting';
import type { Scenario } from '../sim/core/scenario';
import { TICK_SEC } from '../sim/core/units';
import { capacityLossPct, msuPerCp } from '../sim/hw/cpc';
import { classify } from '../sim/wlm/classify';
import { jobShape } from '../sim/subsys/batch';
import { BUCKET_BOUNDS, goalText, velocityOf } from '../sim/wlm/goals';
import { ACC_DECAY, accPi, goalInfo, sumAcc, velDelay, velUsing, type ScpAcc } from '../sim/wlm/runtime';
import type { ScpTick } from '../sim/wlm/evaluate';
import { allWorkloads } from './workloads';
import type { RunState } from './types';

/** Steady-state normaliser: a decayed sum × (1 − d) is the per-tick average. */
const NORM = 1 - ACC_DECAY;

export interface Mon3Row {
  workManager?: WorkManagerSamples;
  resourceSamples?: boolean;
  system: string;
  scKey: string;
  serviceClass: string;
  /** 1-based period number, as RMF shows it in the T column. */
  period: number;
  goal: string;
  importance: number | null;
  /** SYSSUM goal columns: velocity goal, or response-time goal (ms) with percentile (null = AVG). */
  goalVelocity: number | null;
  goalRtMs: number | null;
  goalPct: number | null;
  /** Execution velocity, 0..100: Using ÷ (Using + Delay) (null when nothing was sampled). */
  velocity: number | null;
  /** SYSSUM Exec Vel Act: N/A (null) for transaction classes served by CICS regions. */
  velocityAct: number | null;
  /** Percentile goals: % of ended transactions within the goal time (SYSSUM Response Time Actual). */
  withinGoalPct: number | null;
  pi: number | null;
  endedPerSec: number;
  avgRtMs: number | null;
  /** CPU on general CPs (incl. zIIP-eligible work run on CPs) in engines: PROCU EAppl% CP ÷ 100. */
  cpuEngines: number;
  /** zIIP time (PROCU EAppl% IIP ÷ 100) and the zIIP-eligible part of cpuEngines (Time on CP % IIP). */
  ziipEngines: number;
  iipcpEngines: number;
  /** SYSINFO "Users ACT", "AVG USG" and "Average Number Delayed For" (average number of users). */
  avgUsers: { active: number; proc: number; dev: number; delayProc: number; delayDev: number; delayStor: number };
  /** DELAY report USG %, DLY % and UKN % as 0..1 of active samples.
   * APPROX: IDL %, SUB, OPR and ENQ are not modelled (the UI shows them blank or 0). */
  usingFrac: number;
  delayFrac: number;
  unknownFrac: number;
  /** % Delayed for, 0..1. The DELAY report shows PRC (cpu + ziip), DEV (io) and STR (stor); `cap` (WLM capping)
   * has no column and counts only in DLY %, so DLY % may exceed the column sum (p.109); `other` is the UKN state. */
  delay: { cpu: number; ziip: number; io: number; stor: number; cap: number; other: number };
  /** Resource with the largest delay above 2% (CAP = WLM capping), or null. */
  primaryDelay: Mon3DelayResource | null;
  /** DELAY "Primary Reason" in RMF's forms (p.110): the heaviest other processor user's jobname (or *ENCLAVE)
   * for PRC, the LCU for DEV, LOCL for STR, RG-Cap for capping. */
  primaryReason: string | null;
}

export type Mon3DelayResource = 'PRC' | 'DEV' | 'STR' | 'CAP';

export interface Mon3System {
  system: string;
  /** SYSINFO header. */
  cpsOnline: number;
  iipsOnline: number;
  /** Avg CPU Util%: LPAR view (dispatch time ÷ online time); Avg MVS Util%: z/OS view (not in wait). */
  cpBusyPct: number;
  mvsBusyPct: number;
  ziipBusyPct: number | null;
  /** Appl% (address spaces), EAppl% (plus enclaves), Appl% IIP; each ÷ logical processors. */
  applPct: number;
  eapplPct: number;
  applIipPct: number | null;
  msu: number;
  capped: boolean;
  /** Worst PI of goal-bearing periods on this system. */
  worstPi: number | null;
}

export interface Mon3Cpc {
  lparId: string;
  cpcId: string;
  kind: 'ZOS' | 'CF';
  /** CPC Capacity report columns. */
  msuDef: number | null;
  msuAct: number | null;
  procNum: number;
  logicalEffectPct: number;
  logicalTotalPct: number;
  physLparPct: number;
  physEffectPct: number;
  physTotalPct: number;
  /** Not CPC report fields: Partition Data (weight, polarity) and game-derived PR/SM figures. */
  weight: number;
  logical: number;
  polarity: string;
  busyPct: number;
  prsmDelayPct: number;
  overheadPct: number;
  cappedPct: number;
  /** 100 − SMF70CAI: capacity lost against the processor's normal setting (0 when not adjusted). */
  capacityAdjPct?: number;
}

/** CPC report header, for one partition (RMF shows it for the partition the reporter runs on). */
export interface Mon3CpcHeader {
  lparId: string;
  cpcId: string;
  cpcCapacityMsu: number;
  imageCapacityMsu: number;
  wlmCappingPct: number;
  r4haMsu: number;
  max4hMsu: number;
  group: string | null;
  groupLimitMsu: number | null;
}

export interface Mon3Enclave {
  workloadIds: string[];
  scKey: string;
  serviceClass: string;
  period: number;
  goal: string;
  endedPerSec: number;
  avgRtMs: number | null;
  pi: number | null;
  /** EAppl% ÷ 100 on CPs (incl. zIIP-eligible work run on CPs), and zIIP time. */
  cpEngines: number;
  ziipEngines: number;
  iipcpEngines: number;
  usingFrac: number;
  delayFrac: number;
  unknownFrac: number;
}

export interface Mon3Speed {
  system: string;
  name: string;
  activeUsers: number;
  /** Workflow %, 0..100 (null = No work). */
  speed: number | null;
  /** CICS/IMS transaction classes: the region classes whose samples gave the speed. */
  servedBy?: string[];
}

export interface Mon3Exception {
  severity: 'warn' | 'crit';
  /** WFEX Name / Reason / Critical val.; `text` is the "Possible cause or action". */
  where: string;
  reason: string;
  value: string;
  text: string;
}

/** SYSWKM "Address Spaces Serving this Service Class" row (RMF Report Analysis p.206–207). */
export interface Mon3Server {
  jobname: string;
  system: string;
  /** How WLM manages the region (Manage Region Using Goals Of). */
  mgmt: 'TRANSACTION' | 'REGION' | 'BOTH';
  /** The region's own service class, and the matching Monitor III row on its system (pin target). */
  serviceClass: string;
  rowKey: string | null;
  /** Share of the region's service given to the reported class, 0..100. */
  servicePct: number;
  velocity: number | null;
  procUsgPct: number;
  ioUsgPct: number;
  cappPct: number;
  /** Operator quiesce (RESET QUIESCE) is not modelled: always 0. */
  quiescePct: number;
}

/** SYSWKM Work Manager Delays report, sysplex-wide, for one CICS transaction class period (p.204–207). */
export interface Mon3Wkm {
  scKey: string;
  serviceClass: string;
  period: number;
  goal: string;
  avgRtMs: number | null;
  endedPerSec: number;
  pi: number | null;
  /** Response time breakdown, % of the EXE phase states. */
  states: { active: number; ready: number; idle: number | null; lock: number; io: number; conv: number | null; prod: number; misc: number };
  servers: Mon3Server[];
  /** Why this PI is report-only: the AORs run at the served class's DP in TRANSACTION mode. */
  note?: string;
}

export interface Mon3View {
  rangeSec: number;
  policy: string;
  systems: Mon3System[];
  rows: Mon3Row[];
  cpc: Mon3Cpc[];
  cpcHeaders: Mon3CpcHeader[];
  /** Shared z/OS logical CPs per physical CP, per CPC (the aggregate is logicalToPhysical). */
  logicalToPhysicalByCpc: Record<string, number>;
  logicalToPhysical: number;
  enclaves: Mon3Enclave[];
  speed: Mon3Speed[];
  exceptions: Mon3Exception[];
  /** SYSWKM: CICS transaction classes with work manager data (absent in old pin snapshots). */
  wkm?: Mon3Wkm[];
  /** PROCU: jobs using a processor, by descending EAppl % CP (absent in old pin snapshots). */
  procJobs?: Mon3ProcJob[];
}

/** One PROCU line (RMF Report Analysis p.188–189). Engines: the report's percentages ÷ 100. */
export interface Mon3ProcJob {
  system: string;
  jobname: string;
  /** Job class: S started task, B batch, T TSO. */
  cx: 'S' | 'B' | 'T';
  serviceClass: string;
  /** Time on CP % Total: TCB and SRB time of the address space, enclaves excluded. */
  cpEngines: number;
  /** Time on CP % IIP: zIIP-eligible work that ran on CPs (a subset of cpEngines). */
  iipcpEngines: number;
  /** EAppl % CP and IIP: enclave CPU included. */
  eapplCpEngines: number;
  eapplZiipEngines: number;
}

/** The resource behind DELAY's Primary Reason: the largest % Delayed for above 2%, capping included (p.110). */
export function primaryDelayOf(delay: Mon3Row['delay']): Mon3DelayResource | null {
  const by: [Mon3DelayResource, number][] = [
    ['PRC', delay.cpu + delay.ziip],
    ['DEV', delay.io],
    ['STR', delay.stor],
    ['CAP', delay.cap],
  ];
  return by.reduce<[Mon3DelayResource, number] | null>((best, x) => (x[1] > 0.02 && (!best || x[1] > best[1]) ? x : best), null)?.[0] ?? null;
}

type LastSplit = { usingCpu: number; usingZiip: number; usingIo: number; cpEngines: number; ziipEngines: number; iipcpEngines: number };
const noSplit = (): LastSplit => ({ usingCpu: 0, usingZiip: 0, usingIo: 0, cpEngines: 0, ziipEngines: 0, iipcpEngines: 0 });
function addSplit(o: LastSplit, t: ScpTick): void {
  o.usingCpu += t.usingCpu;
  o.usingZiip += t.usingZiip;
  o.usingIo += t.usingIo;
  o.cpEngines += t.cpEngines;
  o.ziipEngines += t.ziipEngines;
  o.iipcpEngines += t.iipcpEngines;
}
const ratio = (x: number, of: number) => (of > 1e-12 ? x / of : 0);

/** % of ended transactions within the goal time: buckets up to 100% of goal (SYSSUM). */
export function withinGoalPct(buckets: readonly number[]): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total <= 1e-9) return null;
  let within = 0;
  for (let i = 0; i < buckets.length && BUCKET_BOUNDS[i]! <= 1.0; i++) within += buckets[i]!;
  return (100 * within) / total;
}

function row(run: RunState, system: string, scKey: string, a: ScpAcc, last: LastSplit): Mon3Row {
  const def = run.sim.wlm.definition;
  const g = goalInfo(def, scKey);
  const per = g ? def.classes.find((c) => c.id === g.serviceClass)?.periods[g.period] : undefined;
  const hash = scKey.lastIndexOf('#');
  const serviceClass = hash >= 0 ? scKey.slice(0, hash) : scKey;
  const period = hash >= 0 ? Number(scKey.slice(hash + 1)) || 1 : 1;
  const delayCpu = a.delayCpu, delayZiip = a.delayZiip, delayIo = a.delayIo, delayCap = a.delayCap;
  // APPROX: initiation queue delay (WLMGL QMPL) has no Monitor III column here and shows in STOR.
  const delayStor = Math.max(0, a.delay - delayCpu - delayZiip - delayIo - delayCap);
  const samples = a.using + a.delay + a.delayOther;
  const frac = (x: number) => (samples > 0 ? x / samples : 0);
  const delay = { cpu: frac(delayCpu), ziip: frac(delayZiip), io: frac(delayIo), stor: frac(delayStor), cap: frac(delayCap), other: frac(a.delayOther) };
  const v = velocityOf(velUsing(a), velDelay(a));
  const goal = g?.goal;
  const rtGoal = goal && (goal.kind === 'AVG' || goal.kind === 'PCT');
  // APPROX: the smoothed accumulator keeps total Using and CP time only; split them by the last tick's mix.
  const usingAll = last.usingCpu + last.usingZiip + last.usingIo;
  const usingAvg = a.using * NORM;
  const cpuEngines = a.cpuEngines * NORM;
  const cpLast = last.cpEngines + last.iipcpEngines;
  return {
    ...(a.workManager ? { workManager: mergeWorkManager(a.workManager, undefined, NORM) } : {}),
    ...(a.workManager || a.moved ? { resourceSamples: !noResources(a) } : {}),
    system,
    scKey,
    serviceClass,
    period,
    goal: per ? goalText(per) : g ? 'DISCRETIONARY' : 'system',
    importance: g && g.goal.kind !== 'DISC' ? g.importance : null,
    goalVelocity: goal?.kind === 'VEL' ? goal.velocity : null,
    goalRtMs: rtGoal ? 1000 * goal.rtSec : null,
    goalPct: goal?.kind === 'PCT' ? goal.pct : null,
    velocity: v,
    // Exec Vel Act is N/A where subsystem delay data replace it (CICS/IMS transaction classes).
    velocityAct: a.workManager ? null : v,
    withinGoalPct: goal?.kind === 'PCT' ? withinGoalPct(a.buckets) : null,
    pi: g ? accPi(g.goal, a) : null,
    endedPerSec: (a.completions * NORM) / TICK_SEC,
    avgRtMs: a.completions > 0 ? (1000 * a.rtSumSec) / a.completions : null,
    cpuEngines,
    ziipEngines: cpuEngines * ratio(last.ziipEngines, cpLast),
    iipcpEngines: cpuEngines * ratio(last.iipcpEngines, cpLast),
    avgUsers: {
      active: samples * NORM,
      proc: usingAvg * ratio(last.usingCpu + last.usingZiip, usingAll),
      dev: usingAvg * ratio(last.usingIo, usingAll),
      delayProc: (delayCpu + delayZiip) * NORM,
      delayDev: delayIo * NORM,
      delayStor: delayStor * NORM,
    },
    usingFrac: frac(a.using),
    // DLY % covers every delay state, capping included, but not the unknown (UKN) state.
    delayFrac: frac(a.delay),
    unknownFrac: frac(a.delayOther),
    delay,
    primaryDelay: primaryDelayOf(delay),
    primaryReason: null,
  };
}

export function buildMon3(run: RunState, scenario: Scenario): Mon3View {
  const sim = run.sim;
  const def = sim.wlm.definition;
  const workloads = allWorkloads(scenario, run);
  const ddfClasses = new Set(workloads.filter((w) => w.subsystem === 'DDF').map((w) => classify(def, w.work).serviceClass));
  const lastBy = (lparId: string | null, scKey: string): LastSplit => {
    const o = noSplit();
    for (const l of sim.last.lpars) if (lparId === null || l.lparId === lparId) for (const t of reportedTicks(l.scps, l.cics, false, l.iipcpReported ?? true)) if (t.scKey === scKey) addSplit(o, t);
    return o;
  };
  // CICS transaction samples shown with the region classes, as in WLMGL (reporting.ts).
  const reported = Object.fromEntries(
    sim.wlm.systems.map((s) => [s.lparId, reportedAccs(Object.fromEntries(s.scps.map((p) => [p.scKey, p.acc])), sim.last.lpars.find((l) => l.lparId === s.lparId)?.cics)]),
  );
  const rows: Mon3Row[] = [];
  for (const s of sim.wlm.systems) for (const p of s.scps) rows.push(row(run, s.lparId, p.scKey, reported[s.lparId]![p.scKey]!, lastBy(s.lparId, p.scKey)));
  // Sysplex rows, like Monitor III's sysplex-wide SYSSUM.
  const keys = [...new Set(rows.map((r) => r.scKey))].sort();
  for (const k of keys)
    rows.push(row(run, '*PLEX', k, sumAcc(sim.wlm.systems.flatMap((s) => (reported[s.lparId]![k] ? [reported[s.lparId]![k]!] : []))), lastBy(null, k)));
  primaryReasons(run, scenario, rows, ddfClasses);
  const procJobs = procuJobs(run, scenario, rows, ddfClasses);

  const cpcEngines = sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  let totalLogical = 0;
  const logicalByCpc: Record<string, number> = {};
  const cpc: Mon3Cpc[] = sim.config.lpars.map((l) => {
    const poolId = l.kind === 'CF' ? 'ICF' : 'CP';
    const cfg = l.pools.find((p) => p.pool === poolId);
    const rt = sim.lpars.find((x) => x.id === l.id)?.pools.find((p) => p.pool === poolId);
    const box = sim.config.cpcs.find((c) => c.id === l.cpcId);
    const phys = box?.engines[poolId] ?? 0;
    if (l.kind === 'ZOS' && cfg && !cfg.dedicated) {
      totalLogical += cfg.logical;
      logicalByCpc[l.cpcId] = (logicalByCpc[l.cpcId] ?? 0) + cfg.logical;
    }
    const total = rt?.deliveredEngines ?? 0;
    // Effective dispatch excludes LPAR management time (RMF Report Analysis, CPC report).
    const effect = total * (1 - (rt?.overheadFrac ?? 0));
    const logical = cfg?.logical ?? 0;
    return {
      lparId: l.id,
      cpcId: l.cpcId,
      kind: l.kind,
      msuDef: l.kind === 'ZOS' ? l.definedCapacityMsu : null,
      msuAct: l.kind === 'ZOS' && box ? effect * msuPerCp(box) : null,
      procNum: logical,
      logicalEffectPct: logical > 0 ? (100 * effect) / logical : 0,
      logicalTotalPct: logical > 0 ? (100 * total) / logical : 0,
      physLparPct: phys > 0 ? (100 * (total - effect)) / phys : 0,
      physEffectPct: phys > 0 ? (100 * effect) / phys : 0,
      physTotalPct: phys > 0 ? (100 * total) / phys : 0,
      weight: cfg?.weight ?? 0,
      logical,
      polarity: rt && l.hiperDispatch ? `${rt.vh}VH ${rt.vm}VM ${rt.vl}VL` : cfg?.dedicated ? 'DED' : 'SHARED',
      busyPct: logical > 0 ? (100 * total) / logical : 0,
      capacityAdjPct: box ? capacityLossPct(box) : 0,
      prsmDelayPct: 100 * (rt?.prsmDelayFrac ?? 0),
      overheadPct: 100 * (rt?.overheadFrac ?? 0),
      cappedPct: 100 * (rt?.cappedFrac ?? 0),
    };
  });

  const cpcHeaders: Mon3CpcHeader[] = sim.config.lpars
    .filter((l) => l.kind === 'ZOS')
    .map((l) => {
      const box = sim.config.cpcs.find((c) => c.id === l.cpcId)!;
      const msuCp = msuPerCp(box);
      const cp = l.pools.find((p) => p.pool === 'CP');
      const r4 = sim.capping.lpars.find((x) => x.id === l.id);
      const grp = l.capacityGroup ? sim.config.capacityGroups.find((g) => g.id === l.capacityGroup) : undefined;
      // Image Capacity: the lowest of logical-CP capacity, defined capacity and the group limit.
      const limits = [(cp ? cp.logical + cp.reserved : 0) * msuCp, l.definedCapacityMsu ?? Infinity, grp?.limitMsu ?? Infinity];
      if (cp?.absoluteCapEngines != null) limits.push(cp.absoluteCapEngines * msuCp);
      return {
        lparId: l.id,
        cpcId: l.cpcId,
        cpcCapacityMsu: box.engines.CP * msuCp,
        imageCapacityMsu: Math.min(...limits),
        wlmCappingPct: 100 * (sim.lpars.find((x) => x.id === l.id)?.pools.find((p) => p.pool === 'CP')?.softCappedFrac ?? 0),
        r4haMsu: r4?.r4ha ?? 0,
        max4hMsu: r4 ? Math.max(0, ...r4.slots) : 0,
        group: grp?.id ?? null,
        groupLimitMsu: grp?.limitMsu ?? null,
      };
    });

  const systems: Mon3System[] = sim.config.lpars
    .filter((l) => l.kind === 'ZOS')
    .map((l) => {
      const rt = sim.lpars.find((x) => x.id === l.id);
      const cp = rt?.pools.find((p) => p.pool === 'CP');
      const zi = rt?.pools.find((p) => p.pool === 'ZIIP');
      const cfgCp = l.pools.find((p) => p.pool === 'CP');
      const cfgZi = l.pools.find((p) => p.pool === 'ZIIP');
      const mine = rows.filter((r) => r.system === l.id);
      const pis = mine.filter((r) => r.importance !== null && r.pi !== null).map((r) => r.pi!);
      const lcp = cfgCp?.logical ?? 0;
      const lzi = cfgZi?.logical ?? 0;
      const lparBusy = cp && lcp > 0 ? cp.deliveredEngines / lcp : 0;
      const eappl = mine.reduce((a, r) => a + r.cpuEngines, 0);
      const enclaveCp = mine.filter((r) => ddfClasses.has(r.serviceClass)).reduce((a, r) => a + r.cpuEngines, 0);
      return {
        system: l.id,
        cpsOnline: lcp,
        iipsOnline: lzi,
        cpBusyPct: 100 * lparBusy,
        // Ready-but-undispatched logical CPs are busy to z/OS (RMF Report Analysis 3.1 p.389).
        mvsBusyPct: 100 * (cp?.mvsBusyFrac ?? lparBusy),
        ziipBusyPct: zi && lzi > 0 ? (100 * zi.deliveredEngines) / lzi : null,
        applPct: lcp > 0 ? (100 * (eappl - enclaveCp)) / lcp : 0,
        eapplPct: lcp > 0 ? (100 * eappl) / lcp : 0,
        applIipPct: lzi > 0 ? (100 * mine.reduce((a, r) => a + r.ziipEngines, 0)) / lzi : null,
        msu: rt?.msuRate ?? 0,
        capped: sim.capping.lpars.find((x) => x.id === l.id)?.capped ?? false,
        worstPi: pis.length ? Math.max(...pis) : null,
      };
    });

  // ENCLAVE: DDF work is managed as enclaves; one line per service-class period, naming the DDF
  // workloads classified there (RMF lists individual enclaves; the sim models them as a fluid).
  const enclaves: Mon3Enclave[] = [];
  const ddfBySc = new Map<string, string[]>();
  for (const w of workloads) {
    if (w.subsystem !== 'DDF') continue;
    const sc = classify(def, w.work).serviceClass;
    ddfBySc.set(sc, [...(ddfBySc.get(sc) ?? []), w.id]);
  }
  for (const sc of [...ddfBySc.keys()].sort()) {
    for (const r of rows.filter((x) => x.system === '*PLEX' && x.serviceClass === sc)) {
      enclaves.push({
        workloadIds: ddfBySc.get(sc)!,
        scKey: r.scKey,
        serviceClass: r.serviceClass,
        period: r.period,
        goal: r.goal,
        endedPerSec: r.endedPerSec,
        avgRtMs: r.avgRtMs,
        pi: r.pi,
        cpEngines: r.cpuEngines,
        ziipEngines: r.ziipEngines,
        iipcpEngines: r.iipcpEngines,
        usingFrac: r.usingFrac,
        delayFrac: r.delayFrac,
        unknownFrac: r.unknownFrac,
      });
    }
  }

  return {
    rangeSec: Math.round(TICK_SEC / NORM),
    policy: def.policyName,
    systems,
    rows,
    cpc,
    cpcHeaders,
    logicalToPhysicalByCpc: Object.fromEntries(sim.config.cpcs.map((c) => [c.id, c.engines.CP > 0 ? (logicalByCpc[c.id] ?? 0) / c.engines.CP : 0])),
    logicalToPhysical: cpcEngines > 0 ? totalLogical / cpcEngines : 0,
    enclaves,
    wkm: wkmSection(run, scenario, rows),
    procJobs,
    speed: speedSection(rows, systems),
    exceptions: exceptions(run, rows, systems, cpc, totalLogical, cpcEngines),
  };
}

interface ClassUnit {
  name: string;
  cx: 'S' | 'B';
  engines: number;
}

const byEngines = (cands: ClassUnit[]): ClassUnit[] => cands.sort((a, b) => b.engines - a.engines || (a.name < b.name ? -1 : 1));

/** The address spaces and running batch jobs of a service class on one system, each with its estimated CP engines:
 * a space's base load (transaction servers also share the row's CPU not explained by the others, i.e. their hosted
 * transactions), a job its unconstrained CP rate times its last pace. APPROX: estimates, not per-job measurements
 * (the sim keeps class totals). */
function classUnitsOf(run: RunState, scenario: Scenario): (system: string, serviceClass: string, rowCpu: number) => ClassUnit[] {
  const sim = run.sim;
  const def = sim.wlm.definition;
  const spaces = [...scenario.addressSpaces, ...sim.extraAddressSpaces];
  const seqRtSec = sim.env.dasd?.classes?.SEQ?.rtSec ?? 0;
  const hostRoles = new Set(allWorkloads(scenario, run).map((w) => w.hostRole).filter((r): r is string => !!r));
  return (system, serviceClass, rowCpu) => {
    const own = spaces.filter((a) => a.lparId === system && classify(def, { subsystem: a.subsystem, TN: a.jobname, SY: system }).serviceClass === serviceClass);
    const jobs = sim.batch.jobs.filter(
      (j) => j.status === 'RUNNING' && j.lparId === system && classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: system }).serviceClass === serviceClass,
    );
    const cands = [
      ...own.map((a) => ({ name: a.jobname, cx: 'S' as const, engines: a.baseEnginesRef, server: a.role !== null && hostRoles.has(a.role) })),
      ...jobs.map((j) => ({ name: j.def.name, cx: 'B' as const, engines: jobShape(j.def, 1, 1, seqRtSec).cpRate * (j.cpPace ?? 1), server: false })),
    ];
    const servers = cands.filter((c) => c.server);
    const rest = Math.max(0, rowCpu - cands.reduce((a, c) => a + c.engines, 0));
    for (const c of servers) c.engines += rest / servers.length;
    return cands.map(({ name, cx, engines }) => ({ name, cx, engines }));
  };
}

/** PROCU lists jobs, not classes (RMF Report Analysis p.188): each system row's CPU is shared among the class's
 * address spaces and running batch jobs in proportion to their estimated engines (classUnitsOf); TSO classes show
 * under their user id. DDF enclave CPU counts in the EAppl % of the Db2 DIST address space and not in its Time on
 * CP % (p.189). Transaction classes carry no CPU of their own: it is in their regions' rows. APPROX: shares, not
 * per-job measurements. */
function procuJobs(run: RunState, scenario: Scenario, rows: Mon3Row[], ddfClasses: ReadonlySet<string>): Mon3ProcJob[] {
  const def = run.sim.wlm.definition;
  const spaces = [...scenario.addressSpaces, ...run.sim.extraAddressSpaces];
  const workloads = allWorkloads(scenario, run);
  const units = classUnitsOf(run, scenario);
  const out = new Map<string, Mon3ProcJob>();
  const add = (system: string, jobname: string, cx: Mon3ProcJob['cx'], serviceClass: string, cp: number, iipcp: number, eCp: number, eZiip: number) => {
    const k = `${system}|${jobname}`;
    const j = out.get(k) ?? { system, jobname, cx, serviceClass, cpEngines: 0, iipcpEngines: 0, eapplCpEngines: 0, eapplZiipEngines: 0 };
    j.cpEngines += cp;
    j.iipcpEngines += iipcp;
    j.eapplCpEngines += eCp;
    j.eapplZiipEngines += eZiip;
    out.set(k, j);
  };
  for (const r of rows) {
    if (r.system === '*PLEX' || r.cpuEngines + r.ziipEngines <= 1e-6) continue;
    if (ddfClasses.has(r.serviceClass)) {
      const dist = spaces.find((a) => a.lparId === r.system && a.role === 'DB2.DIST');
      if (dist) add(r.system, dist.jobname, 'S', classify(def, { subsystem: dist.subsystem, TN: dist.jobname, SY: r.system }).serviceClass, 0, 0, r.cpuEngines, r.ziipEngines);
      continue;
    }
    const cands = units(r.system, r.serviceClass, r.cpuEngines);
    const total = cands.reduce((a, c) => a + c.engines, 0);
    if (cands.length > 0) {
      for (const c of cands) {
        const f = total > 0 ? c.engines / total : 1 / cands.length;
        add(r.system, c.name, c.cx, r.serviceClass, r.cpuEngines * f, r.iipcpEngines * f, r.cpuEngines * f, r.ziipEngines * f);
      }
      continue;
    }
    const tso = workloads.find((w) => w.work.UI && classify(def, { ...w.work, SY: r.system }).serviceClass === r.serviceClass);
    add(r.system, tso?.work.UI ?? `*${r.serviceClass}`, tso ? 'T' : 'S', r.serviceClass, r.cpuEngines, r.iipcpEngines, r.cpuEngines, r.ziipEngines);
  }
  return [...out.values()].sort((a, b) => b.eapplCpEngines - a.eapplCpEngines || (a.system + a.jobname < b.system + b.jobname ? -1 : 1));
}

/** DELAY Primary Reason (RMF Report Analysis Table 20, p.110), filled in once all rows exist.
 * APPROX: rows are service-class period summaries, not jobs, so PRC names the main address space of the
 * class that used that processor most. The row's own class competes with the share of its other units (n − 1 of
 * n running jobs or address spaces): "the job that used the processor most while the reported job was delayed"
 * is often another job of the same class, e.g. batch behind batch (p.110). DEV the LCU with the slowest response time in
 * the DASD report (real RMF gives the volser), and STR is always LOCL (the sim models paging only). */
function primaryReasons(run: RunState, scenario: Scenario, rows: Mon3Row[], ddfClasses: ReadonlySet<string>): void {
  const sim = run.sim;
  const def = sim.wlm.definition;
  const lcus = sim.env.dasd?.lcus ?? [];
  const worstLcu = lcus.reduce<(typeof lcus)[number] | null>((w, l) => (!w || l.rtSec > w.rtSec ? l : w), null);
  const spaces = [...scenario.addressSpaces, ...sim.extraAddressSpaces];
  const workloads = allWorkloads(scenario, run);
  const names = new Map<string, string | null>();
  const units = classUnitsOf(run, scenario);
  // The jobname RMF would show for a class's heaviest processor user on one system. Transaction classes name
  // their host (CICS AOR) or TSO user; otherwise the class's address spaces and running batch jobs compete by
  // estimated CP engines (classUnitsOf).
  const jobOf = (system: string, serviceClass: string, rowCpu: number): string | null => {
    const k = `${system}|${serviceClass}`;
    if (names.has(k)) return names.get(k)!;
    let name: string | null = null;
    if (ddfClasses.has(serviceClass)) name = '*ENCLAVE';
    for (const w of workloads) {
      if (name) break;
      if (classify(def, { ...w.work, SY: system }).serviceClass !== serviceClass) continue;
      // CICS transactions run in the AORs; TSO users show under their user id.
      if (w.hostRole) name = spaces.filter((a) => a.lparId === system && a.role === w.hostRole).map((a) => a.jobname).sort()[0] ?? null;
      else if (w.work.UI) name = w.work.UI;
    }
    if (!name) name = byEngines(units(system, serviceClass, rowCpu))[0]?.name ?? null;
    names.set(k, name);
    return name;
  };
  // Running jobs and address spaces of a class on one system: the units another job of the same class can be.
  const unitsOf = (system: string, serviceClass: string): number => {
    if (ddfClasses.has(serviceClass)) return Infinity;
    const jobs = sim.batch.jobs.filter(
      (j) => j.status === 'RUNNING' && j.lparId === system && classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: system }).serviceClass === serviceClass,
    ).length;
    const own = spaces.filter((a) => a.lparId === system && classify(def, { subsystem: a.subsystem, TN: a.jobname, SY: system }).serviceClass === serviceClass).length;
    return jobs + own;
  };
  for (const r of rows) {
    if (r.primaryDelay === 'CAP') r.primaryReason = 'RG-Cap';
    else if (r.primaryDelay === 'DEV') r.primaryReason = worstLcu ? `LCU ${worstLcu.id}` : null;
    else if (r.primaryDelay === 'STR') r.primaryReason = 'LOCL';
    else if (r.primaryDelay === 'PRC') {
      const use = r.delay.ziip > r.delay.cpu ? (x: Mon3Row) => x.ziipEngines : (x: Mon3Row) => x.cpuEngines;
      const others = (x: Mon3Row): number => {
        if (x.scKey !== r.scKey) return use(x);
        const n = unitsOf(x.system, x.serviceClass);
        return n > 1 ? (use(x) * (n === Infinity ? 1 : n - 1)) / (n === Infinity ? 1 : n) : 0;
      };
      const top = rows
        .filter((x) => x.system !== '*PLEX' && (r.system === '*PLEX' || x.system === r.system) && others(x) > 1e-6)
        .reduce<Mon3Row | null>((b, x) => (!b || others(x) > others(b) ? x : b), null);
      r.primaryReason = top ? jobOf(top.system, top.serviceClass, top.cpuEngines) : null;
    }
  }
}

/** WFEX Speed section: workflow of *SYSTEM, *PROC, *DEV and each service class, per system. */
function speedSection(rows: Mon3Row[], systems: Mon3System[]): Mon3Speed[] {
  const out: Mon3Speed[] = [];
  for (const s of systems) {
    const mine = rows.filter((r) => r.system === s.system);
    const sum = (f: (r: Mon3Row) => number) => mine.reduce((a, r) => a + f(r), 0);
    const wf = (using: number, delayed: number) => (using + delayed > 1e-9 ? (100 * using) / (using + delayed) : null);
    const u = sum((r) => r.avgUsers.proc + r.avgUsers.dev);
    const d = sum((r) => r.avgUsers.delayProc + r.avgUsers.delayDev + r.avgUsers.delayStor);
    out.push({ system: s.system, name: '*SYSTEM', activeUsers: sum((r) => r.avgUsers.active), speed: wf(u, d) });
    // Resource workflow: using ÷ (using + delayed) for that resource (Report Analysis, "Resource workflow").
    out.push({ system: s.system, name: '*PROC', activeUsers: sum((r) => r.avgUsers.proc + r.avgUsers.delayProc), speed: wf(sum((r) => r.avgUsers.proc), sum((r) => r.avgUsers.delayProc)) });
    out.push({ system: s.system, name: '*DEV', activeUsers: sum((r) => r.avgUsers.dev + r.avgUsers.delayDev), speed: wf(sum((r) => r.avgUsers.dev), sum((r) => r.avgUsers.delayDev)) });
    for (const r of mine) {
      if (r.importance === null) continue;
      if (r.workManager && r.resourceSamples === false) {
        // Workflow is a state-sampling measure of address spaces (erbb500 v3r1 p.147, p.255) and a transaction class
        // owns none: its samples are the serving regions' (#147). RMF shows the serving address spaces' using and
        // velocity for such a class (SYSWKM; SG24-6645 p.277–278). APPROX: WFEX itself is undocumented for this
        // case; show the regions' workflow, since "No work" would read as idle while transactions run.
        const regions = mine.filter((x) => r.workManager!.regionKeys.includes(x.scKey));
        const add = (f: (x: Mon3Row) => number) => regions.reduce((a, x) => a + f(x), 0);
        const speed = wf(add((x) => x.avgUsers.proc + x.avgUsers.dev), add((x) => x.avgUsers.delayProc + x.avgUsers.delayDev + x.avgUsers.delayStor));
        out.push({ system: s.system, name: r.scKey, activeUsers: add((x) => x.avgUsers.active), speed, servedBy: regions.map((x) => x.scKey) });
      } else out.push({ system: s.system, name: r.scKey, activeUsers: r.avgUsers.active, speed: r.velocity });
    }
  }
  return out;
}

// FICTIONAL thresholds, in the spirit of a WFEX criteria set a site would configure.
const WFEX = { piWarn: 1.5, piCrit: 2, prsmDelayPct: 10, outsideFrac: 0.2, qrFrac: 0.2, ltoP: 2 };

function exceptions(run: RunState, rows: Mon3Row[], systems: Mon3System[], cpc: Mon3Cpc[], totalLogical: number, cpcEngines: number): Mon3Exception[] {
  const out: Mon3Exception[] = [];
  for (const r of rows) {
    if (r.system === '*PLEX' || r.importance === null || r.pi === null || r.pi < WFEX.piWarn) continue;
    // WFEX has no PI criterion: a site sets RT (response time) or WFL% thresholds from the goal.
    const pct = r.goalPct !== null;
    const rt = r.goalRtMs !== null;
    const reason = pct
      ? `RT${r.goalPct}% > ${(WFEX.piWarn * r.goalRtMs!).toFixed(0)}ms`
      : rt
        ? `RT > ${(WFEX.piWarn * r.goalRtMs!).toFixed(0)}ms`
        : `WFL% < ${(r.goalVelocity! / WFEX.piWarn).toFixed(0)}`;
    const value = pct
      ? `${r.withinGoalPct === null ? '-' : r.withinGoalPct.toFixed(0)}% in goal`
      : rt
        ? `${r.avgRtMs === null ? '-' : r.avgRtMs.toFixed(0)} ms`
        : `${r.velocity === null ? '-' : r.velocity.toFixed(0)} %`;
    out.push({
      severity: r.pi >= WFEX.piCrit ? 'crit' : 'warn',
      where: `${r.system} ${r.scKey}`,
      reason,
      value,
      text: `PI ${r.pi.toFixed(2)} (imp ${r.importance})${r.primaryDelay ? `, main delay ${r.primaryDelay}${r.primaryReason ? ` (${r.primaryReason})` : ''}` : r.unknownFrac > 0.3 ? ', mostly UKN (servers, subsystems)' : ''}`,
    });
  }
  for (const s of systems) if (s.capped) out.push({ severity: 'crit', where: s.system, reason: 'CAPPED', value: `${s.msu.toFixed(0)} MSU`, text: 'Soft capped: R4HA above defined/group capacity' });
  for (const c of cpc)
    if (c.kind === 'ZOS' && c.prsmDelayPct > WFEX.prsmDelayPct)
      out.push({ severity: 'warn', where: c.lparId, reason: 'PR/SM DELAY', value: `${c.prsmDelayPct.toFixed(0)} %`, text: 'Logical CPs wait for physical engines (short engines); MVS Util% above CPU Util%' });
  if (cpcEngines > 0 && totalLogical / cpcEngines > WFEX.ltoP)
    out.push({ severity: 'warn', where: 'CPC', reason: 'LOG:PHYS > 2', value: `${totalLogical}:${cpcEngines}`, text: 'Logical:physical above 2:1' });
  for (const w of run.sim.last.workloads) {
    if (w.completions <= 0) continue;
    const rt = w.rtSumSec / w.completions;
    if (rt <= 0) continue;
    const outside = (w.parts.outside ?? 0) / w.completions;
    const qr = (w.parts.qr ?? 0) / w.completions;
    if (outside / rt > WFEX.outsideFrac)
      out.push({ severity: 'crit', where: w.id, reason: 'QUEUED', value: `${((100 * outside) / rt).toFixed(0)} %`, text: `${((100 * outside) / rt).toFixed(0)}% of response time queued for a thread or task slot (MXT/MAXDBAT)` });
    if (qr / rt > WFEX.qrFrac)
      out.push({ severity: 'warn', where: w.id, reason: 'QR TCB', value: `${((100 * qr) / rt).toFixed(0)} %`, text: `${((100 * qr) / rt).toFixed(0)}% of response time waiting for the CICS QR TCB` });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.where.localeCompare(b.where) : a.severity === 'crit' ? -1 : 1));
}

const BTLNK_TEXT: Record<string, string> = {
  CPU: 'waiting for a general CP',
  ZIIP: 'waiting for a zIIP',
  IO: 'waiting for I/O',
  STORAGE: 'delayed by paging or swapping',
  QUEUE: 'queued for an initiator or MPL slot',
  // Logs in saves from before WT-10, when waits and capping were bottlenecks.
  CAP: 'held back by capping',
  OTHER: 'waiting on a server or subsystem',
};

/** Plain-English reading of one WLM activity-log line ("why did ONLHI move?"). */
export function explainWlmLog(line: string): string {
  const head = /(\S+) RCVR=(\S+)(?: \(regions (\S+)\))? PI=([\d.]+) BTLNK=(\S+) (.*)$/.exec(line);
  if (head) {
    const [, sys, rcvr, server, pi, btl, action] = head as unknown as [string, string, string, string | undefined, string, string, string];
    // A served CICS class is helped through its regions' server period (WT-09), so the moves name that period.
    const regions = server
      ? ` Its transactions run in CICS regions that WLM manages as server period ${server}, so WLM moves that period, and every transaction class those regions serve moves with it.`
      : '';
    const why = `On ${sys}, ${rcvr} was the most important period missing its goal (PI ${pi}, mostly ${BTLNK_TEXT[btl] ?? btl}).${regions}`;
    const plan = [...action.matchAll(/(?:^|; )(UP|CARRY|DONOR) (\S+) DP (\w+)→(\w+)(?: \(above (\S+)\))?/g)];
    if (plan.length) {
      const steps = plan.map(([, kind, key, from, to, above]) => {
        const role = kind === 'CARRY' ? `carried secondary receiver ${key}` : kind === 'DONOR' ? `lowered donor ${key}` : `raised ${key}`;
        return above ? `${role} above ${above} (stored DP ${to})` : `${role} from DP ${from} to ${to}`;
      });
      return `${why} WLM committed one plan: ${steps.join('; ')}. The complete plan gave the receiver enough improvement while passing the net-value checks.`;
    }
    const donor = /^DONOR (\S+) DP (\w+)→(\w+)/.exec(action);
    if (donor) return `${why} WLM lowered donor ${donor[1]} from DP ${donor[2]} to ${donor[3]} so the receiver gets the CPU first.`;
    const up = /DP (\w+)→(\w+)/.exec(action);
    if (up) return `${why} WLM raised its dispatch priority from ${up[1]} to ${up[2]}; the projection said the receiver gains more than donors lose.`;
    return why;
  }
  const prot = /(\S+) CPU PROTECTION (.*)$/.exec(line);
  if (prot)
    return `On ${prot[1]}, less important work held a dispatch priority equal to or above a CPU-protected period (CPU Critical or IEAOPT CCIMP), so WLM lowered it: ${prot[2]}. CPU protection is enforced before WLM helps any receiver.`;
  const waiting = /(\S+) (\S+) PI=([\d.]+) mostly waiting, CPU delay (\d+) %: not WLM-fixable/.exec(line);
  if (waiting)
    return `On ${waiting[1]}, ${waiting[2]} misses its goal (PI ${waiting[3]}) but spends most of its time waiting on a server, lock or subsystem, not in a delay WLM manages (CPU delay only ${waiting[4]} % of its samples): dispatching priority can't fix that, so WLM leaves it. Look at what it waits for (DELAY, ENCLAVE, the server's own class).`;
  const notFix = /(\S+) (\S+) PI=([\d.]+) BTLNK=(\S+) not WLM-fixable/.exec(line);
  if (notFix)
    return `On ${notFix[1]}, ${notFix[2]} misses its goal (PI ${notFix[3]}) but is mostly ${BTLNK_TEXT[notFix[4]!] ?? notFix[4]}: dispatching priority can't fix that, so WLM skips it. Look at the delay's real cause.`;
  const noNet = /(\S+) (\S+) PI=([\d.]+) BTLNK=(\S+) no action with net value(?: \((.+) rejected: (.+)\))?/.exec(line);
  if (noNet) {
    const tried = noNet[5] ? ` First move tried: ${noNet[5]}, rejected ${noNet[6]}.` : '';
    return `On ${noNet[1]}, ${noNet[2]} misses its goal (PI ${noNet[3]}) but WLM found no complete plan with enough receiver improvement that passed the net-value checks.${tried}`;
  }
  return line;
}

/**
 * SYSWKM per CICS transaction class: its response time breakdown and the AORs serving it. The sim models CICS work per
 * workload and system, not per region, so the AORs on one system share that system's CICS samples equally (APPROX, as
 * in the WLMGL attribution). Their samples are WLM's own view of the transactions (the management accumulators), split
 * by the class's share of the system's CICS CPU for Service %.
 */
function wkmSection(run: RunState, scenario: Scenario, rows: readonly Mon3Row[]): Mon3Wkm[] {
  const sim = run.sim;
  const def = sim.wlm.definition;
  const plex = rows.filter((r) => r.system === '*PLEX' && r.workManager);
  if (plex.length === 0) return [];
  const cicsKeys = new Set(plex.map((r) => r.scKey));
  const aors = [...scenario.addressSpaces, ...sim.extraAddressSpaces].filter((a) => a.role === 'CICS.AOR');
  // Per system: CICS samples (WLM's view) summed over the transaction classes, and each class's CPU.
  const bySys: Record<string, { acc: ScpAcc; cpuByKey: Record<string, number>; cpu: number }> = {};
  for (const s of sim.wlm.systems) {
    const accs = s.scps.filter((p) => cicsKeys.has(p.scKey));
    if (accs.length === 0) continue;
    const cpuByKey: Record<string, number> = {};
    let cpu = 0;
    for (const p of accs) {
      cpuByKey[p.scKey] = (cpuByKey[p.scKey] ?? 0) + p.acc.cpuEngines;
      cpu += p.acc.cpuEngines;
    }
    bySys[s.lparId] = { acc: sumAcc(accs.map((p) => p.acc)), cpuByKey, cpu };
  }
  const servers = (scKey: string): Mon3Server[] => {
    const out: Mon3Server[] = [];
    for (const a of aors) {
      const sys = bySys[a.lparId];
      if (!sys || sys.cpuByKey[scKey] === undefined) continue;
      const cls = classify(def, { subsystem: a.subsystem, TN: a.jobname, SY: a.lparId });
      const acc = sys.acc;
      const samples = acc.using + acc.delay + acc.delayOther;
      const last = { usingCpu: 0, usingZiip: 0, usingIo: 0 };
      for (const l of sim.last.lpars) if (l.lparId === a.lparId) for (const t of l.scps) if (cicsKeys.has(t.scKey)) {
        last.usingCpu += t.usingCpu;
        last.usingZiip += t.usingZiip;
        last.usingIo += t.usingIo;
      }
      const usingAll = last.usingCpu + last.usingZiip + last.usingIo;
      const usingFrac = samples > 0 ? acc.using / samples : 0;
      out.push({
        jobname: a.jobname,
        system: a.lparId,
        mgmt: cls.regionMode ?? def.cicsRegionMode ?? 'TRANSACTION',
        serviceClass: cls.serviceClass,
        rowKey: rows.find((r) => r.system === a.lparId && r.serviceClass === cls.serviceClass)?.scKey ?? null,
        servicePct: sys.cpu > 1e-12 ? (100 * sys.cpuByKey[scKey]!) / sys.cpu : 100 / Math.max(1, Object.keys(sys.cpuByKey).length),
        velocity: velocityOf(velUsing(acc), velDelay(acc)),
        procUsgPct: 100 * usingFrac * ratio(last.usingCpu + last.usingZiip, usingAll),
        ioUsgPct: 100 * usingFrac * ratio(last.usingIo, usingAll),
        cappPct: samples > 0 ? (100 * acc.delayCap) / samples : 0,
        quiescePct: 0,
      });
    }
    return out.sort((x, y) => (x.system !== y.system ? (x.system < y.system ? -1 : 1) : x.jobname < y.jobname ? -1 : x.jobname > y.jobname ? 1 : 0));
  };
  return plex.map((r) => {
    const w = r.workManager!;
    const srv = servers(r.scKey);
    // The report's column and the RCA pin read this one helper (RT-11); a row with no samples shows 0.
    const pct = (state: WorkManagerState) => workManagerStatePct(w, state) ?? 0;
    return {
      scKey: r.scKey,
      serviceClass: r.serviceClass,
      period: r.period,
      goal: r.goal,
      avgRtMs: r.avgRtMs,
      endedPerSec: r.endedPerSec,
      pi: r.pi,
      states: { active: pct('active'), ready: pct('ready'), idle: null, lock: pct('lock'), io: pct('io'), conv: null, prod: pct('prod'), misc: pct('misc') },
      servers: srv,
      ...(w.managedToTxn
        ? { note: "The AORs serving this class are managed to its goal (TRANSACTION mode); their region class's own goal is not used (WLM Planning p.120, p.122)." }
        : {}),
    };
  });
}
