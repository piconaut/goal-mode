// Remote test report (.github/workflows/test.yml): turn Vitest's JSON report into one markdown summary and fail when a
// test or a whole test file failed, no report was written, or nothing ran at all.
//
//   npx tsx tools/ci/testReport.ts <report.json> [root]
//
// [root] is the checkout path, stripped from stack traces for readability.
import { existsSync, readFileSync } from 'node:fs';

export interface Assertion {
  fullName?: string;
  title?: string;
  ancestorTitles?: string[];
  status?: string;
  failureMessages?: string[];
}

export interface TestFile {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: Assertion[];
}

export interface VitestJson {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numFailedTestSuites?: number;
  success?: boolean;
  testResults?: TestFile[];
}

export interface Summary {
  markdown: string[];
  ok: boolean;
}

const MAX_FAILURES = 20;
const MAX_MESSAGE_LINES = 12;
const MAX_MESSAGE_CHARS = 1500;

const assertionName = (a: Assertion) => a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? '?'].join(' › ');
const shorten = (s: string) => s.trim().split('\n').slice(0, MAX_MESSAGE_LINES).join('\n').slice(0, MAX_MESSAGE_CHARS);

/** One markdown report for a run, with a short failure list. A missing report, a failed test file or no tests fail. */
export function summarize(json: VitestJson | null, root = ''): Summary {
  if (!json) {
    return { markdown: ['❌ No test report was written (see the run log).'], ok: false };
  }
  const strip = (s: string) => (root ? s.split(`${root}/`).join('') : s);
  const total = json.numTotalTests ?? 0;
  const passed = json.numPassedTests ?? 0;
  const failed = json.numFailedTests ?? 0;
  const skipped = json.numPendingTests ?? 0;
  const failedFiles = json.numFailedTestSuites ?? 0;
  const failures: { test: string; message: string }[] = [];
  for (const file of json.testResults ?? []) {
    // A hook or collection error fails the file, not any assertion: vitest puts it in the file's message.
    const message = file.message?.trim();
    if (file.status === 'failed' && message) failures.push({ test: `${strip(file.name ?? '?')} (file failed)`, message: shorten(strip(message)) });
    for (const a of file.assertionResults ?? []) {
      if (a.status !== 'failed') continue;
      failures.push({ test: `${strip(file.name ?? '?')} › ${assertionName(a)}`, message: shorten(strip(a.failureMessages?.[0] ?? '')) });
    }
  }
  const ok = failed === 0 && failedFiles === 0 && json.success !== false && total > 0;

  const lines = [`**${passed} passed, ${failed} failed, ${skipped} skipped — ${total} tests**${failedFiles ? ` · ${failedFiles} file(s) failed` : ''}`];
  if (total === 0) lines.push('', '❌ No tests ran: check the `--suite` names and `--filter` text.');
  if (failures.length) {
    lines.push('', '#### Failed tests', '');
    for (const f of failures.slice(0, MAX_FAILURES)) {
      lines.push('', `**${f.test}**`, '', '````', f.message || '(no message)', '````');
    }
    if (failures.length > MAX_FAILURES) lines.push('', `… and ${failures.length - MAX_FAILURES} more failure(s); the run log has the rest.`);
  } else if (ok) {
    lines.push('', 'All tests passed.');
  }
  return { markdown: lines, ok };
}

if (process.argv[1]?.endsWith('testReport.ts')) {
  const [file = 'runs/test/report.json', root] = process.argv.slice(2);
  let json: VitestJson | null = null;
  if (existsSync(file)) {
    try {
      json = JSON.parse(readFileSync(file, 'utf8')) as VitestJson;
    } catch {
      json = null; // a truncated report is a failed run, not a crashed report job
    }
  }
  const { markdown, ok } = summarize(json, root);
  console.log(markdown.join('\n'));
  process.exit(ok ? 0 : 1);
}
