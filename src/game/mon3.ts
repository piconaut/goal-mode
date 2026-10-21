// RMF Monitor III style live views (SPEC §8 tier 1), built from WLM's smoothed per-period
// accumulators. ACC_DECAY 0.85 per 10 s tick weights roughly the last minute or two, close to
// Monitor III's default 100 s range (APPROX: exponential rather than a fixed MINTIME window).
// Field names, columns and formulas follow z/OS RMF Report Analysis (SC34-2665, z/OS 2.5), ch. 2.
// Samples here are time-average concurrency (average number of users in each state), so RMF's
// group formulas ∑ samples ÷ (# samples × avg # address spaces) become state ÷ active users.

import type { Scenario } from '../sim/core/scenario';
import { TICK_SEC } from '../sim/core/units';
import { msuPerCp } from '../sim/hw/cpc';
import { classify } from '../sim/wlm/classify';
import { BUCKET_BOUNDS, goalText, velocityOf } from '../sim/wlm/goals';
import { ACC_DECAY, accPi, goalInfo, sumAcc, type ScpAcc } from '../sim/wlm/runtime';
import type { ScpTick } from '../sim/wlm/evaluate';
import { allWorkloads } from './workloads';
import type { RunState } from './types';

/** Steady-state normaliser: a decayed sum × (1 − d) is the per-tick average. */
const NORM = 1 - ACC_DECAY;

export interface Mon3Row {
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
  /** DELAY report USG %, DLY % and UKN % as 0..1 of active samples (IDL is not modelled). */
  usingFrac: number;
  delayFrac: number;
  unknownFrac: number;
  /** % Delayed for, 0..1: PRC split CP/zIIP, DEV, STR, CAP; `other` is the UKN state. */
  delay: { cpu: number; ziip: number; io: number; stor: number; cap: number; other: number };
  primaryDelay: string | null;
}

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
}

/** CPC report header, for one partition (RMF shows it for the partition the reporter runs on). */
export interface Mon3CpcHeader {
  lparId: string;
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
}

export interface Mon3Exception {
  severity: 'warn' | 'crit';
  /** WFEX Name / Reason / Critical val.; `text` is the "Possible cause or action". */
  where: string;
  reason: string;
  value: string;
  text: string;
}

export interface Mon3View {
  rangeSec: number;
  policy: string;
  systems: Mon3System[];
  rows: Mon3Row[];
  cpc: Mon3Cpc[];
  cpcHeaders: Mon3CpcHeader[];
  logicalToPhysical: number;
  enclaves: Mon3Enclave[];
  speed: Mon3Speed[];
  exceptions: Mon3Exception[];
}

// DELAY report "Primary Reason" names the resource with the largest % Delayed for.
const DELAY_NAMES: [keyof Mon3Row['delay'], string][] = [
  ['cpu', 'PRC'],
  ['ziip', 'PRC (IIP)'],
  ['io', 'DEV'],
  ['stor', 'STR'],
  ['cap', 'CAP'],
];

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

function row(run: RunState, system: string, scKey: string, a: ScpAcc, last: LastSplit, cicsTxn: ReadonlySet<string>): Mon3Row {
  const def = run.sim.wlm.definition;
  const g = goalInfo(def, scKey);
  const per = g ? def.classes.find((c) => c.id === g.serviceClass)?.periods[g.period] : undefined;
  const hash = scKey.lastIndexOf('#');
  const serviceClass = hash >= 0 ? scKey.slice(0, hash) : scKey;
  const period = hash >= 0 ? Number(scKey.slice(hash + 1)) || 1 : 1;
  const delayCpu = a.delayCpu, delayZiip = a.delayZiip, delayIo = a.delayIo, delayCap = a.delayCap;
  const delayStor = Math.max(0, a.delay - delayCpu - delayZiip - delayIo - delayCap);
  const samples = a.using + a.delay + a.delayOther;
  const frac = (x: number) => (samples > 0 ? x / samples : 0);
  const delay = { cpu: frac(delayCpu), ziip: frac(delayZiip), io: frac(delayIo), stor: frac(delayStor), cap: frac(delayCap), other: frac(a.delayOther) };
  const top = DELAY_NAMES.reduce<[string, number] | null>((best, [k, label]) => (delay[k] > 0.02 && (!best || delay[k] > best[1]) ? [label, delay[k]] : best), null);
  const v = velocityOf(a.using, a.delay);
  const goal = g?.goal;
  const rtGoal = goal && (goal.kind === 'AVG' || goal.kind === 'PCT');
  // APPROX: the smoothed accumulator keeps total Using and CP time only; split them by the last tick's mix.
  const usingAll = last.usingCpu + last.usingZiip + last.usingIo;
  const usingAvg = a.using * NORM;
  const cpuEngines = a.cpuEngines * NORM;
  const cpLast = last.cpEngines + last.iipcpEngines;
  return {
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
    velocityAct: cicsTxn.has(serviceClass) && rtGoal ? null : v,
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
    primaryDelay: top?.[0] ?? null,
  };
}

export function buildMon3(run: RunState, scenario: Scenario): Mon3View {
  const sim = run.sim;
  const def = sim.wlm.definition;
  const workloads = allWorkloads(scenario, run);
  const cicsTxn = new Set(def.cicsRegionMode === 'REGION' ? [] : workloads.filter((w) => w.subsystem === 'CICS').map((w) => classify(def, w.work).serviceClass));
  const ddfClasses = new Set(workloads.filter((w) => w.subsystem === 'DDF').map((w) => classify(def, w.work).serviceClass));
  const lastBy = (lparId: string | null, scKey: string): LastSplit => {
    const o = noSplit();
    for (const l of sim.last.lpars) if (lparId === null || l.lparId === lparId) for (const t of l.scps) if (t.scKey === scKey) addSplit(o, t);
    return o;
  };
  const rows: Mon3Row[] = [];
  for (const s of sim.wlm.systems) for (const p of s.scps) rows.push(row(run, s.lparId, p.scKey, p.acc, lastBy(s.lparId, p.scKey), cicsTxn));
  // Sysplex rows, like Monitor III's sysplex-wide SYSSUM.
  const keys = [...new Set(rows.map((r) => r.scKey))].sort();
  for (const k of keys)
    rows.push(row(run, '*PLEX', k, sumAcc(sim.wlm.systems.flatMap((s) => s.scps.filter((p) => p.scKey === k).map((p) => p.acc))), lastBy(null, k), cicsTxn));

  const cpcEngines = sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  let totalLogical = 0;
  const cpc: Mon3Cpc[] = sim.config.lpars.map((l) => {
    const poolId = l.kind === 'CF' ? 'ICF' : 'CP';
    const cfg = l.pools.find((p) => p.pool === poolId);
    const rt = sim.lpars.find((x) => x.id === l.id)?.pools.find((p) => p.pool === poolId);
    const box = sim.config.cpcs.find((c) => c.id === l.cpcId);
    const phys = box?.engines[poolId] ?? 0;
    if (l.kind === 'ZOS' && cfg && !cfg.dedicated) totalLogical += cfg.logical;
    const total = rt?.deliveredEngines ?? 0;
    // Effective dispatch excludes LPAR management time (RMF Report Analysis, CPC report).
    const effect = total * (1 - (rt?.overheadFrac ?? 0));
    const logical = cfg?.logical ?? 0;
    return {
      lparId: l.id,
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
        cpcCapacityMsu: box.engines.CP * msuCp,
        imageCapacityMsu: Math.min(...limits),
        wlmCappingPct: 100 * (sim.lpars.find((x) => x.id === l.id)?.pools.find((p) => p.pool === 'CP')?.cappedFrac ?? 0),
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
        // APPROX: a logical CP that is ready but not dispatched by PR/SM is busy to z/OS (not in wait),
        // so the MVS view exceeds the LPAR view by the short-engine wait.
        mvsBusyPct: 100 * Math.min(1, lparBusy / Math.max(0.05, 1 - (cp?.prsmDelayFrac ?? 0))),
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
    logicalToPhysical: cpcEngines > 0 ? totalLogical / cpcEngines : 0,
    enclaves,
    speed: speedSection(rows, systems),
    exceptions: exceptions(run, rows, systems, cpc, totalLogical, cpcEngines),
  };
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
    for (const r of mine) if (r.importance !== null) out.push({ system: s.system, name: r.scKey, activeUsers: r.avgUsers.active, speed: r.velocity });
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
      text: `PI ${r.pi.toFixed(2)} (imp ${r.importance})${r.primaryDelay ? `, main delay ${r.primaryDelay}` : r.unknownFrac > 0.3 ? ', mostly UKN (servers, subsystems)' : ''}`,
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
  CAP: 'held back by capping',
  OTHER: 'waiting on a server or subsystem',
};

/** Plain-English reading of one WLM activity-log line ("why did ONLHI move?"). */
export function explainWlmLog(line: string): string {
  const head = /(\S+) RCVR=(\S+) PI=([\d.]+) BTLNK=(\S+) (.*)$/.exec(line);
  if (head) {
    const [, sys, rcvr, pi, btl, action] = head as unknown as [string, string, string, string, string, string];
    const why = `On ${sys}, ${rcvr} was the most important period missing its goal (PI ${pi}, mostly ${BTLNK_TEXT[btl] ?? btl}).`;
    const donor = /^DONOR (\S+) DP (\w+)→(\w+)/.exec(action);
    if (donor) return `${why} WLM lowered donor ${donor[1]} from DP ${donor[2]} to ${donor[3]} so the receiver gets the CPU first.`;
    const up = /DP (\w+)→(\w+)/.exec(action);
    if (up) return `${why} WLM raised its dispatch priority from ${up[1]} to ${up[2]}; the projection said the receiver gains more than donors lose.`;
    return why;
  }
  const notFix = /(\S+) (\S+) PI=([\d.]+) BTLNK=(\S+) not WLM-fixable/.exec(line);
  if (notFix)
    return `On ${notFix[1]}, ${notFix[2]} misses its goal (PI ${notFix[3]}) but is mostly ${BTLNK_TEXT[notFix[4]!] ?? notFix[4]}: dispatching priority can't fix that, so WLM skips it. Look at the delay's real cause.`;
  const noNet = /(\S+) (\S+) PI=([\d.]+) BTLNK=(\S+) no action with net value/.exec(line);
  if (noNet) return `On ${noNet[1]}, ${noNet[2]} misses its goal (PI ${noNet[3]}) but every move WLM projected would hurt donors more than it helps. There isn't enough capacity to go round at this importance.`;
  return line;
}
