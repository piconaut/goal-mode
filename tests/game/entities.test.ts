// PT-52: the world's entities and the cards re-pointed at them (BACKLOG PT-52; docs/pt-20-design.md §2 rule 7, §3, §4).

import { HARBOURLINE_EVENTS } from '../../src/content/events/harbourline-events';
import { MIDWEST_EVENTS, type EventDef } from '../../src/content/events/midwest-events';
import { REVENUE_EVENTS } from '../../src/content/events/revenue-events';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { HARBOURLINE_GAME } from '../../src/content/game-harbourline';
import { STC_AUTOMATION } from '../../src/content/entities';
import { HARBOURLINE, MIDWEST, REVENUE } from '../../src/content/scenarios';
import { CICSXLOG_ENGINES } from '../../src/content/scenarios/midwest-workloads';
import { meanRefEngines } from '../../src/game/culprits';
import { advance, newRun, startDay } from '../../src/game/run';
import { db2LockHolder, cicsStorageStats } from '../../src/game/smf';
import type { RunState } from '../../src/game/types';
import { initState } from '../../src/sim/core/init';
import { lockBoostNow, step, type Command } from '../../src/sim/core/step';
import type { Scenario } from '../../src/sim/core/scenario';
import type { SimState } from '../../src/sim/core/types';
import { TICK_SEC, TICKS_PER_HOUR } from '../../src/sim/core/units';
import { effectiveAddressSpaces } from '../../src/sim/core/tick/helpers';
import { classify } from '../../src/sim/wlm/classify';

const card = (deck: EventDef[], id: string) => deck.find((e) => e.id === id)!;

/** A run whose only card is `def`, starting `afterTicks` into the first day. */
function runWith(def: EventDef, scenario: Scenario, game: typeof MIDWEST_GAME, afterTicks = 1): RunState {
  const content = { ...game, events: [def] };
  const r = startDay(newRun(scenario, content, 7), content);
  return {
    ...r,
    events: [{
      uid: `${def.id}@0`, defId: def.id, name: def.name, startTick: r.sim.tick + afterTicks, endTick: null, trigger: def.trigger,
      affects: def.affects, mechanisms: [], endCommands: def.end, started: false, ended: false,
    }],
  };
}

const contentOf = (def: EventDef, game: typeof MIDWEST_GAME) => ({ ...game, events: [def] });

function stepN(s: SimState, n: number, scenario: Scenario, first: Command[] = []): SimState {
  let x = step(s, first, scenario);
  for (let i = 1; i < n; i++) x = step(x, [], scenario);
  return x;
}

describe('runaway thread and shadow IT load roster entities, not a workload modifier', () => {
  it('RUNAWAY puts ×10 of the analytics CPU on one DDF thread and its end clears it', () => {
    const def = card(MIDWEST_EVENTS, 'RUNAWAY');
    let r = advance(runWith(def, MIDWEST, MIDWEST_GAME), MIDWEST, contentOf(def, MIDWEST_GAME), 3);
    const loads = r.sim.entityLoads ?? [];
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ kind: 'DDF_THREAD', workloadId: 'ADHOC', lparId: 'PROD2' });
    // ADHOC runs only on PROD2 in Midwest, so its one thread carries the whole excess: 9 × the ADHOC CPU averaged over
    // the card's own five hours, in reference engines (RF-11), a constant demand rather than a multiple of the image's rate.
    const adhoc = MIDWEST.workloads.find((w) => w.id === 'ADHOC')!;
    const start = r.events[0]!.startTick;
    expect(loads[0]!.engines).toBeCloseTo(9 * meanRefEngines(adhoc, start, start + 5 * TICKS_PER_HOUR), 6);
    expect(r.sim.mods.cpu.ADHOC).toBeUndefined();
    expect(r.events[0]!.culprits).toEqual([loads[0]!.id]);
    r = { ...r, events: r.events.map((e) => ({ ...e, endTick: r.sim.tick + 1 })) };
    r = advance(r, MIDWEST, contentOf(def, MIDWEST_GAME), 3);
    expect(r.sim.entityLoads).toBeUndefined();
  });

  it('the adapted runaway cards load their own analytics workload', () => {
    for (const [deck, id, w] of [[REVENUE_EVENTS, 'RUNAWAY_COMPLIANCE', 'ANALYTICS'], [HARBOURLINE_EVENTS, 'RUNAWAY', 'ADHOC']] as const) {
      const def = card([...deck], id);
      expect(def.culprits, id).toMatchObject({ entity: 'DDF_THREAD', workloadId: w, count: 1, cpuMult: 10 });
      expect([...def.begin, ...def.end].some((c) => c.kind === 'SET_MODIFIER' && c.mod === 'cpu'), id).toBe(false);
    }
  });

  it('SHADOW_IT puts its CPU on two or three TSO userids on the test image only', () => {
    const def = card(MIDWEST_EVENTS, 'SHADOW_IT');
    const r = advance(runWith(def, MIDWEST, MIDWEST_GAME), MIDWEST, contentOf(def, MIDWEST_GAME), 3);
    const loads = r.sim.entityLoads ?? [];
    expect(loads.length).toBeGreaterThanOrEqual(2);
    expect(loads.length).toBeLessThanOrEqual(3);
    for (const l of loads) expect(l).toMatchObject({ kind: 'TSO_USER', workloadId: 'TSO', lparId: 'DEVT' });
    expect(new Set(loads.map((l) => l.id)).size).toBe(loads.length);
    expect(r.sim.mods.cpu.TSO).toBeUndefined();
  });
});

describe('CICSXLOG is a permanent STC that XLOG_LOOP makes loop', () => {
  it('runs every day in the CICS regions\' class on Midwest and Revenue PROD1', () => {
    for (const sc of [MIDWEST, REVENUE]) {
      const xlog = sc.addressSpaces.filter((a) => a.jobname === 'CICSXLOG');
      expect(xlog, sc.id).toEqual([expect.objectContaining({ lparId: 'PROD1', role: null, subsystem: 'STC', baseEnginesRef: CICSXLOG_ENGINES })]);
      const region = classify(sc.definition, { subsystem: 'STC', TN: 'CICSAOR1', SY: 'PROD1' }).serviceClass;
      expect(classify(sc.definition, { subsystem: 'STC', TN: 'CICSXLOG', SY: 'PROD1' }).serviceClass, sc.id).toBe(region);
    }
  });

  it('the loop multiplies its CPU to about 0.9 engines, and the end cancels it until automation restarts it', () => {
    const def = card(MIDWEST_EVENTS, 'XLOG_LOOP');
    expect([...def.begin, ...def.end].some((c) => c.kind === 'ADD_ADDRESS_SPACE')).toBe(false);
    let s = initState(7, MIDWEST);
    s = step(s, def.begin, MIDWEST);
    expect(CICSXLOG_ENGINES * s.mods.asCpu.CICSXLOG!).toBeCloseTo(0.9, 6);
    s = step(s, def.end, MIDWEST);
    expect(s.mods.asCpu.CICSXLOG).toBeUndefined();
    expect(effectiveAddressSpaces(MIDWEST, s).some((a) => a.jobname === 'CICSXLOG' && a.lparId === 'PROD1')).toBe(false);
    const restart = Math.ceil((STC_AUTOMATION.restartMin * 60) / TICK_SEC);
    s = stepN(s, restart, MIDWEST);
    expect(s.cancelledAddressSpaces).toBeUndefined();
    expect(effectiveAddressSpaces(MIDWEST, s).filter((a) => a.jobname === 'CICSXLOG')).toHaveLength(1);
    expect(s.commandLog.some((l) => /CICSXLOG restarted on PROD1 by automation/.test(l))).toBe(true);
  });

  it.each(['STORY', 'HARD'] as const)('the loop stays at about 0.9 engines on %s: one TCB bounds it, difficulty does not scale it', (difficulty) => {
    const def = card(MIDWEST_EVENTS, 'XLOG_LOOP');
    const content = contentOf(def, MIDWEST_GAME);
    const r0 = startDay(newRun(MIDWEST, content, 7, difficulty), content);
    const r = { ...r0, events: [{
      uid: `${def.id}@0`, defId: def.id, name: def.name, startTick: r0.sim.tick + 1, endTick: null, trigger: def.trigger,
      affects: def.affects, mechanisms: [], endCommands: def.end, started: false, ended: false,
    }] };
    const after = advance(r, MIDWEST, content, 3);
    expect(CICSXLOG_ENGINES * after.sim.mods.asCpu.CICSXLOG!).toBeCloseTo(0.9, 6);
  });
});

describe('REORG_OVERRUN overruns the night\'s scheduled REORG', () => {
  it('is an overrun of the scheduled utility, not raw LCU I/O, and loads LCU 21 far beyond the normal REORG', () => {
    const def = card(MIDWEST_EVENTS, 'REORG_OVERRUN');
    expect([...def.begin, ...def.end].every((c) => c.kind === 'SET_UTILITY_OVERRUN')).toBe(true);
    const s0 = initState(7, MIDWEST);
    const base = stepN(s0, 3, MIDWEST);
    const over = stepN(s0, 3, MIDWEST, def.begin);
    const lcu = (s: SimState) => s.env.dasd!.lcus.find((l) => l.id === '21')!;
    expect(lcu(over).iops - lcu(base).iops).toBeGreaterThan(50_000);
    expect(lcu(over).iosqSec).toBeGreaterThan(5 * lcu(base).iosqSec);
    const cleared = stepN(over, 3, MIDWEST, def.end);
    expect(cleared.utilityOverruns).toBeUndefined();
    expect(lcu(cleared).iops).toBeCloseTo(lcu(stepN(base, 3, MIDWEST)).iops, -3);
  });
});

describe('LOCK_ESCALATION names the settlement job that holds the locks', () => {
  const def = card(MIDWEST_EVENTS, 'LOCK_ESCALATION');
  // 21:00 on day 0: the STL settlement chain (from 20:30 on PROD1) is running.
  let night: RunState;
  beforeAll(() => {
    const content = { ...MIDWEST_GAME, events: [] };
    night = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 15 * TICKS_PER_HOUR);
  }, 300_000);

  it('the blockers view names the running STL job, its member and the object', () => {
    expect(night.sim.batch.jobs.some((j) => j.status === 'RUNNING' && j.def.stream === 'STL')).toBe(true);
    const on = { ...night, sim: step(night.sim, def.begin, MIDWEST) };
    const holder = db2LockHolder(on);
    const stl = on.sim.batch.jobs.find((j) => j.status === 'RUNNING' && j.def.stream === 'STL')!;
    expect(holder).toEqual({ job: stl.def.name, lparId: 'PROD1', member: 'DB1A', object: 'SETTLE.POSTINGS' });
    expect(db2LockHolder({ ...on, sim: step(on.sim, def.end, MIDWEST) })).toBeUndefined();
  });

  it('the boost counts only while a settlement job runs', () => {
    const on = step(night.sim, def.begin, MIDWEST);
    expect(lockBoostNow(on, on.batch.jobs)).toBe(6);
    // The same state with the settlement stream finished: no holder runs, so the boost does not apply.
    const done = on.batch.jobs.map((j) => (j.def.stream === 'STL' ? { ...j, status: 'DONE' as const } : j));
    expect(lockBoostNow(on, done)).toBe(0);
    // A boost with no holder (an older save's) always applies.
    expect(lockBoostNow({ ...on, mods: { ...on.mods, lockHolder: undefined } }, done)).toBe(6);
  });

  it('every scenario names its own settlement stream', () => {
    for (const [deck, stream] of [[MIDWEST_EVENTS, 'STL'], [HARBOURLINE_EVENTS, 'SET'], [REVENUE_EVENTS, 'REF']] as const) {
      const b = card([...deck], 'LOCK_ESCALATION').begin.find((c) => c.kind === 'SET_LOCK_BOOST');
      expect(b, stream).toMatchObject({ holder: { stream } });
    }
  });
});

describe('SICK_AOR reports its abends on the sick region', () => {
  it('CICSAOR3 carries every abend; PRDC\'s other region none', () => {
    const def = card(HARBOURLINE_EVENTS, 'SICK_AOR');
    const content = contentOf(def, HARBOURLINE_GAME);
    // 10:00, during the trading day.
    let r = runWith(def, HARBOURLINE, HARBOURLINE_GAME, 4 * TICKS_PER_HOUR);
    r = advance(r, HARBOURLINE, content, 4 * TICKS_PER_HOUR + 30);
    const rows = cicsStorageStats(r, 'current');
    const by = Object.fromEntries(rows.map((x) => [x.region, x.abends ?? 0]));
    expect(by.CICSAOR3).toBeGreaterThan(0);
    expect(by.CICSAOR7 ?? 0).toBe(0);
    for (const [region, n] of Object.entries(by)) if (region !== 'CICSAOR3') expect(n, region).toBe(0);
    // The region's abends are part of the failed transactions of the workloads the card hits (report identity).
    const failed = (['MKTORD', 'CARDS'] as const).reduce((a, w) => a + (r.hour?.workloads[w]?.failed ?? 0), 0);
    expect(by.CICSAOR3).toBeLessThanOrEqual(failed + 1e-6);
    expect(by.CICSAOR3).toBeGreaterThan(0.5 * failed);
  }, 300_000);
});
