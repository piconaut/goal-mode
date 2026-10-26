import { describe, expect, it } from 'vitest';
import { importanceRank, mechanismOf, triggerOf } from '../../src/game/sla';
import type { ServiceDefinition } from '../../src/sim/wlm/types';
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
  const cpu = { cpuQueue: 1 };
  // LPAR A1 on CPCA; CP engines consumed this hour by importance rank 0–6.
  const at = (busy: number, byImp: number[], capped: Record<string, number> = {}) =>
    ({ ...hour, ticks: 360, cpcBusySum: 0.5 * 360, cpcBusyById: { CPCA: busy * 360 }, cpByImportance: { A1: byImp }, cappedByLpar: capped }) as HourAcc;
  const host = (importance: number) => [{ lparId: 'A1', cpcId: 'CPCA', importance }];

  it('is capacity when the host CPC is full and almost nothing less important runs there', () => {
    expect(mechanismOf(cpu, {}, at(0.93, [10, 200, 300, 5, 0, 0, 2]), host(2))).toBe('CPU_CAPACITY');
  });

  it('is priority when less important work holds CP the hurt workload could have had', () => {
    expect(mechanismOf(cpu, {}, at(0.97, [10, 200, 100, 150, 0, 0, 40]), host(2))).toBe('CPU_PRIORITY');
  });

  it('is priority when the CPC has room, however the importance mix looks', () => {
    expect(mechanismOf(cpu, {}, at(0.7, [10, 200, 300, 0, 0, 0, 0]), host(2))).toBe('CPU_PRIORITY');
  });

  it('still prefers capping of a host LPAR', () => {
    expect(mechanismOf(cpu, {}, at(0.95, [10, 200, 300, 0, 0, 0, 0], { A1: 0.2 }), host(2))).toBe('CAPPING');
  });
});

describe('importanceRank', () => {
  const def = { classes: [{ id: 'ONLHI', periods: [{ goal: { kind: 'AVG', rtSec: 0.2 }, importance: 2, durationSu: 500 }, { goal: { kind: 'DISC' }, importance: 5, durationSu: null }] }] } as unknown as ServiceDefinition;
  it('ranks system classes first, discretionary and SYSOTHER last', () => {
    expect([importanceRank(def, 'SYSTEM#1'), importanceRank(def, 'SYSSTC#1'), importanceRank(def, 'ONLHI#1'), importanceRank(def, 'ONLHI#2'), importanceRank(def, 'SYSOTHER#1')]).toEqual([0, 0, 2, 6, 6]);
  });
});
