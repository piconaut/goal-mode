import { MIDWEST } from '../../src/content/scenarios';
import { clockAt } from '../../src/sim/core/clock';
import { initState } from '../../src/sim/core/init';
import { Rng, seedRng } from '../../src/sim/core/rng';
import { step } from '../../src/sim/core/step';
import { TICK_SEC, TICKS_PER_HOUR } from '../../src/sim/core/units';
import { scheduledBurstMult, stepBurst } from '../../src/sim/workload/arrivals';
import type { BurstShape } from '../../src/sim/workload/types';

const SHAPE: BurstShape = { ratePerHour: 6, heightMult: [2, 3], durationSec: [60, 120], scheduled: [] };

describe('burst arrivals', () => {
  it('random bursts start at the configured rate and stay within their ranges', () => {
    const rng = new Rng(seedRng(3));
    let b = { mult: 1, leftSec: 0 };
    let starts = 0;
    const hours = 200;
    for (let i = 0; i < hours * TICKS_PER_HOUR; i++) {
      const next = stepBurst(b, SHAPE, TICK_SEC, rng);
      if (next.leftSec > Math.max(0, b.leftSec - TICK_SEC)) starts++;
      if (next.leftSec > 0) {
        expect(next.mult).toBeGreaterThanOrEqual(2);
        expect(next.mult).toBeLessThanOrEqual(3);
        expect(next.leftSec).toBeLessThanOrEqual(120);
      } else expect(next.mult).toBe(1);
      b = next;
    }
    expect(starts / hours).toBeGreaterThan(5);
    expect(starts / hours).toBeLessThan(7);
  });

  it('a scheduled burst decays linearly and skips weekends when asked', () => {
    const open: BurstShape = { ...SHAPE, scheduled: [{ hour: 9.5, heightMult: 4, durationSec: 1800, weekdaysOnly: true }] };
    // Tick 0 is Monday 06:00; 9:30 is 3.5 hours later.
    const at = (h: number, day = 0) => scheduledBurstMult(open, clockAt(day * 8640 + Math.round((h - 6) * TICKS_PER_HOUR)));
    expect(at(9.4)).toBe(1);
    expect(at(9.5)).toBeCloseTo(4);
    expect(at(9.75)).toBeCloseTo(2.5);
    expect(at(10)).toBe(1);
    expect(at(9.5, 5)).toBe(1); // Saturday
  });

  it('a workload with bursts gets spikier arrivals and only it carries burst state', () => {
    const world = structuredClone(MIDWEST.world);
    const workloads = structuredClone(MIDWEST.workloads);
    workloads.find((w) => w.id === 'MOBILE')!.shape.bursts = { ...SHAPE, ratePerHour: 3 };
    const bursty = { ...MIDWEST, world, workloads, batchNetwork: MIDWEST.batchNetwork };
    let a = initState(11, MIDWEST);
    let b = initState(11, bursty);
    let maxRatio = 0;
    for (let i = 0; i < 4 * TICKS_PER_HOUR; i++) {
      a = step(a, [], MIDWEST);
      b = step(b, [], bursty);
      const ra = a.last.workloads.find((w) => w.id === 'MOBILE')!.arrivalRate;
      const rb = b.last.workloads.find((w) => w.id === 'MOBILE')!.arrivalRate;
      maxRatio = Math.max(maxRatio, rb / ra);
    }
    expect(maxRatio).toBeGreaterThan(1.8);
    expect(b.workloads.find((w) => w.id === 'MOBILE')!.burst).toBeDefined();
    expect(b.workloads.find((w) => w.id === 'RBANK')!.burst).toBeUndefined();
  });
});
