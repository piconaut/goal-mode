// The optional guided prologue, the shadow week (docs/prologue-design.md, BACKLOG list `prologue`). PRO-02 ships the
// engine with a two-beat test script; the chapters' content (Mon 26 … Fri 30) arrives with PRO-04 … PRO-06. The
// scenario is registered in `PROLOGUE_PACKS`, never in `SCENARIOS` or `PACKS`, so goldens, bench, bots, sweeps and
// the balance gate never see it.
import type { Scenario } from '../../sim/core/scenario';
import { MIDWEST_GAME } from '../game-midwest';
import { MIDWEST } from '../scenarios';
import type { GameContent, PrologueRules } from '../types';

/** Midwest's plant as is (§11.1); only the calendar moves: Monday the 26th of the month before Day 1. */
export const MIDWEST_PROLOGUE: Scenario = { ...MIDWEST, id: 'midwest-prologue', monthDayAtStart: 26 };

export const PROLOGUE_TUNING = {
  // FICTIONAL: high enough that no prologue day can end near a loss; the week's trust still moves visibly.
  trustFloor: 20,
  refilesPerRca: 1,
  // FICTIONAL: "breaks the system badly" (§6.4): an SLA hour this far down is no tuning slip.
  putBackAttainmentPct: 50,
} as const;

/** The engine's test script: one chapter, two beats (PRO-02). */
export const PROLOGUE_TEST_SCRIPT: PrologueRules = {
  ...PROLOGUE_TUNING,
  chapters: [{
    id: 'MON',
    day: 0,
    title: 'Mon 26 · Shadow week',
    beats: [
      {
        id: 'M1',
        at: { day: 0, time: '06:00' },
        steps: [
          { id: 'M1.hello', say: 'Morning. This week you sit next to me; next Monday it is yours. Today we only watch.', done: { id: 'ack' }, hints: [] },
          {
            id: 'M1.console', say: 'Open the Console and find the PI heat map.', target: 'console.pi-heatmap',
            done: { id: 'noted', args: { kind: 'tab', ref: 'console' } },
            hints: ['Where would you look first to see who is waiting?', 'The Console tab.', 'Click Console, top left.'],
          },
        ],
      },
      {
        id: 'M2',
        at: { day: 0, time: '11:00' },
        steps: [
          { id: 'M2.peak', say: 'The mobile peak is building. Watch, do not touch.', done: { id: 'ack' }, hints: [] },
        ],
      },
    ],
  }],
};

export const MIDWEST_PROLOGUE_GAME: GameContent = {
  ...MIDWEST_GAME,
  // The cards stay Midwest's defs (footprints, truth, fixes) but none is drawn: only the schedule starts them.
  otherTeamChanges: undefined,
  startingFixes: undefined,
  story: [],
  maxDays: 5,
  scheduledCards: [],
  prologue: PROLOGUE_TEST_SCRIPT,
};
