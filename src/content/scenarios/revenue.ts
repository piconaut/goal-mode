// "State Revenue Agency" topology: tax season on a sysplex the previous team tuned for the quiet months.
// Same building blocks as Midwest Mutual (SPEC §13); its own flaws are H1–H2 here and G1–G3 in REVPOL.

import type { LparConfig, LparPoolConfig, WorldConfig } from '../../sim/core/types';
import { MIDWEST_WORLD } from './midwest';
import { pool } from './pool';

const zos = (id: string, pools: LparPoolConfig[], memoryGb: number, definedCapacityMsu: number | null = null): LparConfig => ({
  id,
  cpcId: 'CPCA',
  kind: 'ZOS',
  pools,
  memoryGb,
  hiperDispatch: true,
  definedCapacityMsu,
  capacityGroup: null,
});

const cf = (id: string): LparConfig => ({ id, cpcId: 'CPCA', kind: 'CF', pools: [pool('ICF', 1, 0, { dedicated: true })], memoryGb: 32, hiperDispatch: false, definedCapacityMsu: null, capacityGroup: null });

/** H1: PROD1's soft cap, set last summer to hit the budget. Quiet months peak well below it; filing season does not. */
export const REVENUE_PROD1_DC_MSU = 480;

export const REVENUE_WORLD: WorldConfig = {
  ...MIDWEST_WORLD,
  cpcs: [{ id: 'CPCA', generation: 'M1', capacitySetting: 6, engines: { CP: 8, ZIIP: 2, ICF: 2 }, memoryGb: 768 }],
  lpars: [
    zos('PROD1', [pool('CP', 5, 480, { reserved: 2 }), pool('ZIIP', 1, 500)], 160, REVENUE_PROD1_DC_MSU),
    zos('PROD2', [pool('CP', 5, 400, { reserved: 2 }), pool('ZIIP', 1, 500)], 140),
    zos('DEVT', [pool('CP', 2, 80)], 64),
    zos('SYSP', [pool('CP', 1, 40)], 24),
    cf('CF01'),
    cf('CF02'),
  ],
  systems: ['PROD1', 'PROD2', 'DEVT', 'SYSP'].map((lparId) => ({
    lparId,
    blwlinthdSec: 20,
    blwltrpctFrac: 0.005,
    // H2: PROD2 was set to IIPHONORPRIORITY=NO for a zIIP software-cost study and never set back.
    iipHonorPriority: lparId !== 'PROD2',
  })),
  cfs: [
    { lparId: 'CF01', thinInterrupts: true },
    { lparId: 'CF02', thinInterrupts: true },
  ],
  cfStructures: MIDWEST_WORLD.cfStructures.map((s) => ({ ...s, cfLparId: s.name === 'DB1G_GBP1' ? 'CF02' : s.cfLparId })),
  jobClasses: [
    { jobClass: 'A', mode: 'JES', initiators: { PROD1: 12, PROD2: 10 } },
    { jobClass: 'D', mode: 'JES', initiators: { DEVT: 4 } },
  ],
  rmfIntervalMin: 15,
};

/** FICTIONAL: memory model inputs (SPEC §5.8). */
export const REVENUE_MEMORY = {
  osBaseGb: { PROD1: 60, PROD2: 60, DEVT: 30, SYSP: 12 } as Record<string, number>,
  cicsRegionGb: 8,
  batchJobGb: 0.4,
  db2WorkingSetGb: { DB1A: 150, DB1B: 150, DB1T: 30 } as Record<string, number>,
};

export const REVENUE_CF_BASE_ENGINES: Record<string, number> = { CF01: 0.02, CF02: 0.02 };
