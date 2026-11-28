import { describe, expect, it } from 'vitest';
import { STC_AUTOMATION } from '../../src/content/entities';
import { MIDWEST } from '../../src/content/scenarios';
import { applyCommand } from '../../src/sim/core/commands';
import { applyOperation, operatorRoster } from '../../src/sim/core/operations';
import { initState } from '../../src/sim/core/init';
import { lockBoostNow, step } from '../../src/sim/core/step';
import { aorFailFrac, effectiveAddressSpaces } from '../../src/sim/core/tick/helpers';
import type { EntityLoad, SimState } from '../../src/sim/core/types';
import { TICK_SEC } from '../../src/sim/core/units';
import type { JobRuntime } from '../../src/sim/subsys/batch';

const fresh = (): SimState => initState(1, MIDWEST);
const load = (over: Partial<EntityLoad> = {}): EntityLoad => ({ tag: 'c1', kind: 'TSO_USER', id: 'DEV001', workloadId: 'TSO', lparId: 'DEVT', cpEngines: 0.5, ziipEngines: 0, ...over });
const base = MIDWEST.addressSpaces;

describe('entity loads', () => {
  it('SET_ENTITY_LOAD replaces the same load and keeps others', () => {
    let s = applyCommand(fresh(), { kind: 'SET_ENTITY_LOAD', load: load() }).state;
    s = applyCommand(s, { kind: 'SET_ENTITY_LOAD', load: load({ id: 'DEV002' }) }).state;
    s = applyCommand(s, { kind: 'SET_ENTITY_LOAD', load: load({ tag: 'c2' }) }).state;
    s = applyCommand(s, { kind: 'SET_ENTITY_LOAD', load: load({ cpEngines: 2.5, ziipEngines: 0.5 }) }).state;
    expect(s.entityLoads).toHaveLength(3);
    expect(s.entityLoads!.find((l) => l.tag === 'c1' && l.id === 'DEV001')).toMatchObject({ cpEngines: 2.5, ziipEngines: 0.5 });
    expect(s.entityLoads!.some((l) => l.id === 'DEV002')).toBe(true);
    expect(s.entityLoads!.some((l) => l.tag === 'c2')).toBe(true);
  });

  it('CLEAR_ENTITY_LOADS removes only that tag and drops the field when empty', () => {
    let s = applyCommand(fresh(), { kind: 'SET_ENTITY_LOAD', load: load() }).state;
    s = applyCommand(s, { kind: 'SET_ENTITY_LOAD', load: load({ tag: 'c2' }) }).state;
    s = applyCommand(s, { kind: 'CLEAR_ENTITY_LOADS', tag: 'c1' }).state;
    expect(s.entityLoads!.map((l) => l.tag)).toEqual(['c2']);
    s = applyCommand(s, { kind: 'CLEAR_ENTITY_LOADS', tag: 'c2' }).state;
    expect('entityLoads' in s).toBe(false);
  });

  it('a loaded entity stays listed and cancellable when its workload is routed away (RF-11)', () => {
    const before = operatorRoster(fresh(), MIDWEST, 'TSO_USER', 'TSO').find((e) => e.lparId === 'DEVT');
    expect(before).toBeDefined();
    // Route TSO off the test image after the card put its load there: the day's roster no longer deals DEVT entries.
    const moved = applyCommand(fresh(), { kind: 'SET_ROUTING', workloadId: 'TSO', routing: { DEVT: 0, PROD1: 1, PROD2: 0 } }).state;
    expect(operatorRoster(moved, MIDWEST, 'TSO_USER', 'TSO').some((e) => e.lparId === 'DEVT')).toBe(false);
    const loaded = applyCommand(moved, { kind: 'SET_ENTITY_LOAD', load: load({ id: before!.id }) }).state;
    expect(operatorRoster(loaded, MIDWEST, 'TSO_USER', 'TSO')).toContainEqual(
      expect.objectContaining({ kind: 'TSO_USER', id: before!.id, workloadId: 'TSO', lparId: 'DEVT', day: 0 }),
    );
    const r = applyOperation(loaded, MIDWEST, { kind: 'CANCEL_SESSION', target: { kind: 'TSO_USER', id: before!.id, workloadId: 'TSO', lparId: 'DEVT', day: 0 } });
    expect(r.ok).toBe(true);
    expect(r.state.entityLoads).toBeUndefined();
  });
});

describe('CANCEL_ADDRESS_SPACE', () => {
  const cancel = (s: SimState, jobname: string, lparId = 'PROD1') => applyCommand(s, { kind: 'CANCEL_ADDRESS_SPACE', jobname, lparId }, base);

  it('refuses non-cancelable programs, role servers, jobnames not on the image, and a second cancel', () => {
    const s = fresh();
    for (const j of STC_AUTOMATION.noCancel) expect(cancel(s, j).ok).toBe(false);
    const db = base.find((a) => a.lparId === 'PROD1' && a.role === 'DB2.DBM1')!;
    expect(cancel(s, db.jobname).ok).toBe(false);
    expect(cancel(s, 'NOSUCHJB').ok).toBe(false);
    expect(cancel(s, 'MONAGENT', 'NOSUCHLP').ok).toBe(false);
    const once = cancel(s, 'MONAGENT');
    expect(once.ok).toBe(true);
    expect(cancel(once.state, 'MONAGENT').ok).toBe(false);
  });

  it('restarts a STC after restartMin: out of effectiveAddressSpaces meanwhile, back after restartTick', () => {
    const s0 = fresh();
    const r = cancel(s0, 'CICSXLOG');
    expect(r.ok).toBe(true);
    const restartTick = s0.tick + Math.ceil((STC_AUTOMATION.restartMin * 60) / TICK_SEC);
    expect(r.state.cancelledAddressSpaces).toEqual([{ jobname: 'CICSXLOG', lparId: 'PROD1', restartTick }]);
    const has = (s: SimState) => effectiveAddressSpaces(MIDWEST, s).some((a) => a.jobname === 'CICSXLOG' && a.lparId === 'PROD1');
    expect(has(s0)).toBe(true);
    expect(has(r.state)).toBe(false);

    let s = r.state;
    while (s.tick <= restartTick) {
      expect(s.cancelledAddressSpaces).toBeDefined();
      s = step(s, [], MIDWEST);
    }
    // The restart runs at the start of the first step whose tick is >= restartTick.
    s = step(s, [], MIDWEST);
    expect(s.cancelledAddressSpaces).toBeUndefined();
    expect(has(s)).toBe(true);
  });

  it('without a base list any jobname is accepted and restarts as a STC', () => {
    const r = applyCommand(fresh(), { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'ANYTHING', lparId: 'PROD1' });
    expect(r.ok).toBe(true);
    expect(r.state.cancelledAddressSpaces![0]!.restartTick).not.toBeNull();
  });
});

describe('SET_UTILITY_OVERRUN', () => {
  it('sets, replaces and clears an overrun', () => {
    let s = applyCommand(fresh(), { kind: 'SET_UTILITY_OVERRUN', utility: 'REORG', seqIops: 55_000 }).state;
    expect(s.utilityOverruns).toEqual([{ kind: 'REORG', seqIops: 55_000 }]);
    s = applyCommand(s, { kind: 'SET_UTILITY_OVERRUN', utility: 'COPY', seqIops: 100 }).state;
    s = applyCommand(s, { kind: 'SET_UTILITY_OVERRUN', utility: 'REORG', seqIops: 1 }).state;
    expect(s.utilityOverruns).toHaveLength(2);
    expect(s.utilityOverruns!.find((o) => o.kind === 'REORG')!.seqIops).toBe(1);
    s = applyCommand(s, { kind: 'SET_UTILITY_OVERRUN', utility: 'REORG', seqIops: null }).state;
    s = applyCommand(s, { kind: 'SET_UTILITY_OVERRUN', utility: 'COPY', seqIops: null }).state;
    expect('utilityOverruns' in s).toBe(false);
  });
});

describe('lock boost holder', () => {
  const holder = { stream: 'SETTLE', object: 'SETTLE.POSTINGS' };

  it('keeps the holder when the command omits it, clears it with null or a zero value', () => {
    let s = applyCommand(fresh(), { kind: 'SET_LOCK_BOOST', value: 3, holder }).state;
    expect(s.mods.lockHolder).toEqual(holder);
    s = applyCommand(s, { kind: 'SET_LOCK_BOOST', value: 4 }).state;
    expect(s.mods).toMatchObject({ lockBoost: 4, lockHolder: holder });
    expect(applyCommand(s, { kind: 'SET_LOCK_BOOST', value: 4, holder: null }).state.mods.lockHolder).toBeUndefined();
    const zero = applyCommand(s, { kind: 'SET_LOCK_BOOST', value: 0 }).state;
    expect(zero.mods.lockHolder).toBeUndefined();
    expect(zero.mods.lockBoost).toBe(0);
  });

  it('lockBoostNow is full without a holder, 0 while the holder stream has no running job, full when one runs', () => {
    const job = (stream: string, status: JobRuntime['status']) => ({ status, def: { stream } }) as unknown as JobRuntime;
    const plain = applyCommand(fresh(), { kind: 'SET_LOCK_BOOST', value: 3 }).state;
    expect(lockBoostNow(plain, [])).toBe(3);
    const held = applyCommand(fresh(), { kind: 'SET_LOCK_BOOST', value: 3, holder }).state;
    expect(lockBoostNow(held, [])).toBe(0);
    expect(lockBoostNow(held, [job('SETTLE', 'QUEUED'), job('OTHER', 'RUNNING')])).toBe(0);
    expect(lockBoostNow(held, [job('OTHER', 'RUNNING'), job('SETTLE', 'RUNNING')])).toBe(3);
  });
});

describe('aorFailFrac', () => {
  const aors = [{ name: '1' }, { name: '3' }, { name: '5' }, { name: '7' }];

  it('is the mean over the AORs, lists only sick regions and clamps to [0,1]', () => {
    const r = aorFailFrac({ 'CARD@1': 0.5, 'CARD@3': 2, 'CARD@5': 0, 'OTHER@7': 1 }, 'CARD', aors);
    expect(r.byRegion).toEqual([['1', 0.5], ['3', 1]]);
    expect(r.imageFrac).toBeCloseTo(1.5 / 4, 12);
    expect(aorFailFrac({}, 'CARD', aors)).toEqual({ imageFrac: 0, byRegion: [] });
    expect(aorFailFrac({ 'CARD@1': 1 }, 'CARD', []).imageFrac).toBe(0);
  });
});
