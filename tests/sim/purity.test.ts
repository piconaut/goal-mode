import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Enforces CLAUDE.md architecture rules: the sim is pure and deterministic.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** A specifier that reaches into a higher layer: `from '…/game/…'`, `import('…/game/…')`, `require(…)`, bare dirs. */
const LAYER_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*\/(game|ui|worker)(?:\/|['"])/;

const FORBIDDEN: [RegExp, string][] = [
  [/Math\.random\s*\(/, 'Math.random'],
  [/Date\.now\s*\(/, 'Date.now'],
  [/new Date\s*\(/, 'new Date'],
  [/performance\.now\s*\(/, 'performance.now'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'timers'],
  [/\bdocument\.|\bwindow\./, 'DOM access'],
  [LAYER_IMPORT, 'import from game/ui/worker'],
  [/from\s+['"]react/, 'react import'],
];

/** CLAUDE.md layering (content → sim ← game ← ui): content may import content and the sim, never game, ui or worker. */
const LAYERING: [RegExp, string][] = [[LAYER_IMPORT, 'import from game/ui/worker']];

describe('sim purity', () => {
  for (const f of files('src/sim')) {
    it(`${f} has no forbidden APIs`, () => {
      const src = readFileSync(f, 'utf8');
      for (const [re, what] of FORBIDDEN) expect(re.test(src), `${f} uses ${what}`).toBe(false);
    });
  }
});

describe('content layering', () => {
  for (const f of files('src/content')) {
    it(`${f} imports nothing from game, ui or worker`, () => {
      const src = readFileSync(f, 'utf8');
      for (const [re, what] of LAYERING) expect(re.test(src), `${f} has ${what}`).toBe(false);
    });
  }

  it('the layering rule catches every import form and leaves content paths alone', () => {
    for (const src of [
      "import type { Mechanism } from '../game/types';",
      "export type { X } from '../game/types';",
      "type X = import('../game/types').X;",
      "const m = await import('../game/types');",
      "const m = require('../game/types');",
      "import { X } from '../game';",
      "import { X } from '../../ui/x';",
    ]) expect(LAYER_IMPORT.test(src), src).toBe(true);
    for (const src of [
      "import type { GameContent } from './types';",
      "import { HARBOURLINE_GAME } from './game-harbourline';",
      "import { step } from '../../sim/core/step';",
      "import type { Command } from '../../sim/core/commands';",
    ]) expect(LAYER_IMPORT.test(src), src).toBe(false);
  });
});
