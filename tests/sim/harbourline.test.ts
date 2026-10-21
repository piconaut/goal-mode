import { HARBOURLINE } from '../../src/content/scenarios';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

// Tick 0 is Monday 06:00, so six hours reaches noon with the 09:30 market-open burst behind it.
function run(hours: number) {
  let s = initState(7, HARBOURLINE);
  for (let i = 0; i < hours * TICKS_PER_HOUR; i++) s = step(s, [], HARBOURLINE);
  return s;
}

describe('Harbourline Bank scenario', () => {
  const a = run(6);

  it('is deterministic and every LPAR reports a finite MSU rate', () => {
    expect(JSON.stringify(run(6))).toBe(JSON.stringify(a));
    expect(a.lpars.length).toBe(8);
    for (const l of a.lpars) expect(Number.isFinite(l.msuRate)).toBe(true);
  });

  it('loads both CPCs', () => {
    for (const id of ['PRDA', 'PRDB', 'PRDC', 'PRDD']) expect(a.lpars.find((l) => l.id === id)!.msuRate).toBeGreaterThan(0);
  });

  it('runs dynamic routing for the CPSM and WLM workloads', () => {
    expect(Object.keys(a.routingPolicies ?? {}).sort()).toEqual(['CARDS', 'MKTORD', 'MOBILE']);
    for (const id of ['MKTORD', 'MOBILE']) {
      const shares = a.routing[id]!;
      expect(Object.keys(shares).sort()).toEqual(['PRDA', 'PRDB', 'PRDC', 'PRDD']);
      expect(Object.values(shares).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
    }
  });

  it('has finite arrival rates for every workload', () => {
    for (const w of a.last.workloads) expect(Number.isFinite(w.arrivalRate)).toBe(true);
  });
});
