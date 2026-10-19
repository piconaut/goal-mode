// Behavioural "realism" tests from SPEC §16.

import { MIDWEST } from '../../src/content/scenarios';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
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
