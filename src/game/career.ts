// Career: XP and unlocks that persist across runs (SPEC §11.3). Pure; the worker stores it in IndexedDB.

import { CAREER_LEVELS, CAREER_XP } from '../content/career';
import type { DifficultyId } from '../content/difficulty';
import type { EndReport } from './endReport';
import type { RunState } from './types';

export interface CareerState {
  version: 1;
  xp: number;
  runs: number;
  wins: number;
  bestPoints: number;
}

export const EMPTY_CAREER: CareerState = { version: 1, xp: 0, runs: 0, wins: 0, bestPoints: 0 };

export function runXp(rep: EndReport, difficulty: DifficultyId): number {
  const base = rep.daysPlayed * CAREER_XP.perDay + (rep.victory ? CAREER_XP.victory : 0) + CAREER_XP.grade[rep.grade];
  return Math.round(base * CAREER_XP.difficultyMult[difficulty]);
}

export function recordRun(c: CareerState, rep: EndReport, difficulty: DifficultyId): CareerState {
  return { ...c, xp: c.xp + runXp(rep, difficulty), runs: c.runs + 1, wins: c.wins + (rep.victory ? 1 : 0), bestPoints: Math.max(c.bestPoints, rep.points) };
}

/** Index into CAREER_LEVELS. */
export function careerLevel(xp: number): number {
  let lvl = 0;
  CAREER_LEVELS.forEach((l, i) => {
    if (xp >= l.xp) lvl = i;
  });
  return lvl;
}

export function unlockedPerks(xp: number): string[] {
  return CAREER_LEVELS.slice(0, careerLevel(xp) + 1).flatMap((l) => (l.unlock ? [l.unlock] : []));
}

/** Pick (or clear) the run's starting perk: only before day 1 starts, and never on a daily challenge (same start for everyone). */
export function setStartingPerk(run: RunState, perkId: string | null, careerXp: number): RunState {
  if (run.day !== 0 || run.phase !== 'BRIEFING' || run.daily) return run;
  if (perkId !== null && !unlockedPerks(careerXp).includes(perkId)) return run;
  // A perk that grants a tool (Report Class Hoarder) installs it, and switching away uninstalls it; it can't be
  // picked over a tool already bought, so the uninstall never takes a purchase back.
  const hadTool = run.perks.includes('RC_HOARDER');
  if (perkId === 'RC_HOARDER' && !hadTool && run.tools.includes('RC_ADVISOR')) return run;
  const tools = run.tools.filter((t) => !(hadTool && t === 'RC_ADVISOR'));
  return { ...run, perks: perkId ? [perkId] : [], tools: perkId === 'RC_HOARDER' ? [...tools, 'RC_ADVISOR'] : tools };
}
