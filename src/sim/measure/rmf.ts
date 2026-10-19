// SMF/RMF interval data (SPEC §5.12). Accumulates per-tick measurements and closes an
// interval into records shaped like SMF 70.1 (CPU/partition), 72.3 (workload activity),
// 74.1 (DASD), 74.4 (CF) and 30 (job end).

import type { CfResult } from '../cf/cf';
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
  prsmDelay: number;
  msu: number;
  vh: number;
  vm: number;
  vl: number;
  unparkedVl: number;
}

export interface RmfAcc {
  startTick: number;
  ticks: number;
  scps: Record<string, ScpIntervalAcc>;
  lpars: Record<string, LparIntervalAcc>;
  dasd: { ticks: number; iops: number; rtRandom: number; iosq: number; pend: number; disc: number; conn: number; rtSeq: number };
  cf: Record<string, { busy: number; rate: number; sync: number; async: number; service: number; ticks: number }>;
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
  delayPct: { cpu: number; ziip: number; io: number; storage: number; cap: number; other: number };
  buckets: number[];
}

export interface CpuRecord {
  lparId: string;
  weight: number;
  logicalCps: number;
  polarity: string;
  /** Average physical CP engines dispatched for this LPAR. */
  physicalEngines: number;
  logicalBusyPct: number;
  overheadPct: number;
  cappedPct: number;
  prsmDelayPct: number;
  msuAvg: number;
  r4ha: number;
  definedCapacityMsu: number | null;
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
  dasd: { iops: number; rtRandomMs: number; rtSeqMs: number; iosqMs: number; pendMs: number; discMs: number; connMs: number };
  cf: { lparId: string; busyPct: number; reqPerSec: number; syncUs: number; asyncPct: number; serviceUs: number }[];
  jobs: JobEndRecord[];
}

export const newRmfAcc = (startTick: number): RmfAcc => ({
  startTick,
  ticks: 0,
  scps: {},
  lpars: {},
  dasd: { ticks: 0, iops: 0, rtRandom: 0, iosq: 0, pend: 0, disc: 0, conn: 0, rtSeq: 0 },
  cf: {},
});

export function accumulateTick(
  acc: RmfAcc,
  lparTicks: readonly LparTick[],
  lpars: readonly LparRuntime[],
  dasd: DasdResult | null,
  cf: readonly CfResult[],
): RmfAcc {
  const scps = { ...acc.scps };
  for (const lt of lparTicks) {
    for (const t of lt.scps) addScp(scps, lt.lparId, t);
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
      prsmDelay: a.prsmDelay + (cp?.prsmDelayFrac ?? 0),
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
  return { ...acc, ticks: acc.ticks + 1, scps, lpars: la, dasd: d, cf: c };
}

function addScp(scps: Record<string, ScpIntervalAcc>, lparId: string, t: ScpTick) {
  const k = `${lparId}|${t.scKey}`;
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
  };
  scps[k] = {
    ...a,
    dp: t.dp,
    completions: a.completions + t.completions,
    rtSumSec: a.rtSumSec + t.rtSumSec,
    buckets: a.buckets.map((b, i) => b + (t.buckets[i] ?? 0)),
    using: a.using + t.usingCpu + t.usingZiip + t.usingIo,
    delay: a.delay + t.delayCpu + t.delayZiip + t.delayIo + t.delayStorage + t.delayCap,
    delayCpu: a.delayCpu + t.delayCpu,
    delayZiip: a.delayZiip + t.delayZiip,
    delayIo: a.delayIo + t.delayIo,
    delayOther: a.delayOther + t.delayOther,
    cpuEngines: a.cpuEngines + t.cpEngines,
    ziipEngines: a.ziipEngines + t.ziipEngines,
    iipcpEngines: a.iipcpEngines + t.iipcpEngines,
    usingCpu: a.usingCpu + t.usingCpu,
    usingZiip: a.usingZiip + t.usingZiip,
    usingIo: a.usingIo + t.usingIo,
    delayStorage: a.delayStorage + t.delayStorage,
    delayCap: a.delayCap + t.delayCap,
    failed: a.failed + t.failed,
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
    delayPct: { cpu: pct(a.delayCpu), ziip: pct(a.delayZiip), io: pct(a.delayIo), storage: pct(a.delayStorage), cap: pct(a.delayCap), other: pct(a.delayOther) },
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
    if (!p) plex[a.scKey] = { ...a, lparId: '*PLEX', buckets: [...a.buckets] };
    else {
      plex[a.scKey] = {
        ...p,
        completions: p.completions + a.completions,
        rtSumSec: p.rtSumSec + a.rtSumSec,
        buckets: p.buckets.map((b, i) => b + (a.buckets[i] ?? 0)),
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
        delayCap: p.delayCap + a.delayCap,
        failed: p.failed + a.failed,
      };
    }
  }
  for (const a of Object.values(plex)) wlm.push(wlmRecord(ctx.def, '*PLEX', a, n, null));

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
      overheadPct: (100 * a.overhead) / n,
      cappedPct: (100 * a.capped) / n,
      prsmDelayPct: (100 * a.prsmDelay) / n,
      msuAvg: a.msu / n,
      r4ha: ctx.r4haByLpar[a.lparId] ?? 0,
      definedCapacityMsu: cfg?.definedCapacityMsu ?? null,
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
    dasd: { iops: acc.dasd.iops / dt, rtRandomMs: ms(acc.dasd.rtRandom), rtSeqMs: ms(acc.dasd.rtSeq), iosqMs: ms(acc.dasd.iosq), pendMs: ms(acc.dasd.pend), discMs: ms(acc.dasd.disc), connMs: ms(acc.dasd.conn) },
    cf: Object.entries(acc.cf).map(([lparId, a]) => ({
      lparId,
      busyPct: (100 * a.busy) / a.ticks,
      reqPerSec: a.rate / a.ticks,
      syncUs: (1e6 * a.sync) / a.ticks,
      asyncPct: (100 * a.async) / a.ticks,
      serviceUs: (1e6 * a.service) / a.ticks,
    })),
    jobs: ctx.jobs,
  };
}
