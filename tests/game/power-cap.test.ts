import { ACQUIRED_APP } from '../../src/content/events/midwest-events';
import { HARBOURLINE_GAME } from '../../src/content/game-harbourline';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { REVENUE_GAME } from '../../src/content/game-revenue';
import { SCENARIOS } from '../../src/content/scenarios';
import { advance, newRun, startDay } from '../../src/game/run';
import { closeHour, newHour } from '../../src/game/run/hourly';
import { triggerOf } from '../../src/game/sla';
import { applyCommands, type Command } from '../../src/sim/core/commands';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const games = { midwest: MIDWEST_GAME, revenue: REVENUE_GAME, harbourline: HARBOURLINE_GAME };

function startCap(id: keyof typeof games, commands: Command[] = [], pendingCommands: Command[] = []) {
  const scenario = SCENARIOS[id]!;
  const game = games[id];
  const def = game.events.find((e) => e.id === 'POWER_CAP')!;
  const run = startDay(newRun(scenario, game, 3), game);
  return advance({
    ...run,
    sim: applyCommands(run.sim, commands),
    pendingCommands: [...run.pendingCommands, ...pendingCommands],
    events: [{
      uid: 'POWER_CAP@0', defId: def.id, name: def.name, startTick: 0, endTick: 6 * TICKS_PER_HOUR,
      trigger: def.trigger, affects: def.affects, mechanisms: def.mechanisms,
      endCommands: def.end, started: false, ended: false,
    }],
  }, scenario, game, 1);
}

describe('power-cap RCA scope', () => {
  it.each(['midwest', 'revenue', 'harbourline'] as const)('only attributes CPU-side incidents in %s to the cap', (id) => {
    const run = startCap(id);
    const workload = SCENARIOS[id]!.workloads[0]!.id;
    for (const mechanism of ['CPU_CAPACITY', 'CPU_PRIORITY', 'CAPPING', 'DEPENDENCY'] as const) {
      expect(triggerOf(workload, mechanism, run.events, newHour(0), false)).toBe('HARDWARE_FAULT');
    }
    for (const mechanism of ['IO', 'LOCK_CONTENTION', 'CF_SERVICE', 'STORAGE'] as const) {
      expect(triggerOf(workload, mechanism, run.events, newHour(0), false)).toBe('GROWTH');
    }
    const closed = closeHour({
      ...run,
      sim: { ...run.sim, tick: TICKS_PER_HOUR },
      hour: {
        ...newHour(0), ticks: TICKS_PER_HOUR,
        workloads: { [workload]: {
          completions: 1000, failed: 0, withinSla: 0, rtSumSec: 10_000, parts: { io: 10_000 },
        } },
      },
    }, SCENARIOS[id]!, games[id]);
    expect(closed.incidents.find((i) => i.workloadId === workload)?.truth)
      .toEqual({ mechanism: 'IO', trigger: 'GROWTH' });
  });

  it.each([
    ['midwest', ['CARDAUTH', 'PAYMQ']],
    ['revenue', ['REFSTAT', 'AGENTS', 'EMPLOYER']],
    ['harbourline', ['RETAIL', 'PAYMENTS', 'MOBILE']],
  ] as const)('attributes non-static workloads in %s to the cap', (id, workloads) => {
    const run = startCap(id);
    expect(run.events[0]!.affects).toEqual(SCENARIOS[id]!.workloads.map((w) => w.id));
    const closed = closeHour({
      ...run,
      sim: { ...run.sim, tick: TICKS_PER_HOUR },
      hour: {
        ...newHour(0), ticks: TICKS_PER_HOUR,
        workloads: Object.fromEntries(workloads.map((w) => [w, {
          completions: 1000, failed: 0, withinSla: 0, rtSumSec: 10_000, parts: { cpuQueue: 10_000 },
        }])),
      },
    }, SCENARIOS[id]!, games[id]);
    for (const workload of workloads) {
      expect(closed.incidents.find((i) => i.workloadId === workload)?.truth)
        .toEqual({ mechanism: 'CPU_PRIORITY', trigger: 'HARDWARE_FAULT' });
    }
  });

  it('includes workloads added before the cap begins and retains the scope after expiry', () => {
    const run = startCap('midwest', [{ kind: 'ADD_WORKLOAD', workload: ACQUIRED_APP }]);
    expect(run.events[0]!.affects).toContain('ACQBANK');
    const ended = { ...run.events[0]!, ended: true, endTick: TICKS_PER_HOUR / 2 };
    expect(triggerOf('ACQBANK', 'CPU_PRIORITY', [ended], newHour(0), true)).toBe('HARDWARE_FAULT');
  });

  it('uses current positive routing and excludes workloads solely on a CPC that cannot drop further', () => {
    const run = startCap('harbourline', [
      { kind: 'SET_CPC_CAPACITY', cpcId: 'CPC2', capacitySetting: 4 },
      { kind: 'SET_ROUTING_POLICY', workloadId: 'MOBILE', policy: { method: 'STATIC' } },
      { kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PRDA: 1, PRDC: 0 } },
      { kind: 'SET_ROUTING_POLICY', workloadId: 'CARDS', policy: { method: 'STATIC' } },
      { kind: 'SET_ROUTING', workloadId: 'CARDS', routing: { PRDA: 0, PRDC: 1 } },
    ]);
    expect(run.sim.config.cpcs.map((c) => c.capacitySetting)).toEqual([6, 4]);
    expect(run.events[0]!.affects).toContain('MOBILE');
    for (const workload of ['CARDS', 'ADHOC']) {
      expect(run.events[0]!.affects).not.toContain(workload);
      expect(triggerOf(workload, 'CPU_PRIORITY', run.events, newHour(0), false)).toBe('POLICY');
    }
    expect(triggerOf('MOBILE', 'CPU_PRIORITY', run.events, newHour(0), false)).toBe('HARDWARE_FAULT');
  });

  it('follows a routing change made during the cap', () => {
    // Harbourline: the cap drops CPC1; PRDA is on it, PRDC on CPC2 (already at the floor, so it cannot drop).
    const run = startCap('harbourline', [
      { kind: 'SET_CPC_CAPACITY', cpcId: 'CPC2', capacitySetting: 4 },
      { kind: 'SET_ROUTING_POLICY', workloadId: 'CARDS', policy: { method: 'STATIC' } },
      { kind: 'SET_ROUTING', workloadId: 'CARDS', routing: { PRDC: 1 } },
      { kind: 'SET_ROUTING_POLICY', workloadId: 'MOBILE', policy: { method: 'STATIC' } },
      { kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PRDA: 1 } },
    ]);
    expect(run.events[0]!.affects).toContain('MOBILE');
    expect(run.events[0]!.affects).not.toContain('CARDS');
    // Two hours in, swap them: the card's earlier attribution must not stay frozen.
    const moved = advance({ ...run, pendingCommands: [
      { kind: 'SET_ROUTING', workloadId: 'CARDS', routing: { PRDA: 1 } },
      { kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PRDC: 1 } },
    ] }, SCENARIOS.harbourline!, HARBOURLINE_GAME, 1);
    expect(moved.events[0]!.affects).toContain('CARDS');
    expect(moved.events[0]!.affects).not.toContain('MOBILE');
    expect(triggerOf('CARDS', 'CPU_PRIORITY', moved.events, newHour(0), false)).toBe('HARDWARE_FAULT');
    expect(triggerOf('MOBILE', 'CPU_PRIORITY', moved.events, newHour(0), false)).toBe('POLICY');
  });

  it('picks up a workload added during the cap', () => {
    const run = startCap('midwest');
    expect(run.events[0]!.affects).not.toContain('ACQBANK');
    const added = advance({ ...run, pendingCommands: [{ kind: 'ADD_WORKLOAD', workload: ACQUIRED_APP }] }, SCENARIOS.midwest!, MIDWEST_GAME, 1);
    expect(added.events[0]!.affects).toContain('ACQBANK');
  });

  it('uses pending routing changes applied on the cap-start tick', () => {
    const run = startCap('harbourline', [
      { kind: 'SET_CPC_CAPACITY', cpcId: 'CPC2', capacitySetting: 4 },
      { kind: 'SET_ROUTING_POLICY', workloadId: 'MOBILE', policy: { method: 'STATIC' } },
      { kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PRDC: 1 } },
      { kind: 'SET_ROUTING_POLICY', workloadId: 'CARDS', policy: { method: 'STATIC' } },
      { kind: 'SET_ROUTING', workloadId: 'CARDS', routing: { PRDA: 1 } },
    ], [
      { kind: 'SET_ROUTING', workloadId: 'MOBILE', routing: { PRDA: 1 } },
      { kind: 'SET_ROUTING', workloadId: 'CARDS', routing: { PRDC: 1 } },
    ]);
    expect(run.sim.routing.MOBILE).toEqual({ PRDA: 1 });
    expect(run.sim.routing.CARDS).toEqual({ PRDC: 1 });
    expect(run.events[0]!.affects).toContain('MOBILE');
    expect(run.events[0]!.affects).not.toContain('CARDS');
    expect(triggerOf('MOBILE', 'CPU_PRIORITY', run.events, newHour(0), false)).toBe('HARDWARE_FAULT');
    expect(triggerOf('CARDS', 'CPU_PRIORITY', run.events, newHour(0), false)).toBe('POLICY');
  });
});
