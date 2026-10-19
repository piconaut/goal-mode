// Bot strategies: how a bot behaves in each phase.

import type { GameContent } from '../src/game/run';
import { chooseDraft, submitRca } from '../src/game/run';
import type { RunState } from '../src/game/types';
import type { Scenario } from '../src/sim/core/scenario';

export interface Strategy {
  briefing(run: RunState, scenario: Scenario, content: GameContent): RunState;
  hourly(run: RunState, scenario: Scenario, content: GameContent): RunState;
  review(run: RunState, scenario: Scenario, content: GameContent): RunState;
}

const passive: Strategy = {
  briefing: (r) => r,
  hourly: (r) => r,
  review: (r, _s, c) => chooseDraft(r, c, r.draft?.[0]?.id ?? null),
};

/** Does nothing but answers RCAs perfectly (upper bound on RCA rewards). */
const oracleRca: Strategy = {
  ...passive,
  review: (r, s, c) => {
    let run = r;
    for (const i of run.incidents.filter((x) => !x.rca)) run = submitRca(run, i.id, i.truth.mechanism, i.truth.trigger);
    return passive.review(run, s, c);
  },
};

export const STRATEGIES: Record<string, Strategy> = { donothing: passive, oraclerca: oracleRca };
