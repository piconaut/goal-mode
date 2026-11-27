import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import type { CulpritSpec } from '../../src/content/events/midwest-events';
import { resolveCulprits } from '../../src/game/culprits';
import { initState } from '../../src/sim/core/init';
import { meanReferenceRate, sizedEntityDemand } from '../../src/sim/workload/entityDemand';

const sim = initState(42, MIDWEST);
const ws = MIDWEST.workloads;
const tso = ws.find((w) => w.id === 'TSO')!;
const tsoSpec: CulpritSpec = { entity: 'TSO_USER', workloadId: 'TSO', lparIds: ['DEVT'], count: [2, 3], cpuMult: 8 };

const enginesOf = (commands: ReturnType<typeof resolveCulprits>['commands']) =>
  commands.map((c) => (c.kind === 'SET_ENTITY_LOAD' ? c.load.cpEngines + c.load.ziipEngines : NaN));

describe('resolveCulprits', () => {
  it('picks 2-3 culprits on DEVT, deterministically in the uid', () => {
    const a = resolveCulprits(sim, ws, tsoSpec, 'card-1');
    expect(a.ids.length).toBeGreaterThanOrEqual(2);
    expect(a.ids.length).toBeLessThanOrEqual(3);
    expect(new Set(a.ids).size).toBe(a.ids.length);
    expect(a.commands).toHaveLength(a.ids.length);
    for (const c of a.commands) {
      expect(c.kind).toBe('SET_ENTITY_LOAD');
      if (c.kind === 'SET_ENTITY_LOAD') {
        expect(c.load).toMatchObject({ lparId: 'DEVT', workloadId: 'TSO', kind: 'TSO_USER', tag: 'card-1' });
        expect(c.load.cpEngines + c.load.ziipEngines).toBeGreaterThan(0);
        expect('extraCpuFrac' in c.load).toBe(false);
      }
    }
    expect(resolveCulprits(sim, ws, tsoSpec, 'card-1')).toEqual(a);
    expect(Array.from({ length: 12 }, (_, i) => resolveCulprits(sim, ws, tsoSpec, `u${i}`).ids.join()).some((x) => x !== a.ids.join())).toBe(true);
  });

  it('sizes the card\'s whole excess over its usual hours as constant engine demand, split over the culprits', () => {
    const hours = 8;
    const one = enginesOf(resolveCulprits(sim, ws, tsoSpec, 'card-1', 1, hours).commands);
    // Same image, so every culprit carries the same share of the excess, and they add up to the whole excess.
    for (const x of one) expect(x).toBeCloseTo(one[0]!, 12);
    const rate = meanReferenceRate(tso, sim.tick, hours);
    const wanted = sizedEntityDemand(tso, sim.config, 'DEVT', rate, 8 - 1);
    expect(one.reduce((a, b) => a + b, 0)).toBeCloseTo(wanted.cpEngines + wanted.ziipEngines, 9);
    // Difficulty scales the excess, not the workload's own CPU.
    const two = enginesOf(resolveCulprits(sim, ws, tsoSpec, 'card-1', 2, hours).commands);
    expect(two).toHaveLength(one.length);
    for (const x of two) expect(x).toBeCloseTo(2 * one[0]!, 9);
  });

  it('averages over the card\'s hours rather than the arrival rate at the moment it begins', () => {
    const early = enginesOf(resolveCulprits(sim, ws, tsoSpec, 'card-1', 1, 1).commands).reduce((a, b) => a + b, 0);
    const day = enginesOf(resolveCulprits(sim, ws, tsoSpec, 'card-1', 1, 8).commands).reduce((a, b) => a + b, 0);
    // 06:00 is before the developers' first peak; the 8-hour average that runs into it is larger.
    expect(day).toBeGreaterThan(1.5 * early);
  });

  it('puts one DDF culprit on an image ADHOC routes to, with its zIIP-eligible share kept', () => {
    const adhoc = ws.find((w) => w.id === 'ADHOC')!;
    const r = resolveCulprits(sim, ws, { entity: 'DDF_THREAD', workloadId: 'ADHOC', count: 1, cpuMult: 10 }, 'adhoc-1');
    expect(r.commands).toHaveLength(1);
    const c = r.commands[0]!;
    expect(c.kind).toBe('SET_ENTITY_LOAD');
    if (c.kind === 'SET_ENTITY_LOAD') {
      expect(c.load.kind).toBe('DDF_THREAD');
      expect(adhoc.routing[c.load.lparId]).toBeGreaterThan(0);
      expect(c.load.cpEngines).toBeGreaterThan(0);
      expect(c.load.ziipEngines).toBeGreaterThan(0);
    }
  });

  it('returns no commands for an unknown workload', () => {
    expect(resolveCulprits(sim, ws, { ...tsoSpec, workloadId: 'NOPE' }, 'x')).toEqual({ ids: [], commands: [] });
  });
});
