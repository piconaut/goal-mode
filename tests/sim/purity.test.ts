import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Enforces CLAUDE.md architecture rules: the sim is pure and deterministic.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/Math\.random\s*\(/, 'Math.random'],
  [/Date\.now\s*\(/, 'Date.now'],
  [/new Date\s*\(/, 'new Date'],
  [/performance\.now\s*\(/, 'performance.now'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'timers'],
  [/\bdocument\.|\bwindow\./, 'DOM access'],
  [/from\s+['"][^'"]*\/(game|ui|worker)\//, 'import from game/ui/worker'],
  [/from\s+['"]react/, 'react import'],
];

describe('sim purity', () => {
  for (const f of files('src/sim')) {
    it(`${f} has no forbidden APIs`, () => {
      const src = readFileSync(f, 'utf8');
      for (const [re, what] of FORBIDDEN) expect(re.test(src), `${f} uses ${what}`).toBe(false);
    });
  }
});
