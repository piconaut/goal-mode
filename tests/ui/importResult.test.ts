// PR-05: the import dialog learns its outcome from an explicit worker message, not from toast wording. A toast
// carries unrelated results too, so matching its text was the only thing that made the old code survive #185.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importOutcome } from '../../src/ui/importDialog';

const read = (path: string) => readFileSync(path, 'utf8');
const loaded = { ok: true, message: 'Loaded run: midwest, seed 7, day 2' };
const failed = { ok: false, message: 'Import failed: unknown scenario' };

describe('importOutcome', () => {
  it('closes on success and shows the failure message, only while an import is in flight', () => {
    expect(importOutcome(true, loaded, null)).toEqual({ close: true });
    expect(importOutcome(true, failed, null)).toEqual({ notice: failed.message });
    expect(importOutcome(false, loaded, null)).toBeNull();
    expect(importOutcome(true, null, null)).toBeNull();
  });

  it('ignores the result that was already current when the import was submitted', () => {
    expect(importOutcome(true, loaded, loaded)).toBeNull();
    // A later result is a new object, so it is handled even for the same text.
    expect(importOutcome(true, { ...loaded }, loaded)).toEqual({ close: true });
  });
});

describe('import result plumbing', () => {
  it('the dialog reads game.importResult, never toast text', () => {
    const src = read('src/ui/RunFiles.tsx');
    expect(src).toContain('game.importResult');
    expect(src).not.toMatch(/toast\.message|game\.toast|submittedToast/);
    expect(src).not.toMatch(/startsWith\('(Loaded run|Import failed)/);
  });

  it('the worker reports IMPORT_RUN as IMPORT_RESULT, a declared message kind', () => {
    const worker = read('src/worker/game.worker.ts');
    const block = /case 'IMPORT_RUN':([\s\S]*?)break;/.exec(worker)?.[1] ?? '';
    expect(block).toContain("type: 'IMPORT_RESULT'");
    expect(block).not.toContain("type: 'RESULT'");
    expect(read('src/worker/protocol.ts')).toMatch(/\| \{ type: 'IMPORT_RESULT'; ok: boolean; message: string \}/);
  });

  it('the UI keeps the import result alongside its existing toast and Results history', () => {
    const src = read('src/ui/useGame.ts');
    expect(src).toMatch(/m\.type === 'IMPORT_RESULT'[\s\S]{0,200}setImportResult/);
    expect(src).toMatch(/m\.type === 'IMPORT_RESULT'[\s\S]{0,200}reportResult\(/);
  });
});
