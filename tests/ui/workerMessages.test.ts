// CL-36: the worker's message switch is exhaustive. The compile-time guard in game.worker.ts only holds while its
// last line is there, so a refactor that deletes the default (and then the now-unused helper) must fail a check.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('worker message switch', () => {
  it('ends in assertNever, whose parameter is never', () => {
    const src = readFileSync('src/worker/game.worker.ts', 'utf8');
    expect(src).toMatch(/default:\s*\n\s*assertNever\(m\);/);
    expect(src).toMatch(/function assertNever\(x: never\): never/);
  });
});
