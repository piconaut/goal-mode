import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_WORLD } from '../../src/content/scenarios/midwest';
import { MIDWEST_ADDRESS_SPACES, MIDWEST_WORKLOADS } from '../../src/content/scenarios/midwest-workloads';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { initState } from '../../src/sim/core/init';
import { cicsHonorPriority, cicsRegions, step } from '../../src/sim/core/step';
import { evaluateLpar, sliceSpec } from '../../src/sim/wlm/evaluate';
import type { RegionMode } from '../../src/sim/wlm/types';
import { buildSlices, type SliceBuildInput } from '../../src/sim/workload/slices';

// WLM Planning 3.1 pp.121–122: shared CICS regions use the mix of running transaction
// classes; DDF enclaves retain their own class's setting.
const workloads = ['RBANK', 'PAYMQ', 'MOBILE'].map((id) => ({
  ...MIDWEST_WORKLOADS.find((w) => w.id === id)!, cpuMsRef: 1000, ziipFrac: 1, servers: [],
}));
const byId = Object.fromEntries(workloads.map((w) => [w.id, w]));
const addressSpaces = MIDWEST_ADDRESS_SPACES.map((a) => ({ ...a, ziipFrac: 1, baseEnginesRef: 0.4 }));
const io = { RANDOM: { rtSec: 0, delaySec: 0 }, SEQ: { rtSec: 0, delaySec: 0 } };
const policy = (allNo = false, regionMode?: RegionMode) => {
  const def = structuredClone(BASEPOL);
  for (const c of def.classes) c.honorPriority = c.id === 'ONLHI' && !allNo;
  if (regionMode) for (const ss of def.subsystems) if (ss.subsystem === 'STC') for (const rule of ss.rules) if (rule.pattern === 'CICS*') rule.regionMode = regionMode;
  return def;
};
const input = (def = policy(), lparId = 'PROD1'): SliceBuildInput => ({
  def, lpar: MIDWEST_WORLD.lpars.find((l) => l.id === lparId)!, cpc: MIDWEST_WORLD.cpcs[0]!,
  workloads, addressSpaces, rates: { RBANK: 4, PAYMQ: 4, MOBILE: 4 },
});
const apply = (i: SliceBuildInput, backlog: Record<string, number> = {}, ziipBacklog: Record<string, number> = {}) => {
  const slices = buildSlices(i);
  const regions = cicsRegions(i.def, slices, byId, i.addressSpaces, i.lpar.id).regions;
  return cicsHonorPriority(i.def, slices, byId, regions, backlog, ziipBacklog);
};
const overflow = (i: SliceBuildInput, noZiip = false) => evaluateLpar({
  slices: apply(i), backlog: {}, ziipBacklog: {}, cpCapacityEngines: 30, cpServers: 30,
  ziipCapacityEngines: noZiip ? 0 : 1, ziipServers: noZiip ? 0 : 1,
  cpPrsmDelayFrac: 0, pagingFrac: 0, io, dpOf: () => 240,
});

describe('CICS shared-region Honor Priority', () => {
  it.each([false, true])('keeps same-class DDF enclaves NO with reversed slice order=%s', (reverse) => {
    const i = input();
    i.def.subsystems.find((ss) => ss.subsystem === 'DDF')!.defaultServiceClass = 'ONLMED';
    const slices = [...apply(i)];
    if (reverse) slices.reverse();
    const result = evaluateLpar({ slices, backlog: {}, cpCapacityEngines: 30, cpServers: 30,
      ziipCapacityEngines: 1, ziipServers: 1, cpPrsmDelayFrac: 0, pagingFrac: 0, io, dpOf: () => 240 });
    expect(result.slices.find((s) => s.key.startsWith('PAYMQ@'))!.iipcpGranted).toBeGreaterThan(0.1);
    expect(result.slices.find((s) => s.key.startsWith('MOBILE@'))!.iipcpGranted).toBe(0);
    const members = result.slices.filter((s) => slices.find((x) => x.key === s.key)!.scKey === 'ONLMED#1');
    expect(result.scps.filter((s) => s.scKey === 'ONLMED#1')).toHaveLength(1);
    expect(result.scps.find((s) => s.scKey === 'ONLMED#1')!.iipcpEngines).toBeCloseTo(members.reduce((sum, s) => sum + s.iipcpGranted, 0));
  });

  it.each(['minimum', 'promotion'] as const)('shares one class %s across overflow groups without duplicating grants', (kind) => {
    const slices = [
      sliceSpec({ key: 'CICS', scKey: 'ONLMED#1', kind: 'AS', cpEngines: 1, ziipEngines: 1, mayOverflow: true }),
      sliceSpec({ key: 'DDF', scKey: 'ONLMED#1', kind: 'AS', cpEngines: 1, ziipEngines: 1, mayOverflow: false }),
      sliceSpec({ key: 'HIGH', scKey: 'ONLHI#1', kind: 'AS', cpEngines: 4 }),
    ];
    const result = evaluateLpar({ slices, backlog: {}, cpCapacityEngines: 1, cpServers: 1,
      ziipCapacityEngines: 1, ziipServers: 1, cpPrsmDelayFrac: 0, pagingFrac: 0, io,
      dpOf: (k) => k === 'ONLHI#1' ? 246 : 220,
      ...(kind === 'minimum' ? { minOf: { 'ONLMED#1': 0.6 } } : { promoted: new Set(['ONLMED#1']), promotionShareFrac: 0.2 }),
    });
    expect(result.slices[0]!.cpGranted + result.slices[1]!.cpGranted).toBeCloseTo(kind === 'minimum' ? 0.6 : 0.2);
    expect(result.slices.reduce((sum, s) => sum + s.cpGranted + s.iipcpGranted, 0)).toBeCloseTo(1);
    expect(result.slices[1]!.iipcpGranted).toBe(0);
  });

  it('permits mixed DEFAULT/NO CICS overflow and blocks it only when all served classes are NO', () => {
    const mixed = overflow(input());
    const allNo = overflow(input(policy(true)));
    const pay = (r: typeof mixed) => r.slices.find((s) => s.key.startsWith('PAYMQ@'))!;
    expect(pay(mixed).iipcpGranted).toBeGreaterThan(0.1);
    expect(pay(allNo).iipcpGranted).toBe(0);
    expect(apply(input()).filter((s) => s.workloadId === 'MOBILE').every((s) => !s.mayOverflow)).toBe(true);
    expect(mixed.slices.filter((s) => s.key.startsWith('MOBILE@')).every((s) => s.iipcpGranted === 0)).toBe(true);
  });

  it('applies the transaction mix to TRANSACTION AOR/TOR CPU, independent of their region class', () => {
    const eligible = apply(input()).filter((s) => s.role === 'CICS.AOR' || s.role === 'CICS.TOR');
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every((s) => s.mayOverflow)).toBe(true); // STCHI itself is NO
    const no = policy(true);
    no.classes.find((c) => c.id === 'STCHI')!.honorPriority = true;
    const blocked = apply(input(no)).filter((s) => s.role === 'CICS.AOR' || s.role === 'CICS.TOR');
    expect(blocked.every((s) => !s.mayOverflow)).toBe(true);
    const result = overflow(input());
    expect(result.slices.find((s) => s.key.startsWith('CICSAOR1@'))!.iipcpGranted).toBeGreaterThan(0);
    expect(apply(input()).filter((s) => s.role === 'MQ.MSTR').every((s) => !s.mayOverflow)).toBe(true);
  });

  it.each(['REGION', 'BOTH'] as const)('preserves %s regions and their transactions independent settings', (mode) => {
    const slices = apply(input(policy(false, mode)));
    expect(slices.find((s) => s.workloadId === 'PAYMQ')!.mayOverflow).toBe(false);
    expect(slices.filter((s) => s.role === 'CICS.AOR' || s.role === 'CICS.TOR').every((s) => !s.mayOverflow)).toBe(true);
  });

  it.each([['TRANSACTION', true], ['REGION', undefined], ['BOTH', undefined]] as const)(
    'marks the image %s-managed only when every region is (PT-05 B2; WLM Planning p.122)',
    (mode, expected) => {
      const i = input(policy(false, mode));
      const reg = cicsRegions(i.def, buildSlices(i), byId, i.addressSpaces, i.lpar.id).regions!;
      expect(reg.managedToTxn).toBe(expected);
    },
  );

  it('a mixed image is not marked as TRANSACTION-managed', () => {
    const i = input();
    i.def.subsystems.find((ss) => ss.subsystem === 'STC')!.rules.unshift(
      { qualifier: 'TN', pattern: 'CICSTOR1', serviceClass: 'STCHI', reportClass: null, children: [], regionMode: 'BOTH' },
    );
    const reg = cicsRegions(i.def, buildSlices(i), byId, i.addressSpaces, i.lpar.id).regions!;
    expect(reg.managedToTxn).toBeUndefined();
  });

  it('changes only TRANSACTION address spaces when AOR/TOR modes differ on one image', () => {
    const i = input();
    const stc = i.def.subsystems.find((ss) => ss.subsystem === 'STC')!;
    stc.rules.unshift(
      { qualifier: 'TN', pattern: 'CICSAOR1', serviceClass: 'STCHI', reportClass: null, children: [], regionMode: 'REGION' },
      { qualifier: 'TN', pattern: 'CICSTOR1', serviceClass: 'STCHI', reportClass: null, children: [], regionMode: 'BOTH' },
    );
    const slices = apply(i);
    expect(slices.find((s) => s.jobname === 'CICSAOR1')!.mayOverflow).toBe(false);
    expect(slices.find((s) => s.jobname === 'CICSTOR1')!.mayOverflow).toBe(false);
    expect(slices.find((s) => s.jobname === 'CICSAOR3')!.mayOverflow).toBe(true);
    expect(slices.find((s) => s.workloadId === 'PAYMQ')!.mayOverflow).toBe(true);
  });

  it('does not let DEFAULT classes routed only to another image enable overflow here', () => {
    const i = input();
    i.workloads = workloads.map((w) => w.id === 'RBANK' ? { ...w, routing: { PROD2: 1 } } : w);
    expect(apply(i).find((s) => s.workloadId === 'PAYMQ')!.mayOverflow).toBe(false);
    expect(apply({ ...i, lpar: MIDWEST_WORLD.lpars.find((l) => l.id === 'PROD2')! }).find((s) => s.workloadId === 'PAYMQ')!.mayOverflow).toBe(true);
  });

  it('recomputes participation when cached rates change, retaining both CP and zIIP backlog', () => {
    const i = input();
    const rb = buildSlices(i).find((s) => s.workloadId === 'RBANK')!;
    const allowed = (bl = {}, zi = {}) => apply(i, bl, zi).find((s) => s.workloadId === 'PAYMQ')!.mayOverflow;
    expect(allowed()).toBe(true);
    i.rates = { ...i.rates, RBANK: 0 };
    expect(allowed()).toBe(false);
    expect(allowed({ [rb.key]: 2 }, {})).toBe(true); // CP backlog only
    expect(allowed({ [rb.key]: 2 }, { [rb.key]: 2 })).toBe(true); // total 2, zIIP subset 2: CP backlog 0
    expect(allowed()).toBe(false);
    i.rates = { ...i.rates, RBANK: 4 };
    expect(allowed()).toBe(true);
    expect(apply({ ...i, def: policy(true) }).find((s) => s.workloadId === 'PAYMQ')!.mayOverflow).toBe(false);
  });

  it('keeps discretionary protection and the no-zIIP CP path', () => {
    const i = input();
    i.def.classes.find((c) => c.id === 'ONLMED')!.periods[0]!.goal = { kind: 'DISC' };
    expect(apply(i).find((s) => s.workloadId === 'PAYMQ')!.mayOverflow).toBe(false);
    expect(overflow(input(policy(true)), true).slices.find((s) => s.key.startsWith('PAYMQ@'))!.iipcpGranted).toBeGreaterThan(0);
  });

  it('uses the address-space class when there is no participating transaction work', () => {
    const i = input();
    i.def.classes.find((c) => c.id === 'STCHI')!.honorPriority = true;
    i.rates = {};
    expect(apply(i).find((s) => s.role === 'CICS.AOR')!.mayOverflow).toBe(true);
  });

  it('keeps system IIPHONORPRIORITY=NO as the final override in the tick pipeline', () => {
    let base = initState(23, MIDWEST);
    base = step(base, [
      { kind: 'SET_CPC_ENGINES', cpcId: 'CPCA', pool: 'ZIIP', engines: 1 },
      { kind: 'SET_MODIFIER', mod: 'cpu', key: 'PAYMQ', value: 60 },
      { kind: 'SET_MODIFIER', mod: 'ziipShift', key: 'PAYMQ', value: 0.9 },
      { kind: 'ACTIVATE_POLICY', definition: policy() },
    ], MIDWEST);
    const run = (enabled: boolean) => {
      let s = step(base, [{ kind: 'SET_IEAOPT', lparId: 'PROD1', changes: { iipHonorPriority: enabled } }], MIDWEST);
      let help = 0;
      for (let t = 0; t < 30; t++) {
        s = step(s, [], MIDWEST);
        help += s.last.lpars.find((l) => l.lparId === 'PROD1')!.scps.find((p) => p.scKey === 'ONLMED#1')!.iipcpEngines;
      }
      return help;
    };
    expect(run(true)).toBeGreaterThan(0);
    expect(run(false)).toBe(0);
  });
});
