import { BASEPOL } from '../../src/content/wlm/basepol';
import { policyAdjust } from '../../src/sim/wlm/adjust';
import { evaluateLpar, type SliceSpec } from '../../src/sim/wlm/evaluate';

const IO = { RANDOM: { rtSec: 0.0008, delaySec: 0.0002 }, SEQ: { rtSec: 0.0006, delaySec: 0.0001 } };
import { decayInto, emptyAcc, type WlmSystemState } from '../../src/sim/wlm/runtime';

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
