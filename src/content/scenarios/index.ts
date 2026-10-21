import type { Scenario } from '../../sim/core/scenario';
import { BASEPOL } from '../wlm/basepol';
import { MIDWEST_BATCH_GROWTH_PER_DAY, generateMidwestNetwork } from '../batch/midwest-batch';
import { HARBOURLINE_PRODUCTS, MIDWEST_PRODUCTS } from '../pricing';
import { MIDWEST_CF_BASE_ENGINES, MIDWEST_MEMORY, MIDWEST_WORLD } from './midwest';
import { MIDWEST_ADDRESS_SPACES, MIDWEST_WORKLOADS } from './midwest-workloads';
import { REVPOL } from '../wlm/revpol';
import { REVENUE_BATCH_GROWTH_PER_DAY, generateRevenueNetwork } from '../batch/revenue-batch';
import { REVENUE_CF_BASE_ENGINES, REVENUE_MEMORY, REVENUE_WORLD } from './revenue';
import { REVENUE_ADDRESS_SPACES, REVENUE_WORKLOADS } from './revenue-workloads';
import { HBPOL } from '../wlm/hbpol';
import { HARBOURLINE_BATCH_GROWTH_PER_DAY, generateHarbourlineNetwork } from '../batch/harbourline-batch';
import { HARBOURLINE_CF_BASE_ENGINES, HARBOURLINE_MEMORY, HARBOURLINE_WORLD } from './harbourline';
import { HARBOURLINE_ADDRESS_SPACES, HARBOURLINE_WORKLOADS } from './harbourline-workloads';

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
  batchGrowthPerDay: MIDWEST_BATCH_GROWTH_PER_DAY,
};

/** State Revenue Agency: tax season. Same CF costs and product list as Midwest (one software stack). */
export const REVENUE: Scenario = {
  ...MIDWEST,
  id: 'revenue',
  world: REVENUE_WORLD,
  definition: REVPOL,
  workloads: REVENUE_WORKLOADS,
  addressSpaces: REVENUE_ADDRESS_SPACES,
  cfBaseEngines: REVENUE_CF_BASE_ENGINES,
  memory: REVENUE_MEMORY,
  batchNetwork: generateRevenueNetwork,
  batchGrowthPerDay: REVENUE_BATCH_GROWTH_PER_DAY,
};

/** Harbourline Bank: two CPCs, six LPARs, spiky markets and dynamic routing (SPEC §13.5). */
export const HARBOURLINE: Scenario = {
  ...MIDWEST,
  id: 'harbourline',
  world: HARBOURLINE_WORLD,
  definition: HBPOL,
  workloads: HARBOURLINE_WORKLOADS,
  addressSpaces: HARBOURLINE_ADDRESS_SPACES,
  cfBaseEngines: HARBOURLINE_CF_BASE_ENGINES,
  memory: HARBOURLINE_MEMORY,
  products: HARBOURLINE_PRODUCTS,
  batchNetwork: generateHarbourlineNetwork,
  batchGrowthPerDay: HARBOURLINE_BATCH_GROWTH_PER_DAY,
};

export const SCENARIOS: Record<string, Scenario> = { midwest: MIDWEST, revenue: REVENUE, harbourline: HARBOURLINE };
