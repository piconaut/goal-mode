// Career meta-progression (SPEC §11.3): XP carried across runs unlocks starting perks.

import type { DifficultyId } from './difficulty';

// FICTIONAL: XP per run: days survived, a win bonus and a grade bonus, scaled by difficulty so a Hard loss can
// out-earn a Story win. Roughly one level per two or three decent Normal runs.
export const CAREER_XP = {
  perDay: 10,
  victory: 150,
  grade: { S: 120, A: 80, B: 40, C: 15, D: 0 },
  difficultyMult: { STORY: 0.5, NORMAL: 1, HARD: 1.5, IRONMAN: 2 } satisfies Record<DifficultyId, number>,
} as const;

/** Cumulative XP thresholds; each level unlocks one starting perk (draft perk ids; pick one per run). */
export const CAREER_LEVELS: { xp: number; title: string; unlock: string | null }[] = [
  { xp: 0, title: 'Junior sysprog', unlock: null },
  { xp: 200, title: 'Sysprog', unlock: 'BELT_AND_BRACES' },
  { xp: 500, title: 'Senior sysprog', unlock: 'WELL_CONNECTED' },
  { xp: 900, title: 'Performance analyst', unlock: 'HMC_NINJA' },
  { xp: 1400, title: 'Capacity planner', unlock: 'FRIENDS_IN_FINANCE' },
  { xp: 2000, title: 'Mainframe architect', unlock: 'VENDOR_FRIEND' },
];
