import { clockAt, formatClock } from '../../src/sim/core/clock';
import { Rng, seedRng } from '../../src/sim/core/rng';
import { TICKS_PER_DAY } from '../../src/sim/core/units';

describe('rng', () => {
  it('is deterministic for a seed and serialisable mid-stream', () => {
    const a = new Rng(seedRng(7));
    const seq1 = [a.nextU32(), a.nextU32(), a.nextU32()];
    const snap = a.snapshot();
    const tail1 = [a.float(), a.float()];
    const b = new Rng(seedRng(7));
    expect([b.nextU32(), b.nextU32(), b.nextU32()]).toEqual(seq1);
    const c = new Rng(snap);
    expect([c.float(), c.float()]).toEqual(tail1);
  });

  it('produces roughly uniform and normal values', () => {
    const r = new Rng(seedRng(1));
    let s = 0;
    let s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = r.normal();
      s += x;
      s2 += x * x;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
  });
});

describe('clock', () => {
  it('starts played days at 06:00 Monday', () => {
    const c = clockAt(0);
    expect(c.hourOfDay).toBeCloseTo(6);
    expect(c.dayOfWeek).toBe(0);
    expect(formatClock(0)).toBe('D1 06:00:00');
  });

  it('crosses midnight inside a played day', () => {
    const c = clockAt(TICKS_PER_DAY - 1); // 05:59:50 next calendar day
    expect(c.day).toBe(0);
    expect(c.calendarDay).toBe(1);
    expect(c.hourOfDay).toBeCloseTo(5 + 59 / 60 + 50 / 3600);
  });
});
