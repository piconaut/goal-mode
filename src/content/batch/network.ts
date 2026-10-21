// Nightly job network generator shared by scenarios. Procedurally perturbed per night from the run
// seed; each scenario's stream structure is fixed so players can learn it.

import { Rng } from '../../sim/core/rng';
import type { JobDef } from '../../sim/subsys/batch';

const H = 3600;
/** Seconds after the played day's 06:00 start for a wall-clock hour (hours < 6 = next morning). */
export const at = (hour: number) => ((hour - 6 + 24) % 24) * H;
const DEADLINE = 24 * H; // 06:00 next morning

export interface StreamSpec {
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

/** Month end: non-critical streams (except development) run 30% more jobs, critical jobs are 15% bigger. */
export function makeNetworkGenerator(streams: StreamSpec[], growthPerDay: number, devStream = 'DEV') {
  return (seed: number, day: number, dayOfMonth: number): JobDef[] => {
    const rng = new Rng([seed >>> 0, (day * 2654435761) >>> 0, 0x9e3779b9, 0x85ebca6b]);
    for (let i = 0; i < 8; i++) rng.nextU32();
    const monthEnd = dayOfMonth >= 29;
    // Data volumes grow with the business.
    const growth = Math.pow(1 + growthPerDay, day);
    const jobs: JobDef[] = [];
    const lastOf: Record<string, string> = {};
    const nameOf = (stream: string, i: number) => `${stream}${String(i + 1).padStart(3, '0')}`.slice(0, 8);
    const resolve = (ref: string | null): string[] => {
      if (!ref) return [];
      const [stream, idx] = ref.split(':') as [string, string];
      return [idx === 'last' ? lastOf[stream]! : nameOf(stream, Number(idx) - 1)];
    };

    for (const s of streams) {
      const count = monthEnd && !s.critical && s.stream !== devStream ? Math.round(s.count * 1.3) : s.count;
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
  };
}
