import { describe, expect, it } from 'vitest';
import { morningHints } from '../../src/game/hints';
import type { Incident, Mechanism } from '../../src/game/types';

const inc = (workloadId: string, mechanism: Mechanism, hours: number, worstAttainmentPct = 90): Incident => ({
  id: 0, workloadId, day: 3, startTick: 0, endTick: 1, hours, worstAttainmentPct,
  truth: { mechanism, trigger: 'GROWTH' }, rca: null, trustLost: 0,
});
const onTime = { missed: false, criticalEndSec: 3 * 3600, deadlineSec: 6 * 3600 };

describe('morningHints', () => {
  it('gives nothing on Hard/Ironman or on a clean day', () => {
    expect(morningHints('NONE', [inc('MOBILE', 'CAPPING', 3)], { ...onTime, missed: true })).toEqual([]);
    expect(morningHints('CLEAR', [], onTime)).toEqual([]);
  });

  it('points the worst workload at the report for its true mechanism without naming the cause', () => {
    const [h] = morningHints('CLEAR', [inc('TELLER', 'IO', 1), inc('MOBILE', 'CAPPING', 3)], onTime);
    expect(h).toContain('MOBILE');
    expect(h).toContain('Partition Data');
    expect(h!.toLowerCase()).not.toContain('capping');
  });

  it('caps the count per level and keeps Normal vaguer', () => {
    const incs = [inc('A', 'IO', 3), inc('B', 'QR_TCB', 2), inc('C', 'STORAGE', 1)];
    expect(morningHints('CLEAR', incs, onTime)).toHaveLength(2);
    const vague = morningHints('VAGUE', incs, onTime);
    expect(vague).toHaveLength(1);
    expect(vague[0]!.length).toBeLessThan(morningHints('CLEAR', incs, onTime)[0]!.length);
  });

  it('leads with a missed batch deadline and mentions a tight window after incidents', () => {
    expect(morningHints('CLEAR', [inc('A', 'IO', 3)], { ...onTime, missed: true })[0]).toContain('late');
    const tight = morningHints('CLEAR', [inc('A', 'IO', 3)], { ...onTime, criticalEndSec: 6 * 3600 - 600 });
    expect(tight[1]).toContain('10 min');
  });
});

describe('morning hints in a run', () => {
  it('are dated for the next morning so the briefing shows them', async () => {
    const { MIDWEST_GAME } = await import('../../src/content/game-midwest');
    const { SCENARIOS } = await import('../../src/content/scenarios');
    const { advance, newRun, startDay } = await import('../../src/game/run');
    const { TICKS_PER_DAY } = await import('../../src/sim/core/units');
    let run = startDay(newRun(SCENARIOS.midwest!, MIDWEST_GAME, 42, 'NORMAL'), MIDWEST_GAME);
    run = advance(run, SCENARIOS.midwest!, MIDWEST_GAME, TICKS_PER_DAY);
    const hints = run.inbox.filter((m) => m.subject === 'A thought for this morning');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((m) => m.day === 1)).toBe(true);
    expect(Object.keys(run.reports[0]!.piWorst ?? {}).length).toBeGreaterThan(3);
    const forewarnings = run.inbox.filter((m) => m.subject === 'For day 2');
    expect(forewarnings.every((m) => m.day === 1)).toBe(true);
  }, 120_000);
});
