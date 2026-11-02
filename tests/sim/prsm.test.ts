import { MIDWEST_WORLD } from '../../src/content/scenarios/midwest';
import { resolveCpc } from '../../src/sim/hw/pools';
import {
  allocatePool,
  entitlements,
  lparOverheadFrac,
  mvsBusyFrac,
  polarity,
  polarityEfficiency,
} from '../../src/sim/hw/prsm';

describe('HiperDispatch polarity (Watson & Walker rules)', () => {
  const cases: [number, number, [number, number, number]][] = [
    [0.4, 2, [0, 1, 1]],
    [0.8, 4, [0, 1, 3]],
    [1.0, 4, [0, 2, 2]],
    [1.2, 4, [0, 2, 2]],
    [1.6, 4, [1, 1, 2]],
    [2.3, 6, [1, 2, 3]],
    [2.8, 6, [2, 1, 3]],
    [4.0, 6, [3, 2, 1]],
    [4.52, 6, [4, 1, 1]],
    [6.0, 6, [6, 0, 0]],
    [3.9, 4, [3, 1, 0]],
  ];
  for (const [e, l, [vh, vm, vl]] of cases) {
    it(`E=${e}, L=${l} → ${vh}VH ${vm}VM ${vl}VL`, () => {
      expect(polarity(e, l)).toEqual({ vh, vm, vl });
    });
  }
});

describe('entitlement and white space', () => {
  it('splits by weight and caps at logical count', () => {
    const e = entitlements(
      [
        { weight: 500, logical: 6, demandEngines: 0, capEngines: Infinity },
        { weight: 500, logical: 2, demandEngines: 0, capEngines: Infinity },
      ],
      8,
    );
    expect(e).toEqual([4, 2]);
  });

  it('redistributes unused capacity to busy images', () => {
    const got = allocatePool(
      [
        { weight: 500, logical: 6, demandEngines: 6, capEngines: Infinity },
        { weight: 500, logical: 6, demandEngines: 1, capEngines: Infinity },
      ],
      8,
    );
    expect(got[0]).toBeCloseTo(6);
    expect(got[1]).toBeCloseTo(1);
  });

  it('weights decide under contention', () => {
    const got = allocatePool(
      [
        { weight: 750, logical: 8, demandEngines: 8, capEngines: Infinity },
        { weight: 250, logical: 8, demandEngines: 8, capEngines: Infinity },
      ],
      8,
    );
    expect(got[0]).toBeCloseTo(6);
    expect(got[1]).toBeCloseTo(2);
  });

  it('respects caps and gives the excess to others', () => {
    const got = allocatePool(
      [
        { weight: 500, logical: 8, demandEngines: 8, capEngines: 2 },
        { weight: 500, logical: 8, demandEngines: 8, capEngines: Infinity },
      ],
      8,
    );
    expect(got[0]).toBeCloseTo(2);
    expect(got[1]).toBeCloseTo(6);
  });
});

describe('efficiency and overhead', () => {
  it('capacity above VH+VM runs on less efficient VLs', () => {
    const pol = { vh: 2, vm: 1, vl: 3 };
    const low = polarityEfficiency(3, pol, true);
    const high = polarityEfficiency(5, pol, true);
    expect(low.unparkedVl).toBe(0);
    expect(high.unparkedVl).toBe(2);
    expect(high.effectiveEngines / 5).toBeLessThan(low.effectiveEngines / 3);
  });

  it('overhead steepens above 2:1 logical:physical', () => {
    const slope12 = lparOverheadFrac(2, 0) - lparOverheadFrac(1, 0);
    const slope23 = lparOverheadFrac(3, 0) - lparOverheadFrac(2, 0);
    expect(slope23).toBeGreaterThan(2 * slope12);
  });
});

describe('Midwest Mutual starting topology (flaw F10)', () => {
  const cpc = MIDWEST_WORLD.cpcs[0]!;
  const res = resolveCpc(cpc, MIDWEST_WORLD.lpars, []);
  const pol = (id: string) => {
    const r = res[`${id}:CP`]!;
    return [r.vh, r.vm, r.vl];
  };
  it('has the documented polarity', () => {
    expect(pol('PROD1')).toEqual([3, 2, 1]);
    expect(pol('PROD2')).toEqual([2, 1, 3]);
    expect(pol('DEVT')).toEqual([0, 1, 3]);
    expect(pol('SYSP')).toEqual([0, 1, 1]);
  });
  it('dedicated CF gets its engine; shared CF02 has a tiny weight share next to CFTEST (flaw F8)', () => {
    expect(res['CF01:ICF']!.entitlementEngines).toBe(1);
    expect(res['CF02:ICF']!.entitlementEngines).toBeCloseTo(0.1);
  });
});

describe('soft capping and polarity', () => {
  const cpc = MIDWEST_WORLD.cpcs[0]!;
  const demand = (softCapEngines: number) => [{ lparId: 'PROD1', pool: 'CP' as const, demandEngines: 6, softCapEngines }];
  const highPolarity = (softCapEngines: number) => {
    const r = resolveCpc(cpc, MIDWEST_WORLD.lpars, demand(softCapEngines))['PROD1:CP']!;
    return r.vh + r.vm;
  };
  it('a soft-capped LPAR gets fewer VH/VM processors (MVS Planning: WLM 3.1 p.46)', () => {
    expect(highPolarity(1.5)).toBeLessThan(highPolarity(Infinity));
  });
  it('a soft cap above the entitlement leaves polarity alone', () => {
    expect(highPolarity(50)).toBe(highPolarity(Infinity));
  });
});

describe('capped fraction counts only binding caps (RMF Report Analysis p.401)', () => {
  const cpc = MIDWEST_WORLD.cpcs[0]!;
  const busy = (softCapPROD1 = Infinity) =>
    MIDWEST_WORLD.lpars.flatMap((l) => l.pools.filter((p) => p.pool === 'CP' && !p.dedicated).map(() => ({
      lparId: l.id, pool: 'CP' as const, demandEngines: 20, softCapEngines: l.id === 'PROD1' ? softCapPROD1 : Infinity,
    })));
  const withAbsCap = (cap: number) =>
    MIDWEST_WORLD.lpars.map((l) =>
      l.id === 'PROD1' ? { ...l, pools: l.pools.map((p) => (p.pool === 'CP' ? { ...p, absoluteCapEngines: cap } : p)) } : l,
    );
  it('an absolute cap above what the LPAR gets is not capping, even when PR/SM contention holds the LPAR back', () => {
    const logical = MIDWEST_WORLD.lpars.find((l) => l.id === 'PROD1')!.pools.find((p) => p.pool === 'CP')!.logical;
    const r = resolveCpc(cpc, withAbsCap(logical - 0.5), busy())['PROD1:CP']!;
    expect(r.deliveredEngines).toBeLessThan(logical - 0.6);
    expect(r.cappedFrac).toBe(0);
  });
  it('a binding absolute cap counts as capping but not as WLM capping', () => {
    const r = resolveCpc(cpc, withAbsCap(1.5), busy())['PROD1:CP']!;
    expect(r.cappedFrac).toBeGreaterThan(0);
    expect(r.softCappedFrac).toBe(0);
  });
  it('a binding soft cap is WLM capping', () => {
    const r = resolveCpc(cpc, MIDWEST_WORLD.lpars, busy(1.5))['PROD1:CP']!;
    expect(r.softCappedFrac).toBeGreaterThan(0);
    expect(r.softCappedFrac).toBe(r.cappedFrac);
  });
});

describe('mvsBusyFrac (RMF Report Analysis 3.1 p.389)', () => {
  it('counts ready work against unparked online time', () => {
    expect(mvsBusyFrac(1.5, 6, 6)).toBeCloseTo(0.25);
    expect(mvsBusyFrac(1.5, 6, 3)).toBeCloseTo(0.5);
  });
  it('saturates at 1 when ready work exceeds the unparked logical CPs', () => {
    expect(mvsBusyFrac(5, 6, 1)).toBe(1);
  });
  it('is 0 with nothing online', () => {
    expect(mvsBusyFrac(2, 0, 0)).toBe(0);
  });
});
