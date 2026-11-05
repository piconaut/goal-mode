import { clockAt } from '../sim/core/clock';
import { NEW_WORKLOAD_DAYS } from '../content/sla';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import type { Scenario } from '../sim/core/scenario';
import type { WorkloadDef } from '../sim/workload/types';
import { workItems, type WorkItem } from './classifyExplain';
import { difficultyOf, storyBeatsFor } from './difficulty';
import type { GameContent } from './run/shared';
import type { RunState } from './types';

/** Scenario workloads plus any added during the run (new-app events). */
export function allWorkloads(scenario: Scenario, run: RunState): WorkloadDef[] {
  return [...scenario.workloads, ...run.sim.extraWorkloads];
}

/** Recover go-live time from existing run history/content, including saves with no age metadata. */
export function isNewWorkload(run: RunState, content: GameContent, workloadId: string, hourIndex: number): boolean {
  if (!run.sim.extraWorkloads.some((w) => w.id === workloadId)) return false;
  const addsWorkload = (commands: NonNullable<GameContent['story'][number]['commands']>) =>
    commands.some((c) => c.kind === 'ADD_WORKLOAD' && c.workload.id === workloadId);
  const starts = run.events
    .filter((e) => e.started && addsWorkload(content.events.find((d) => d.id === e.defId)?.begin ?? []))
    .map((e) => e.startTick);
  for (const b of content.story) {
    const day = b.constraint ? Math.max(1, b.day + difficultyOf(run.difficulty).constraintDayShift) : b.day;
    if (addsWorkload(b.commands ?? []) && storyBeatsFor([b], run.difficulty, day).length > 0) starts.push(day * TICKS_PER_DAY);
  }
  const startTick = Math.min(...starts);
  const hourStart = hourIndex * TICKS_PER_HOUR;
  return hourStart + TICKS_PER_HOUR > startTick && hourStart < startTick + NEW_WORKLOAD_DAYS * TICKS_PER_DAY;
}

/** Everything the run's classification rules see today: workloads, address spaces and tonight's batch. */
export function runWorkItems(scenario: Scenario, run: RunState): WorkItem[] {
  return workItems(
    allWorkloads(scenario, run),
    [...scenario.addressSpaces, ...run.sim.extraAddressSpaces],
    scenario.batchNetwork(run.seed, run.day, clockAt(run.sim.tick).dayOfMonth),
  );
}
