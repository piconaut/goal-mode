import { describe, expect, it } from 'vitest';
import { CICS_STORAGE } from '../../src/content/subsys';
import { edsaInUseMb, effectiveMxt, leakedMb, storageCapTasks } from '../../src/sim/subsys/cics';

const k = CICS_STORAGE;

describe('CICS storage (EDSA) and SOS', () => {
  it('a leak grows linearly from its start', () => {
    const r = { leak: { startMb: 100, mbPerHour: 60, sinceTick: 10 } };
    expect(leakedMb({}, 50, 10)).toBe(0);
    expect(leakedMb(r, 10, 10)).toBe(100);
    expect(leakedMb(r, 10 + 360, 10)).toBeCloseTo(160);
  });

  it('storage cap is free EDSA over per-task storage, floored at the cushion', () => {
    expect(storageCapTasks({}, 0, 10, k)).toBe((k.defaultEdsaLimitMb - k.baseMb) / k.perTaskMb);
    expect(storageCapTasks({ edsaLimitMb: 1000 }, 0, 10, k)).toBe((1000 - k.baseMb) / k.perTaskMb);
    expect(storageCapTasks({ leak: { startMb: 10_000, mbPerHour: 0, sinceTick: 0 } }, 0, 10, k)).toBe(k.minTasks);
  });

  it('in-use EDSA counts base, leak and tasks, and never exceeds EDSALIM', () => {
    expect(edsaInUseMb({}, 10, 0, 10, k)).toBe(k.baseMb + 10 * k.perTaskMb);
    expect(edsaInUseMb({ edsaLimitMb: 500 }, 1000, 0, 10, k)).toBe(500);
  });

  it('effective MXT: MXT while tasks fit; thrashes below the cap once they do not', () => {
    expect(effectiveMxt(50, 100, 80, 0.5)).toBe(50);
    expect(effectiveMxt(200, 30, 20, 0.5)).toBe(200);
    expect(effectiveMxt(200, 20, 40, 0.5)).toBeCloseTo(20 * Math.sqrt(0.5));
    // A higher MXT never helps once in-flight demand is above the cap; MXT at the cap avoids the thrash.
    expect(effectiveMxt(30, 20, 40, 0.5)).toBeLessThan(effectiveMxt(25, 20, 40, 0.5));
    expect(effectiveMxt(20, 20, 40, 0.5)).toBe(20);
  });
});
