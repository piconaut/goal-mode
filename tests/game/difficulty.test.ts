import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { SCENARIOS } from '../../src/content/scenarios';
import { scaleEventCommands, scenarioFor, storyBeatsFor } from '../../src/game/difficulty';
import type { Command } from '../../src/sim/core/commands';
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

describe('scaleEventCommands', () => {
  it('leaves Normal untouched and scales multipliers by their excess over 1', () => {
    const cmds: Command[] = [
      { kind: 'SET_MODIFIER', mod: 'rate', key: 'MOBILE', value: 3 },
      { kind: 'SET_CF', lparId: 'CF01', degrade: 6 },
      { kind: 'SET_LOCK_BOOST', value: 4 },
      { kind: 'SET_LCU', lcuId: '21', extraIops: { SEQ: 1000 } },
      { kind: 'ABEND_JOB', critical: true },
    ];
    expect(scaleEventCommands(cmds, 1)).toEqual(cmds);
    const story = scaleEventCommands(cmds, 0.5);
    expect(story[0]).toMatchObject({ value: 2 });
    expect(story[1]).toMatchObject({ degrade: 3.5 });
    expect(story[2]).toMatchObject({ value: 2 });
    expect(story[3]).toMatchObject({ extraIops: { SEQ: 500 } });
    expect(story[4]).toEqual(cmds[4]);
  });

  it('keeps a shrinking multiplier positive when severity rises', () => {
    const [c] = scaleEventCommands([{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'MOBILE', value: 0.4 }], 2);
    expect(c).toMatchObject({ value: 0.05 });
  });
});

describe('storyBeatsFor', () => {
  const story = MIDWEST_GAME.story;
  const ids = (d: Parameters<typeof storyBeatsFor>[1], day: number) => storyBeatsFor(story, d, day).map((b) => b.id);

  it('keeps Normal on the scripted days', () => {
    expect(ids('NORMAL', 12)).toEqual(['CFO_MANDATE']);
    expect(ids('NORMAL', 20)).toEqual(['REG_DEADLINE']);
  });

  it('brings constraints earlier on Hard, later on Story, and drops the CFO mandate on Story', () => {
    expect(ids('HARD', 16)).toEqual(['REG_DEADLINE']);
    expect(ids('STORY', 23)).toEqual(['REG_DEADLINE']);
    expect([...Array(40).keys()].flatMap((d) => ids('STORY', d))).not.toContain('CFO_MANDATE');
  });

  it('never moves non-constraint beats', () => {
    expect(ids('HARD', 26)).toEqual(['MERGER']);
    expect(ids('STORY', 0)).toEqual(['WELCOME']);
  });
});

describe('starting flaws per difficulty', () => {
  it('hands Story the infrastructure fixes and says so; Normal keeps every flaw', () => {
    const story = newRun(base, MIDWEST_GAME, 7, 'STORY');
    const normal = newRun(base, MIDWEST_GAME, 7);
    expect(story.sim.config.rmfIntervalMin).toBe(15);
    expect(normal.sim.config.rmfIntervalMin).toBe(30);
    expect(story.inbox.some((m) => m.subject === 'Handover notes')).toBe(true);
    expect(normal.inbox.some((m) => m.subject === 'Handover notes')).toBe(false);
  });
});

describe('Story advance hint for the merger', () => {
  it('arrives two days before the merger on Story only', async () => {
    const { chooseDraft } = await import('../../src/game/run');
    const at = (d: 'STORY' | 'NORMAL', day: number) => {
      // Walk the story to `day` without simulating: REVIEW → BRIEFING runs the day's story beats.
      let r = newRun(base, MIDWEST_GAME, 7, d);
      for (let i = 0; i < day; i++) r = chooseDraft({ ...r, phase: 'REVIEW' }, MIDWEST_GAME, null);
      return r.inbox.filter((m) => m.subject === 'Before the acquired bank moves in');
    };
    expect(at('STORY', 23)).toHaveLength(0);
    expect(at('STORY', 24).map((m) => m.day)).toEqual([24]);
    expect(at('NORMAL', 24)).toHaveLength(0);
  });
});
