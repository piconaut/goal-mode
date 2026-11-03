// The GameHandle from useGame is a new object on every render, and every worker reply re-renders. An effect that
// sends a request and lists `game` as a dependency therefore re-sends on each reply: a request loop that floods the
// worker (RMF Reports did ~900 GET_REPORT/s until the worker's queue backed up). Depend on `game.send` instead.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });

describe('UI effects', () => {
  it('no effect that sends to the worker depends on the whole game handle', () => {
    const bad: string[] = [];
    for (const f of files('src/ui')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\)/g)) {
        const sends = /\bgame\.send\(/.test(m[1]!);
        const wholeGame = m[2]!.split(',').some((d) => d.trim() === 'game');
        if (sends && wholeGame && !/addEventListener/.test(m[1]!)) bad.push(`${f}: [${m[2]}]`);
      }
    }
    expect(bad).toEqual([]);
  });
});
