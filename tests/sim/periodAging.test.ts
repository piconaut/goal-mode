import { BASEPOL } from '../../src/content/wlm/basepol';
import { MIDWEST_WORLD } from '../../src/content/scenarios/midwest';
import { billableMsu } from '../../src/sim/cost/mlc';
import { rgSysplexShares, swapOut } from '../../src/sim/core/step';
import type { CpcConfig } from '../../src/sim/core/types';
import { periodAtService } from '../../src/sim/workload/periods';
import { scKeyAtService } from '../../src/sim/workload/slices';
import type { SliceSpec } from '../../src/sim/wlm/evaluate';
import { sliceSpec } from '../../src/sim/wlm/evaluate';

describe('period aging by consumed service', () => {
  it('moves to the next period once the DUR of each earlier period is used', () => {
    const durs = [400, 1000, null];
    expect(periodAtService(durs, 0)).toBe(0);
    expect(periodAtService(durs, 399)).toBe(0);
    expect(periodAtService(durs, 400)).toBe(1);
    expect(periodAtService(durs, 1399)).toBe(1);
    expect(periodAtService(durs, 1400)).toBe(2);
    expect(periodAtService([null], 1e9)).toBe(0);
  });

  it('puts long-running address spaces in the last period of a multi-period class', () => {
    expect(scKeyAtService(BASEPOL, 'TSO', Infinity)).toBe('TSO#2');
    expect(scKeyAtService(BASEPOL, 'TSO', 0)).toBe('TSO#1');
    expect(scKeyAtService(BASEPOL, 'STCMED', Infinity)).toBe('STCMED#1');
  });

  it('swaps a batch job out by the importance of the period it has aged into', () => {
    const d = structuredClone(BASEPOL);
    // BATCHPRD: period 1 velocity 30 imp 4 for 5000 SU, then discretionary.
    d.classes.find((c) => c.id === 'BATCHPRD')!.periods = [
      { goal: { kind: 'VEL', velocity: 30 }, importance: 4, durationSu: 5000 },
      { goal: { kind: 'DISC' }, importance: 5, durationSu: null },
    ];
    const job = (name: string, startTick: number) =>
      ({
        day: 0,
        def: { name, stream: 'X', jobClass: 'A', sysaff: null, cpuSecRef: 1, ziipFrac: 0, ioCount: 1, lockIntensity: 0, usesDb2: false, preds: [], earliestSec: 0, critical: false, deadlineSec: 86400 },
        status: 'RUNNING',
        lparId: 'PROD1',
        progress: 0,
        queuedTick: 0,
        startTick,
        endTick: null,
        stretch: 1,
      }) as Parameters<typeof swapOut>[1][number];
    const old = job('OLDJOB', 1);
    const young = job('NEWJOB', 50);
    const su = (j: typeof old) => (j === old ? 9000 : 100);
    // Without aging the latest-started job goes first; aged into discretionary, the old one does.
    expect([...swapOut(d, [old, young], 'PROD1', 20, 2, 23)].map((j) => j.def.name)).toEqual(['NEWJOB']);
    expect([...swapOut(d, [old, young], 'PROD1', 20, 2, 23, su)].map((j) => j.def.name)).toEqual(['OLDJOB']);
  });
});

describe('type 1 resource groups are sysplex scope', () => {
  it('splits the SU/s budget across systems by demand', () => {
    const d = structuredClone(BASEPOL);
    d.resourceGroups = [{ id: 'RGPLEX', type: 1, min: null, max: 10000 }];
    d.classes.find((c) => c.id === 'STCMED')!.resourceGroup = 'RGPLEX';
    const as = (key: string, cpEngines: number): SliceSpec => sliceSpec({ key, scKey: 'STCMED#1', kind: 'AS', cpEngines });
    const slicesBy = { PROD1: [as('A', 3)], PROD2: [as('B', 1)] };
    const cpcOf: Record<string, CpcConfig> = Object.fromEntries(MIDWEST_WORLD.cpcs.map((c) => [c.id, c]));
    expect(rgSysplexShares(d, slicesBy, MIDWEST_WORLD.lpars, cpcOf, 'PROD1').RGPLEX).toBeCloseTo(0.75);
    expect(rgSysplexShares(d, slicesBy, MIDWEST_WORLD.lpars, cpcOf, 'PROD2').RGPLEX).toBeCloseTo(0.25);
  });
});

describe('SCRT billing of capacity groups', () => {
  it('never bills a group above its limit, and leaves non-members alone', () => {
    const b = billableMsu({ A: 120, B: 80, C: 50 }, { A: 110 }, [{ limitMsu: 150, members: ['A', 'B'] }]);
    // A is first held to its DC (110); A+B = 190 > 150 → both scaled by 150/190.
    expect(b.A! + b.B!).toBeCloseTo(150);
    expect(b.A! / b.B!).toBeCloseTo(110 / 80);
    expect(b.C).toBe(50);
    expect(billableMsu({ A: 60, B: 40 }, {}, [{ limitMsu: 150, members: ['A', 'B'] }])).toEqual({ A: 60, B: 40 });
  });
});
