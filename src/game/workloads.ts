import { clockAt } from '../sim/core/clock';
import { NEW_WORKLOAD_DAYS } from '../content/sla';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/core/units';
import type { Scenario } from '../sim/core/scenario';
import type { AddressSpaceDef, WorkloadDef } from '../sim/workload/types';
import { workItems, type WorkItem } from './classifyExplain';
import { storyBeatDay } from './difficulty';
import type { GameContent } from './run/shared';
import type { RunState } from './types';

/** Scenario workloads plus any added during the run (new-app events). */
export function allWorkloads(scenario: Scenario, run: RunState): WorkloadDef[] {
  return [...scenario.workloads, ...run.sim.extraWorkloads];
}

/** Why a workload cannot be routed to these LPARs: every role its servers and host region need must be an
 * address space on each LPAR that gets work. Null when the placement is valid. This is the game layer's guard
 * for placement the sim cannot check itself: real Db2/CICS/MQ work cannot run where that product has no address
 * space, and the LPAR is not on the product's MLC list either (SCRT bills the LPARs where the product runs). */
export function placementRefusal(
  scenario: Scenario,
  addressSpaces: readonly AddressSpaceDef[],
  workload: WorkloadDef,
  routing: Readonly<Record<string, number>>,
): string | null {
  const lparIds = new Set(scenario.world.lpars.map((l) => l.id));
  const roles = [...new Set([...workload.servers.map((s) => s.role), ...(workload.hostRole ? [workload.hostRole] : [])])].sort();
  for (const lparId of Object.keys(routing).sort()) {
    if (!lparIds.has(lparId)) return `No LPAR ${lparId}`;
    if ((routing[lparId] ?? 0) <= 0 || roles.length === 0) continue;
    const running = new Set(addressSpaces.filter((a) => a.lparId === lparId).map((a) => a.role));
    const missing = roles.filter((r) => !running.has(r));
    if (missing.length > 0) return `${workload.id} needs ${missing.join(', ')} on ${lparId}, which does not run ${missing.length > 1 ? 'them' : 'it'}`;
  }
  return null;
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
    const day = storyBeatDay(b, run.difficulty);
    if (day !== null && addsWorkload(b.commands ?? [])) starts.push(day * TICKS_PER_DAY);
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
