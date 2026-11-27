// Daily rosters of the entities inside a workload (PT-20 design §2 rules 2 and 7): the DDF threads a Db2 member
// serves and the TSO userids logged on to an image. The sim is fluid, so a roster entry carries a share of its
// workload's CPU on that image rather than work of its own; a card puts extra demand on chosen entries through
// `SimState.entityLoads`. Deterministic in seed and day, and stable within the day: an entry keeps its id and weight
// when the image's routing share (and so the roster's length) changes.

import { ROSTERS } from '../../content/entities';
import { streamRng } from '../core/rng';
import type { EntityLoad } from '../core/types';
import type { WorkloadDef } from './types';

export type RosterKind = EntityLoad['kind'];

export interface RosterEntry {
  kind: RosterKind;
  /** DDF: the thread token (unique among the workload's threads for the day); TSO: the userid. */
  id: string;
  workloadId: string;
  lparId: string;
  /** Share of the workload's CPU on this image this entry accounts for (the entries of one image sum to 1). */
  shareFrac: number;
  /** DDF: the authorization ID and correlation ID DISPLAY THREAD shows. */
  authid?: string;
  corrid?: string;
}

/** Most entries an image can hold; candidates are drawn up to this so a longer roster only adds to the tail. */
const MAX_ENTRIES = 120;

function rosterSize(kind: RosterKind, share: number): number {
  if (share <= 0) return 0;
  if (kind === 'DDF_THREAD') return ROSTERS.ddfThreadsPerImage;
  return Math.min(MAX_ENTRIES, Math.max(ROSTERS.tsoMinUsers, Math.round(share * ROSTERS.tsoUsersPerShare)));
}

/** Pareto(alpha) weight for a uniform draw: heavy-tailed, so one entry often dominates. */
const paretoWeight = (u: number) => Math.pow(1 - Math.min(u, 0.999_999), -1 / ROSTERS.paretoAlpha);

/**
 * The day's roster of `kind` for workload `w` on every image `routing` sends it to. DDF tokens are unique among the
 * workload's threads for the day; TSO userids keep the workload's userid prefix (letters of `work.UI`), so classification rules
 * written on the prefix still match.
 */
export function dailyRoster(seed: number, day: number, w: WorkloadDef, routing: Readonly<Record<string, number>>, kind: RosterKind): RosterEntry[] {
  const out: RosterEntry[] = [];
  const lparIds = Object.keys(routing).sort();
  // One pool of ids per workload and day, dealt out to images in id order, so ids never repeat across images.
  const ids = idPool(seed, day, w, kind, lparIds.length * MAX_ENTRIES);
  lparIds.forEach((lparId, i) => {
    const n = rosterSize(kind, routing[lparId] ?? 0);
    if (n === 0) return;
    const rng = streamRng(seed, 'roster', kind, w.id, lparId, day);
    const weights: number[] = [];
    for (let k = 0; k < MAX_ENTRIES; k++) weights.push(paretoWeight(rng.float()));
    const total = weights.slice(0, n).reduce((a, b) => a + b, 0);
    for (let k = 0; k < n; k++) {
      const id = ids[i * MAX_ENTRIES + k]!;
      const e: RosterEntry = { kind, id, workloadId: w.id, lparId, shareFrac: weights[k]! / total };
      if (kind === 'DDF_THREAD') {
        e.authid = w.work.UI ?? w.id;
        e.corrid = w.work.CI ?? w.id;
      }
      out.push(e);
    }
  });
  return out;
}

function idPool(seed: number, day: number, w: WorkloadDef, kind: RosterKind, n: number): string[] {
  const rng = streamRng(seed, 'roster-ids', kind, w.id, day);
  if (kind === 'DDF_THREAD') {
    const [lo, hi] = ROSTERS.tokenRange;
    const seen = new Set<number>();
    const out: string[] = [];
    while (out.length < n) {
      const t = rng.int(lo, hi + 1);
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(String(t));
    }
    return out;
  }
  const prefix = (w.work.UI ?? 'TSO').replace(/[^A-Z@#$]/gi, '').slice(0, 4).toUpperCase() || 'TSO';
  const width = Math.max(3, 7 - prefix.length);
  const nums = Array.from({ length: n }, (_, k) => k + 1);
  for (let k = nums.length - 1; k > 0; k--) {
    const j = rng.int(0, k + 1);
    [nums[k], nums[j]] = [nums[j]!, nums[k]!];
  }
  return nums.map((x) => `${prefix}${String(x).padStart(width, '0')}`);
}

/** CPU multiplier the entity loads put on workload `workloadId` on image `lparId` (1 = none). */
export function entityLoadMult(loads: readonly EntityLoad[] | undefined, workloadId: string, lparId: string): number {
  if (!loads) return 1;
  let extra = 0;
  for (const l of loads) if (l.workloadId === workloadId && l.lparId === lparId) extra += l.extraCpuFrac;
  return 1 + extra;
}

/**
 * Each entry's CPU (`entries` all of one workload on one image), given the workload's measured CPU on that image (which already includes any entity loads): the
 * workload's own CPU is shared out by `shareFrac`, and a loaded entry adds its extra on top. Sums to `workloadCpuSec`.
 */
export function rosterCpuSec(entries: readonly RosterEntry[], workloadCpuSec: number, loads: readonly EntityLoad[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (entries.length === 0) return out;
  const { workloadId, lparId } = entries[0]!;
  const ownCpuSec = workloadCpuSec / entityLoadMult(loads, workloadId, lparId);
  for (const e of entries) {
    let extra = 0;
    for (const l of loads ?? []) if (l.id === e.id && l.kind === e.kind && l.workloadId === workloadId && l.lparId === lparId) extra += l.extraCpuFrac;
    out[e.id] = ownCpuSec * (e.shareFrac + extra);
  }
  return out;
}
