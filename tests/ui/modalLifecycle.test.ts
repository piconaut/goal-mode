// PR-08: `mode` resets the dialog's class and `el.close()` must land in the same commit, or the browser paints one
// frame with an open, unstyled <dialog>. That is why the effect is a layout effect. The paint itself needs a browser
// (PR-09 owns the real lifecycle test); these checks guard the timing and the double close().
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runFiles = () => readFileSync('src/ui/RunFiles.tsx', 'utf8');
const confirmation = () => readFileSync('src/ui/Confirmation.tsx', 'utf8');

describe('modal open/close timing', () => {
  it('opens and closes the dialog in a layout effect, in the commit that changes its class', () => {
    const src = runFiles();
    expect(src).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*?el\.showModal\(\)[\s\S]*?el\.close\(\)[\s\S]*?\}, \[mode\]\);/,
    );
    // No passive effect may drive showModal()/close(): it would run after the frame has painted.
    expect(src).not.toMatch(/useEffect\(\(\) => \{[\s\S]*?el\.(showModal|close)\(/);
  });

  it('the confirmation dialog has always used the layout effect', () => {
    expect(confirmation()).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?el\.showModal\(\)/);
  });

  it('close() is idempotent, so Escape does not close twice', () => {
    const src = runFiles();
    const body = /const close = \(\) => \{([\s\S]*?)\n  \};/.exec(src)?.[1] ?? '';
    expect(body).toMatch(/if \(mode === null\) return;/);
    // The guard must come before the session bump, or a queued close event still invalidates the next dialog.
    expect(body.indexOf('if (mode === null) return;')).toBeLessThan(body.indexOf('session.current++'));
  });
});
