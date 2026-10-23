import { describe, expect, it } from 'vitest';
import { endLabels } from '../../src/ui/LineChart';

describe('endLabels', () => {
  it('keeps well-separated labels where they are', () => {
    const out = endLabels([{ id: 'a', y: 100 }, { id: 'b', y: 40 }], 10, 160);
    expect(out.map((l) => [l.id, l.y])).toEqual([['b', 40], ['a', 100]]);
  });

  it('spreads overlapping labels at least 12px apart and inside the plot', () => {
    const out = endLabels([150, 152, 155, 158, 159, 160].map((y, k) => ({ id: `L${k}`, y })), 10, 160);
    for (let k = 1; k < out.length; k++) expect(out[k]!.y - out[k - 1]!.y).toBeGreaterThanOrEqual(12);
    expect(out.at(-1)!.y).toBeLessThanOrEqual(160);
    expect(out[0]!.y).toBeGreaterThanOrEqual(10);
  });
});
