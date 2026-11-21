import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { displaceable, slaAtRisk, snapshotCpuConsumers } from '../../src/game/displaceable';
import { incidentSubjects, type EvidencePin } from '../../src/game/evidence';
import { batchAtRiskFromSec } from '../../src/game/night';
import { judgeProof } from '../../src/game/proof';
import { newRun } from '../../src/game/run';
import { newHour } from '../../src/game/run/hourly';
import type { CpuGrant } from '../../src/sim/core/types';
import type { WorkloadDef } from '../../src/sim/workload/types';
import { truthOf } from '../helpers/truth';

const grant = (cp: number, ziip = 0, iipcp = 0): CpuGrant => ({ cp, ziip, iipcp });
const hurt = MIDWEST.workloads.find((w) => w.id === 'MOBILE')!;
const other = { ...hurt, id: 'RUNAWAY', sla: { kind: 'NONE' as const } };
const run = newRun(MIDWEST, MIDWEST_GAME, 42);
const h = { ...newHour(0), ticks: 1,
  cpByScpLpar: { PROD1: { 'SYSTEM#1': grant(0.2), 'DDFPRD#1': grant(1, 1, 0.3), 'STCMED#1': grant(0.5), 'TSO#1': grant(0.5) } },
  cpByWorkloadLpar: { PROD1: { MOBILE: grant(0.4, 0.1, 0.1), RUNAWAY: grant(0.6, 0.9, 0.2) } },
  cpByRoleLpar: { PROD1: { 'DB2.MSTR': grant(0.35) } },
};
const snapshot = () => snapshotCpuConsumers(run, MIDWEST, h, hurt, [hurt, other], incidentSubjects(run, MIDWEST, hurt.id, 0));

describe('shared displaceable CPU accounting', () => {
  it('excludes SYSTEM, own transactions and server roles but retains monitors and same-class queries, including IIPCP', () => {
    const s = snapshot();
    expect(s.cpu!.PROD1!.CP.classes['SYSTEM#1']!.displaceable).toBe(0);
    expect(s.cpu!.PROD1!.CP.classes['DDFPRD#1']!.displaceable).toBeCloseTo(0.8);
    expect(s.cpu!.PROD1!.CP.classes['STCMED#1']!.displaceable).toBeCloseTo(0.15);
    expect(s.cpu!.PROD1!.CP.classes['TSO#1']!.displaceable).toBe(0.5);
    expect(displaceable(s, 'PROD1', 'ZIIP')).toBeCloseTo(0.9);
    expect(displaceable(s, 'PROD1', 'CP')).toBeCloseTo(1.45 / 2.5);
  });
  it('uses attainment, not importance, to protect other SLA classes and their server roles', () => {
    const sla = { ...other, sla: { kind: 'PCT' as const, pct: 90, rtSec: 1 } };
    const hour = { ...h, workloads: { RUNAWAY: { completions: 100, failed: 0, withinSla: 92, rtSumSec: 20, parts: {} } } };
    expect(slaAtRisk(sla, hour)).toBe(true);
    const s = snapshotCpuConsumers(run, MIDWEST, hour, hurt, [hurt, sla], incidentSubjects(run, MIDWEST, hurt.id, 0));
    expect(s.cpu!.PROD1!.CP.classes['DDFPRD#1']!.displaceable).toBe(0);
    expect(slaAtRisk(sla, { ...hour, workloads: { RUNAWAY: { ...hour.workloads.RUNAWAY, withinSla: 93 } } })).toBe(false);
    const avg: WorkloadDef = { ...sla, sla: { kind: 'AVG', rtSec: 1 } };
    expect(slaAtRisk(avg, { ...hour, workloads: { RUNAWAY: { ...hour.workloads.RUNAWAY, rtSumSec: 81 } } })).toBe(true);
    expect(slaAtRisk(avg, { ...hour, workloads: { RUNAWAY: { ...hour.workloads.RUNAWAY, rtSumSec: 80 } } })).toBe(false);
  });
  it('truth and proof use the same frozen fraction after policy and routing edits', () => {
    const subjects = snapshot();
    const inc = { id: 1, workloadId: hurt.id, day: 0, startTick: 0, endTick: 360, hours: 1, worstAttainmentPct: 80,
      truth: truthOf('CPU_PRIORITY', 'POLICY'), subjects, rca: null, trustLost: 0 };
    const pin: EvidencePin = { id: 1, source: 'WLMGL', metric: 'APPL_CP', subject: 'DDFPRD#1', system: 'PROD1', tick: 360, value: 130, text: 'CPU' };
    const proves = (p: EvidencePin) => judgeProof(run, MIDWEST, [inc], 'CPU_PRIORITY', 'POLICY', [p]).mechanism.predicates[1]!.met;
    expect(proves(pin)).toBe(true);
    expect(proves({ ...pin, subject: 'SYSTEM#1' })).toBe(false);
    expect(proves({ ...pin, metric: 'JOB_APPL', source: 'PROCU', subject: 'DB1AMSTR' })).toBe(false);
    const changed = { ...run, sim: { ...run.sim, routing: {}, wlm: { ...run.sim.wlm, definition: { ...run.sim.wlm.definition, classes: [] } } } };
    expect(judgeProof(changed, MIDWEST, [inc], 'CPU_PRIORITY', 'POLICY', [pin])).toEqual(judgeProof(run, MIDWEST, [inc], 'CPU_PRIORITY', 'POLICY', [pin]));
  });
  it('protects critical running batch only in its window and near the visible forecast deadline', () => {
    const job = { day: 0, def: MIDWEST.batchNetwork(42, 0, 1).find((j) => j.critical)!, status: 'RUNNING' as const, lparId: 'PROD1', progress: 0, queuedTick: 0, startTick: 0, endTick: null, stretch: 1 };
    const night = { ...h, hourIndex: 15, cpByScpLpar: { PROD1: { 'BATCHPRD#1': grant(1) } } };
    const withForecast = (forecast: number) => ({ ...run, sim: { ...run.sim, batch: { ...run.sim.batch, jobs: [job], projectedCriticalEndSec: forecast } } });
    const value = (forecast: number, hour = night) => snapshotCpuConsumers(withForecast(forecast), MIDWEST, hour, hurt, [hurt, other], incidentSubjects(run, MIDWEST, hurt.id, 0)).cpu!.PROD1!.CP.classes['BATCHPRD#1']!.displaceable;
    // The margin is a quarter of the night window before the deadline (18:00–06:00 → protect from 03:00), not a
    // quarter of the absolute clock. Forecasts are seconds from the 06:00 day start.
    const threshold = batchAtRiskFromSec(0, run.batchDeadlineSec);
    expect(value(threshold)).toBe(0);
    expect(value(threshold - 1)).toBe(1);
    // The night is 18:00 to the day end: 17:00 is not protected even with a late forecast, 18:00 and 05:00 are.
    expect(value(run.batchDeadlineSec, { ...night, hourIndex: 11 })).toBe(1);
    expect(value(run.batchDeadlineSec, { ...night, hourIndex: 12 })).toBe(0);
    expect(value(run.batchDeadlineSec, { ...night, hourIndex: 23 })).toBe(0);
    expect(value(run.batchDeadlineSec, { ...night, hourIndex: 0 })).toBe(1);
  });
  it('projects own CICS transactions to the reported region row and excludes only their shared-region share', () => {
    const a = { ...MIDWEST.workloads.find((w) => w.id === 'RBANK')!, servers: [] };
    const b = { ...a, id: 'NEIGHBOUR', sla: { kind: 'NONE' as const } };
    const hour = { ...newHour(0), ticks: 1,
      cpByScpLpar: { PROD1: { 'ONLHI#1': grant(2), 'STCHI#1': grant(1) } },
      cpByWorkloadLpar: { PROD1: { RBANK: grant(0.5), NEIGHBOUR: grant(1.5) } },
      cpByRoleLpar: { PROD1: { 'CICS.AOR': grant(1) } },
      cpuWaitByWorkloadLpar: { RBANK: { PROD1: { cp: 1, ziip: 0, backlog: 0, completions: 25 } }, NEIGHBOUR: { PROD1: { cp: 1, ziip: 0, backlog: 0, completions: 75 } } },
    };
    const s = snapshotCpuConsumers(run, MIDWEST, hour, a, [a, b], incidentSubjects(run, MIDWEST, a.id, 0));
    expect(s.cpu!.PROD1!.CP.classes['ONLHI#1']!.used).toBe(0);
    expect(s.cpu!.PROD1!.CP.classes['STCHI#1']).toMatchObject({ used: 3, displaceable: 2.25 });
    expect(s.cpu!.PROD1!.CP.engines).toBe(3);
  });
});
