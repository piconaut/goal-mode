// DP-independent first stage: per-slice demand (new arrivals + backlog drain) with
// the resource-group cap applied, aggregated per service-class period.

import { TICK_SEC } from '../../core/units';
import type { LparEvalInput, PreparedLpar, SliceSpec } from './types';

/** Suffix of the dispatch aggregate holding a period's transaction-server regions. */
export const SRV = '~srv';
export const baseKey = (id: string) => (id.endsWith(SRV) ? id.slice(0, -SRV.length) : id);

/**
 * CP part of a slice's backlog, engine-seconds. Each pool keeps its own backlog: CP work left unserved by a cap or a
 * CP shortage cannot drain on idle zIIPs (WLM Planning p.182: capping limits general purpose CPs only).
 */
export function backlogCpSec(s: SliceSpec, backlog: Readonly<Record<string, number>>, ziipBacklog?: Readonly<Record<string, number>>): number {
  const bl = backlog[s.key] ?? 0;
  if (ziipBacklog) return Math.max(0, bl - (ziipBacklog[s.key] ?? 0));
  const tot = s.cpEngines + s.ziipEngines;
  return bl * (tot > 0 ? s.cpEngines / tot : 1);
}

/** RG time slices make work non-dispatchable on both pools, even when only CP service counts toward
 * the limit (WLM Planning 3.1 p.60 notes 4–5). The fluid model uses the same awake fraction on each pool. */
export function dispatchableDemand(s: SliceSpec, backlog: Readonly<Record<string, number>>, ziipBacklog?: Readonly<Record<string, number>>, capOf?: (s: SliceSpec) => number, eligibleOnCp = false): { cp: number; zi: number; cut: number; ziCut: number } {
  const bl = backlog[s.key] ?? 0;
  const blCp = backlogCpSec(s, backlog, ziipBacklog);
  const cpWant = s.cpEngines + blCp / TICK_SEC;
  const ziWant = s.ziipEngines + (bl - blCp) / TICK_SEC;
  const counted = cpWant + (eligibleOnCp ? ziWant : 0);
  const awakeFrac = capOf && counted > 0 ? Math.max(0, Math.min(1, capOf(s) / counted)) : 1;
  const cp = cpWant * awakeFrac;
  const zi = ziWant * awakeFrac;
  const ziCut = ziWant - zi;
  return { cp, zi, cut: cpWant - cp + ziCut, ziCut };
}

export function prepareLpar(input: Omit<LparEvalInput, 'dpOf'>): PreparedLpar {
  const { slices, backlog, ziipBacklog } = input;
  const n = slices.length;
  // Per-slice demand (new arrivals + backlog drain), then aggregate per service-class period. Equal-DP work
  // shares by ready units; the period's grant is then split among its slices the same way.
  // APPROX: the level is solved on period totals, not per slice.
  const sliceCp = new Array<number>(n);
  const sliceZi = new Array<number>(n);
  const sliceCut = new Array<number>(n);
  const sliceZiCut = new Array<number>(n);
  const sliceAgg = new Array<number>(n);
  const aggIdx: Record<string, number> = {};
  let mixedIdx: Record<string, number> | undefined;
  const order: string[] = [];
  const aggCp: number[] = [];
  const aggZi: number[] = [];
  const aggOverflow: boolean[] = [];
  const capOf = input.capOf;
  const servers = input.regions?.servers;
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    const { cp, zi, cut, ziCut } = dispatchableDemand(s, backlog, ziipBacklog, capOf, input.eligibleOnCp ?? input.ziipServers <= 0);
    sliceCut[i] = cut;
    sliceZiCut[i] = ziCut;
    sliceCp[i] = cp;
    sliceZi[i] = zi;
    const id = servers !== undefined && s.kind === 'AS' && servers.includes(s.key) ? `${s.scKey}${SRV}` : s.scKey;
    // CICS region work and DDF enclaves can share a service class but have different Honor
    // Priority eligibility (WLM Planning 3.1 p.122). Keep their dispatch grants separate.
    let a = aggIdx[id];
    const split = a !== undefined && aggOverflow[a] !== s.mayOverflow;
    if (split) a = (mixedIdx ??= {})[id];
    if (a === undefined) {
      a = order.length;
      if (split) mixedIdx![id] = a;
      else aggIdx[id] = a;
      order.push(id);
      aggCp.push(0);
      aggZi.push(0);
      aggOverflow.push(s.mayOverflow);
    }
    sliceAgg[i] = a;
    aggCp[a] = aggCp[a]! + cp;
    aggZi[a] = aggZi[a]! + zi;
  }
  const sliceUnits = new Array<number | undefined>(n);
  const aggUnits = new Array<number | undefined>(order.length).fill(undefined);
  const aggSlices: number[][] = order.map(() => []);
  for (let i = 0; i < n; i++) {
    const s = slices[i]!;
    // Address spaces: their TCBs/SRBs, at least one. Transactions: one ready unit per engine of new work; the
    // backlog adds demand, not units (APPROX: unserved work waits in the subsystem's own queues, MXT, QR TCB or
    // DDF threads, rather than as extra z/OS dispatchable units).
    const own = (s.units ?? 0) > 0 ? s.units! : 0;
    const u = own > 0 ? own : s.kind === 'AS' ? Math.max(1, sliceCp[i]! + sliceZi[i]!) : Math.max(s.cpEngines + s.ziipEngines, 0.01 * (sliceCp[i]! + sliceZi[i]!));
    sliceUnits[i] = u > 0 ? u : undefined;
    aggSlices[sliceAgg[i]!]!.push(i);
  }
  for (let a = 0; a < order.length; a++) {
    const idx = aggSlices[a]!;
    let u = 0;
    let any = false;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]!;
      const ui = sliceUnits[i];
      if (ui !== undefined) any = true;
      u += ui ?? sliceCp[i]! + sliceZi[i]!;
    }
    if (any) aggUnits[a] = u;
  }
  // WLM reuses this preparation for DP projections. Only mixed-eligibility identities
  // need unique dispatch IDs and apportioned promotion/minimum shares.
  let dispatchIds = order;
  let cpShares: number[] | null = null;
  if (mixedIdx) {
    dispatchIds = order.map((k, a) => aggIdx[k] === a ? k : `${k}~overflow`);
    const cpById: Record<string, number> = {};
    for (let a = 0; a < order.length; a++) cpById[order[a]!] = (cpById[order[a]!] ?? 0) + aggCp[a]!;
    cpShares = aggCp.map((cp, a) => cpById[order[a]!]! > 0 ? cp / cpById[order[a]!]! : 0);
  }
  return { sliceCp, sliceZi, sliceCut, sliceZiCut, sliceAgg, order, dispatchIds, cpShares, aggCp, aggZi, aggOverflow, sliceUnits, aggUnits, aggSlices };
}
