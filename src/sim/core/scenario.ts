import type { ProductDef } from '../../content/pricing';
import type { CfTunables } from '../cf/cf';
import type { JobDef } from '../subsys/batch';
import type { AddressSpaceDef, WorkloadDef } from '../workload/types';
import type { ServiceDefinition } from '../wlm/types';
import type { WorldConfig } from './types';

/** Immutable content for a run. Mutable, player-editable parts are copied into SimState. */
export interface Scenario {
  id: string;
  world: WorldConfig;
  definition: ServiceDefinition;
  workloads: WorkloadDef[];
  addressSpaces: AddressSpaceDef[];
  cfBaseEngines: Record<string, number>;
  cfTunables: CfTunables;
  memory: {
    osBaseGb: Record<string, number>;
    cicsRegionGb: number;
    batchJobGb: number;
    db2WorkingSetGb: Record<string, number>;
  };
  products: ProductDef[];
  /** Nightly job network for a played day (deterministic in seed and day). */
  batchNetwork: (seed: number, day: number, dayOfMonth: number) => JobDef[];
}
