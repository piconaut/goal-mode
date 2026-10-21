import { newCost } from '../cost/mlc';
import { newR4ha } from '../cost/r4ha';
import { newRmfAcc } from '../measure/rmf';
import { emptyBatch } from '../subsys/batch';
import { seedRng } from './rng';
import type { Scenario } from './scenario';
import type { SimState } from './types';
import type { RoutingPolicy } from '../workload/routing';

export function initState(seed: number, scenario: Scenario): SimState {
  return {
    version: 1,
    seed,
    tick: 0,
    rng: seedRng(seed),
    config: structuredClone(scenario.world),
    lpars: [],
    wlm: { definition: structuredClone(scenario.definition), systems: [], log: [] },
    workloads: scenario.workloads.map((w) => ({ id: w.id, noise: 0, retryRate: 0, lastRtSec: 0 })),
    backlog: {},
    last: { lpars: [], workloads: [] },
    env: { dasd: null, cf: [], lockIndex: 0, rtByWorkloadLpar: {}, pagingFrac: {} },
    batch: emptyBatch(),
    capping: {
      lpars: scenario.world.lpars.filter((l) => l.kind === 'ZOS').map((l) => newR4ha(l.id)),
      groups: scenario.world.capacityGroups.map((g) => newR4ha(g.id)),
    },
    cost: newCost(scenario.products),
    rmf: { acc: newRmfAcc(0), intervals: [], jobsThisInterval: [] },
    mods: { rate: {}, cpu: {}, asCpu: {}, measureCpu: {}, lockBoost: 0 },
    extraWorkloads: [],
    routing: {},
    extraAddressSpaces: [],
    commandLog: [],
    ...routingPoliciesOf(scenario),
  };
}

function routingPoliciesOf(scenario: Scenario): { routingPolicies?: Record<string, RoutingPolicy> } {
  const dyn = scenario.workloads.filter((w) => w.routingPolicy && w.routingPolicy.method !== 'STATIC');
  return dyn.length ? { routingPolicies: Object.fromEntries(dyn.map((w) => [w.id, w.routingPolicy!])) } : {};
}
