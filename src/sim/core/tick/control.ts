import type { CfSystemResult } from '../../cf/cf';
import { accrueTfp, closeMonth, recordHour } from '../../cost/mlc';
import { groupShares, newR4ha, stepR4ha } from '../../cost/r4ha';
import { accumulateTick, closeInterval, newRmfAcc, type JobEndRecord } from '../../measure/rmf';
import { msuPerCp } from '../../hw/cpc';
import { poolKey, resolveCpc } from '../../hw/pools';
import { policyAdjust } from '../../wlm/adjust';
import { sysplexPis, type WlmSystemState } from '../../wlm/runtime';
import { clockAt } from '../clock';
import type { LparConfig, EnvState, SimState } from '../types';
import { TICK_SEC } from '../units';
import { RMF_KEEP, type TickCtx, WLM_LOG_MAX } from './ctx';

/** 6. Soft capping: LPARs whose R4HA exceeds their defined capacity, and members of capacity
 * groups over their limit, are held to their MSU share. */
export function softCap(t: TickCtx): void {
  const { prev, config, cpcOf, demands } = t;
  for (const d of demands) {
    if (d.pool !== 'CP') continue;
    const l = config.lpars.find((x) => x.id === d.lparId)!;
    const msuCp = msuPerCp(cpcOf[l.cpcId]!);
    const r = prev.capping.lpars.find((x) => x.id === l.id);
    let capMsu = Infinity;
    if (r?.capped && l.definedCapacityMsu !== null) capMsu = l.definedCapacityMsu;
    const g = l.capacityGroup ? config.capacityGroups.find((x) => x.id === l.capacityGroup) : undefined;
    const gs = g ? prev.capping.groups.find((x) => x.id === g.id) : undefined;
    if (g && gs?.capped) {
      const members = config.lpars.filter((x) => x.capacityGroup === g.id);
      const shares = groupShares(
        g.limitMsu,
        members.map((m) => ({
          id: m.id,
          weight: m.pools.find((p) => p.pool === 'CP')?.weight ?? 0,
          demandMsu: (demands.find((x) => x.lparId === m.id && x.pool === 'CP')?.demandEngines ?? 0) * msuPerCp(cpcOf[m.cpcId]!),
        })),
      );
      capMsu = Math.min(capMsu, shares[l.id] ?? capMsu);
    }
    if (capMsu < Infinity) d.softCapEngines = capMsu / msuCp;
  }
}

/** 5. PR/SM: resolve each CPC's pools against this tick's demand into `t.lpars`. */
export function prsm(t: TickCtx): void {
  const { config, demands, lpars } = t;
  for (const cpc of config.cpcs) {
    const res = resolveCpc(cpc, config.lpars, demands);
    const msuCp = msuPerCp(cpc);
    for (const l of config.lpars) {
      if (l.cpcId !== cpc.id) continue;
      const pools = l.pools.flatMap((p) => {
        const r = res[poolKey(l.id, p.pool)];
        return r ? [r] : [];
      });
      const cpRt = pools.find((p) => p.pool === 'CP');
      lpars.push({ id: l.id, pools, msuRate: l.kind === 'ZOS' ? (cpRt?.deliveredEngines ?? 0) * msuCp : 0 });
    }
  }
}

/** 12b. Policy adjustment, one receiver per system. */
export function adjustPolicies(t: TickCtx, clockText: string): { adjusted: WlmSystemState[]; log: string[] } {
  const { prev, def, config, systems, lparTicks, evalInputs } = t;
  const spPi = sysplexPis(def, systems);
  // The previous log is only copied once a line is added (states are never mutated in place).
  let log = prev.wlm.log;
  const adjusted = systems.map((sys) => {
    const lt = lparTicks.find((x) => x.lparId === sys.lparId)!;
    const out = policyAdjust({
      def,
      system: sys,
      evalInput: evalInputs[sys.lparId]!,
      current: lt.scps,
      sysplexPi: spPi,
      clockText,
      ccImp: config.systems.find((c) => c.lparId === sys.lparId)?.ccImp,
    });
    if (out.log && (out.log.includes('RCVR=') || prev.tick % 30 === 0)) {
      if (log === prev.wlm.log) log = [...log];
      log.push(out.log);
    }
    // This tick's period states are fresh objects: apply the new DPs in place.
    for (const s of sys.scps) s.dp = out.dps[s.scKey] ?? s.dp;
    return sys;
  });
  if (log.length > WLM_LOG_MAX) {
    if (log === prev.wlm.log) log = [...log];
    while (log.length > WLM_LOG_MAX) log.shift();
  }
  return { adjusted, log };
}

/** R4HA bookkeeping and soft-cap decisions for the next tick. */
export function stepCapping(t: TickCtx, zosLpars: readonly LparConfig[]) {
  const { prev, config, lpars } = t;
  const msuBy: Record<string, number> = {};
  for (const l of lpars) msuBy[l.id] = l.msuRate;
  const cappingLpars = zosLpars.map((l) =>
    stepR4ha(prev.capping.lpars.find((x) => x.id === l.id) ?? newR4ha(l.id), msuBy[l.id] ?? 0, l.definedCapacityMsu),
  );
  const cappingGroups = config.capacityGroups.map((g) => {
    const msu = config.lpars.filter((l) => l.capacityGroup === g.id).reduce((a, l) => a + (msuBy[l.id] ?? 0), 0);
    return stepR4ha(prev.capping.groups.find((x) => x.id === g.id) ?? newR4ha(g.id), msu, g.limitMsu);
  });
  const r4haBy: Record<string, number> = {};
  for (const r of cappingLpars) r4haBy[r.id] = r.r4ha;
  return { cappingLpars, cappingGroups, msuBy, r4haBy };
}

/** MLC: hourly SCRT-style sample, monthly bill. */
export function stepCost(t: TickCtx, zosLpars: readonly LparConfig[], msuBy: Record<string, number>, r4haBy: Record<string, number>, nextTick: number): SimState['cost'] {
  const { prev, scenario, config, clock } = t;
  let cost = prev.cost.tfp ? accrueTfp(prev.cost, scenario.products, msuBy, TICK_SEC) : prev.cost;
  if (nextTick % 360 === 0) {
    const dcBy: Record<string, number | null> = {};
    for (const l of zosLpars) dcBy[l.id] = l.definedCapacityMsu;
    const groupLimits = config.capacityGroups.map((g) => ({ limitMsu: g.limitMsu, members: config.lpars.filter((l) => l.capacityGroup === g.id).map((l) => l.id) }));
    cost = recordHour(cost, scenario.products, r4haBy, dcBy, nextTick, groupLimits);
  }
  if (clockAt(nextTick).dayOfMonth === 1 && clock.dayOfMonth !== 1) cost = closeMonth(cost, scenario.products);
  return cost;
}

/** RMF interval data. */
export function stepRmf(
  t: TickCtx,
  batch: SimState['batch'],
  dasd: EnvState['dasd'],
  cf: EnvState['cf'],
  r4haBy: Record<string, number>,
  nextTick: number,
  cfBySystem: Record<string, CfSystemResult>,
): SimState['rmf'] {
  const { prev, def, config, lparTicks, lpars } = t;
  const jobsEnded: JobEndRecord[] = [];
  for (const j of batch.jobs) {
    if (j.endTick !== nextTick || j.startTick === null) continue;
    jobsEnded.push({
      name: j.def.name,
      stream: j.def.stream,
      lparId: j.lparId ?? '',
      critical: j.def.critical,
      queuedSec: ((j.startTick ?? 0) - (j.queuedTick ?? j.startTick ?? 0)) * TICK_SEC,
      elapsedSec: (nextTick - (j.startTick ?? nextTick)) * TICK_SEC,
      endTick: nextTick,
      stretch: j.stretch,
    });
  }
  let acc = accumulateTick(prev.rmf.acc, lparTicks, lpars, dasd, cf, cfBySystem);
  let jobsThisInterval = jobsEnded.length ? [...prev.rmf.jobsThisInterval, ...jobsEnded] : prev.rmf.jobsThisInterval;
  let intervals = prev.rmf.intervals;
  const intervalTicks = Math.max(1, Math.round((config.rmfIntervalMin * 60) / TICK_SEC));
  if (nextTick % intervalTicks === 0) {
    intervals = [...intervals, closeInterval(acc, { def, config, r4haByLpar: r4haBy, jobs: jobsThisInterval, endTick: nextTick })];
    if (intervals.length > RMF_KEEP) intervals = intervals.slice(intervals.length - RMF_KEEP);
    acc = newRmfAcc(nextTick);
    jobsThisInterval = [];
  }
  return { acc, intervals, jobsThisInterval };
}

