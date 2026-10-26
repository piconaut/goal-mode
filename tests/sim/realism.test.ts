// Behavioural "realism" tests from SPEC §16.

import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_EVENTS } from '../../src/content/events/midwest-events';
import { initState } from '../../src/sim/core/init';
import { discretionaryCaps, rgMin, step, swapOut } from '../../src/sim/core/step';
import { emptyAcc } from '../../src/sim/wlm/runtime';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { classify } from '../../src/sim/wlm/classify';
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

describe('WLM caps (resource group maximum, discretionary goal management)', () => {
  it('capped transaction work queues and shows as CAP delay instead of vanishing', () => {
    const slices = [txn({ key: 'T', scKey: 'T#1', cpEngines: 1 })];
    const base = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, dpOf: () => 200 };
    const free = evaluateLpar(base).slices[0]!;
    const capped = evaluateLpar({ ...base, capOf: () => 0.6 }).slices[0]!;
    expect(capped.cpGranted).toBeCloseTo(0.6, 2);
    expect(capped.delayCap).toBeCloseTo(0.4, 2);
    expect(capped.newBacklog).toBeGreaterThan(free.newBacklog + 3);
  });

  it('caps over-achieving loose-goal work only while discretionary work waits', () => {
    const acc = (using: number, delay: number, cpuEngines: number) => ({ ...emptyAcc(), using, delay, cpuEngines });
    const sl = [server({ key: 'TSO2', scKey: 'TSO#2', cpEngines: 1 }), server({ key: 'ONL', scKey: 'ONLHI#1', cpEngines: 1 })];
    const tso2 = { scKey: 'TSO#2', dp: 200, starvedSec: 0, acc: acc(9, 1, 6) }; // velocity 90 vs goal 20: PI 0.22
    const disc = (waiting: boolean) => ({ scKey: 'DEVBAT#1', dp: 150, starvedSec: 0, acc: waiting ? acc(1, 9, 1) : acc(9, 1, 1) });
    expect(discretionaryCaps(BASEPOL, sl, [tso2, disc(false)])).toBeUndefined();
    const cap = discretionaryCaps(BASEPOL, sl, [tso2, disc(true), { scKey: 'ONLHI#1', dp: 240, starvedSec: 0, acc: acc(9, 1, 6) }])!;
    expect(cap(sl[0]!)).toBeCloseTo(0.5); // far below the 0.71–0.81 band: floor
    expect(cap(sl[1]!)).toBe(Infinity); // tight response-time goal: never capped
    // Near the band the cap is gentle: velocity 4/13 ≈ 30.8 vs goal 20 is PI 0.65 → 1 − (0.81 − 0.65).
    const near = discretionaryCaps(BASEPOL, sl, [{ ...tso2, acc: acc(4, 9, 6) }, disc(true)])!;
    expect(near(sl[0]!)).toBeCloseTo(0.84, 2);
    // PI 0.75 starts no cap, but a period already capped stays capped up to 0.81.
    const pi75 = acc(4, 11, 6); // velocity 26.7, PI 0.75
    expect(discretionaryCaps(BASEPOL, sl, [{ ...tso2, acc: pi75 }, disc(true)])).toBeUndefined();
    const wasCapped = discretionaryCaps(BASEPOL, sl, [{ ...tso2, acc: { ...pi75, delayCap: 2 } }, disc(true)])!;
    expect(wasCapped(sl[0]!)).toBeCloseTo(0.94, 2);
    // Small consumers are left alone.
    expect(discretionaryCaps(BASEPOL, sl, [{ ...tso2, acc: acc(9, 1, 0.1) }, disc(true)])).toBeUndefined();
  });
});

describe('WLM I/O priority management', () => {
  const io = { RANDOM: { rtSec: 0.004, delaySec: 0.0025, iosqSec: 0.002 }, SEQ: IO.SEQ };
  const slices = [txn({ key: 'HI', scKey: 'HI#1', cpEngines: 0.5, ioPerTxn: 5 }), txn({ key: 'LO', scKey: 'LO#1', cpEngines: 0.5, ioPerTxn: 5 })];
  const base = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io, pagingFrac: 0, dpOf: (k: string) => (k === 'HI#1' ? 240 : 200) };
  it('orders the IOSQ by dispatching priority without changing the mean', () => {
    const r = evaluateLpar(base).slices;
    const perIo = (x: (typeof r)[number]) => x.delayIo / (100 * 5);
    expect(perIo(r[0]!)).toBeLessThan(perIo(r[1]!));
    expect((perIo(r[0]!) + perIo(r[1]!)) / 2).toBeCloseTo(io.RANDOM.delaySec, 6);
  });
  it('when off, IOSQ is first come first served and I/O samples leave velocity', () => {
    const r = evaluateLpar({ ...base, ioPriority: false }).slices;
    expect(r[0]!.parts!.io).toBeCloseTo(r[1]!.parts!.io, 9);
    expect(r[0]!.usingIo + r[0]!.delayIo).toBe(0);
  });
  it('counts only device connect as I/O using: disconnect is neither using nor delay', () => {
    const withConn = { ...io, RANDOM: { ...io.RANDOM, connSec: 0.0005 } };
    const r = evaluateLpar({ ...base, io: withConn }).slices[0]!;
    expect(r.usingIo).toBeCloseTo(100 * 5 * 0.0005, 9);
    expect(r.usingIo + r.delayIo).toBeLessThan(100 * 5 * io.RANDOM.rtSec);
  });
});

describe('MQ queue depth (PAYMQ)', () => {
  const base = { cpCapacityEngines: 1, cpServers: 1, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, backlog: { M: 500, T: 500 }, io: IO, pagingFrac: 0, dpOf: () => 200 };
  it('starved messages queue instead of timing out; puts fail only past MAXDEPTH', () => {
    const online = evaluateLpar({ ...base, slices: [txn({ key: 'T', cpEngines: 2, timeoutSec: 30 })] }).slices[0]!;
    const mq = evaluateLpar({ ...base, slices: [txn({ key: 'M', cpEngines: 2, timeoutSec: Infinity, maxQueueMsgs: 1e6 })] }).slices[0]!;
    const full = evaluateLpar({ ...base, slices: [txn({ key: 'M', cpEngines: 2, timeoutSec: Infinity, maxQueueMsgs: 1000 })] }).slices[0]!;
    expect(online.failed).toBeGreaterThan(0);
    expect(mq.failed).toBe(0);
    expect(mq.newBacklog).toBeGreaterThan(online.newBacklog);
    expect(full.failed).toBeGreaterThan(0);
    expect(full.newBacklog).toBeCloseTo(1000 * 0.01, 6);
  });
});

describe('MPL / swap (storage overcommit)', () => {
  const job = (name: string, jobClass: string, startTick: number) =>
    ({
      day: 0,
      def: { name, stream: 'X', jobClass, sysaff: null, cpuSecRef: 1, ziipFrac: 0, ioCount: 1, lockIntensity: 0, usesDb2: false, preds: [], earliestSec: 0, critical: false, deadlineSec: 86400 },
      status: 'RUNNING',
      lparId: 'DEVT',
      progress: 0,
      queuedTick: 0,
      startTick,
      endTick: null,
      stretch: 1,
    }) as Parameters<typeof swapOut>[1][number];
  // Class D → DEVBAT (discretionary), class A → BATCHPRD (importance 4).
  const jobs = [job('PRD001', 'A', 10), job('DEV001', 'D', 5), job('DEV002', 'D', 20), job('PRD002', 'A', 30)];
  it('swaps nothing while real memory holds the work', () => {
    expect(swapOut(BASEPOL, jobs, 'DEVT', 20, 2, 40).size).toBe(0);
  });
  it('swaps the least important, latest-started jobs first until demand fits', () => {
    // 20 GB fixed + 4 × 2 GB = 28 GB on a 24 GB LPAR: down to ≤ 23.3 GB takes three swaps,
    // discretionary first, then the latest-started importance-4 job.
    const out = [...swapOut(BASEPOL, jobs, 'DEVT', 20, 2, 24)].map((j) => j.def.name);
    expect(out).toEqual(['DEV002', 'DEV001', 'PRD002']);
  });
  it('keeps a minimum MPL in when fixed demand alone overcommits memory', () => {
    // 30 GB fixed on a 24 GB LPAR: swapping every job could never fit, and would freeze batch for the night.
    const out = swapOut(BASEPOL, jobs, 'DEVT', 30, 2, 24);
    expect(out.size).toBe(jobs.length - 1);
    expect(jobs.filter((j) => !out.has(j)).map((j) => j.def.name)).toEqual(['PRD001']);
  });
});

describe('CF failure, rebuild and duplexing', () => {
  let base = initState(42, MIDWEST);
  beforeAll(() => {
    for (let i = 0; i < 6 * 360; i++) base = step(base, [], MIDWEST);
  });
  const rbankCfMs = (s: typeof base) => {
    const w = s.last.workloads.find((x) => x.id === 'RBANK')!;
    return w.completions > 0 ? (1000 * (w.parts.cf ?? 0)) / w.completions : 0;
  };
  const run = (cmds: Parameters<typeof step>[1], ticks = 30) => {
    let s = step(base, cmds, MIDWEST);
    for (let i = 0; i < ticks; i++) s = step(s, [], MIDWEST);
    return s;
  };
  it('a failed CF rebuilds its structures into the surviving CF on the preference list', () => {
    const s = run([{ kind: 'FAIL_CF', lparId: 'CF01', failed: true }]);
    expect(s.config.cfStructures.every((x) => x.cfLparId === 'CF02' && !x.lost)).toBe(true);
    expect(s.env.cf.map((c) => c.lparId)).not.toContain('CF01');
    // Everything on the weak shared CF: Db2 work waits longer for the CF.
    expect(rbankCfMs(s)).toBeGreaterThan(2 * rbankCfMs(run([])));
  }, 60_000);
  it('with no white space a structure is lost and Db2 work fails until the CF returns', () => {
    const tight = run([{ kind: 'SET_LPAR_MEMORY', lparId: 'CF02', memoryGb: 20 }, { kind: 'FAIL_CF', lparId: 'CF01', failed: true }], 6);
    const gbp1 = tight.config.cfStructures.find((x) => x.name === 'DB1G_GBP1')!;
    expect(gbp1.lost).toBe(true);
    expect(tight.config.cfStructures.find((x) => x.name === 'DB1G_LOCK1')!.cfLparId).toBe('CF02');
    const during = tight.last.workloads.find((x) => x.id === 'RBANK')!;
    expect(during.failed).toBeGreaterThan(0);
    // CF01 is back: the lost GBP is reallocated there. The lock structure stays on the slow shared CF02
    // until moved; with it moved back, the retry storm drains within minutes.
    let back = step(tight, [{ kind: 'FAIL_CF', lparId: 'CF01', failed: false }, { kind: 'MOVE_STRUCTURE', name: 'DB1G_LOCK1', cfLparId: 'CF01' }], MIDWEST);
    expect(back.config.cfStructures.find((x) => x.name === 'DB1G_GBP1')!).toMatchObject({ lost: false, cfLparId: 'CF01' });
    for (let i = 0; i < 60; i++) back = step(back, [], MIDWEST);
    const after = back.last.workloads.find((x) => x.id === 'RBANK')!;
    expect(after.completions).toBeGreaterThan(0);
    expect(after.failed).toBe(0);
  }, 60_000);
  it('a duplexed structure switches to its copy with no rebuild, but duplexing costs sync time', () => {
    const duplexed = run([{ kind: 'SET_DUPLEX', name: 'DB1G_LOCK1', on: true }]);
    expect(duplexed.config.cfStructures.find((x) => x.name === 'DB1G_LOCK1')!.duplexed).toBe(true);
    expect(rbankCfMs(duplexed)).toBeGreaterThan(rbankCfMs(run([])));
    const failed = step(duplexed, [{ kind: 'FAIL_CF', lparId: 'CF01', failed: true }], MIDWEST);
    const lock = failed.config.cfStructures.find((x) => x.name === 'DB1G_LOCK1')!;
    expect(lock).toMatchObject({ cfLparId: 'CF02', duplexed: false });
    expect(lock.rebuildUntilTick).toBeUndefined();
  }, 60_000);
});

describe('CICS region management', () => {
  // Online work in two classes plus batch competing for 2 engines.
  const slices = [
    txn({ key: 'HI', scKey: 'ONLHI#1', cpEngines: 1 }),
    txn({ key: 'MED', scKey: 'ONLMED#1', cpEngines: 1 }),
    txn({ key: 'BAT', scKey: 'BAT#1', cpEngines: 1.5 }),
  ];
  const dps: Record<string, number> = { 'ONLHI#1': 250, 'ONLMED#1': 200, 'BAT#1': 220, 'STCHI#1': 240 };
  const base = { cpCapacityEngines: 2, cpServers: 2, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, dpOf: (k: string) => dps[k]! };
  const med = (r: ReturnType<typeof evaluateLpar>) => r.slices[1]!.cpGranted;
  it('TRANSACTION mode: less important CICS work rides free at the region DP set by the most important class', () => {
    const own = evaluateLpar(base);
    const free = evaluateLpar({ ...base, regions: { keys: ['ONLHI#1', 'ONLMED#1'], mode: 'TRANSACTION', regionKey: 'STCHI#1' } });
    expect(med(own)).toBeLessThan(0.2); // below batch on its own DP
    expect(med(free)).toBeGreaterThan(0.4); // shares the region's DP with ONLHI, ahead of batch
  });
  it('REGION mode: all CICS work runs at the region class DP', () => {
    const region = evaluateLpar({ ...base, dpOf: (k) => ({ ...dps, 'STCHI#1': 210 })[k]!, regions: { keys: ['ONLHI#1', 'ONLMED#1'], mode: 'REGION', regionKey: 'STCHI#1' } });
    // Region class below batch: even ONLHI waits behind batch.
    expect(region.slices[0]!.cpGranted).toBeLessThan(evaluateLpar(base).slices[0]!.cpGranted);
  });
});

describe('event cards (SPEC §9)', () => {
  // 10:00 on day 0, then 30 minutes with and without the card's begin commands.
  let base = initState(42, MIDWEST);
  beforeAll(() => {
    for (let i = 0; i < 4 * 360; i++) base = step(base, [], MIDWEST);
  });
  const run = (cmds: Parameters<typeof step>[1]) => {
    let s = step(base, cmds, MIDWEST);
    let qr = 0;
    let n = 0;
    let devtMsu = 0;
    let mobRt = 0;
    let mobN = 0;
    let bookingDone = 0;
    for (let i = 0; i < 180; i++) {
      s = step(s, [], MIDWEST);
      const m = s.last.workloads.find((x) => x.id === 'MOBILE')!;
      mobRt += m.rtSumSec;
      mobN += m.completions;
      const w = s.last.workloads.find((x) => x.id === 'TELLER')!;
      qr += w.parts.qr ?? 0;
      n += w.completions;
      bookingDone += s.last.workloads.find((x) => x.id === 'BOOKING')?.completions ?? 0;
      devtMsu += s.lpars.find((l) => l.id === 'DEVT')!.msuRate / 180;
    }
    return { qrMsPerTxn: (1000 * qr) / Math.max(1, n), devtMsu, mobileRtMs: (1000 * mobRt) / Math.max(1, mobN), bookingDone };
  };
  const card = (id: string) => MIDWEST_EVENTS.find((e) => e.id === id)!.begin;

  it('shadow IT on TSO lifts DEVT MSU and slows mobile on PROD', () => {
    const asIs = run([]);
    const shadow = run(card('SHADOW_IT'));
    expect(shadow.devtMsu).toBeGreaterThan(1.2 * asIs.devtMsu);
    expect(shadow.mobileRtMs).toBeGreaterThan(asIs.mobileRtMs);
  }, 60_000);

  it('a non-threadsafe release raises QR wait for teller transactions', () => {
    expect(run(card('QR_RELEASE')).qrMsPerTxn).toBeGreaterThan(2 * run([]).qrMsPerTxn);
  }, 60_000);

  it('a power cap (lower capacity setting, same engines) slows mobile on PROD', () => {
    // POWER_CAP drops one setting from wherever the CPC is (resolved in the game layer; see run tests).
    expect(run([{ kind: 'SET_CPC_CAPACITY', cpcId: 'CPCA', capacitySetting: 5 }]).mobileRtMs).toBeGreaterThan(run([]).mobileRtMs);
  }, 60_000);

  it('a new booking app has no rule so it lands in SYSOTHER, yet it runs', () => {
    const begin = card('NEW_APP_GOLIVE');
    const wl = begin[0]!.kind === 'ADD_WORKLOAD' ? begin[0]!.workload : null;
    expect(wl && classify(BASEPOL, wl.work).serviceClass).toBe('SYSOTHER');
    expect(run(begin).bookingDone).toBeGreaterThan(0);
  }, 60_000);

  it('CICS short on storage in the PROD2 AORs queues work for task slots (MXT wait), not CPU', () => {
    const outside = (cmds: Parameters<typeof step>[1]) => {
      let s = step(base, cmds, MIDWEST);
      let out = 0;
      let n = 0;
      for (let i = 0; i < 180; i++) {
        s = step(s, [], MIDWEST);
        const w = s.last.workloads.find((x) => x.id === 'TELLER')!;
        out += w.parts.outside ?? 0;
        n += w.completions;
      }
      return (1000 * out) / Math.max(1, n);
    };
    expect(outside([])).toBe(0);
    expect(outside(card('CICS_SOS'))).toBeGreaterThan(5);
  }, 60_000);

  it('stored procedures losing zIIP eligibility move mobile CPU from zIIPs to general CPs', () => {
    const pools = (cmds: Parameters<typeof step>[1]) => {
      let s = step(base, cmds, MIDWEST);
      for (let i = 0; i < 30; i++) s = step(s, [], MIDWEST);
      const sc = s.last.lpars.find((l) => l.lparId === 'PROD1')!.scps.find((x) => x.scKey === 'DDFPRD#1')!;
      return { cp: sc.cpEngines, ziip: sc.ziipEngines };
    };
    const asIs = pools([]);
    const lost = pools(card('ZIIP_LOSS'));
    expect(lost.ziip).toBeLessThan(0.5 * asIs.ziip);
    expect(lost.cp).toBeGreaterThan(asIs.cp);
  }, 60_000);

  it('a retry storm multiplies mobile arrivals at unchanged CPU per transaction, unlike bot traffic', () => {
    const perTxn = (cmds: Parameters<typeof step>[1]) => {
      let s = step(base, cmds, MIDWEST);
      let rate = 0;
      let eng = 0;
      for (let i = 0; i < 30; i++) {
        s = step(s, [], MIDWEST);
        rate += s.last.workloads.find((x) => x.id === 'MOBILE')!.arrivalRate;
        for (const l of s.last.lpars) for (const sc of l.scps) if (sc.scKey === 'DDFPRD#1') eng += sc.cpEngines + sc.ziipEngines;
      }
      return { rate, engPerTxn: eng / rate };
    };
    const asIs = perTxn([]);
    const retry = perTxn(card('RETRY_STORM'));
    const bots = perTxn(card('BOT_ATTACK'));
    expect(retry.rate).toBeGreaterThan(2 * asIs.rate);
    expect(retry.engPerTxn).toBeGreaterThan(0.8 * asIs.engPerTxn);
    expect(bots.engPerTxn).toBeLessThan(0.7 * asIs.engPerTxn);
  }, 60_000);

  it('an encryption mandate raises CPU per transaction on the I/O-heavy online work only', () => {
    // ONLMED holds teller and payments (both encrypted); DDFPRD holds mobile and BI (neither).
    const perTxn = (cmds: Parameters<typeof step>[1], scKey: string) => {
      let s = step(base, cmds, MIDWEST);
      let eng = 0;
      let n = 0;
      for (let i = 0; i < 30; i++) {
        s = step(s, [], MIDWEST);
        for (const l of s.last.lpars) for (const sc of l.scps) if (sc.scKey === scKey) { eng += sc.cpEngines + sc.ziipEngines; n += sc.completions; }
      }
      return eng / n;
    };
    const enc = card('ENCRYPTION_MANDATE');
    const med = perTxn(enc, 'ONLMED#1') / perTxn([], 'ONLMED#1');
    const ddf = perTxn(enc, 'DDFPRD#1') / perTxn([], 'DDFPRD#1');
    expect(med).toBeGreaterThan(1.03);
    expect(med).toBeLessThan(1.09);
    expect(Math.abs(ddf - 1)).toBeLessThan(0.01);
  }, 60_000);

  it('a looping STC caught by the CICS* rule takes an engine at importance 1 until reclassified', () => {
    const prod1 = (cmds: Parameters<typeof step>[1]) => {
      let s = step(base, cmds, MIDWEST);
      let stchi = 0;
      let lowerDelay = 0;
      for (let i = 0; i < 30; i++) {
        s = step(s, [], MIDWEST);
        for (const sc of s.last.lpars.find((l) => l.lparId === 'PROD1')!.scps) {
          if (sc.scKey === 'STCHI#1') stchi += sc.cpEngines / 30;
          else if (!sc.scKey.startsWith('SYS')) lowerDelay += sc.delayCpu;
        }
      }
      return { stchi, lowerDelay };
    };
    const reclassified = structuredClone(BASEPOL);
    reclassified.subsystems.find((x) => x.subsystem === 'STC')!.rules.unshift({ qualifier: 'TN', pattern: 'CICSXLOG', serviceClass: 'STCLO', reportClass: null, children: [] });
    const asIs = prod1([]);
    const loop = prod1(card('XLOG_LOOP'));
    const fixed = prod1([...card('XLOG_LOOP'), { kind: 'ACTIVATE_POLICY', definition: reclassified }]);
    expect(loop.stchi).toBeGreaterThan(asIs.stchi + 0.6);
    expect(loop.lowerDelay).toBeGreaterThan(asIs.lowerDelay);
    expect(fixed.stchi).toBeLessThan(asIs.stchi + 0.1);
  }, 60_000);

  it('an SMF retention audit raises SMF address space CPU and total MSU but no workload response', () => {
    const asIs = run([]);
    const audit = run(card('SMF_AUDIT'));
    const msu = (cmds: Parameters<typeof step>[1]) => {
      let s = step(base, cmds, MIDWEST);
      let m = 0;
      for (let i = 0; i < 30; i++) {
        s = step(s, [], MIDWEST);
        m += s.lpars.reduce((a, l) => a + l.msuRate, 0) / 30;
      }
      return m;
    };
    expect(msu(card('SMF_AUDIT'))).toBeGreaterThan(1.03 * msu([]));
    expect(audit.mobileRtMs).toBeLessThan(1.05 * asIs.mobileRtMs);
  }, 60_000);

  it('an HSM recall storm raises LCU 30 IOSQ and response time', () => {
    const lcu30 = (cmds: Parameters<typeof step>[1]) => {
      let s = step(base, cmds, MIDWEST);
      let iosq = 0;
      let rt = 0;
      for (let i = 0; i < 180; i++) {
        s = step(s, [], MIDWEST);
        const l = s.env.dasd?.lcus.find((x) => x.id === '30');
        iosq += (l?.iosqSec ?? 0) / 180;
        rt += (l?.rtSec ?? 0) / 180;
      }
      return { iosq, rt };
    };
    const asIs = lcu30([]);
    const storm = lcu30(card('HSM_RECALL_STORM'));
    expect(storm.rt).toBeGreaterThan(1.8 * asIs.rt);
    expect(storm.iosq).toBeGreaterThan(100 * asIs.iosq);
  }, 60_000);
});
