// RMF Monitor III style live views (SPEC §8 tier 1), built from WLM's smoothed per-period
// accumulators. ACC_DECAY 0.85 per 10 s tick weights roughly the last minute or two, close to
// Monitor III's 120 s MINTIME range (APPROX: exponential rather than a fixed MINTIME window).
// Field names, columns and formulas follow z/OS RMF Report Analysis (SC34-2665, z/OS 2.5), ch. 2.
// Samples here are time-average concurrency (average number of users in each state), so RMF's
// group formulas ∑ samples ÷ (# samples × avg # address spaces) become state ÷ active users.
// Split from `mon3.ts` (CL-33): the builder and its sections; types are in `types.ts`, PROCU in
// `procu.ts`, the log explainer in `explainWlmLog.ts`.

import { mergeWorkManager, noResources, reportedAccs, workManagerStatePct, type WorkManagerState } from '../../sim/wlm/reporting';
import type { Scenario } from '../../sim/core/scenario';
import { TICK_SEC } from '../../sim/core/units';
import { capacityLossPct, msuPerCp } from '../../sim/hw/cpc';
import { groupMemberR4ha, R4HA_WINDOW_TICKS } from '../../sim/cost/r4ha';
import { classify } from '../../sim/wlm/classify';
import { BUCKET_BOUNDS, goalText, velocityOf } from '../../sim/wlm/goals';
import { ACC_DECAY, accPi, goalInfo, sumAcc, velDelay, velUsing, type ScpAcc } from '../../sim/wlm/runtime';
import type { RunState } from '../types';
import { mon3GatherersDown } from '../tools';
import { allWorkloads } from '../workloads';
import { primaryReasons, procuJobs } from './procu';
import type { Mon3Cpc, Mon3CpcHeader, Mon3CpcPhysical, Mon3DelayResource, Mon3Enclave, Mon3Exception, Mon3Row, Mon3Server, Mon3Speed, Mon3System, Mon3View, Mon3Wkm } from './types';

export * from './types';
export * from './explainWlmLog';

/** Steady-state normaliser: a decayed sum × (1 − d) is the per-tick average. */
const NORM = 1 - ACC_DECAY;

/** Each system's WLM accumulators as the reports show them: CICS transaction samples with the region classes, as
 * in WLMGL (reporting.ts). Every PI the player sees (SYSSUM, the header heat map) is taken from these. */
export function reportedBySystem(sim: RunState['sim']): Record<string, Record<string, ScpAcc>> {
  return Object.fromEntries(
    sim.wlm.systems.map((s) => [s.lparId, reportedAccs(Object.fromEntries(s.scps.map((p) => [p.scKey, p.acc])), sim.last.lpars.find((l) => l.lparId === s.lparId)?.cics, sim.last.lpars.find((l) => l.lparId === s.lparId)?.iipcpReported ?? true)]),
  );
}

/** WLM is soft-capping the image: its own R4HA is above its defined capacity, or its capacity group's is above the
 * group limit (the two conditions `softCap` applies in the sim; MVS Planning: WLM 3.1 p.44–47). */
export function softCapped(sim: RunState['sim'], lparId: string): boolean {
  const l = sim.config.lpars.find((x) => x.id === lparId);
  if (sim.capping.lpars.find((x) => x.id === lparId)?.capped && l?.definedCapacityMsu != null) return true;
  if (!l?.capacityGroup) return false;
  const g = sim.config.capacityGroups.find((x) => x.id === l.capacityGroup);
  const gs = sim.capping.groups.find((x) => x.id === l.capacityGroup);
  if (!g || !gs) return false;
  const join = sim.capping.groupJoinTicks?.[l.capacityGroup]?.[lparId] ?? sim.tick;
  return groupMemberR4ha(gs, join, sim.tick) > g.limitMsu;
}

/** The resource behind DELAY's Primary Reason: the largest % Delayed for above 2%, capping included (p.110). */
function primaryDelayOf(delay: Mon3Row['delay']): Mon3DelayResource | null {
  const by: [Mon3DelayResource, number][] = [
    ['PRC', delay.cpu + delay.ziip],
    ['DEV', delay.io],
    ['STR', delay.stor],
    ['CAP', delay.cap],
  ];
  return by.reduce<[Mon3DelayResource, number] | null>((best, x) => (x[1] > 0.02 && (!best || x[1] > best[1]) ? x : best), null)?.[0] ?? null;
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

function row(run: RunState, system: string, scKey: string, a: ScpAcc): Mon3Row {
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
  // The split comes from the decayed reporting components of this accumulator (PR-21), so a sysplex row sums its
  // systems and a period with no using samples keeps the earlier mix instead of losing it to the last tick.
  const usingAll = (a.usingCpu ?? 0) + (a.usingZiip ?? 0) + (a.usingIo ?? 0);
  const usingAvg = a.using * NORM;
  const cpuEngines = a.cpuEngines * NORM;
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
    // zIIP engines are a separate column, not a share of CP engines; IIPCP is a part of the CP total.
    ziipEngines: (a.ziipEnginesView ?? 0) * NORM,
    iipcpEngines: (a.iipcpEngines ?? 0) * NORM,
    avgUsers: {
      active: samples * NORM,
      proc: usingAvg * ratio((a.usingCpu ?? 0) + (a.usingZiip ?? 0), usingAll),
      dev: usingAvg * ratio(a.usingIo ?? 0, usingAll),
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
  const reported = reportedBySystem(sim);
  // A system whose gatherer is down has no samples: its rows go, and the sysplex rows are built from the systems that
  // still gather (RMF User's Guide SC27-4936 PDF p.93 (printed 69)). APPROX: the CPC section keeps every partition,
  // since another gatherer on the CPC still reads the PR/SM data.
  const down = mon3GatherersDown(run);
  const gathering = sim.wlm.systems.filter((s) => !down.includes(s.lparId));
  const rows: Mon3Row[] = [];
  for (const s of gathering) for (const p of s.scps) rows.push(row(run, s.lparId, p.scKey, reported[s.lparId]![p.scKey]!));
  // Sysplex rows, like Monitor III's sysplex-wide SYSSUM.
  const keys = [...new Set(rows.map((r) => r.scKey))].sort();
  for (const k of keys)
    rows.push(row(run, '*PLEX', k, sumAcc(gathering.flatMap((s) => (reported[s.lparId]![k] ? [reported[s.lparId]![k]!] : [])))));
  primaryReasons(run, scenario, rows, ddfClasses);
  const procJobs = procuJobs(run, scenario, rows, ddfClasses);

  const cpcEngines = sim.config.cpcs.reduce((a, c) => a + c.engines.CP, 0);
  let totalLogical = 0;
  const logicalByCpc: Record<string, number> = {};
  const cpc: Mon3Cpc[] = sim.config.lpars.map((l) => {
    const poolId = l.kind === 'CF' ? 'ICF' : 'CP';
    const cfg = l.pools.find((p) => p.pool === poolId);
    const rt = sim.lpars.find((x) => x.id === l.id)?.pools.find((p) => p.pool === poolId);
    const lrt = sim.lpars.find((x) => x.id === l.id);
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
    // The *IIP group's row: zIIPs online only (a reserved-but-offline zIIP is not part of the range's Proc Num).
    const ziCfg = l.kind === 'ZOS' ? l.pools.find((p) => p.pool === 'ZIIP') : undefined;
    const ziRt = sim.lpars.find((x) => x.id === l.id)?.pools.find((p) => p.pool === 'ZIIP');
    const ziPhys = box?.engines.ZIIP ?? 0;
    const ziTotal = ziRt?.deliveredEngines ?? 0;
    const ziEffect = ziTotal * (1 - (ziRt?.overheadFrac ?? 0));
    const iip =
      ziCfg && ziCfg.logical > 0
        ? {
            procNum: ziCfg.logical,
            logicalEffectPct: (100 * ziEffect) / ziCfg.logical,
            logicalTotalPct: (100 * ziTotal) / ziCfg.logical,
            physLparPct: ziPhys > 0 ? (100 * (ziTotal - ziEffect)) / ziPhys : 0,
            physEffectPct: ziPhys > 0 ? (100 * ziEffect) / ziPhys : 0,
            physTotalPct: ziPhys > 0 ? (100 * ziTotal) / ziPhys : 0,
            prsmDelayPct: 100 * (ziRt?.prsmDelayFrac ?? 0),
            cappedPct: 100 * (ziRt?.cappedFrac ?? 0),
          }
        : undefined;
    return {
      lparId: l.id,
      cpcId: l.cpcId,
      kind: l.kind,
      msuDef: l.kind === 'ZOS' ? l.definedCapacityMsu : null,
      // MSU Act: the partition's MSU rate, from effective dispatch time (physical dispatch less LPAR management,
      // RMF Report Analysis 3.1 PDF p.401 (printed 361), PDF p.98 (printed 58)). It is the same field the header,
      // Partition Data MSU AVG, the R4HA and the bill use, so the reports cannot disagree.
      msuAct: l.kind === 'ZOS' && box ? (lrt?.msuRate ?? 0) : null,
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
      ...(iip ? { iip } : {}),
    };
  });

  // Each group's PHYSICAL line: physical busy time no partition can claim (p.97-99). It is NOT the partitions'
  // LPAR-management column, which is already their own Total - Effective share: Time PHYSICAL is busy time outside
  // any partition's dispatch. Every busy engine-second in the sim comes from a partition's dispatch (PR/SM overhead
  // is charged inside it), so the sim has none and the line is 0.00 % (APPROX, docs/research.md).
  const cpcPhysical: Mon3CpcPhysical[] = sim.config.cpcs.flatMap((box) => {
    const mine = cpc.filter((c) => c.cpcId === box.id);
    const line = (kind: Mon3CpcPhysical['kind'], engine: number, part: Mon3Cpc[]) =>
      engine > 0 && part.length ? [{ cpcId: box.id, kind, physPct: 0 }] : [];
    return [
      ...line('CP', box.engines.CP, mine.filter((c) => c.kind === 'ZOS')),
      ...line('IIP', box.engines.ZIIP, mine.filter((c) => c.iip)),
      ...line('ICF', box.engines.ICF, mine.filter((c) => c.kind === 'CF')),
    ];
  });

  const cpcHeaders: Mon3CpcHeader[] = sim.config.lpars
    .filter((l) => l.kind === 'ZOS')
    .map((l) => {
      const box = sim.config.cpcs.find((c) => c.id === l.cpcId)!;
      const msuCp = msuPerCp(box);
      const cp = l.pools.find((p) => p.pool === 'CP');
      const r4 = sim.capping.lpars.find((x) => x.id === l.id);
      const grp = l.capacityGroup ? sim.config.capacityGroups.find((g) => g.id === l.capacityGroup) : undefined;
      const gs = grp ? sim.capping.groups.find((g) => g.id === grp.id) : undefined;
      const join = grp ? (sim.capping.groupJoinTicks?.[grp.id]?.[l.id] ?? sim.tick) : undefined;
      const groupUsed = grp && gs && join !== undefined ? groupMemberR4ha(gs, join, sim.tick) : null;
      // Image Capacity: the lowest of logical-CP capacity, defined capacity and the group limit.
      const limits = [(cp ? cp.logical + cp.reserved : 0) * msuCp, l.definedCapacityMsu ?? Infinity, grp?.limitMsu ?? Infinity];
      if (cp?.absoluteCapEngines != null) limits.push(cp.absoluteCapEngines * msuCp);
      return {
        lparId: l.id,
        cpcId: l.cpcId,
        cpcCapacityMsu: box.engines.CP * msuCp,
        imageCapacityMsu: Math.min(...limits),
        // APPROX: RMF's WLM Capping % is the share of the range WLM capped the partition (RMF Report Analysis p.98);
        // this live view shows the instant state, 100 while the image is capped.
        wlmCappingPct: softCapped(sim, l.id) ? 100 : 0,
        r4haMsu: r4?.r4ha ?? 0,
        max4hMsu: r4 ? Math.max(0, ...r4.slots) : 0,
        group: grp?.id ?? null,
        groupLimitMsu: grp?.limitMsu ?? null,
        ...(grp && groupUsed !== null && join !== undefined
          ? { groupAvailableMsu: grp.limitMsu - groupUsed, groupLimitNew: sim.tick - join < R4HA_WINDOW_TICKS }
          : {}),
      };
    });

  const systems: Mon3System[] = sim.config.lpars
    .filter((l) => l.kind === 'ZOS' && !down.includes(l.id))
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
        capped: softCapped(sim, l.id),
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
    cpcPhysical,
    cpcHeaders,
    logicalToPhysicalByCpc: Object.fromEntries(sim.config.cpcs.map((c) => [c.id, c.engines.CP > 0 ? (logicalByCpc[c.id] ?? 0) / c.engines.CP : 0])),
    logicalToPhysical: cpcEngines > 0 ? totalLogical / cpcEngines : 0,
    enclaves,
    wkm: wkmSection(run, scenario, rows, down),
    procJobs,
    speed: speedSection(rows, systems),
    exceptions: exceptions(run, rows, systems, cpc, totalLogical, cpcEngines),
    ...(down.length ? { missingSystems: down.map((system) => ({ system, reason: 'Gatherer not active' as const })) } : {}),
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
    for (const r of mine) {
      if (r.importance === null) continue;
      if (r.workManager && r.resourceSamples === false) {
        // Workflow is a state-sampling measure of address spaces — erbb500 v3r1 PDF p.51–52 (printed 11–12), where
        // the using and delay samples are counts of address spaces — and a transaction class owns none: its samples
        // are the serving regions' (same book PDF p.147 (printed 107): users are "found in all address spaces for
        // the specified class"). RMF shows the serving address spaces' using and velocity for such a class
        // (SYSWKM; SG24-6645-00 PDF p.277–278 (printed 263–264)). APPROX: WFEX itself is undocumented for this case;
        // show the regions' workflow, since "No work" would read as idle while transactions run.
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

/**
 * SYSWKM per CICS transaction class: its response time breakdown and the AORs serving it. The sim models CICS work per
 * workload and system, not per region, so the AORs on one system share that system's CICS samples equally (APPROX, as
 * in the WLMGL attribution). Their samples are WLM's own view of the transactions (the management accumulators), split
 * by the class's share of the system's CICS CPU for Service %.
 */
function wkmSection(run: RunState, scenario: Scenario, rows: readonly Mon3Row[], down: readonly string[]): Mon3Wkm[] {
  const sim = run.sim;
  const def = sim.wlm.definition;
  const plex = rows.filter((r) => r.system === '*PLEX' && r.workManager);
  if (plex.length === 0) return [];
  const cicsKeys = new Set(plex.map((r) => r.scKey));
  const aors = [...scenario.addressSpaces, ...sim.extraAddressSpaces].filter((a) => a.role === 'CICS.AOR');
  // Per system: CICS samples (WLM's view) summed over the transaction classes, and each class's CPU.
  const bySys: Record<string, { acc: ScpAcc; cpuByKey: Record<string, number>; cpu: number }> = {};
  for (const s of sim.wlm.systems) {
    if (down.includes(s.lparId)) continue;
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
      const usingAll = (acc.usingCpu ?? 0) + (acc.usingZiip ?? 0) + (acc.usingIo ?? 0);
      const usingFrac = samples > 0 ? acc.using / samples : 0;
      out.push({
        jobname: a.jobname,
        system: a.lparId,
        mgmt: cls.regionMode ?? def.cicsRegionMode ?? 'TRANSACTION',
        serviceClass: cls.serviceClass,
        rowKey: rows.find((r) => r.system === a.lparId && r.serviceClass === cls.serviceClass)?.scKey ?? null,
        servicePct: sys.cpu > 1e-12 ? (100 * sys.cpuByKey[scKey]!) / sys.cpu : 100 / Math.max(1, Object.keys(sys.cpuByKey).length),
        velocity: velocityOf(velUsing(acc), velDelay(acc)),
        procUsgPct: 100 * usingFrac * ratio((acc.usingCpu ?? 0) + (acc.usingZiip ?? 0), usingAll),
        ioUsgPct: 100 * usingFrac * ratio(acc.usingIo ?? 0, usingAll),
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
