import { BATCH_PROJECTION } from '../../content/wlm/tuning';
import { jobCpuDemand, jobPacing, type jobShape } from '../subsys/batch';
import { evaluateLpar, type LparEvalInput, type LparEvalResult } from './evaluate';

export interface BatchProjectionSlice {
  key: string;
  jobs: readonly { cp: number; zi: number; nextCp: number; nextZi: number; cfCpEngines: number; shape: ReturnType<typeof jobShape> }[];
}

/** APPROX: retain a conservative envelope of demand that a DP trial can restore across pools.
 * Check every intermediate distribution; never accept an unsettled or harmful recovery. Actual jobs,
 * I/O rates, caps and transaction backlogs stay at the measured snapshot. */
export function batchRecoveryAccepts(input: LparEvalInput, batch: readonly BatchProjectionSlice[], accepts: (result: LparEvalResult) => boolean): boolean {
  if (input.ziipServers === 0 || batch.length === 0) return accepts(evaluateLpar(input));
  const groups = batch;
  let current = input;
  const jobs = groups.map((g) => g.jobs.map((j) => ({ ...j })));
  const indices = groups.map((g) => input.slices.findIndex((s) => s.key === g.key));
  for (let round = 0; round <= BATCH_PROJECTION.maxRecoveryRounds; round++) {
    const result = evaluateLpar(current);
    if (!accepts(result)) return false;
    let changed = false;
    const slices = [...current.slices];
    groups.forEach((_g, gi) => {
      const i = indices[gi]!;
      if (i < 0) return;
      const slice = current.slices[i]!;
      const grant = result.slices[i]!;
      let cp = 0;
      let zi = 0;
      for (const j of jobs[gi]!) {
        const pace = jobPacing(j.shape, {
          cpWanted: j.cp,
          cpGot: slice.cpEngines > 0 ? grant.cpGranted * j.cp / slice.cpEngines : 0,
          ziipWanted: j.zi,
          ziipGot: slice.ziipEngines > 0 ? (grant.ziipGranted + grant.iipcpGranted) * j.zi / slice.ziipEngines : 0,
        });
        const demand = jobCpuDemand(j.shape, pace, true);
        // Current (old-DP) grants already set next tick's pacing before WLM chooses the trial.
        const nextCp = Math.max(j.cp, j.nextCp, demand.cp + j.cfCpEngines);
        const nextZi = Math.max(j.zi, j.nextZi, demand.ziip);
        changed ||= nextCp - j.cp > BATCH_PROJECTION.demandToleranceEngines || nextZi - j.zi > BATCH_PROJECTION.demandToleranceEngines;
        j.cp = nextCp;
        j.zi = nextZi;
        cp += nextCp;
        zi += nextZi;
      }
      slices[i] = { ...slice, cpEngines: cp, ziipEngines: zi };
    });
    if (!changed) return true;
    current = { ...current, slices, prepared: undefined };
  }
  return false;
}
