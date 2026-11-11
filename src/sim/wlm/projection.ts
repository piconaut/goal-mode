// The input WLM projects with (docs/wlm-design.md §5.4): this tick's evaluation input at *sustained* demand.
// A quiet tick is lifted to the period's smoothed demand, and a backlog adds a bounded boost instead of
// draining whole in one interval. Timeouts stay as in execution: without them a response-time PI has no upper
// scale and outweighs any velocity PI in an equal-importance trade. APPROX: real WLM projects from maximum demand and achievable demand taken
// from sampled history (WLM Services p.144); this is the sim's equivalent on its own dispatcher model.

import { TICK_SEC } from '../core/units';
import type { LparEvalInput, SliceSpec } from './eval/types';
import { ACC_DECAY, type ScpState } from './runtime';

export interface ProjectionTuning {
  demandUpliftMax: number;
  backlogBoostFrac: number;
}

/** Per-period demand uplift: sustained ÷ this tick's arriving demand, never below 1, capped. */
export function demandUplift(
  slices: readonly SliceSpec[],
  scps: readonly Pick<ScpState, 'scKey' | 'acc'>[],
  C: ProjectionTuning,
  fixedKeys?: ReadonlySet<string>,
): Record<string, number> {
  const arrive: Record<string, number> = {};
  for (const s of slices) {
    if (s.fixedDemand || fixedKeys?.has(s.key)) continue;
    arrive[s.scKey] = (arrive[s.scKey] ?? 0) + s.cpEngines + s.ziipEngines;
  }
  const out: Record<string, number> = {};
  for (const p of scps) {
    const a = arrive[p.scKey];
    if (a === undefined || !(a > 1e-9) || p.acc.demandCp === undefined) continue;
    const sustained = (p.acc.demandCp + (p.acc.demandZi ?? 0)) * (1 - ACC_DECAY);
    const f = Math.min(C.demandUpliftMax, sustained / a);
    // Never below the tick: a rising load is believed at once.
    if (f > 1 + 1e-9) out[p.scKey] = f;
  }
  return out;
}

/**
 * `fixedKeys`: slices whose demand is discrete and already exact (running batch jobs); never lifted.
 * Everything but demand and backlog (caps, I/O, paging, promotion, capacity) stays as this tick.
 */
export function projectionInput<T extends Omit<LparEvalInput, 'dpOf'>>(input: T, scps: readonly Pick<ScpState, 'scKey' | 'acc'>[], C: ProjectionTuning, fixedKeys?: ReadonlySet<string>): T {
  const uplift = demandUplift(input.slices, scps, C, fixedKeys);
  let slices: SliceSpec[] | null = null;
  let backlog: Record<string, number> | null = null;
  let ziipBacklog: Record<string, number> | null = null;
  for (let i = 0; i < input.slices.length; i++) {
    const s = input.slices[i]!;
    const f = s.fixedDemand || fixedKeys?.has(s.key) ? 1 : (uplift[s.scKey] ?? 1);
    if (f !== 1) {
      slices ??= [...input.slices];
      slices[i] = { ...s, rate: s.rate * f, cpEngines: s.cpEngines * f, ziipEngines: s.ziipEngines * f, ioRate: s.ioRate * f };
    }
    const bl = input.backlog[s.key];
    if (s.kind !== 'TXN' || bl === undefined || !(bl > 0)) continue;
    const bound = C.backlogBoostFrac * (s.cpEngines + s.ziipEngines) * f * TICK_SEC;
    if (bl <= bound) continue;
    backlog ??= { ...input.backlog };
    backlog[s.key] = bound;
    const zb = input.ziipBacklog?.[s.key];
    if (zb !== undefined && zb > 0) {
      ziipBacklog ??= { ...input.ziipBacklog };
      ziipBacklog[s.key] = (zb * bound) / bl;
    }
  }
  if (!slices && !backlog) return input;
  return { ...input, ...(slices ? { slices } : {}), ...(backlog ? { backlog } : {}), ...(ziipBacklog ? { ziipBacklog } : {}), prepared: undefined };
}
