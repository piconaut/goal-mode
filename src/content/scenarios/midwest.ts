// "Midwest Mutual" starting topology (SPEC §13). Deliberately decent-but-flawed.

import type { LparConfig, LparPoolConfig, WorldConfig } from '../../sim/core/types';

const cp = (logical: number, weight: number, extra: Partial<LparPoolConfig> = {}): LparPoolConfig => ({
  pool: 'CP',
  logical,
  reserved: 0,
  weight,
  dedicated: false,
  initialCapping: false,
  absoluteCapEngines: null,
  ...extra,
});
const ziip = (logical: number, weight: number): LparPoolConfig => ({ ...cp(logical, weight), pool: 'ZIIP' });
const icf = (logical: number, weight: number, dedicated: boolean): LparPoolConfig => ({
  ...cp(logical, weight),
  pool: 'ICF',
  dedicated,
});

const zos = (id: string, pools: LparPoolConfig[], memoryGb: number): LparConfig => ({
  id,
  cpcId: 'CPCA',
  kind: 'ZOS',
  pools,
  memoryGb,
  hiperDispatch: true,
  definedCapacityMsu: null, // no soft caps anywhere: maximal MLC (CFO notices in week 3)
  capacityGroup: null,
});

const PROD_CFS = ['CF01', 'CF02'];

export const MIDWEST_WORLD: WorldConfig = {
  cpcs: [{ id: 'CPCA', generation: 'M1', capacitySetting: 6, engines: { CP: 8, ZIIP: 2, ICF: 2 }, memoryGb: 768 }],
  lpars: [
    zos('PROD1', [cp(6, 500, { reserved: 2 }), ziip(2, 500)], 160),
    // F7: PROD2 has no zIIPs online although DDF is routed here.
    zos('PROD2', [cp(6, 350, { reserved: 2 })], 140),
    // F9: DEVT has 4 logicals at weight 100 (E≈0.8): VL-heavy and uncapped.
    zos('DEVT', [cp(4, 100)], 64),
    zos('SYSP', [cp(2, 50)], 24),
    { id: 'CF01', cpcId: 'CPCA', kind: 'CF', pools: [icf(1, 0, true)], memoryGb: 32, hiperDispatch: false, definedCapacityMsu: null, capacityGroup: null },
    // F8: CF02 runs on a shared ICF engine with a low weight, next to the test CF.
    { id: 'CF02', cpcId: 'CPCA', kind: 'CF', pools: [icf(1, 10, false)], memoryGb: 32, hiperDispatch: false, definedCapacityMsu: null, capacityGroup: null },
    { id: 'CFTEST', cpcId: 'CPCA', kind: 'CF', pools: [icf(1, 90, false)], memoryGb: 16, hiperDispatch: false, definedCapacityMsu: null, capacityGroup: null },
  ],
  capacityGroups: [],
  systems: ['PROD1', 'PROD2', 'DEVT', 'SYSP'].map((lparId) => ({
    lparId,
    blwlinthdSec: 20, // F12: IBM default
    blwltrpctFrac: 0.005,
    iipHonorPriority: true,
  })),
  dasd: {
    // FICTIONAL layout: 6 LCUs × 200 volumes. Aliases are spread evenly although the I/O is not
    // (the Db2 data LCUs and the batch LCUs carry most of it): harmless day to day with HyperPAV,
    // but an LCU that gets hammered (utilities, batch) runs out of aliases first.
    lcus: [
      { id: '10', label: 'Db2 data 1', volumes: 200, aliases: 22, ioShare: { RANDOM: 0.3, SEQ: 0.1 }, hotSkew: 0.45 },
      { id: '11', label: 'Db2 data 2', volumes: 200, aliases: 22, ioShare: { RANDOM: 0.25, SEQ: 0.1 }, hotSkew: 0.35 },
      { id: '12', label: 'Db2 indexes + logs', volumes: 200, aliases: 21, ioShare: { RANDOM: 0.2, SEQ: 0.05 }, hotSkew: 0.3 },
      { id: '20', label: 'Batch 1', volumes: 200, aliases: 21, ioShare: { RANDOM: 0.08, SEQ: 0.35 }, hotSkew: 0.3 },
      { id: '21', label: 'Batch 2 / settlement', volumes: 200, aliases: 21, ioShare: { RANDOM: 0.07, SEQ: 0.3 }, hotSkew: 0.3 },
      { id: '30', label: 'System + catalogs', volumes: 200, aliases: 21, ioShare: { RANDOM: 0.1, SEQ: 0.1 }, hotSkew: 0.3 },
    ],
    spareAliases: 0,
    fabricCapacityIops: 220_000,
    backendCapacityIops: 45_000,
    cacheHitFrac: { RANDOM: 0.88, SEQ: 0.97 },
    connectSec: { RANDOM: 0.00012, SEQ: 0.00035 },
    backendLatencySec: 0.0006,
    pendBaseSec: 0.00003,
    backendDegrade: 1,
  },
  cfs: [
    { lparId: 'CF01', thinInterrupts: true },
    // F8: no thin interrupts on the shared CF.
    { lparId: 'CF02', thinInterrupts: false },
  ],
  // FICTIONAL request mix and sizes. CF01 holds 16 GB, CF02 13 GB, each 32 GB: either can absorb the
  // other's structures in a failure, but everything then lands on whichever CF survives (CF02 is the
  // weak shared one). CFTEST is not on the production preference list.
  // Placement reproduces the original 70/30 CF01/CF02 split; GBP0 and the
  // list structures on the weak shared CF02 are the F8 flaw. Lock requests are never converted to
  // async, so moving DB1G_LOCK1 to CF02 would hurt every Db2 transaction (a trap with a clue).
  cfStructures: [
    { name: 'DB1G_LOCK1', type: 'LOCK', requestShare: 0.4, cfLparId: 'CF01', costMult: 1, sizeGb: 2, prefList: PROD_CFS, lostImpact: 'DB2_DOWN' },
    { name: 'DB1G_GBP1', type: 'CACHE', requestShare: 0.3, cfLparId: 'CF01', costMult: 1, sizeGb: 14, prefList: PROD_CFS, lostImpact: 'DB2_GRECP' },
    { name: 'DB1G_GBP0', type: 'CACHE', requestShare: 0.18, cfLparId: 'CF02', costMult: 1, sizeGb: 10, prefList: PROD_CFS, lostImpact: 'DB2_GRECP' },
    { name: 'IXC_DEFAULT_1', type: 'LIST', requestShare: 0.06, cfLparId: 'CF02', costMult: 1, sizeGb: 1, prefList: PROD_CFS, lostImpact: 'NONE' },
    { name: 'CSQ_ADMIN', type: 'LIST', requestShare: 0.04, cfLparId: 'CF02', costMult: 1, sizeGb: 1, prefList: PROD_CFS, lostImpact: 'MQ_DOWN' },
    { name: 'DB1G_SCA', type: 'LIST', requestShare: 0.02, cfLparId: 'CF02', costMult: 1, sizeGb: 1, prefList: PROD_CFS, lostImpact: 'DB2_DOWN' },
  ],
  db2: [
    { ssid: 'DB1A', lparId: 'PROD1', bufferPoolGb: 40, maxDbat: 400 },
    { ssid: 'DB1B', lparId: 'PROD2', bufferPoolGb: 40, maxDbat: 400 },
    { ssid: 'DB1T', lparId: 'DEVT', bufferPoolGb: 8, maxDbat: 100 },
  ],
  cics: [
    { name: 'CICSAOR1', lparId: 'PROD1', maxTasks: 200, qrFrac: 0.6 },
    { name: 'CICSAOR3', lparId: 'PROD1', maxTasks: 200, qrFrac: 0.6 },
    { name: 'CICSAOR2', lparId: 'PROD2', maxTasks: 200, qrFrac: 0.6 },
    { name: 'CICSAOR4', lparId: 'PROD2', maxTasks: 200, qrFrac: 0.6 },
  ],
  jobClasses: [
    { jobClass: 'A', mode: 'JES', initiators: { PROD1: 12, PROD2: 10 } },
    { jobClass: 'D', mode: 'JES', initiators: { DEVT: 4 } },
  ],
  rmfIntervalMin: 30, // F11: coarse interval
};

/** FICTIONAL: memory model inputs (SPEC §5.8). */
export const MIDWEST_MEMORY = {
  osBaseGb: { PROD1: 60, PROD2: 60, DEVT: 30, SYSP: 12 } as Record<string, number>,
  cicsRegionGb: 8,
  batchJobGb: 0.4,
  db2WorkingSetGb: { DB1A: 160, DB1B: 160, DB1T: 30 } as Record<string, number>,
};

/** FICTIONAL: coupling facility CPU demand in ICF engines (CF model arrives in M3). */
export const MIDWEST_CF_BASE_ENGINES: Record<string, number> = { CF01: 0.02, CF02: 0.02, CFTEST: 0.25 };
