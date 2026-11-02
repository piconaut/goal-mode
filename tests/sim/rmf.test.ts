import { MIDWEST } from '../../src/content/scenarios';
import { BASEPOL } from '../../src/content/wlm/basepol';
import type { LparTick } from '../../src/sim/core/types';
import { accumulateTick, closeInterval, newRmfAcc } from '../../src/sim/measure/rmf';
import { renderWlmDetail, renderWlmSummary } from '../../src/sim/measure/reports';
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
