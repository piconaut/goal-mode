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

describe('LCU alias assignment', () => {
  it('draws from spare aliases and respects 256 devices per LCU', async () => {
    const { MIDWEST } = await import('../../src/content/scenarios');
    const { initState } = await import('../../src/sim/core/init');
    const { applyCommand } = await import('../../src/sim/core/commands');
    const s = initState(1, MIDWEST);
    expect(applyCommand(s, { kind: 'SET_LCU', lcuId: '21', aliases: 30 }).ok).toBe(false); // no spares yet
    const freed = applyCommand(s, { kind: 'SET_LCU', lcuId: '30', aliases: 1 }).state;
    expect(freed.config.dasd.spareAliases).toBe(20);
    const moved = applyCommand(freed, { kind: 'SET_LCU', lcuId: '21', aliases: 41 });
    expect(moved.ok).toBe(true);
    expect(moved.state.config.dasd.spareAliases).toBe(0);
    const many = { ...s, config: { ...s.config, dasd: { ...s.config.dasd, spareAliases: 100 } } };
    expect(applyCommand(many, { kind: 'SET_LCU', lcuId: '21', aliases: 57 }).message).toMatch(/56 aliases at most/);
  });
});
