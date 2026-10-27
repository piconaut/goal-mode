import { describe, expect, it } from 'vitest';
import { hintLevelFor, morningHints } from '../../src/game/hints';
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

  it('points at the per-transaction records when WLMGL had the class meeting its goal', () => {
    const incs = [inc('MKTORD', 'QR_TCB', 3)];
    expect(morningHints('CLEAR', incs, null)[0]).not.toContain('SMF 110');
    const [clear] = morningHints('CLEAR', incs, null, { MKTORD: 'CICS' });
    expect(clear).toContain('CICS report');
    expect(clear).toContain('SMF 110');
    expect(morningHints('VAGUE', incs, null, { MKTORD: 'CICS' })[0]).toContain('SMF 110');
    expect(morningHints('CLEAR', incs, null, { MKTORD: 'DDF' })[0]).toContain('SMF 101');
  });
});

describe('wlmHidSlides', () => {
  it('flags an incident workload only when every host class met its goal all day', async () => {
    const { MIDWEST_GAME } = await import('../../src/content/game-midwest');
    const { SCENARIOS } = await import('../../src/content/scenarios');
    const { newRun, wlmHidSlides } = await import('../../src/game/run');
    const { classify } = await import('../../src/sim/wlm/classify');
    const sc = SCENARIOS.midwest!;
    const run = newRun(sc, MIDWEST_GAME, 42, 'NORMAL');
    const w = sc.workloads.find((x) => x.work.subsystem === 'CICS')!;
    const keys = Object.entries(w.routing).filter(([, f]) => f > 0).map(([l]) => `${classify(run.sim.wlm.definition, { ...w.work, SY: l }).serviceClass}#1`);
    const fine = Object.fromEntries(keys.map((k) => [k, 0.8]));
    expect(wlmHidSlides(run, sc, [inc(w.id, 'QR_TCB', 2)], fine)).toEqual({ [w.id]: 'CICS' });
    expect(wlmHidSlides(run, sc, [], fine)).toEqual({});
    expect(wlmHidSlides(run, sc, [inc(w.id, 'QR_TCB', 2)], { ...fine, [keys[0]!]: 1.4 })).toEqual({});
    expect(wlmHidSlides(run, sc, [inc(w.id, 'QR_TCB', 2)], {})).toEqual({});
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

describe('mentor perk', () => {
  it('raises the hint level one step', () => {
    expect(hintLevelFor('NONE', ['MENTOR'])).toBe('VAGUE');
    expect(hintLevelFor('VAGUE', ['MENTOR'])).toBe('CLEAR');
    expect(hintLevelFor('CLEAR', ['MENTOR'])).toBe('CLEAR');
    expect(hintLevelFor('NONE', [])).toBe('NONE');
  });
});
