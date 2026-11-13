import { BASEPOL } from '../../src/content/wlm/basepol';
import { rgMin } from '../../src/sim/core/tick/helpers';
import { emptyScpTick, evaluateLpar, sliceSpec } from '../../src/sim/wlm/evaluate';
import { ACC_DECAY, decayInto, emptyAcc, type ScpAcc, type ScpState } from '../../src/sim/wlm/runtime';

const decay = 1 - ACC_DECAY;
const state = (scKey: string, acc: Partial<ScpAcc> = {}): ScpState => ({
  scKey, dp: scKey === 'DEVBAT#1' ? 196 : 240, starvedSec: 0,
  acc: { ...emptyAcc(), using: 9, delay: 1, delayCpu: 0.25, ...acc },
});
const fixture = (disc: Partial<ScpAcc> = {}, other: Partial<ScpAcc> = {}) => {
  const def = structuredClone(BASEPOL);
  def.resourceGroups = [{ id: 'MIN', type: 3, min: 150, max: null }];
  def.classes.find(c => c.id === 'DEVBAT')!.resourceGroup = 'MIN';
  const slices = [sliceSpec({ key: 'H', scKey: 'STCMED#1', kind: 'AS', cpEngines: 4, units: 4 }),
    sliceSpec({ key: 'D', scKey: 'DEVBAT#1', kind: 'AS', cpEngines: 2, units: 2 })];
  return { def, slices, scps: [state('STCMED#1', other), state('DEVBAT#1', { cpuEngines: 0.5 / decay, ...disc })] };
};
const minimum = (f: ReturnType<typeof fixture>) => rgMin(f.def, f.slices, f.scps, undefined, 1000);
const dispatch = (f: ReturnType<typeof fixture>) => evaluateLpar({
  cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 0, ziipServers: 0, cpPrsmDelayFrac: 0,
  slices: f.slices, backlog: {}, io: { RANDOM: { rtSec: 0, delaySec: 0 }, SEQ: { rtSec: 0, delaySec: 0 } },
  pagingFrac: 0, dpOf: k => k === 'DEVBAT#1' ? 196 : 240, ...minimum(f),
});

describe('discretionary resource-group minimum (WT-11; SG24-6472 p.63, WLM Planning p.57–59)', () => {
  it('serves a discretionary minimum ahead of work meeting its goals', () => {
    const f = fixture(); // CPU delay exists even though total delay is less than using.
    expect(minimum(f).minOf).toEqual({ 'DEVBAT#1': 1.5 });
    expect(minimum(f).discMin?.has('DEVBAT#1') ?? false).toBe(false);
    const r = dispatch(f);
    expect(r.slices[1]!.cpGranted).toBeCloseTo(1.5, 10);
    expect(r.slices[0]!.cpGranted).toBeCloseTo(2.5, 10);
  });

  it('yields a discretionary minimum while an outside goal period misses', () => {
    const f = fixture({ using: 1, delay: 9, delayCpu: 9 }, { using: 1, delay: 9 });
    expect(minimum(f).discMin?.has('DEVBAT#1')).toBe(true);
    const r = dispatch(f);
    expect(r.slices[0]!.cpGranted).toBeCloseTo(4, 10);
    expect(r.slices[1]!.cpGranted).toBeCloseTo(0, 10);
  });

  it.each([
    { why: 'smoothed CP service has reached the minimum', acc: { using: 1, delay: 9, delayCpu: 9, cpuEngines: 1.5 / decay } },
    { why: 'the member has I/O delay but no CPU delay', acc: { using: 1, delay: 9, delayCpu: 0, delayIo: 9 } },
  ])('does not lift the minimum when $why', ({ acc }) => {
    expect(minimum(fixture(acc))).toEqual({});
  });

  it('counts smoothed CP service from every group member, including an inactive class', () => {
    const f = fixture({ using: 1, delay: 9, delayCpu: 9 });
    f.def.classes.find(c => c.id === 'STCLO')!.resourceGroup = 'MIN';
    f.scps.push(state('STCLO#1', { cpuEngines: 1 / decay }));
    expect(minimum(f)).toEqual({});
  });

  it('counts IIPCP as CP service but excludes zIIP service', () => {
    for (const iipcp of [0, 2]) {
      const f = fixture();
      f.scps[1]!.acc = decayInto({ ...f.scps[1]!.acc, cpuEngines: iipcp / decay },
        { ...emptyScpTick('DEVBAT#1', 196), iipcpEngines: iipcp, ziipEngines: 10, usingCpu: iipcp, usingZiip: 10, delayCpu: 1 });
      expect(minimum(f).minOf !== undefined).toBe(iipcp === 0);
    }
  });

  it('does not yield to a goal period exactly meeting its goal', () => {
    const f = fixture({}, { using: 4, delay: 6 }); // STCMED velocity goal 40: local PI = 1.
    expect(minimum(f).discMin?.has('DEVBAT#1') ?? false).toBe(false);
    expect(dispatch(f).slices[1]!.cpGranted).toBeCloseTo(1.5, 10);
  });

  it('does not treat an unhappy member of the same group as outside work', () => {
    const f = fixture({}, { using: 1, delay: 9 });
    f.def.classes.find(c => c.id === 'STCMED')!.resourceGroup = 'MIN';
    expect(minimum(f).discMin?.has('DEVBAT#1') ?? false).toBe(false);
    expect(dispatch(f).slices[1]!.cpGranted).toBeCloseTo(0.5, 10);
  });
});
