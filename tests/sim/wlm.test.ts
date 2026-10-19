import { BASEPOL } from '../../src/content/wlm/basepol';
import { classify, wildcardMatch } from '../../src/sim/wlm/classify';
import { addToBuckets, emptyBuckets, percentilePi, performanceIndex, velocityOf } from '../../src/sim/wlm/goals';
import { splitPeriods } from '../../src/sim/workload/periods';
import { lognormCdf, normCdf, normInv } from '../../src/sim/core/math';

describe('math', () => {
  it('normal CDF and inverse agree', () => {
    for (const p of [0.01, 0.2, 0.5, 0.9, 0.999]) expect(normCdf(normInv(p))).toBeCloseTo(p, 4);
  });
  it('log-normal CDF at the median', () => {
    const mean = 2;
    const sigma = 0.6;
    const median = mean * Math.exp((-sigma * sigma) / 2);
    expect(lognormCdf(median, mean, sigma)).toBeCloseTo(0.5, 6);
  });
});

describe('classification', () => {
  it('wildcards', () => {
    expect(wildcardMatch('DB*', 'DB1AMSTR')).toBe(true);
    expect(wildcardMatch('*IRLM', 'DB1AIRLM')).toBe(true);
    expect(wildcardMatch('AUTH?', 'AUTH1')).toBe(true);
    expect(wildcardMatch('AUTH?', 'AUTH12')).toBe(false);
  });
  it('first matching rule wins, in order', () => {
    // *IRLM appears before DB* in BASEPOL, so IRLM lands in SYSSTC.
    expect(classify(BASEPOL, { subsystem: 'STC', TN: 'DB1AIRLM' }).serviceClass).toBe('SYSSTC');
    expect(classify(BASEPOL, { subsystem: 'STC', TN: 'DB1AMSTR' }).serviceClass).toBe('STCMED');
  });
  it('system address spaces are forced into SYSTEM', () => {
    expect(classify(BASEPOL, { subsystem: 'STC', TN: 'XCFAS' }).serviceClass).toBe('SYSTEM');
  });
  it('unknown subsystem rules fall back to SYSOTHER (non-STC) or SYSSTC (STC)', () => {
    expect(classify(BASEPOL, { subsystem: 'OMVS', UI: 'X' }).serviceClass).toBe('SYSOTHER');
    const noStc = { ...BASEPOL, subsystems: BASEPOL.subsystems.filter((s) => s.subsystem !== 'STC') };
    expect(classify(noStc, { subsystem: 'STC', TN: 'ANYTHING' }).serviceClass).toBe('SYSSTC');
  });
  it('nested rules refine the outer match', () => {
    const def = {
      ...BASEPOL,
      subsystems: [
        {
          subsystem: 'DDF' as const,
          defaultServiceClass: 'DDFPRD',
          defaultReportClass: null,
          rules: [
            {
              qualifier: 'UI' as const,
              pattern: 'MOB*',
              serviceClass: 'ONLMED',
              reportClass: 'RMOBILE',
              children: [{ qualifier: 'PK' as const, pattern: 'LOGIN*', serviceClass: 'ONLHI', reportClass: null, children: [] }],
            },
          ],
        },
      ],
    };
    expect(classify(def, { subsystem: 'DDF', UI: 'MOBAPI', PK: 'LOGINPKG' })).toMatchObject({ serviceClass: 'ONLHI', reportClass: 'RMOBILE' });
    expect(classify(def, { subsystem: 'DDF', UI: 'MOBAPI', PK: 'OTHER' }).serviceClass).toBe('ONLMED');
    expect(classify(def, { subsystem: 'DDF', UI: 'BIUSER' }).serviceClass).toBe('DDFPRD');
  });
});

describe('performance index', () => {
  // Response time distribution from SG24-7621 Figure 3-10 (goal 70% within 0.600 s).
  const sg24 = [22925, 756, 657, 562, 520, 475, 388, 379, 330, 279, 237, 805, 1414, 899];
  it('reproduces the Redbook percentile PI example', () => {
    expect(percentilePi(sg24, 70)).toBe(0.5);
  });
  it('picks the first bucket reaching the percentile', () => {
    expect(percentilePi(sg24, 85)).toBe(1.1);
    expect(percentilePi(sg24, 90)).toBe(2.0);
    expect(percentilePi(sg24, 99)).toBe(4.0);
  });
  it('velocity and discretionary PIs', () => {
    expect(velocityOf(30, 70)).toBeCloseTo(30);
    const v = performanceIndex({ kind: 'VEL', velocity: 60 }, { completions: 0, rtSumSec: 0, buckets: [], usingSamples: 30, delaySamples: 70 });
    expect(v).toBeCloseTo(2);
    expect(performanceIndex({ kind: 'DISC' }, { completions: 0, rtSumSec: 0, buckets: [], usingSamples: 0, delaySamples: 0 })).toBe(0.81);
  });
  it('average-RT PI is actual/goal', () => {
    expect(performanceIndex({ kind: 'AVG', rtSec: 0.5 }, { completions: 10, rtSumSec: 7.5, buckets: [], usingSamples: 0, delaySamples: 0 })).toBeCloseTo(1.5);
  });
  it('bucket filling matches the log-normal distribution', () => {
    const b = emptyBuckets();
    addToBuckets(b, 0.25, 1000, 0.1, 0.5);
    expect(b.reduce((a, x) => a + x, 0)).toBeCloseTo(1000);
    expect(percentilePi(b, 50)).toBe(0.5);
  });
});

describe('multi-period ageing', () => {
  it('short transactions finish in period 1, long ones age into period 2', () => {
    const short = splitPeriods([2000, null], 200, 0.9);
    const long = splitPeriods([2000, null], 80_000, 1.4);
    expect(short[0]!.endFrac).toBeGreaterThan(0.99);
    expect(long[1]!.endFrac).toBeGreaterThan(0.95);
    // Long queries still burn their first 2000 SU in period 1.
    expect(long[0]!.cpuFrac).toBeGreaterThan(0);
    expect(long[0]!.cpuFrac).toBeLessThan(0.05);
    for (const split of [short, long]) {
      expect(split.reduce((a, p) => a + p.cpuFrac, 0)).toBeCloseTo(1, 6);
      expect(split.reduce((a, p) => a + p.endFrac, 0)).toBeCloseTo(1, 6);
    }
  });
});
