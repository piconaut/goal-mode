// FICTIONAL: Midwest Mutual nightly job network (streams below; generator in ./network).

import { makeNetworkGenerator, type StreamSpec } from './network';

const STREAMS: StreamSpec[] = [
  { stream: 'STL', count: 14, critical: true, startHour: 20.5, shape: 'chain', cpuSecRef: [400, 800], ioCount: [450_000, 900_000], ziipFrac: 0.05, lockIntensity: 0.8, usesDb2: true, jobClass: 'A', sysaff: 'PROD1', after: null },
  { stream: 'CRD', count: 8, critical: true, startHour: 22, shape: 'chain', cpuSecRef: [150, 320], ioCount: [250_000, 500_000], ziipFrac: 0.05, lockIntensity: 0.6, usesDb2: true, jobClass: 'A', sysaff: 'PROD2', after: null },
  { stream: 'GLF', count: 7, critical: true, startHour: 20, shape: 'chain', cpuSecRef: [350, 700], ioCount: [300_000, 600_000], ziipFrac: 0.05, lockIntensity: 0.4, usesDb2: true, jobClass: 'A', sysaff: null, after: 'STL:last' },
  { stream: 'STM', count: 11, critical: true, startHour: 20, shape: 'fan', cpuSecRef: [180, 420], ioCount: [200_000, 500_000], ziipFrac: 0.1, lockIntensity: 0.2, usesDb2: true, jobClass: 'A', sysaff: null, after: 'STL:6' },
  { stream: 'RPT', count: 40, critical: false, startHour: 21, shape: 'parallel', cpuSecRef: [150, 700], ioCount: [100_000, 500_000], ziipFrac: 0.1, lockIntensity: 0.05, usesDb2: true, jobClass: 'A', sysaff: null, after: null },
  { stream: 'BKP', count: 20, critical: false, startHour: 23, shape: 'parallel', cpuSecRef: [60, 180], ioCount: [800_000, 1_600_000], ziipFrac: 0.3, lockIntensity: 0, usesDb2: false, jobClass: 'A', sysaff: null, after: null },
  { stream: 'DWH', count: 30, critical: false, startHour: 20, shape: 'parallel', cpuSecRef: [300, 1100], ioCount: [150_000, 600_000], ziipFrac: 0.35, lockIntensity: 0.1, usesDb2: true, jobClass: 'A', sysaff: null, after: null },
  { stream: 'HSK', count: 15, critical: false, startHour: 1, shape: 'parallel', cpuSecRef: [40, 200], ioCount: [50_000, 300_000], ziipFrac: 0, lockIntensity: 0, usesDb2: false, jobClass: 'A', sysaff: null, after: null },
  { stream: 'DEV', count: 20, critical: false, startHour: 9, shape: 'parallel', cpuSecRef: [30, 300], ioCount: [20_000, 200_000], ziipFrac: 0, lockIntensity: 0, usesDb2: true, jobClass: 'D', sysaff: 'DEVT', after: null },
];

/** FICTIONAL: data volumes grow with the business (~0.4% per played day). */
export const MIDWEST_BATCH_GROWTH_PER_DAY = 0.004;

export const generateMidwestNetwork = makeNetworkGenerator(STREAMS, MIDWEST_BATCH_GROWTH_PER_DAY);
