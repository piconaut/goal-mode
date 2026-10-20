// Golden runs: a seeded, scripted run hashed at the end of each played day. Any change to these hashes
// must be intentional; regenerate with `UPDATE_GOLDEN=1 npx vitest run tests/golden` and say why in the commit.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { SCENARIOS } from '../../src/content/scenarios';
import { advance, chooseDraft, newRun, requestChange, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { TICKS_PER_DAY } from '../../src/sim/core/units';
import { textbookPolicy } from '../../tools/strategies';

const FILE = new URL('./hashes.json', import.meta.url);
const DAYS = 2;
const hash = (run: RunState) => createHash('sha256').update(JSON.stringify(run)).digest('hex').slice(0, 16);

/** Day 1: a policy change, a weight change and a soft cap; day 2: an emergency change mid-morning. */
function scriptedRun(seed: number): string[] {
  const scenario = SCENARIOS.midwest!;
  const c = MIDWEST_GAME;
  let run = newRun(scenario, c, seed);
  const hashes: string[] = [];
  for (let day = 0; day < DAYS; day++) {
    if (day === 0) {
      run = requestChange(run, c, { label: 'Policy', commands: [{ kind: 'ACTIVATE_POLICY', definition: textbookPolicy() }] }).run;
      run = requestChange(run, c, { label: 'Weights', commands: [{ kind: 'SET_WEIGHT', lparId: 'DEVT', pool: 'CP', weight: 65 }] }).run;
      run = requestChange(run, c, { label: 'Soft cap', commands: [{ kind: 'SET_DEFINED_CAPACITY', lparId: 'DEVT', msu: 60 }] }).run;
    }
    run = startDay(run, c);
    if (day === 1) {
      run = advance(run, scenario, c, 4 * 360);
      run = requestChange(run, c, { label: 'RMF interval', commands: [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }] }).run;
    }
    run = advance(run, scenario, c, TICKS_PER_DAY);
    hashes.push(hash(run));
    if (run.phase === 'REVIEW') run = chooseDraft(run, c, run.draft?.[0]?.id ?? null);
  }
  return hashes;
}

describe('golden runs', () => {
  it('seed 42 scripted run matches the recorded per-day hashes', () => {
    const got = { seed42: scriptedRun(42) };
    if (process.env.UPDATE_GOLDEN) writeFileSync(FILE, JSON.stringify(got, null, 2) + '\n');
    const want = JSON.parse(readFileSync(FILE, 'utf8')) as typeof got;
    expect(got).toEqual(want);
  }, 300_000);
});
