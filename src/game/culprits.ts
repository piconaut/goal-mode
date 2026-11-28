// A card built from a workload modifier puts its extra demand on roster entities (PT-20 design §2 rule 7; PT-52): its
// begin picks the culprits from the day's roster and loads them, so an operation can later target one entity.

import { ROSTERS } from '../content/entities';
import type { CulpritSpec } from '../content/events/midwest-events';
import type { Command } from '../sim/core/commands';
import { streamRng } from '../sim/core/rng';
import type { SimState } from '../sim/core/types';
import { TICKS_PER_DAY } from '../sim/core/units';
import { dailyRoster, type RosterEntry } from '../sim/workload/rosters';
import { meanReferenceRate, sizedEntityDemand } from '../sim/workload/entityDemand';
import type { WorkloadDef } from '../sim/workload/types';

/** The day's roster for `w` of `kind` on the images its routing sends it to (callers pass the effective workloads, so
 *  the player's routing overrides are already applied). */
export function rosterOf(sim: SimState, w: WorkloadDef, kind: RosterEntry['kind']): RosterEntry[] {
  return dailyRoster(sim.seed, Math.floor(sim.tick / TICKS_PER_DAY), w, w.routing, kind);
}

/**
 * The culprits for card `uid` and the commands that load them. The card's whole excess, (cpuMult − 1) × the workload's
 * CPU across the sysplex, is split over the culprits: each carries that fraction of its own image's reference CPU as
 * its own constant demand in engines (RF-11). A runaway thread keeps running where it is, so the excess does not follow
 * the workload's arrival rate and routing it away does not remove it. `hours` is the card's usual run, over which the
 * old rate-proportional excess is averaged; `severity` scales the excess like the difficulty scaling of a card's
 * modifiers.
 */
export function resolveCulprits(sim: SimState, workloads: readonly WorkloadDef[], spec: CulpritSpec, uid: string, severity = 1, hours = ROSTERS.sizingHours): { ids: string[]; commands: Command[] } {
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
  const rate = meanReferenceRate(w, sim.tick, hours, sim.monthDayAtStart);
  const commands: Command[] = picked.map((e) => {
    const demand = sizedEntityDemand(w, sim.config, e.lparId, rate, excess / n);
    return {
      kind: 'SET_ENTITY_LOAD',
      load: { tag: uid, kind: e.kind, id: e.id, workloadId: w.id, lparId: e.lparId, cpEngines: demand.cpEngines, ziipEngines: demand.ziipEngines },
    };
  });
  return { ids: picked.map((e) => e.id), commands };
}
