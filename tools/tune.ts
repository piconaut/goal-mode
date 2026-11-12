// `--tune k=v,k=v` for the bot and sweep tools: override policy adjustment tunables (POLICY_ADJUST in
// src/content/wlm/tuning.ts) for one process, to ablate a mechanism without editing content (e.g.
// `--tune rejectedSkipTicks=0`). Investigations only: a tuned run is not the game, and its results are not balance.

import { POLICY_ADJUST } from '../src/content/wlm/tuning';
import { TUNE_SPEC } from './ci/sweepPlan';

/** Tunables read once at module load (`ACC_DECAY` in src/sim/wlm/runtime.ts), so an override would not reach the sim. */
const READ_AT_LOAD = ['accDecay'];

/** Parse a `--tune` spec against the tunables it may change. Throws on an unknown key, a bad value or a key the sim
 * reads only at load. */
export function parseTune(spec: string, target: Readonly<Record<string, unknown>> = POLICY_ADJUST): Record<string, number> {
  if (!TUNE_SPEC.test(spec)) throw new Error(`--tune takes key=number pairs separated by commas: ${spec}`);
  const out: Record<string, number> = {};
  for (const pair of spec.split(',')) {
    const [key, value] = pair.split('=') as [string, string];
    if (typeof target[key] !== 'number') throw new Error(`--tune: no numeric POLICY_ADJUST.${key} (have ${Object.keys(target).filter((k) => typeof target[k] === 'number').join(', ')})`);
    if (READ_AT_LOAD.includes(key)) throw new Error(`--tune: POLICY_ADJUST.${key} is read once at load, so it cannot be overridden here`);
    out[key] = Number(value);
  }
  return out;
}

/** Apply a `--tune` spec to POLICY_ADJUST in this process. Returns the overrides applied. */
export function applyTune(spec: string): Record<string, number> {
  const overrides = parseTune(spec);
  Object.assign(POLICY_ADJUST, overrides);
  return overrides;
}
