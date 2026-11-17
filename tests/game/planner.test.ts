import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { PLANNER } from '../../src/content/planner';
import { MIDWEST } from '../../src/content/scenarios';
import { capacityForecasts, forecastSeries } from '../../src/game/planner';
import { advance, newRun, startDay } from '../../src/game/run';
import { buildView } from '../../src/game/view';
import { TICKS_PER_DAY } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };

describe('trend forecast', () => {
  const grow = (n: number, rate: number, noise = 0) => Array.from({ length: n }, (_, d) => ({ day: d, value: 60 * (1 + rate) ** d * (1 + (d % 2 ? noise : -noise)) }));

  it('recovers a clean exponential trend and finds the crossing day', () => {
    const f = forecastSeries('x', 'x', '%', grow(8, 0.02), 90, '90%')!;
    expect(f.growthPerDay).toBeCloseTo(0.02, 4);
    // 60 × 1.02^d ≥ 90 → d ≥ 20.5 → day 21
    expect(f.crossDay).toBe(21);
    expect(f.riskDay!).toBeLessThanOrEqual(21);
  });

  it('bands widen with the horizon and with noise', () => {
    const calm = forecastSeries('x', 'x', '%', grow(8, 0.01), null, null)!;
    const noisy = forecastSeries('x', 'x', '%', grow(8, 0.01, 0.08), null, null)!;
    const width = (p: { lo: number; hi: number }) => p.hi - p.lo;
    expect(width(calm.points.at(-1)!)).toBeGreaterThan(width(calm.points[0]!));
    expect(width(noisy.points[0]!)).toBeGreaterThan(width(calm.points[0]!));
    expect(calm.points).toHaveLength(PLANNER.horizonDays);
  });

  it('needs a few days of history', () => {
    expect(forecastSeries('x', 'x', '%', grow(PLANNER.minDays - 1, 0.01), null, null)).toBeNull();
  });

  it('leaves weekends out of the fit while keeping them on the chart (PT-16)', () => {
    // Two quiet weekend days in ten drag a 2 %-a-day weekday trend down; the fit skips them.
    const weekend = (d: number) => d % 7 === 5 || d % 7 === 6;
    const history = Array.from({ length: 10 }, (_, d) => ({ day: d, value: 60 * 1.02 ** d * (weekend(d) ? 0.45 : 1) }));
    const skipped = forecastSeries('x', 'x', 'MSU', history, null, null, Infinity, { weekend })!;
    expect(skipped.growthPerDay).toBeCloseTo(0.02, 3);
    expect(skipped.skippedWeekends).toBe(2);
    expect(skipped.history).toHaveLength(10);
    // Without the skip the weekends pull the trend down.
    expect(forecastSeries('x', 'x', 'MSU', history, null, null)!.growthPerDay).toBeLessThan(0.01);
  });
});

describe('capacity history', () => {
  it('records daily peaks at the end of each day and shows them only with the tool', () => {
    let r = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, TICKS_PER_DAY);
    expect(r.capacityDays).toHaveLength(1);
    const d = r.capacityDays[0]!;
    expect(d.peakCpcBusyPct).toBeGreaterThan(50);
    expect(d.peakCpcBusyPct).toBeLessThanOrEqual(100);
    expect(d.peakR4haSum).toBeGreaterThan(0);
    expect(buildView(r, MIDWEST).planner).toBeNull();
    expect(d.peakDemandMsu).toBeGreaterThan(0);
    expect(d.installedMsu).toBeGreaterThan(0);
    // One CPC: MSU demand is the busy share of its installed capacity. A stray engine count or MSU rating fails here.
    expect(d.peakDemandMsu!).toBeCloseTo((d.peakCpcBusyPct / 100) * d.installedMsu!, 6);
    r = { ...r, tools: ['CAP_PLANNER'], capacityDays: [0, 1, 2].map((i) => ({ ...d, day: i, peakCpcBusyPct: d.peakCpcBusyPct + i, peakDemandMsu: d.peakDemandMsu! + i, installedMsu: d.installedMsu })) };
    const v = buildView(r, MIDWEST);
    expect(v.planner!.forecasts.map((f) => f.id)).toContain('cpc');
    expect(capacityForecasts(r).find((f) => f.id === 'batch')).toBeDefined();
  }, 60_000);

  it('forecasts MSU demand against installed capacity and marks a capacity change (PT-16)', () => {
    let r = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, TICKS_PER_DAY);
    const base = r.capacityDays[0]!;
    const days = Array.from({ length: 7 }, (_, i) => ({
      ...base,
      day: i,
      peakCpcBusyPct: 60 + i,
      peakDemandMsu: 600 + 10 * i,
      installedMsu: i >= 4 ? 1200 : 1000,
    }));
    const cpc = capacityForecasts({ ...r, capacityDays: days }).find((f) => f.id === 'cpc')!;
    expect(cpc.unit).toBe('MSU');
    expect(cpc.history.at(-1)!.value).toBe(660);
    expect(cpc.limit).toBe(1080);
    expect(cpc.limitLabel).toBe('90% of installed 1200 MSU');
    expect(cpc.capacityChanges).toEqual([{ day: 4, from: 1000, to: 1200 }]);
  }, 60_000);
});
