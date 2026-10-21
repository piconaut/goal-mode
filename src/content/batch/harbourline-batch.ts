// FICTIONAL: Harbourline Bank nightly job network. End-of-day trade settlement (SET) is the critical
// path: it must reach the clearing house before the morning. Card and payment files follow it.

import { makeNetworkGenerator, type StreamSpec } from './network';

const STREAMS: StreamSpec[] = [
  { stream: 'SET', count: 16, critical: true, startHour: 19, shape: 'chain', cpuSecRef: [350, 700], ioCount: [400_000, 850_000], ziipFrac: 0.05, lockIntensity: 0.7, usesDb2: true, jobClass: 'A', sysaff: 'PRDA', after: null },
  { stream: 'CRD', count: 8, critical: true, startHour: 21, shape: 'chain', cpuSecRef: [150, 320], ioCount: [250_000, 500_000], ziipFrac: 0.05, lockIntensity: 0.5, usesDb2: true, jobClass: 'A', sysaff: 'PRDB', after: null },
  { stream: 'PAY', count: 10, critical: true, startHour: 21, shape: 'fan', cpuSecRef: [120, 300], ioCount: [150_000, 400_000], ziipFrac: 0.1, lockIntensity: 0.3, usesDb2: true, jobClass: 'A', sysaff: null, after: 'SET:8' },
  { stream: 'RSK', count: 28, critical: false, startHour: 20, shape: 'parallel', cpuSecRef: [350, 1100], ioCount: [150_000, 600_000], ziipFrac: 0.35, lockIntensity: 0.1, usesDb2: true, jobClass: 'A', sysaff: null, after: null },
  { stream: 'RPT', count: 30, critical: false, startHour: 21, shape: 'parallel', cpuSecRef: [80, 350], ioCount: [100_000, 400_000], ziipFrac: 0.1, lockIntensity: 0.05, usesDb2: true, jobClass: 'A', sysaff: null, after: null },
  { stream: 'BKP', count: 20, critical: false, startHour: 23, shape: 'parallel', cpuSecRef: [60, 180], ioCount: [800_000, 1_600_000], ziipFrac: 0.3, lockIntensity: 0, usesDb2: false, jobClass: 'A', sysaff: null, after: null },
  { stream: 'HSK', count: 15, critical: false, startHour: 1, shape: 'parallel', cpuSecRef: [40, 200], ioCount: [50_000, 300_000], ziipFrac: 0, lockIntensity: 0, usesDb2: false, jobClass: 'A', sysaff: null, after: null },
  { stream: 'DEV', count: 20, critical: false, startHour: 9, shape: 'parallel', cpuSecRef: [30, 300], ioCount: [20_000, 200_000], ziipFrac: 0, lockIntensity: 0, usesDb2: true, jobClass: 'D', sysaff: 'DEV1', after: null },
];

/** FICTIONAL: nightly volumes grow ~0.7% per played day. */
export const HARBOURLINE_BATCH_GROWTH_PER_DAY = 0.007;

export const generateHarbourlineNetwork = makeNetworkGenerator(STREAMS, HARBOURLINE_BATCH_GROWTH_PER_DAY);
