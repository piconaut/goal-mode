import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { careerLevel, EMPTY_CAREER, recordRun, runXp, setStartingPerk, unlockedPerks } from '../../src/game/career';
import type { EndReport } from '../../src/game/endReport';
import { newRun } from '../../src/game/run';

const rep = (over: Partial<EndReport>): EndReport =>
  ({ daysPlayed: 20, victory: false, endlessDays: null, grade: 'C', points: 1000, meanSlaPct: 95, overallTrust: 50, days: [], decisions: [], biggestIncident: null, bestRca: null, piHeat: { scKeys: [], byDay: [] }, r4haByLpar: { lparIds: [], byDay: [] }, ...over }) as EndReport;

describe('career', () => {
  it('XP: days, win and grade bonuses, scaled by difficulty', () => {
    expect(runXp(rep({}), 'NORMAL')).toBe(20 * 10 + 15);
    expect(runXp(rep({ daysPlayed: 40, victory: true, grade: 'A' }), 'NORMAL')).toBe(400 + 150 + 80);
    expect(runXp(rep({}), 'HARD')).toBe(Math.round(215 * 1.5));
    expect(runXp(rep({}), 'STORY')).toBeLessThan(runXp(rep({}), 'NORMAL'));
  });

  it('records runs and unlocks perks by level', () => {
    let c = recordRun(EMPTY_CAREER, rep({ victory: true, points: 2500 }), 'NORMAL');
    c = recordRun(c, rep({ points: 900 }), 'NORMAL');
    expect(c).toMatchObject({ runs: 2, wins: 1, bestPoints: 2500 });
    expect(careerLevel(0)).toBe(0);
    expect(unlockedPerks(0)).toEqual([]);
    expect(unlockedPerks(c.xp)).toContain('BELT_AND_BRACES');
  });

  it('starting perk only before day 1, only if unlocked, never on a daily', () => {
    const r = newRun(MIDWEST, MIDWEST_GAME, 7);
    expect(setStartingPerk(r, 'BELT_AND_BRACES', 0).perks).toEqual([]);
    expect(setStartingPerk(r, 'BELT_AND_BRACES', 250).perks).toEqual(['BELT_AND_BRACES']);
    expect(setStartingPerk(setStartingPerk(r, 'BELT_AND_BRACES', 250), null, 250).perks).toEqual([]);
    expect(setStartingPerk({ ...r, phase: 'LIVE' }, 'BELT_AND_BRACES', 250).perks).toEqual([]);
    expect(setStartingPerk({ ...r, daily: '2026-10-20' }, 'BELT_AND_BRACES', 250).perks).toEqual([]);
  });
});
