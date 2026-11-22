import { applyWlmEdit } from '../../src/game/wlmEdit';
import { EVIDENCE, MECHANISM_RECIPES } from '../../src/content/evidence';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { addPin } from '../../src/game/evidence';
import { judgeProof } from '../../src/game/proof';
import { mechanismExplanation } from '../../src/game/rcaExplain';
import { advance, newRun, startDay } from '../../src/game/run';
import { capacityBasis, cappingOf, cappingVerdict, mechanismOf, type CpuJudgement } from '../../src/game/sla';
import { closeHour, newHour } from '../../src/game/run/hourly';
import { truthCause } from '../../src/game/rcaTruth';
import { applyCommands } from '../../src/sim/core/commands';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import { SERVER_KEY } from '../../src/sim/wlm/holders';
import type { CapacityBasis, HourAcc, IncidentSubjects } from '../../src/game/types';
import { EMPTY_SUBJECTS } from '../helpers/truth';

const hosts = ['PROD1', 'PROD2'].map((lparId) => ({ lparId, cpcId: 'CPCA', importance: 2 }));

/** A CPU hour judged on PROD1: 100 s of excess there, 1 s on PROD2, plenty of room on the machine. */
const hour = (over: Partial<HourAcc> = {}): HourAcc => ({
  ...newHour(0),
  ticks: 100,
  cpcBusyById: { CPCA: 60 },
  lparBusyById: { PROD1: 60, PROD2: 60 },
  cpuWaitByWorkloadLpar: { HURT: {
    PROD1: { cp: 100, ziip: 0, backlog: 0, completions: 100 },
    PROD2: { cp: 1, ziip: 0, backlog: 0, completions: 100 },
  } },
  cpByImportance: { PROD1: [0, 100, 0, 0, 0, 0, 0], PROD2: [0, 1, 0, 0, 0, 0, 0] },
  ...over,
});

const subjects = (over: Partial<IncidentSubjects> = {}): IncidentSubjects => ({
  ...EMPTY_SUBJECTS, classes: ['DDFPRD'], lpars: ['PROD1', 'PROD2'], hosts: ['PROD1', 'PROD2'], ...over,
});

const groups: Record<string, string> = { DDFPRD: 'RGMOB', STCMED: 'RGSRV' };
const ctx = (over: Partial<CpuJudgement> = {}): CpuJudgement => ({
  workloadId: 'HURT', baseline: {}, subjects: subjects(),
  groupOf: (classId: string) => groups[classId] ?? null,
  roleGroupOf: (_lparId: string, role: string) => (role.startsWith('DB2.') ? 'RGDB2' : null),
  ...over,
});

const cause = (basis: CapacityBasis | null) => truthCause({
  workloadId: 'HURT', mechanism: 'CAPPING', trigger: 'POLICY', hour: hour(), events: [], hosts, isNew: false, basis,
});
const basisOf = (over: Partial<CapacityBasis> = {}): CapacityBasis =>
  ({ lparId: 'PROD1', cpcId: 'CPCA', cpcBusyPct: 60, lparBusyPct: 60, donorPct: 0, full: false, ...over });

describe('CAPPING triggers on the judged host (RT-33)', () => {
  it('the image cap: CAPPING, by IMAGE, with the family cause an LPAR cap always had', () => {
    const h = hour({ cappedTicksByLpar: { PROD1: 6 } });
    expect(cappingOf(h, hosts[0]!, ctx())).toEqual({ by: 'IMAGE', group: null });
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, ctx())).toBe('CAPPING');
    expect(capacityBasis(h, hosts, ctx())).toMatchObject({ lparId: 'PROD1', capBy: 'IMAGE' });
    expect(cause(capacityBasis(h, hosts, ctx()))).toBe('none:CPU:PROD1');
  });

  it('a period of the hurt work with CAP delay ≥ 5 % of its samples: CAPPING, by GROUP', () => {
    const h = hour({ capDelayByScpLpar: { PROD1: {
      'DDFPRD#1': { cap: 6, samples: 100 },
      'DDFPRD#2': { cap: 0, samples: 100 },
    } } });
    expect(cappingOf(h, hosts[0]!, ctx())).toEqual({ by: 'GROUP', group: 'RGMOB' });
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, ctx())).toBe('CAPPING');
    const basis = capacityBasis(h, hosts, ctx())!;
    expect(basis).toMatchObject({ lparId: 'PROD1', capBy: 'GROUP', capGroup: 'RGMOB' });
    expect(cause(basis)).toBe('none:CAPPING:PROD1:rg:RGMOB');
    // Below the share it is not the cause: the CPU split decides (CPU_PRIORITY here: room on the machine).
    const under = hour({ capDelayByScpLpar: { PROD1: { 'DDFPRD#1': { cap: 4, samples: 100 } } } });
    expect(cappingOf(under, hosts[0]!, ctx())).toBeNull();
    expect(mechanismOf({ cpuQueue: 1 }, {}, under, hosts, ctx())).toBe('CPU_PRIORITY');
  });

  it('the server period holding the work\'s regions: CAPPING, by GROUP', () => {
    const c = ctx({ subjects: subjects({ classes: ['ONLHI', 'STCMED'], serverClasses: ['STCMED'],
      servers: [{ jobname: 'CICSAOR1', lparId: 'PROD1' }] }) });
    const h = hour({ capDelayByScpLpar: { PROD1: { [SERVER_KEY]: { cap: 10, samples: 100 } } } });
    expect(cappingOf(h, hosts[0]!, c)).toEqual({ by: 'GROUP', group: 'RGSRV' });
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, c)).toBe('CAPPING');
    expect(capacityBasis(h, hosts, c)).toMatchObject({ capBy: 'GROUP', capGroup: 'RGSRV' });
    // The same row on an image with no serving region is another workload's: it says nothing about this work.
    expect(cappingOf(h, hosts[1]!, c)).toBeNull();
  });

  it('a server role the work depends on, group-capped for ≥ 5 % of the ticks: CAPPING, by SERVER', () => {
    const c = ctx({ serverRoles: ['DB2.DBM1'] });
    const h = hour({ roleCappedTicks: { 'PROD1:DB2.DBM1': 6 } });
    expect(cappingOf(h, hosts[0]!, c)).toEqual({ by: 'SERVER', group: 'RGDB2' });
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, c)).toBe('CAPPING');
    const basis = capacityBasis(h, hosts, c)!;
    expect(basis).toMatchObject({ capBy: 'SERVER', capGroup: 'RGDB2' });
    expect(cause(basis)).toBe('none:CAPPING:PROD1:rg:RGDB2');
    expect(cappingOf(hour({ roleCappedTicks: { 'PROD1:DB2.DBM1': 1 } }), hosts[0]!, c)).toBeNull();
    // A role the work does not depend on, however capped, is not its cause.
    expect(cappingOf(h, hosts[0]!, ctx({ serverRoles: ['MQ.CHIN'] }))).toBeNull();
  });

  it('ignores a cap on a host that carries none of the excess (U-9)', () => {
    const h = hour({ capDelayByScpLpar: { PROD2: { 'DDFPRD#1': { cap: 90, samples: 100 } } },
      roleCappedTicks: { 'PROD2:DB2.DBM1': 90 }, cappedTicksByLpar: { PROD2: 90 } });
    const c = ctx({ serverRoles: ['DB2.DBM1'] });
    expect(cappingVerdict(h, hosts, c)).toBeNull();
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, c)).toBe('CPU_PRIORITY');
  });

  it('an old hour without the RT-16 books keeps image capping only', () => {
    const h = hour({ capDelayByScpLpar: undefined, roleCappedTicks: undefined });
    expect(cappingOf(h, hosts[0]!, ctx({ serverRoles: ['DB2.DBM1'] }))).toBeNull();
    expect(mechanismOf({ cpuQueue: 1 }, {}, { ...h, cappedTicksByLpar: { PROD1: 6 } }, hosts, ctx())).toBe('CAPPING');
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, ctx())).toBe('CPU_PRIORITY');
  });

  it('an hour with no judged host falls back to today\'s any-host image rule, not the group or role triggers', () => {
    // A night or a loaded partial hour has no wait ledger, so there is no judged host to scope §3.3 to.
    const c = ctx({ serverRoles: ['DB2.DBM1'] });
    const h = hour({ cpuWaitByWorkloadLpar: undefined, capDelayByScpLpar: { PROD2: {
      'DDFPRD#1': { cap: 90, samples: 100 }, [SERVER_KEY]: { cap: 90, samples: 100 },
    } }, roleCappedTicks: { 'PROD2:DB2.DBM1': 90 } });
    expect(cappingOf(h, hosts[1]!, c)).toEqual({ by: 'GROUP', group: 'RGMOB' });
    expect(cappingVerdict(h, hosts, c)).toBeNull();
    expect(mechanismOf({ cpuQueue: 1 }, {}, h, hosts, c)).toBe('CPU_PRIORITY');
    expect(capacityBasis(h, hosts, c)?.capBy).toBeUndefined();
    // The image rule still works on any host, as it did before the split.
    const capped = { ...h, cappedTicksByLpar: { PROD2: 90 } };
    expect(cappingVerdict(capped, hosts, c)).toMatchObject({ lparId: 'PROD2', by: 'IMAGE' });
    expect(mechanismOf({ cpuQueue: 1 }, {}, capped, hosts, c)).toBe('CAPPING');
  });

  it('an LPAR cap and a group cap on one image get different cause identities, and so do two groups', () => {
    expect(cause(basisOf({ capBy: 'IMAGE' }))).toBe('none:CPU:PROD1');
    expect(cause(basisOf({ capBy: 'GROUP', capGroup: 'RGMOB' }))).toBe('none:CAPPING:PROD1:rg:RGMOB');
    expect(cause(basisOf({ capBy: 'SERVER', capGroup: 'RGDB2' }))).toBe('none:CAPPING:PROD1:rg:RGDB2');
    expect(cause(basisOf({ capBy: 'GROUP', capGroup: 'OTHER' }))).not.toBe(cause(basisOf({ capBy: 'GROUP', capGroup: 'RGMOB' })));
    // Old incidents (no capBy) keep the family cause.
    expect(cause(basisOf())).toBe('none:CPU:PROD1');
  });

  it('the CAPPING recipe reads CAP delay on the class and its regions', () => {
    const options = MECHANISM_RECIPES.CAPPING.predicates.flatMap((p) => p.options).filter((o) => o.metric === 'DELAY_CAP');
    expect(options).toHaveLength(2);
    for (const o of options) {
      expect(o.relations).toContain('self');
      expect(o.relations).toContain('server');
    }
    expect(EVIDENCE.maxPins).toBeGreaterThanOrEqual(1);
  });
});

describe('a resource-group maximum on the hurt class is CAPPING (RT-33 realism)', () => {
  it('the WLM edit makes the miss CAPPING/POLICY, and a DELAY_CAP pin proves it', () => {
    const game = { ...MIDWEST_GAME, events: [] };
    let run = startDay(newRun(MIDWEST, game, 42), game);
    const def = applyWlmEdit(run.sim.wlm.definition, {
      op: 'SET_RESOURCE_GROUP', classId: 'DDFPRD', group: { id: 'RGMOB', type: 3, min: null, max: 1 },
    });
    if (typeof def === 'string') throw new Error(def);
    run = { ...run, sim: applyCommands(run.sim, [{ kind: 'ACTIVATE_POLICY', definition: def }]) };
    run = advance(run, MIDWEST, game, TICKS_PER_HOUR);
    const inc = run.incidents.find((i) => i.workloadId === 'MOBILE')!;
    expect(inc).toBeDefined();
    expect(inc.truth.mechanism).toBe('CAPPING');
    expect(inc.truth.trigger).toBe('POLICY');
    expect(inc.basis).toMatchObject({ capBy: 'GROUP', capGroup: 'RGMOB' });
    expect(inc.truth.cause).toBe(`none:CAPPING:${inc.basis!.lparId}:rg:RGMOB`);
    // A defined-capacity hour would have used the family cause: this one does not group with an image cap.
    expect(inc.truth.cause).not.toMatch(/^none:CPU:/);

    const index = run.sim.rmf.intervals.length - 1;
    const pinned = addPin(run, MIDWEST, { source: 'WLMGL', index, system: inc.basis!.lparId, scKey: 'DDFPRD#1', metric: 'DELAY_CAP' });
    expect(pinned.ok).toBe(true);
    const pins = (pinned.run.pins ?? []).filter((p) => p.metric === 'DELAY_CAP');
    const proof = judgeProof(pinned.run, MIDWEST, [inc], 'CAPPING', 'POLICY', pins);
    expect(proof.mechanism.complete).toBe(true);
    expect(proof.mechanism.predicates[1]!.pinIds).toEqual([pins[0]!.id]);
  }, 120_000);

  it('closing the hour records the group on the basis and the cause', () => {
    // The same shape through `closeHour`, so the incident-side stamping is tested as well as the judge.
    const game = { ...MIDWEST_GAME, events: [] };
    const started = startDay(newRun(MIDWEST, game, 42), game);
    const def = applyWlmEdit(started.sim.wlm.definition, {
      op: 'SET_RESOURCE_GROUP', classId: 'DDFPRD', group: { id: 'RGMOB', type: 3, min: null, max: 1 },
    });
    if (typeof def === 'string') throw new Error(def);
    const run = { ...started, sim: applyCommands(started.sim, [{ kind: 'ACTIVATE_POLICY', definition: def }]) };
    const h = hour({ capDelayByScpLpar: { PROD1: { 'DDFPRD#1': { cap: 30, samples: 100 } } },
      cpuWaitByWorkloadLpar: { MOBILE: {
        PROD1: { cp: 100, ziip: 0, backlog: 0, completions: 100 },
        PROD2: { cp: 1, ziip: 0, backlog: 0, completions: 100 },
      } },
      workloads: { MOBILE: { completions: 1000, failed: 0, withinSla: 500, rtSumSec: 5000, parts: { cpuQueue: 5000 } } } });
    const closed = closeHour({ ...run, sim: { ...run.sim, tick: TICKS_PER_HOUR }, hour: h }, MIDWEST, game);
    const inc = closed.incidents.find((i) => i.workloadId === 'MOBILE')!;
    expect(inc.truth).toMatchObject({ mechanism: 'CAPPING', trigger: 'POLICY', cause: 'none:CAPPING:PROD1:rg:RGMOB' });
    expect(inc.basis).toMatchObject({ capBy: 'GROUP', capGroup: 'RGMOB' });
    expect(mechanismExplanation(inc)).toContain('resource-group maximum (RGMOB)');
  }, 60_000);
});
