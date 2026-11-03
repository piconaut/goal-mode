import { BASEPOL } from '../../src/content/wlm/basepol';
import { policyAdjust } from '../../src/sim/wlm/adjust';
import { evaluateLpar, sliceSpec, type SliceSpec } from '../../src/sim/wlm/evaluate';
import { jobCpuDemand, jobShape, type JobDef } from '../../src/sim/subsys/batch';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };
import { decayInto, emptyAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';

// RPT job shapes and prior pacing from the saved D5 22:23 CP-only trial.
const savedJobs = [
  [287.591646848, 254501, .00130261, .00014490], [560.028035341, 216030, .00113143, .00012584],
  [605.710936085, 475232, .00126820, .00014107], [554.25259103, 477784, .00129476, .00014403],
  [357.338680702, 392706, .00137599, .00015308],
];
const savedReadyDemand = () => savedJobs.reduce((sum, [cpuSecRef, ioCount, cpPace, ziipPace]) => {
  const shape = jobShape({ cpuSecRef, ioCount, ziipFrac: .1 } as JobDef, .6, .86, .0004);
  const d = jobCpuDemand(shape, { cpPace, ziipPace }, false);
  return sum + d.cp + d.ziip;
}, 0);

const slice = (key: string, scKey: string, cpEngines: number, goalRtSec: number | null): SliceSpec => ({
  key,
  scKey,
  kind: 'TXN',
  workloadId: key,
  jobname: null,
  role: null,
  rate: 200,
  cpEngines,
  ziipEngines: 0,
  mayOverflow: true,
  cpuSecPerTxn: cpEngines / 200,
  ziipSecPerTxn: 0,
  ioPerTxn: 0,
  baseLatencySec: 0.02,
  rtSigma: 0.5,
  timeoutSec: 30,
  servers: [],
  goalRtSec,
  slaRtSec: null,
  ioClass: 'RANDOM',
  ioRate: 0,
  extraOtherSec: 0,
  failFrac: 0,
  outsideWaitSec: 0,
});

describe('policy adjustment', () => {
  // ONLHI (imp 1, 95% < 0.25 s) sits below BATCHPRD (imp 4) on a saturated image.
  const slices = [slice('RB', 'ONLHI#1', 2.5, 0.25), slice('BAT', 'BATCHPRD#1', 3, null)];
  const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
  const dps: Record<string, number> = { 'ONLHI#1': 230, 'BATCHPRD#1': 240 };
  const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const system: WlmSystemState = {
    lparId: 'SYS1',
    scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
  };

  it('helps the important unhappy class by moving it above the less important one', () => {
    const out = policyAdjust({ def: BASEPOL, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' });
    expect(out.log).toContain('RCVR=ONLHI#1');
    expect(out.dps['ONLHI#1']!).toBeGreaterThan(out.dps['BATCHPRD#1']!);
  });

  it('only one receiver is helped per interval', () => {
    const out = policyAdjust({ def: BASEPOL, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' });
    const changed = Object.keys(dps).filter((k) => out.dps[k] !== dps[k]);
    expect(changed.length).toBe(1);
  });
});

it('tries a locally unhappy more important receiver before a globally unhappy lower tier', () => {
  const def = structuredClone(BASEPOL);
  def.classes.push({ ...structuredClone(def.classes.find((c) => c.id === 'ONLHI')!), id: 'ONLCARD', periods: [{ goal: { kind: 'PCT', pct: 99, rtSec: 0.1 }, importance: 2, durationSu: null }] });
  const slices = [slice('card', 'ONLCARD#1', 2.5, 0.1), slice('batch', 'BATCHPRD#1', 3, null), slice('other', 'STCLO#1', 1, null)];
  const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
  const dps: Record<string, number> = { 'ONLCARD#1': 230, 'BATCHPRD#1': 240, 'STCLO#1': 245 };
  const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const system: WlmSystemState = { lparId: 'SYS1', scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
  const out = policyAdjust({ def, system, evalInput, current: cur.scps, sysplexPi: { 'ONLCARD#1': 0.8, 'BATCHPRD#1': 1.2 }, clockText: 'T' });
  expect(out.log).toContain('RCVR=ONLCARD#1');
});

it('retains starved batch demand when projecting the playtest F2 to F4 raise on CPs', () => {
  // Five RPT jobs and their pacing factors from the D5 22:23 save replay; no zIIP pool.
  const demand = savedReadyDemand();
  const dps: Record<string, number> = { 'ONLHI#1': 0xf4, 'BATCHPRD#1': 0xf2 };
  const evalInput = { cpCapacityEngines: 3.06035, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices: [slice('card', 'ONLHI#1', .2, .25), { ...slice('batch', 'BATCHPRD#1', demand, null), kind: 'AS' as const, units: 5 }], backlog: {}, io: IO, pagingFrac: 0 };
  const before = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
  const after = evaluateLpar({ ...evalInput, dpOf: () => 0xf4 });
  const card = (ticks: typeof before.scps) => ticks.find((t) => t.scKey === 'ONLHI#1')!;
  expect(card(after.scps).rtSumSec / card(after.scps).completions).toBeGreaterThan(card(before.scps).rtSumSec / card(before.scps).completions);
  expect(demand).toBeGreaterThan(3);
});

it('rejects a harmful F2 to F4 batch raise when ready demand is restored', () => {
  // Controlled shared-region case based on the save's no-zIIP F2→F4 sequence.
  const def = structuredClone(BASEPOL);
  def.classes.push({ ...structuredClone(def.classes.find((c) => c.id === 'ONLHI')!), id: 'ONLCARD', periods: [{ goal: { kind: 'PCT', pct: 99, rtSec: .1 }, importance: 2, durationSu: null }] });
  const dps: Record<string, number> = { 'ONLCARD#1': 0xf4, 'STCHI#1': 0xfa, 'BATCHPRD#1': 0xf2, 'STCLO#1': 0xf3 };
  const run = (batchCp: number) => {
    const slices = [
      sliceSpec({ key: 'card', scKey: 'ONLCARD#1', kind: 'TXN', workloadId: 'CARD', rate: 200, cpEngines: .2, cpuSecPerTxn: .001, baseLatencySec: .025, rtSigma: .4, goalRtSec: .1, timeoutSec: 30 }),
      sliceSpec({ key: 'aor', scKey: 'STCHI#1', kind: 'AS', role: 'CICS.AOR', cpEngines: .1, units: 1 }),
      sliceSpec({ key: 'batch', scKey: 'BATCHPRD#1', kind: 'AS', cpEngines: batchCp, units: 20 }),
      sliceSpec({ key: 'other', scKey: 'STCLO#1', kind: 'AS', cpEngines: 1.5, units: 4 }),
    ];
    const evalInput = { cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0, regions: { keys: ['ONLCARD#1'], mode: 'TRANSACTION' as const, regionKey: 'STCHI#1', servers: ['aor'] } };
    const current = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = { lparId: 'SYS1', scps: current.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })) };
    return policyAdjust({ def, system, evalInput, current: current.scps, sysplexPi: {}, clockText: 'T' });
  };
  expect(run(3).dps['BATCHPRD#1']).toBe(0xf4);
  expect(run(savedReadyDemand()).dps['BATCHPRD#1']).toBe(0xf2);
});

describe('equal-importance moves narrow the PI gap (SG24-6472 p.60; Enrico, How WLM Works, slide 52)', () => {
  // ONLMED and DDFPRD period 1 are both importance 2; ONLMED (PI 4) sits below DDFPRD on a saturated image.
  const run = (ddfLatencySec: number) => {
    const slices = [slice('A', 'ONLMED#1', 2.5, 0.5), { ...slice('B', 'DDFPRD#1', 1, 0.5), baseLatencySec: ddfLatencySec }];
    const evalInput = { cpCapacityEngines: 3.5, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0, slices, backlog: {}, io: IO, pagingFrac: 0 };
    const dps: Record<string, number> = { 'ONLMED#1': 230, 'DDFPRD#1': 240 };
    const cur = evaluateLpar({ ...evalInput, dpOf: (k) => dps[k]! });
    const system: WlmSystemState = {
      lparId: 'SYS1',
      scps: cur.scps.map((t) => ({ scKey: t.scKey, dp: dps[t.scKey]!, starvedSec: 0, acc: decayInto(emptyAcc(), t) })),
    };
    return { dps, out: policyAdjust({ def: BASEPOL, system, evalInput, current: cur.scps, sysplexPi: {}, clockText: 'T' }) };
  };

  it('accepts a move that brings the two PIs closer (4.0 / 0.5 → 0.5 / 1.0)', () => {
    const { out } = run(0.02);
    expect(out.log).toContain('RCVR=ONLMED#1');
    expect(out.dps['ONLMED#1']!).toBeGreaterThan(out.dps['DDFPRD#1']!);
  });

  it('rejects a move whose gain beats the harm but leaves the PIs further apart (4.0 / 1.4 → 0.5 / 4.0)', () => {
    const { dps, out } = run(0.4);
    expect(out.dps).toEqual(dps);
    expect(out.log).toContain('no action');
  });
});
