import { MIDWEST } from '../../src/content/scenarios';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { addPin, incidentSubjects } from '../../src/game/evidence';
import { judgeProof } from '../../src/game/proof';
import { newRun } from '../../src/game/run';
import { accumulateHour, newHour } from '../../src/game/run/hourly';
import { fallbackTrigger } from '../../src/game/sla';
import { db2Accounting, db2Blockers, db2Statistics } from '../../src/game/smf';
import type { Incident } from '../../src/game/types';
import { tickOfClock } from '../../src/sim/core/clock';
import type { Command } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import type { Scenario } from '../../src/sim/core/scenario';
import { step } from '../../src/sim/core/step';
import type { SimState } from '../../src/sim/core/types';
import type { Db2Isolation } from '../../src/sim/subsys/db2Contention';
import { truthOf } from '../helpers/truth';

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
    const holder = reader(pressured)!;
    expect(holder.count).toBeGreaterThan((reader(normal)?.count ?? 0) + 1);
    expect(holder.ageSec).toBeGreaterThan(10);
    expect(holder.capFrac).toBeGreaterThan(0.5);
    expect(holder.workByPeriod[0]?.cpRefSec).toBeGreaterThan(0);
    expect(holder.workByPeriod.reduce((sum, p) => sum + p.cpRefSec, 0)).toBeCloseTo(holder.cpRefSec, 8);
    expect(holder.workByPeriod.reduce((sum, p) => sum + p.ziipRefSec, 0)).toBeCloseTo(holder.ziipRefSec, 8);
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
    // RF-10: a writers-only drain still stops the write class; a posting waits out its run window.
    const rbank = next.last.workloads.find((w) => w.id === 'RBANK')!;
    expect(rbank.failed).toBe(0);
    expect((rbank.parts.drainLock ?? 0) / rbank.completions).toBeCloseTo(profile.writes.RBANK! * profile.drain.runSec, 8);
    const outside = step(pressured, [{ kind: 'SET_ROUTING', workloadId: 'RBANK', routing: { DEVT: 1 } }], s);
    expect(lock(outside)).toBe(0); // Same workload, an independent Db2.
    expect(outside.last.workloads.find((w) => w.id === 'RBANK')!.parts.drainLock ?? 0).toBe(0);
  });

  it('holds posting claims during an all-class drain and times them out past the resource timeout', () => {
    const s = scenario('CS');
    const { state, capped } = fixture(s);
    const pressured = until(state, startDrain, s, [{ kind: 'ACTIVATE_POLICY', definition: capped }]);
    const draining = step(pressured, [], s);
    expect(draining.env.db2Contention?.drain?.phase).toBe('WAITING');
    const blocked = draining.last.workloads.find((w) => w.id === 'RBANK')!;
    // The remaining wait exceeds IRLMRWT's 30 s: the posting share fails instead of completing late.
    expect(blocked.failed).toBeGreaterThan(0);
    expect(blocked.parts.drainLock ?? 0).toBe(0);
    const other = draining.last.workloads.find((w) => w.id === 'CARDAUTH')!;
    expect(other.failed).toBe(0);
    expect(other.parts.drainLock ?? 0).toBe(0);
    // In the drain's last wait ticks a posting's hold is under the timeout, so it commits and SMF 101 shows the wait.
    const late = until(pressured, startDrain + 10, s);
    expect(late.env.db2Contention?.drain?.phase).toBe('WAITING');
    const rbank = late.last.workloads.find((w) => w.id === 'RBANK')!;
    expect(rbank.failed).toBe(0);
    expect((rbank.parts.drainLock ?? 0) / rbank.completions)
      .toBeCloseTo(profile.writes.RBANK! * profile.claimTimeoutSec, 8);
    // The hold stays in the response time and SMF 101, but not in the CICS task-slot hold: no MXT queue.
    expect(Object.keys(late.env.slotQueue ?? {}).filter((k) => k.endsWith(':MXT'))).toEqual([]);
    const hour = newHour(late.tick - 1);
    const run = accumulateHour({ ...newRun(s, MIDWEST_GAME, 42), sim: late, hour }, hour);
    expect(db2Accounting(run, s, 'current').find((r) => r.workloadId === 'RBANK')?.drainLockMs ?? 0)
      .toBeGreaterThan(20000);
    expect(stats(late)?.drainLockWaitSec ?? 0).toBeGreaterThan(0);
  });

  it('waits an all-class drain for a posting claim the sim granted over the tick boundary', () => {
    const s = scenario('CS');
    const { state } = fixture(s);
    // Two ticks before the drain, inflate the posting's unit of work; the next tick records its claim.
    const before = until(state, startDrain - 2, s);
    const loaded = step(before, [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'RBANK', value: 5000 }], s);
    const claimed = step(loaded, [], s);
    expect(claimed.env.db2Contention?.writerClaims?.heldUntilTick).toBeGreaterThan(claimed.tick);
    const draining = step(claimed, [], s);
    expect(draining.env.db2Contention?.drain?.phase).toBe('WAITING');
    expect(stats(draining)?.claimReleaseWaitSec).toBe(10);
  });

  it('does not hold a drain for a stale response time when postings are no longer arriving', () => {
    const s = scenario('CS');
    const { state } = fixture(s);
    const before = until(state, startDrain - 2, s);
    // A previous slow unit of work is still in the per-lpar RT map, but no posting arrives now.
    const stale = {
      ...before,
      env: {
        ...before.env,
        rtByWorkloadLpar: { ...before.env.rtByWorkloadLpar, 'RBANK@PROD1': 60, 'RBANK@PROD2': 60 },
      },
    };
    const stopped = step(stale, [
      { kind: 'SET_MODIFIER', mod: 'rate', key: 'RBANK', value: 0 },
      { kind: 'SET_MODIFIER', mod: 'rate', key: 'TELLER', value: 0 },
      { kind: 'SET_MODIFIER', mod: 'rate', key: 'MOBILE', value: 0 },
    ], s);
    const idle = step(stopped, [], s);
    expect(idle.env.db2Contention?.writerClaims).toBeUndefined();
    const draining = step(idle, [], s);
    expect(draining.env.db2Contention?.drain?.phase).toBe('DRAINED');
  });

  it('waits for a write claim held over the tick boundary before granting a writers-only drain', () => {
    const s = scenario('CS', 'WRITERS');
    const { state } = fixture(s);
    const before = until(state, startDrain, s);
    // A slow posting granted last tick still holds its write claim when the drain starts.
    const slow = {
      ...before,
      env: { ...before.env, db2Contention: { ...before.env.db2Contention!, writerClaims: { heldUntilTick: startDrain + 1 } } },
    };
    const waiting = step(slow, [], s);
    expect(waiting.env.db2Contention?.drain?.phase).toBe('WAITING');
    expect(waiting.last.workloads.find((w) => w.id === 'RBANK')!.failed).toBeGreaterThan(0);
    const granted = step(waiting, [], s);
    expect(granted.env.db2Contention?.drain?.phase).toBe('DRAINED');
    const rbank = granted.last.workloads.find((w) => w.id === 'RBANK')!;
    expect((rbank.parts.drainLock ?? 0) / rbank.completions)
      .toBeCloseTo(profile.writes.RBANK! * profile.drain.runSec, 8);
  });

  it('releases active claims when the runaway query is cancelled', () => {
    const s = scenario('CS');
    const { state, capped } = fixture(s);
    const pressured = until(state, startDrain, s, [{ kind: 'ACTIVATE_POLICY', definition: capped }]);
    const cancelled = step(pressured, [{ kind: 'CANCEL_DB2_READERS', members: ['DB1B'] }], s);
    expect(cancelled.env.db2Contention?.drain?.phase).toBe('DRAINED');
    expect(reader(cancelled)?.count ?? 0).toBe(0);
    expect(cancelled.last.workloads.find((w) => w.id === 'ADHOC')!.failed).toBeGreaterThanOrEqual(reader(pressured)!.count);
    expect(stats(cancelled)?.claimReleaseWaitSec).toBe(0);
  });

  it('keeps outstanding queries within the client pool during sustained capping', () => {
    const s = scenario('CS', 'WRITERS');
    const { state, capped } = fixture(s);
    const pressured = until(state, startDrain + 60, s, [{ kind: 'ACTIVATE_POLICY', definition: capped }]);
    const holder = reader(pressured)!;
    expect(holder.count).toBeGreaterThan(profile.clientConcurrency / 2);
    expect(holder.count + holder.pending + holder.dbatQueued).toBeLessThanOrEqual(profile.clientConcurrency + 1e-9);
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
    expect(addPin(run, s, { source: 'DB2_BLOCKERS', member: row.member, holderType: row.type, tick: moved.tick - 1 })).toMatchObject({
      ok: false, message: 'Refresh the live Db2 blocker snapshot before pinning',
    });
    expect(db2Accounting(run, s, 'current').find((r) => r.workloadId === 'RBANK')?.lockMs).toBeGreaterThan(0);
    const waits = addPin(pin.run, s, { source: 'DB2', workloadId: 'RBANK', hour: 'current', metric: 'LOCK_WAIT' });
    expect(waits.ok).toBe(true);
    const incident: Incident = {
      id: 1, workloadId: 'RBANK', day: 0, startTick: moved.tick - 1, endTick: null, hours: 1,
      worstAttainmentPct: 80, truth: truthOf('LOCK_CONTENTION', 'POLICY'), rca: null, trustLost: 0,
      subjects: incidentSubjects(run, s, 'RBANK', moved.tick),
    };
    expect(judgeProof(waits.run, s, [incident], 'LOCK_CONTENTION', 'POLICY', waits.run.pins!).mechanism.complete).toBe(true);
    expect(db2Statistics(run, s, 'current').find((r) => r.ssid === 'DB1B')?.contention).toEqual(stats(moved));
    expect(fallbackTrigger('LOCK_CONTENTION', run.hour!, false, 'RBANK')).toBe('POLICY');
  });
});
