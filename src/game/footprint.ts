// Card footprints at run time (RT-14, docs/rca-design.md §4.4(1)): a running card's reach resolved to the images (and
// CICS regions) its resource is loaded on, from the sim's effective routing and address spaces. Pure.

import { CICS_STORAGE } from '../content/subsys';
import type { FootprintReach } from '../content/footprint';
import type { SimState } from '../sim/core/types';
import type { ActiveEvent } from './types';
import type { AddressSpaceDef, WorkloadDef } from '../sim/workload/types';

export interface ReachWorld {
  sim: Pick<SimState, 'config' | 'routing'>;
  workloads: readonly WorkloadDef[];
  /** Scenario and run-added address spaces. */
  addressSpaces: readonly Pick<AddressSpaceDef, 'jobname' | 'lparId'>[];
}

/** A CICS region in a resolved reach (and in `footprintRelation`'s match). */
export const regionKey = (jobname: string, lparId: string): string => `${jobname}@${lparId}`;

/** The images a routing table actually sends work to: a static table keeps a 0 weight for an image it was routed
 * away from (`SET_ROUTING`), and that image is not a host of the work any more. */
export function hostImages(routing: Readonly<Record<string, number>>): string[] {
  return Object.entries(routing).filter(([, share]) => share > 0).map(([id]) => id);
}

/** Images the workload is routed to under the effective routing. */
function routedImages(world: Pick<ReachWorld, 'sim' | 'workloads'>, workloadId: string): string[] {
  const w = world.workloads.find((x) => x.id === workloadId);
  return hostImages(world.sim.routing[workloadId] ?? w?.routing ?? {});
}

/** The reach as image ids, or `JOB@LPAR` for a region reach; sorted, without duplicates. `capacityCpcs` is a capacity
 * card's lowered CPCs, read only by the `'capacityCpcs'` reach. */
export function resolveReach(reach: FootprintReach, world: ReachWorld, capacityCpcs: readonly string[] = []): string[] {
  const out = new Set<string>();
  const { lpars } = world.sim.config;
  if (reach === 'sysplex') for (const l of lpars) out.add(l.id);
  else if (reach === 'capacityCpcs') {
    const cpcs = new Set(capacityCpcs);
    for (const l of lpars) if (cpcs.has(l.cpcId)) out.add(l.id);
  } else if ('hostsOf' in reach) {
    for (const id of reach.hostsOf) for (const l of routedImages(world, id)) out.add(l);
  } else if ('jobs' in reach) {
    for (const a of world.addressSpaces) if (reach.jobs.includes(a.jobname)) out.add(a.lparId);
  } else if ('images' in reach) {
    for (const id of reach.images) if (lpars.some((l) => l.id === id)) out.add(id);
  } else {
    for (const a of world.addressSpaces) if (reach.regions.includes(a.jobname)) out.add(regionKey(a.jobname, a.lparId));
  }
  return [...out].sort();
}

/** What a running card's scope holds this tick: the hour's union when the card was already resolved this hour, or
 * just what it reaches now in a new hour. */
export function hourUnion(prev: readonly string[] | undefined, sameHour: boolean, now: readonly string[]): string[] {
  return sameHour && prev ? [...new Set([...prev, ...now])] : [...now];
}

/** The storage report's per-region EDSA reading against the game's SOS cushion. */
export function cicsStorageReach(regions: readonly string[], images: SimState['last']['lpars']): string[] {
  const cushionMb = CICS_STORAGE.minTasks * CICS_STORAGE.perTaskMb;
  return images.flatMap((image) => (image.cicsStorage ?? [])
    .filter((storage) => regions.includes(storage.region) && storage.limitMb - storage.inUseMb < cushionMb)
    .map((storage) => regionKey(storage.region, image.lparId)));
}

/** A release can be interrupted and resumed. Keep the earlier I/O windows for subsequent RCA queries. */
export function recordReplayTick(previous: ActiveEvent['footprintReplays'], tick: number): NonNullable<ActiveEvent['footprintReplays']> {
  const latest = previous?.at(-1);
  if (previous && latest?.endTick === tick) return [...previous.slice(0, -1), { ...latest, endTick: tick + 1 }];
  return [...(previous ?? []), { startTick: tick, endTick: tick + 1 }];
}
