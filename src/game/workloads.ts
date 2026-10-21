import { clockAt } from '../sim/core/clock';
import type { Scenario } from '../sim/core/scenario';
import type { WorkloadDef } from '../sim/workload/types';
import { workItems, type WorkItem } from './classifyExplain';
import type { RunState } from './types';

/** Scenario workloads plus any added during the run (new-app events). */
export function allWorkloads(scenario: Scenario, run: RunState): WorkloadDef[] {
  return [...scenario.workloads, ...run.sim.extraWorkloads];
}

/** Everything the run's classification rules see today: workloads, address spaces and tonight's batch. */
export function runWorkItems(scenario: Scenario, run: RunState): WorkItem[] {
  return workItems(
    allWorkloads(scenario, run),
    [...scenario.addressSpaces, ...run.sim.extraAddressSpaces],
    scenario.batchNetwork(run.seed, run.day, clockAt(run.sim.tick).dayOfMonth),
  );
}
