import { BASEPOL } from '../../src/content/wlm/basepol';
import { MIDWEST } from '../../src/content/scenarios';
import type { LparTick } from '../../src/sim/core/types';
import { mergeWorkManager, type WorkManagerSamples } from '../../src/sim/wlm/reporting';
import { emptyScpTick } from '../../src/sim/wlm/evaluate';
import { accumulateTick, closeInterval, newRmfAcc } from '../../src/sim/measure/rmf';
import { renderWlmSummary } from '../../src/sim/measure/reports';

const wm = (managedToTxn: boolean): WorkManagerSamples => ({
  active: 5, ready: 1, idle: 0, waitingIo: 0, waitingLock: 0, waitingProd: 2, waitingMisc: 2, regionKeys: ['STCHI#1'], managedToTxn,
});
const summary = (workManager: WorkManagerSamples, withRegionRow = true): string => {
  const scps = [{ ...emptyScpTick('ONLHI#1', 240), cpEngines: 1, usingCpu: 1, workManager }, ...(withRegionRow ? [{ ...emptyScpTick('STCHI#1', 250), cpEngines: 0.2, usingCpu: 0.2 }] : [])];
  const tick: LparTick = { lparId: 'PROD1', scps, roleHealth: {} };
  const iv = closeInterval(accumulateTick(newRmfAcc(0), [tick], [], null, []), { def: BASEPOL, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 1 });
  return renderWlmSummary(iv, 'PROD1');
};

describe('WLMGL says when a CICS region is managed to the served transactions\' goals (PT-05; WLM Planning p.120, p.122-123)', () => {
  it('names the served classes and says the region class\'s own goal is not used', () => {
    const text = summary(wm(true));
    expect(text).toContain("STCHI#1 RUNS AS A CICS TRANSACTION SERVER: WLM MANAGES THE REGION TO THE GOALS OF ONLHI#1 (TRANSACTION MODE), NOT TO THIS CLASS'S OWN GOAL (WLM PLANNING p.120, p.122-123)");
  });

  it('says nothing when the region is managed to its own class\'s goal (REGION or BOTH)', () => {
    expect(summary(wm(false))).not.toContain('RUNS AS A CICS TRANSACTION SERVER');
  });

  it('says nothing when no class is served by regions', () => {
    expect(summary(wm(true), false)).not.toContain('RUNS AS A CICS TRANSACTION SERVER');
  });

  it('keeps the flag only when every tick of the interval was TRANSACTION-managed', () => {
    expect(mergeWorkManager(wm(true), wm(false)).managedToTxn).toBe(false);
    expect(mergeWorkManager(wm(false), wm(true)).managedToTxn).toBe(false);
    expect(mergeWorkManager(wm(true), wm(true)).managedToTxn).toBe(true);
    expect(mergeWorkManager(wm(true), undefined).managedToTxn).toBe(true);
    expect(mergeWorkManager(undefined, wm(true)).managedToTxn).toBe(true);
  });
});
