import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { advance, newRun } from '../../src/game/run';
import { forkForWhatIf, summarizeWhatIf, whatIfContent } from '../../src/game/whatif';
import { TICKS_PER_DAY } from '../../src/sim/core/units';

const playDay = (r: ReturnType<typeof newRun>) => advance(r, MIDWEST, whatIfContent(MIDWEST_GAME), TICKS_PER_DAY);

describe('what-if simulator', () => {
  it('compares a proposal with the baseline without touching the real run', () => {
    const run = newRun(MIDWEST, MIDWEST_GAME, 7);
    const snapshot = JSON.stringify(run);
    const base = playDay(forkForWhatIf(run, MIDWEST_GAME, []));
    const capped = playDay(forkForWhatIf(run, MIDWEST_GAME, [{ kind: 'SET_DEFINED_CAPACITY', lparId: 'PROD2', msu: 250 }]));
    const b = summarizeWhatIf(base);
    const c = summarizeWhatIf(capped);
    expect(base.phase).toBe('REVIEW');
    expect(c.peakR4haSum).toBeLessThan(b.peakR4haSum);
    expect(c.breachHours).toBeGreaterThan(b.breachHours);
    expect(JSON.stringify(run)).toBe(snapshot);
  }, 120_000);

  it('has no hidden events and does not replay the real day’s noise', () => {
    const run = { ...newRun(MIDWEST, MIDWEST_GAME, 7) };
    const f = forkForWhatIf(run, MIDWEST_GAME, []);
    expect(f.events).toEqual([]);
    expect(f.sim.rng).not.toEqual(run.sim.rng);
    expect(f.phase).toBe('LIVE');
  });
});
