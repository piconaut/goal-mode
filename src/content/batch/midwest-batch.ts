// FICTIONAL: Midwest Mutual nightly job network generator. Procedurally perturbed per
// night from the run seed; stream structure is fixed so players can learn it.

import { Rng } from '../../sim/core/rng';
import type { JobDef } from '../../sim/subsys/batch';

const H = 3600;
/** Seconds after the played day's 06:00 start for a wall-clock hour (hours < 6 = next morning). */
const at = (hour: number) => ((hour - 6 + 24) % 24) * H;
const DEADLINE = 24 * H; // 06:00 next morning

interface StreamSpec {
  stream: string;
  count: number;
  critical: boolean;
  startHour: number;
  shape: 'chain' | 'fan' | 'parallel';
  cpuSecRef: [number, number];
  ioCount: [number, number];
  ziipFrac: number;
  lockIntensity: number;
  usesDb2: boolean;
  jobClass: string;
  sysaff: string | null;
  /** Predecessor for the stream's first job(s): `${stream}:${index}` or `${stream}:last`. */
  after: string | null;
}

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

export function generateMidwestNetwork(seed: number, day: number, dayOfMonth: number): JobDef[] {
  const rng = new Rng([seed >>> 0, (day * 2654435761) >>> 0, 0x9e3779b9, 0x85ebca6b]);
  for (let i = 0; i < 8; i++) rng.nextU32();
  const monthEnd = dayOfMonth >= 29;
  // Data volumes grow with the business: batch work per job grows ~0.4% per played day.
  const growth = Math.pow(1.004, day);
  const jobs: JobDef[] = [];
  const lastOf: Record<string, string> = {};
  const nameOf = (stream: string, i: number) => `${stream}${String(i + 1).padStart(3, '0')}`.slice(0, 8);
  const resolve = (ref: string | null): string[] => {
    if (!ref) return [];
    const [stream, idx] = ref.split(':') as [string, string];
    return [idx === 'last' ? lastOf[stream]! : nameOf(stream, Number(idx) - 1)];
  };

  for (const s of STREAMS) {
    const count = monthEnd && !s.critical && s.stream !== 'DEV' ? Math.round(s.count * 1.3) : s.count;
    const sizeMult = (monthEnd && s.critical ? 1.15 : 1) * growth;
    for (let i = 0; i < count; i++) {
      const name = nameOf(s.stream, i);
      let preds: string[] = [];
      if (s.shape === 'chain') preds = i === 0 ? resolve(s.after) : [nameOf(s.stream, i - 1)];
      if (s.shape === 'fan') {
        const fanSize = count - 2;
        if (i === 0) preds = resolve(s.after);
        else if (i <= fanSize) preds = [nameOf(s.stream, 0)];
        else preds = Array.from({ length: fanSize }, (_, k) => nameOf(s.stream, k + 1));
      }
      if (s.shape === 'parallel' && i > 0 && rng.chance(0.35)) preds = [nameOf(s.stream, rng.int(0, i))];
      if (s.shape === 'parallel' && i === 0) preds = resolve(s.after);
      jobs.push({
        name,
        stream: s.stream,
        jobClass: s.jobClass,
        sysaff: s.sysaff,
        cpuSecRef: rng.range(s.cpuSecRef[0], s.cpuSecRef[1]) * sizeMult,
        ioCount: Math.round(rng.range(s.ioCount[0], s.ioCount[1]) * sizeMult),
        ziipFrac: s.ziipFrac,
        lockIntensity: s.lockIntensity,
        usesDb2: s.usesDb2,
        preds,
        earliestSec: at(s.startHour) + (s.shape === 'parallel' ? rng.range(0, 1.5 * H) : 0),
        critical: s.critical,
        deadlineSec: DEADLINE,
      });
    }
    lastOf[s.stream] = nameOf(s.stream, count - 1);
  }
  return jobs;
}
