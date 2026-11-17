// DP placement for periods an image has not dispatched before (WT-06, docs/wlm-design.md §5.6).
import { describe, expect, it } from 'vitest';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { placeLateDp, placeNewPeriods } from '../../src/sim/wlm/runtime';
import { DP } from '../../src/sim/zos/dispatcher';

const GOAL_KEYS = ['STCHI#1', 'STCMED#1', 'STCLO#1', 'ONLHI#1', 'ONLMED#1', 'DDFPRD#1', 'BATCHPRD#1', 'BATCHHI#1', 'TSO#1'];

describe('placeNewPeriods (the tick a period first appears)', () => {
  it('places new goal periods one level per importance present, canonical from the top', () => {
    // BASEPOL: STCHI is importance 1, STCMED 3, STCLO 5.
    expect(placeNewPeriods(BASEPOL, {}, ['STCMED#1', 'STCHI#1', 'STCLO#1'])).toEqual({
      'STCHI#1': DP.MANAGED_MAX - 1,
      'STCMED#1': DP.MANAGED_MAX - 3,
      'STCLO#1': DP.MANAGED_MAX - 5,
    });
  });

  it('gives a new discretionary period its fixed DP below the managed range', () => {
    expect(placeNewPeriods(BASEPOL, {}, ['DEVBAT#1'])).toEqual({ 'DEVBAT#1': 196 });
  });

  it('puts a more important period on a new top level, renumbering the old top down', () => {
    expect(placeNewPeriods(BASEPOL, { 'STCMED#1': DP.MANAGED_MAX - 1 }, ['STCHI#1'])).toEqual({
      'STCHI#1': DP.MANAGED_MAX - 1,
      'STCMED#1': DP.MANAGED_MAX - 3,
    });
  });
});

describe('placeLateDp (a period met after the tick is placed)', () => {
  it('takes the free priority below the level above it', () => {
    // STCMED (importance 3) belongs below STCHI (importance 1) at 246: 245 is the free priority between.
    expect(placeLateDp(BASEPOL, { 'STCHI#1': DP.MANAGED_MAX - 1 }, 'STCMED#1')).toBe(DP.MANAGED_MAX - 2);
  });

  it('shares the top level above it rather than occupying MANAGED_MAX, which is kept free', () => {
    // STCHI (importance 1) belongs above STCMED (importance 3) at 246. There is no free priority above the top
    // level: MANAGED_MAX is reserved (docs/wlm-design.md §5.6, I9), so the new period joins the top level.
    expect(placeLateDp(BASEPOL, { 'STCMED#1': DP.MANAGED_MAX - 1 }, 'STCHI#1')).toBe(DP.MANAGED_MAX - 1);
  });

  it('gives a non-goal period its fixed DP', () => {
    expect(placeLateDp(BASEPOL, { 'STCHI#1': DP.MANAGED_MAX - 1 }, 'DEVBAT#1')).toBe(196);
  });

  it('never returns a DP outside the managed range for a goal period', () => {
    // Every importance of the base policy, placed after every other class has a level from the top.
    const heldSets: Record<string, number>[] = [
      {},
      { 'STCMED#1': DP.MANAGED_MAX - 1 },
      { 'STCLO#1': DP.MANAGED_MIN },
      { 'STCHI#1': DP.MANAGED_MAX - 1, 'STCMED#1': DP.MANAGED_MAX - 3 },
    ];
    for (const held of heldSets) {
      for (const k of GOAL_KEYS) {
        if (held[k] !== undefined) continue;
        const dp = placeLateDp(BASEPOL, held, k);
        expect(dp).toBeGreaterThanOrEqual(DP.MANAGED_MIN);
        expect(dp).toBeLessThan(DP.MANAGED_MAX);
      }
    }
  });
});
