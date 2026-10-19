import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { financeView } from '../../src/game/finance';
import { advance, newRun, startDay } from '../../src/game/run';
import { closeMonth } from '../../src/sim/cost/mlc';

const content = { ...MIDWEST_GAME, events: [] };

describe('finance view', () => {
  it('explains the bill: peak contributors sum to the peak, SCRT text, CFO target', () => {
    const r = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 8 * 360);
    const f = financeView(r, MIDWEST);
    expect(f.monthToDate).toBeGreaterThan(0);
    for (const p of f.products) {
      const sum = Object.values(p.peakByLpar).reduce((a, x) => a + x, 0);
      expect(sum).toBeCloseTo(p.peakMsu, 6);
      expect(Object.keys(p.peakByLpar).sort()).toEqual([...p.lpars].sort());
    }
    expect(f.hourly.labels.length).toBe(f.hourly.series.ZOS!.length);
    expect(f.scrt).toMatch(/S U B - C A P A C I T Y/);
    expect(f.scrt).toMatch(/z\/OS/);
    expect(f.cfoTarget).toBeNull();
    const billed = { ...r, constraints: ['CFO_MANDATE'], sim: { ...r.sim, cost: closeMonth(r.sim.cost, MIDWEST.products) } };
    const g = financeView(billed, MIDWEST);
    expect(g.bills).toHaveLength(1);
    expect(g.cfoTarget).toBeCloseTo(0.9 * g.bills[0]!.total);
  }, 60_000);
});
