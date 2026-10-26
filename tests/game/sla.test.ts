import { describe, expect, it } from 'vitest';
import { mechanismOf, triggerOf } from '../../src/game/sla';
import type { ActiveEvent, HourAcc } from '../../src/game/types';

const hour = { hourIndex: 0, ticks: 1, workloads: {}, maxCappedFrac: 0, cappedByLpar: {}, cpcBusySum: 0, lockIndexSum: 0 } as HourAcc;
const card = (over: Partial<ActiveEvent>): ActiveEvent => ({
  uid: 'X@1', defId: 'X', name: 'X', startTick: 0, endTick: 10, trigger: 'DEMAND_SURGE', affects: ['RBANK'], endCommands: [], started: true, ended: false, ...over,
});

describe('triggerOf', () => {
  it('blames an active card that lists the workload', () => {
    expect(triggerOf('RBANK', 'CPU_CAPACITY', [card({})], hour, false)).toBe('DEMAND_SURGE');
  });

  it('skips a card whose mechanisms do not match the incident', () => {
    const io = card({ trigger: 'HARDWARE_FAULT', mechanisms: ['IO'] });
    expect(triggerOf('RBANK', 'CPU_CAPACITY', [io], hour, false)).toBe('GROWTH');
    expect(triggerOf('RBANK', 'IO', [io], hour, false)).toBe('HARDWARE_FAULT');
  });

  it('ignores ended cards and cards for other workloads', () => {
    expect(triggerOf('RBANK', 'CPU_CAPACITY', [card({ ended: true }), card({ affects: ['MOBILE'] })], hour, false)).toBe('GROWTH');
  });
});

describe('mechanismOf CPU split', () => {
  const lpars = [{ id: 'A1', cpcId: 'CPCA' }, { id: 'B1', cpcId: 'CPCB' }];
  const cpu = { cpuQueue: 1 };
  const at = (hot: Record<string, number>, capped: Record<string, number> = {}) =>
    ({ ...hour, ticks: 360, cpcBusySum: 0.5 * 360, cpcHotTicks: hot, cappedByLpar: capped }) as HourAcc;

  it('calls a CPU incident capacity when a host CPC is saturated for a quarter of the hour, whatever the pooled busy', () => {
    expect(mechanismOf(cpu, {}, at({ CPCB: 120 }), ['B1'], lpars)).toBe('CPU_CAPACITY');
  });

  it('ignores a saturated CPC the workload does not run on', () => {
    expect(mechanismOf(cpu, {}, at({ CPCB: 360 }), ['A1'], lpars)).toBe('CPU_PRIORITY');
  });

  it('is priority when saturation is only brief', () => {
    expect(mechanismOf(cpu, {}, at({ CPCA: 60 }), ['A1', 'B1'], lpars)).toBe('CPU_PRIORITY');
  });

  it('still prefers capping of a host LPAR', () => {
    expect(mechanismOf(cpu, {}, at({ CPCA: 360 }, { A1: 0.2 }), ['A1'], lpars)).toBe('CAPPING');
  });
});
