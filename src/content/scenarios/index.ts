import type { Scenario } from '../../sim/core/scenario';
import { BASEPOL } from '../wlm/basepol';
import { generateMidwestNetwork } from '../batch/midwest-batch';
import { MIDWEST_PRODUCTS } from '../pricing';
import { MIDWEST_CF_BASE_ENGINES, MIDWEST_MEMORY, MIDWEST_WORLD } from './midwest';
import { MIDWEST_ADDRESS_SPACES, MIDWEST_WORKLOADS } from './midwest-workloads';

export const MIDWEST: Scenario = {
  id: 'midwest',
  world: MIDWEST_WORLD,
  definition: BASEPOL,
  workloads: MIDWEST_WORKLOADS,
  addressSpaces: MIDWEST_ADDRESS_SPACES,
  cfBaseEngines: MIDWEST_CF_BASE_ENGINES,
  // FICTIONAL CF costs: shape follows IBM guidance (shared CF engines stretch sync
  // service times and drive async conversion; sync requests spin the z/OS CP).
  cfTunables: {
    cpuSecPerRequest: 12e-6,
    linkSyncSec: 5e-6,
    asyncBaseSec: 60e-6,
    asyncZosCpuSec: 15e-6,
    syncThresholdSec: 26e-6,
    sharedDispatchWaitSec: { thin: 0.00015, polling: 0.0015 },
  },
  memory: MIDWEST_MEMORY,
  products: MIDWEST_PRODUCTS,
  batchNetwork: generateMidwestNetwork,
};

export const SCENARIOS: Record<string, Scenario> = { midwest: MIDWEST };
