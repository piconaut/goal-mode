import { CPU_CAPACITY } from '../../src/content/incidents';
import { MIDWEST } from '../../src/content/scenarios';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { mechanismExplanation } from '../../src/game/rcaExplain';
import type { Incident, RunState } from '../../src/game/types';
import { applyCommand } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import type { RmfInterval } from '../../src/sim/measure/rmf';
import { accumulateTick, closeInterval, newRmfAcc } from '../../src/sim/measure/rmf';
import { renderPartitionData } from '../../src/sim/measure/reports';

const interval = (cpcBusyPct: number, lparBusyPct: number): RmfInterval =>
  ({
    startTick: 0,
    endTick: 300,
    intervalSec: 300,
    policy: 'P',
    cpu: [
      {
        lparId: 'PROD1',
        weight: 500,
        logicalCps: 6,
        polarity: 'HIGH',
        physicalEngines: 3,
        logicalBusyPct: lparBusyPct,
        mvsBusyPct: lparBusyPct,
        overheadPct: 2,
        cappedPct: 0,
        prsmDelayPct: 0,
        msuAvg: 200,
        r4ha: 200,
        definedCapacityMsu: null,
        ziipEngines: 0,
        icfEngines: 0,
      },
    ],
    cpcBusy: [{ cpcId: 'CPCA', pool: 'CP', physicalBusyPct: cpcBusyPct }],
    wlm: [],
    dasd: { iops: 0, rtRandomMs: 0, rtSeqMs: 0, iosqMs: 0, pendMs: 0, discMs: 0, connMs: 0 },
    lcus: [],
    cf: [],
    cfStructures: [],
    jobs: [],
  }) as RmfInterval;

const runWith = (iv: RmfInterval): RunState =>
  ({ sim: { config: MIDWEST.world, routing: { MOBILE: { PROD1: 1 } }, rmf: { intervals: [iv] } } }) as unknown as RunState;
const incident = (mechanism: Incident['truth']['mechanism']): Incident => ({
  id: 1,
  workloadId: 'MOBILE',
  day: 1,
  startTick: 0,
  endTick: 300,
  hours: 1,
  worstAttainmentPct: 90,
  truth: { mechanism, trigger: 'HARDWARE_FAULT' },
  rca: null,
  trustLost: 0,
});

describe('the CPU verdict explains itself from the incident hour (PT-03)', () => {
  it('says which capacity line the hour did not reach when the verdict is the policy', () => {
    const text = mechanismExplanation(runWith(interval(81, 70)), incident('CPU_PRIORITY'))!;
    expect(text).toMatch(/CPC CPCA averaged 81 % busy, below the 90 % capacity line/);
    expect(text).toMatch(/capacity was not the constraint/);
  });

  it('names the capacity line the hour did reach when the verdict is capacity', () => {
    const text = mechanismExplanation(runWith(interval(94, 80)), incident('CPU_CAPACITY'))!;
    expect(text).toMatch(/CPC CPCA averaged 94 % busy \(capacity line 90 %\)/);
    expect(text).toMatch(/less important work/);
  });

  it('uses the image line when the CPC was not full but the image was', () => {
    const text = mechanismExplanation(runWith(interval(70, 97)), incident('CPU_CAPACITY'))!;
    expect(text).toMatch(/LPAR PROD1 used 97 % of the CP it could get \(capacity line 95 %\)/);
  });

  it('explains only the CPU mechanisms', () => {
    expect(mechanismExplanation(runWith(interval(81, 70)), incident('JOB_FAILURE'))).toBeNull();
    const noIntervals = { sim: { ...runWith(interval(81, 70)).sim, rmf: { intervals: [] } } } as unknown as RunState;
    expect(mechanismExplanation(noIntervals, incident('CPU_CAPACITY'))).toBeNull();
  });
});

describe('a capacity reduction shows as SMF70CAI/SMF70CCR (MVS SMF p.589)', () => {
  const s0 = initState(7, MIDWEST);
  const cpc = s0.config.cpcs[0]!;
  const down = (reason?: number) =>
    applyCommand(s0, { kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: (cpc.capacitySetting - 1) as 4 | 5 | 6 | 7, ...(reason !== undefined ? { reason } : {}) }).state;

  it('keeps the normal setting and the reason while the machine runs reduced', () => {
    const s = down(2);
    const box = s.config.cpcs[0]!;
    expect(box.peakCapacitySetting).toBe(cpc.capacitySetting);
    expect(box.capacityReasonCode).toBe(2);
  });

  it('shows the adjustment in the RMF interval and Partition Data until the setting is restored', () => {
    const s = down(2);
    const iv = closeInterval(accumulateTick(newRmfAcc(0), [], [], null, []), { def: BASEPOL, config: s.config, r4haByLpar: {}, jobs: [], endTick: 1 });
    const row = iv.cpcBusy.find((c) => c.cpcId === cpc.id && c.pool === 'CP')!;
    expect(row.capacityAdjustmentPct).toBe(69);
    expect(row.capacityReasonCode).toBe(2);
    expect(renderPartitionData(iv)).toContain('CAPACITY ADJUSTMENT 69% (SMF70CAI; reason 2 = external)');
    // A reduction defaults to the operator reason.
    const manual = closeInterval(accumulateTick(newRmfAcc(0), [], [], null, []), { def: BASEPOL, config: down().config, r4haByLpar: {}, jobs: [], endTick: 1 });
    expect(renderPartitionData(manual)).toContain('reason 1 = operator');

    const up = applyCommand(s, { kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: cpc.capacitySetting }).state;
    expect(up.config.cpcs[0]!.peakCapacitySetting).toBeUndefined();
    const back = closeInterval(accumulateTick(newRmfAcc(0), [], [], null, []), { def: BASEPOL, config: up.config, r4haByLpar: {}, jobs: [], endTick: 1 });
    expect(back.cpcBusy.find((c) => c.cpcId === cpc.id && c.pool === 'CP')!.capacityAdjustmentPct).toBeUndefined();
    expect(renderPartitionData(back)).not.toContain('CAPACITY ADJUSTMENT');
  });

  it('keeps the lines the mechanism rules use in content, not in the game code', () => {
    expect(CPU_CAPACITY).toEqual({ cpcBusyFrac: 0.9, lparBusyFrac: 0.95, donorFrac: 0.1 });
  });
});
