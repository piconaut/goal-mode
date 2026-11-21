import { describe, expect, it } from 'vitest';
import { addedLines, checkDiff, checkLine } from '../../tools/ci/citations';

describe('citation gate: checkLine', () => {
  it('flags a bare page citation', () => {
    expect(checkLine('// capped share (RMF Report Analysis p.401).')).toHaveLength(1);
    expect(checkLine('see SG24-6472-03 p. 183')).toHaveLength(1);
    expect(checkLine('SG24-7621 printed p.81 §3.5')).toHaveLength(1);
  });

  it('passes a labelled citation with its printed page', () => {
    expect(checkLine('// capped share (RMF Report Analysis PDF p.401 (printed 361)).')).toEqual([]);
    expect(checkLine('SG24-6472-03 PDF p.201 (printed p.183)')).toEqual([]);
  });

  it('treats a range or list after one PDF label as labelled', () => {
    expect(checkLine('WLM Services PDF p.145, p.148–149 (printed 125, 128–129)')).toEqual([]);
    expect(checkLine('PDF pp.62–63')).toEqual([]);
    expect(checkLine('WLM Planning pp.62–63')).toHaveLength(1);
    expect(checkLine('WLM Planning p.120, p.122-123')).toHaveLength(1);
  });

  it('flags "page N" prose but not pdf_find.py flags or link anchors', () => {
    expect(checkLine('described on page 83 of the book')).toHaveLength(1);
    expect(checkLine('Page 83 of the book')).toHaveLength(1);
    expect(checkLine('see pages 12–13')).toHaveLength(1);
    expect(checkLine('the patent, PDF pages 18–20')).toEqual([]);
    expect(checkLine('pdf_find.py BOOK --page 3 shows it')).toEqual([]);
    expect(checkLine('[RMF PDF p.540](https://x/erbb500.pdf#page=540)')).toEqual([]);
  });

  it('flags a link whose label is bare or names another page than it opens', () => {
    expect(checkLine('[RMF p.540](https://x/erbb500.pdf#page=540)')).toHaveLength(1);
    expect(checkLine('[RMF PDF p.534 (printed 494)](https://x/erbb500.pdf#page=540)')).toEqual([
      'link label says PDF p.534 but opens #page=540',
    ]);
    expect(checkLine('[WLM Planning PDF pp.121–122](https://x/ieaw100.pdf#page=122)')).toEqual([]);
  });

  it('ignores things that are not page citations', () => {
    expect(checkLine('const step = 0.5; app.1x')).toEqual([]);
    expect(checkLine('a p95 response time and pp2 output')).toEqual([]);
    expect(checkLine('home page')).toEqual([]);
  });

  it('skips Markdown code spans but not TypeScript strings', () => {
    expect(checkLine('never write a bare `p.401`', 'CLAUDE.md')).toEqual([]);
    expect(checkLine("source: 'RMF Report Analysis p.422'", 'src/content/x.ts')).toHaveLength(1);
  });
});

describe('citation gate: diff', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,0 +11,2 @@',
    '+// WLM% (RMF Report Analysis p.401)',
    '+// WLM% (RMF Report Analysis PDF p.401 (printed 361))',
    '@@ -20 +22 @@',
    '-// old bare p.12',
    '+// unchanged meaning, no citation',
    'diff --git a/data.json b/data.json',
    '--- a/data.json',
    '+++ b/data.json',
    '@@ -1 +1 @@',
    '+{"note": "p.5"}',
  ].join('\n');

  it('numbers added lines from the hunk header and ignores removed ones', () => {
    expect(addedLines(diff).map((l) => `${l.file}:${l.line}`)).toEqual(['src/a.ts:11', 'src/a.ts:12', 'src/a.ts:22', 'data.json:1']);
  });

  it('reports only bare citations on added lines of checked files', () => {
    const findings = checkDiff(diff);
    expect(findings.map((f) => `${f.file}:${f.line}`)).toEqual(['src/a.ts:11']);
  });

  it('skips a deleted file', () => {
    expect(checkDiff('--- a/src/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-// p.3')).toEqual([]);
  });
});
