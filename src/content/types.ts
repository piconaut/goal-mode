// Types the content layer declares and the game layer consumes (CLAUDE.md layering: content → sim ← game ← ui).
// Content owns the vocabulary it ships with its scenarios — event mechanisms and triggers, draft options, and a
// scenario's game content — so no file under `src/content` has to import from `src/game`. The game layer re-exports
// these for its own callers (`src/game/types.ts`, `src/game/run/shared.ts`).
import type { Command } from '../sim/core/commands';
import type { CostState } from '../sim/cost/mlc';
import type { DifficultyId } from './difficulty';
// Type-only, like every import here: the module emits nothing, so this edge cannot become a runtime cycle
// (midwest-events and footprint import types back from this file). Keep it type-only.
import type { EventDef, ScriptedBeat } from './events/midwest-events';
import type { OtherTeamChangeDef } from './otherTeamChanges';

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
  otherTeamChanges?: OtherTeamChangeDef[];
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
  /** Cards at fixed times instead of the daily draw (PRO-02, docs/prologue-design.md §11.1). A run with them draws
   *  nothing from the deck, and no routine rollouts; each card must be in `events`. Absent on the three scenarios. */
  scheduledCards?: ScheduledCard[];
  /** Commands applied at run creation on every difficulty, as `startingFixes` are on theirs (the prologue's flaw). */
  startingCommands?: Command[];
  /** A seeded month-to-date cost state in place of a fresh month (the prologue's 1st–25th, §8.4). */
  startingCost?: CostState;
  /** The guided prologue's script and rules; its presence turns the prologue-only rules on (§11.2). */
  prologue?: PrologueRules;
}

/** A card at a fixed time: an existing `EventDef` by id, on played day `day` at wall-clock `at` (HH:MM, 06:00 or
 *  later belongs to that day, earlier to its night). `durationHours` and `severity` override the card's. */
export interface ScheduledCard {
  card: string;
  day: number;
  at: string;
  durationHours?: number | null;
  /** Multiplier on the card's begin commands in place of the difficulty's event severity. */
  severity?: number;
}

/** A named predicate in `src/game/tutor/predicates.ts`, with its arguments: content names it, no closures. */
export interface TutorPredicateRef {
  id: string;
  args?: Record<string, string | number>;
}

/** One step of a beat (§6.2). `done` completes it however the player gets there; `ack` is the Next button. */
export interface TutorStep {
  id: string;
  say: string;
  /** A named UI anchor (`data-tour`) for the spotlight. */
  target?: string;
  done: TutorPredicateRef;
  /** The hint ladder: nudge, pointer, show me (§6.3). */
  hints: string[];
  /** When it no longer holds as the step starts, the step is skipped with `skipSay` (§6.2). */
  precondition?: TutorPredicateRef;
  skipSay?: string;
  /** The hint ladder's last rung for a change step: fill the Change Desk draft with these, never submit it (§6.3). */
  showMe?: { label: string; commands: Command[] };
}

/** A beat stops the clock (§11.3): at a fixed played day and time, or at the first hour boundary where `when`
 *  holds, no earlier than `at` when both are given. */
export interface TutorBeat {
  id: string;
  at?: { day: number; time: string };
  when?: TutorPredicateRef;
  steps: TutorStep[];
  /** The first change made while this beat is current fails, overriding the failure roll (§5.3 W4). */
  failFirstChange?: true;
}

export interface TutorChapter {
  id: string;
  /** Played day the chapter starts on (its 06:00). */
  day: number;
  title: string;
  beats: TutorBeat[];
}

export interface PrologueRules {
  /** No facet falls below this at a day's end, and no loss condition ends the run (§8.1). */
  trustFloor: number;
  /** How often one RCA may be filed again (§14 decision 6). */
  refilesPerRca: number;
  /** Ruth offers to put the chapter back once an SLA incident today falls below this attainment after a change the
   *  player made in the chapter (§6.4). */
  putBackAttainmentPct: number;
  chapters: TutorChapter[];
}
