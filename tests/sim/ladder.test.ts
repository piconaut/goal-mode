// The canonical ladder (docs/wlm-design.md §5.6, WT-06).
import { describe, expect, it } from 'vitest';
import { canonical, ladderOf, levelDp, levelOf, MAX_LEVELS, moveToLevel, placeNew, raiseOneStep, type Ladder } from '../../src/sim/wlm/ladder';
import { DP } from '../../src/sim/zos/dispatcher';
import { Rng, seedRng } from '../../src/sim/core/rng';

const uniform = (seed: number) => {
  const r = new Rng(seedRng(seed));
  return { next: () => r.nextU32() / 2 ** 32 };
};

const L = (...levels: string[][]): Ladder => levels;

describe('the DP table (SG24-6472 p.65, "as of z/OS 1.8")', () => {
  it('keeps the reserved priorities above goal work and MANAGED_MAX free', () => {
    expect([DP.SYSTEM, DP.SYSSTC, DP.PROMOTED, DP.RG_MINIMUM, DP.SMALL_CONSUMER, DP.MANAGED_MAX, DP.MANAGED_MIN]).toEqual([255, 254, 253, 249, 248, 247, 203]);
    expect(levelDp(0)).toBe(DP.MANAGED_MAX - 1);
    expect(levelDp(MAX_LEVELS - 1)).toBeGreaterThanOrEqual(DP.MANAGED_MIN);
    expect(levelDp(MAX_LEVELS)).toBeLessThan(DP.MANAGED_MIN);
  });
});

describe('canonical', () => {
  it('gives level i the DP MANAGED_MAX − 1 − 2i: one free priority between levels, none at MANAGED_MAX', () => {
    expect(canonical(L(['A'], ['B', 'C'], ['D']))).toEqual({ A: 246, B: 244, C: 244, D: 242 });
  });

  it('keeps the order of any DPs and is idempotent', () => {
    const rng = uniform(7);
    for (let n = 0; n < 200; n++) {
      const dps: Record<string, number> = {};
      const count = 1 + Math.floor(rng.next() * 12);
      for (let i = 0; i < count; i++) dps[`P${i}`] = 203 + Math.floor(rng.next() * 50);
      const c = canonical(ladderOf(dps));
      expect(canonical(ladderOf(c))).toEqual(c);
      for (const a of Object.keys(dps)) {
        for (const b of Object.keys(dps)) expect(Math.sign(c[a]! - c[b]!)).toBe(Math.sign(dps[a]! - dps[b]!));
        expect(c[a]).not.toBe(DP.MANAGED_MAX);
      }
    }
  });

  it('merges the lowest levels when there are more than the range holds (APPROX)', () => {
    const many = L(...Array.from({ length: MAX_LEVELS + 2 }, (_, i) => [`P${String(i).padStart(2, '0')}`]));
    const c = canonical(many);
    expect(new Set(Object.values(c)).size).toBe(MAX_LEVELS);
    expect(Math.min(...Object.values(c))).toBeGreaterThanOrEqual(DP.MANAGED_MIN);
  });
});

describe('raiseOneStep (WLM Services p.707, codes 635 and 620)', () => {
  it('splits a shared level: the holder alone on a new level directly above', () => {
    expect(raiseOneStep(L(['A'], ['B', 'C']), 'C')).toEqual(L(['A'], ['C'], ['B']));
  });

  it('joins the next level above when alone', () => {
    expect(raiseOneStep(L(['A'], ['B'], ['C']), 'C')).toEqual(L(['A'], ['B', 'C']));
  });

  it('makes a new top level from a shared top level, and no step from alone on top', () => {
    expect(raiseOneStep(L(['A', 'B'], ['C']), 'B')).toEqual(L(['B'], ['A'], ['C']));
    const top = L(['A'], ['B']);
    expect(raiseOneStep(top, 'A')).toBe(top);
  });
});

describe('moveToLevel (WLM Services p.706, codes 530, 540, 531)', () => {
  it('moves a donor onto the receiver\'s level, or alone just below it', () => {
    expect(moveToLevel(L(['D'], ['R']), 'D', 1)).toEqual(L(['D', 'R']));
    expect(moveToLevel(L(['D', 'R'], ['X']), 'D', 0, 'below')).toEqual(L(['R'], ['D'], ['X']));
  });

  it('drops a level the move empties', () => {
    expect(moveToLevel(L(['A'], ['D'], ['R']), 'D', 2, 'below')).toEqual(L(['A'], ['R'], ['D']));
  });
});

describe('placeNew', () => {
  const imp: Record<string, number> = { I1: 1, I2: 1, J2: 2, K3: 3, K3B: 3, M4: 4, N5: 5 };
  const importanceOf = (k: string) => imp[k];

  it('joins the lowest level holding its importance', () => {
    expect(placeNew(L(['I1'], ['K3'], ['M4']), 'K3B', 3, importanceOf)).toEqual(L(['I1'], ['K3', 'K3B'], ['M4']));
  });

  it('else a new level directly below the lowest more important one, or on top', () => {
    expect(placeNew(L(['I1'], ['M4']), 'K3', 3, importanceOf)).toEqual(L(['I1'], ['K3'], ['M4']));
    expect(placeNew(L(['K3'], ['M4']), 'I1', 1, importanceOf)).toEqual(L(['I1'], ['K3'], ['M4']));
  });

  it('builds one level per importance present, importance 1 on top, in any order', () => {
    const keys = ['N5', 'K3', 'I1', 'M4', 'K3B', 'I2', 'J2'];
    const want = L(['I1', 'I2'], ['J2'], ['K3', 'K3B'], ['M4'], ['N5']);
    const rng = uniform(3);
    for (let n = 0; n < 50; n++) {
      const order = [...keys];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      let ladder: Ladder = [];
      for (const k of order) ladder = placeNew(ladder, k, imp[k]!, importanceOf);
      expect(ladder).toEqual(want);
      expect(levelOf(ladder, 'N5')).toBe(4);
    }
  });
});
