import { describe, expect, it } from 'vitest';
import { dailySeed, shareText } from '../../src/game/daily';

describe('dailySeed', () => {
  it('is stable for a fixed date', () => {
    expect(dailySeed('2026-10-20')).toBe(dailySeed('2026-10-20'));
    const s = dailySeed('2026-10-20');
    expect(Number.isInteger(s) && s >= 0 && s < 1e6).toBe(true);
  });
  it('differs between dates', () => {
    const seeds = new Set(['2026-10-20', '2026-10-21', '2026-10-22', '2027-01-01'].map(dailySeed));
    expect(seeds.size).toBe(4);
  });
});

describe('shareText', () => {
  const base = { seed: 123456, difficulty: 'Normal', daysPlayed: 40, maxDays: 40, grade: 'A', points: 84, score: 2716 };
  it('formats a daily run', () => {
    expect(shareText({ ...base, daily: '2026-10-20' })).toBe('GOAL MODE · daily 2026-10-20 · Normal · seed 123456 · day 40/40 · grade A (84) · score 2716');
  });
  it('omits the daily segment for ordinary runs', () => {
    expect(shareText({ ...base, daily: null })).toBe('GOAL MODE · Normal · seed 123456 · day 40/40 · grade A (84) · score 2716');
  });
});
