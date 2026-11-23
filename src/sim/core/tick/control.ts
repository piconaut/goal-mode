import type { CfSystemResult } from '../../cf/cf';
import { accrueTfp, accrueUsage, closeMonth, recordHour } from '../../cost/mlc';
import { groupShares, groupMemberR4ha, newR4ha, R4HA_WINDOW_TICKS, stepR4ha, type R4haState } from '../../cost/r4ha';
import { accumulateTick, closeInterval, newRmfAcc, type GroupView, type JobEndRecord } from '../../measure/rmf';
import { msuPerCp } from '../../hw/cpc';
import { poolKey, resolveCpc } from '../../hw/pools';
import { policyAdjust } from '../../wlm/adjust';
import { jobCpuDemand } from '../../subsys/batch';
import { sysplexPis, type WlmSystemState } from '../../wlm/runtime';
import { clockAt } from '../clock';
import type { LparConfig, EnvState, SimState } from '../types';
import { CLUE_LOG_EVERY } from '../../../content/wlm/tuning';
import { PRSM } from '../../../content/hardware';
import { TICKS_PER_HOUR, TICK_SEC } from '../units';
import { RMF_KEEP, type TickCtx, WLM_LOG_MAX } from './ctx';
import { atOrFind } from './plan';

/** 6. Soft capping: LPARs whose R4HA exceeds their defined capacity, and members of capacity
 * groups over their limit, are held to their MSU share. */
export function softCap(t: TickCtx): void {
  const { prev, plan, cpcOf, demands } = t;
  for (const d of demands) {
    if (d.pool !== 'CP') continue;
    const l = plan.lparById[d.lparId]!;
    const msuCp = msuPerCp(cpcOf[l.cpcId]!);
    // prev.capping.lpars follows the z/OS image order.
    const r = atOrFind(prev.capping.lpars, plan.byLparId[l.id]?.zosIdx ?? -1, (x) => x.id === l.id);
    let capMsu = Infinity;
    if (r?.capped && l.definedCapacityMsu !== null) capMsu = l.definedCapacityMsu;
    const g = l.capacityGroup ? plan.groupOf[l.capacityGroup] : undefined;
    const gs = g ? prev.capping.groups.find((x) => x.id === g.id) : undefined;
    const join = g ? prev.capping.groupJoinTicks?.[g.id]?.[l.id] : undefined;
    // A limit change restarts the window at the end of this tick (stepCapping); do not cap on the old view against
    // the new limit in the meantime, so a raised limit takes effect at once rather than one tick late.
    const limitChanged = g && prev.capping.groupLimitsMsu?.[g.id] !== undefined && prev.capping.groupLimitsMsu[g.id] !== g.limitMsu;
    // Each member's own view of the group's average decides its cap (RF-08): a member that joined under four hours
    // ago sees a lower used average and may not be capped while the others are.
    if (g && gs && join !== undefined && !limitChanged && groupMemberR4ha(gs, join, prev.tick) > g.limitMsu) {
      const members = plan.groupMembers[g.id]!;
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
    if (capMsu < Infinity) {
      // The limit is in MSU, which RF-05 charges on effective dispatch (delivered engines less the LPAR management
      // share). The cap itself is a limit on delivered engines, so divide the effective-dispatch limit by the
      // smallest usable share any partition can have: the base PR/SM overhead is always charged, and the exact
      // share for this tick is known only after allocation. Sized this way the capped MSU rate cannot exceed the
      // limit; it can sit up to the rest of the overhead below it (APPROX).
      const usable = 1 - PRSM.baseOverheadFrac;
      d.softCapEngines = capMsu / msuCp / usable;
    }
  }
}

/** 5. PR/SM: resolve each CPC's pools against this tick's demand into `t.lpars`. */
export function prsm(t: TickCtx): void {
  const { config, demands, lpars } = t;
  for (const cpc of config.cpcs) {
    const res = resolveCpc(cpc, config.lpars, demands);
    for (const l of config.lpars) {
      if (l.cpcId !== cpc.id) continue;
      const pools = l.pools.flatMap((p) => {
        const r = res[poolKey(l.id, p.pool)];
        return r ? [r] : [];
      });
      // z/OS dispatch fills consumption after it has used the PR/SM offer.
      lpars.push({ id: l.id, pools, msuRate: 0 });
    }
  }
}

const LINE_HEAD = /^D(\d+) (\d\d):(\d\d):(\d\d) (\S+) (\S+) /;
const lineTick = (m: RegExpExecArray) => (Number(m[1]) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4])) / 10;
/** A no-action note without its clock, PI and next look: what WLM tried and why it was rejected. */
const clueOf = (line: string) => line.replace(LINE_HEAD, '$5 $6 ').replace(/ PI=[\d.]+/, '').replace(/, next look \S+$/, '');

/** True when the last line about this note's receiver on its system is the same clue, less than 5 minutes old. */
export function repeatsClue(log: readonly string[], note: string): boolean {
  const m = LINE_HEAD.exec(note);
  if (!m) return false;
  const named = ` ${m[5]} ${m[6]} `, received = ` ${m[5]} RCVR=${m[6]} `;
  for (let i = log.length - 1; i >= 0; i--) {
    const l = log[i]!;
    if (!l.includes(named) && !l.includes(received)) continue;
    const p = LINE_HEAD.exec(l);
    return p !== null && lineTick(m) - lineTick(p) < CLUE_LOG_EVERY && clueOf(l) === clueOf(note);
  }
  return false;
}

/** 12b. Policy adjustment, one receiver per system. */
export function adjustPolicies(t: TickCtx, clockText: string): { adjusted: WlmSystemState[]; log: string[] } {
  const { prev, def, plan, systems, lparTicks, evalInputs } = t;
  const spPi = sysplexPis(def, systems);
  // The previous log is only copied once a line is added (states are never mutated in place).
  let log = prev.wlm.log;
  // dispatchLpar pushes one system and one LPAR tick per image, in the same order.
  const adjusted = systems.map((sys, i) => {
    const lt = atOrFind(lparTicks, i, (x) => x.lparId === sys.lparId)!;
    const evalInput = evalInputs[sys.lparId]!;
    const out = policyAdjust({
      def,
      system: sys,
      evalInput,
      current: lt.scps,
      sysplexPi: spPi,
      clockText,
      ccImp: plan.byLparId[sys.lparId]?.system?.ccImp,
      nowTick: prev.tick,
      batch: evalInput.ziipServers > 0 ? t.batchRefsBy[sys.lparId]?.map((r) => ({
        key: r.slice.key,
        jobs: r.jobs.map((j) => {
          const next = jobCpuDemand(j.shape, j.job, true);
          return { ...j, nextCp: next.cp + j.cfCpEngines, nextZi: next.ziip };
        }),
      })) : undefined,
    });
    if (out.protect) {
      if (log === prev.wlm.log) log = [...log];
      log.push(out.protect);
    }
    // A receiver whose clue would otherwise wait for the five-minute no-action cadence is logged now: a new skip
    // clock, or the cadence itself for a rejection at five or fewer missing where no clock starts (RF-03). An
    // unchanged clue for the same receiver is repeated at most every 5 minutes (`repeatsClue`).
    for (const note of out.clockNotes) {
      if (repeatsClue(log, note)) continue;
      if (log === prev.wlm.log) log = [...log];
      log.push(note);
    }
    if (out.log && !out.clockNotes.includes(out.log) && (out.log.includes('RCVR=') || prev.tick % CLUE_LOG_EVERY === 0)) {
      if (log === prev.wlm.log) log = [...log];
      log.push(out.log);
    }
    // This tick's period states are fresh objects: apply the new DPs in place.
    for (const s of sys.scps) {
      s.dp = out.dps[s.scKey] ?? s.dp;
      const clock = out.skipUntil[s.scKey];
      if (clock !== undefined) s.skipUntilTick = clock;
      else delete s.skipUntilTick;
      if (s.scKey === out.resumeAt) s.resumeSearch = true;
      else delete s.resumeSearch;
    }
    if (out.servers) sys.servers = out.servers;
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
  const { prev, plan, config, lpars } = t;
  const nextTick = prev.tick + 1;
  const msuBy: Record<string, number> = {};
  for (const l of lpars) msuBy[l.id] = l.msuRate;
  const cappingLpars = zosLpars.map((l, i) =>
    stepR4ha(atOrFind(prev.capping.lpars, i, (x) => x.id === l.id) ?? newR4ha(l.id), msuBy[l.id] ?? 0, l.definedCapacityMsu),
  );
  // Group windows: the group's combined rate fills each member's view from that member's join (RF-08). A member
  // joining an existing group keeps the group's slots but counts the ones before its join as zero, so its view of
  // used capacity is lower for up to four hours. The state is rebuilt from the current configuration each tick, so a
  // removed group or member leaves nothing behind.
  const groupJoinTicks: Record<string, Record<string, number>> = {};
  const groupLimitsMsu: Record<string, number> = {};
  const cappingGroups: R4haState[] = [];
  const groupByLpar: Record<string, GroupView> = {};
  for (const g of config.capacityGroups) {
    const members = plan.groupMembers[g.id] ?? [];
    const msu = members.reduce((a, l) => a + (msuBy[l.id] ?? 0), 0);
    // A limit change restarts the group window and every member's view: IBM allows the limit to be exceeded for the
    // four hours after a capacity change, as after a definition (Planning for Sub-Capacity Pricing PDF p.69
    // (printed 53)). A state without a stored limit (a save from before RF-08) also starts afresh.
    const prevLimit = prev.capping.groupLimitsMsu?.[g.id];
    const restarted = prevLimit === undefined ? prev.capping.groups.some((x) => x.id === g.id) : prevLimit !== g.limitMsu;
    const gs = stepR4ha(restarted ? newR4ha(g.id) : (prev.capping.groups.find((x) => x.id === g.id) ?? newR4ha(g.id)), msu, g.limitMsu);
    cappingGroups.push(gs);
    groupLimitsMsu[g.id] = g.limitMsu;
    const joins = (groupJoinTicks[g.id] ??= {});
    for (const m of members) {
      // A member the last state already knew keeps its join; a new one (or every member after a limit change)
      // starts its zero-filled view at this tick.
      const join = restarted ? prev.tick : (prev.capping.groupJoinTicks?.[g.id]?.[m.id] ?? prev.tick);
      joins[m.id] = join;
      const used = groupMemberR4ha(gs, join, nextTick);
      groupByLpar[m.id] = {
        id: g.id,
        limitMsu: g.limitMsu,
        availableMsu: g.limitMsu - used,
        newLimit: nextTick - join < R4HA_WINDOW_TICKS,
      };
    }
  }
  const r4haBy: Record<string, number> = {};
  for (const r of cappingLpars) r4haBy[r.id] = r.r4ha;
  return { cappingLpars, cappingGroups, groupJoinTicks, groupLimitsMsu, groupByLpar, msuBy, r4haBy };
}

/** MLC: hourly SCRT-style sample, monthly bill. */
export function stepCost(t: TickCtx, zosLpars: readonly LparConfig[], msuBy: Record<string, number>, r4haBy: Record<string, number>, nextTick: number): SimState['cost'] {
  const { prev, scenario, config, clock } = t;
  let cost = accrueUsage(prev.cost, scenario.products, msuBy, TICK_SEC);
  if (cost.tfp) cost = accrueTfp(cost, scenario.products, msuBy, TICK_SEC);
  if (nextTick % TICKS_PER_HOUR === 0) {
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
  groupByLpar: Record<string, GroupView>,
  nextTick: number,
  cfBySystem: Record<string, CfSystemResult>,
  lockIndex = 0,
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
  let acc = accumulateTick(prev.rmf.acc, lparTicks, lpars, dasd, cf, cfBySystem, lockIndex);
  let jobsThisInterval = jobsEnded.length ? [...prev.rmf.jobsThisInterval, ...jobsEnded] : prev.rmf.jobsThisInterval;
  let intervals = prev.rmf.intervals;
  const intervalTicks = Math.max(1, Math.round((config.rmfIntervalMin * 60) / TICK_SEC));
  if (nextTick % intervalTicks === 0) {
    intervals = [...intervals, closeInterval(acc, { def, config, r4haByLpar: r4haBy, groupByLpar, jobs: jobsThisInterval, endTick: nextTick })];
    if (intervals.length > RMF_KEEP) intervals = intervals.slice(intervals.length - RMF_KEEP);
    acc = newRmfAcc(nextTick);
    jobsThisInterval = [];
  }
  return { acc, intervals, jobsThisInterval };
}

