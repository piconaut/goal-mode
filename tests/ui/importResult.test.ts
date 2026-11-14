// PR-05: the import dialog learns its outcome from an explicit worker message, not from toast wording. A toast
// carries unrelated results too, so matching its text was the only thing that made the old code survive #185.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('import result plumbing', () => {
  it('the dialog reads game.importResult, never toast text', () => {
    const src = read('src/ui/RunFiles.tsx');
    expect(src).toContain('game.importResult');
    expect(src).not.toMatch(/toast\.message|game\.toast|submittedToast/);
  });

  it('the worker reports IMPORT_RUN as IMPORT_RESULT, a declared message kind', () => {
    const worker = read('src/worker/game.worker.ts');
    const block = /case 'IMPORT_RUN':([\s\S]*?)break;/.exec(worker)?.[1] ?? '';
    expect(block).toContain("type: 'IMPORT_RESULT'");
    expect(block).not.toContain("type: 'RESULT'");
    expect(read('src/worker/protocol.ts')).toMatch(/\| \{ type: 'IMPORT_RESULT'; ok: boolean; message: string \}/);
  });
});
