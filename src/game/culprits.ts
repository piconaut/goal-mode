// A card built from a workload modifier puts its extra demand on roster entities (PT-20 design §2 rule 7; PT-52): its
// begin picks the culprits from the day's roster and loads them, so an operation can later target one entity.

import type { CulpritSpec } from '../content/events/midwest-events';
import type { Command } from '../sim/core/commands';
import { streamRng } from '../sim/core/rng';
import type { SimState } from '../sim/core/types';
import { TICKS_PER_DAY } from '../sim/core/units';
import { dailyRoster, type RosterEntry } from '../sim/workload/rosters';
import type { WorkloadDef } from '../sim/workload/types';

/** The workload's live routing: the player's static weights, or the content's. */
export const liveRouting = (sim: SimState, w: WorkloadDef): Record<string, number> => sim.routing[w.id] ?? w.routing;

/** The day's roster for `w` of `kind`, on the images it is routed to now. */
export function rosterOf(sim: SimState, w: WorkloadDef, kind: RosterEntry['kind']): RosterEntry[] {
  return dailyRoster(sim.seed, Math.floor(sim.tick / TICKS_PER_DAY), w, liveRouting(sim, w), kind);
}

/**
 * The culprits for card `uid` and the commands that load them. The card's whole extra CPU, (cpuMult − 1) × the
 * workload's CPU across the sysplex, is split evenly over the culprits and lands on their images, so a culprit on an
 * image with a small share of the work multiplies that image's CPU many times. APPROX: the extra scales with the
 * workload's arrival rate on that image (the shape of the workload modifier it replaces), not a fixed engine count.
 * `severity` scales the excess like the difficulty scaling of a card's modifiers.
 */
export function resolveCulprits(sim: SimState, workloads: readonly WorkloadDef[], spec: CulpritSpec, uid: string, severity = 1): { ids: string[]; commands: Command[] } {
  const w = workloads.find((x) => x.id === spec.workloadId);
  if (!w) return { ids: [], commands: [] };
  const routing = liveRouting(sim, w);
  const total = Object.values(routing).reduce((a, b) => a + Math.max(0, b), 0);
  const pool = rosterOf(sim, w, spec.entity).filter((e) => (routing[e.lparId] ?? 0) > 0 && (!spec.lparIds || spec.lparIds.includes(e.lparId)));
  if (pool.length === 0 || total <= 0) return { ids: [], commands: [] };
  const rng = streamRng(sim.seed, 'culprits', uid);
  const [lo, hi] = typeof spec.count === 'number' ? [spec.count, spec.count] : spec.count;
  const n = Math.min(pool.length, rng.int(lo, hi + 1));
  const picked: RosterEntry[] = [];
  const left = [...pool];
  for (let i = 0; i < n; i++) picked.push(left.splice(rng.int(0, left.length), 1)[0]!);
  const excess = Math.max(0, (spec.cpuMult - 1) * severity);
  const commands: Command[] = picked.map((e) => ({
    kind: 'SET_ENTITY_LOAD',
    load: { tag: uid, kind: e.kind, id: e.id, workloadId: w.id, lparId: e.lparId, extraCpuFrac: (excess / n) * (total / routing[e.lparId]!) },
  }));
  return { ids: picked.map((e) => e.id), commands };
}
