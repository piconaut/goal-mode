import { MIDWEST } from '../../src/content/scenarios';
import { CF_LOCK_CONTENTION } from '../../src/content/cf';
import { BASEPOL } from '../../src/content/wlm/basepol';
import type { LparTick } from '../../src/sim/core/types';
import type { CfResult } from '../../src/sim/cf/cf';
import { accumulateTick, closeInterval, newRmfAcc } from '../../src/sim/measure/rmf';
import { renderCfActivity, renderWlmDetail, renderWlmSummary } from '../../src/sim/measure/reports';
import { emptyScpTick } from '../../src/sim/wlm/evaluate';

// RMF Report Analysis 3.1 p.534 Table 222: IIPCP is a subset of APPL% CP.
describe('WLM APPL% CP includes zIIP-eligible work executed on CPs', () => {
  it.each([
    { kind: 'homogeneous', members: ['DDFPRD#1'] },
    { kind: 'heterogeneous', members: ['DDFPRD#1', 'ONLHI#1'] },
  ])('preserves interval and plex totals for a $kind report class', ({ members }) => {
    const tick = (lparId: string, cpEngines: number, iipcpEngines: number, ziipEngines: number): LparTick => {
      const scp = { ...emptyScpTick('DDFPRD#1', 240), cpEngines, iipcpEngines, ziipEngines };
      return {
        lparId, scps: [scp], roleHealth: {},
        rcs: [{ ...scp, scKey: 'RMOBILE', cpEngines: cpEngines / 2, iipcpEngines: iipcpEngines / 2, ziipEngines: ziipEngines / 2, members }],
      };
    };
    let acc = accumulateTick(newRmfAcc(0), [tick('PROD1', 0.2, 0.8, 0.4)], [], null, []);
    // PROD2 is active for only one tick; every row still averages over the full interval.
    acc = accumulateTick(acc, [tick('PROD1', 0.4, 1.6, 0.8), tick('PROD2', 0.6, 0.4, 0.2)], [], null, []);
    const iv = closeInterval(acc, { def: BASEPOL, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 2 });
    expect(iv.intervalSec).toBe(20);
    for (const [system, cp, iipcp, iip] of [['PROD1', 150, 120, 60], ['PROD2', 50, 20, 10], ['*PLEX', 200, 140, 70]] as const) {
      for (const [rows, key, share] of [[iv.wlm, 'DDFPRD#1', 1], [iv.wlmRc!, 'RMOBILE', 0.5]] as const) {
        const row = rows.find((r) => r.lparId === system)!;
        expect(row.applCpPct).toBeCloseTo(cp * share);
        expect(row.applIipcpPct).toBeCloseTo(iipcp * share);
        expect(row.applIipPct).toBeCloseTo(iip * share);
        expect(row.applCpPct).toBeGreaterThanOrEqual(row.applIipcpPct);
        expect(renderWlmDetail(iv, key, system)).toContain(`APPL% CP ${(cp * share).toFixed(1)}  IIPCP ${(iipcp * share).toFixed(1)}  IIP ${(iip * share).toFixed(1)}`);
        const summaryRow = renderWlmSummary(iv, system).split('\n').find((line) => line.startsWith(row.serviceClass))!;
        expect(summaryRow).toContain(`${(cp * share).toFixed(1).padStart(6)} ${(iipcp * share).toFixed(1).padStart(6)} ${(iip * share).toFixed(1).padStart(6)}`);
      }
    }
    // Closing reports leaves the internal native-CP and IIPCP quantities separate.
    expect(acc.scps['PROD1|DDFPRD#1']!.cpuEngines).toBeCloseTo(0.6);
    expect(acc.scps['PROD1|DDFPRD#1']!.iipcpEngines).toBeCloseTo(2.4);
  });
});

// RMF Report Analysis p.85: Contention (%) is the share of external requests delayed by a lock held by another
// system, reported for serialized LIST and LOCK structures. The sim maps the sysplex lock index to it.
describe('CFACT lock contention', () => {
  it('reports the interval lock index as CONTENTION % on the lock structure only', () => {
    const st = (type: 'LOCK' | 'CACHE', name: string) => ({ name, type, cfLparId: 'CF01', requestRate: 100, syncSec: 1e-4, asyncFrac: 0, serviceSec: 1e-4, zosCpuSec: 1e-4 });
    const cf: CfResult = {
      lparId: 'CF01', requestRate: 200, demandEngines: 0.1, busyFrac: 0.1, syncSec: 1e-4, asyncFrac: 0, serviceSec: 1e-4, zosCpuSec: 1e-4,
      structures: [st('LOCK', 'DB1G_LOCK1'), st('CACHE', 'DB1G_GBP1')],
    };
    let acc = accumulateTick(newRmfAcc(0), [], [], null, [cf], undefined, 4);
    acc = accumulateTick(acc, [], [], null, [cf], undefined, 8);
    const iv = closeInterval(acc, { def: BASEPOL, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 2 });
    expect(iv.lockIndex).toBeCloseTo(6);
    const lines = renderCfActivity(iv).split('\n');
    expect(lines.find((l) => l.includes('CONTENTION %'))).toBeDefined();
    expect(lines.find((l) => l.startsWith('DB1G_LOCK1'))).toContain((CF_LOCK_CONTENTION.pctPerIndex * 6).toFixed(1));
    expect(lines.find((l) => l.startsWith('DB1G_GBP1'))!.trimEnd().endsWith('-')).toBe(true);
  });

  it('caps contention and leaves an interval from an older save blank', () => {
    const lock = { name: 'DB1G_LOCK1', type: 'LOCK' as const, cfLparId: 'CF01', requestRate: 100, syncSec: 1e-4, asyncFrac: 0, serviceSec: 1e-4, zosCpuSec: 1e-4 };
    const cf: CfResult = {
      lparId: 'CF01', requestRate: 100, demandEngines: 0.1, busyFrac: 0.1, syncSec: 1e-4, asyncFrac: 0, serviceSec: 1e-4, zosCpuSec: 1e-4,
      structures: [lock],
    };
    const acc = accumulateTick(newRmfAcc(0), [], [], null, [cf], undefined, 100);
    const iv = closeInterval(acc, { def: BASEPOL, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 1 });
    const row = (r: typeof iv) => renderCfActivity(r).split('\n').find((l) => l.startsWith('DB1G_LOCK1'))!;
    expect(row(iv)).toContain(CF_LOCK_CONTENTION.capPct.toFixed(1));
    expect(row({ ...iv, lockIndex: undefined }).trimEnd().endsWith('-')).toBe(true);
  });
});
