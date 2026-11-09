import { CPU_CAPACITY } from '../../src/content/incidents';
import { MIDWEST } from '../../src/content/scenarios';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { mechanismExplanation } from '../../src/game/rcaExplain';
import type { CapacityBasis, Incident } from '../../src/game/types';
import { applyCommand } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import { accumulateTick, closeInterval, newRmfAcc } from '../../src/sim/measure/rmf';
import { renderPartitionData } from '../../src/sim/measure/reports';

const incumbent = (mechanism: Incident['truth']['mechanism'], basis?: CapacityBasis): Incident => ({
  id: 1,
  workloadId: 'MOBILE',
  day: 1,
  startTick: 0,
  endTick: 300,
  hours: 1,
  worstAttainmentPct: 90,
  truth: { mechanism, trigger: 'HARDWARE_FAULT' },
  ...(basis ? { basis } : {}),
  rca: null,
  trustLost: 0,
});
const basis = (b: Partial<CapacityBasis>): CapacityBasis => ({ lparId: 'PROD1', cpcId: 'CPCA', cpcBusyPct: 81.2, lparBusyPct: 70, donorPct: 12, full: false, ...b });

describe('the CPU verdict explains itself from the hour that decided it (PT-03)', () => {
  it('says which capacity line the hour did not reach when the verdict is the policy', () => {
    const text = mechanismExplanation(incumbent('CPU_PRIORITY', basis({})))!;
    expect(text).toMatch(/CPC CPCA averaged 81\.2 % busy, below the 90 % capacity line/);
    expect(text).toMatch(/capacity was not the constraint/);
  });

  it('names the capacity line and the donor share when the verdict is capacity', () => {
    const text = mechanismExplanation(incumbent('CPU_CAPACITY', basis({ cpcBusyPct: 94, donorPct: 3, full: true })))!;
    expect(text).toMatch(/CPC CPCA averaged 94\.0 % busy \(capacity line 90 %\)/);
    expect(text).toMatch(/3\.0 % of the CP against the 10 % donor line/);
    expect(text).toMatch(/machine, not the policy, was short/);
  });

  it('uses the image line when the CPC was not full but the image was', () => {
    const text = mechanismExplanation(incumbent('CPU_CAPACITY', basis({ cpcBusyPct: 70, lparBusyPct: 97, full: true })))!;
    expect(text).toMatch(/LPAR PROD1 used 97\.0 % of the CP it could get \(capacity line 95 %\)/);
  });

  it('explains a full machine that still had donors as the policy', () => {
    const text = mechanismExplanation(incumbent('CPU_PRIORITY', basis({ cpcBusyPct: 94, donorPct: 18 })))!;
    expect(text).toMatch(/18\.0 % of the CP went to less important work/);
    expect(text).toMatch(/policy held this work back/);
  });

  it('prints the figure to one decimal, so it cannot straddle its own line', () => {
    const text = mechanismExplanation(incumbent('CPU_PRIORITY', basis({ cpcBusyPct: 89.6 })))!;
    expect(text).toContain('89.6 % busy, below the 90 % capacity line');
  });

  it('explains only CPU mechanisms with a recorded basis', () => {
    expect(mechanismExplanation(incumbent('JOB_FAILURE', basis({})))).toBeNull();
    expect(mechanismExplanation(incumbent('CPU_PRIORITY'))).toBeNull();
  });
});

describe('a capacity reduction shows as CHANGE REASON and SMF70CAI/SMF70CCR (MVS SMF p.589)', () => {
  const s0 = initState(7, MIDWEST);
  const cpc = s0.config.cpcs[0]!;
  const down = (reason?: number) =>
    applyCommand(s0, { kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: (cpc.capacitySetting - 1) as 4 | 5 | 6 | 7, ...(reason !== undefined ? { reason } : {}) }).state;

  it('keeps the normal setting and the reason while the machine runs reduced', () => {
    const box = down(2).config.cpcs[0]!;
    expect(box.peakCapacitySetting).toBe(cpc.capacitySetting);
    expect(box.capacityReasonCode).toBe(2);
  });

  it('shows the capacity change in the RMF interval until the setting is restored', () => {
    const s = down(2);
    const iv = closeInterval(accumulateTick(newRmfAcc(0), [], [], null, []), { def: BASEPOL, config: s.config, r4haByLpar: {}, jobs: [], endTick: 1 });
    const row = iv.cpcBusy.find((c) => c.cpcId === cpc.id && c.pool === 'CP')!;
    expect(row.capacityAdjustmentPct).toBe(69);
    expect(row.capacityReasonCode).toBe(2);
    expect(renderPartitionData(iv)).toContain('CHANGE REASON=MACHINE (initiated by the machine)');
    // An operator downgrade defaults to the user-initiated reason.
    const manual = closeInterval(accumulateTick(newRmfAcc(0), [], [], null, []), { def: BASEPOL, config: down().config, r4haByLpar: {}, jobs: [], endTick: 1 });
    expect(renderPartitionData(manual)).toContain('CHANGE REASON=POWERSAVE (initiated by the user)');

    const up = applyCommand(s, { kind: 'SET_CPC_CAPACITY', cpcId: cpc.id, capacitySetting: cpc.capacitySetting }).state;
    expect(up.config.cpcs[0]!.peakCapacitySetting).toBeUndefined();
    const back = closeInterval(accumulateTick(newRmfAcc(0), [], [], null, []), { def: BASEPOL, config: up.config, r4haByLpar: {}, jobs: [], endTick: 1 });
    expect(back.cpcBusy.find((c) => c.cpcId === cpc.id && c.pool === 'CP')!.capacityAdjustmentPct).toBeUndefined();
    expect(renderPartitionData(back)).not.toContain('CHANGE REASON');
  });

  it('keeps the lines the mechanism rules use in content, not in the game code', () => {
    expect(CPU_CAPACITY).toEqual({ cpcBusyFrac: 0.9, lparBusyFrac: 0.95, donorFrac: 0.1 });
  });
});
