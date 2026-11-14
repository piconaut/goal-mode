// PR-07: an open <dialog class="modal"> must stay fixed to the viewport. `.modal`'s relative box exists for the
// overlay card's absolutely positioned Close button; applied to a dialog it overrides the UA's fixed modal
// placement, so the dialog became part of the page flow and scrolled away at phone width. This evaluates the
// cascade (specificity, then source order) for the two elements that carry the class.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');

type Rule = { selector: string; position?: string; specificity: number; order: number };

function rules(source: string): Rule[] {
  const out: Rule[] = [];
  // Comments and at-rule wrappers are irrelevant here; inner rules are still matched.
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let order = 0;
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const part of m[1]!.split(',')) {
      const selector = part.trim().replace(/\s+/g, ' ');
      if (!selector || selector.startsWith('@')) continue;
      const position = /(?:^|;)\s*position\s*:\s*([^;]+)/.exec(m[2]!)?.[1]?.trim();
      const specificity =
        (selector.match(/\.[\w-]+/g)?.length ?? 0) * 10 + (selector.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi)?.length ?? 0);
      if (position) out.push({ selector, position, specificity, order: order++ });
    }
  }
  return out;
}

const all = rules(css);

/** The position that wins for an element, from selectors that are plain compounds of the given tokens. */
function winningPosition(type: 'dialog' | 'div', classes: string[]): string | undefined {
  const candidates = all.filter((rule) => {
    const tokens = rule.selector.split(/(?=[.#])/).filter(Boolean);
    return tokens.every(
      (t) => (t.startsWith('.') && classes.includes(t.slice(1))) || (t === type && !t.startsWith('.')),
    );
  });
  const winner = candidates.sort((a, b) => b.specificity - a.specificity || b.order - a.order)[0];
  return winner?.position;
}

describe('modal placement', () => {
  it('an open <dialog class="modal"> stays fixed to the viewport', () => {
    // Both dialogs gain the class while open: the import/export dialog and the confirmation dialog.
    expect(winningPosition('dialog', ['modal'])).toBe('fixed');
  });

  it('the overlay card keeps its relative box for the absolutely positioned Close button', () => {
    expect(winningPosition('div', ['modal'])).toBe('relative');
    expect(all.some((r) => r.selector === '.modal-close' && r.position === 'absolute')).toBe(true);
  });
});
