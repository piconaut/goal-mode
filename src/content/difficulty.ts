// FICTIONAL: difficulty presets (SPEC §11.2). Multipliers are relative to Normal, which is the balance
// baseline the strategy bots are tuned against.

export type DifficultyId = 'STORY' | 'NORMAL' | 'HARD' | 'IRONMAN';

export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  description: string;
  /** Scales every workload's daily growth and the nightly batch volume growth. */
  growthMult: number;
  /** Scales the expected number of event cards per day. */
  eventRateMult: number;
  /** Scales how hard event cards hit: the excess of each multiplier over 1, lock boosts and extra I/O. */
  eventSeverityMult: number;
  /** Constraint story beats (mandates, deadlines, freezes) arrive this many days later (+) or earlier (-). */
  constraintDayShift: number;
  /** Constraint ids this difficulty leaves out of the story. */
  skipConstraints: string[];
  /** Scales the monthly opex budget and the quarter's capex. */
  opexBudgetMult: number;
  capexMult: number;
  startTrust: number;
  /** Ironman: no pause while the day is live. */
  pauseAllowed: boolean;
  /** Morning hints in the briefing inbox (SPEC §11.2). */
  hints: 'CLEAR' | 'VAGUE' | 'NONE';
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  STORY: {
    id: 'STORY',
    name: 'Story',
    description: 'Slower growth, fewer events, more budget. Morning hints point at the report to read.',
    growthMult: 0.6,
    eventRateMult: 0.6,
    eventSeverityMult: 0.7,
    constraintDayShift: 3,
    skipConstraints: ['CFO_MANDATE'],
    opexBudgetMult: 1.15,
    capexMult: 1.3,
    startTrust: 75,
    pauseAllowed: true,
    hints: 'CLEAR',
  },
  NORMAL: {
    id: 'NORMAL',
    name: 'Normal',
    description: 'The intended balance. Occasional vague hints.',
    growthMult: 1,
    eventRateMult: 1,
    eventSeverityMult: 1,
    constraintDayShift: 0,
    skipConstraints: [],
    opexBudgetMult: 1,
    capexMult: 1,
    startTrust: 70,
    pauseAllowed: true,
    hints: 'VAGUE',
  },
  HARD: {
    id: 'HARD',
    name: 'Hard',
    description: 'Faster growth, more events, tighter budgets. No hints.',
    growthMult: 1.3,
    eventRateMult: 1.3,
    eventSeverityMult: 1.25,
    constraintDayShift: -4,
    skipConstraints: [],
    opexBudgetMult: 0.92,
    capexMult: 0.85,
    startTrust: 65,
    pauseAllowed: true,
    hints: 'NONE',
  },
  IRONMAN: {
    id: 'IRONMAN',
    name: 'Ironman',
    description: 'Hard, and the clock cannot be paused while the day is live.',
    growthMult: 1.3,
    eventRateMult: 1.3,
    eventSeverityMult: 1.25,
    constraintDayShift: -4,
    skipConstraints: [],
    opexBudgetMult: 0.92,
    capexMult: 0.85,
    startTrust: 65,
    pauseAllowed: false,
    hints: 'NONE',
  },
};
