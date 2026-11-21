import { capacityBasis, mechanismOf } from '../../src/game/sla';
import { newHour } from '../../src/game/run/hourly';
import type { HourAcc, IncidentSubjects } from '../../src/game/types';
import { EMPTY_SUBJECTS } from '../helpers/truth';
import { acceptedAnswers } from '../../src/game/rcaTruth';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { cpuAlternates } from '../../src/game/sla';
import { packOf } from '../../src/content/packs';
import { closeHour } from '../../src/game/run/hourly';
import { newRun } from '../../src/game/run';

const hosts = ['PROD1', 'PROD2'].map((lparId) => ({ lparId, cpcId: 'CPCA', importance: 2 }));
const hour = (): HourAcc => ({ ...newHour(0), ticks: 100, cpcBusyById: { CPCA: 99 }, lparBusyById: { PROD1: 99, PROD2: 70 },
  cpuWaitByWorkloadLpar: { HURT: { PROD1: { cp: 100, ziip: 0, backlog: 0, completions: 100 }, PROD2: { cp: 0, ziip: 0, backlog: 0, completions: 100 } } },
  cpByImportance: { PROD1: [20, 100, 150, 35, 0, 0, 0] },
});
const subjects = (displaceable: number): IncidentSubjects => ({ ...EMPTY_SUBJECTS, hosts: ['PROD1', 'PROD2'], cpu: {
  PROD1: { CP: { engines: 4, classes: { 'OTHER#1': { used: 4, displaceable, workloads: [] } }, jobs: {} }, ZIIP: { engines: 0, classes: {}, jobs: {} } },
} });
const ctx = (s = subjects(0.24)) => ({ workloadId: 'HURT', baseline: {}, subjects: s });

describe('RT-32 judged CPU host', () => {
  it('U-9 ignores a 6%-capped host with none of the excess', () => {
    const h = { ...hour(), cappedTicksByLpar: { PROD2: 6 } };
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, ctx())).toBe('CPU_CAPACITY');
    expect(capacityBasis(h, hosts, ctx())?.lparId).toBe('PROD1');
  });
  it('U-10 excludes the victim server, with priority accepted in the 5–10% band', () => {
    expect(mechanismOf({ cpuQueue: 1 }, {}, hour(), hosts, ctx())).toBe('CPU_CAPACITY');
    expect(capacityBasis(hour(), hosts, ctx())?.displaceablePct).toBe(6);
    const basis = capacityBasis(hour(), hosts, ctx());
    expect(acceptedAnswers({ workloadId: 'HURT', hour: hour(), basis, mechanism: 'CPU_CAPACITY', trigger: 'GROWTH', hosts, events: [], lpars: [], content: MIDWEST_GAME, isNew: false }).accepted.mechanisms).toEqual(['CPU_CAPACITY', 'CPU_PRIORITY']);
  });
  it('U-11 counts same-importance non-SLA CPU', () => {
    const h = { ...hour(), cpByImportance: { PROD1: [20, 50, 320, 10, 0, 0, 0] } };
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, ctx(subjects(3.2)))).toBe('CPU_PRIORITY');
  });
  it('subtracts the workload CPU baseline per host, normalizes positive excess and breaks ties by host id', () => {
    const h = hour();
    h.cpuWaitByWorkloadLpar!.HURT!.PROD2!.cp = 200;
    const c = { ...ctx(), baseline: { cpuQueue: 1 } };
    const basis = capacityBasis(h, hosts, c)!;
    expect(basis.lparId).toBe('PROD2');
    expect(basis.excessSharesPct).toEqual({ PROD2: 100, PROD1: 0 });
    h.cpuWaitByWorkloadLpar!.HURT!.PROD1!.cp = 200;
    expect(capacityBasis(h, [...hosts].reverse(), c)?.lparId).toBe('PROD1');
  });
  it('a one-third co-host contributes capping, and two-thirds imbalance with a roomy peer accepts routing', () => {
    const h = hour();
    h.cpuWaitByWorkloadLpar!.HURT!.PROD1!.cp = 2;
    h.cpuWaitByWorkloadLpar!.HURT!.PROD2!.cp = 1;
    h.cappedTicksByLpar.PROD2 = 6;
    expect(cpuAlternates(h, hosts, ctx()).mechanisms).toEqual(['CPU_CAPACITY', 'CAPPING', 'ROUTING']);
    h.cpuWaitByWorkloadLpar!.HURT!.PROD2!.cp = 0.99;
    expect(cpuAlternates(h, hosts, ctx()).mechanisms).not.toContain('CAPPING');
  });
  it('a partial hour with a wait ledger but no consumer snapshot keeps the donor reading', () => {
    const b = capacityBasis(hour(), hosts, ctx({ ...EMPTY_SUBJECTS, hosts: ['PROD1', 'PROD2'] }))!;
    expect(b.pool).toBe('CP');
    expect(b.displaceablePct).toBeUndefined();
    expect(b.donorPct).toBeCloseTo(100 * 35 / 305);
    expect(mechanismOf({ cpuQueue: 1 }, {}, hour(), hosts, ctx({ ...EMPTY_SUBJECTS, hosts: ['PROD1', 'PROD2'] }))).toBe('CPU_PRIORITY');
  });

  it('old hours retain any-host capping and importance donors', () => {
    const h = { ...hour(), cpuWaitByWorkloadLpar: undefined, cappedTicksByLpar: { PROD2: 6 } };
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, ctx())).toBe('CAPPING');
    expect(capacityBasis(h, hosts.slice(0, 1), ctx())?.pool).toBeUndefined();
    expect(mechanismOf({ cpuQueue: 1 }, {}, { ...h, cappedTicksByLpar: {} }, hosts.slice(0, 1), ctx())).toBe('CPU_PRIORITY');
  });
  it('synthetic Revenue D8 shape: a same-class runaway fills zIIP; overflow blocked at 73% CP is policy', () => {
    const h = hour();
    h.cpuWaitByWorkloadLpar!.HURT!.PROD1 = { cp: 0.4, ziip: 99.6, backlog: 0, completions: 100 };
    h.lparBusyById.PROD1 = 73;
    h.cpcBusyById.CPCA = 72.7;
    h.ziipBusyById = { CPCA: 100 };
    h.ziipLparBusyById = { PROD1: 100 };
    const s = subjects(0);
    s.cpu!.PROD1!.ZIIP = { engines: 1, classes: { 'WEBDDF#1': { used: 1, displaceable: 0.9, workloads: ['EFILE', 'ANALYTICS'] } }, jobs: {} };
    const c = { ...ctx(s), overflowBlockedHosts: ['PROD1'] };
    const b = capacityBasis(h, hosts, c)!;
    expect(b).toMatchObject({ pool: 'ZIIP', cpcBusyPct: 100, displaceablePct: 90, overflowBlocked: true });
    expect(b.topConsumers![0]!.name).toContain('ANALYTICS');
    expect(mechanismOf({ ziipQueue: 1 }, {}, h, hosts, c)).toBe('CPU_PRIORITY');
    expect(acceptedAnswers({ workloadId: 'HURT', hour: h, basis: b, mechanism: 'CPU_PRIORITY', trigger: 'RUNAWAY_WORK', hosts, events: [], lpars: [], content: MIDWEST_GAME, isNew: false }).accepted.triggers).toContain('POLICY');
    s.cpu!.PROD1!.ZIIP.classes['WEBDDF#1']!.displaceable = 0;
    expect(mechanismOf({ ziipQueue: 1 }, {}, h, hosts, { ...c, overflowBlockedHosts: [] })).toBe('CPU_CAPACITY');
    expect(mechanismOf({ ziipQueue: 1 }, {}, h, hosts, c)).toBe('CPU_PRIORITY');
  });
  it.each(['system', 'class'] as const)('Revenue synthetic opening hour records PROD2 zIIP policy (%s opt-out)', (setting) => {
    const pack = packOf('revenue');
    const r = newRun(pack.scenario, pack.game, 23);
    const h = { ...newHour(0), ticks: 100,
      workloads: { EFILE: { completions: 100, failed: 0, withinSla: 0, rtSumSec: 1000, parts: { ziipQueue: 996, cpuQueue: 4 } } },
      cpuWaitByWorkloadLpar: { EFILE: { PROD1: { cp: 0, ziip: 0, backlog: 0, completions: 1 }, PROD2: { cp: 4, ziip: 996, backlog: 0, completions: 99 } } },
      cpByScpLpar: { PROD2: { 'WEBDDF#1': { cp: 73, ziip: 100, iipcp: 0 } } },
      cpByWorkloadLpar: { PROD2: { EFILE: { cp: 10, ziip: 10, iipcp: 0 }, ANALYTICS: { cp: 63, ziip: 90, iipcp: 0 } } },
      cpByRoleLpar: { PROD2: {} },
      cpcBusyById: { CPCA: 72.7 }, lparBusyById: { PROD2: 73 },
      ziipBusyById: { CPCA: 100 }, ziipLparBusyById: { PROD2: 100 },
    };
    if (setting === 'class') {
      r.sim.config.systems = r.sim.config.systems.map((s) => ({ ...s, iipHonorPriority: true }));
      r.sim.wlm.definition.classes.find((c) => c.id === 'WEBDDF')!.honorPriority = false;
    }
    const closed = closeHour({ ...r, hour: h, sim: { ...r.sim, tick: 360 } }, pack.scenario, pack.game);
    const i = closed.incidents.find((i) => i.workloadId === 'EFILE')!;
    expect(i.truth.mechanism).toBe('CPU_PRIORITY');
    expect(i.truth.accepted.triggers).toContain('POLICY');
    expect(i.basis).toMatchObject({ lparId: 'PROD2', pool: 'ZIIP', cpcBusyPct: 100, displaceablePct: 90, overflowBlocked: true });
    expect(i.basis!.topConsumers![0]!.name).toContain('ANALYTICS');
  });
});
