import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { buildMon3, explainWlmLog, type Mon3Row } from '../../src/game/mon3';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { buildView } from '../../src/game/view';

const content = { ...MIDWEST_GAME, events: [] };
let noon: RunState;

beforeAll(() => {
  noon = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 6 * 360); // 12:00
});

describe('Monitor III views', () => {
  it('are hidden without the tool, and the WLM log is not live', () => {
    const v = buildView(noon, MIDWEST);
    expect(v.mon3).toBeNull();
    expect(v.wlmLog).toEqual([]);
    const w = buildView({ ...noon, tools: ['RMF_MON3'] }, MIDWEST);
    expect(w.mon3).not.toBeNull();
    expect(w.features).toContain('WLM_ACTIVITY_LOG');
  });

  it('PROCU adds up to roughly what the LPAR delivered', () => {
    const m = buildMon3(noon, MIDWEST);
    for (const l of noon.sim.lpars.filter((x) => m.systems.some((s) => s.system === x.id))) {
      const delivered = l.pools.find((p) => p.pool === 'CP')!.deliveredEngines;
      const appl = m.rows.filter((r) => r.system === l.id).reduce((a, r) => a + r.cpuEngines, 0);
      // Smoothed window vs one tick, and PR/SM overhead counts as delivered but not APPL.
      expect(appl).toBeGreaterThan(delivered * 0.6);
      expect(appl).toBeLessThan(delivered * 1.15);
    }
  });

  it('ENCLAVE shows DDF work using zIIPs', () => {
    const m = buildMon3(noon, MIDWEST);
    const mobile = m.enclaves.filter((e) => e.workloadIds.includes('MOBILE'));
    expect(mobile.length).toBeGreaterThan(0);
    expect(mobile.reduce((a, e) => a + e.ziipEngines, 0)).toBeGreaterThan(0);
    expect(m.rows.some((r) => r.system === '*PLEX')).toBe(true);
  });

  it('a CPU regression raises CP delay and worsens WFEX against a control at the same time', () => {
    // Advance independent copies through the same ten minutes so ordinary WLM changes affect both.
    const control = advance(structuredClone(noon), MIDWEST, content, 60);
    const stressed = structuredClone(noon);
    stressed.pendingCommands.push({ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 12 });
    const hot = advance(stressed, MIDWEST, content, 60);
    expect(control.sim.tick).toBe(noon.sim.tick + 60);
    expect(hot.sim.tick).toBe(control.sim.tick);
    const base = buildMon3(control, MIDWEST);
    const m = buildMon3(hot, MIDWEST);
    const affected = (mm: typeof m) => mm.rows.find((r) => r.system === 'PROD2' && r.scKey === 'DDFPRD#2')!;
    const before = affected(base), after = affected(m);
    expect(after.delay.cpu).toBeGreaterThan(before.delay.cpu);
    expect(after.avgUsers.delayProc).toBeGreaterThan(before.avgUsers.delayProc);
    expect(after.pi!).toBeGreaterThan(before.pi!);
    expect(after.velocity!).toBeLessThan(before.velocity!);
    // Check the affected period even if other classes enter or leave exception at the same time.
    const wfex = m.exceptions.find((e) => e.where === 'PROD2 DDFPRD#2')!;
    expect(wfex.reason).toMatch(/WFL%/);
    expect(parseFloat(wfex.value)).toBeLessThan(before.velocity!);
  });
});

describe('WLM log explanations', () => {
  it('explains receivers, donors and unfixable delays', () => {
    expect(explainWlmLog('D1 12:00:10 PROD1 RCVR=ONLHI#1 PI=1.80 BTLNK=CPU ONLHI#1 DP F8→F9')).toMatch(/raised its dispatch priority from F8 to F9/);
    expect(explainWlmLog('D1 12:00:10 PROD1 RCVR=ONLHI#1 PI=1.80 BTLNK=CPU DONOR BATCHPRD#1 DP F8→F7')).toMatch(/lowered donor BATCHPRD#1/);
    expect(explainWlmLog('D1 12:00:10 PROD2 DDFPRD#1 PI=2.10 BTLNK=OTHER not WLM-fixable')).toMatch(/can't fix that/);
  });

  it('repeats the first rejected move and why (PT-05)', () => {
    const text = explainWlmLog('D1 12:00:10 PROD1 ONLCARD#1 PI=4.00 BTLNK=CPU no action with net value (ONLCARD#1 DP F4→F6 rejected: harms DDFMOB#1, equal importance)');
    expect(text).toMatch(/First move tried: ONLCARD#1 DP F4→F6, rejected harms DDFMOB#1, equal importance\./);
    expect(explainWlmLog('D1 12:00:10 PROD1 ONLCARD#1 PI=4.00 BTLNK=CPU no action with net value')).not.toMatch(/First move tried/);
  });
});

describe('SYSINFO velocity', () => {
  it('is a percentage', () => {
    for (const r of buildMon3(noon, MIDWEST).rows) if (r.velocity !== null) expect(r.velocity).toBeLessThanOrEqual(100);
  });
});

describe('Monitor III field formulas (RMF Report Analysis)', () => {
  it('WFL %, USG %, DLY % and UKN % partition the active samples', () => {
    for (const r of buildMon3(noon, MIDWEST).rows) {
      if (r.avgUsers.active <= 0) continue;
      expect(r.usingFrac + r.delayFrac + r.unknownFrac).toBeCloseTo(1, 6);
      // % Delayed for adds up to DLY % (no overlap modelled).
      const d = r.delay;
      expect(d.cpu + d.ziip + d.io + d.stor + d.cap).toBeCloseTo(r.delayFrac, 6);
    }
  });

  it('percentile goals report % within goal, and CICS transaction classes show N/A velocity in SYSSUM', () => {
    const rows = buildMon3(noon, MIDWEST).rows.filter((r) => r.system === '*PLEX');
    for (const r of rows.filter((x) => x.goalPct !== null && x.endedPerSec > 0)) {
      expect(r.withinGoalPct).not.toBeNull();
      // PI ≤ 1 exactly when at least the goal percentile ended within the goal time.
      if (r.pi !== null && r.pi <= 1) expect(r.withinGoalPct!).toBeGreaterThanOrEqual(r.goalPct! - 1e-6);
    }
    const cics = rows.find((r) => r.scKey === 'ONLHI#1')!;
    expect(cics.velocity).toBeNull();
    expect(cics.velocityAct).toBeNull();
    expect(cics.workManager!.active).toBeGreaterThan(0);
    expect(cics.avgRtMs).not.toBeNull();
    expect(cics.pi).not.toBeNull();
  });

  it('SYSINFO MVS view is at least the LPAR view, and EAppl% ≥ Appl%', () => {
    for (const s of buildMon3(noon, MIDWEST).systems) {
      expect(s.mvsBusyPct).toBeGreaterThanOrEqual(s.cpBusyPct - 1e-9);
      expect(s.eapplPct).toBeGreaterThanOrEqual(s.applPct - 1e-9);
    }
  });

  it('CPC capacity: physical total = effect + LPAR management, Act MSU ≤ capacity', () => {
    const m = buildMon3(noon, MIDWEST);
    for (const c of m.cpc) expect(c.physTotalPct).toBeCloseTo(c.physEffectPct + c.physLparPct, 6);
    for (const h of m.cpcHeaders) {
      expect(h.imageCapacityMsu).toBeLessThanOrEqual(h.cpcCapacityMsu + 1e-6);
      expect(h.max4hMsu).toBeGreaterThanOrEqual(0);
    }
  });

  it('CPC rows and headers carry their CPC id; L:P is reported per CPC', () => {
    const m = buildMon3(noon, MIDWEST);
    const ids = new Set(m.cpc.map((c) => c.cpcId));
    expect([...ids]).toEqual(['CPCA']);
    expect(m.cpcHeaders.every((h) => ids.has(h.cpcId))).toBe(true);
    expect(m.logicalToPhysicalByCpc.CPCA).toBeCloseTo(m.logicalToPhysical, 9);
  });

  it('WFEX Speed of a CICS transaction class comes from its serving regions, not "No work"', () => {
    const m = buildMon3(noon, MIDWEST);
    const tx = m.rows.find((r) => r.system !== '*PLEX' && r.workManager && r.resourceSamples === false && r.workManager.active > 0)!;
    expect(tx).toBeDefined();
    const s = m.speed.find((x) => x.system === tx.system && x.name === tx.scKey)!;
    expect(s.servedBy).toEqual(tx.workManager!.regionKeys.filter((k) => m.rows.some((r) => r.system === tx.system && r.scKey === k)));
    expect(s.speed).not.toBeNull();
    expect(s.speed!).toBeGreaterThan(0);
  });

  it('WFEX exceptions carry an RMF-style reason and critical value', () => {
    const hot = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 12 }] }, MIDWEST, content, 60);
    const m = buildMon3(hot, MIDWEST);
    expect(m.exceptions.length).toBeGreaterThan(0);
    for (const e of m.exceptions) expect(e.reason.length).toBeGreaterThan(0);
    expect(m.speed.some((s) => s.name === '*PROC')).toBe(true);
  });
});

// RMF Report Analysis Table 20 (erbb500 v3r1 pp.108–110): % Delayed for PRC DEV STR SUB OPR ENQ, no capping
// column, so DLY % may exceed their sum; Primary Reason is a jobname for PRC and RG-Cap for capping.
describe('Monitor III DELAY columns and Primary Reason', () => {
  const columns = (d: Mon3Row['delay']) => d.cpu + d.ziip + d.io + d.stor;

  it('capping counts in DLY % but in no column, and reads RG-Cap', () => {
    const def = structuredClone(noon.sim.wlm.definition);
    def.resourceGroups = [...def.resourceGroups, { id: 'RGTEST', type: 3, min: null, max: 1 }];
    def.classes.find((c) => c.id === 'DDFPRD')!.resourceGroup = 'RGTEST';
    const capped = advance({ ...noon, sim: { ...noon.sim, wlm: { ...noon.sim.wlm, definition: def } } }, MIDWEST, content, 60);
    const r = buildMon3(capped, MIDWEST).rows.find((x) => x.system === 'PROD1' && x.scKey === 'DDFPRD#1')!;
    expect(r.delay.cap).toBeGreaterThan(0.05);
    expect(r.delayFrac).toBeGreaterThan(columns(r.delay) + 0.05);
    expect(r.primaryReason).toBe('RG-Cap');
  });

  it('batch delayed behind batch names another batch job, not an idle CICS region (playtest, daily 2026-11-03)', () => {
    let night = startDay(newRun(MIDWEST, content, 355298, 'NORMAL'), content);
    night = advance(night, MIDWEST, content, 16 * 360); // 22:00: the batch window, CICS quiet
    const rows = buildMon3(night, MIDWEST).rows.filter((r) => r.scKey === 'BATCHPRD#1' && r.system !== '*PLEX' && r.primaryDelay === 'PRC');
    expect(rows.length).toBeGreaterThan(0);
    const jobs = new Set(night.sim.batch.jobs.filter((j) => j.status === 'RUNNING').map((j) => j.def.name));
    for (const r of rows) expect(jobs.has(r.primaryReason ?? '')).toBe(true);
  }, 60_000);

  it('critical batch misrouted into the CICS region class is named, not the region (playtest, daily 2026-11-03)', () => {
    // The player meant TN STM* → BATCHHI and wrote STCHI: the STM fan then runs at the AORs' importance.
    let run = startDay(newRun(MIDWEST, content, 355298, 'NORMAL'), content);
    const def = run.sim.wlm.definition;
    const jes = def.subsystems.map((x) => (x.subsystem === 'JES' ? { ...x, rules: [{ qualifier: 'TN' as const, pattern: 'STM*', serviceClass: 'STCHI', reportClass: null, children: [] }, ...x.rules] } : x));
    run = { ...run, sim: { ...run.sim, wlm: { ...run.sim.wlm, definition: { ...def, subsystems: jes } } } };
    run = advance(run, MIDWEST, content, 18 * 360 + 90); // 00:15: the STM fan is CPU-delayed
    const stm = new Set(run.sim.batch.jobs.filter((j) => j.status === 'RUNNING' && j.def.name.startsWith('STM')).map((j) => j.lparId));
    expect(stm.size).toBeGreaterThan(0);
    const rows = buildMon3(run, MIDWEST).rows.filter((r) => r.scKey === 'STCHI#1' && stm.has(r.system) && r.primaryDelay === 'PRC');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.primaryReason).toMatch(/^STM/);
  }, 60_000);

  it('processor delay names the heaviest other user, not the resource', () => {
    const hot = advance({ ...noon, pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'ADHOC', value: 12 }] }, MIDWEST, content, 60);
    const rows = buildMon3(hot, MIDWEST).rows.filter((r) => r.primaryDelay === 'PRC');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.primaryReason).toMatch(/^(\*ENCLAVE|[A-Z@#$][A-Z0-9@#$]{0,7})$/);
      expect(r.primaryReason).not.toMatch(/^PRC/);
    }
  });
});

it('shows CICS transaction classes without resources of their own (RMF Report Analysis p.224)', () => {
  const onl = buildMon3(noon, MIDWEST).rows.find((r) => r.system === 'PROD1' && r.scKey === 'ONLHI#1')!;
  expect(onl.resourceSamples).toBe(false);
  expect(onl.cpuEngines).toBe(0);
  expect(onl.usingFrac + onl.delayFrac + onl.unknownFrac).toBe(0);
  expect(onl.pi).not.toBeNull();
});

it('shows N/A actual velocity for mixed classes with subsystem states, independent of region mode or goal', () => {
  const mixed = structuredClone(noon);
  mixed.sim.wlm.definition.classes.find((c) => c.id === 'ONLHI')!.periods[0]!.goal = { kind: 'VEL', velocity: 80 };
  for (const rule of mixed.sim.wlm.definition.subsystems.flatMap((s) => s.rules)) rule.regionMode = 'BOTH';
  const p = mixed.sim.wlm.systems.find((s) => s.lparId === 'PROD1')!.scps.find((p) => p.scKey === 'ONLHI#1')!;
  // Non-CICS members' samples: what WLM measured beyond the CICS transactions' moved part.
  p.acc = { ...p.acc, using: p.acc.using + 2, delay: p.acc.delay + 1, delayCpu: p.acc.delayCpu + 1, cpuEngines: p.acc.cpuEngines + 1 };
  const row = buildMon3(mixed, MIDWEST).rows.find((r) => r.system === 'PROD1' && r.scKey === 'ONLHI#1')!;
  expect(row.velocity).not.toBeNull(); // resource workflow of the non-CICS members is still meaningful
  expect(row.velocityAct).toBeNull(); // subsystem states replace the goal actual, RMF p.237
});

// SYSWKM (RMF Report Analysis p.204–207): the breakdown of a CICS transaction class and the AORs serving it.
describe('SYSWKM work manager delays', () => {
  it('lists each CICS class with its state breakdown and serving AORs', () => {
    const m = buildMon3(noon, MIDWEST);
    const onl = m.wkm!.find((w) => w.scKey === 'ONLHI#1')!;
    const s = onl.states;
    expect(s.active + s.ready + s.lock + s.io + s.prod + s.misc).toBeCloseTo(100);
    expect([s.idle, s.conv]).toEqual([null, null]);
    expect(onl.servers.map((x) => `${x.system}:${x.jobname}`)).toEqual(['PROD1:CICSAOR1', 'PROD1:CICSAOR3', 'PROD2:CICSAOR2', 'PROD2:CICSAOR4']);
    for (const x of onl.servers) {
      expect(x.mgmt).toBe('TRANSACTION');
      expect(x.rowKey).toBe('STCHI#1');
      expect(x.velocity).toBeGreaterThan(0);
      expect(x.procUsgPct).toBeGreaterThan(0);
    }
    // An AOR's service shares across the CICS classes it serves add up to 100 %.
    const aor1 = m.wkm!.flatMap((w) => w.servers.filter((x) => x.jobname === 'CICSAOR1'));
    expect(aor1.reduce((a, x) => a + x.servicePct, 0)).toBeCloseTo(100);
    // No other class is listed: only CICS transaction classes have work manager data.
    expect(m.wkm!.every((w) => m.rows.find((r) => r.system === '*PLEX' && r.scKey === w.scKey)?.workManager)).toBe(true);
  });
});

it('marks CICS transaction classes and their server class for SYSSUM (RMF Report Analysis p.237)', () => {
  const m = buildMon3(noon, MIDWEST);
  const onl = m.rows.find((r) => r.system === '*PLEX' && r.scKey === 'ONLHI#1')!;
  expect([onl.velocityAct, !!onl.workManager]).toEqual([null, true]);
  expect(m.wkm!.flatMap((w) => w.servers.filter((x) => x.mgmt === 'TRANSACTION').map((x) => x.serviceClass))).toContain('STCHI');
});

describe('Monitor III PROCU jobs (RMF Report Analysis p.188–189)', () => {
  it('lists jobs whose CPU adds up to the class rows, DDF enclaves on DIST as EAppl only', () => {
    const m = buildMon3(noon, MIDWEST);
    for (const s of m.systems) {
      const rows = m.rows.filter((r) => r.system === s.system).reduce((a, r) => a + r.cpuEngines, 0);
      const jobs = m.procJobs!.filter((j) => j.system === s.system);
      expect(jobs.reduce((a, j) => a + j.eapplCpEngines, 0)).toBeCloseTo(rows, 6);
      for (const j of jobs) expect(j.eapplCpEngines).toBeGreaterThanOrEqual(j.cpEngines - 1e-9);
    }
    const dist = m.procJobs!.find((j) => j.jobname.endsWith('DIST'))!;
    expect(dist.eapplCpEngines).toBeGreaterThan(dist.cpEngines);
    const sorted = m.procJobs!.map((j) => j.eapplCpEngines);
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a));
  });

  it('batch misrouted into the CICS region class shows by name under STCHI (playtest round 1)', () => {
    let run = startDay(newRun(MIDWEST, content, 355298, 'NORMAL'), content);
    const def = run.sim.wlm.definition;
    const jes = def.subsystems.map((x) => (x.subsystem === 'JES' ? { ...x, rules: [{ qualifier: 'TN' as const, pattern: 'STM*', serviceClass: 'STCHI', reportClass: null, children: [] }, ...x.rules] } : x));
    run = { ...run, sim: { ...run.sim, wlm: { ...run.sim.wlm, definition: { ...def, subsystems: jes } } } };
    run = advance(run, MIDWEST, content, 18 * 360);
    const stm = buildMon3(run, MIDWEST).procJobs!.filter((j) => j.jobname.startsWith('STM'));
    expect(stm.length).toBeGreaterThan(0);
    for (const j of stm) {
      expect(j.serviceClass).toBe('STCHI');
      expect(j.cx).toBe('B');
      expect(j.eapplCpEngines).toBeGreaterThan(0);
    }
  }, 60_000);
});
