import { BASEPOL } from '../../src/content/wlm/basepol';
import { MIDWEST } from '../../src/content/scenarios';
import type { LparTick } from '../../src/sim/core/types';
import type { WorkManagerSamples } from '../../src/sim/wlm/reporting';
import { emptyScpTick } from '../../src/sim/wlm/evaluate';
import { accumulateTick, closeInterval, newRmfAcc } from '../../src/sim/measure/rmf';
import { renderWlmSummary } from '../../src/sim/measure/reports';

const wm: WorkManagerSamples = { active: 5, ready: 1, idle: 0, waitingIo: 0, waitingLock: 0, waitingProd: 2, waitingMisc: 2, regionKeys: ['STCHI#1'] };

describe('WLMGL says which class is managed through its regions (PT-05; WLM Planning p.111, p.122-123)', () => {
  it('notes that a region class runs at the served DP and its PI is not managed to', () => {
    const tick: LparTick = {
      lparId: 'PROD1',
      scps: [{ ...emptyScpTick('ONLHI#1', 240), cpEngines: 1, usingCpu: 1, workManager: wm }, { ...emptyScpTick('STCHI#1', 250), cpEngines: 0.2, usingCpu: 0.2 }],
      roleHealth: {},
    };
    const iv = closeInterval(accumulateTick(newRmfAcc(0), [tick], [], null, []), { def: BASEPOL, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 1 });
    const text = renderWlmSummary(iv, 'PROD1');
    expect(text).toContain("STCHI#1 RUNS IN CICS REGIONS MANAGED TO TRANSACTION GOALS: THE REGIONS RUN AT THE SERVED CLASSES' DP (ONLHI#1)");
    expect(text).toContain('NOT MANAGED TO (WLM PLANNING p.111, p.122-123)');
  });

  it('says nothing when no class is served by regions', () => {
    const tick: LparTick = { lparId: 'PROD1', scps: [{ ...emptyScpTick('STCHI#1', 250), cpEngines: 0.2, usingCpu: 0.2 }], roleHealth: {} };
    const iv = closeInterval(accumulateTick(newRmfAcc(0), [tick], [], null, []), { def: BASEPOL, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 1 });
    expect(renderWlmSummary(iv, 'PROD1')).not.toContain('MANAGED TO TRANSACTION GOALS');
  });
});
