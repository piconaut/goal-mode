import { MIDWEST } from '../../src/content/scenarios';
import { applyCommands } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import { discretionaryCaps, resourceGroupCaps, rgSysplexShares, step } from '../../src/sim/core/step';
import { planLpar } from '../../src/sim/core/tick/demand';
import type { TickCtx } from '../../src/sim/core/tick/ctx';
import { msuPerCp, suPerCpuSecOf } from '../../src/sim/hw/cpc';
import { poolEntitlement } from '../../src/sim/hw/pools';
import { dispatchableDemand, evaluateLpar, prepareLpar, sliceSpec } from '../../src/sim/wlm/evaluate';
import { ACC_DECAY, emptyAcc } from '../../src/sim/wlm/runtime';

const slice = sliceSpec({ key: 'T', scKey: 'DDFADHOC#1', kind: 'TXN', cpEngines: 1, ziipEngines: 3, cpuSecPerTxn: 1, ziipSecPerTxn: 3, rate: 1, timeoutSec: 1e6, mayOverflow: true });
const input = { slices: [slice], backlog: { T: 20 }, ziipBacklog: { T: 15 }, cpCapacityEngines: 4, cpServers: 4, ziipCapacityEngines: 4, ziipServers: 4, cpPrsmDelayFrac: 0, io: { RANDOM: { rtSec: 0, delaySec: 0 }, SEQ: { rtSec: 0, delaySec: 0 } }, pagingFrac: 0, dpOf: () => 240 };

describe('resource group dispatchability', () => {
  it('uses one awake fraction for both pools and their backlogs', () => {
    expect(dispatchableDemand(slice, input.backlog, input.ziipBacklog)).toEqual({ cp: 1.5, zi: 4.5, cut: 0, ziCut: 0 });
    expect(dispatchableDemand(slice, input.backlog, input.ziipBacklog, () => 0.75)).toEqual({ cp: 0.75, zi: 2.25, cut: 3, ziCut: 2.25 });
    const prepared = prepareLpar({ ...input, capOf: () => 0.75 });
    expect([prepared.sliceCp, prepared.sliceZi, prepared.sliceCut, prepared.sliceZiCut]).toEqual([[0.75], [2.25], [3], [2.25]]);
    const parked = prepareLpar({ ...input, ziipServers: 0, eligibleOnCp: false, capOf: () => 0.75 });
    expect(parked.sliceCp).toEqual(prepared.sliceCp);
    expect(parked.sliceZi).toEqual(prepared.sliceZi);
  });

  it('counts eligible work against the CP maximum when there are no zIIPs', () => {
    const d = dispatchableDemand(slice, input.backlog, input.ziipBacklog, () => 0.75, true);
    expect(d.cp + d.zi).toBeCloseTo(0.75);
    const eligible = { ...slice, cpEngines: 0 };
    expect(dispatchableDemand(eligible, {}, {}, () => 0.1, true).zi).toBeCloseTo(0.1);
    expect(dispatchableDemand(eligible, {}, {}, () => 0.1).zi).toBe(3);
    expect(dispatchableDemand(slice, input.backlog, input.ziipBacklog, () => 0)).toEqual({ cp: 0, zi: 0, cut: 6, ziCut: 4.5 });
  });

  it('retains withheld zIIP work in the zIIP backlog, rather than turning it into CP work', () => {
    const r = evaluateLpar({ ...input, backlog: {}, ziipBacklog: {}, capOf: () => 0.25 }).slices[0]!;
    expect(r.cpGranted).toBeCloseTo(0.25);
    expect(r.ziipGranted).toBeCloseTo(0.75);
    expect(r.newBacklog).toBeCloseTo(30);
    expect(r.newZiipBacklog).toBeCloseTo(22.5);
    expect(r.delayCap).toBeCloseTo(3);
  });

  it('keeps overflow from a saturated configured zIIP within the CP maximum', () => {
    const r = evaluateLpar({ ...input, backlog: {}, ziipBacklog: {}, ziipCapacityEngines: 0.25, ziipServers: 1, capOf: () => 0.5 }).slices[0]!;
    expect(r.cpGranted + r.iipcpGranted).toBeLessThanOrEqual(0.5);
    expect(r.ziipGranted).toBeCloseTo(0.25);
    expect(r.delayCap).toBeCloseTo(3.25);
    expect(r.newBacklog).toBeCloseTo(32.5);
    expect(r.newZiipBacklog).toBeCloseTo(27.5);
  });

  it('uses current configuration entitlement for type 2, including weight edits and dedicated pools', () => {
    const world = structuredClone(MIDWEST.world);
    const lpar = world.lpars.find((l) => l.id === 'PROD2')!;
    const cpc = world.cpcs.find((c) => c.id === lpar.cpcId)!;
    const before = poolEntitlement(cpc, world.lpars, lpar.id, 'CP');
    const lpars = world.lpars.map((l) => l.id === lpar.id ? { ...l, pools: l.pools.map((p) => ({ ...p, weight: 1 })) } : l);
    expect(poolEntitlement(cpc, lpars, lpar.id, 'CP')).toBeLessThan(before);
    const dedicated = lpars.map((l) => l.id === lpar.id ? { ...l, pools: l.pools.map((p) => ({ ...p, dedicated: true })) } : l);
    expect(poolEntitlement(cpc, dedicated, lpar.id, 'CP')).toBe(lpar.pools.find((p) => p.pool === 'CP')!.logical);
    expect(poolEntitlement(cpc, world.lpars, 'missing', 'CP')).toBe(0);
  });

  it('keeps backlog-only type 1 members capped across images', () => {
    const state = initState(42, MIDWEST);
    const def = structuredClone(state.wlm.definition);
    def.resourceGroups = [{ id: 'RG', type: 1, min: null, max: 100 }];
    def.classes.find((c) => c.id === 'DDFPRD')!.resourceGroup = 'RG';
    const a = sliceSpec({ key: 'A', scKey: 'DDFPRD#1', kind: 'TXN' });
    const b = sliceSpec({ key: 'B', scKey: 'DDFPRD#1', kind: 'TXN' });
    const slicesBy = { PROD1: [a], PROD2: [b] };
    const cpcOf = Object.fromEntries(state.config.cpcs.map((c) => [c.id, c]));
    const backlog = { A: 10, B: 30 };
    const shares = rgSysplexShares(def, slicesBy, state.config.lpars, cpcOf, 'PROD1', backlog, {});
    expect(shares.RG).toBeGreaterThan(0);
    expect(shares.RG).toBeLessThan(1);
    const cap = resourceGroupCaps(def, [a], undefined, 40000, shares, {}, backlog, {})!;
    expect(cap(a)).toBeCloseTo(100 * shares.RG! / 40000);
    const eligible = { ...a, ziipEngines: 3, mayOverflow: true };
    const eligibleCap = resourceGroupCaps(def, [eligible], undefined, 40000, { RG: 1 }, {}, {}, {})!;
    expect(eligibleCap(eligible)).toBeCloseTo(0.0025);
    const r = evaluateLpar({ ...input, slices: [eligible], backlog: {}, ziipBacklog: {}, ziipServers: 0, eligibleOnCp: false, capOf: eligibleCap }).slices[0]!;
    expect(r.cpGranted + r.iipcpGranted).toBeLessThanOrEqual(0.0025);
  });

  it('applies discretionary caps to PR/SM planning as well as dispatch', () => {
    const prev = initState(42, MIDWEST);
    const lpar = prev.config.lpars.find((l) => l.id === 'PROD2')!;
    const happy = { scKey: 'TSO#2', dp: 200, starvedSec: 0, acc: { ...emptyAcc(), using: 9, delay: 1, cpuEngines: 6 } };
    const waiting = { scKey: 'DEVBAT#1', dp: 150, starvedSec: 0, acc: { ...emptyAcc(), using: 1, delay: 9, cpuEngines: 1 } };
    prev.wlm.systems = [{ lparId: lpar.id, scps: [happy, waiting] }];
    const s = sliceSpec({ key: 'S', scKey: 'TSO#2', kind: 'AS', cpEngines: 1, ziipEngines: 3 });
    const t = { prev, def: prev.wlm.definition, config: prev.config, cpcOf: Object.fromEntries(prev.config.cpcs.map((c) => [c.id, c])), workloadById: {}, slicesBy: { PROD2: [s] }, capOfBy: {}, demands: [] } as unknown as TickCtx;
    planLpar(t, lpar);
    const cap = discretionaryCaps(t.def, [s], [happy, waiting])!;
    expect(cap(s)).toBeCloseTo(0.5);
    expect(t.capOfBy.PROD2!(s)).toBe(cap(s));
    expect(t.demands[0]!.demandEngines).toBeLessThan(1);
    const prepared = prepareLpar({ ...input, slices: [s], backlog: {}, ziipBacklog: {}, ziipServers: 0, capOf: t.capOfBy.PROD2 });
    expect(prepared.sliceCp[0]! + prepared.sliceZi[0]!).toBeCloseTo(0.5);
  });

  it.each([{ type: 1 as const, max: 100 }, { type: 2 as const, max: 5 }, { type: 3 as const, max: 0.25 }])('a type $type maximum never raises PROD2 LPAR busy or MSU', ({ type, max }) => {
    let free = { ...initState(42, MIDWEST), tick: 3 * 360 };
    free.config.lpars.find((l) => l.id === 'PROD2')!.pools.find((p) => p.pool === 'CP')!.logical = 4;
    free.wlm.definition.classes.push({ ...structuredClone(free.wlm.definition.classes.find((c) => c.id === 'DDFPRD')!), id: 'DDFADHOC' });
    free.wlm.definition.subsystems.find((s) => s.subsystem === 'DDF')!.rules.unshift({ qualifier: 'UI', pattern: 'BIUSER', serviceClass: 'DDFADHOC', reportClass: null, children: [] });
    for (let i = 0; i < 30; i++) free = step(free, [], MIDWEST);
    const definition = structuredClone(free.wlm.definition);
    definition.resourceGroups = [{ id: 'RGDDFADH', type, min: null, max }];
    for (const c of definition.classes) if (['TSO', 'DEVBAT', 'DDFADHOC'].includes(c.id)) c.resourceGroup = 'RGDDFADH';
    let capped = applyCommands(free, [{ kind: 'ACTIVATE_POLICY', definition }]);
    const cpc = capped.config.cpcs.find((c) => c.id === capped.config.lpars.find((l) => l.id === 'PROD2')!.cpcId)!;
    const limit = type === 1 ? max / suPerCpuSecOf(cpc) : type === 2 ? poolEntitlement(cpc, capped.config.lpars, 'PROD2', 'CP') * max / 100 : max / 100;
    for (let i = 0; i < 120; i++) {
      free = step(free, [], MIDWEST);
      const prev = capped;
      capped = step(capped, [], MIDWEST);
      const rt = capped.lpars.find((l) => l.id === 'PROD2')!;
      const freeRt = free.lpars.find((l) => l.id === rt.id)!;
      const cp = rt.pools.find((p) => p.pool === 'CP')!;
      expect(cp.deliveredEngines).toBeLessThanOrEqual(freeRt.pools.find((p) => p.pool === 'CP')!.deliveredEngines + 1e-8);
      expect(rt.msuRate).toBeLessThanOrEqual(freeRt.msuRate + 1e-8);
      expect(rt.msuRate).toBeCloseTo(cp.deliveredEngines * msuPerCp(cpc), 8);
      const sys = capped.wlm.systems.find((s) => s.lparId === rt.id)!;
      const oldSys = prev.wlm.systems.find((s) => s.lparId === rt.id)!;
      const used = (keys: string[]) => sys.scps.filter((s) => keys.includes(s.scKey.split('#')[0]!)).reduce((sum, s) => sum + s.acc.cpuEngines - (oldSys.scps.find((x) => x.scKey === s.scKey)?.acc.cpuEngines ?? 0) * ACC_DECAY, 0);
      expect(used(['TSO', 'DEVBAT', 'DDFADHOC'])).toBeLessThanOrEqual(limit + 1e-8);
      expect(cp.effectiveEngines).toBeCloseTo(used(sys.scps.map((s) => s.scKey.split('#')[0]!)), 8);
    }
    const uncapped = applyCommands(capped, [{ kind: 'ACTIVATE_POLICY', definition: free.wlm.definition }]);
    expect(step(uncapped, [], MIDWEST).lpars.find((l) => l.id === 'PROD2')!.msuRate).toBeGreaterThan(capped.lpars.find((l) => l.id === 'PROD2')!.msuRate);
  });
});
