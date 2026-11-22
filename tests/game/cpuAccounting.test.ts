import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { SCENARIOS } from '../../src/content/scenarios';
import { newRun } from '../../src/game/run';
import { accumulateHour, newHour } from '../../src/game/run/hourly';
import { addHour } from '../../src/game/sla';
import type { HourAcc } from '../../src/game/types';
import { step } from '../../src/sim/core/step';
import { emptyScpTick } from '../../src/sim/wlm/evaluate';
import { SERVER_KEY } from '../../src/sim/wlm/holders';

const fields = ['cpuWaitByWorkloadLpar', 'cpByScpLpar', 'cpByRoleLpar', 'cpByWorkloadLpar', 'capDelayByScpLpar', 'roleCappedTicks', 'ziipBusyById', 'ziipLparBusyById'] as const;
const reports = (h: HourAcc) => Object.fromEntries(fields.map((k) => [k, h[k]]));
const legacy = (): HourAcc => ({ hourIndex: 0, ticks: 0, workloads: {}, maxCappedFrac: 0, cappedByLpar: {}, cappedTicksByLpar: {}, cpcBusySum: 0, cpcBusyById: {}, lparBusyById: {}, cpByImportance: {}, lockIndexSum: 0, dbatQueuedByLpar: {} });

// Independent recursive numeric sum used only to calculate the expected totals of recorded tick reports.
function sum(a: unknown, b: unknown): unknown {
  if (typeof b === 'number') return (typeof a === 'number' ? a : 0) + b;
  const out = { ...(a as Record<string, unknown> ?? {}) };
  for (const [k, v] of Object.entries(b as Record<string, unknown> ?? {})) out[k] = sum(out[k], v);
  return out;
}

// Splitting a sum into hours changes floating-point grouping, not the accounted samples/engines.
// Same 1e-9 relative/absolute tolerance as the sim reconciliation; keys still match exactly.
function near(a: unknown, b: unknown): void {
  if (typeof b === 'number') {
    expect(typeof a).toBe('number');
    expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
  } else {
    expect(Object.keys(a as object).sort()).toEqual(Object.keys(b as object).sort());
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) near((a as Record<string, unknown>)[k], v);
  }
}

it('sums every new hour field over real ticks and merges split hours without mutating earlier hours', () => {
  const scenario = SCENARIOS.midwest!;
  let run = newRun(scenario, MIDWEST_GAME, 42);
  let expected: unknown = reports(newHour(0));
  let first: HourAcc | undefined;
  let cappedRoleTicks = 0, ziipBusy = 0, roleIipcp = 0, workloadIipcp = 0;
  const definition = run.sim.wlm.definition;
  run = { ...run, sim: { ...run.sim, wlm: { ...run.sim.wlm, definition: {
    ...definition,
    resourceGroups: [...definition.resourceGroups, { id: 'CPU_TEST', type: 3, min: null, max: 1 }],
    classes: definition.classes.map((c) => c.id === 'STCMED' ? { ...c, resourceGroup: 'CPU_TEST' } : c),
  } } } };
  for (let i = 0; i < 6; i++) {
    if (i === 3) run = { ...run, sim: { ...run.sim, wlm: { ...run.sim.wlm, definition } } };
    const offline = i === 3 ? run.sim.config.lpars.filter((l) => l.pools.some((p) => p.pool === 'ZIIP'))
      .map((l) => ({ kind: 'SET_LOGICAL' as const, lparId: l.id, pool: 'ZIIP' as const, logical: 0 })) : [];
    const sim = step(run.sim, offline, scenario);
    const one = accumulateHour({ ...run, sim, hour: newHour(0) }).hour!;
    const roles = Object.fromEntries(sim.last.lpars.flatMap((lt) => Object.entries(lt.roleHealth)
      .filter(([, health]) => health.capped).map(([role]) => [`${lt.lparId}:${role}`, 1])));
    expect(one.roleCappedTicks).toEqual(roles);
    cappedRoleTicks += Object.keys(roles).length;
    if (i >= 3) expect(roles).toEqual({});
    const images = Object.fromEntries(sim.lpars.flatMap((l) => {
      const zi = l.pools.find((p) => p.pool === 'ZIIP');
      return zi && zi.availableEngines > 0 ? [[l.id, Math.min(1, zi.deliveredEngines / zi.availableEngines)]] : [];
    }));
    const cpcs = Object.fromEntries(sim.config.cpcs.filter((c) => c.engines.ZIIP > 0).map((c) => [c.id,
      sim.lpars.filter((l) => sim.config.lpars.find((cfg) => cfg.id === l.id)?.cpcId === c.id)
        .reduce((n, l) => n + (l.pools.find((p) => p.pool === 'ZIIP')?.deliveredEngines ?? 0), 0) / c.engines.ZIIP,
    ]));
    expect(one.ziipLparBusyById).toEqual(images);
    expect(one.ziipBusyById).toEqual(cpcs);
    ziipBusy += Object.values(cpcs).reduce((n, x) => n + x, 0);
    for (const w of sim.last.workloads) expect(one.cpuWaitByWorkloadLpar?.[w.id]).toEqual(w.cpuWaitByLpar);
    for (const lt of sim.last.lpars) {
      expect(one.cpByRoleLpar?.[lt.lparId]).toEqual(lt.cpByRole);
      expect(one.cpByWorkloadLpar?.[lt.lparId]).toEqual(lt.cpByWorkload);
      roleIipcp += Object.values(lt.cpByRole ?? {}).reduce((n, x) => n + x.iipcp, 0);
      workloadIipcp += Object.values(lt.cpByWorkload ?? {}).reduce((n, x) => n + x.iipcp, 0);
      for (const x of lt.scps) {
        expect(one.cpByScpLpar?.[lt.lparId]?.[x.scKey]).toEqual({ cp: x.cpEngines, ziip: x.ziipEngines, iipcp: x.iipcpEngines });
        // The independent sample-total oracle is the hand-counted synthetic tick below.
        expect(one.capDelayByScpLpar?.[lt.lparId]?.[x.scKey]?.cap).toBe(x.delayCap);
      }
    }
    expected = sum(expected, reports(one));
    const previous = JSON.stringify(run.hour);
    const prior = run.hour;
    run = accumulateHour({ ...run, sim });
    expect(JSON.stringify(prior)).toBe(previous);
    if (i === 2) { first = run.hour!; run = { ...run, hour: newHour(0) }; }
  }
  const before = JSON.stringify([first, run.hour]);
  expect(cappedRoleTicks).toBeGreaterThan(0);
  expect(ziipBusy).toBeGreaterThan(0);
  expect(roleIipcp).toBeGreaterThan(0);
  expect(workloadIipcp).toBeGreaterThan(0);
  near(reports(addHour(first, run.hour!)), expected);
  expect(JSON.stringify([first, run.hour])).toBe(before);
  expect(reports(addHour(undefined, run.hour!))).toEqual(reports(run.hour!));
  // Old saves have no new fields; either merge direction preserves only the newly observed data.
  expect(reports(addHour(legacy(), run.hour!))).toEqual(reports(run.hour!));
  expect(reports(addHour(run.hour, legacy()))).toEqual(reports(run.hour!));
});

it('counts CAP samples (including server CAP once), current capped-role ticks, and zIIP busy on both scopes', () => {
  let run = newRun(SCENARIOS.midwest!, MIDWEST_GAME, 42);
  run = { ...run, sim: step(run.sim, [], SCENARIOS.midwest!) };
  const cp = run.sim.lpars[0]!.pools.find((p) => p.pool === 'CP')!;
  const zi = { ...cp, pool: 'ZIIP' as const, deliveredEngines: 3, availableEngines: 2 };
  const x = { ...emptyScpTick('STC#1', 220), cpEngines: 1.5, ziipEngines: 0.5, iipcpEngines: 0.25,
    usingCpu: 2, usingZiip: 3, usingIo: 5, delayCpu: 7, delayZiip: 11, delayIo: 13,
    delayStorage: 17, delayCap: 19, delayQueue: 23, delayOther: 29,
    srvUsing: 2, srvDelay: 5, srvDelayCap: 3 };
  run = { ...run, hour: legacy(), sim: { ...run.sim,
    lpars: [{ ...run.sim.lpars[0]!, id: 'IMG', pools: [cp, zi] }],
    config: { ...run.sim.config, lpars: [{ ...run.sim.config.lpars[0]!, id: 'IMG', cpcId: 'BOX' }], cpcs: [{ ...run.sim.config.cpcs[0]!, id: 'BOX', engines: { ...run.sim.config.cpcs[0]!.engines, ZIIP: 4 } }] },
    last: { workloads: [], lpars: [{ lparId: 'IMG', scps: [x], roleHealth: { 'DB2.MSTR': { health: 0.1, queueRatio: 0, capped: true } } }] },
  } };
  run = accumulateHour(run);
  expect(run.hour!.capDelayByScpLpar).toEqual({ IMG: { 'STC#1': { cap: 19, samples: 129 }, [SERVER_KEY]: { cap: 3, samples: 7 } } });
  expect(run.hour!.cpByScpLpar).toEqual({ IMG: { 'STC#1': { cp: 1.5, ziip: 0.5, iipcp: 0.25 } } });
  expect(run.hour!.ziipBusyById).toEqual({ BOX: 0.75 });
  expect(run.hour!.ziipLparBusyById).toEqual({ IMG: 1 });
  expect(run.hour!.roleCappedTicks).toEqual({ 'IMG:DB2.MSTR': 1 });
  const one = run.hour!;
  run = accumulateHour(run);
  expect(run.hour!.roleCappedTicks).toEqual({ 'IMG:DB2.MSTR': 2 });
  expect(run.hour!.ziipBusyById).toEqual({ BOX: 1.5 });
  expect(run.hour!.ziipLparBusyById).toEqual({ IMG: 2 });
  expect(run.hour!.capDelayByScpLpar).toEqual({ IMG: { 'STC#1': { cap: 38, samples: 258 }, [SERVER_KEY]: { cap: 6, samples: 14 } } });
  expect(reports(addHour(one, one))).toEqual(reports(run.hour!));
  // The cap disappears and no zIIP capacity is available: neither counter gains another tick.
  run = accumulateHour({ ...run, sim: { ...run.sim, lpars: [{ ...run.sim.lpars[0]!, pools: [cp, { ...zi, availableEngines: 0, deliveredEngines: 0 }] }],
    last: { workloads: [], lpars: [{ lparId: 'IMG', scps: [], roleHealth: { 'DB2.MSTR': { health: 1, queueRatio: 0 } } }] } } });
  expect(run.hour!.roleCappedTicks).toEqual({ 'IMG:DB2.MSTR': 2 });
  expect(run.hour!.ziipBusyById).toEqual({ BOX: 1.5 });
  expect(run.hour!.ziipLparBusyById).toEqual({ IMG: 2 });
});

it('uses each CPC zIIP capacity, even for an image without a CP pool, and skips zero-capacity denominators', () => {
  let run = newRun(SCENARIOS.midwest!, MIDWEST_GAME, 42);
  const sim = step(run.sim, [], SCENARIOS.midwest!);
  const lpar = sim.lpars[0]!;
  const pool = lpar.pools[0]!;
  const cfg = sim.config.lpars[0]!;
  const cpc = sim.config.cpcs[0]!;
  const images = [
    { id: 'A', cpcId: 'BOX1', delivered: 1, available: 2, installed: 4 },
    { id: 'B', cpcId: 'BOX2', delivered: 2, available: 4, installed: 8 },
    { id: 'C', cpcId: 'BOX3', delivered: 0, available: 0, installed: 0 },
  ];
  run = { ...run, sim: { ...sim,
    lpars: images.map((x) => ({ ...lpar, id: x.id, pools: [{ ...pool, pool: 'ZIIP' as const, deliveredEngines: x.delivered, availableEngines: x.available }] })),
    config: { ...sim.config,
      lpars: images.map((x) => ({ ...cfg, id: x.id, cpcId: x.cpcId })),
      cpcs: images.map((x) => ({ ...cpc, id: x.cpcId, engines: { ...cpc.engines, ZIIP: x.installed } })),
    }, last: { workloads: [], lpars: [] },
  } };
  const hour = accumulateHour(run).hour!;
  expect(hour.ziipBusyById).toEqual({ BOX1: 0.25, BOX2: 0.25 });
  expect(hour.ziipLparBusyById).toEqual({ A: 0.5, B: 0.5 });
});

it('adds legacy grant rows lacking IIPCP without NaNs or backfilling earlier ticks', () => {
  // Deserialized earlier RT-16 hours have cp/ziip rows but no iipcp member.
  const old: HourAcc = JSON.parse(JSON.stringify({ ...legacy(), ticks: 10,
    cpByScpLpar: { IMG: { 'STC#1': { cp: 2, ziip: 3 } } },
    cpByRoleLpar: { IMG: { ROLE: { cp: 2, ziip: 3 } } },
    cpByWorkloadLpar: { IMG: { WORK: { cp: 2, ziip: 3 } } },
  }));
  const fresh: HourAcc = { ...newHour(0), ticks: 1,
    cpByScpLpar: { IMG: { 'STC#1': { cp: 5, ziip: 7, iipcp: 11 } } },
    cpByRoleLpar: { IMG: { ROLE: { cp: 5, ziip: 7, iipcp: 11 } } },
    cpByWorkloadLpar: { IMG: { WORK: { cp: 5, ziip: 7, iipcp: 11 } } },
  };
  for (const merged of [addHour(old, fresh), addHour(fresh, old)]) {
    expect(merged.ticks).toBe(11);
    expect(merged.cpByScpLpar).toEqual({ IMG: { 'STC#1': { cp: 7, ziip: 10, iipcp: 11 } } });
    expect(merged.cpByRoleLpar).toEqual({ IMG: { ROLE: { cp: 7, ziip: 10, iipcp: 11 } } });
    expect(merged.cpByWorkloadLpar).toEqual({ IMG: { WORK: { cp: 7, ziip: 10, iipcp: 11 } } });
  }
  const base = newRun(SCENARIOS.midwest!, MIDWEST_GAME, 42);
  const sim = step(base.sim, [], SCENARIOS.midwest!);
  const tick = { ...emptyScpTick('STC#1', 220), cpEngines: 5, ziipEngines: 7, iipcpEngines: 11 };
  const one = accumulateHour({ ...base, hour: old, sim: { ...sim, last: { workloads: [], lpars: [{
    lparId: 'IMG', scps: [tick], cpByRole: { ROLE: { cp: 5, ziip: 7, iipcp: 11 } },
    cpByWorkload: { WORK: { cp: 5, ziip: 7, iipcp: 11 } }, roleHealth: {},
  }] } } }).hour!;
  const expected = addHour(old, fresh);
  for (const key of ['cpByScpLpar', 'cpByRoleLpar', 'cpByWorkloadLpar'] as const) expect(one[key]).toEqual(expected[key]);
});
