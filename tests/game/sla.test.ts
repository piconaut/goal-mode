import { describe, expect, it } from 'vitest';
import { addHour, batchMissMechanism, batchMissTrigger, failureMechanismOf, importanceRank, mechanismOf, triggerOf } from '../../src/game/sla';
import type { WorkloadDef } from '../../src/sim/workload/types';
import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import type { NightSummary } from '../../src/sim/subsys/batch';
import type { ServiceDefinition } from '../../src/sim/wlm/types';
import type { ActiveEvent, HourAcc } from '../../src/game/types';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

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

  it('calls a lock clash batch overlap, but a CPU priority or dependency miss the policy, even with batch running', () => {
    const night = { ...hour, ticks: 10, lockIndexSum: 30 };
    expect(triggerOf('RBANK', 'LOCK_CONTENTION', [], night, false)).toBe('BATCH_OVERLAP');
    expect(triggerOf('RBANK', 'CPU_PRIORITY', [], night, false)).toBe('POLICY');
    expect(triggerOf('CARDAUTH', 'DEPENDENCY', [], night, false)).toBe('POLICY');
  });

  it('keeps cards that ended within the opening SLA hour, including at its end', () => {
    const h = { ...hour, hourIndex: 1 };
    for (const endTick of [TICKS_PER_HOUR + 1, 2 * TICKS_PER_HOUR]) {
      expect(triggerOf('RBANK', 'CPU_PRIORITY', [card({ startTick: TICKS_PER_HOUR - 5, endTick, ended: true })], h, false)).toBe('DEMAND_SURGE');
    }
    expect(triggerOf('RBANK', 'CPU_PRIORITY', [card({ startTick: TICKS_PER_HOUR + 1, endTick: null })], h, false)).toBe('DEMAND_SURGE');
  });

  it('ignores cards outside the opening SLA hour, including touching boundaries', () => {
    const h = { ...hour, hourIndex: 1 };
    for (const over of [
      { endTick: TICKS_PER_HOUR - 1, ended: true },
      { endTick: TICKS_PER_HOUR, ended: true },
      { startTick: 2 * TICKS_PER_HOUR, endTick: null },
      { startTick: 2 * TICKS_PER_HOUR + 1, endTick: null },
      { startTick: TICKS_PER_HOUR, endTick: TICKS_PER_HOUR, ended: true },
      { startTick: TICKS_PER_HOUR, endTick: null, started: false },
    ]) {
      expect(triggerOf('RBANK', 'CPU_PRIORITY', [card(over)], h, false)).toBe('POLICY');
    }
  });

  it('still filters ended overlapping cards by workload and mechanism', () => {
    const ended = card({ ended: true });
    expect(triggerOf('RBANK', 'CPU_CAPACITY', [{ ...ended, affects: ['MOBILE'] }], hour, false)).toBe('GROWTH');
    expect(triggerOf('RBANK', 'CPU_CAPACITY', [{ ...ended, mechanisms: ['IO'] }], hour, false)).toBe('GROWTH');
    expect(triggerOf('RBANK', 'IO', [{ ...ended, mechanisms: ['IO'] }], hour, false)).toBe('DEMAND_SURGE');
  });

  it('prefers a card still active at hour close over an ended card regardless of list order or overlap length', () => {
    const h = { ...hour, hourIndex: 1 };
    const active = card({ uid: 'Z_ACTIVE@1', startTick: 2 * TICKS_PER_HOUR - 1, endTick: null });
    for (const endTick of [TICKS_PER_HOUR + 1, 2 * TICKS_PER_HOUR]) {
      const ended = card({ uid: 'A_ENDED@1', endTick, ended: true, trigger: 'HARDWARE_FAULT' });
      for (const events of [[ended, active], [active, ended]]) {
        expect(triggerOf('RBANK', 'CPU_PRIORITY', events, h, false)).toBe('DEMAND_SURGE');
      }
    }
  });

  it('prefers the longest opening-hour overlap within the same activity status', () => {
    const h = { ...hour, hourIndex: 1 };
    for (const endTick of [2 * TICKS_PER_HOUR, 3 * TICKS_PER_HOUR, null]) {
      const longer = card({ uid: 'Z_LONG@1', startTick: 0, endTick, ended: endTick === 2 * TICKS_PER_HOUR });
      const shorter = card({ ...longer, uid: 'A_SHORT@1', startTick: TICKS_PER_HOUR + 1, trigger: 'HARDWARE_FAULT' });
      for (const events of [[shorter, longer], [longer, shorter]]) {
        expect(triggerOf('RBANK', 'CPU_PRIORITY', events, h, false)).toBe('DEMAND_SURGE');
      }
    }
  });

  it('breaks equal activity and overlap ties by ascending card uid, without changing the event list', () => {
    for (const endTick of [10, null]) {
      const first = card({ uid: 'A@1', endTick, ended: endTick !== null });
      const second = card({ ...first, uid: 'B@1', trigger: 'HARDWARE_FAULT' });
      for (const events of [[second, first], [first, second]]) {
        const original = [...events];
        expect(triggerOf('RBANK', 'CPU_PRIORITY', events, hour, false)).toBe('DEMAND_SURGE');
        expect(events).toEqual(original);
      }
    }
  });
});

describe('failureMechanismOf', () => {
  const w = { id: 'RBANK', sla: { kind: 'AVG', rtSec: 0.5 } } as unknown as WorkloadDef;
  const sick = card({ trigger: 'POLICY', failureMechanism: 'ROUTING' });
  const wh = (rtSec: number, failed: number) => ({ completions: 1000, withinSla: 0, failed, rtSumSec: 1000 * rtSec, parts: {} });

  it("names the card's mechanism when failures alone missed the SLA", () => {
    expect(failureMechanismOf(w, wh(0.1, 300), [sick], hour)).toBe('ROUTING');
  });

  it('leaves a slow hour, a clean hour or a card without one to the delay groups', () => {
    expect(failureMechanismOf(w, wh(0.9, 300), [sick], hour)).toBeNull();
    expect(failureMechanismOf(w, wh(0.1, 0), [sick], hour)).toBeNull();
    expect(failureMechanismOf(w, wh(0.1, 300), [card({})], hour)).toBeNull();
  });

  it('keeps a card fixed or expired inside the opening hour, but not one that ended at its start', () => {
    // SICK_AOR recycled 50 minutes into the hour (300 of 360 ticks) still names ROUTING.
    expect(failureMechanismOf(w, wh(0.1, 300), [{ ...sick, startTick: 0, endTick: 300, ended: true }], hour)).toBe('ROUTING');
    // A card that expired at the hour's end still covers it (half-open).
    expect(failureMechanismOf(w, wh(0.1, 300), [{ ...sick, endTick: TICKS_PER_HOUR, ended: true }], hour)).toBe('ROUTING');
    // One that ended exactly at the hour's start does not overlap.
    expect(failureMechanismOf(w, wh(0.1, 300), [{ ...sick, endTick: 0, ended: true }], hour)).toBeNull();
  });
});

describe('mechanismOf thread limits', () => {
  it('counts only the MXT queueing the work would build at its unqueued service time as THREAD_LIMIT', () => {
    // Tasks slowed by QR wait hold their MXT slot longer: at service time they would have queued 0.05 s.
    expect(mechanismOf({ qr: 0.3, outside: 0.35, outsideRef: 0.05 }, {}, hour, [])).toBe('QR_TCB');
    // Starved tasks drive the queue far past the slowdown itself; it is still the starvation's symptom.
    expect(mechanismOf({ cpuQueue: 0.2, outside: 0.9, outsideRef: 0 }, {}, hour, [])).toBe('CPU_PRIORITY');
    // MXT too small for the arrival rate even at service time: the queueing is the limit's own.
    expect(mechanismOf({ qr: 0.01, outside: 0.35, outsideRef: 0.3 }, {}, hour, [])).toBe('THREAD_LIMIT');
  });
});

describe('mechanismOf CPU split', () => {
  const cpu = { cpuQueue: 1 };
  // LPAR A1 on CPCA; CP engines consumed this hour by importance rank 0–6.
  const at = (busy: number, byImp: number[], capped: Record<string, number> = {}, lparBusy = 0.5) =>
    ({ ...hour, ticks: 360, cpcBusySum: 0.5 * 360, cpcBusyById: { CPCA: busy * 360 }, lparBusyById: { A1: lparBusy * 360 }, cpByImportance: { A1: byImp }, cappedByLpar: capped }) as HourAcc;
  // The same hour with the tick count RT-08 adds: `ticksCapped` of its 360 ticks were capped.
  const ticks = (ticksCapped: number, busy = 0.7, byImp = [10, 200, 300, 0, 0, 0, 0], lparBusy = 0.5) =>
    ({ ...at(busy, byImp, { A1: 0.2 }, lparBusy), cappedTicksByLpar: { A1: ticksCapped } }) as HourAcc;
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

  it('uses the same CPU split when zIIP queue growth dominates the incident', () => {
    const ziip = { ziipQueue: 1, cpuQueue: 0.01, io: 0.02 };
    expect(mechanismOf(ziip, { ziipQueue: 0.1 }, at(0.7, [10, 200, 300, 0, 0, 0, 0]), host(2))).toBe('CPU_PRIORITY');
    expect(mechanismOf(ziip, { ziipQueue: 0.1 }, at(0.93, [10, 200, 300, 5, 0, 0, 2]), host(2))).toBe('CPU_CAPACITY');
  });

  it('is capacity when the image used all the CP it could get, even with room on its CPC', () => {
    expect(mechanismOf(cpu, {}, at(0.86, [10, 200, 300, 5, 0, 0, 2], {}, 0.97), host(2))).toBe('CPU_CAPACITY');
  });

  it('is still priority on a saturated image when less important work there could donate', () => {
    expect(mechanismOf(cpu, {}, at(0.86, [10, 200, 100, 150, 0, 0, 40], {}, 0.97), host(2))).toBe('CPU_PRIORITY');
  });

  it('still prefers capping of a host LPAR in an hour with no tick count (a save written before RT-08)', () => {
    expect(mechanismOf(cpu, {}, at(0.95, [10, 200, 300, 0, 0, 0, 0], { A1: 0.2 }), host(2))).toBe('CAPPING');
  });

  it('does not call an hour capped because one tick was (18 ticks is the 5 % line)', () => {
    // A single tick in which 6 % of the image's demand was cut: the worst-tick reading said CAPPING, the time one
    // gives the CPU split (the CPC has room here, so priority).
    expect(mechanismOf(cpu, {}, ticks(1), host(2))).toBe('CPU_PRIORITY');
    expect(mechanismOf(cpu, {}, ticks(17), host(2))).toBe('CPU_PRIORITY');
  });

  it('calls the hour capped when the image was capped for at least 5 % of its ticks', () => {
    expect(mechanismOf(cpu, {}, ticks(18), host(2))).toBe('CAPPING');
    expect(mechanismOf(cpu, {}, ticks(36), host(2))).toBe('CAPPING');
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
    const abend = card({ trigger: 'APPLICATION_ERROR', affects: ['BATCH'], mechanisms: ['JOB_FAILURE'], startTick: 100, endTick: 100, ended: true });
    expect(batchMissTrigger('JOB_FAILURE', [abend], hour, 50)).toBe('APPLICATION_ERROR');
    expect(batchMissTrigger('JOB_FAILURE', [abend], hour, 200)).toBe('GROWTH');
    expect(batchMissTrigger('IO', [abend], hour, 50)).toBe('GROWTH');
  });

  it('reads a Db2 connect failure (DSNE100I) without a card as policy: the initiator setup sent the job there', () => {
    const night = { day: 0, jobs: 1, done: 0, criticalJobs: 1, criticalDone: 0, criticalEndSec: null, missedDeadline: true, criticalAbended: ['GLF01'], criticalFailCodes: { GLF01: 'DSNE100I' } };
    expect(batchMissTrigger('JOB_FAILURE', [], hour, 50, night)).toBe('POLICY');
    expect(batchMissTrigger('JOB_FAILURE', [], hour, 50, { ...night, criticalFailCodes: { GLF01: 'S0C7' } })).not.toBe('POLICY');
  });

  it('reads an S0C7 abend as an application error, not policy', () => {
    expect(MIDWEST_EVENTS.find((e) => e.id === 'JOB_ABEND')?.trigger).toBe('APPLICATION_ERROR');
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

  it('sums the ticks each night hour was capped, so the night is judged as time', () => {
    const h = (cappedTicks: number) => ({ ...hour, ticks: 360, cappedByLpar: { A1: 0.2 }, cappedTicksByLpar: { A1: cappedTicks } });
    const acc = addHour(addHour(null, h(18)), h(18));
    expect(acc.cappedTicksByLpar).toEqual({ A1: 36 });
    // 5 % of each hour's ticks is 5 % of the night's: at the line.
    expect(mechanismOf({ cpuQueue: 1 }, {}, acc, [{ lparId: 'A1', cpcId: 'C', importance: 2 }])).toBe('CAPPING');
    // One hour well under the line pulls the night below it, however bad the other hour was.
    const short = addHour(addHour(null, h(35)), h(0));
    expect(mechanismOf({ cpuQueue: 1 }, {}, short, [{ lparId: 'A1', cpcId: 'C', importance: 2 }])).toBe('CPU_PRIORITY');
  });

  it('leaves the tick count off a night that folds in an hour accumulated before RT-08', () => {
    const counted = { ...hour, ticks: 360, cappedByLpar: { A1: 0.2 }, cappedTicksByLpar: { A1: 9 } };
    const old = { ...hour, ticks: 360, cappedByLpar: { A1: 0.02 } };
    const hosts = [{ lparId: 'A1', cpcId: 'C', importance: 2 }];
    // 2.5 % of the hour's ticks: the time reading is not capping, though one tick cut 20 % of the demand.
    expect(mechanismOf({ cpuQueue: 1 }, {}, counted, hosts)).toBe('CPU_PRIORITY');
    // Folded with an hour that has no count, the night keeps the worst-tick reading it was working to.
    const acc = addHour(addHour(null, counted), old);
    expect(acc.cappedTicksByLpar).toBeUndefined();
    expect(mechanismOf({ cpuQueue: 1 }, {}, acc, hosts)).toBe('CAPPING');
  });
});
