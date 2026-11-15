// Card footprints at run time (RT-14, docs/rca-design.md §4.4(1)): a running card's reach resolved to the images (and
// CICS regions) its resource is loaded on, from the sim's effective routing and address spaces. Pure.

import type { FootprintReach } from '../content/footprint';
import type { SimState } from '../sim/core/types';
import type { AddressSpaceDef, WorkloadDef } from '../sim/workload/types';

export interface ReachWorld {
  sim: Pick<SimState, 'config' | 'routing'>;
  workloads: readonly WorkloadDef[];
  /** Scenario and run-added address spaces. */
  addressSpaces: readonly Pick<AddressSpaceDef, 'jobname' | 'lparId'>[];
  /** A capacity card's lowered CPCs. */
  capacityCpcs?: readonly string[];
}

/** Images whose share of the workload is above 0 under the effective routing. */
export function routedImages(world: Pick<ReachWorld, 'sim' | 'workloads'>, workloadId: string): string[] {
  const w = world.workloads.find((x) => x.id === workloadId);
  const routing = world.sim.routing[workloadId] ?? w?.routing ?? {};
  return Object.entries(routing).filter(([, share]) => share > 0).map(([id]) => id);
}

/** The reach as image ids, or `JOB@LPAR` for a region reach; sorted, without duplicates. */
export function resolveReach(reach: FootprintReach, world: ReachWorld): string[] {
  const out = new Set<string>();
  const { lpars } = world.sim.config;
  if (reach === 'sysplex') for (const l of lpars) out.add(l.id);
  else if (reach === 'capacityCpcs') {
    const cpcs = new Set(world.capacityCpcs ?? []);
    for (const l of lpars) if (cpcs.has(l.cpcId)) out.add(l.id);
  } else if ('hostsOf' in reach) {
    for (const id of reach.hostsOf) for (const l of routedImages(world, id)) out.add(l);
  } else if ('jobs' in reach) {
    for (const a of world.addressSpaces) if (reach.jobs.includes(a.jobname)) out.add(a.lparId);
  } else if ('images' in reach) {
    for (const id of reach.images) if (lpars.some((l) => l.id === id)) out.add(id);
  } else {
    for (const a of world.addressSpaces) if (reach.regions.includes(a.jobname)) out.add(`${a.jobname}@${a.lparId}`);
  }
  return [...out].sort();
}
