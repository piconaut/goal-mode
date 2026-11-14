// PR-08: `mode` resets the dialog's class and `el.close()` must land in the same commit, or the browser paints one
// frame with an open, unstyled <dialog>. That is why the effect is a layout effect. The paint itself needs a browser
// (PR-09 owns the real lifecycle test); these checks guard the timing and the double close().
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runFiles = () => readFileSync('src/ui/RunFiles.tsx', 'utf8');
const confirmation = () => readFileSync('src/ui/Confirmation.tsx', 'utf8');

type Effect = { layout: boolean; body: string; deps: string };

/** The component's effects, split by their dependency array so a check cannot scan across an effect boundary. */
const effects = (src: string): Effect[] =>
  [...src.matchAll(/use(Layout)?Effect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/g)].map((m) => ({
    layout: m[1] === 'Layout',
    body: m[2]!,
    deps: m[3]!,
  }));

describe('modal open/close timing', () => {
  it('opens and closes the dialog in a layout effect, in the commit that changes its class', () => {
    const mode = effects(runFiles()).filter((e) => e.deps === 'mode');
    expect(mode).toHaveLength(1);
    expect(mode[0]!.layout).toBe(true);
    expect(mode[0]!.body).toContain('el.showModal()');
    expect(mode[0]!.body).toContain('el.close()');
    // No passive effect may drive showModal()/close(): it would run after the frame has painted.
    for (const e of effects(runFiles())) if (!e.layout) expect(e.body).not.toMatch(/el\.(showModal|close)\(/);
  });

  it('the confirmation dialog has always used the layout effect', () => {
    const pending = effects(confirmation()).filter((e) => e.deps === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.layout).toBe(true);
    expect(pending[0]!.body).toContain('el.showModal()');
  });

  it('close() is idempotent, so Escape does not close twice', () => {
    const body = /const close = \(\) => \{([\s\S]*?)\n  \};/.exec(runFiles())?.[1] ?? '';
    expect(body).toMatch(/if \(mode === null\) return;/);
    // The guard must come before the session bump, or a queued close event still invalidates the next dialog.
    expect(body.indexOf('if (mode === null) return;')).toBeLessThan(body.indexOf('session.current++'));
  });
});
