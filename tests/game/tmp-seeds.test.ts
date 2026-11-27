import { it } from 'vitest';
it('seeds', async () => {
  const { MIDWEST_GAME } = await import('../../src/content/game-midwest');
  const { SCENARIOS } = await import('../../src/content/scenarios');
  const { advance, chooseDraft, newRun, startDay } = await import('../../src/game/run');
  const { TICKS_PER_DAY } = await import('../../src/sim/core/units');
  const out: string[] = [];
  for (let seed = 1; seed <= 8; seed++) {
    let run = startDay(newRun(SCENARIOS.midwest!, MIDWEST_GAME, seed, 'NORMAL'), MIDWEST_GAME);
    const counts: number[] = [];
    for (let d = 0; d < 2; d++) {
      run = advance(run, SCENARIOS.midwest!, MIDWEST_GAME, TICKS_PER_DAY);
      counts.push(run.inbox.filter((m) => m.subject === 'A thought for this morning').length);
      run = startDay(chooseDraft(run, MIDWEST_GAME, null), MIDWEST_GAME);
    }
    out.push(`seed ${seed}: ${counts.join(',')}`);
  }
  console.log('SEEDS ' + out.join(' | '));
}, 900000);
