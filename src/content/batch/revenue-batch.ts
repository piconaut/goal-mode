// FICTIONAL: State Revenue Agency nightly job network. The refund run (REF) is the critical path: refund
// files must reach the Treasury by morning. Compliance analytics (CMP) is big, zIIP-heavy and not critical.

import { makeNetworkGenerator, type StreamSpec } from './network';

const STREAMS: StreamSpec[] = [
  { stream: 'REF', count: 16, critical: true, startHour: 21, shape: 'chain', cpuSecRef: [330, 650], ioCount: [400_000, 850_000], ziipFrac: 0.05, lockIntensity: 0.7, usesDb2: true, jobClass: 'A', sysaff: 'PROD1', after: null },
  { stream: 'EMP', count: 8, critical: true, startHour: 22, shape: 'chain', cpuSecRef: [150, 320], ioCount: [250_000, 500_000], ziipFrac: 0.05, lockIntensity: 0.5, usesDb2: true, jobClass: 'A', sysaff: 'PROD2', after: null },
  { stream: 'NTC', count: 10, critical: true, startHour: 21, shape: 'fan', cpuSecRef: [120, 300], ioCount: [150_000, 400_000], ziipFrac: 0.1, lockIntensity: 0.2, usesDb2: true, jobClass: 'A', sysaff: null, after: 'REF:8' },
  { stream: 'CMP', count: 32, critical: false, startHour: 20, shape: 'parallel', cpuSecRef: [350, 1100], ioCount: [150_000, 600_000], ziipFrac: 0.35, lockIntensity: 0.1, usesDb2: true, jobClass: 'A', sysaff: null, after: null },
  { stream: 'PRN', count: 25, critical: false, startHour: 22, shape: 'parallel', cpuSecRef: [80, 300], ioCount: [100_000, 400_000], ziipFrac: 0, lockIntensity: 0.05, usesDb2: true, jobClass: 'A', sysaff: null, after: null },
  { stream: 'BKP', count: 20, critical: false, startHour: 23, shape: 'parallel', cpuSecRef: [60, 180], ioCount: [800_000, 1_600_000], ziipFrac: 0.3, lockIntensity: 0, usesDb2: false, jobClass: 'A', sysaff: null, after: null },
  { stream: 'HSK', count: 15, critical: false, startHour: 1, shape: 'parallel', cpuSecRef: [40, 200], ioCount: [50_000, 300_000], ziipFrac: 0, lockIntensity: 0, usesDb2: false, jobClass: 'A', sysaff: null, after: null },
  { stream: 'DEV', count: 20, critical: false, startHour: 9, shape: 'parallel', cpuSecRef: [30, 300], ioCount: [20_000, 200_000], ziipFrac: 0, lockIntensity: 0, usesDb2: true, jobClass: 'D', sysaff: 'DEVT', after: null },
];

/** FICTIONAL: returns pile up during filing season, so nightly volumes grow ~0.8% per played day. */
export const REVENUE_BATCH_GROWTH_PER_DAY = 0.008;

export const generateRevenueNetwork = makeNetworkGenerator(STREAMS, REVENUE_BATCH_GROWTH_PER_DAY);
