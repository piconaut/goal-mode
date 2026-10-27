import { describe, expect, it } from 'vitest';
import { addHour, batchMissMechanism, batchMissTrigger, importanceRank, mechanismOf, triggerOf } from '../../src/game/sla';
import type { NightSummary } from '../../src/sim/subsys/batch';
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
  const at = (busy: number, byImp: number[], capped: Record<string, number> = {}, lparBusy = 0.5) =>
    ({ ...hour, ticks: 360, cpcBusySum: 0.5 * 360, cpcBusyById: { CPCA: busy * 360 }, lparBusyById: { A1: lparBusy * 360 }, cpByImportance: { A1: byImp }, cappedByLpar: capped }) as HourAcc;
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

  it('is capacity when the image used all the CP it could get, even with room on its CPC', () => {
    expect(mechanismOf(cpu, {}, at(0.86, [10, 200, 300, 5, 0, 0, 2], {}, 0.97), host(2))).toBe('CPU_CAPACITY');
  });

  it('is still priority on a saturated image when less important work there could donate', () => {
    expect(mechanismOf(cpu, {}, at(0.86, [10, 200, 100, 150, 0, 0, 40], {}, 0.97), host(2))).toBe('CPU_PRIORITY');
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

describe('missed batch window truth', () => {
  const night = (over: Partial<NightSummary>): NightSummary => ({
    day: 0, jobs: 3, done: 2, criticalJobs: 2, criticalDone: 1, criticalEndSec: null, missedDeadline: true,
    criticalDelaySec: { cpu: 600, io: 100, lock: 2400, db2: 300, swap: 0, init: 200 }, criticalAbended: [], criticalHosts: [], ...over,
  });

  it('blames the biggest cause of lost elapsed time, and an ABEND over everything', () => {
    expect(batchMissMechanism(night({}), hour, [])).toBe('LOCK_CONTENTION');
    expect(batchMissMechanism(night({ criticalDelaySec: { cpu: 0, io: 0, lock: 0, db2: 0, swap: 0, init: 5000 } }), hour, [])).toBe('THREAD_LIMIT');
    expect(batchMissMechanism(night({ criticalAbended: ['PAYJ01'] }), hour, [])).toBe('JOB_FAILURE');
  });

  it('blames a card that affects BATCH and ran during the night, even if it has ended', () => {
    const abend = card({ trigger: 'POLICY', affects: ['BATCH'], mechanisms: ['JOB_FAILURE'], startTick: 100, endTick: 100, ended: true });
    expect(batchMissTrigger('JOB_FAILURE', [abend], hour, 50)).toBe('POLICY');
    expect(batchMissTrigger('JOB_FAILURE', [abend], hour, 200)).toBe('GROWTH');
    expect(batchMissTrigger('IO', [abend], hour, 50)).toBe('GROWTH');
  });

  it('sums night hours, keeping the worst capping', () => {
    const h = (capped: number) => ({ ...hour, ticks: 360, cappedByLpar: { A1: capped }, cpcBusyById: { C: 300 }, cpByImportance: { A1: [1, 2] }, lockIndexSum: 10 });
    const acc = addHour(addHour(null, h(0.2)), h(0.1));
    expect(acc.ticks).toBe(720);
    expect(acc.cappedByLpar.A1).toBe(0.2);
    expect(acc.cpcBusyById!.C).toBe(600);
    expect(acc.cpByImportance!.A1).toEqual([2, 4]);
    expect(acc.lockIndexSum).toBe(20);
  });
});
