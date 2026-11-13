import { suPerCpuSecOf } from '../../hw/cpc';
import { jobShape, type JobRuntime } from '../../subsys/batch';
import { scKeyAtService, scKeyOf } from '../../workload/slices';
import { classify } from '../../wlm/classify';
import { cpsmGoalShares, sameShares, wlmShares, type RegionStat, type RouteCandidate } from '../../workload/routing';
import { ROUTING } from '../../../content/routing';
import { cicsTargets } from '../../wlm/reporting';
import { backlogCpSec, type LparEvalInput, type ScpTick, type SliceSpec } from '../../wlm/evaluate';
import { emptyBuckets } from '../../wlm/goals';
import { DISC_GOAL_MGMT, STORAGE_SWAP } from '../../../content/wlm/tuning';
import { ACC_DECAY, goalPi, goalInfo, type ScpState } from '../../wlm/runtime';
import type { Scenario } from '../scenario';
import type { AddressSpaceDef, WorkloadDef } from '../../workload/types';
import type { CpcConfig, LparConfig, LparPoolRuntime, PoolType, SimState } from '../types';
import { DAY_SEC, TICK_SEC } from '../units';

/** Seconds after a played day's 06:00 start → wall-clock text. */
export function instanceClock(secAfterStart: number): string {
  const s = Math.round(secAfterStart + 6 * 3600) % DAY_SEC;
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayOffset = secAfterStart >= DAY_SEC - 6 * 3600 ? '+1' : '';
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}${dayOffset}`;
}

// A running job is classified every tick; remember the last answer per job definition (the service
// definition is replaced, never edited, so identity is a safe key; classify itself is pure).
export const jobClassCache = new WeakMap<object, { def: object; lparId: string; res: ReturnType<typeof classify> }>();
export function classifyJob(def: SimState['wlm']['definition'], jobDef: JobRuntime['def'], lparId: string): ReturnType<typeof classify> {
  const hit = jobClassCache.get(jobDef);
  if (hit && hit.def === def && hit.lparId === lparId) return hit.res;
  const res = classify(def, { subsystem: 'JES', TN: jobDef.name, TC: jobDef.jobClass, SY: lparId });
  jobClassCache.set(jobDef, { def, lparId, res });
  return res;
}

export const byIdCache = new WeakMap<readonly WorkloadDef[], Record<string, WorkloadDef>>();
export function byIdOf(workloads: readonly WorkloadDef[]): Record<string, WorkloadDef> {
  let m = byIdCache.get(workloads);
  if (!m) byIdCache.set(workloads, (m = Object.fromEntries(workloads.map((w) => [w.id, w]))));
  return m;
}

/** `${workloadId}@${lparId}`; the tick stages read prebuilt ones from the plan (`ImagePlan.wlKey`). */
export function wlLparKey(workloadId: string, lparId: string): string {
  return `${workloadId}@${lparId}`;
}

/** Service a running job has consumed so far: CPU (incl. zIIP) seconds × SU per second, as the
 * period split of transactions counts it. Drives period aging of multi-period batch classes. */
export function jobServiceSu(j: JobRuntime, shape: ReturnType<typeof jobShape>, cpc: CpcConfig): number {
  return j.progress * (shape.cpSec + shape.zSec) * suPerCpuSecOf(cpc);
}

/** Which running batch jobs SRM swaps out to fit real memory: least important first (discretionary
 * before importance 5…1), latest started first within an importance (z/OS storage management,
 * SG24-7621 MPL/swap; APPROX: swap-in is immediate once storage frees, and a minimum MPL always stays in). */
export function swapOut(
  def: SimState['wlm']['definition'],
  running: readonly JobRuntime[],
  lparId: string,
  fixedGb: number,
  jobGb: number,
  memoryGb: number,
  serviceSuOf: (j: JobRuntime) => number = () => 0,
): Set<JobRuntime> {
  const out = new Set<JobRuntime>();
  let demand = fixedGb + running.length * jobGb;
  const limit = memoryGb * STORAGE_SWAP.swapToFrac;
  if (fixedGb + running.length * jobGb <= memoryGb * STORAGE_SWAP.swapAboveFrac) return out;
  const rank = (j: JobRuntime) => {
    const g = goalInfo(def, scKeyAtService(def, classify(def, { subsystem: 'JES', TN: j.def.name, TC: j.def.jobClass, SY: lparId }).serviceClass, serviceSuOf(j)));
    return !g || g.goal.kind === 'DISC' ? 6 : g.importance;
  };
  const order = [...running].sort((a, b) => rank(b) - rank(a) || (b.startTick ?? 0) - (a.startTick ?? 0) || (a.def.name < b.def.name ? -1 : 1));
  for (const j of order) {
    if (demand <= limit || out.size >= running.length - STORAGE_SWAP.minSwappedIn) break;
    out.add(j);
    demand -= jobGb;
  }
  return out;
}

/** Deep MQ queues spill from buffer pools into page sets and real memory (SPEC §5.10.3). */
export function queuedMsgGb(prev: SimState, byId: Record<string, WorkloadDef>, lparId: string): number {
  let gb = 0;
  for (const w of prev.last.workloads) {
    const d = w.queueDepth?.[lparId];
    const def = byId[w.id];
    if (d && def?.mq) gb += (d * def.mq.msgBytes) / 2 ** 30;
  }
  return gb;
}

// 3. Routing: dynamic policies recompute shares from last tick's measurements once per interval.
export function updateRouting(s: SimState, scenario: Scenario): SimState {
  const policies = s.routingPolicies;
  if (!policies || s.last.lpars.length === 0) return s;
  let routing = s.routing;
  for (const id of Object.keys(policies).sort()) {
    const policy = policies[id]!;
    const w = scenario.workloads.find((x) => x.id === id) ?? s.extraWorkloads.find((x) => x.id === id);
    if (!w) continue;
    const lparIds = Object.keys(w.routing).sort();
    let shares: Record<string, number> | null = null;
    if (policy.method === 'WLM' && s.tick % ROUTING.wlmIntervalTicks === 0) {
      shares = wlmShares(lparIds.map((lparId) => routeCandidate(s, w, lparId)), w.ziipFrac, policy.distMethod, ROUTING.minShareFrac, ROUTING.shareQuantum);
    } else if (policy.method === 'CPSM_GOAL' && s.tick % ROUTING.cpsmIntervalTicks === 0) {
      const regions = lparIds.map((lparId) => regionStat(s, w, lparId));
      shares = cpsmGoalShares(routing[id] ?? w.routing, regions, policy, ROUTING.abendRtSec, ROUTING.cpsmStepFrac, ROUTING.minShareFrac, ROUTING.shareQuantum);
    }
    if (shares && !sameShares(routing[id], shares)) routing = { ...routing, [id]: shares };
  }
  return routing === s.routing ? s : { ...s, routing };
}

// What CICSPlex SM sees of a region: last tick's normal response and abend rate for this work there.
export function regionStat(s: SimState, w: WorkloadDef, lparId: string): RegionStat {
  const k = wlLparKey(w.id, lparId);
  // No normal completions (all timed out, or no traffic yet) reads as the timeout, never as instant.
  const rt = s.env.rtByWorkloadLpar[k] ?? 0;
  return { lparId, rtSec: rt > 0 ? rt : w.timeoutSec, failFrac: s.env.failByWorkloadLpar?.[k] ?? 0 };
}

export function routeCandidate(s: SimState, w: WorkloadDef, lparId: string): RouteCandidate {
  const lt = s.last.lpars.find((l) => l.lparId === lparId);
  const pools = s.lpars.find((l) => l.id === lparId)?.pools ?? [];
  const avail = (p: PoolType) => pools.find((x) => x.pool === p)?.availableEffectiveEngines ?? 0;
  const key = scKeyOf(classify(s.wlm.definition, { ...w.work, SY: lparId }).serviceClass, 0);
  const myDp = lt?.scps.find((x) => x.scKey === key)?.dp ?? 0;
  let cpUsed = 0;
  let ziipUsed = 0;
  let cpBusy = 0;
  for (const x of lt?.scps ?? []) {
    cpBusy += x.cpEngines;
    if (x.scKey === key || x.dp < myDp) continue;
    cpUsed += x.cpEngines;
    ziipUsed += x.ziipEngines;
  }
  return { lparId, cpFreeEngines: Math.max(0, avail('CP') - cpUsed), ziipFreeEngines: Math.max(0, avail('ZIIP') - ziipUsed), cpIdleEngines: Math.max(0, avail('CP') - cpBusy) };
}

// Effective content = scenario + run additions + routing overrides. Memoised on object
// identity so slice-template caches stay warm until something actually changes.
// Same scenario + run additions ⇒ same workload content per id; only routing differs (slice-template scope).
export const workloadScope = new WeakMap<readonly WorkloadDef[], object>();
export const wlCache = new WeakMap<Scenario, WeakMap<readonly WorkloadDef[], WeakMap<object, WorkloadDef[]>>>();
export function effectiveWorkloads(scenario: Scenario, s: SimState): WorkloadDef[] {
  let a = wlCache.get(scenario);
  if (!a) wlCache.set(scenario, (a = new WeakMap()));
  let b = a.get(s.extraWorkloads);
  if (!b) a.set(s.extraWorkloads, (b = new WeakMap()));
  let out = b.get(s.routing);
  if (!out) {
    out = [...scenario.workloads, ...s.extraWorkloads].map((w) => (s.routing[w.id] ? { ...w, routing: s.routing[w.id]! } : w));
    b.set(s.routing, out);
    workloadScope.set(out, b);
  }
  return out;
}

export const asCache = new WeakMap<Scenario, WeakMap<readonly AddressSpaceDef[], AddressSpaceDef[]>>();
export function effectiveAddressSpaces(scenario: Scenario, s: SimState): AddressSpaceDef[] {
  let a = asCache.get(scenario);
  if (!a) asCache.set(scenario, (a = new WeakMap()));
  let out = a.get(s.extraAddressSpaces);
  if (!out) {
    out = [...scenario.addressSpaces, ...s.extraAddressSpaces];
    a.set(s.extraAddressSpaces, out);
  }
  return out;
}

export function addParts(into: Record<string, number>, p: NonNullable<import('../../wlm/evaluate').SliceResult['parts']>, n: number): void {
  if (n <= 0) return;
  into.base = (into.base ?? 0) + p.base * n;
  into.cpu = (into.cpu ?? 0) + p.cpu * n;
  into.cpuQueue = (into.cpuQueue ?? 0) + p.cpuQueue * n;
  into.ziipQueue = (into.ziipQueue ?? 0) + p.ziip * n;
  into.io = (into.io ?? 0) + p.io * n;
  into.paging = (into.paging ?? 0) + p.paging * n;
  into.dependency = (into.dependency ?? 0) + p.dependency * n;
  into.backlogWait = (into.backlogWait ?? 0) + p.backlogWait * n;
  into.outside = (into.outside ?? 0) + p.outside * n;
  into.outsideRef = (into.outsideRef ?? 0) + p.outsideRef * n;
  const extra = p.extra;
  for (const k in extra) into[k] = (into[k] ?? 0) + extra[k]! * n;
}

export function applyCpuModifiers(slices: SliceSpec[], mods: SimState['mods']): SliceSpec[] {
  const measure = mods.measureCpu ?? {};
  const eff = mods.efficiency ?? {};
  const io = mods.ioPerTxn ?? {};
  const shift = mods.ziipShift ?? {};
  const elig = mods.ziipEligMult ?? {};
  const hasCpu = Object.keys(mods.cpu).length > 0;
  const hasAs = Object.keys(mods.asCpu).length > 0;
  const hasProj = Object.keys(eff).length + Object.keys(io).length + Object.keys(shift).length + Object.keys(elig).length > 0;
  if (!hasCpu && !hasAs && !hasProj && Object.keys(measure).length === 0) return slices;
  return slices.map((s) => {
    const m = s.workloadId
      ? (mods.cpu[s.workloadId] ?? 1) * (measure[s.workloadId] ?? 1) * (eff[s.workloadId] ?? 1)
      : s.jobname
        ? (mods.asCpu[s.jobname] ?? 1) * (measure[s.jobname] ?? 1)
        : 1;
    const ioM = s.workloadId ? (io[s.workloadId] ?? 1) : 1;
    const z = s.workloadId ? (shift[s.workloadId] ?? 0) : 0;
    const e = s.workloadId ? (elig[s.workloadId] ?? 1) : 1;
    if (m === 1 && ioM === 1 && z === 0 && e === 1) return s;
    let out = m === 1 ? s : { ...s, cpEngines: s.cpEngines * m, ziipEngines: s.ziipEngines * m, cpuSecPerTxn: s.cpuSecPerTxn * m, ziipSecPerTxn: s.ziipSecPerTxn * m };
    if (ioM !== 1) out = { ...out, ioPerTxn: out.ioPerTxn * ioM, ioRate: out.ioRate * ioM };
    if (z > 0) {
      // Newly zIIP-eligible: that share of general-CP time moves to the zIIP side (it can still overflow back).
      const moveEng = out.cpEngines * z;
      const moveSec = out.cpuSecPerTxn * z;
      out = { ...out, cpEngines: out.cpEngines - moveEng, ziipEngines: out.ziipEngines + moveEng, cpuSecPerTxn: out.cpuSecPerTxn - moveSec, ziipSecPerTxn: out.ziipSecPerTxn + moveSec };
    }
    if (e < 1) {
      // Work that lost zIIP eligibility (e.g. external stored procedures on WLM-managed TCBs) runs on general CPs.
      const backEng = out.ziipEngines * (1 - e);
      const backSec = out.ziipSecPerTxn * (1 - e);
      out = { ...out, cpEngines: out.cpEngines + backEng, ziipEngines: out.ziipEngines - backEng, cpuSecPerTxn: out.cpuSecPerTxn + backSec, ziipSecPerTxn: out.ziipSecPerTxn - backSec };
    }
    return out;
  });
}

export function idleScpTick(scKey: string, dp: number): ScpTick {
  return {
    scKey,
    dp,
    cpEngines: 0,
    ziipEngines: 0,
    iipcpEngines: 0,
    usingCpu: 0,
    usingZiip: 0,
    usingIo: 0,
    delayCpu: 0,
    delayZiip: 0,
    delayIo: 0,
    delayOther: 0,
    delayStorage: 0,
    delayCap: 0,
    completions: 0,
    failed: 0,
    rtSumSec: 0,
    buckets: emptyBuckets(),
  };
}

/** Resource group limits in CP engines on one system (MVS Planning: WLM, ch. 7). Type 1 is a sysplex-wide
 * unweighted SU/s budget, of which this system gets `plexShareFrac` (its share of the group's demand); type 2
 * a percentage of the LPAR share, min(weight share, logical CPs); type 3 CPs × 100. Specialty engine use is
 * excluded (the "Include Specialty Processor Consumption" default). APPROX: type 2 ignores a soft cap
 * below the share; type 4 (MSU) and memory pools are not modelled. */
export function resolveRgCapEngines(
  type: 1 | 2 | 3,
  max: number,
  cpRt: Pick<LparPoolRuntime, 'entitlementEngines'> | undefined,
  suPerSec: number,
  plexShareFrac: number,
): number {
  if (type === 3) return max / 100;
  if (type === 2) return ((cpRt?.entitlementEngines ?? 0) * max) / 100;
  return (max * plexShareFrac) / suPerSec;
}

/** Each type 1 resource group's share of its sysplex CP demand (in SU/s) that runs on `lparId`.
 * APPROX: WLM balances a type 1 group's service across systems by demand; we split its SU/s
 * budget in proportion to this tick's demand. */
export function rgSysplexShares(
  def: SimState['wlm']['definition'],
  slicesBy: Readonly<Record<string, readonly SliceSpec[]>>,
  lpars: readonly LparConfig[],
  cpcOf: Readonly<Record<string, CpcConfig>>,
  lparId: string,
  backlog: Readonly<Record<string, number>> = {},
  ziipBacklog?: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!def.resourceGroups.some((g) => g.type === 1)) return out;
  const total: Record<string, number> = {};
  const here: Record<string, number> = {};
  const potential: Record<string, number> = {};
  const herePotential: Record<string, number> = {};
  for (const l of lpars) {
    const slices = slicesBy[l.id];
    if (!slices) continue;
    const suPerSec = suPerCpuSecOf(cpcOf[l.cpcId]!);
    const eligibleOnCp = !l.pools.some((p) => p.pool === 'ZIIP' && p.logical > 0);
    for (const s of slices) {
      const rg = goalInfo(def, s.scKey)?.resourceGroup;
      if (!rg) continue;
      const bl = backlog[s.key] ?? 0;
      const blCp = backlogCpSec(s, backlog, ziipBacklog);
      const zi = s.ziipEngines + (bl - blCp) / TICK_SEC;
      const cp = s.cpEngines + blCp / TICK_SEC + (eligibleOnCp ? zi : 0);
      const su = cp * suPerSec;
      const allSu = (s.cpEngines + blCp / TICK_SEC + zi) * suPerSec;
      total[rg] = (total[rg] ?? 0) + su;
      potential[rg] = (potential[rg] ?? 0) + allSu;
      if (l.id === lparId) here[rg] = (here[rg] ?? 0) + su;
      if (l.id === lparId) herePotential[rg] = (herePotential[rg] ?? 0) + allSu;
    }
  }
  for (const g of def.resourceGroups) {
    if (g.type !== 1) continue;
    const t = total[g.id] ?? 0;
    // With only eligible work left, reserve one sysplex CP budget for possible overflow.
    const p = potential[g.id] ?? 0;
    out[g.id] = t > 0 ? (here[g.id] ?? 0) / t : p > 0 ? (herePotential[g.id] ?? 0) / p : 1;
  }
  return out;
}

export const combineCaps = (a: ((s: SliceSpec) => number) | undefined, b: ((s: SliceSpec) => number) | undefined) =>
  a && b ? (s: SliceSpec) => Math.min(a(s), b(s)) : (a ?? b);

/** Discretionary goal management: while discretionary work on this image is waiting, over-achieving
 * periods with loose goals are capped so it gets cycles. Only if not in a resource group, not a small
 * consumer, velocity ≤ 30 or response goal > 1 min (MVS Planning: WLM p.118), and PI < 0.71; WLM holds
 * the capped PI in 0.71–0.81 (SG24-6472-03 p.58). APPROX: a proportional cap from the current PI instead
 * of WLM's projection; the other SG24-7621 Fig. 4-22 conditions are not modelled. */
export function discretionaryCaps(def: SimState['wlm']['definition'], slices: readonly SliceSpec[], scps: readonly ScpState[]): ((s: SliceSpec) => number) | undefined {
  const D = DISC_GOAL_MGMT;
  const byKey: Record<string, ScpState> = {};
  for (const st of scps) byKey[st.scKey] = st;
  const discWaiting = scps.some((st) => goalInfo(def, st.scKey)?.goal.kind === 'DISC' && st.acc.delay > st.acc.using);
  if (!discWaiting) return undefined;
  const capped: Record<string, number> = {};
  for (const st of scps) {
    const g = goalInfo(def, st.scKey);
    if (!g || g.resourceGroup) continue;
    const goal = g.goal;
    const loose = goal.kind === 'VEL' ? goal.velocity <= D.maxVelocity : goal.kind === 'AVG' || goal.kind === 'PCT' ? goal.rtSec > D.minRtSec : false;
    if (!loose) continue;
    const samples = st.acc.using + st.acc.delay;
    // Decayed sum → steady-state engines.
    const engines = st.acc.cpuEngines * (1 - ACC_DECAY);
    if (engines < D.minEngines) continue;
    const pi = goalPi(goal, st.acc);
    if (pi === null) continue;
    const wasCapped = st.acc.delayCap > 0.05 * samples;
    if (pi < D.piBelow || (wasCapped && pi < D.stayCappedPiBelow)) {
      capped[st.scKey] = Math.max(D.minCapFrac, 1 - D.capGainPerPi * (D.stayCappedPiBelow - pi));
    }
  }
  if (Object.keys(capped).length === 0) return undefined;
  return (s) => {
    const f = capped[s.scKey];
    return f === undefined ? Infinity : s.cpEngines * f;
  };
}

/** CICS transactions on this image share the AOR regions' DP (SG24-7621 CICS/IMS region management). "Manage
 * Region Using Goals Of" is set per region on its STC/JES rule (WLM Planning 3.1 p.122, p.211). TRANSACTION regions
 * are transaction servers: their own CPU dispatches with the transactions. APPROX: the sim does not split a
 * workload's transactions between regions, so the transactions follow the AORs together: they ride the most
 * important served class's DP if any AOR on the image is TRANSACTION, else the first AOR's class DP. */
export function cicsRegions(
  def: SimState['wlm']['definition'],
  slices: readonly SliceSpec[],
  byId: Record<string, WorkloadDef>,
  addressSpaces: readonly AddressSpaceDef[],
  lparId: string,
): { regions?: LparEvalInput['regions'] } {
  const aor = addressSpaces.find((a) => a.lparId === lparId && a.role === 'CICS.AOR');
  if (!aor) return {};
  const keys: string[] = [];
  for (const s of slices) {
    if (s.kind === 'TXN' && s.workloadId && byId[s.workloadId]?.subsystem === 'CICS' && !keys.includes(s.scKey)) keys.push(s.scKey);
  }
  if (keys.length === 0) return {};
  keys.sort();
  const legacy = def.cicsRegionMode ?? 'TRANSACTION';
  const modeOf = (a: AddressSpaceDef) => classify(def, { subsystem: a.subsystem, TN: a.jobname, SY: lparId }).regionMode ?? legacy;
  const servers: string[] = [];
  let txnMode: 'TRANSACTION' | 'REGION' = 'REGION';
  let rtTracked = false;
  // Every serving region managed to the served transactions' goals: only then is the region class's own goal
  // unused (WLM Planning p.120, p.122; REGION and BOTH manage the region to its own class's goal).
  let anyServer = false;
  let managedToTxn = true;
  for (const s of slices) {
    if (s.kind !== 'AS' || (s.role !== 'CICS.AOR' && s.role !== 'CICS.TOR')) continue;
    const a = addressSpaces.find((x) => x.lparId === lparId && x.jobname === s.jobname);
    const m = a ? modeOf(a) : 'REGION';
    // REGION: "Transaction response times reported by these regions is not reported in any service class";
    // TRANSACTION and BOTH track the completions (WLM Planning 3.1 p.102-103).
    if (m !== 'REGION') rtTracked = true;
    anyServer = true;
    if (m !== 'TRANSACTION') {
      managedToTxn = false;
      continue;
    }
    servers.push(s.key);
    if (s.role === 'CICS.AOR') txnMode = 'TRANSACTION';
  }
  servers.sort();
  const regionKey = scKeyAtService(def, classify(def, { subsystem: aor.subsystem, TN: aor.jobname, SY: lparId }).serviceClass, Infinity);
  const transactionKeys = new Set(slices.filter((s) => s.kind === 'TXN' && s.workloadId && byId[s.workloadId]?.subsystem === 'CICS').map((s) => s.key));
  return { regions: { keys, mode: txnMode, regionKey, servers, rtTracked, transactionKeys, targets: cicsTargets(slices, regionKey), ...(anyServer && managedToTxn ? { managedToTxn } : {}) } };
}

/** WLM Planning 3.1 p.122: only all served transaction classes Honor Priority NO prevents a
 * transaction-server region's overflow. APPROX: CICS transactions share the AORs on this image.
 * Recompute from live demand (including both pools' backlog), outside the rate-independent cache. */
export function cicsHonorPriority(
  def: SimState['wlm']['definition'],
  slices: readonly SliceSpec[],
  byId: Readonly<Record<string, WorkloadDef>>,
  regions: LparEvalInput['regions'],
  backlog: Readonly<Record<string, number>>,
  ziipBacklog: Readonly<Record<string, number>>,
): readonly SliceSpec[] {
  if (!regions) return slices;
  const isCics = (s: SliceSpec) => s.kind === 'TXN' && s.workloadId !== null && byId[s.workloadId]?.subsystem === 'CICS';
  const participating = slices.filter((s) => isCics(s) && (s.rate > 0 || s.cpEngines > 0 || s.ziipEngines > 0 || (backlog[s.key] ?? 0) > 0 || (ziipBacklog[s.key] ?? 0) > 0));
  // With no transactions the address space is no longer a transaction server (p.122).
  if (participating.length === 0) return slices;
  const mayOverflow = participating.some((s) => s.mayOverflow);
  return slices.map((s) => {
    const shared = (regions.mode === 'TRANSACTION' && isCics(s)) || (s.kind === 'AS' && regions.servers?.includes(s.key));
    if (!shared) return s;
    const allowed = mayOverflow && goalInfo(def, s.scKey)?.goal.kind !== 'DISC';
    return s.mayOverflow === allowed ? s : { ...s, mayOverflow: allowed };
  });
}

/** A period misses its goal for the minimum when PI > 1; discretionary work when it is mostly
 * waiting (APPROX: WLM's exact test for discretionary members is not documented here). */
export function missingGoal(def: SimState['wlm']['definition'], st: ScpState | undefined, scKey: string): boolean {
  if (!st) return false;
  const g = goalInfo(def, scKey)?.goal;
  if (!g) return false;
  if (g.kind === 'DISC') return st.acc.delay > st.acc.using;
  const pi = goalPi(g, st.acc);
  return pi !== null && pi > 1;
}

/** Resource group minimums in force: per-period CP engines, only while the group misses goals. */
export function rgMin(
  def: SimState['wlm']['definition'],
  slices: readonly SliceSpec[],
  scps: readonly ScpState[],
  cpRt: LparPoolRuntime | undefined,
  suPerSec: number,
  plexShare: Readonly<Record<string, number>> = {},
): { minOf?: Record<string, number>; discMin?: Set<string> } {
  const groups = def.resourceGroups.filter((g) => g.min !== null && g.min > 0);
  if (groups.length === 0) return {};
  const minOf: Record<string, number> = {};
  for (const g of groups) {
    const demand: Record<string, number> = {};
    for (const s of slices) if (goalInfo(def, s.scKey)?.resourceGroup === g.id) demand[s.scKey] = (demand[s.scKey] ?? 0) + s.cpEngines;
    const keys = Object.keys(demand).sort();
    const total = keys.reduce((a, k) => a + demand[k]!, 0);
    if (total <= 0 || !keys.some((k) => missingGoal(def, scps.find((x) => x.scKey === k), k))) continue;
    const min = resolveRgCapEngines(g.type, g.min!, cpRt, suPerSec, plexShare[g.id] ?? 1);
    for (const k of keys) minOf[k] = (min * demand[k]!) / total;
  }
  if (Object.keys(minOf).length === 0) return {};
  const disc = Object.keys(minOf).filter((k) => goalInfo(def, k)?.goal.kind === 'DISC');
  return disc.length > 0 ? { minOf, discMin: new Set(disc) } : { minOf };
}

export function resourceGroupCaps(
  def: SimState['wlm']['definition'],
  slices: readonly SliceSpec[],
  cpRt: Pick<LparPoolRuntime, 'entitlementEngines'> | undefined,
  suPerSec: number,
  plexShare: Readonly<Record<string, number>>,
  workloadById: Readonly<Record<string, WorkloadDef>>,
  backlog: Readonly<Record<string, number>>,
  ziipBacklog?: Readonly<Record<string, number>>,
  eligibleOnCp = false,
): ((s: SliceSpec) => number) | undefined {
  const groups = def.resourceGroups.filter((g) => g.max !== null);
  if (groups.length === 0) return undefined;
  // Transactions consume their CPU in their host regions (CICS AORs), so a group on the regions' class caps
  // them (WLM Planning p.60 note 1, p.122). APPROX: a transaction slice is a member in proportion to the CPU
  // share of its LPAR's host regions in the group; CPSM routing away from capped AORs is ignored.
  const hostEngines: Record<string, number> = {};
  const hostInGroup: Record<string, Record<string, number>> = {};
  for (const s of slices) {
    if (s.kind !== 'AS' || !s.role) continue;
    hostEngines[s.role] = (hostEngines[s.role] ?? 0) + s.cpEngines;
    const rg = goalInfo(def, s.scKey)?.resourceGroup;
    if (rg) (hostInGroup[s.role] ??= {})[rg] = (hostInGroup[s.role]![rg] ?? 0) + s.cpEngines;
  }
  const hostShare = (s: SliceSpec, rg: string): number => {
    if (s.kind !== 'TXN' || !s.workloadId) return 0;
    const role = workloadById[s.workloadId]?.hostRole;
    const tot = role ? (hostEngines[role] ?? 0) : 0;
    return tot > 0 ? (hostInGroup[role!]?.[rg] ?? 0) / tot : 0;
  };
  const capBySlice: Record<string, number> = {};
  const cpWant = (s: SliceSpec) => {
    const bl = backlog[s.key] ?? 0;
    const blCp = backlogCpSec(s, backlog, ziipBacklog);
    return s.cpEngines + blCp / TICK_SEC + (eligibleOnCp ? s.ziipEngines + (bl - blCp) / TICK_SEC : 0);
  };
  for (const g of groups) {
    const members: { s: SliceSpec; frac: number }[] = [];
    for (const s of slices) {
      const frac = goalInfo(def, s.scKey)?.resourceGroup === g.id ? 1 : hostShare(s, g.id);
      if (frac > 0) members.push({ s, frac });
    }
    let weightOf = cpWant;
    let demand = members.reduce((a, m) => a + m.frac * weightOf(m.s), 0);
    if (demand <= 0) {
      weightOf = (s) => s.ziipEngines + Math.max(0, (backlog[s.key] ?? 0) - backlogCpSec(s, backlog, ziipBacklog)) / TICK_SEC;
      demand = members.reduce((a, m) => a + m.frac * weightOf(m.s), 0);
    }
    if (demand <= 0) continue;
    const cap = resolveRgCapEngines(g.type, g.max!, cpRt, suPerSec, plexShare[g.id] ?? 1);
    for (const { s, frac } of members) {
      const capped = (cap * frac * weightOf(s)) / demand;
      if (frac >= 1) {
        capBySlice[s.key] = capped;
        continue;
      }
      // The part of the slice running outside the group's regions stays uncapped (same demand as evaluateLpar).
      const uncapped = cpWant(s);
      capBySlice[s.key] = capped + (1 - frac) * uncapped;
    }
  }
  return (s) => capBySlice[s.key] ?? Infinity;
}
