import { describe, expect, it } from 'vitest';
import { evaluateLpar, sliceSpec, type LparEvalInput } from '../../src/sim/wlm/evaluate';
import { decayInto, emptyAcc, sumAcc } from '../../src/sim/wlm/runtime';

const input = (over: Partial<LparEvalInput> = {}): LparEvalInput => ({
  cpCapacityEngines: 1, cpServers: 1, ziipCapacityEngines: 0, ziipServers: 0,
  cpPrsmDelayFrac: 0, pagingFrac: 0, backlog: {}, dpOf: () => 240,
  io: { RANDOM: { rtSec: 0.002, delaySec: 0.001 }, SEQ: { rtSec: 0.002, delaySec: 0.001 } },
  slices: [
    sliceSpec({ key: 'CICS', scKey: 'ONL#1', kind: 'TXN', rate: 100, cpEngines: 2, cpuSecPerTxn: 0.02, ioPerTxn: 1, baseLatencySec: 0.01, goalRtSec: 0.25, reportClass: 'CICSR' }),
    sliceSpec({ key: 'DDF', scKey: 'ONL#1', kind: 'TXN', rate: 10, cpEngines: 0.1, cpuSecPerTxn: 0.01, reportClass: 'DDFR' }),
    sliceSpec({ key: 'AOR1', scKey: 'REG1#1', kind: 'AS', role: 'CICS.AOR', cpEngines: 0.1, reportClass: 'REGR' }),
    sliceSpec({ key: 'AOR2', scKey: 'REG2#1', kind: 'AS', role: 'CICS.AOR', cpEngines: 0.1 }),
  ],
  regions: { keys: ['ONL#1'], transactionKeys: ['CICS'], mode: 'TRANSACTION', regionKey: 'REG1#1', servers: ['AOR1', 'AOR2'] },
  ...over,
});

describe('CICS reporting accounting', () => {
  it('keeps WLM management identical to projections and conserves resource accounting across AOR classes', () => {
    const i = input(), r = evaluateLpar(i);
    expect(r.scps).toEqual(evaluateLpar({ ...i, scpsOnly: true }).scps);
    const sum = (rows: typeof r.scps, k: 'cpEngines' | 'usingCpu' | 'delayCpu' | 'usingIo' | 'delayIo') => rows.reduce((a, t) => a + t[k], 0);
    for (const k of ['cpEngines', 'usingCpu', 'delayCpu', 'usingIo', 'delayIo'] as const)
      expect(sum(r.reportedScps!, k)).toBeCloseTo(sum(r.scps, k), 12);
    const onl = r.reportedScps!.find((t) => t.scKey === 'ONL#1')!;
    const ddf = r.slices.find((s) => s.key === 'DDF')!;
    expect(onl.usingCpu).toBe(ddf.usingCpu);
    expect(onl.resourceSamples).toBe(true); // mixed CICS + DDF
    expect(onl.workManager?.active).toBeGreaterThan(0);
    expect(onl.workManager?.regionKeys).toEqual(['REG1#1', 'REG2#1']);
    expect(onl.completions).toBe(r.scps.find((t) => t.scKey === 'ONL#1')!.completions);
    const rc = r.rcs!.find((t) => t.scKey === 'CICSR')!;
    expect(rc.cpEngines).toBe(0);
    expect(rc.resourceSamples).toBe(false);
    expect(rc.workManager?.ready).toBe(0); // z/OS CPU shortage is not a CICS dispatcher wait
    expect(r.rcs!.find((t) => t.scKey === 'DDFR')!.usingCpu).toBe(ddf.usingCpu);
    expect(r.rcs!.find((t) => t.scKey === 'REGR')!.cpEngines).toBeGreaterThan(0);
  });

  it('suppresses resource samples for pure CICS rows and respects I/O priority off', () => {
    const i = input();
    const r = evaluateLpar({ ...i, slices: i.slices.filter((s) => s.key !== 'DDF'), ioPriority: false });
    const onl = r.reportedScps!.find((t) => t.scKey === 'ONL#1')!;
    expect(onl.resourceSamples).toBe(false);
    expect(onl.usingCpu + onl.delayCpu + onl.cpEngines).toBe(0);
    for (const t of r.reportedScps!) {
      expect(t.usingIoNoVel).toBe(t.usingIo);
      expect(t.delayIoNoVel).toBe(t.delayIo);
    }
    const acc = decayInto(emptyAcc(), onl);
    const plex = sumAcc([acc, acc]);
    expect(plex.resourceSamples).toBe(false);
    expect(plex.workManager!.active).toBeCloseTo(2 * acc.workManager!.active);
    expect(plex.workManager!.regionKeys).toEqual(['REG1#1', 'REG2#1']);
  });

  it('REGION mode suppresses service-class RT while state estimates and transaction report records remain', () => {
    const i = input();
    const r = evaluateLpar({ ...i, slices: i.slices.filter((s) => s.key !== 'DDF'), regions: { ...i.regions!, mode: 'REGION', servers: [], rtTracked: false } });
    expect(r.reportedScps!.find((t) => t.scKey === 'ONL#1')!.completions).toBe(0);
    expect(r.reportedScps!.find((t) => t.scKey === 'ONL#1')!.workManager!.active).toBeGreaterThan(0);
    expect(r.rcs!.find((t) => t.scKey === 'CICSR')!.workManager!.active).toBeGreaterThan(0);
    expect(r.reportedScps!.find((t) => t.scKey === 'REG1#1')!.usingCpu).toBeGreaterThan(0);
  });
});

it('retains resource availability while a formerly mixed class has smoothed non-CICS samples', () => {
  const i = input();
  const mixed = evaluateLpar(i).reportedScps!.find((t) => t.scKey === 'ONL#1')!;
  const pure = evaluateLpar({ ...i, slices: i.slices.filter((s) => s.key !== 'DDF') }).reportedScps!.find((t) => t.scKey === 'ONL#1')!;
  let a = decayInto(decayInto(emptyAcc(), mixed), pure);
  expect(a.using).toBeGreaterThan(0);
  expect(a.resourceSamples).toBe(true);
  expect(pure.resourceSamples).toBe(false);
  for (let i = 0; i < 200; i++) a = decayInto(a, pure);
  expect(a.resourceSamples).toBe(false);
  expect(a.using + a.delay + a.delayOther + a.cpuEngines).toBe(0);
});

it('averages work manager concurrency per tick and sums it across systems in RMF service/report classes', async () => {
  const { accumulateTick, newRmfAcc, closeInterval } = await import('../../src/sim/measure/rmf');
  const { MIDWEST } = await import('../../src/content/scenarios');
  const r = evaluateLpar(input());
  const ticks = ['PROD1', 'PROD2'].map((lparId) => ({ ...r, lparId }));
  let acc = newRmfAcc(0);
  for (let i = 0; i < 2; i++) acc = accumulateTick(acc, ticks, [], null, []);
  const iv = closeInterval(acc, { def: MIDWEST.definition, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 2 });
  const wm = r.reportedScps!.find((t) => t.scKey === 'ONL#1')!.workManager!;
  const own = iv.wlm.find((t) => t.lparId === 'PROD1' && t.scKey === 'ONL#1')!;
  const plex = iv.wlm.find((t) => t.lparId === '*PLEX' && t.scKey === 'ONL#1')!;
  expect(own.workManager!.active).toBeCloseTo(wm.active);
  expect(own.resourceSamples).toBe(true); // mixed CICS/DDF
  expect(own.execVelocity).toBeNull();
  expect(plex.workManager!.active).toBeCloseTo(2 * wm.active);
  const rc = iv.wlmRc!.find((t) => t.lparId === '*PLEX' && t.scKey === 'CICSR')!;
  expect(rc.workManager!.active).toBeCloseTo(2 * wm.active);
  expect(rc.resourceSamples).toBe(false);
  expect(rc.applCpPct).toBe(0);
  expect(rc.execVelocity).toBeNull();
  expect(rc.ended).toBeGreaterThan(0);
});

it('reports a consistent active population while zero-arrival CICS backlog drains', () => {
  const i = input();
  const slices = i.slices.filter((s) => s.key !== 'DDF').map((s) => s.key === 'CICS' ? { ...s, rate: 0, cpEngines: 0 } : s);
  const r = evaluateLpar({ ...i, slices, backlog: { CICS: 100 } });
  const wm = r.reportedScps!.find((t) => t.scKey === 'ONL#1')!.workManager!;
  expect(wm.active).toBeGreaterThan(0);
  expect(wm.ready).toBe(0);
});

it('keeps z/OS CPU waits ACTIVE and reserves READY for modeled CICS QR dispatch waits', () => {
  const i = input();
  const cpu = evaluateLpar(i);
  expect(cpu.slices.find((s) => s.key === 'CICS')!.delayCpu).toBeGreaterThan(0);
  expect(cpu.reportedScps!.find((t) => t.scKey === 'ONL#1')!.workManager!.ready).toBe(0);
  const slices = i.slices.map((s) => s.key === 'CICS' ? { ...s, extraOtherSec: 0.05, extraParts: { qr: 0.05 } } : s);
  const qr = evaluateLpar({ ...i, slices });
  expect(qr.reportedScps!.find((t) => t.scKey === 'ONL#1')!.workManager!.ready).toBeCloseTo(5);
});

it('expires old subsystem data after CICS leaves a mixed class, while retaining current zero-weight data', () => {
  const i = input();
  const mixed = evaluateLpar(i).reportedScps!.find((t) => t.scKey === 'ONL#1')!;
  const ddfOnly = evaluateLpar({ ...i, slices: i.slices.filter((s) => s.key !== 'CICS') }).reportedScps!.find((t) => t.scKey === 'ONL#1')!;
  let a = decayInto(emptyAcc(), mixed);
  for (let tick = 0; tick < 250; tick++) a = decayInto(a, ddfOnly);
  expect(a.workManager).toBeUndefined();
  expect(a.resourceSamples).toBe(true);
  expect(a.using).toBeGreaterThan(0);
  const current = { ...mixed, workManager: { active: 0, ready: 0, idle: 0, waitingIo: 0, waitingOther: 0, regionKeys: ['REG1#1'] } };
  expect(decayInto(emptyAcc(), current).workManager).toEqual(current.workManager);
});
