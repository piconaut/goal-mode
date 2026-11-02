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

// WLM Planning 3.1 p.113; RMF Report Analysis p.536–537: CICS transaction classes carry work manager states, the
// regions' service (and report) classes carry the transactions' using and delay samples.
describe('CICS transaction samples are reported with the region class', () => {
  const moved = { usingCpu: 0.3, usingZiip: 0, usingIo: 0.1, delayCpu: 0.2, delayZiip: 0, delayIo: 0.05, delayOther: 0.4, delayStorage: 0, delayCap: 0 };
  const tick = (): LparTick => {
    const onl = { ...emptyScpTick('ONLHI#1', 250), cpEngines: 0.3, usingCpu: 0.3, usingIo: 0.1, delayCpu: 0.2, delayIo: 0.05, delayOther: 0.4, completions: 100, rtSumSec: 5,
      rmfMoved: { to: 'STCHI#1', ...moved }, wm: { active: 1, ready: 1, lock: 0, io: 0.5, prod: 2, misc: 0.5 } };
    const reg = { ...emptyScpTick('STCHI#1', 248), cpEngines: 0.05, usingCpu: 0.05, delayCpu: 0.01 };
    return { lparId: 'PROD1', scps: [onl, reg], roleHealth: {}, rcs: [{ ...onl, scKey: 'RCICS', members: ['ONLHI#1'], rmfMoved: { to: null, ...moved } }] };
  };
  it('moves using and delay samples, keeps APPL% and response times, adds the breakdown', () => {
    const acc = accumulateTick(accumulateTick(newRmfAcc(0), [tick()], [], null, []), [tick()], [], null, []);
    const iv = closeInterval(acc, { def: BASEPOL, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 2 });
    for (const system of ['PROD1', '*PLEX']) {
      const onl = iv.wlm.find((r) => r.lparId === system && r.scKey === 'ONLHI#1')!;
      const reg = iv.wlm.find((r) => r.lparId === system && r.scKey === 'STCHI#1')!;
      expect(Object.values(onl.usingPct).every((x) => x === 0) && Object.values(onl.delayPct).every((x) => x === 0)).toBe(true);
      expect(onl.execVelocity).toBeNull();
      expect(onl.applCpPct).toBeCloseTo(30);
      expect(onl.avgRtSec).toBeCloseTo(0.05);
      expect(onl.workMgr).toMatchObject({ phase: 'CICS EXE', activePct: 20, readyPct: 20, ioPct: 10, prodPct: 40, miscPct: 10, idlePct: 0 });
      // Region: its own 0.06 samples plus the moved 1.05 per tick.
      expect(reg.delayPct.other).toBeCloseTo((100 * 0.4) / 1.11);
      expect(reg.usingPct.cpu).toBeCloseTo((100 * 0.35) / 1.11);
      expect(reg.dp).toBe(system === '*PLEX' ? null : 248);
      expect(reg.workMgr).toBeUndefined();
    }
    // No region report class: the samples leave the report class and go nowhere.
    const rc = iv.wlmRc!.find((r) => r.lparId === 'PROD1')!;
    expect(rc.usingPct.cpu).toBe(0);
    expect(rc.workMgr?.prodPct).toBeCloseTo(40);
    const detail = renderWlmDetail(iv, 'ONLHI#1', 'PROD1');
    expect(detail).toContain('RESPONSE TIME BREAKDOWN IN PERCENTAGE');
    expect(detail).toMatch(/CICS +EXE +100\.0 +20\.0 +20\.0 +0\.0 +0\.0 +10\.0 +0\.0 +40\.0 +10\.0/);
  });
});
