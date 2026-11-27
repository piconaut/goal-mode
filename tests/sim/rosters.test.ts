import { describe, expect, it } from 'vitest';
import { ROSTERS } from '../../src/content/entities';
import { MIDWEST } from '../../src/content/scenarios';
import type { EntityLoad } from '../../src/sim/core/types';
import { dailyRoster, rosterCpuSec } from '../../src/sim/workload/rosters';

const wl = (id: string) => MIDWEST.workloads.find((w) => w.id === id)!;
const tso = wl('TSO');
const adhoc = wl('ADHOC');
const ddfRouting = { PROD1: 0.5, PROD2: 0.5, DEVT: 0 };

const load = (over: Partial<EntityLoad> = {}): EntityLoad => ({ tag: 't', kind: 'TSO_USER', id: 'DEV001', workloadId: 'TSO', lparId: 'DEVT', cpEngines: 0.5, ziipEngines: 0, ...over });

describe('dailyRoster', () => {
  it('is deterministic for (seed, day) and differs by day', () => {
    const a = dailyRoster(7, 3, tso, tso.routing, 'TSO_USER');
    expect(dailyRoster(7, 3, tso, tso.routing, 'TSO_USER')).toEqual(a);
    expect(dailyRoster(7, 4, tso, tso.routing, 'TSO_USER')).not.toEqual(a);
  });

  it('gives each routed DDF image ddfThreadsPerImage threads and none for a zero share', () => {
    const r = dailyRoster(1, 0, adhoc, ddfRouting, 'DDF_THREAD');
    expect(r.filter((e) => e.lparId === 'PROD1')).toHaveLength(ROSTERS.ddfThreadsPerImage);
    expect(r.filter((e) => e.lparId === 'PROD2')).toHaveLength(ROSTERS.ddfThreadsPerImage);
    expect(r.filter((e) => e.lparId === 'DEVT')).toHaveLength(0);
    expect(r.every((e) => e.authid === 'BIUSER' && e.corrid === 'QMFBI')).toBe(true);
  });

  it('sizes TSO rosters by max(tsoMinUsers, round(share x tsoUsersPerShare))', () => {
    const r = dailyRoster(1, 0, tso, tso.routing, 'TSO_USER');
    for (const [lparId, share] of Object.entries(tso.routing)) {
      expect(r.filter((e) => e.lparId === lparId)).toHaveLength(Math.max(ROSTERS.tsoMinUsers, Math.round(share * ROSTERS.tsoUsersPerShare)));
    }
  });

  it('shares of one image sum to 1 and ids are unique across the workload', () => {
    for (const [w, kind, routing] of [[tso, 'TSO_USER', tso.routing], [adhoc, 'DDF_THREAD', ddfRouting]] as const) {
      const r = dailyRoster(5, 2, w, routing, kind);
      for (const lparId of new Set(r.map((e) => e.lparId))) {
        expect(r.filter((e) => e.lparId === lparId).reduce((a, e) => a + e.shareFrac, 0)).toBeCloseTo(1, 9);
      }
      expect(new Set(r.map((e) => e.id)).size).toBe(r.length);
    }
  });

  it('keeps the letter prefix of the workload userid on TSO userids', () => {
    const r = dailyRoster(3, 1, tso, tso.routing, 'TSO_USER');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((e) => e.id.startsWith('DEV'))).toBe(true);
  });

  it('keeps ids and relative weights of an image when its routing share grows', () => {
    const small = dailyRoster(9, 2, tso, { DEVT: 0.5 }, 'TSO_USER');
    const big = dailyRoster(9, 2, tso, { DEVT: 1 }, 'TSO_USER');
    expect(big.length).toBeGreaterThan(small.length);
    for (let k = 0; k < small.length; k++) {
      expect(big[k]!.id).toBe(small[k]!.id);
      expect(big[k]!.shareFrac / big[0]!.shareFrac).toBeCloseTo(small[k]!.shareFrac / small[0]!.shareFrac, 9);
    }
  });

  it('is heavy-tailed: the median top entry of a 12-thread image holds well over 1/12', () => {
    const tops: number[] = [];
    for (let seed = 1; seed <= 101; seed++) {
      const r = dailyRoster(seed, 0, adhoc, { PROD2: 1 }, 'DDF_THREAD');
      expect(r).toHaveLength(12);
      tops.push(Math.max(...r.map((e) => e.shareFrac)));
    }
    tops.sort((a, b) => a - b);
    expect(tops[50]!).toBeGreaterThan(2 / 12);
  });
});

describe('entity loads', () => {
  it('rosterCpuSec sums to the workload CPU and a loaded entry gets own x share plus its constant demand', () => {
    const entries = dailyRoster(2, 0, tso, { DEVT: 1 }, 'TSO_USER');
    const none = rosterCpuSec(entries, 100, undefined);
    expect(Object.values(none).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);

    const target = entries[3]!;
    // One engine of demand holds its CPU for the whole tick (TICK_SEC).
    const loads = [load({ id: target.id, cpEngines: 1, ziipEngines: 0 })];
    const out = rosterCpuSec(entries, 100, loads);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    expect(out[target.id]).toBeCloseTo((100 - 10) * target.shareFrac + 10, 9);
    expect(out[entries[0]!.id]).toBeCloseTo((100 - 10) * entries[0]!.shareFrac, 9);
    expect(rosterCpuSec([], 50, loads)).toEqual({});
  });

  it('a load granted less than its demand in a contended image is scaled to what the workload measured', () => {
    const entries = dailyRoster(2, 0, tso, { DEVT: 1 }, 'TSO_USER');
    const loads = [load({ id: entries[0]!.id, cpEngines: 1, ziipEngines: 0 })];
    // 4 s of measurement against 10 s of demand: the entity's row shows the 4 s the image granted.
    const out = rosterCpuSec(entries, 4, loads);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBeCloseTo(4, 9);
    expect(out[entries[0]!.id]).toBeCloseTo(4, 9);
    expect(out[entries[1]!.id]).toBeCloseTo(0, 9);
  });

  it('counts a load only on its own workload and image', () => {
    const entries = dailyRoster(2, 0, tso, { DEVT: 1 }, 'TSO_USER');
    const target = entries[3]!;
    const loads = [load({ id: target.id, cpEngines: 1 }), load({ id: target.id, lparId: 'PROD1', cpEngines: 9 }), load({ id: target.id, workloadId: 'ADHOC', cpEngines: 9 })];
    expect(rosterCpuSec(entries, 100, loads)).toEqual(rosterCpuSec(entries, 100, [loads[0]!]));
  });
});
