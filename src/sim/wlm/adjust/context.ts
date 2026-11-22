import { PCT_PROJECTION_SIGMA, POLICY_ADJUST } from '../../../content/wlm/tuning';
import { evaluateLpar, prepareLpar, type LparEvalInput, type ScpTick } from '../evaluate';
import { projectionInput } from '../projection';
import { batchRecoveryAccepts } from '../batchProjection';
import { projectBatchRtPi } from '../batchRt';
import { projectedPercentilePi } from '../goals';
import { ACC_DECAY, goalPi, goalInfo, tickPi, type ScpGoalInfo, type ScpState } from '../runtime';
import { expandHolderDps, holderOf, holderTopology, servedKeys } from '../holders';
import type { Ladder } from '../ladder';
import { managementWorstPi } from './donors';
import { cpuProtected, enforceCpuProtection, ladderAt, withLadder } from './protection';
import type { AdjustInput } from './types';

/** One adjustment's inputs and derived lookups. Projection caches are recreated for each policyAdjust call. */
export function createAdjustContext(input: AdjustInput) {
  const { def, system } = input;
  const held: Record<string, number> = {};
  for (const s of system.scps) held[s.scKey] = s.dp;

  const info: Record<string, ScpGoalInfo> = {};
  for (const s of system.scps) {
    const g = goalInfo(def, s.scKey);
    if (g && g.goal.kind !== 'DISC') info[s.scKey] = g;
  }
  // Holders (WT-09, docs/wlm-design.md §5.1): CICS transaction periods hold no DP of their own; their server period
  // does. A region class whose members on the image are all transaction-server regions is attached (`holderTopology`):
  // neither receiver nor donor, and it reports the regions' DP.
  const regions = input.evalInput.regions;
  const topo = holderTopology(regions, Object.keys(info), input.evalInput.slices);
  const server = topo.serverKey;
  for (const k of topo.attached) delete info[k];
  if (server) {
    const kept = system.servers?.find((x) => x.key === server)?.dp;
    held[server] = kept ?? Math.max(...servedKeys(topo).map((k) => held[k] ?? 0));
  }
  const infoKeys = Object.keys(info).sort();
  const hold = (k: string) => holderOf(topo, k);
  const ccImp = input.ccImp ?? 0;
  /** Holders and what CPU protection needs of them: a server period has its most important served class's importance
   * and is protected when any class it serves is. */
  const holderInfo: Record<string, Pick<ScpGoalInfo, 'cpuCritical' | 'period' | 'importance'>> = {};
  for (const k of infoKeys) {
    const h = hold(k);
    if (h === k) {
      holderInfo[k] = info[k]!;
      continue;
    }
    const g = info[k]!;
    const prev = holderInfo[h];
    const prot = cpuProtected(g, ccImp) || (prev?.cpuCritical ?? false);
    holderInfo[h] = { importance: Math.min(prev?.importance ?? 5, g.importance) as ScpGoalInfo['importance'], cpuCritical: prot, period: prot ? 0 : 1 };
  }
  const holderKeys = Object.keys(holderInfo).sort();
  // Protection is restored first, so receivers are assessed (and trials judged) from DPs that keep it.
  // The ladder is made canonical here too, so every trial and the result are canonical (I9).
  const { dps: protectedDps, moves: protection } = enforceCpuProtection(held, holderInfo, ccImp);
  const dps = expandHolderDps(topo, protectedDps);
  const ladder = ladderAt(dps, holderKeys);
  const protect = protection.length > 0 ? `${input.clockText} ${system.lparId} CPU PROTECTION ${protection.join(', ')}` : null;
  const localPi: Record<string, number | null> = {};
  for (const s of system.scps) {
    const g = info[s.scKey];
    localPi[s.scKey] = g ? goalPi(g.goal, s.acc) : null;
  }
  // z/OS 1.11: while few periods miss their goals, a skip clock is not honoured (Sinram, SHARE 2010 session 7777,
  // PDF p.11 (printed 14): "5 or less service class periods"). A clock is neither kept nor started,
  // so every candidate is assessed again next interval. APPROX: the count is per image, as policy adjustment is.
  const missingGoals = infoKeys.filter((k) => (localPi[k] ?? 0) > 1).length;
  const honourSkipClock = missingGoals > POLICY_ADJUST.skipClockMinMissing;
  const tickOf: Record<string, ScpTick> = {};
  for (const t of input.current) tickOf[t.scKey] = t;
  const accOf: Record<string, ScpState> = {};
  for (const s of system.scps) accOf[s.scKey] = s;
  // Batch RT history can be projected only while the period still has address-space work in the evaluation. Without
  // it, a decayed rtQueueSumSec from an old job must not displace the analytic transaction projection when the class
  // serves transactions (B1: shared JES/DDF classification or a policy reclassification).
  const addressSpaceKeys = new Set<string>();
  for (const s of input.evalInput.slices) if (s.kind === 'AS') addressSpaceKeys.add(s.scKey);
  // Receiver value and donor harm use PIs before the reporting ceilings (percentile 4.0, velocity 99), or
  // improvements far past a goal look flat and a safe plan can exhaust its step limit without receiver value.
  const instPi = (ticks: readonly ScpTick[]) => {
    const m: Record<string, number | null> = {};
    for (const t of ticks) {
      const g = info[t.scKey];
      if (!g) {
        m[t.scKey] = null;
        continue;
      }
      const acc = accOf[t.scKey]?.acc;
      // Batch RT goals manage by scaling the measured PI (WT-12, docs/wlm-design.md §5.8). A null projection
      // (no running job) stays null rather than falling back to the completionless address-space evaluation.
      if (addressSpaceKeys.has(t.scKey) && (g.goal.kind === 'AVG' || g.goal.kind === 'PCT') && acc?.rtQueueSumSec !== undefined) {
        m[t.scKey] = projectBatchRtPi(g.goal, acc, t);
        continue;
      }
      m[t.scKey] = g.goal.kind === 'PCT'
        ? projectedPercentilePi(t.buckets, g.goal.pct, t.completions, t.rtSumSec, g.goal.rtSec, PCT_PROJECTION_SIGMA)
        : tickPi(g.goal, t, Infinity);
    }
    return m;
  };

  // Projections run at sustained demand (projection.ts): running batch jobs are exact and never lifted.
  // The first evaluation shares prepared demand; later evaluations follow cross-pool batch recovery.
  let projectBase: LparEvalInput | null = null;
  const projectionBase = (): LparEvalInput => {
    if (projectBase) return projectBase;
    // Running batch slices carry `fixedDemand` on every image, with or without zIIPs.
    const P = projectionInput(input.evalInput, system.scps, POLICY_ADJUST);
    return (projectBase = {
      ...P,
      dpOf: (k) => dps[k] ?? 196,
      scpsOnly: true,
      bucketsFor: new Set(Object.keys(info).filter((k) => info[k]!.goal.kind === 'PCT')),
      prepared: P.prepared ?? prepareLpar(P),
    });
  };
  /** Goal periods missing their goal whose backlog the projection bounded, in key order (computed once). */
  let runawayCache: string[] | null = null;
  const runaways = (): string[] =>
    (runawayCache ??= infoKeys.filter((k) => managementWorstPi(localPi[k], input.sysplexPi[k]) > 1 && backlogCut(k)));
  /** Did the projection bound this period's transaction backlog below what is queued? */
  const backlogCut = (k: string): boolean => {
    const bounded = projectionBase().backlog;
    for (const s of input.evalInput.slices) {
      if (s.scKey !== k || s.kind !== 'TXN') continue;
      const bl = input.evalInput.backlog[s.key] ?? 0;
      if (bl > 0 && (bounded[s.key] ?? 0) < bl) return true;
    }
    return false;
  };
  // `base`: every period's projected PI at the current DPs. One evaluation, made only when a candidate needs it.
  let baseCache: Record<string, number | null> | null = null;
  const basePis = (): Record<string, number | null> => (baseCache ??= instPi(evaluateLpar(projectionBase()).scps));
  const project = (trial: Record<string, number>, accepts: (after: Record<string, number | null>) => boolean) =>
    batchRecoveryAccepts({ ...projectionBase(), dpOf: (k) => trial[k] ?? dps[k] ?? 196 }, input.batch ?? [], (r) => accepts(instPi(r.scps)));

  /** A trial ladder's DPs, served periods at their holder's. */
  const withHolders = (d: Readonly<Record<string, number>>, L: Ladder) => expandHolderDps(topo, withLadder(d, L));
  /** Processor use of a period, engines: the larger of this tick and the smoothed accumulators (CP, IIPCP and zIIP). */
  const usedEngines = (k: string): number => {
    const t = tickOf[k];
    const now = t ? t.cpEngines + t.iipcpEngines + t.ziipEngines : 0;
    const acc = accOf[k]?.acc;
    return Math.max(now, ((acc?.cpuEngines ?? 0) + (acc?.ziipEngines ?? 0)) * (1 - ACC_DECAY));
  };
  const nowTick = input.nowTick ?? 0;
  // Clocks still running; an expired one is dropped (WLM Services 3.1, PDF p.148–149 (printed 124–125): a helped receiver can be helped again the next interval).
  const skipUntil: Record<string, number> = {};
  if (honourSkipClock) {
    for (const s of system.scps) if (s.skipUntilTick !== undefined && s.skipUntilTick > nowTick) skipUntil[s.scKey] = s.skipUntilTick;
  }
  return {
    input, info, infoKeys, topo, server, hold, ccImp, holderInfo, holderKeys, dps, ladder, protect, protection,
    localPi, tickOf, accOf, honourSkipClock, nowTick, skipUntil, basePis, project, runaways, backlogCut,
    withHolders, usedEngines,
  };
}

export type AdjustContext = ReturnType<typeof createAdjustContext>;
