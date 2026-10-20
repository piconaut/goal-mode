import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { SCENARIOS } from '../../src/content/scenarios';
import { scenarioFor } from '../../src/game/difficulty';
import { drawEvents, newRun } from '../../src/game/run';

const base = SCENARIOS.midwest!;

describe('difficulty presets', () => {
  it('Normal leaves the scenario untouched (balance baseline and golden runs)', () => {
    expect(scenarioFor(base, 'NORMAL')).toBe(base);
    expect(scenarioFor(base, undefined)).toBe(base);
  });

  it('scales online growth and batch volume growth, and is idempotent', () => {
    const story = scenarioFor(base, 'STORY');
    expect(scenarioFor(story, 'STORY')).toBe(story);
    expect(scenarioFor(base, 'STORY')).toBe(story);
    const w = base.workloads.find((x) => x.growthPerDay > 0)!;
    expect(story.workloads.find((x) => x.id === w.id)!.growthPerDay).toBeCloseTo(w.growthPerDay * 0.6, 12);
    const job = (s: typeof base, day: number) => s.batchNetwork(42, day, 10).find((j) => j.critical)!;
    expect(job(story, 0).cpuSecRef).toBeCloseTo(job(base, 0).cpuSecRef, 9);
    const ratio = job(story, 30).cpuSecRef / job(base, 30).cpuSecRef;
    expect(ratio).toBeCloseTo(Math.pow(1 + 0.004 * 0.6, 30) / Math.pow(1.004, 30), 9);
    const hard = scenarioFor(base, 'HARD');
    expect(job(hard, 30).cpuSecRef).toBeGreaterThan(job(base, 30).cpuSecRef);
  });

  it('sets budgets and starting trust per preset', () => {
    const normal = newRun(base, MIDWEST_GAME, 7);
    const hard = newRun(base, MIDWEST_GAME, 7, 'HARD');
    const story = newRun(base, MIDWEST_GAME, 7, 'STORY');
    expect(normal.difficulty).toBe('NORMAL');
    expect(hard.opexBudgetMonthly).toBeCloseTo(normal.opexBudgetMonthly * 0.92, 6);
    expect(story.capexRemaining).toBeCloseTo(normal.capexRemaining * 1.3, 6);
    expect(story.trust.Cards).toBe(75);
    expect(hard.trust.Cards).toBe(65);
  });

  it('draws fewer event cards on Story and more on Hard', () => {
    const count = (d: 'STORY' | 'NORMAL' | 'HARD') => {
      let n = 0;
      for (let seed = 1; seed <= 30; seed++) {
        let run = newRun(base, MIDWEST_GAME, seed, d);
        for (let day = 1; day < 40; day++) run = drawEvents(run, MIDWEST_GAME, day);
        n += run.events.length;
      }
      return n;
    };
    const [s, n, h] = [count('STORY'), count('NORMAL'), count('HARD')];
    expect(s).toBeLessThan(n);
    expect(h).toBeGreaterThan(n);
  });
});
