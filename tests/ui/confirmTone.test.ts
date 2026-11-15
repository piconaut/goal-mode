// PR-10: the confirmation's action button uses the shared button styling — `primary` for an ordinary confirmation,
// `danger` (the theme's critical colour) when the action discards work — and the import prompt no longer reads
// "Reading file…" while the player decides.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const confirmation = () => readFileSync('src/ui/Confirmation.tsx', 'utf8');
const runFiles = () => readFileSync('src/ui/RunFiles.tsx', 'utf8');
const overlays = () => readFileSync('src/ui/Overlays.tsx', 'utf8');
const css = () => readFileSync('src/ui/styles.css', 'utf8');

describe('confirmation polish', () => {
  it('styles the action button as primary, or danger for a discarding action', () => {
    const src = confirmation();
    expect(src).toMatch(/type ConfirmTone = 'primary' \| 'danger'/);
    // The tone travels with the request and defaults to primary, so an ordinary confirmation cannot look destructive.
    expect(src).toMatch(/tone: ConfirmTone = 'primary'/);
    expect(src).toMatch(/setPending\(\{ message, actionLabel, tone \}\)/);
    expect(src).toMatch(/className=\{pending\?\.tone === 'danger' \? 'danger' : 'primary'\}/);
    // Cancel stays a plain button: the pair must not read as two competing primary actions.
    expect(src).toMatch(/<button type="button" autoFocus onClick=\{\(\) => settle\(false\)\}>Cancel<\/button>/);
  });

  it('marks every confirmation that discards the current run as danger', () => {
    expect(runFiles()).toMatch(/'Load save', 'danger'\)/);
    const o = overlays();
    expect(o).toMatch(/'Start new run', 'danger'\)\)\) return;/);
    expect(o).toMatch(/'Restart run', 'danger'\)\)\) return;/);
  });

  it('has a danger button style in the theme, kept visible in forced colours', () => {
    const c = css();
    expect(c).toMatch(/button\.danger \{ background: var\(--crit\); color: var\(--bg\); border-color: var\(--crit\); font-weight: 600; \}/);
    expect(c).toMatch(/button\.primary, button\.danger \{ border: 2px solid ButtonText; \}/);
  });

  it('stops saying "Reading file…" once the file is read, before the prompt opens', () => {
    // The import handler reads the file, then asks; the label must fall back to "Choose file" while the prompt is up,
    // and the reset must come before the confirmation await or `reading` stays true for its whole lifetime.
    const src = runFiles();
    const handler = /onChange=\{async \(e\) => \{([\s\S]*?)\n        \}\}/.exec(src)?.[1] ?? '';
    expect(handler).not.toBe('');
    const clear = handler.indexOf('setReading(false);');
    const prompt = handler.indexOf('await load(fileText, file.name);');
    expect(clear).toBeGreaterThanOrEqual(0);
    expect(prompt).toBeGreaterThan(clear);
    // `load` asks first and only then starts the import, so a cancel leaves the button idle and a confirm shows
    // "Loading…" from the same click.
    const load = /const load = async \([\s\S]*?\n  \};/.exec(src)?.[0] ?? '';
    expect(load.indexOf('await ask(')).toBeLessThan(load.indexOf('setLoading(true);'));
  });
});
