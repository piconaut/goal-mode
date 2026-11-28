import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import { clockAt } from '../../src/sim/core/clock';
import { cpSpeed, generationOf, mpFactor, ziipSpeed } from '../../src/sim/hw/cpc';
import { baseRate } from '../../src/sim/workload/arrivals';
import { entityEngineCap, meanReferenceRate, referenceEngineSecPerTxn, sizedEntityDemand } from '../../src/sim/workload/entityDemand';
import { entityLoadSlices, scKeyOf } from '../../src/sim/workload/slices';
import { classify } from '../../src/sim/wlm/classify';
import { initState } from '../../src/sim/core/init';
import type { EntityLoad } from '../../src/sim/core/types';

const adhoc = MIDWEST.workloads.find((w) => w.id === 'ADHOC')!;
const lpar = MIDWEST.world.lpars.find((l) => l.id === 'PROD2')!;
const cpc = MIDWEST.world.cpcs.find((c) => c.id === lpar.cpcId)!;

describe('entity demand (RF-11)', () => {
  it('means the deterministic arrival rate over the card window, not the moment it begins', () => {
    const start = 2 * 360; // 08:00, on the way up to the analytics peak
    expect(meanReferenceRate(adhoc, start, 0)).toBe(baseRate(adhoc, clockAt(start)));
    const atStart = baseRate(adhoc, clockAt(start));
    const window = meanReferenceRate(adhoc, start, 5);
    expect(window).toBeGreaterThan(atStart);
    expect(window).toBeLessThan(5 * atStart); // an average, not the peak held for five hours
    expect(meanReferenceRate(adhoc, start, 5)).toBe(meanReferenceRate(adhoc, start, 5));
  });

  it('keeps the workload\'s CP/zIIP split and scales with the excess and the rate', () => {
    const perTxn = referenceEngineSecPerTxn(adhoc, cpc, lpar);
    const mp = 1 / mpFactor(lpar.pools.find((p) => p.pool === 'CP')!.logical, generationOf(cpc).mpK);
    const refSec = (adhoc.cpuMsRef / 1000) * mp;
    expect(perTxn.cpSecPerTxn).toBeCloseTo((refSec * (1 - adhoc.ziipFrac)) / cpSpeed(cpc), 12);
    expect(perTxn.ziipSecPerTxn).toBeCloseTo((refSec * adhoc.ziipFrac) / ziipSpeed(cpc), 12);
    const one = sizedEntityDemand(adhoc, MIDWEST.world, 'PROD2', 0.2, 9);
    expect(one.cpEngines).toBeCloseTo(9 * 0.2 * perTxn.cpSecPerTxn, 12);
    expect(one.ziipEngines).toBeCloseTo(9 * 0.2 * perTxn.ziipSecPerTxn, 12);
    const double = sizedEntityDemand(adhoc, MIDWEST.world, 'PROD2', 0.2, 18);
    expect(double.cpEngines).toBeCloseTo(2 * one.cpEngines, 12);
    expect(double.ziipEngines).toBeCloseTo(2 * one.ziipEngines, 12);
  });

  it('caps the demand at the image\'s online processors and needs the image', () => {
    expect(entityEngineCap(MIDWEST.world, 'PROD2')).toBe(6);
    const huge = sizedEntityDemand(adhoc, MIDWEST.world, 'PROD2', 100, 1000);
    expect(huge.cpEngines + huge.ziipEngines).toBeCloseTo(6, 9);
    expect(sizedEntityDemand(adhoc, MIDWEST.world, 'NOLPAR', 0.2, 9)).toEqual({ cpEngines: 0, ziipEngines: 0 });
    expect(sizedEntityDemand(adhoc, MIDWEST.world, 'PROD2', 0, 9)).toEqual({ cpEngines: 0, ziipEngines: 0 });
  });
});

describe('entityLoadSlices (RF-11)', () => {
  const s = initState(1, MIDWEST);
  const def = s.wlm.definition;
  const load = (over: Partial<EntityLoad> = {}): EntityLoad => ({ tag: 'c1', kind: 'DDF_THREAD', id: '20226', workloadId: 'ADHOC', lparId: 'PROD2', cpEngines: 1.6, ziipEngines: 0.9, ...over });

  it('puts each load on its own image as an address-space slice in its workload\'s last service-class period', () => {
    const cls = classify(def, { ...adhoc.work, SY: lpar.id });
    const periods = def.classes.find((c) => c.id === cls.serviceClass)!.periods;
    expect(periods.length).toBeGreaterThan(1); // so the first and last periods differ
    const loads = [
      load(),
      load({ lparId: 'PROD1' }), // another image
      load({ id: '20227', cpEngines: 0, ziipEngines: 0 }), // no demand
      load({ id: '20228', workloadId: 'NOSUCH' }), // workload not in the run
    ];
    const out = entityLoadSlices(def, lpar, MIDWEST.workloads, loads);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'AS', workloadId: 'ADHOC', role: null, jobname: null,
      scKey: scKeyOf(cls.serviceClass, periods.length - 1), reportClass: cls.reportClass,
      cpEngines: 1.6, ziipEngines: 0.9, units: 2.5,
    });
    // A fraction of an engine is still one dispatchable unit.
    expect(entityLoadSlices(def, lpar, MIDWEST.workloads, [load({ cpEngines: 0.2, ziipEngines: 0.1 })])[0]!.units).toBe(1);
    expect(entityLoadSlices(def, lpar, MIDWEST.workloads, undefined)).toEqual([]);
  });
});
