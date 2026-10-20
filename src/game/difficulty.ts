// Difficulty is a game-layer concern: the sim sees an ordinary scenario whose growth has been scaled.

import { DIFFICULTIES, type DifficultyDef, type DifficultyId } from '../content/difficulty';
import type { Command } from '../sim/core/commands';
import type { Scenario } from '../sim/core/scenario';

export const difficultyOf = (id: DifficultyId | undefined): DifficultyDef => DIFFICULTIES[id ?? 'NORMAL'];

// Not persisted: a cache of derived scenarios so per-hour advance calls don't rebuild them.
const cache = new WeakMap<Scenario, Partial<Record<DifficultyId, Scenario>>>();
const baseOf = new WeakMap<Scenario, Scenario>();

/** The scenario as the sim should see it on this difficulty. Normal returns the scenario unchanged. */
export function scenarioFor(given: Scenario, id: DifficultyId | undefined): Scenario {
  // Idempotent: callers may pass a scenario that is already derived.
  const scenario = baseOf.get(given) ?? given;
  const d = difficultyOf(id);
  if (d.growthMult === 1) return scenario;
  let byId = cache.get(scenario);
  if (!byId) cache.set(scenario, (byId = {}));
  const hit = byId[d.id];
  if (hit) return hit;
  // Batch generators bake in their own growth; rescale per night so it compounds at growthMult × the base rate.
  const g = scenario.batchGrowthPerDay;
  const derived: Scenario = {
    ...scenario,
    workloads: scenario.workloads.map((w) => ({ ...w, growthPerDay: w.growthPerDay * d.growthMult })),
    batchNetwork: (seed, day, dayOfMonth) => {
      const f = Math.pow(1 + g * d.growthMult, day) / Math.pow(1 + g, day);
      return scenario.batchNetwork(seed, day, dayOfMonth).map((j) => ({ ...j, cpuSecRef: j.cpuSecRef * f, ioCount: Math.round(j.ioCount * f) }));
    },
  };
  byId[d.id] = derived;
  baseOf.set(derived, scenario);
  return derived;
}

const scaleExcess = (value: number, mult: number) => Math.max(0.05, 1 + (value - 1) * mult);

/** An event card's begin commands at this severity (1 = unchanged). Multipliers scale their excess over 1. */
export function scaleEventCommands(cmds: readonly Command[], mult: number): Command[] {
  if (mult === 1) return [...cmds];
  return cmds.map((c): Command => {
    switch (c.kind) {
      case 'SET_MODIFIER':
        return { ...c, value: scaleExcess(c.value, mult) };
      case 'SET_CF':
        return c.degrade === undefined ? c : { ...c, degrade: scaleExcess(c.degrade, mult) };
      case 'SET_DASD':
        return c.changes.backendDegrade === undefined ? c : { ...c, changes: { ...c.changes, backendDegrade: scaleExcess(c.changes.backendDegrade, mult) } };
      case 'SET_LOCK_BOOST':
        return { ...c, value: c.value * mult };
      case 'SET_LCU':
        return c.extraIops === undefined ? c : { ...c, extraIops: Object.fromEntries(Object.entries(c.extraIops).map(([k, v]) => [k, Math.round((v ?? 0) * mult)])) };
      default:
        return c;
    }
  });
}
