import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// WCAG 2.x contrast of the theme tokens in styles.css: text-like tokens need 4.5:1 on every surface.
const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start), css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const dark = tokens(':root {');
const themes: Record<string, Record<string, string>> = {
  dark,
  light: { ...dark, ...tokens(":root[data-theme='light']") },
  '3270': { ...dark, ...tokens(":root[data-theme='3270']") },
};

describe('theme contrast', () => {
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: text and status colours reach 4.5:1 on every surface`, () => {
      for (const fg of ['text', 'muted', 'accent', 'good', 'warn', 'bad', 'crit'])
        for (const bg of ['bg', 'panel', 'panel-2']) expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.bg!, t.accent!), 'primary button label').toBeGreaterThanOrEqual(4.5);
    });
  }
});
