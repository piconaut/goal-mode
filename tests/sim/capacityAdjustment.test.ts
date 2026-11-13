import { describe, expect, it } from 'vitest';
import { capacityAdjustmentIndication, capacityLossPct } from '../../src/sim/hw/cpc';

describe('capacity adjustment (SMF70CAI)', () => {
  it('is not reported at or above the normal setting', () => {
    expect(capacityAdjustmentIndication({ capacitySetting: 6 })).toBeUndefined();
    expect(capacityAdjustmentIndication({ capacitySetting: 7, peakCapacitySetting: 6 })).toBeUndefined();
    expect(capacityLossPct({ capacitySetting: 6 })).toBe(0);
    expect(capacityLossPct({ capacitySetting: 6, peakCapacitySetting: 6 })).toBe(0);
  });

  it('reports 1–99 while reduced, and the loss is 100 minus it for every setting pair', () => {
    const settings = [4, 5, 6, 7] as const;
    for (const peak of settings)
      for (const cur of settings) {
        if (cur >= peak) continue;
        const cai = capacityAdjustmentIndication({ capacitySetting: cur, peakCapacitySetting: peak })!;
        expect(cai).toBeGreaterThanOrEqual(1);
        expect(cai).toBeLessThanOrEqual(99);
        // The Monitor III figure must equal the Partition Data one, including at a .5 ratio (setting 4 against 5).
        expect(capacityLossPct({ capacitySetting: cur, peakCapacitySetting: peak })).toBe(100 - cai);
      }
  });
});
