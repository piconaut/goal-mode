import { AIOPS } from '../../src/content/alerts';
import { aiopsHypotheses } from '../../src/game/aiops';
import { Rng, seedRng } from '../../src/sim/core/rng';

describe('AIOps hypotheses', () => {
  const truth = { mechanism: 'LOCK_CONTENTION' as const, trigger: 'BATCH_OVERLAP' as const };
  const groups = ['LOCK_CONTENTION', 'CPU', 'IO', 'CF_SERVICE'];
  it('is right about as often as configured, and always lists the truth in the top two', () => {
    let right = 0;
    for (let i = 0; i < 400; i++) {
      const hs = aiopsHypotheses(truth, groups, new Rng(seedRng(i + 1)));
      expect(hs).toHaveLength(AIOPS.hypotheses);
      expect(hs.slice(0, 2).some((h) => h.mechanism === truth.mechanism)).toBe(true);
      expect(hs[0]!.confidence).toBeGreaterThan(hs[1]!.confidence);
      if (hs[0]!.mechanism === truth.mechanism) right++;
    }
    expect(right / 400).toBeGreaterThan(AIOPS.mechanismAccuracy - 0.08);
    expect(right / 400).toBeLessThan(AIOPS.mechanismAccuracy + 0.08);
  });
  it('wrong answers are plausible: the runner-up from the evidence', () => {
    for (let i = 0; i < 100; i++) {
      const hs = aiopsHypotheses(truth, groups, new Rng(seedRng(i + 1)));
      if (hs[0]!.mechanism !== truth.mechanism) expect(hs[0]!.mechanism).toBe('CPU_PRIORITY');
    }
  });
  it('is deterministic for a seed', () => {
    expect(aiopsHypotheses(truth, groups, new Rng(seedRng(9)))).toEqual(aiopsHypotheses(truth, groups, new Rng(seedRng(9))));
  });
});

describe('AIOps in a run', () => {
  it('attaches hypotheses to incidents only with the tool', async () => {
    const { MIDWEST_GAME } = await import('../../src/content/game-midwest');
    const { MIDWEST } = await import('../../src/content/scenarios');
    const { advance, newRun, startDay } = await import('../../src/game/run');
    const content = { ...MIDWEST_GAME, events: [] };
    // A tight cap on PROD2 guarantees incidents on day 1.
    const play = (tools: string[]) =>
      advance(startDay({ ...newRun(MIDWEST, content, 7), tools, pendingCommands: [{ kind: 'SET_DEFINED_CAPACITY', lparId: 'PROD2', msu: 250 }] }, content), MIDWEST, content, 8 * 360);
    const on = play(['AIOPS']);
    expect(on.incidents.length).toBeGreaterThan(0);
    expect(on.incidents.every((i) => (i.aiops?.length ?? 0) === AIOPS.hypotheses)).toBe(true);
    expect(play([]).incidents.every((i) => i.aiops === undefined)).toBe(true);
  }, 60_000);
});
