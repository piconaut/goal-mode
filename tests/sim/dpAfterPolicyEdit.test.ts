// PR-15: a period's DP is carried by key, so a policy activation that changes what the period is must reconcile it.
// A period edited to discretionary gets the fixed discretionary DP back (196, SPEC §5.4), and a period edited back to
// a goal is placed on the ladder by its importance instead of keeping 196 (which canonical would put at the bottom).
// A period a region serves keeps following its holder (WT-09): the sim dispatches a region's transactions at the
// holder's DP, so a discretionary transaction period is the one exception to 196.
import { describe, expect, it } from 'vitest';
import { MIDWEST } from '../../src/content/scenarios';
import { applyCommands, type Command } from '../../src/sim/core/commands';
import { initState } from '../../src/sim/core/init';
import { step } from '../../src/sim/core/step';
import type { SimState } from '../../src/sim/core/types';
import { levelDp } from '../../src/sim/wlm/ladder';
import { goalInfo } from '../../src/sim/wlm/runtime';
import type { Goal, Importance, ServiceDefinition } from '../../src/sim/wlm/types';
import { DP } from '../../src/sim/zos/dispatcher';
import { textbookPolicy } from '../../tools/strategies';

/** Two played hours: every image has dispatched its periods and the policy has settled. */
const played = (policy?: ServiceDefinition): SimState => {
  let s = initState(42, MIDWEST);
  if (policy) s = step(s, [{ kind: 'ACTIVATE_POLICY', definition: policy }], MIDWEST);
  for (let i = 0; i < 2 * 360; i++) s = step(s, [], MIDWEST);
  return s;
};

/** The run's policy with one period of `classId` given a goal (and importance). */
function policy(s: SimState, classId: string, period: number, goal: Goal, importance: Importance): Command {
  const definition: ServiceDefinition = {
    ...s.wlm.definition,
    classes: s.wlm.definition.classes.map((c) => (c.id === classId
      ? { ...c, periods: c.periods.map((p, i) => (i === period ? { ...p, goal, importance } : p)) }
      : c)),
  };
  return { kind: 'ACTIVATE_POLICY', definition };
}

const dpOf = (s: SimState, key: string): number | undefined =>
  s.wlm.systems.flatMap((sys) => sys.scps).find((p) => p.scKey === key)?.dp;

describe('a policy activation reconciles carried DPs (PR-15)', () => {
  it('a goal period edited to discretionary runs at the fixed discretionary DP on every image, and keeps it', () => {
    let s = played();
    expect(dpOf(s, 'DDFPRD#2')).toBe(levelDp(3)); // VEL:4, level 3 of the canonical ladder
    s = step(s, [policy(s, 'DDFPRD', 1, { kind: 'DISC' }, 4)], MIDWEST);
    for (const sys of s.wlm.systems) {
      const p = sys.scps.find((x) => x.scKey === 'DDFPRD#2');
      if (p) expect(p.dp, sys.lparId).toBe(196);
    }
    // An hour later it still is: the ladder's canonical renumbering leaves non-goal periods alone.
    for (let i = 0; i < 360; i++) s = step(s, [], MIDWEST);
    expect(dpOf(s, 'DDFPRD#2')).toBe(196);
    // The goal periods it shared its image with are still on the managed ladder, in order.
    const goals = s.wlm.systems[0]!.scps.filter((p) => goalInfo(s.wlm.definition, p.scKey)?.goal.kind !== 'DISC' && goalInfo(s.wlm.definition, p.scKey) !== null);
    expect(goals.length).toBeGreaterThan(3);
    for (const p of goals) {
      expect(p.dp, p.scKey).toBeLessThan(DP.MANAGED_MAX);
      expect(p.dp, p.scKey).toBeGreaterThanOrEqual(DP.MANAGED_MIN);
    }
  });

  it('a period that is discretionary from the policy\'s start is placed by its importance when it becomes a goal', () => {
    // DDFBI#2 is DISC in the textbook policy from the first tick, so it legitimately holds 196 before the edit: this
    // isolates the re-placement from the reset above.
    const book = textbookPolicy();
    let s = played(book);
    expect(goalInfo(book, 'DDFBI#2')?.goal.kind).toBe('DISC');
    expect(dpOf(s, 'DDFBI#2')).toBe(196);
    s = step(s, [policy(s, 'DDFBI', 1, { kind: 'VEL', velocity: 60 }, 2)], MIDWEST);
    // It shares its importance's level with DDFPRD#1 (also importance 2), not the bottom it would keep at 196.
    expect(dpOf(s, 'DDFBI#2')).toBe(dpOf(s, 'DDFPRD#1'));
    expect(dpOf(s, 'DDFBI#2')).toBeLessThan(dpOf(s, 'ONLHI#1')!);
    expect(dpOf(s, 'DDFBI#2')).toBeGreaterThanOrEqual(DP.MANAGED_MIN);
  });

  it('a managed to managed goal-kind change keeps its level: placement follows importance, not the goal kind', () => {
    let s = played();
    const before = dpOf(s, 'DDFPRD#2');
    s = step(s, [policy(s, 'DDFPRD', 1, { kind: 'AVG', rtSec: 0.4 }, 4)], MIDWEST);
    expect(dpOf(s, 'DDFPRD#2')).toBe(before);
  });

  it('a CICS transaction period keeps following its holder, even when its own goal becomes discretionary', () => {
    let s = played();
    const server = s.wlm.systems[0]!.servers![0]!;
    expect(dpOf(s, 'ONLHI#1')).toBe(server.dp);
    s = step(s, [policy(s, 'ONLMED', 0, { kind: 'DISC' }, 2)], MIDWEST);
    // The region's transactions share the holder's DP (WT-09), so the discretionary transaction period is not 196 and
    // the server keeps the priority the remaining goal periods need.
    expect(dpOf(s, 'ONLMED#1')).toBe(s.wlm.systems[0]!.servers![0]!.dp);
    expect(dpOf(s, 'ONLMED#1')).toBeGreaterThan(196);
    expect(goalInfo(s.wlm.definition, 'ONLMED#1')?.goal.kind).toBe('DISC');
  });

  it('the applied definition is the one the edit produced', () => {
    const s = played();
    const next = applyCommands(s, [policy(s, 'DDFPRD', 1, { kind: 'DISC' }, 4)]);
    expect(goalInfo(next.wlm.definition, 'DDFPRD#2')?.goal.kind).toBe('DISC');
  });
});
