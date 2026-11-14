// PR-07: an open <dialog class="modal"> must stay fixed to the viewport. `.modal`'s relative box exists for the
// overlay card's absolutely positioned Close button; applied to a dialog it overrides the UA's modal placement, so
// the dialog became part of the page flow and scrolled away. This evaluates the cascade (origin aside: specificity,
// then source order) for the two elements that carry the class, and refuses rules it cannot model instead of
// silently ignoring them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');

type Decl = { selector: string; position: string | null; specificity: number; order: number; media: string | null };

/** Declarations with `position`, in source order, tagged with the enclosing @media condition. */
function declarations(source: string): Decl[] {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Decl[] = [];
  const media: (string | null)[] = [];
  let prelude = '';
  let order = 0;
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i]!;
    if (c === '}') {
      media.pop();
      prelude = '';
    } else if (c === '{') {
      const head = prelude.trim().replace(/\s+/g, ' ');
      prelude = '';
      if (head.startsWith('@')) {
        media.push(head.startsWith('@media') ? head : (media.at(-1) ?? null));
        continue;
      }
      const end = bare.indexOf('}', i);
      const body = bare.slice(i + 1, end);
      const position = /(?:^|;)\s*position\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? null;
      for (const part of head.split(',')) {
        const selector = part.trim();
        if (selector) out.push({ selector, position, specificity: specificity(selector), order: order++, media: media.at(-1) ?? null });
      }
      i = end - 1;
    } else prelude += c;
  }
  return out.filter((d) => d.position);
}

/** ids ×100, classes/attributes/pseudo-classes ×10, types/pseudo-elements ×1. */
function specificity(selector: string): number {
  const rest = selector.replace(/:[a-z-]+\([^)]*\)/gi, ':x');
  const ids = rest.match(/#[\w-]+/g)?.length ?? 0;
  const classes = rest.match(/[.:][\w-]+/g)?.length ?? 0;
  const types = rest.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi)?.length ?? 0;
  return ids * 100 + classes * 10 + types;
}

type Compound = { tag?: string; classes: string[]; pseudos: string[]; odd: boolean };

function compounds(selector: string): Compound[] {
  return selector.split(/\s*[>+~]\s*|\s+/).map((part) => {
    const tokens = part.match(/(^[a-z][\w-]*)|(\.[\w-]+)|(:[\w-]+(?:\([^)]*\))?)|([#[])/gi) ?? [];
    const c: Compound = { classes: [], pseudos: [], odd: false };
    for (const t of tokens) {
      if (t.startsWith('.')) c.classes.push(t.slice(1));
      else if (t.startsWith(':')) c.pseudos.push(t);
      else if (/^[a-z]/i.test(t)) c.tag = t.toLowerCase();
      else c.odd = true; // id, attribute or anything else we do not model
    }
    if (part.replace(tokens.join(''), '').trim()) c.odd = true;
    return c;
  });
}

/** A rule the evaluator can place in the cascade for an element of `type` carrying `classes`. */
function matches(selector: string, type: string, classes: string[], open: boolean): boolean | 'unmodelled' {
  const parts = compounds(selector);
  const last = parts.at(-1)!;
  const pseudoOk = (p: string) => (open && p === ':modal') || (open && /^:(hover|focus|active|focus-visible)/.test(p));
  if (last.odd || parts.some((p) => p.odd)) return 'unmodelled';
  // Interactive pseudo-classes are false at rest, so such a rule never applies; :modal is true for an open modal.
  const matchesSelf =
    (last.tag === undefined || last.tag === type) &&
    last.classes.every((c) => classes.includes(c)) &&
    last.pseudos.every(pseudoOk);
  if (!matchesSelf) return false;
  // Ancestor compounds are assumed to be able to match; only selectors we can read count.
  if (parts.slice(0, -1).some((p) => p.pseudos.length > 0)) return 'unmodelled';
  return true;
}

function winner(type: string, classes: string[]): Decl | undefined {
  return declarations(css)
    .filter((d) => matches(d.selector, type, classes, true) === true && !d.media)
    .sort((a, b) => b.specificity - a.specificity || b.order - a.order)[0];
}

const modalTargets: [string, string[]][] = [
  ['dialog', ['modal']],
  ['div', ['modal']],
];

describe('modal placement', () => {
  it('an open <dialog class="modal"> stays fixed to the viewport', () => {
    // Both dialogs gain the class while open: the import/export dialog and the confirmation dialog.
    expect(winner('dialog', ['modal'])?.position).toBe('fixed');
  });

  it('the overlay card keeps its relative box for the absolutely positioned Close button', () => {
    expect(winner('div', ['modal'])?.position).toBe('relative');
    expect(declarations(css).some((d) => d.selector === '.modal-close' && d.position === 'absolute')).toBe(true);
  });

  it('no rule the evaluator cannot model, and no width-specific rule, moves the modal', () => {
    const risky = declarations(css).filter(
      (d) => modalTargets.some(([type, classes]) => matches(d.selector, type, classes, true) === 'unmodelled'),
    );
    expect(risky.map((d) => d.selector)).toEqual([]);
    const responsive = declarations(css).filter(
      (d) => d.media && modalTargets.some(([type, classes]) => matches(d.selector, type, classes, true) === true),
    );
    expect(responsive.map((d) => `${d.media} { ${d.selector} }`)).toEqual([]);
  });
});
