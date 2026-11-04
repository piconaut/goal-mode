import { budgetDelta } from '../../src/game/budget';

describe('budget comparison labels', () => {
  it('reports the combined 819k versus 780k example as five percent over budget', () => {
    const delta = budgetDelta(819_000, 780_000);
    expect(delta.deltaPct).toBeCloseTo(5);
    expect(delta.label).toBe('+5.0% vs budget');
    expect(delta.overLimit).toBe(false);
  });

  it('uses the unrounded billing check at and around 25 percent', () => {
    expect(budgetDelta(975_000, 780_000)).toMatchObject({ overLimit: false, label: '+25.0% vs budget', compactLabel: '+25.0%' });
    expect(budgetDelta(975_312, 780_000)).toMatchObject({ overLimit: true, label: '+25.0% vs budget (over limit)', compactLabel: '+25.0% (over limit)' });
    expect(budgetDelta(974_999, 780_000).overLimit).toBe(false);
    expect(budgetDelta(1_250_000.0000001, 1_000_000).overLimit).toBe(true);
  });

  it('keeps the over-limit warning for higher overruns and signed under-budget labels', () => {
    expect(budgetDelta(982_800, 780_000).label).toBe('+26.0% vs budget (over limit)');
    expect(budgetDelta(0, 780_000).label).toBe('-100.0% vs budget');
    expect(budgetDelta(780_000, 780_000).label).toBe('+0.0% vs budget');
  });

  it.each([[0, 0], [1, -1], [Infinity, 1], [1, NaN]])('handles unavailable or non-finite comparisons (%s, %s)', (total, budget) => {
    expect(budgetDelta(total, budget)).toEqual({ deltaPct: null, overLimit: false, label: 'Budget comparison unavailable', compactLabel: 'No budget comparison' });
  });
});
