// A card's culprit load is constant CPU demand on its image (RF-11; SPEC §5.2 entities): the excess it adds does not
// follow the image's arrival rate, and it stays when routing sends the workload elsewhere, because the thread keeps
// running where it is (CANCEL and the card's end are the only things that remove it).
import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import type { Scenario } from '../../src/sim/core/scenario';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import type { Command } from '../../src/sim/core/commands';

const ENGINES = 0.5;
const load: Command = { kind: 'SET_ENTITY_LOAD', load: { tag: 'card', kind: 'DDF_THREAD', id: '1234', workloadId: 'ADHOC', lparId: 'PROD2', engines: ENGINES } };

/** Midwest with ADHOC's arrival rate scaled and/or its routing replaced. */
function adhocScenario(rateMult = 1, routing?: Record<string, number>): Scenario {
  return {
    ...MIDWEST,
    workloads: MIDWEST.workloads.map((w) => (w.id === 'ADHOC' ? { ...w, peakRatePerSec: w.peakRatePerSec * rateMult, ...(routing ? { routing } : {}) } : w)),
  };
}

/** CP engines ADHOC is granted on PROD2 after a few ticks, with or without the card's load. */
function adhocCpOnProd2(sc: Scenario, withLoad: boolean): number {
  let s = initState(7, sc);
  s = step(s, withLoad ? [load] : [], sc);
  for (let i = 0; i < 2; i++) s = step(s, [], sc);
  return s.last.lpars.find((l) => l.lparId === 'PROD2')?.cpByWorkload?.ADHOC?.cp ?? 0;
}

describe('a culprit load is constant demand on its image', () => {
  const excess = (sc: Scenario) => adhocCpOnProd2(sc, true) - adhocCpOnProd2(sc, false);

  it('adds CP demand of the loaded engines', () => {
    expect(excess(adhocScenario())).toBeGreaterThan(0.5 * ENGINES);
  });

  it('the excess is the same at three times the arrival rate', () => {
    expect(excess(adhocScenario(3))).toBeCloseTo(excess(adhocScenario(1)), 2);
  });

  it('the excess is the same when routing moves the workload off the image', () => {
    const routedAway = adhocScenario(1, { PROD1: 1, PROD2: 0 });
    // No organic ADHOC work is left on PROD2, so the loaded thread alone is its CP there.
    expect(adhocCpOnProd2(routedAway, false)).toBe(0);
    expect(adhocCpOnProd2(routedAway, true)).toBeCloseTo(excess(adhocScenario(1)), 2);
  });
});
