import { PACKS } from '../../src/content/packs';
import { newRun } from '../../src/game/run';
import { buildView } from '../../src/game/view';

const view = (id: 'midwest' | 'harbourline') => {
  const pack = PACKS[id]!;
  const run = newRun(pack.scenario, { ...pack.game, events: [] }, 3);
  return buildView(run, pack.scenario);
};

describe('HMC physical engines', () => {
  it('reports the installed engines of each CPC, per pool', () => {
    expect(view('midwest').config.cpcs).toEqual([{ id: 'CPCA', engines: { CP: 8, ZIIP: 2, ICF: 2 }, suPerCpuSec: expect.closeTo(39861.11, 1) }]);
    expect(view('harbourline').config.cpcs).toEqual([
      { id: 'CPC1', engines: { CP: 14, ZIIP: 2, ICF: 1 }, suPerCpuSec: expect.closeTo(64444.44, 1) },
      { id: 'CPC2', engines: { CP: 10, ZIIP: 6, ICF: 1 }, suPerCpuSec: expect.closeTo(27333.33, 1) },
    ]);
  });

  it('has engine totals for every image on a multi-CPC HMC', () => {
    const v = view('harbourline');
    const ids = new Set(v.config.cpcs.map((c) => c.id));
    for (const lpar of v.config.lpars) expect(ids.has(lpar.cpcId)).toBe(true);
  });

  it('reports each CPC\u2019s SU/s per CP for resource-group conversions', () => {
    const v = view('midwest');
    const cpc = v.config.cpcs[0]!;
    expect(cpc.suPerCpuSec).toBeGreaterThan(0);
    // 1 MSU is 277.8 SU/s at the CPC's capacity setting.
    expect(cpc.suPerCpuSec / 277.7778).toBeCloseTo(143.5, 1);
  });
});
