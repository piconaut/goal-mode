// Types the content layer declares and the game layer consumes (CLAUDE.md layering: content → sim ← game ← ui).
// Content owns the vocabulary it ships with its scenarios — event mechanisms and triggers, draft options, and a
// scenario's game content — so no file under `src/content` has to import from `src/game`. The game layer re-exports
// these for its own callers (`src/game/types.ts`, `src/game/run/shared.ts`).
import type { Command } from '../sim/core/commands';
import type { DifficultyId } from './difficulty';
// Type-only, like every import here: the module emits nothing, so this edge cannot become a runtime cycle
// (midwest-events and footprint import types back from this file). Keep it type-only.
import type { EventDef, ScriptedBeat } from './events/midwest-events';

/** A stakeholder whose trust is tracked. Scenarios name their own; every scenario has Finance and Regulator. */
export type Facet = string;

export type Mechanism =
  | 'CPU_CAPACITY'
  | 'CPU_PRIORITY'
  | 'CAPPING'
  | 'DEPENDENCY'
  | 'LOCK_CONTENTION'
  | 'CF_SERVICE'
  | 'QR_TCB'
  | 'THREAD_LIMIT'
  | 'ROUTING'
  | 'IO'
  | 'STORAGE'
  | 'JOB_FAILURE';

export type Trigger =
  | 'DEMAND_SURGE'
  | 'CHANGE_REGRESSION'
  | 'RUNAWAY_WORK'
  | 'BATCH_OVERLAP'
  | 'POLICY'
  | 'HARDWARE_FAULT'
  | 'NEW_WORKLOAD'
  | 'GROWTH'
  | 'APPLICATION_ERROR';

export interface DraftOption {
  id: string;
  title: string;
  description: string;
}

/** The team's own response goal for internal work (PT-50): the first period's average response time, seconds.
 *  A game rule, not an SLA: no incident and no trust. While it is missed for the content's sustained window,
 *  engineer-hours cost more. The scenario's content supplies one; absent, internal work has no goal and no cost. */
export interface InternalGoal {
  workloadId: string;
  avgRtSec: number;
}

export interface GameContent {
  events: EventDef[];
  story: ScriptedBeat[];
  opexBudgetMonthly: number;
  capexQuarter: number;
  maxDays: number;
  /** Stakeholder facets with their SLA-breach trust weights; absent = Midwest's (FACET_WEIGHT). */
  facets?: { id: Facet; weight: number }[];
  /** Facet that also loses trust on a missed batch deadline (default Retail). */
  batchMissFacet?: Facet;
  /** Planted flaws already fixed at the start on a difficulty (SPEC §11.2, §13.3). */
  startingFixes?: Partial<Record<DifficultyId, { flaw: string; label: string; commands: Command[] }[]>>;
  /** Analytics tools already installed on day 1 (SPEC §13.5); their measurement overhead applies from the start. */
  startTools?: string[];
  /** Who owns each workload, in business words, for the Inbox's "ask around" replies (PT-49). Absent = no named
   *  owner, and the reply calls them "the <workload> owner". */
  appOwners?: Record<string, string>;
  /** Facts about this business's calendar anyone in it knows (payday, month end, filing season). Absent = the
   *  CALENDAR contact has no standing facts and says so once the event rumours run out. */
  calendarFacts?: { id: string; text: string }[];
  /** The team's own response goal (PT-50) for one workload's first period. Not an SLA: no incident and no trust.
   *  While the newest clock hours miss it for `INTERNAL_SLOW_WINDOW_HOURS` in a row, hands-on engineer-hours cost
   *  `INTERNAL_SLOW_HOURS_MULT` times as much. Absent = no such rule. */
  internalGoal?: InternalGoal;
}
