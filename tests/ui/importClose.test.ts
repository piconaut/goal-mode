// PR-06: once an import is confirmed the worker will replace the run on its own, so the dialog must stay open until
// IMPORT_RESULT arrives. Closing early used to leave a dialog saying it was cancelled while the run had changed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dialog = () => readFileSync('src/ui/RunFiles.tsx', 'utf8');

describe('closing the import dialog', () => {
  it('refuses to close while the import is in flight', () => {
    const src = dialog();
    // close() returns early, the Close button is disabled, and Escape does not dismiss the dialog.
    expect(src).toMatch(/const close = \(\) => \{[\s\S]*?if \(loading\) return;/);
    expect(src).toMatch(/className="modal-close"[^>]*disabled=\{loading\}/);
    expect(src).toMatch(/onCancel=\{\(e\) => \{\s*if \(loading\) e\.preventDefault\(\);/);
  });

  it('still closes when no import is in flight', () => {
    const src = dialog();
    // The loading guard is the first line of the handler, not an unconditional return, and a later guard (PR-08's
    // already-closing check) still lets a real close reach the session bump.
    expect(src).toMatch(/const close = \(\) => \{[\s\S]{0,300}?if \(loading\) return;/);
    expect(src).toMatch(/if \(loading\) return;[\s\S]{0,200}?session\.current\+\+;/);
    expect(src).not.toMatch(/const close = \(\) => \{\s*return;/);
  });
});
