// CI gate: page citations a PR adds must give the labelled PDF page index (CLAUDE.md "Realism policy", #435):
// `SG24-6472-03 PDF p.201 (printed 183)`, never a bare `p.N`, because printed and PDF numbers differ by a per-book
// offset. Only added lines are checked; older citations are relabelled when someone touches them.
//
//   npx tsx tools/ci/citations.ts <base-ref>
import { execFileSync } from 'node:child_process';
import { isMain } from '../args';

export interface CitationFinding {
  file: string;
  line: number;
  text: string;
  problem: string;
}

// The gate and its tests quote bare citations as examples.
const EXEMPT_FILES = new Set(['tools/ci/citations.ts', 'tests/tools/citations.test.ts']);
const CHECKED_EXT = /\.(ts|tsx|md)$/;

const PAGE = String.raw`pp?\.\s?\d+(?:\s?[–-]\s?\d+)?`;
// A run of page tokens joined by commas or "and": "p.147, p.255", "pp.62–63".
const RUN = new RegExp(String.raw`\b${PAGE}(?:\s*(?:,|and|&)\s*(?:${PAGE}|\d+(?:\s?[–-]\s?\d+)?))*`, 'g');
const LABEL_BEFORE = /(?:\bPDF|\bprinted)\s*$/;
// "page 12" in prose; `--page 12` (pdf_find.py) and `#page=12` (links) are not citations.
const PAGE_WORD = /(?<![-#\w])\bpage\s\d+/g;
const LINK = /\[([^\]]*)\]\([^)\s]*#page=(\d+)[^)]*\)/g;

// Inline code spans in Markdown quote text rather than cite it.
function stripCode(text: string, file: string): string {
  return file.endsWith('.md') ? text.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)) : text;
}

export function checkLine(text: string, file = 'x.ts'): string[] {
  const src = stripCode(text, file);
  const problems: string[] = [];
  for (const m of src.matchAll(RUN)) {
    if (!LABEL_BEFORE.test(src.slice(0, m.index))) problems.push(`bare "${m[0]}": write "PDF ${m[0]} (printed …)"`);
  }
  for (const m of src.matchAll(PAGE_WORD)) problems.push(`bare "${m[0]}": write "PDF p.N (printed …)"`);
  for (const m of src.matchAll(LINK)) {
    // A range label may open any page in its range.
    const label = /\bPDF\s+pp?\.\s?(\d+)(?:\s?[–-]\s?(\d+))?/.exec(m[1] ?? '');
    const page = Number(m[2]);
    if (label && (page < Number(label[1]) || page > Number(label[2] ?? label[1]))) {
      problems.push(`link label says PDF p.${label[1]}${label[2] ? `–${label[2]}` : ''} but opens #page=${m[2]}`);
    }
  }
  return problems;
}

// Added lines per file from a zero-context unified diff.
export function addedLines(diff: string): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  let file = '';
  let next = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.startsWith('+++ b/') ? raw.slice(6) : '';
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+') && file) out.push({ file, line: next++, text: raw.slice(1) });
  }
  return out;
}

export function checkDiff(diff: string): CitationFinding[] {
  const findings: CitationFinding[] = [];
  for (const { file, line, text } of addedLines(diff)) {
    if (!CHECKED_EXT.test(file) || EXEMPT_FILES.has(file)) continue;
    for (const problem of checkLine(text, file)) findings.push({ file, line, text: text.trim(), problem });
  }
  return findings;
}

if (isMain(import.meta.url)) {
  const baseRef = process.argv[2];
  if (!baseRef) throw new Error('usage: citations.ts <base-ref>');
  const diff = execFileSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', `${baseRef}...HEAD`, '--', '*.ts', '*.tsx', '*.md'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const findings = checkDiff(diff);
  if (findings.length === 0) {
    console.log('No bare page citations in added lines.');
  } else {
    for (const f of findings) console.error(`${f.file}:${f.line}: ${f.problem}\n    ${f.text}`);
    console.error(
      `\n${findings.length} page citation(s) without a PDF label. Cite the PDF page index, labelled, with the printed page ` +
        'in parentheses and the edition: `SG24-6472-03 PDF p.201 (printed 183)`; a `#page=` link opens the same index ' +
        '(CLAUDE.md "Realism policy").',
    );
    process.exit(1);
  }
}
