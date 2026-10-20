// Behavioural "realism" tests from SPEC §16.

import { MIDWEST } from '../../src/content/scenarios';
import { initState } from '../../src/sim/core/init';
import { rgMin, step } from '../../src/sim/core/step';
import { emptyAcc } from '../../src/sim/wlm/runtime';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { renderWlmSummary } from '../../src/sim/measure/reports';
import { evaluateLpar, type SliceSpec } from '../../src/sim/wlm/evaluate';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };

const txn = (over: Partial<SliceSpec>): SliceSpec => ({
  key: 'T',
  scKey: 'ONL#1',
  kind: 'TXN',
  workloadId: 'W',
  jobname: null,
  role: null,
  rate: 100,
  cpEngines: 1,
  ziipEngines: 0,
  mayOverflow: true,
  cpuSecPerTxn: 0.01,
  ziipSecPerTxn: 0,
  ioPerTxn: 0,
  baseLatencySec: 0.01,
  rtSigma: 0.5,
  timeoutSec: 30,
  servers: [],
  goalRtSec: 0.25,
  slaRtSec: 0.25,
  ioClass: 'RANDOM',
  ioRate: 0,
  extraOtherSec: 0,
  failFrac: 0,
  outsideWaitSec: 0,
  ...over,
});
const server = (over: Partial<SliceSpec>): SliceSpec => ({ ...txn({}), kind: 'AS', rate: 0, workloadId: null, goalRtSec: null, slaRtSec: null, ...over });

describe('priority inversion through dependencies', () => {
  const slices = [
    txn({ key: 'DDF', scKey: 'DDF#1', cpEngines: 2.5, servers: [{ role: 'DB2.DBM1', latencySec: 0.012 }] }),
    server({ key: 'DBM1', scKey: 'DB2#1', role: 'DB2.DBM1', cpEngines: 0.2 }),
    txn({ key: 'BATCH', scKey: 'BAT#1', cpEngines: 2, servers: [] }),
  ];
  const base = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };

  it('starving the Db2 address space slows DDF without showing as DDF CPU delay', () => {
    const good = evaluateLpar({ ...base, dpOf: (k) => ({ 'DDF#1': 240, 'DB2#1': 250, 'BAT#1': 220 })[k]! });
    const bad = evaluateLpar({ ...base, dpOf: (k) => ({ 'DDF#1': 240, 'DB2#1': 210, 'BAT#1': 220 })[k]! });
    const g = good.slices[0]!;
    const b = bad.slices[0]!;
    expect(b.rtMeanSec).toBeGreaterThan(3 * g.rtMeanSec);
    // DDF's own CPU delay does not rise (it even falls: Db2 no longer runs above it);
    // the damage shows up as "other" delay that WLM cannot fix.
    expect(b.delayCpu).toBeLessThanOrEqual(g.delayCpu + 1e-9);
    expect(b.delayOther).toBeGreaterThan(10 * g.delayOther + 1e-9);
  });
});

describe('importance ordering under contention', () => {
  it('higher-DP work is served first', () => {
    const slices = [txn({ key: 'A', scKey: 'A#1', cpEngines: 3 }), txn({ key: 'B', scKey: 'B#1', cpEngines: 3 })];
    const r = evaluateLpar({
      cpCapacityEngines: 4,
      cpServers: 4,
      ziipCapacityEngines: 0,
      ziipServers: 0,
      cpPrsmDelayFrac: 0,
      slices,
      backlog: {},
      io: IO,
      pagingFrac: 0,
      dpOf: (k) => (k === 'A#1' ? 248 : 230),
    });
    expect(r.slices[0]!.cpGranted).toBeCloseTo(3);
    expect(r.slices[1]!.cpGranted).toBeCloseTo(1);
    expect(r.slices[1]!.newBacklog).toBeGreaterThan(0);
  });
});

describe('zIIP offload flaw F7', () => {
  it('DDF on PROD2 (no zIIPs) burns CP as IIPCP, PROD1 uses zIIPs', () => {
    let s = initState(3, MIDWEST);
    for (let i = 0; i < 6 * 360; i++) s = step(s, [], MIDWEST); // to midday
    const ddf = (lpar: string) => s.last.lpars.find((l) => l.lparId === lpar)!.scps.find((x) => x.scKey === 'DDFPRD#1')!;
    expect(ddf('PROD1').ziipEngines).toBeGreaterThan(0);
    expect(ddf('PROD2').ziipEngines).toBe(0);
    expect(ddf('PROD2').iipcpEngines).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('same seed gives identical state', () => {
    let a = initState(11, MIDWEST);
    let b = initState(11, MIDWEST);
    for (let i = 0; i < 400; i++) {
      a = step(a, [], MIDWEST);
      b = step(b, [], MIDWEST);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('CF structure placement', () => {
  // Midday state once, then three placements for 30 minutes each.
  let base = initState(42, MIDWEST);
  beforeAll(() => {
    for (let i = 0; i < 6 * 360; i++) base = step(base, [], MIDWEST);
  });
  const run = (cmds: Parameters<typeof step>[1]) => {
    let s = step(base, cmds, MIDWEST);
    let cfPart = 0;
    let n = 0;
    for (let i = 0; i < 180; i++) {
      s = step(s, [], MIDWEST);
      const w = s.last.workloads.find((x) => x.id === 'RBANK')!;
      if (w.completions > 0) {
        cfPart += (w.parts.cf ?? 0) / w.completions;
        n++;
      }
    }
    return { cfMsPerTxn: (1000 * cfPart) / Math.max(1, n), lpar: s.lpars.find((l) => l.id === 'PROD1')!.pools.find((p) => p.pool === 'CP')!.deliveredEngines };
  };
  it('a lock structure on the weak shared CF hurts every Db2 transaction; moving GBP0 off it helps', () => {
    const asIs = run([]);
    const lockOnCf02 = run([{ kind: 'MOVE_STRUCTURE', name: 'DB1G_LOCK1', cfLparId: 'CF02' }]);
    const gbp0OnCf01 = run([{ kind: 'MOVE_STRUCTURE', name: 'DB1G_GBP0', cfLparId: 'CF01' }]);
    expect(lockOnCf02.cfMsPerTxn).toBeGreaterThan(2 * asIs.cfMsPerTxn);
    // Synchronous lock requests spin the z/OS CP for the whole (slow) service time.
    expect(lockOnCf02.lpar).toBeGreaterThan(asIs.lpar);
    expect(gbp0OnCf01.cfMsPerTxn).toBeLessThan(asIs.cfMsPerTxn);
  }, 60_000);
});

describe('project modifiers', () => {
  it('efficiency lowers CPU; zIIP shift moves MOBILE work from CPs to zIIPs', () => {
    let base = initState(42, MIDWEST);
    for (let i = 0; i < 6 * 360; i++) base = step(base, [], MIDWEST);
    const run = (cmds: Parameters<typeof step>[1]) => {
      let s = step(base, cmds, MIDWEST);
      for (let i = 0; i < 30; i++) s = step(s, [], MIDWEST);
      const pool = (id: string, p: string) => s.lpars.find((l) => l.id === id)!.pools.find((x) => x.pool === p)?.deliveredEngines ?? 0;
      return { cp: pool('PROD1', 'CP') + pool('PROD2', 'CP'), ziip: pool('PROD1', 'ZIIP') };
    };
    const asIs = run([]);
    const tuned = run([{ kind: 'SET_MODIFIER', mod: 'efficiency', key: 'RBANK', value: 0.7 }]);
    const shifted = run([{ kind: 'SET_MODIFIER', mod: 'ziipShift', key: 'MOBILE', value: 0.5 }]);
    expect(tuned.cp).toBeLessThan(asIs.cp);
    expect(shifted.ziip).toBeGreaterThan(asIs.ziip);
  }, 60_000);
});

describe('report classes (F6)', () => {
  it('split mixed work for reporting without changing how WLM manages it', () => {
    let base = initState(42, MIDWEST);
    for (let i = 0; i < 6 * 360; i++) base = step(base, [], MIDWEST);
    const policy = (withRc: boolean) => {
      const d = structuredClone(BASEPOL);
      d.policyName = 'RCPOL';
      const ddf = d.subsystems.find((x) => x.subsystem === 'DDF')!;
      ddf.rules = [
        { qualifier: 'UI', pattern: 'MOBAPI', serviceClass: 'DDFPRD', reportClass: withRc ? 'RMOBILE' : null, children: [] },
        { qualifier: 'UI', pattern: 'BIUSER', serviceClass: 'DDFPRD', reportClass: withRc ? 'RADHOC' : null, children: [] },
      ];
      if (withRc) d.reportClasses = ['RADHOC', 'RMOBILE'];
      return d;
    };
    const run = (withRc: boolean) => {
      let s = step(base, [{ kind: 'ACTIVATE_POLICY', definition: policy(withRc) }], MIDWEST);
      const n = s.rmf.intervals.length;
      while (s.rmf.intervals.length === n) s = step(s, [], MIDWEST);
      return s;
    };
    const plain = run(false);
    const rc = run(true);
    expect(rc.lpars).toEqual(plain.lpars);
    expect(plain.rmf.intervals.at(-1)!.wlmRc).toBeUndefined();
    const rows = rc.rmf.intervals.at(-1)!.wlmRc!.filter((r) => r.lparId === '*PLEX');
    const mob = rows.find((r) => r.serviceClass === 'RMOBILE')!;
    const adhoc = rows.find((r) => r.serviceClass === 'RADHOC')!;
    expect(mob.members).toContain('DDFPRD#1');
    expect(mob.avgRtSec!).toBeLessThan(adhoc.avgRtSec!);
    const ddf1 = rc.rmf.intervals.at(-1)!.wlm.find((r) => r.lparId === '*PLEX' && r.scKey === 'DDFPRD#1')!;
    // Every DDF transaction is in one of the two report classes.
    expect(mob.ended + adhoc.ended).toBeGreaterThanOrEqual(ddf1.ended - 1e-6);
    // Long ad-hoc queries cross into period 2: one service class, two periods, so no single goal or PI.
    if (adhoc.members!.length > 1) expect([adhoc.pi, adhoc.goalText]).toEqual([null, 'DDFPRD 2 PERIODS']);
    else expect(adhoc.pi).not.toBeNull();
    expect(renderWlmSummary(rc.rmf.intervals.at(-1)!)).toMatch(/REPORT CLASSES[\s\S]*RMOBILE/);
  }, 60_000);
});

describe('resource group minimum', () => {
  const slices = [txn({ key: 'HI', scKey: 'HI#1', cpEngines: 4 }), txn({ key: 'LO', scKey: 'LO#1', cpEngines: 2 })];
  const base = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, dpOf: (k: string) => (k === 'HI#1' ? 240 : 200) };
  it('guarantees the minimum ahead of more important work', () => {
    const without = evaluateLpar(base);
    const withMin = evaluateLpar({ ...base, minOf: { 'LO#1': 1.5 } });
    expect(without.slices[1]!.cpGranted).toBeLessThan(0.2);
    expect(withMin.slices[1]!.cpGranted).toBeCloseTo(1.5, 1);
    expect(withMin.slices[0]!.cpGranted).toBeLessThan(without.slices[0]!.cpGranted - 1);
  });

  it('is honoured only while the group misses its goals', () => {
    const d = structuredClone(BASEPOL);
    d.resourceGroups = [{ id: 'RGSTC', type: 3, min: 150, max: null }];
    d.classes.find((c) => c.id === 'STCMED')!.resourceGroup = 'RGSTC';
    const sl = [server({ key: 'DBM1', scKey: 'STCMED#1', cpEngines: 0.6 }), server({ key: 'X', scKey: 'STCLO#1', cpEngines: 1 })];
    const st = (using: number, delay: number) => [{ scKey: 'STCMED#1', dp: 230, starvedSec: 0, acc: { ...emptyAcc(), using, delay } }];
    // Velocity goal 40: 90% using is happy, 10% using is missing.
    expect(rgMin(d, sl, st(9, 1), undefined, 1000)).toEqual({});
    expect(rgMin(d, sl, st(1, 9), undefined, 1000).minOf).toEqual({ 'STCMED#1': 1.5 });
    expect(rgMin(BASEPOL, sl, st(1, 9), undefined, 1000)).toEqual({});
  });
});
