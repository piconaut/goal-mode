import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { addPin } from '../../src/game/evidence';
import { newRun } from '../../src/game/run';
import { accumulateHour, newHour } from '../../src/game/run/hourly';
import { fallbackTrigger } from '../../src/game/sla';
import { db2Accounting, db2Blockers, db2Statistics } from '../../src/game/smf';
import { tickOfClock } from '../../src/sim/core/clock';
import type { Command } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import type { Scenario } from '../../src/sim/core/scenario';
import { step } from '../../src/sim/core/step';
import type { SimState } from '../../src/sim/core/types';
import type { Db2Isolation } from '../../src/sim/subsys/db2Contention';

const profile = MIDWEST.db2Contention!;
const start = tickOfClock('D1 14:48')!;
const startDrain = tickOfClock('D1 14:50')!;

function scenario(isolation: Db2Isolation, kind = profile.drain.kind): Scenario {
  return { ...MIDWEST, db2Contention: { ...profile, isolation, drain: { ...profile.drain, kind } } };
}

function fixture(s: Scenario) {
  const state = { ...initState(42, s), tick: start };
  const capped = structuredClone(state.wlm.definition);
  const ddf = capped.classes.find((c) => c.id === 'DDFPRD')!;
  capped.classes.push({ ...structuredClone(ddf), id: 'BI', resourceGroup: 'BICAP' });
  capped.resourceGroups = [{ id: 'BICAP', type: 3, min: null, max: 5 }];
  capped.subsystems.find((x) => x.subsystem === 'DDF')!.rules.unshift({
    qualifier: 'UI', pattern: 'BIUSER', serviceClass: 'BI', reportClass: null, children: [],
  });
  return { state, capped, free: state.wlm.definition };
}

function until(state: SimState, tick: number, s: Scenario, cmds: readonly Command[] = []): SimState {
  if (state.tick < tick) state = step(state, cmds, s);
  while (state.tick < tick) state = step(state, [], s);
  return state;
}

const reader = (x: SimState) => x.env.db2Contention?.readers.DB1B;
const stats = (x: SimState) => x.last.db2Contention?.DB1B;
const lock = (x: SimState, id = 'RBANK') => {
  const w = x.last.workloads.find((r) => r.id === id)!;
  return ((w.parts.lock ?? 0) + (w.parts.ddfLock ?? 0)) / Math.max(1, w.completions);
};

describe('PT-51 Db2 reader and drain', () => {
  it.each(['CS', 'RR', 'UR'] as const)('stretches %s claims under a cap and releases after service is restored', (isolation) => {
    const s = scenario(isolation);
    const { state, capped, free } = fixture(s);
    const normal = until(state, startDrain, s);
    const pressured = until(state, startDrain, s, [{ kind: 'ACTIVATE_POLICY', definition: capped }]);
    expect(reader(pressured)!.count).toBeGreaterThan((reader(normal)?.count ?? 0) + 1);
    expect(reader(pressured)!.ageSec).toBeGreaterThan(10);
    expect(reader(pressured)!.capFrac).toBeGreaterThan(0.5);
    if (isolation === 'UR') expect(lock(pressured)).toBeCloseTo(lock(normal), 8);
    else expect(lock(pressured)).toBeGreaterThan(lock(normal) + (isolation === 'RR' ? 0.02 : 0.01));

    const draining = step(pressured, [], s);
    expect(draining.env.db2Contention?.drain?.phase).toBe('WAITING');
    expect(stats(draining)?.claimReleaseWaitSec).toBe(10);
    expect(stats(draining)?.drainLockWaitSec).toBeGreaterThan(0);
    expect(reader(draining)!.pending).toBeGreaterThan(0);
    const recovered = until(draining, startDrain + 11, s, [{ kind: 'ACTIVATE_POLICY', definition: free }]);
    expect(recovered.env.db2Contention?.drain).toBeUndefined();
    expect(reader(recovered)?.pending ?? 0).toBe(0);
    expect(lock(recovered)).toBeLessThan(0.02);
  });

  it('isolates writers-only drains and disjoint work from the reader', () => {
    const s = scenario('CS', 'WRITERS');
    const { state, capped } = fixture(s);
    const pressured = until(state, startDrain, s, [{ kind: 'ACTIVATE_POLICY', definition: capped }]);
    const next = step(pressured, [], s);
    expect(reader(next)!.count).toBeGreaterThan(0);
    expect(reader(next)!.pending).toBe(0);
    expect(stats(next)?.claimReleaseWaitSec).toBe(0);
    expect(next.env.db2Contention?.drain?.phase).toBe('DRAINED');
    expect(lock(next, 'CARDAUTH')).toBe(0); // Another object, same members.
    const outside = step(pressured, [{ kind: 'SET_ROUTING', workloadId: 'RBANK', routing: { DEVT: 1 } }], s);
    expect(lock(outside)).toBe(0); // Same workload, an independent Db2.
  });

  it('leaves waiters at MAXDBAT unattached and reopens a timed-out utility drain', () => {
    const s = scenario('CS');
    const { state, capped } = fixture(s);
    const pressured = until(state, startDrain - 4, s, [{ kind: 'ACTIVATE_POLICY', definition: capped }]);
    const full = step(pressured, [{ kind: 'SET_DB2', ssid: 'DB1B', maxDbat: 1 }], s);
    expect(full.last.lpars.find((l) => l.lparId === 'PROD2')!.dbatWaited).toBeGreaterThan(0);
    expect(stats(full)?.claims ?? 0).toBe(0);
    expect(reader(full)!.count).toBeLessThanOrEqual(reader(pressured)!.count);
    const reopened = step(full, [{ kind: 'SET_DB2', ssid: 'DB1B', maxDbat: 400 }], s);
    expect(stats(reopened)?.claims).toBeGreaterThan(0);
    expect(reader(reopened)?.dbatQueued ?? 0).toBeLessThan(reader(full)!.dbatQueued);
    const timeoutTick = startDrain + s.db2Contention!.drain.waitSec / 10;
    const timedOut = until(pressured, timeoutTick + 1, s);
    expect(stats(timedOut)?.failedDrains).toBe(1);
    expect(timedOut.env.db2Contention?.drain).toBeUndefined();
    expect(reader(timedOut)?.pending ?? 0).toBe(0);
    expect(stats(timedOut)?.claims).toBeGreaterThan(0);
  });

  it('keeps existing holds on their member when new work is routed away, and pins the real holder', () => {
    const s = scenario('RR');
    const { state, capped } = fixture(s);
    const pressured = until(state, startDrain, s, [{ kind: 'ACTIVATE_POLICY', definition: capped }]);
    const moved = step(pressured, [{ kind: 'SET_ROUTING', workloadId: 'ADHOC', routing: { PROD1: 1 } }], s);
    expect(reader(moved)!.count).toBeGreaterThan(0);
    expect(reader(moved)!.count).toBeLessThan(reader(pressured)!.count);
    const hour = newHour(moved.tick - 1);
    const run = accumulateHour({ ...newRun(s, MIDWEST_GAME, 42), sim: moved, hour }, hour);
    const snapshot = db2Blockers(run, s);
    expect(snapshot.drain).toMatchObject({ member: 'DB1B', phase: 'WAITING', object: profile.object });
    const row = snapshot.rows.find((r) => r.member === 'DB1B' && r.type === 'REPEATABLE READ LOCK')!;
    expect(row).toMatchObject({ workloadId: 'ADHOC', lparId: 'PROD2', object: profile.object, ageSec: reader(moved)!.ageSec });
    const pin = addPin(run, s, { source: 'DB2_BLOCKERS', member: row.member, holderType: row.type, tick: moved.tick });
    expect(pin.ok).toBe(true);
    expect(pin.run.pins!.at(-1)?.text).toContain(`ADHOC on DB1B / PROD2 held REPEATABLE READ LOCK on ${profile.object}`);
    expect(db2Accounting(run, s, 'current').find((r) => r.workloadId === 'RBANK')?.lockMs).toBeGreaterThan(0);
    expect(db2Statistics(run, s, 'current').find((r) => r.ssid === 'DB1B')?.contention).toEqual(stats(moved));
    expect(fallbackTrigger('LOCK_CONTENTION', run.hour!, false, 'RBANK')).toBe('POLICY');
  });
});
