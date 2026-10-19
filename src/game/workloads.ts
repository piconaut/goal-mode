import type { Scenario } from '../sim/core/scenario';
import type { WorkloadDef } from '../sim/workload/types';
import type { RunState } from './types';

/** Scenario workloads plus any added during the run (new-app events). */
export function allWorkloads(scenario: Scenario, run: RunState): WorkloadDef[] {
  return [...scenario.workloads, ...run.sim.extraWorkloads];
}
