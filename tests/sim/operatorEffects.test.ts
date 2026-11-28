import { describe, expect, it } from 'vitest';
import { CICS_RECYCLE, HSM_RECALL } from '../../src/content/operations';
import { MIDWEST } from '../../src/content/scenarios';
import { initState } from '../../src/sim/core/init';
import { applyCommands } from '../../src/sim/core/commands';
import { step } from '../../src/sim/core/step';
import { applyOperation, type GatewayMode } from '../../src/sim/core/operations';
import { activeRecycle, failHeldRecalls, gatewayTraffic, hsmIo, recycleRouting, startRecycles } from '../../src/sim/core/tick/operatorEffects';
import type { SimState } from '../../src/sim/core/types';
import { TICK_SEC } from '../../src/sim/core/units';
import type { JobRuntime } from '../../src/sim/subsys/batch';
import { leakedMb } from '../../src/sim/subsys/cics';

const fresh = (): SimState => ({ ...initState(42, MIDWEST), tick: 100 });
const targets = MIDWEST.world.cics.slice(0, 2).map(({ name, lparId }) => ({ name, lparId }));
const cicsWork = MIDWEST.workloads.find((w) => w.subsystem === 'CICS')!;

describe('rolling CICS recycle game rules', () => {
  it('keeps one selected region down at a time and restores the routing pool afterward', () => {
    const result = applyOperation(fresh(), MIDWEST, { kind: 'RECYCLE_CICS', targets });
    expect(result.ok).toBe(true);
    const [first, second] = result.state.cicsRecycles!;
    expect(first!.startTick).toBe(100);
    expect(first!.restartTick - first!.startTick).toBe(CICS_RECYCLE.restartMin * 60 / TICK_SEC);
    expect(second!.startTick).toBe(first!.restartTick);
    for (const tick of [first!.startTick, first!.restartTick, second!.restartTick]) {
      const s = startRecycles({ ...result.state, tick });
      const down = s.cicsRecycles?.filter((r) => activeRecycle(r, tick)) ?? [];
      expect(down).toHaveLength(tick < second!.restartTick ? 1 : 0);
      const routed = recycleRouting(s, [cicsWork], MIDWEST.addressSpaces, { [cicsWork.id]: 100 });
      expect(routed.config.cics).toHaveLength(s.config.cics.length - down.length);
      for (const region of down) {
        expect(routed.addressSpaces.some((a) => a.jobname === region.name && a.lparId === region.lparId)).toBe(false);
      }
      const routing = routed.workloads[0]!.routing;
      expect(Object.values(routing).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      if (down.length) expect(routing[targets[0]!.lparId]).toBeLessThan(cicsWork.routing[targets[0]!.lparId]!);
      else expect(routing).toEqual(cicsWork.routing);
    }
  });

  it('fails work even when the chosen region is healthy; in-flight failures occur only at shutdown', () => {
    const s = startRecycles(applyOperation(fresh(), MIDWEST, { kind: 'RECYCLE_CICS', targets: [targets[0]!] }).state);
    const rates = { [cicsWork.id]: 100 };
    const initial = recycleRouting(s, [cicsWork], MIDWEST.addressSpaces, rates);
    const laterRates = { [cicsWork.id]: 100 };
    const later = recycleRouting({ ...s, tick: s.tick + 1 }, [cicsWork], MIDWEST.addressSpaces, laterRates);
    expect(initial.failed![cicsWork.id]).toBeGreaterThan(later.failed![cicsWork.id]!);
    expect(later.failed![cicsWork.id]).toBeGreaterThan(0);
    expect(rates[cicsWork.id]).toBeLessThan(100);
    expect(rates[cicsWork.id]).toBe(laterRates[cicsWork.id]);
  });

  it('clears only selected sickness and resets storage without removing the continuing leak', () => {
    const s = fresh();
    s.config.cics[0]!.leak = { startMb: 300, mbPerHour: 60, sinceTick: 0 };
    s.config.cics[1]!.leak = { startMb: 200, mbPerHour: 30, sinceTick: 0 };
    s.mods.aorFailFrac = { [`${cicsWork.id}@${targets[0]!.name}`]: 0.9, [`${cicsWork.id}@${targets[1]!.name}`]: 0.5 };
    const started = startRecycles(applyOperation(s, MIDWEST, { kind: 'RECYCLE_CICS', targets: [targets[0]!] }).state);
    const restartTick = started.cicsRecycles![0]!.restartTick;
    const region = started.config.cics[0]!;
    expect(leakedMb(region, restartTick, TICK_SEC)).toBe(0);
    expect(leakedMb(region, restartTick + 3600 / TICK_SEC, TICK_SEC)).toBe(60);
    expect(started.config.cics[1]!.leak).toEqual(s.config.cics[1]!.leak);
    expect(started.mods.aorFailFrac).toEqual({ [`${cicsWork.id}@${targets[1]!.name}`]: 0.5 });
    expect(s.config.cics[0]!.leak.startMb).toBe(300);
  });

  it('refuses missing and duplicate targets without partially scheduling a shutdown', () => {
    const s = fresh();
    for (const selected of [[], [targets[0]!, targets[0]!], [targets[0]!, { name: 'MISSING', lparId: targets[0]!.lparId }]]) {
      const result = applyOperation(s, MIDWEST, { kind: 'RECYCLE_CICS', targets: selected });
      expect(result.ok).toBe(false);
      expect(result.state).toBe(s);
      expect(s.cicsRecycles).toBeUndefined();
    }
  });
});

describe('gateway protection game rules', () => {
  it.each<GatewayMode>(['LIMIT', 'BACKOFF', 'BLOCK'])('%s sheds legitimate work on a quiet channel', (mode) => {
    const traffic = gatewayTraffic(mode, 100, 0);
    expect(traffic.failedRate).toBeGreaterThan(0);
    expect(traffic.admittedRate + traffic.failedRate).toBeCloseTo(100);
  });

  it('backoff suppresses retries while source blocking removes attack traffic', () => {
    const retry = gatewayTraffic('BACKOFF', 200, 20, { retryRateMult: 2 });
    const retryLimit = gatewayTraffic('LIMIT', 200, 20, { retryRateMult: 2 });
    const retryBlock = gatewayTraffic('BLOCK', 200, 20, { retryRateMult: 2 });
    expect(retry.admittedRate).toBeLessThan(retryLimit.admittedRate);
    expect(retryLimit.admittedRate).toBeLessThan(retryBlock.admittedRate);
    expect(retry.admittedRate + retry.failedRate).toBeLessThan(220);
    const attackBlock = gatewayTraffic('BLOCK', 200, 0, { attackRateMult: 2 });
    const attackBackoff = gatewayTraffic('BACKOFF', 200, 0, { attackRateMult: 2 });
    const attackLimit = gatewayTraffic('LIMIT', 200, 0, { attackRateMult: 2 });
    expect(attackBlock.admittedRate).toBeLessThan(attackLimit.admittedRate);
    expect(attackLimit.admittedRate).toBeLessThan(attackBackoff.admittedRate);
    expect(attackBlock.failedRate).toBeGreaterThan(0);
    expect(attackBlock.failedRate).toBeLessThan(attackLimit.failedRate);
    expect(attackLimit.admittedRate + attackLimit.failedRate).toBe(200);
  });

  it('toggles a healthy external channel and refuses internal work', () => {
    const s = fresh();
    const enabled = applyOperation(s, MIDWEST, { kind: 'SET_GATEWAY', workloadId: cicsWork.id, mode: 'BLOCK' });
    expect(enabled.ok).toBe(true);
    expect(enabled.state.gatewayModes?.[cicsWork.id]).toBe('BLOCK');
    expect(applyOperation(enabled.state, MIDWEST, { kind: 'SET_GATEWAY', workloadId: cicsWork.id, mode: 'BLOCK' }).ok).toBe(false);
    const disabled = applyOperation(enabled.state, MIDWEST, { kind: 'SET_GATEWAY', workloadId: cicsWork.id, mode: null });
    expect(disabled.ok).toBe(true);
    expect(disabled.state.gatewayModes).toBeUndefined();
    const internal = MIDWEST.workloads.find((w) => w.stakeholder === 'Internal')!;
    expect(applyOperation(s, MIDWEST, { kind: 'SET_GATEWAY', workloadId: internal.id, mode: 'LIMIT' }).ok).toBe(false);
  });
});

describe('DFSMShsm recall game rules', () => {
  it('holds incoming I/O, preserves other LCUs, and caps backlog replay after release', () => {
    const s = fresh();
    const lcu = s.config.dasd.lcus.find((l) => l.id === HSM_RECALL.lcuId)!;
    const incomingIops = HSM_RECALL.drainIops * 3;
    lcu.extraIops = { RANDOM: incomingIops };
    const held = applyOperation(s, MIDWEST, { kind: 'HOLD_HSM_RECALL', held: true });
    expect(held.ok).toBe(true);
    expect(applyOperation(held.state, MIDWEST, { kind: 'HOLD_HSM_RECALL', held: true }).ok).toBe(false);
    const paused = hsmIo(held.state);
    expect(paused.dasd.lcus.find((l) => l.id === lcu.id)!.extraIops!.RANDOM).toBe(0);
    expect(paused.recalls!.backlogIo).toBe(incomingIops * TICK_SEC);
    expect(paused.dasd.lcus.filter((l) => l.id !== lcu.id)).toEqual(s.config.dasd.lcus.filter((l) => l.id !== lcu.id));
    expect(lcu.extraIops.RANDOM).toBe(incomingIops);
    const released = applyOperation({ ...held.state, hsmRecalls: paused.recalls }, MIDWEST, { kind: 'HOLD_HSM_RECALL', held: false });
    expect(released.ok).toBe(true);
    const replay = hsmIo(released.state);
    expect(replay.dasd.lcus.find((l) => l.id === lcu.id)!.extraIops!.RANDOM).toBe(incomingIops + HSM_RECALL.drainIops);
    expect(replay.recalls!.backlogIo).toBe(paused.recalls!.backlogIo - HSM_RECALL.drainIops * TICK_SEC);
    const last = hsmIo({ ...released.state, hsmRecalls: { heldSinceTick: null, backlogIo: 5 * TICK_SEC } });
    expect(last.dasd.lcus.find((l) => l.id === lcu.id)!.extraIops!.RANDOM).toBe(incomingIops + 5);
    expect(last.recalls).toBeUndefined();
  });

  it('fails a deterministic subset of new I/O batch jobs, but leaves existing, queued and CPU-only work alone', () => {
    const s = applyOperation(fresh(), MIDWEST, { kind: 'HOLD_HSM_RECALL', held: true }).state;
    const def = MIDWEST.batchNetwork(s.seed, 0, 1)[0]!;
    const jobs: JobRuntime[] = Array.from({ length: 100 }, (_, i) => ({
      day: 0, def: { ...def, name: `RECALL${i}`, ioCount: 100 }, status: 'RUNNING', lparId: 'PROD1',
      progress: 0, queuedTick: s.tick, startTick: s.tick, endTick: null, stretch: 1,
    }));
    const replay = structuredClone(jobs);
    failHeldRecalls(s, jobs);
    failHeldRecalls(s, replay);
    expect(replay).toEqual(jobs);
    const failed = jobs.filter((j) => j.status === 'ABENDED');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.length).toBeLessThan(jobs.length);
    expect(failed[0]).toMatchObject({ abended: true, failCode: 'HSM RECALL HELD', failTick: s.tick, endTick: s.tick + 1 });
    const eligible = { ...failed[0]!, status: 'RUNNING' as const };
    const safe: JobRuntime[] = [
      { ...eligible, startTick: s.tick - 1 },
      { ...eligible, status: 'QUEUED' },
      { ...eligible, def: { ...eligible.def, ioCount: 0 } },
    ];
    const before = structuredClone(safe);
    failHeldRecalls(s, safe);
    expect(safe).toEqual(before);
    const released = [{ ...eligible }];
    failHeldRecalls({ ...s, hsmRecalls: { heldSinceTick: null, backlogIo: 100 } }, released);
    expect(released[0]!.status).toBe('RUNNING');
  });
});

describe('RMF interval scheduling', () => {
  it('ends on the clock grid when the interval length changes mid-interval', () => {
    // The Postprocessor interval is Monitor I's and ends on the clock grid; a length change closes the next
    // interval on the new grid, not one new interval after the command (the command text: next interval boundary).
    let s = initState(42, MIDWEST);
    while (s.tick < 100) s = step(s, [], MIDWEST);
    s = applyCommands(s, [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }]);
    while (s.tick < 450) s = step(s, [], MIDWEST);
    expect(s.rmf.intervals.map((iv) => iv.endTick)).toEqual([180, 270, 360, 450]);
  });
});
