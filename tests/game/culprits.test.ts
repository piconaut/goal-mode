import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import type { CulpritSpec } from '../../src/content/events/midwest-events';
import { resolveCulprits } from '../../src/game/culprits';
import { initState } from '../../src/sim/core/init';

const sim = initState(42, MIDWEST);
const ws = MIDWEST.workloads;
const tso = ws.find((w) => w.id === 'TSO')!;
const tsoSpec: CulpritSpec = { entity: 'TSO_USER', workloadId: 'TSO', lparIds: ['DEVT'], count: [2, 3], cpuMult: 8 };

describe('resolveCulprits', () => {
  it('picks 2-3 culprits on DEVT, deterministically in the uid', () => {
    const a = resolveCulprits(sim, ws, tsoSpec, 'card-1');
    expect(a.ids.length).toBeGreaterThanOrEqual(2);
    expect(a.ids.length).toBeLessThanOrEqual(3);
    expect(new Set(a.ids).size).toBe(a.ids.length);
    expect(a.commands).toHaveLength(a.ids.length);
    for (const c of a.commands) {
      expect(c.kind).toBe('SET_ENTITY_LOAD');
      if (c.kind === 'SET_ENTITY_LOAD') expect(c.load).toMatchObject({ lparId: 'DEVT', workloadId: 'TSO', kind: 'TSO_USER', tag: 'card-1' });
    }
    expect(resolveCulprits(sim, ws, tsoSpec, 'card-1')).toEqual(a);
    expect(Array.from({ length: 12 }, (_, i) => resolveCulprits(sim, ws, tsoSpec, `u${i}`).ids.join()).some((x) => x !== a.ids.join())).toBe(true);
  });

  it('splits (cpuMult - 1) over the culprits, scaled by total routing over the image share; severity 2 doubles it', () => {
    const routing = tso.routing;
    const total = Object.values(routing).reduce((x, y) => x + y, 0);
    const extras = (sev: number) => {
      const r = resolveCulprits(sim, ws, tsoSpec, 'card-1', sev);
      return r.commands.map((c) => (c.kind === 'SET_ENTITY_LOAD' ? c.load.extraCpuFrac : NaN));
    };
    const one = extras(1);
    const expected = ((8 - 1) / one.length) * (total / routing.DEVT!);
    for (const x of one) expect(x).toBeCloseTo(expected, 12);
    const two = extras(2);
    expect(two).toHaveLength(one.length);
    for (const x of two) expect(x).toBeCloseTo(2 * expected, 12);
  });

  it('puts one DDF culprit on an image ADHOC routes to', () => {
    const adhoc = ws.find((w) => w.id === 'ADHOC')!;
    const r = resolveCulprits(sim, ws, { entity: 'DDF_THREAD', workloadId: 'ADHOC', count: 1, cpuMult: 10 }, 'adhoc-1');
    expect(r.commands).toHaveLength(1);
    const c = r.commands[0]!;
    expect(c.kind).toBe('SET_ENTITY_LOAD');
    if (c.kind === 'SET_ENTITY_LOAD') {
      expect(c.load.kind).toBe('DDF_THREAD');
      expect(adhoc.routing[c.load.lparId]).toBeGreaterThan(0);
      expect(c.load.extraCpuFrac).toBeCloseTo(9, 9);
    }
  });

  it('returns no commands for an unknown workload', () => {
    expect(resolveCulprits(sim, ws, { ...tsoSpec, workloadId: 'NOPE' }, 'x')).toEqual({ ids: [], commands: [] });
  });
});
