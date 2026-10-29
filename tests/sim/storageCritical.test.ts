import { describe, expect, it } from 'vitest';
import { slicePagingFrac, type SliceSpec } from '../../src/sim/wlm/evaluate';

const slice = (scKey: string, cpEngines: number) => ({ key: scKey, scKey, cpEngines, ziipEngines: 0 }) as unknown as SliceSpec;

describe('Storage Critical paging redistribution', () => {
  const slices = [slice('HI#1', 2), slice('MED#1', 1), slice('LO#1', 1)];
  const weight = { 'HI#1': 1, 'MED#1': 3, 'LO#1': 5 };

  it('is the image-wide fraction when nothing is protected', () => {
    expect(slicePagingFrac(slices, 0.2, new Set(), weight)).toEqual([0.2, 0.2, 0.2]);
  });

  it('moves the protected share to unprotected work, more to less important, total unchanged', () => {
    const pg = slicePagingFrac(slices, 0.2, new Set(['HI#1']), weight);
    expect(pg[0]).toBe(0);
    expect(pg[2]!).toBeGreaterThan(pg[1]!);
    expect(pg[1]!).toBeGreaterThan(0.2);
    const total = slices.reduce((a, s, i) => a + s.cpEngines * pg[i]!, 0);
    expect(total).toBeCloseTo(0.2 * 4, 9);
  });

  it('costs nothing when there is no paging', () => {
    expect(slicePagingFrac(slices, 0, new Set(['HI#1']), weight)).toEqual([0, 0, 0]);
  });
});
