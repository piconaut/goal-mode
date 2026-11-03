import { describe, expect, it } from 'vitest';
import { evaluateLpar, sliceSpec, type LparEvalInput, type LparEvalResult } from '../../src/sim/wlm/evaluate';
import { cicsTargets, mergeWorkManager, noResources, reportedAccs, reportedTicks } from '../../src/sim/wlm/reporting';
import { decayInto, emptyAcc, sumAcc } from '../../src/sim/wlm/runtime';

const SLICES = [
  sliceSpec({ key: 'CICS', scKey: 'ONL#1', kind: 'TXN', rate: 100, cpEngines: 2, cpuSecPerTxn: 0.02, ioPerTxn: 1, baseLatencySec: 0.01, goalRtSec: 0.25, reportClass: 'CICSR' }),
  sliceSpec({ key: 'DDF', scKey: 'ONL#1', kind: 'TXN', rate: 10, cpEngines: 0.1, cpuSecPerTxn: 0.01, reportClass: 'DDFR' }),
  sliceSpec({ key: 'AOR1', scKey: 'REG1#1', kind: 'AS', role: 'CICS.AOR', cpEngines: 0.1, reportClass: 'REGR' }),
  sliceSpec({ key: 'AOR2', scKey: 'REG2#1', kind: 'AS', role: 'CICS.AOR', cpEngines: 0.1 }),
];

const input = (over: Partial<LparEvalInput> = {}): LparEvalInput => {
  const slices = over.slices ?? SLICES;
  const regionKey = over.regions?.regionKey ?? 'REG1#1';
  return {
    cpCapacityEngines: 1, cpServers: 1, ziipCapacityEngines: 0, ziipServers: 0,
    cpPrsmDelayFrac: 0, pagingFrac: 0, backlog: {}, dpOf: () => 240,
    io: { RANDOM: { rtSec: 0.002, delaySec: 0.001 }, SEQ: { rtSec: 0.002, delaySec: 0.001 } },
    ...over,
    slices,
    regions: { keys: ['ONL#1'], transactionKeys: new Set(['CICS']), mode: 'TRANSACTION', regionKey, servers: ['AOR1', 'AOR2'], ...over.regions, targets: cicsTargets(slices, regionKey) },
  };
};
const scps = (i: LparEvalInput, r: LparEvalResult) => reportedTicks(r.scps, i.regions!.targets);
const rcs = (i: LparEvalInput, r: LparEvalResult) => reportedTicks(r.rcs!, i.regions!.targets, true);
const noDdf = SLICES.filter((s) => s.key !== 'DDF');

describe('CICS reporting accounting', () => {
  it('keeps WLM management identical to projections and conserves resource accounting across AOR classes', () => {
    const i = input(), r = evaluateLpar(i), rep = scps(i, r);
    const plain = evaluateLpar({ ...i, scpsOnly: true }).scps;
    const strip = (ts: typeof r.scps) => ts.map(({ moved: _m, workManager: _w, ...t }) => t);
    expect(strip(r.scps)).toEqual(plain);
    const sum = (rows: typeof r.scps, k: 'cpEngines' | 'usingCpu' | 'delayCpu' | 'usingIo' | 'delayIo') => rows.reduce((a, t) => a + t[k], 0);
    for (const k of ['cpEngines', 'usingCpu', 'delayCpu', 'usingIo', 'delayIo'] as const) expect(sum(rep, k)).toBeCloseTo(sum(r.scps, k), 12);
    const onl = rep.find((t) => t.scKey === 'ONL#1')!;
    const ddf = r.slices.find((s) => s.key === 'DDF')!;
    expect(onl.usingCpu).toBeCloseTo(ddf.usingCpu, 12); // mixed CICS + DDF keeps the DDF samples
    expect(onl.workManager?.active).toBeGreaterThan(0);
    expect(onl.workManager?.regionKeys).toEqual(['REG1#1', 'REG2#1']);
    expect(onl.completions).toBe(r.scps.find((t) => t.scKey === 'ONL#1')!.completions);
    const rc = rcs(i, r);
    expect(rc.find((t) => t.scKey === 'CICSR')!.cpEngines).toBe(0);
    expect(rc.find((t) => t.scKey === 'CICSR')!.workManager?.ready).toBe(0); // z/OS CPU shortage is not a CICS dispatcher wait
    expect(rc.find((t) => t.scKey === 'DDFR')!.usingCpu).toBe(ddf.usingCpu);
    expect(rc.find((t) => t.scKey === 'REGR')!.cpEngines).toBeGreaterThan(r.rcs!.find((t) => t.scKey === 'REGR')!.cpEngines);
  });

  it('nets pure CICS rows to exactly zero and respects I/O priority off', () => {
    const i = input({ slices: noDdf, ioPriority: false });
    const r = evaluateLpar(i), rep = scps(i, r);
    const onl = rep.find((t) => t.scKey === 'ONL#1')!;
    expect(onl.usingCpu + onl.delayCpu + onl.cpEngines + onl.usingIo + onl.delayOther).toBe(0);
    for (const t of rep) {
      expect(t.usingIoNoVel).toBeCloseTo(t.usingIo, 12);
      expect(t.delayIoNoVel).toBeCloseTo(t.delayIo, 12);
    }
    const acc = decayInto(emptyAcc(), onl);
    expect(noResources(acc)).toBe(true);
    const plex = sumAcc([acc, acc]);
    expect(plex.workManager!.active).toBeCloseTo(2 * acc.workManager!.active);
    expect(plex.workManager!.regionKeys).toEqual(['REG1#1', 'REG2#1']);
  });

  it('REGION mode leaves response times and the state breakdown to report classes (WLM Planning p.123)', () => {
    const i = input({ slices: noDdf, regions: { keys: ['ONL#1'], mode: 'REGION', regionKey: 'REG1#1', servers: [], rtTracked: false } });
    const r = evaluateLpar(i), rep = scps(i, r);
    expect(rep.find((t) => t.scKey === 'ONL#1')!.completions).toBe(0);
    expect(rep.find((t) => t.scKey === 'ONL#1')!.workManager).toBeUndefined();
    expect(rcs(i, r).find((t) => t.scKey === 'CICSR')!.workManager!.active).toBeGreaterThan(0);
    expect(rep.find((t) => t.scKey === 'REG1#1')!.usingCpu).toBeGreaterThan(r.scps.find((t) => t.scKey === 'REG1#1')!.usingCpu);
  });
});

it('applies the same attribution to WLM accumulators for Monitor III', () => {
  const i = input({ slices: noDdf }), r = evaluateLpar(i);
  let accs: Record<string, ReturnType<typeof emptyAcc>> = {};
  for (let n = 0; n < 5; n++) for (const t of r.scps) accs = { ...accs, [t.scKey]: decayInto(accs[t.scKey] ?? emptyAcc(), t) };
  const rep = reportedAccs(accs, i.regions!.targets);
  expect(noResources(rep['ONL#1']!)).toBe(true);
  expect(rep['ONL#1']!.moved).toBeUndefined();
  const total = (k: 'using' | 'delay' | 'cpuEngines') => Object.values(accs).reduce((a, x) => a + x[k], 0);
  for (const k of ['using', 'delay', 'cpuEngines'] as const) expect(Object.values(rep).reduce((a, x) => a + x[k], 0)).toBeCloseTo(total(k), 9);
  expect(rep['REG1#1']!.using).toBeCloseTo(accs['REG1#1']!.using + (accs['ONL#1']!.moved!.usingCpu + accs['ONL#1']!.moved!.usingZiip + accs['ONL#1']!.moved!.usingIo) / 2, 9);
});

it('averages work manager concurrency per tick and sums it across systems in RMF service/report classes', async () => {
  const { accumulateTick, newRmfAcc, closeInterval } = await import('../../src/sim/measure/rmf');
  const { MIDWEST } = await import('../../src/content/scenarios');
  const i = input(), r = evaluateLpar(i);
  const ticks = ['PROD1', 'PROD2'].map((lparId) => ({ ...r, lparId, cics: i.regions!.targets }));
  let acc = newRmfAcc(0);
  for (let n = 0; n < 2; n++) acc = accumulateTick(acc, ticks, [], null, []);
  const iv = closeInterval(acc, { def: MIDWEST.definition, config: MIDWEST.world, r4haByLpar: {}, jobs: [], endTick: 2 });
  const wm = r.scps.find((t) => t.scKey === 'ONL#1')!.workManager!;
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
  const slices = noDdf.map((s) => (s.key === 'CICS' ? { ...s, rate: 0, cpEngines: 0 } : s));
  const r = evaluateLpar(input({ slices, backlog: { CICS: 100 } }));
  const wm = r.scps.find((t) => t.scKey === 'ONL#1')!.workManager!;
  expect(wm.active).toBeGreaterThan(0);
  expect(wm.ready).toBe(0);
});

it('keeps z/OS CPU waits ACTIVE and reserves READY for modeled CICS QR dispatch waits', () => {
  const cpu = evaluateLpar(input());
  expect(cpu.slices.find((s) => s.key === 'CICS')!.delayCpu).toBeGreaterThan(0);
  expect(cpu.scps.find((t) => t.scKey === 'ONL#1')!.workManager!.ready).toBe(0);
  const slices = SLICES.map((s) => (s.key === 'CICS' ? { ...s, extraOtherSec: 0.05, extraParts: { qr: 0.05 } } : s));
  expect(evaluateLpar(input({ slices })).scps.find((t) => t.scKey === 'ONL#1')!.workManager!.ready).toBeCloseTo(5);
});

it('expires old subsystem data after CICS leaves a mixed class', () => {
  const mixed = evaluateLpar(input()).scps.find((t) => t.scKey === 'ONL#1')!;
  const ddfOnly = evaluateLpar(input({ slices: SLICES.filter((s) => s.key !== 'CICS') })).scps.find((t) => t.scKey === 'ONL#1')!;
  let a = decayInto(emptyAcc(), mixed);
  for (let tick = 0; tick < 250; tick++) a = decayInto(a, ddfOnly);
  expect(a.workManager).toBeUndefined();
  expect(a.moved).toBeUndefined();
  expect(noResources(a)).toBe(false);
  expect(a.using).toBeGreaterThan(0);
});

it('reuses unrelated period ticks', () => {
  const other = sliceSpec({ key: 'OTHER', scKey: 'OTHER#1', kind: 'AS', cpEngines: 0.2 });
  const i = input({ slices: [...SLICES, other] }), r = evaluateLpar(i);
  expect(scps(i, r).find((t) => t.scKey === 'OTHER#1')).toBe(r.scps.find((t) => t.scKey === 'OTHER#1'));
  expect(reportedTicks(r.scps, undefined)).toBe(r.scps);
});

it('shares canonical region keys and merges changed region sets in sorted order', () => {
  const a = { active: 1, ready: 0, idle: 0, waitingIo: 0, waitingLock: 0, waitingProd: 0, waitingMisc: 0, regionKeys: ['A#1', 'Z#1'] };
  expect(mergeWorkManager(a, a).regionKeys).toBe(a.regionKeys);
  expect(mergeWorkManager(a, { ...a, regionKeys: [...a.regionKeys] }).regionKeys).toBe(a.regionKeys);
  expect(mergeWorkManager(a, { ...a, regionKeys: ['B#1', 'Z#1'] }).regionKeys).toEqual(['A#1', 'B#1', 'Z#1']);
});

it('tags only CICS transaction classes in WLM state', async () => {
  const { initState } = await import('../../src/sim/core/init');
  const { step } = await import('../../src/sim/core/step');
  const { MIDWEST } = await import('../../src/content/scenarios');
  const s = step(initState(42, MIDWEST), [], MIDWEST);
  const tagged = s.wlm.systems.flatMap((x) => x.scps.filter((p) => p.acc.moved).map((p) => p.scKey));
  expect(new Set(tagged)).toEqual(new Set(['ONLHI#1', 'ONLMED#1']));
  expect(s.last.lpars.find((l) => l.lparId === 'PROD1')!.cics!.regionKeys).toEqual(['STCHI#1']);
});

it('keeps region topology across changing rates and follows reclassification', async () => {
  const { cicsRegions } = await import('../../src/sim/core/step');
  const { MIDWEST } = await import('../../src/content/scenarios');
  const byId = Object.fromEntries(MIDWEST.workloads.map((w) => [w.id, w]));
  const slices = SLICES.map((s) => (s.key === 'CICS' ? { ...s, workloadId: 'RBANK' } : s));
  const a = cicsRegions(MIDWEST.definition, slices, byId, MIDWEST.addressSpaces, 'PROD1').regions!;
  const b = cicsRegions(MIDWEST.definition, slices.map((s) => ({ ...s, rate: s.rate * 2 })), { ...byId }, MIDWEST.addressSpaces, 'PROD1').regions!;
  expect(b).toEqual(a);
  expect(a.transactionKeys!.has('CICS')).toBe(true);
  const moved = slices.map((s) => (s.key === 'AOR1' ? { ...s, scKey: 'NEWREG#1', reportClass: 'NEWRC' } : s));
  const c = cicsRegions(MIDWEST.definition, moved, byId, MIDWEST.addressSpaces, 'PROD1').regions!;
  expect(c.targets!.regionKeys).toEqual(['NEWREG#1', 'REG2#1']);
  expect(c.targets!.regions.find((x) => x.scKey === 'NEWREG#1')!.reportClass).toBe('NEWRC');
});

it('uses the declared region class when no AOR slices are present', () => {
  const i = input({ slices: SLICES.filter((s) => s.role !== 'CICS.AOR'), regions: { keys: ['ONL#1'], mode: 'TRANSACTION', regionKey: 'FALLBACK#1', servers: [] } });
  const r = evaluateLpar(i), rep = scps(i, r);
  expect(rep.find((t) => t.scKey === 'FALLBACK#1')!.cpEngines).toBe(r.slices.find((s) => s.key === 'CICS')!.cpGranted);
  expect(r.scps.find((t) => t.scKey === 'ONL#1')!.workManager!.regionKeys).toEqual(['FALLBACK#1']);
});
