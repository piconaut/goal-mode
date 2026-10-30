// SMF/RMF interval data (SPEC §5.12). Accumulates per-tick measurements and closes an
// interval into records shaped like SMF 70.1 (CPU/partition), 72.3 (workload activity),
// 74.1 (DASD), 74.4 (CF) and 30 (job end).

import type { CfResult, CfSystemResult } from '../cf/cf';
import type { DasdResult } from '../io/dasd';
import type { LparRuntime, LparTick, WorldConfig } from '../core/types';
import type { ScpTick } from '../wlm/evaluate';
import { BUCKETS, emptyBuckets, velocityOf } from '../wlm/goals';
import { goalInfo, accPi, emptyAcc, type ScpAcc } from '../wlm/runtime';
import type { ServiceDefinition } from '../wlm/types';
import { TICK_SEC } from '../core/units';

export interface ScpIntervalAcc extends ScpAcc {
  lparId: string;
  scKey: string;
  dp: number;
  ziipEngines: number;
  iipcpEngines: number;
  usingCpu: number;
  usingZiip: number;
  usingIo: number;
  delayStorage: number;
  delayQueue?: number;
  failed: number;
}

export interface LparIntervalAcc {
  lparId: string;
  deliveredCp: number;
  effectiveCp: number;
  deliveredZiip: number;
  deliveredIcf: number;
  overhead: number;
  capped: number;
  wlmCapped?: number;
  prsmDelay: number;
  mvsBusy?: number;
  msu: number;
  vh: number;
  vm: number;
  vl: number;
  unparkedVl: number;
}

export interface RcIntervalAcc extends ScpIntervalAcc {
  members: string[];
}

export interface RmfAcc {
  startTick: number;
  ticks: number;
  scps: Record<string, ScpIntervalAcc>;
  lpars: Record<string, LparIntervalAcc>;
  dasd: { ticks: number; iops: number; rtRandom: number; iosq: number; pend: number; disc: number; conn: number; rtSeq: number };
  /** Per LCU: I/O counts and I/O-weighted IOSQ/response sums. */
  lcus: Record<string, { ios: number; iosqW: number; rtW: number; aliasesPerHot: number; ticks: number }>;
  cf: Record<string, { busy: number; rate: number; sync: number; async: number; service: number; ticks: number }>;
  /** Per structure: request-weighted sums (rate × value) so interval averages weight busy ticks. */
  cfStructures: Record<string, { type: string; cfLparId: string; rate: number; syncReq: number; syncSecW: number; serviceSecW: number; ticks: number }>;
  /** Per connected system: request-weighted sums of its own CF service. */
  cfSystems?: Record<string, { distKm: number; rate: number; syncSecW: number; asyncW: number; serviceSecW: number; ticks: number }>;
  /** Report classes, keyed lpar|name (only once the policy assigns any). */
  rcs?: Record<string, RcIntervalAcc>;
}

export interface WlmRecord {
  lparId: string; // '*PLEX' for the sysplex roll-up
  scKey: string;
  serviceClass: string;
  period: number;
  goalText: string;
  importance: number | null;
  dp: number | null;
  ended: number;
  endPerSec: number;
  failed: number;
  avgRtSec: number | null;
  execVelocity: number | null;
  pi: number | null;
  applCpPct: number;
  applIipcpPct: number;
  applIipPct: number;
  usingPct: { cpu: number; ziip: number; io: number };
  delayPct: { cpu: number; ziip: number; io: number; storage: number; cap: number; other: number; queue?: number };
  buckets: number[];
  /** Report class row: `serviceClass` holds the report class name. */
  reportClass?: boolean;
  /** Service-class periods the report class's work ran in. */
  members?: string[];
}

export interface CpuRecord {
  lparId: string;
  weight: number;
  logicalCps: number;
  polarity: string;
  /** Average physical CP engines dispatched for this LPAR. */
  physicalEngines: number;
  logicalBusyPct: number;
  /** RMF MVS BUSY (absent in old saves): non-wait share of unparked online time, ready-but-undispatched included. */
  mvsBusyPct?: number;
  overheadPct: number;
  cappedPct: number;
  /** Time WLM soft-capped the partition (Partition Data WLM%, RMF Report Analysis p.401). */
  wlmCappingPct?: number;
  prsmDelayPct: number;
  msuAvg: number;
  r4ha: number;
  definedCapacityMsu: number | null;
  /** PR/SM absolute capping limit on the CP pool, in engines (absent in old saves). */
  absoluteCapEngines?: number | null;
  ziipEngines: number;
  icfEngines: number;
}

export interface JobEndRecord {
  name: string;
  stream: string;
  lparId: string;
  critical: boolean;
  queuedSec: number;
  elapsedSec: number;
  endTick: number;
  stretch: number;
}

export interface RmfInterval {
  startTick: number;
  endTick: number;
  intervalSec: number;
  policy: string;
  cpu: CpuRecord[];
  cpcBusy: { cpcId: string; pool: string; physicalBusyPct: number }[];
  wlm: WlmRecord[];
  /** Report class rows (only when the policy assigns report classes). */
  wlmRc?: WlmRecord[];
  dasd: { iops: number; rtRandomMs: number; rtSeqMs: number; iosqMs: number; pendMs: number; discMs: number; connMs: number };
  lcus: { id: string; label: string; volumes: number; aliases: number; iops: number; iosqMs: number; rtMs: number; aliasesPerHotVol: number }[];
  cf: { lparId: string; busyPct: number; reqPerSec: number; syncUs: number; asyncPct: number; serviceUs: number }[];
  cfStructures: { name: string; type: string; cfLparId: string; reqPerSec: number; syncPct: number; syncUs: number; serviceUs: number }[];
  cfSystems?: { system: string; distKm: number; reqPerSec: number; syncUs: number; asyncPct: number; serviceUs: number }[];
  jobs: JobEndRecord[];
}

export const newRmfAcc = (startTick: number): RmfAcc => ({
  startTick,
  ticks: 0,
  scps: {},
  lpars: {},
  dasd: { ticks: 0, iops: 0, rtRandom: 0, iosq: 0, pend: 0, disc: 0, conn: 0, rtSeq: 0 },
  lcus: {},
  cf: {},
  cfStructures: {},
});

function addBuckets(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + (b[i] ?? 0);
  return out;
}

export function accumulateTick(
  acc: RmfAcc,
  lparTicks: readonly LparTick[],
  lpars: readonly LparRuntime[],
  dasd: DasdResult | null,
  cf: readonly CfResult[],
  cfSys?: Readonly<Record<string, CfSystemResult>>,
): RmfAcc {
  const scps = { ...acc.scps };
  let rcs = acc.rcs;
  for (const lt of lparTicks) {
    for (const t of lt.scps) addScp(scps, lt.lparId, t);
    if (lt.rcs) {
      rcs = rcs ? { ...rcs } : {};
      for (const t of lt.rcs) {
        const k = accKey(lt.lparId, t.scKey);
        const prevMembers = rcs[k]?.members ?? [];
        addScp(rcs, lt.lparId, t);
        const members = t.members.every((m) => prevMembers.includes(m)) ? prevMembers : [...new Set([...prevMembers, ...t.members])].sort();
        rcs[k] = { ...rcs[k]!, members };
      }
    }
  }
  const la = { ...acc.lpars };
  for (const l of lpars) {
    const cp = l.pools.find((p) => p.pool === 'CP');
    const zi = l.pools.find((p) => p.pool === 'ZIIP');
    const icf = l.pools.find((p) => p.pool === 'ICF');
    const a = la[l.id] ?? { lparId: l.id, deliveredCp: 0, effectiveCp: 0, deliveredZiip: 0, deliveredIcf: 0, overhead: 0, capped: 0, prsmDelay: 0, msu: 0, vh: 0, vm: 0, vl: 0, unparkedVl: 0 };
    la[l.id] = {
      ...a,
      deliveredCp: a.deliveredCp + (cp?.deliveredEngines ?? 0),
      effectiveCp: a.effectiveCp + (cp?.effectiveEngines ?? 0),
      deliveredZiip: a.deliveredZiip + (zi?.deliveredEngines ?? 0),
      deliveredIcf: a.deliveredIcf + (icf?.deliveredEngines ?? 0),
      overhead: a.overhead + (cp?.overheadFrac ?? 0),
      capped: a.capped + (cp?.cappedFrac ?? 0),
      wlmCapped: (a.wlmCapped ?? 0) + (cp?.softCappedFrac ?? 0),
      prsmDelay: a.prsmDelay + (cp?.prsmDelayFrac ?? 0),
      mvsBusy: (a.mvsBusy ?? 0) + (cp?.mvsBusyFrac ?? 0),
      msu: a.msu + l.msuRate,
      vh: cp?.vh ?? 0,
      vm: cp?.vm ?? 0,
      vl: cp?.vl ?? 0,
      unparkedVl: a.unparkedVl + (cp?.unparkedVl ?? 0),
    };
  }
  const d = { ...acc.dasd };
  if (dasd) {
    d.ticks++;
    d.iops += dasd.totalIops;
    d.rtRandom += dasd.classes.RANDOM.rtSec;
    d.rtSeq += dasd.classes.SEQ.rtSec;
    d.iosq += dasd.classes.RANDOM.iosqSec;
    d.pend += dasd.classes.RANDOM.pendSec;
    d.disc += dasd.classes.RANDOM.discSec;
    d.conn += dasd.classes.RANDOM.connSec;
  }
  const lc = { ...(acc.lcus ?? {}) };
  for (const l of dasd?.lcus ?? []) {
    const a = lc[l.id] ?? { ios: 0, iosqW: 0, rtW: 0, aliasesPerHot: 0, ticks: 0 };
    lc[l.id] = { ios: a.ios + l.iops, iosqW: a.iosqW + l.iops * l.iosqSec, rtW: a.rtW + l.iops * l.rtSec, aliasesPerHot: a.aliasesPerHot + l.aliasesPerHotVolume, ticks: a.ticks + 1 };
  }
  const c = { ...acc.cf };
  for (const r of cf) {
    const a = c[r.lparId] ?? { busy: 0, rate: 0, sync: 0, async: 0, service: 0, ticks: 0 };
    c[r.lparId] = {
      busy: a.busy + r.busyFrac,
      rate: a.rate + r.requestRate,
      sync: a.sync + r.syncSec,
      async: a.async + r.asyncFrac,
      service: a.service + r.serviceSec,
      ticks: a.ticks + 1,
    };
  }
  const cs = { ...(acc.cfStructures ?? {}) };
  for (const r of cf) {
    for (const st of r.structures ?? []) {
      const a = cs[st.name] ?? { type: st.type, cfLparId: st.cfLparId, rate: 0, syncReq: 0, syncSecW: 0, serviceSecW: 0, ticks: 0 };
      const syncRate = st.requestRate * (1 - st.asyncFrac);
      cs[st.name] = {
        type: st.type,
        cfLparId: st.cfLparId,
        rate: a.rate + st.requestRate,
        syncReq: a.syncReq + syncRate,
        syncSecW: a.syncSecW + syncRate * st.syncSec,
        serviceSecW: a.serviceSecW + st.requestRate * st.serviceSec,
        ticks: a.ticks + 1,
      };
    }
  }
  let sy = acc.cfSystems;
  if (cfSys) {
    sy = { ...(sy ?? {}) };
    for (const id of Object.keys(cfSys).sort()) {
      const r = cfSys[id]!;
      const a = sy[id] ?? { distKm: 0, rate: 0, syncSecW: 0, asyncW: 0, serviceSecW: 0, ticks: 0 };
      sy[id] = { distKm: r.distKm, rate: a.rate + r.requestRate, syncSecW: a.syncSecW + r.requestRate * r.syncSec, asyncW: a.asyncW + r.requestRate * r.asyncFrac, serviceSecW: a.serviceSecW + r.requestRate * r.serviceSec, ticks: a.ticks + 1 };
    }
  }
  return { ...acc, ticks: acc.ticks + 1, scps, lpars: la, dasd: d, lcus: lc, cf: c, cfStructures: cs, ...(sy ? { cfSystems: sy } : {}), ...(rcs ? { rcs } : {}) };
}

// `${lparId}|${scKey}` without building a new string every tick.
const accKeys: Record<string, Record<string, string>> = {};
const accKey = (lparId: string, scKey: string) => ((accKeys[lparId] ??= {})[scKey] ??= `${lparId}|${scKey}`);

function addScp<T extends ScpIntervalAcc>(scps: Record<string, T>, lparId: string, t: ScpTick) {
  const k = accKey(lparId, t.scKey);
  const a: ScpIntervalAcc = scps[k] ?? {
    ...emptyAcc(),
    lparId,
    scKey: t.scKey,
    dp: t.dp,
    ziipEngines: 0,
    iipcpEngines: 0,
    usingCpu: 0,
    usingZiip: 0,
    usingIo: 0,
    delayStorage: 0,
    delayCap: 0,
    failed: 0,
  } as T;
  const members = (a as Partial<RcIntervalAcc>).members;
  // Explicit literal in the accumulator's key order (no spread: hot path, once per period per tick).
  const out: ScpIntervalAcc = {
    completions: a.completions + t.completions,
    rtSumSec: a.rtSumSec + t.rtSumSec,
    buckets: addBuckets(a.buckets, t.buckets),
    using: a.using + t.usingCpu + t.usingZiip + t.usingIo,
    delay: a.delay + t.delayCpu + t.delayZiip + t.delayIo + t.delayStorage + t.delayCap + (t.delayQueue ?? 0),
    delayCpu: a.delayCpu + t.delayCpu,
    delayZiip: a.delayZiip + t.delayZiip,
    delayIo: a.delayIo + t.delayIo,
    delayOther: a.delayOther + t.delayOther,
    delayCap: a.delayCap + t.delayCap,
    cpuEngines: a.cpuEngines + t.cpEngines,
    lparId: a.lparId,
    scKey: a.scKey,
    dp: t.dp,
    ziipEngines: a.ziipEngines + t.ziipEngines,
    iipcpEngines: a.iipcpEngines + t.iipcpEngines,
    usingCpu: a.usingCpu + t.usingCpu,
    usingZiip: a.usingZiip + t.usingZiip,
    usingIo: a.usingIo + t.usingIo,
    delayStorage: a.delayStorage + t.delayStorage,
    ...(t.delayQueue || a.delayQueue ? { delayQueue: (a.delayQueue ?? 0) + (t.delayQueue ?? 0) } : {}),
    failed: a.failed + t.failed,
  };
  scps[k] = (members !== undefined ? { ...out, members } : out) as T;
}

function mergeAcc<T extends ScpIntervalAcc>(p: T, a: ScpIntervalAcc): T {
  return {
    ...p,
    completions: p.completions + a.completions,
    rtSumSec: p.rtSumSec + a.rtSumSec,
    buckets: addBuckets(p.buckets, a.buckets),
    using: p.using + a.using,
    delay: p.delay + a.delay,
    delayCpu: p.delayCpu + a.delayCpu,
    delayZiip: p.delayZiip + a.delayZiip,
    delayIo: p.delayIo + a.delayIo,
    delayOther: p.delayOther + a.delayOther,
    cpuEngines: p.cpuEngines + a.cpuEngines,
    ziipEngines: p.ziipEngines + a.ziipEngines,
    iipcpEngines: p.iipcpEngines + a.iipcpEngines,
    usingCpu: p.usingCpu + a.usingCpu,
    usingZiip: p.usingZiip + a.usingZiip,
    usingIo: p.usingIo + a.usingIo,
    delayStorage: p.delayStorage + a.delayStorage,
    ...(p.delayQueue || a.delayQueue ? { delayQueue: (p.delayQueue ?? 0) + (a.delayQueue ?? 0) } : {}),
    delayCap: p.delayCap + a.delayCap,
    failed: p.failed + a.failed,
  };
}

/** A report class is homogeneous when all its work runs in one service class, heterogeneous when it
 * mixes service classes (whose goals then don't apply). APPROX: RMF reports a homogeneous class per
 * report class period; the game shows one row, with goal and PI only when that is a single period
 * (IBM CICS docs, "Service classes and report classes"). */
function rcRecord(def: ServiceDefinition, lparId: string, a: RcIntervalAcc, ticks: number): WlmRecord {
  const classes = [...new Set(a.members.map((m) => m.split('#')[0]!))];
  const single = a.members.length === 1;
  const base = wlmRecord(def, lparId, single ? { ...a, scKey: a.members[0]! } : a, ticks, null);
  const goalText = single ? base.goalText : classes.length === 1 ? `${classes[0]} ${a.members.length} PERIODS` : `HETEROGENEOUS (${classes.length})`;
  return {
    ...base,
    scKey: a.scKey,
    serviceClass: a.scKey,
    period: 0,
    reportClass: true,
    members: a.members,
    goalText,
    ...(single ? {} : { importance: null, pi: null, buckets: emptyBuckets() }),
  };
}

function wlmRecord(def: ServiceDefinition, lparId: string, a: ScpIntervalAcc, ticks: number, dp: number | null): WlmRecord {
  const g = goalInfo(def, a.scKey);
  const states = a.using + a.delay + a.delayOther;
  const pct = (x: number) => (states > 0 ? (100 * x) / states : 0);
  const sec = ticks * TICK_SEC;
  const goal = g?.goal;
  const p = def.classes.find((c) => c.id === g?.serviceClass)?.periods[g?.period ?? 0];
  return {
    lparId,
    scKey: a.scKey,
    serviceClass: g?.serviceClass ?? a.scKey.split('#')[0]!,
    period: (g?.period ?? 0) + 1,
    goalText: !goal ? 'SYSTEM' : goal.kind === 'DISC' ? 'DISCRETIONARY' : goal.kind === 'VEL' ? `EXECUTION VELOCITY ${goal.velocity}%` : goal.kind === 'AVG' ? `AVG RESPONSE ${goal.rtSec.toFixed(3)}s` : `${goal.pct}% < ${goal.rtSec.toFixed(3)}s`,
    importance: g && goal?.kind !== 'DISC' ? (p?.importance ?? g.importance) : null,
    dp,
    ended: a.completions,
    endPerSec: sec > 0 ? a.completions / sec : 0,
    failed: a.failed,
    avgRtSec: a.completions > 1e-9 ? a.rtSumSec / a.completions : null,
    execVelocity: velocityOf(a.using, a.delay),
    pi: goal ? accPi(goal, a) : null,
    applCpPct: ticks > 0 ? (100 * a.cpuEngines) / ticks : 0,
    applIipcpPct: ticks > 0 ? (100 * a.iipcpEngines) / ticks : 0,
    applIipPct: ticks > 0 ? (100 * a.ziipEngines) / ticks : 0,
    usingPct: { cpu: pct(a.usingCpu), ziip: pct(a.usingZiip), io: pct(a.usingIo) },
    delayPct: { cpu: pct(a.delayCpu), ziip: pct(a.delayZiip), io: pct(a.delayIo), storage: pct(a.delayStorage), cap: pct(a.delayCap), other: pct(a.delayOther), queue: pct(a.delayQueue ?? 0) },
    buckets: a.buckets.length === BUCKETS ? a.buckets : emptyBuckets(),
  };
}

export interface CloseContext {
  def: ServiceDefinition;
  config: WorldConfig;
  r4haByLpar: Readonly<Record<string, number>>;
  jobs: JobEndRecord[];
  endTick: number;
}

export function closeInterval(acc: RmfAcc, ctx: CloseContext): RmfInterval {
  const n = Math.max(1, acc.ticks);
  const wlm: WlmRecord[] = [];
  const plex: Record<string, ScpIntervalAcc> = {};
  for (const a of Object.values(acc.scps)) {
    wlm.push(wlmRecord(ctx.def, a.lparId, a, n, a.dp));
    const p = plex[a.scKey];
    plex[a.scKey] = p ? mergeAcc(p, a) : { ...a, lparId: '*PLEX', buckets: [...a.buckets] };
  }
  for (const a of Object.values(plex)) wlm.push(wlmRecord(ctx.def, '*PLEX', a, n, null));

  let wlmRc: WlmRecord[] | undefined;
  if (acc.rcs) {
    wlmRc = [];
    const plexRc: Record<string, RcIntervalAcc> = {};
    for (const a of Object.values(acc.rcs)) {
      wlmRc.push(rcRecord(ctx.def, a.lparId, a, n));
      const p = plexRc[a.scKey];
      plexRc[a.scKey] = p ? { ...mergeAcc(p, a), members: [...new Set([...p.members, ...a.members])].sort() } : { ...a, lparId: '*PLEX', buckets: [...a.buckets] };
    }
    for (const a of Object.values(plexRc)) wlmRc.push(rcRecord(ctx.def, '*PLEX', a, n));
  }

  const cpu: CpuRecord[] = Object.values(acc.lpars).map((a) => {
    const cfg = ctx.config.lpars.find((l) => l.id === a.lparId);
    const cp = cfg?.pools.find((p) => p.pool === 'CP');
    return {
      lparId: a.lparId,
      weight: cp?.weight ?? 0,
      logicalCps: cp?.logical ?? 0,
      polarity: cfg?.hiperDispatch && cp ? `${a.vh}VH ${a.vm}VM ${a.vl}VL` : 'HORIZ',
      physicalEngines: a.deliveredCp / n,
      logicalBusyPct: cp && cp.logical > 0 ? (100 * a.deliveredCp) / n / cp.logical : 0,
      mvsBusyPct: (100 * (a.mvsBusy ?? 0)) / n,
      overheadPct: (100 * a.overhead) / n,
      cappedPct: (100 * a.capped) / n,
      wlmCappingPct: (100 * (a.wlmCapped ?? 0)) / n,
      prsmDelayPct: (100 * a.prsmDelay) / n,
      msuAvg: a.msu / n,
      r4ha: ctx.r4haByLpar[a.lparId] ?? 0,
      definedCapacityMsu: cfg?.definedCapacityMsu ?? null,
      absoluteCapEngines: cp?.absoluteCapEngines ?? null,
      ziipEngines: a.deliveredZiip / n,
      icfEngines: a.deliveredIcf / n,
    };
  });
  const cpcBusy = ctx.config.cpcs.flatMap((c) =>
    (['CP', 'ZIIP', 'ICF'] as const).map((pool) => {
      const used = ctx.config.lpars
        .filter((l) => l.cpcId === c.id)
        .reduce((s, l) => {
          const a = acc.lpars[l.id];
          if (!a) return s;
          return s + (pool === 'CP' ? a.deliveredCp : pool === 'ZIIP' ? a.deliveredZiip : a.deliveredIcf) / n;
        }, 0);
      return { cpcId: c.id, pool, physicalBusyPct: c.engines[pool] > 0 ? (100 * used) / c.engines[pool] : 0 };
    }),
  );
  const dt = Math.max(1, acc.dasd.ticks);
  const ms = (x: number) => (1000 * x) / dt;
  return {
    startTick: acc.startTick,
    endTick: ctx.endTick,
    intervalSec: acc.ticks * TICK_SEC,
    policy: ctx.def.policyName,
    cpu,
    cpcBusy,
    wlm,
    ...(wlmRc ? { wlmRc } : {}),
    dasd: { iops: acc.dasd.iops / dt, rtRandomMs: ms(acc.dasd.rtRandom), rtSeqMs: ms(acc.dasd.rtSeq), iosqMs: ms(acc.dasd.iosq), pendMs: ms(acc.dasd.pend), discMs: ms(acc.dasd.disc), connMs: ms(acc.dasd.conn) },
    cf: Object.entries(acc.cf).map(([lparId, a]) => ({
      lparId,
      busyPct: (100 * a.busy) / a.ticks,
      reqPerSec: a.rate / a.ticks,
      syncUs: (1e6 * a.sync) / a.ticks,
      asyncPct: (100 * a.async) / a.ticks,
      serviceUs: (1e6 * a.service) / a.ticks,
    })),
    lcus: ctx.config.dasd.lcus.map((l) => {
      const a = acc.lcus?.[l.id];
      return {
        id: l.id,
        label: l.label,
        volumes: l.volumes,
        aliases: l.aliases,
        iops: a ? a.ios / Math.max(1, a.ticks) : 0,
        iosqMs: a && a.ios > 0 ? (1000 * a.iosqW) / a.ios : 0,
        rtMs: a && a.ios > 0 ? (1000 * a.rtW) / a.ios : 0,
        aliasesPerHotVol: a ? a.aliasesPerHot / Math.max(1, a.ticks) : 0,
      };
    }),
    cfStructures: Object.entries(acc.cfStructures ?? {})
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, a]) => ({
        name,
        type: a.type,
        cfLparId: a.cfLparId,
        reqPerSec: a.rate / Math.max(1, a.ticks),
        syncPct: a.rate > 0 ? (100 * a.syncReq) / a.rate : 0,
        syncUs: a.syncReq > 0 ? (1e6 * a.syncSecW) / a.syncReq : 0,
        serviceUs: a.rate > 0 ? (1e6 * a.serviceSecW) / a.rate : 0,
      })),
    ...(acc.cfSystems
      ? {
          cfSystems: Object.entries(acc.cfSystems)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .filter(([, a]) => a.rate > 0)
            .map(([system, a]) => ({
              system,
              distKm: a.distKm,
              reqPerSec: a.rate / Math.max(1, a.ticks),
              syncUs: (1e6 * a.syncSecW) / a.rate,
              asyncPct: (100 * a.asyncW) / a.rate,
              serviceUs: (1e6 * a.serviceSecW) / a.rate,
            })),
        }
      : {}),
    jobs: ctx.jobs,
  };
}
