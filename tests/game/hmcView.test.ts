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
    expect(view('midwest').config.cpcs).toEqual([{ id: 'CPCA', engines: { CP: 8, ZIIP: 2, ICF: 2 } }]);
    expect(view('harbourline').config.cpcs).toEqual([
      { id: 'CPC1', engines: { CP: 14, ZIIP: 2, ICF: 1 } },
      { id: 'CPC2', engines: { CP: 10, ZIIP: 6, ICF: 1 } },
    ]);
  });

  it('has engine totals for every image on a multi-CPC HMC', () => {
    const v = view('harbourline');
    const ids = new Set(v.config.cpcs.map((c) => c.id));
    for (const lpar of v.config.lpars) expect(ids.has(lpar.cpcId)).toBe(true);
  });
});
