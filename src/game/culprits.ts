// A card built from a workload modifier puts its extra demand on roster entities (PT-20 design §2 rule 7; PT-52): its
// begin picks the culprits from the day's roster and loads them, so an operation can later target one entity.

import type { CulpritSpec } from '../content/events/midwest-events';
import type { Command } from '../sim/core/commands';
import { clockAt } from '../sim/core/clock';
import { streamRng } from '../sim/core/rng';
import { TICKS_PER_DAY } from '../sim/core/units';
import type { SimState } from '../sim/core/types';
import { baseRate } from '../sim/workload/arrivals';
import { dailyRoster, type RosterEntry } from '../sim/workload/rosters';
import type { WorkloadDef } from '../sim/workload/types';

/** The played day that holds `tick`, as a window (for a card with no duration of its own). */
export function playedDayWindow(tick: number): { fromTick: number; toTick: number } {
  const day = Math.floor(tick / TICKS_PER_DAY);
  return { fromTick: day * TICKS_PER_DAY, toTick: (day + 1) * TICKS_PER_DAY };
}

/** Ticks between samples of the mean below (five minutes). */
const MEAN_STRIDE_TICKS = 30;

/**
 * The workload's sysplex-wide CPU over the ticks [fromTick, toTick), as a mean in reference engines: the deterministic
 * arrival rate (no noise or bursts) at each sample times CPU per transaction. Routing-free: the whole sysplex's work,
 * whichever images carry it. Sizes a card's constant culprit load (RF-11).
 */
export function meanRefEngines(w: WorkloadDef, fromTick: number, toTick: number): number {
  const n = Math.max(1, Math.round((toTick - fromTick) / MEAN_STRIDE_TICKS));
  const stride = (toTick - fromTick) / n;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += baseRate(w, clockAt(Math.round(fromTick + (k + 0.5) * stride))) * (w.cpuMsRef / 1000);
  return sum / n;
}

/** The day's roster for `w` of `kind` on the images its routing sends it to (callers pass the effective workloads, so
 *  the player's routing overrides are already applied). */
export function rosterOf(sim: SimState, w: WorkloadDef, kind: RosterEntry['kind']): RosterEntry[] {
  return dailyRoster(sim.seed, Math.floor(sim.tick / TICKS_PER_DAY), w, w.routing, kind);
}

/**
 * The culprits for card `uid` and the commands that load them. The card's extra CPU, (cpuMult − 1) × the workload's
 * sysplex CPU averaged over the card's own window [fromTick, toTick), is split evenly over the culprits. Each culprit
 * then carries its share as a constant demand on its own image (RF-11): one thread or userid running that many
 * engines, whatever the image's arrival rate or routing share, so routing the work off the image does not remove it.
 * `severity` scales the excess like the difficulty scaling of a card's modifiers.
 */
export function resolveCulprits(
  sim: SimState,
  workloads: readonly WorkloadDef[],
  spec: CulpritSpec,
  uid: string,
  severity = 1,
  window = playedDayWindow(sim.tick),
): { ids: string[]; commands: Command[] } {
  const w = workloads.find((x) => x.id === spec.workloadId);
  if (!w) return { ids: [], commands: [] };
  const routing = w.routing;
  const total = Object.values(routing).reduce((a, b) => a + Math.max(0, b), 0);
  const pool = rosterOf(sim, w, spec.entity).filter((e) => !spec.lparIds || spec.lparIds.includes(e.lparId));
  if (pool.length === 0 || total <= 0) return { ids: [], commands: [] };
  const rng = streamRng(sim.seed, 'culprits', uid);
  const [lo, hi] = typeof spec.count === 'number' ? [spec.count, spec.count] : spec.count;
  const n = Math.min(pool.length, rng.int(lo, hi + 1));
  const picked: RosterEntry[] = [];
  const left = [...pool];
  for (let i = 0; i < n; i++) picked.push(left.splice(rng.int(0, left.length), 1)[0]!);
  const excess = Math.max(0, (spec.cpuMult - 1) * severity);
  const engines = (excess * meanRefEngines(w, window.fromTick, window.toTick)) / n;
  const commands: Command[] = picked.map((e) => ({
    kind: 'SET_ENTITY_LOAD',
    load: { tag: uid, kind: e.kind, id: e.id, workloadId: w.id, lparId: e.lparId, engines },
  }));
  return { ids: picked.map((e) => e.id), commands };
}
