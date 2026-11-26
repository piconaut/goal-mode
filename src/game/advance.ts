// The one hour-by-hour advance loop shared by the browser worker, the play CLI and the bots.
// Ticks are chunked at the boundaries the callers record at (chart history and Monitor III
// MINTIME); with no hooks the whole advance is a single call, as it was before CL-17.

import { packOf } from '../content/packs';
import { MON3_HISTORY } from '../content/tools';
import { TICKS_PER_HOUR } from '../sim/core/units';
import { scenarioFor } from './difficulty';
import { HISTORY_EVERY_TICKS } from './history';
import { advance } from './run';
import { hasFeature } from './tools';
import type { GameContent } from './run/shared';
import type { RunState } from './types';

export interface AdvanceHooks {
  /** Called after a chunk ends on a chart-sample boundary (every HISTORY_EVERY_TICKS ticks). */
  onChunk?: (run: RunState) => void;
  /** Called after a chunk ends on a MINTIME boundary, while the run owns MON3. */
  onMintime?: (run: RunState) => void;
  /** Called after each whole hour; advancing stops when it returns true. */
  stopWhen?: (run: RunState) => boolean;
}

/**
 * Advance a live run by `hours` (fractional hours address individual ticks). The hooks see the
 * run at the chunk and hour boundaries; `stopWhen` is the operator's "page me now" condition.
 */
export function advanceHours(run: RunState, content: GameContent, hours: number, hooks: AdvanceHooks = {}): RunState {
  const scenario = scenarioFor(packOf(run.scenarioId).scenario, run.difficulty);
  let r = run;
  let left = Math.round(hours * TICKS_PER_HOUR);
  for (let h = 0; h < Math.ceil(hours) && left > 0 && r.phase === 'LIVE'; h++) {
    let hourLeft = Math.min(left, TICKS_PER_HOUR);
    while (hourLeft > 0 && r.phase === 'LIVE') {
      const toChunk = hooks.onChunk ? HISTORY_EVERY_TICKS - (r.sim.tick % HISTORY_EVERY_TICKS) : Infinity;
      const toMintime = hooks.onMintime ? MON3_HISTORY.mintimeTicks - (r.sim.tick % MON3_HISTORY.mintimeTicks) : Infinity;
      const k = Math.min(hourLeft, toChunk, toMintime);
      r = advance(r, scenario, content, k);
      hourLeft -= k;
      left -= k;
      if (hooks.onChunk && r.sim.tick % HISTORY_EVERY_TICKS === 0) hooks.onChunk(r);
      if (hooks.onMintime && r.sim.tick % MON3_HISTORY.mintimeTicks === 0 && hasFeature(r, 'MON3')) hooks.onMintime(r);
    }
    if (r.phase === 'LIVE' && hooks.stopWhen?.(r)) break;
  }
  return r;
}
