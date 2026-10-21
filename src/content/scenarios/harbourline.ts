// "Harbourline Bank" topology (SPEC §13.5): two CPCs ~15 km apart, one production sysplex HBPLEX.
// Planted flaws are B1–B4 (SPEC §13.5); the Db2 lock structure placement (B4) lives here, the rest in
// the workload definitions.

import type { LparConfig, LparPoolConfig, WorldConfig } from '../../sim/core/types';
import { MIDWEST_WORLD } from './midwest';

const pool = (pool: LparPoolConfig['pool'], logical: number, weight: number, extra: Partial<LparPoolConfig> = {}): LparPoolConfig => ({
  pool,
  logical,
  reserved: 0,
  weight,
  dedicated: false,
  initialCapping: false,
  absoluteCapEngines: null,
  ...extra,
});

const zos = (id: string, cpcId: string, pools: LparPoolConfig[], memoryGb: number): LparConfig => ({
  id,
  cpcId,
  kind: 'ZOS',
  pools,
  memoryGb,
  hiperDispatch: true,
  definedCapacityMsu: null,
  capacityGroup: null,
});

const cf = (id: string, cpcId: string): LparConfig => ({ id, cpcId, kind: 'CF', pools: [pool('ICF', 1, 0, { dedicated: true })], memoryGb: 64, hiperDispatch: false, definedCapacityMsu: null, capacityGroup: null });

const PROD = ['PRDA', 'PRDB', 'PRDC', 'PRDD'];

export const HARBOURLINE_WORLD: WorldConfig = {
  ...MIDWEST_WORLD,
  cpcs: [
    { id: 'CPC1', generation: 'M2', capacitySetting: 7, engines: { CP: 14, ZIIP: 2, ICF: 1 }, memoryGb: 1536 },
    // One generation older and sub-capacity, but more zIIPs (B3 sends DDF work away from them).
    { id: 'CPC2', generation: 'M1', capacitySetting: 5, engines: { CP: 10, ZIIP: 6, ICF: 1 }, memoryGb: 1024 },
  ],
  lpars: [
    // Problem 1: an absolute cap set to fence PRDA off from DEV1 years ago. It is above the average
    // load but clips the market-open burst itself, where a soft cap would barely notice it.
    zos('PRDA', 'CPC1', [pool('CP', 7, 450, { absoluteCapEngines: 6.0 }), pool('ZIIP', 1, 500)], 400),
    zos('PRDB', 'CPC1', [pool('CP', 6, 400), pool('ZIIP', 1, 500)], 360),
    zos('DEV1', 'CPC1', [pool('CP', 3, 100)], 96),
    cf('CF01', 'CPC1'),
    zos('PRDC', 'CPC2', [pool('CP', 5, 450), pool('ZIIP', 3, 500)], 320),
    zos('PRDD', 'CPC2', [pool('CP', 5, 400), pool('ZIIP', 3, 500)], 300),
    zos('TST1', 'CPC2', [pool('CP', 2, 100)], 64),
    cf('CF02', 'CPC2'),
  ],
  systems: [...PROD, 'DEV1', 'TST1'].map((lparId) => ({
    lparId,
    blwlinthdSec: 20,
    blwltrpctFrac: 0.005,
    iipHonorPriority: true,
  })),
  dasd: {
    ...MIDWEST_WORLD.dasd,
    // FICTIONAL: a bigger estate behind a bigger fabric and array.
    fabricCapacityIops: 450_000,
    backendCapacityIops: 90_000,
  },
  cfs: [
    { lparId: 'CF01', thinInterrupts: true },
    { lparId: 'CF02', thinInterrupts: true },
  ],
  // B4: the Db2 lock structure sits on CF01 (CPC1's site). Work on PRDC/PRDD reaches it over the
  // 15 km link, so its lock requests are slower or go async.
  cfStructures: MIDWEST_WORLD.cfStructures.map((s) => ({
    ...s,
    cfLparId: ['DB1G_LOCK1', 'DB1G_GBP0', 'DB1G_SCA'].includes(s.name) ? 'CF01' : 'CF02',
  })),
  db2: [
    { ssid: 'DB1A', lparId: 'PRDA', bufferPoolGb: 48, maxDbat: 500 },
    { ssid: 'DB1B', lparId: 'PRDB', bufferPoolGb: 48, maxDbat: 500 },
    { ssid: 'DB1C', lparId: 'PRDC', bufferPoolGb: 40, maxDbat: 500 },
    { ssid: 'DB1D', lparId: 'PRDD', bufferPoolGb: 40, maxDbat: 500 },
    { ssid: 'DB1T', lparId: 'DEV1', bufferPoolGb: 8, maxDbat: 100 },
  ],
  cics: [
    { name: 'CICSAOR1', lparId: 'PRDA', maxTasks: 250, qrFrac: 0.6 },
    { name: 'CICSAOR5', lparId: 'PRDA', maxTasks: 250, qrFrac: 0.6 },
    { name: 'CICSAOR2', lparId: 'PRDB', maxTasks: 250, qrFrac: 0.6 },
    { name: 'CICSAOR6', lparId: 'PRDB', maxTasks: 250, qrFrac: 0.6 },
    { name: 'CICSAOR3', lparId: 'PRDC', maxTasks: 250, qrFrac: 0.6 },
    { name: 'CICSAOR7', lparId: 'PRDC', maxTasks: 250, qrFrac: 0.6 },
    { name: 'CICSAOR4', lparId: 'PRDD', maxTasks: 250, qrFrac: 0.6 },
    { name: 'CICSAOR8', lparId: 'PRDD', maxTasks: 250, qrFrac: 0.6 },
  ],
  jobClasses: [
    { jobClass: 'A', mode: 'JES', initiators: { PRDA: 12, PRDB: 10, PRDC: 8, PRDD: 8 } },
    { jobClass: 'D', mode: 'JES', initiators: { DEV1: 4, TST1: 3 } },
  ],
  rmfIntervalMin: 15,
};

/** FICTIONAL: memory model inputs (SPEC §5.8). Db2 members DB1A–DB1D run on PRDA–PRDD. */
export const HARBOURLINE_MEMORY = {
  osBaseGb: { PRDA: 70, PRDB: 70, PRDC: 60, PRDD: 60, DEV1: 30, TST1: 20 } as Record<string, number>,
  cicsRegionGb: 8,
  batchJobGb: 0.4,
  db2WorkingSetGb: { DB1A: 180, DB1B: 180, DB1C: 150, DB1D: 150, DB1T: 30 } as Record<string, number>,
};

export const HARBOURLINE_CF_BASE_ENGINES: Record<string, number> = { CF01: 0.03, CF02: 0.03 };
