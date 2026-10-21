import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_PRODUCTS, tieredMonthlyCost } from '../../src/content/pricing';
import { closeMonth, newCost, recordHour } from '../../src/sim/cost/mlc';
import { groupShares, newR4ha, stepR4ha } from '../../src/sim/cost/r4ha';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import { TICKS_PER_R4HA_SLOT } from '../../src/sim/core/units';
import { renderPartitionData, renderReport, renderWlmDetail, renderWlmSummary, renderCfActivity, renderDasdSummary } from '../../src/sim/measure/reports';

describe('R4HA and soft capping', () => {
  it('averages 48 five-minute slots and caps above defined capacity', () => {
    let r = newR4ha('L');
    // 4 hours at 120 MSU against DC 100: the average climbs slowly (starts from IPL zeros).
    let firstCap = -1;
    for (let t = 0; t < 48 * TICKS_PER_R4HA_SLOT; t++) {
      r = stepR4ha(r, 120, 100);
      if (r.capped && firstCap < 0) firstCap = t;
    }
    expect(r.r4ha).toBeCloseTo(120);
    // Capping starts once the 4-hour average passes 100 (after ~40 of 48 slots).
    expect(firstCap).toBeGreaterThan(38 * TICKS_PER_R4HA_SLOT);
    // Dropping consumption uncaps once the average falls back below DC.
    for (let t = 0; t < 12 * TICKS_PER_R4HA_SLOT; t++) r = stepR4ha(r, 20, 100);
    expect(r.capped).toBe(false);
  });

  it('short spikes above DC are allowed while the average stays under', () => {
    let r = newR4ha('L');
    for (let t = 0; t < 48 * TICKS_PER_R4HA_SLOT; t++) r = stepR4ha(r, 60, 100);
    for (let t = 0; t < 6 * TICKS_PER_R4HA_SLOT; t++) r = stepR4ha(r, 200, 100);
    expect(r.capped).toBe(false);
  });

  it('group capacity shares follow weights (SG24-7621 §4.21 example)', () => {
    const s = groupShares(50, [
      { id: 'LPAR1', weight: 100, demandMsu: 60 },
      { id: 'LPAR2', weight: 50, demandMsu: 60 },
      { id: 'LPAR3', weight: 150, demandMsu: 60 },
    ]);
    expect(s.LPAR1).toBeCloseTo(16.7, 1);
    expect(s.LPAR2).toBeCloseTo(8.3, 1);
    expect(s.LPAR3).toBeCloseTo(25, 1);
  });

  it('idle group members donate their share', () => {
    const s = groupShares(50, [
      { id: 'LPAR1', weight: 100, demandMsu: 60 },
      { id: 'LPAR2', weight: 50, demandMsu: 60 },
      { id: 'LPAR3', weight: 150, demandMsu: 1 },
    ]);
    expect(s.LPAR3).toBeCloseTo(1);
    expect(s.LPAR1! + s.LPAR2!).toBeCloseTo(49);
    expect(s.LPAR1! / s.LPAR2!).toBeCloseTo(2);
  });

  it('a capped LPAR is held to its defined capacity in the full sim', () => {
    const sc = structuredClone(MIDWEST.world);
    sc.lpars.find((l) => l.id === 'PROD2')!.definedCapacityMsu = 300;
    const scenario = { ...MIDWEST, world: sc, batchNetwork: MIDWEST.batchNetwork };
    let s = initState(5, scenario);
    let cappedMsu = 0;
    let cappedTicks = 0;
    for (let i = 0; i < 6 * 360 + 4 * 360; i++) {
      s = step(s, [], scenario);
      if (s.capping.lpars.find((r) => r.id === 'PROD2')!.capped) {
        cappedMsu += s.lpars.find((l) => l.id === 'PROD2')!.msuRate;
        cappedTicks++;
      }
    }
    expect(cappedTicks).toBeGreaterThan(100);
    expect(cappedMsu / cappedTicks).toBeLessThan(305);
    const prod2 = s.last.lpars.find((l) => l.lparId === 'PROD2')!;
    expect(prod2.scps.reduce((a, x) => a + x.delayCap, 0)).toBeGreaterThan(0);
  });
});

describe('MLC', () => {
  it('tiered price per MSU decreases', () => {
    expect(tieredMonthlyCost(45, 1)).toBeCloseTo(45 * 700);
    const marginalLow = tieredMonthlyCost(100, 1) - tieredMonthlyCost(99, 1);
    const marginalHigh = tieredMonthlyCost(1000, 1) - tieredMonthlyCost(999, 1);
    expect(marginalHigh).toBeLessThan(marginalLow);
  });

  it('bills the peak of the sums, limited by defined capacity', () => {
    let c = newCost(MIDWEST_PRODUCTS);
    // Hour 1: PROD1 peaks; hour 2: PROD2 peaks. Peak of sums < sum of peaks.
    c = recordHour(c, MIDWEST_PRODUCTS, { PROD1: 400, PROD2: 100, DEVT: 0, SYSP: 0 }, {}, 360);
    c = recordHour(c, MIDWEST_PRODUCTS, { PROD1: 100, PROD2: 400, DEVT: 0, SYSP: 0 }, {}, 720);
    expect(c.peaks.find((p) => p.product === 'ZOS')!.peakMsu).toBe(500);
    c = recordHour(c, MIDWEST_PRODUCTS, { PROD1: 300, PROD2: 300, DEVT: 300, SYSP: 0 }, { DEVT: 50 }, 1080);
    expect(c.peaks.find((p) => p.product === 'ZOS')!.peakMsu).toBe(650);
    expect(c.peaks.find((p) => p.product === 'CICS')!.peakMsu).toBe(600);
    const closed = closeMonth(c, MIDWEST_PRODUCTS);
    expect(closed.bills[0]!.total).toBeGreaterThan(0);
    expect(closed.peaks.every((p) => p.peakMsu === 0)).toBe(true);
  });
});

describe('RMF intervals and reports', () => {
  it('produces interval records with plausible content', () => {
    let s = initState(9, MIDWEST);
    for (let i = 0; i < 6 * 360; i++) s = step(s, [], MIDWEST); // 06:00 → 12:00
    expect(s.rmf.intervals.length).toBe(12); // 30-minute intervals
    const iv = s.rmf.intervals[s.rmf.intervals.length - 1]!;
    const onl = iv.wlm.find((r) => r.lparId === '*PLEX' && r.scKey === 'ONLHI#1')!;
    expect(onl.ended).toBeGreaterThan(100_000);
    expect(onl.pi).not.toBeNull();
    expect(onl.buckets.reduce((a, b) => a + b, 0)).toBeCloseTo(onl.ended, -2);
    expect(iv.cpu.find((c) => c.lparId === 'PROD1')!.polarity).toBe('3VH 2VM 1VL');
    for (const text of [renderWlmSummary(iv), renderWlmDetail(iv, 'ONLHI#1'), renderPartitionData(iv), renderCfActivity(iv), renderDasdSummary(iv)]) {
      expect(text.length).toBeGreaterThan(200);
    }
    expect(renderWlmSummary(iv)).toContain('ONLHI');
    expect(renderWlmDetail(iv, 'ONLHI#1')).toContain('RESPONSE TIME DISTRIBUTION');
    expect(renderReport(iv, 'WLM_DETAIL')).toBe(renderWlmDetail(iv, 'ONLHI#1'));
    expect(renderReport(iv, 'WLM_SUMMARY', undefined, 'PROD1')).toBe(renderWlmSummary(iv, 'PROD1'));
    expect(renderReport(iv, 'DASD')).toBe(renderDasdSummary(iv));
  });
});
