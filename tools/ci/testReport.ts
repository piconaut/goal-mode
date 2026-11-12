// Remote test report (.github/workflows/test.yml): merge the shards' Vitest JSON reports into one markdown summary and
// fail when any test failed, a shard lost its report, or nothing ran at all.
//
//   npx tsx tools/ci/testReport.ts <shards-dir> <expected-shards> [root]
//
// <shards-dir> holds one directory per shard (the downloaded `test-shard-*` artifacts), each with vitest's
// `report.json` (--reporter=json). [root] is the checkout path, stripped from stack traces for readability.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Assertion {
  fullName?: string;
  title?: string;
  ancestorTitles?: string[];
  status?: string;
  failureMessages?: string[];
}

export interface TestFile {
  name?: string;
  assertionResults?: Assertion[];
}

export interface VitestJson {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  testResults?: TestFile[];
}

export interface Shard {
  name: string;
  json: VitestJson | null;
}

export interface Summary {
  markdown: string[];
  ok: boolean;
}

const MAX_FAILURES = 20;
const MAX_MESSAGE_LINES = 12;
const MAX_MESSAGE_CHARS = 1500;

const assertionName = (a: Assertion) => a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? '?'].join(' › ');

/** One markdown report for every shard, with a short failure list. `expected` shards that sent no report fail. */
export function summarize(shards: Shard[], expected: number, root = ''): Summary {
  const strip = (s: string) => (root ? s.split(`${root}/`).join('') : s);
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: { test: string; message: string }[] = [];
  const table = ['| shard | tests | passed | failed | skipped | status |', '|---|---:|---:|---:|---:|---|'];
  for (const shard of shards) {
    const j = shard.json;
    const t = j?.numTotalTests ?? 0;
    const p = j?.numPassedTests ?? 0;
    const f = j?.numFailedTests ?? 0;
    const s = j?.numPendingTests ?? 0;
    total += t;
    passed += p;
    failed += f;
    skipped += s;
    const status = !j ? '❌ no report' : f > 0 ? `${f} failed` : 'passed';
    table.push(`| ${shard.name} | ${t} | ${p} | ${f} | ${s} | ${status} |`);
    for (const file of j?.testResults ?? []) {
      for (const a of file.assertionResults ?? []) {
        if (a.status !== 'failed') continue;
        const message = (a.failureMessages?.[0] ?? '').trim().split('\n').slice(0, MAX_MESSAGE_LINES).join('\n').slice(0, MAX_MESSAGE_CHARS);
        failures.push({ test: `${strip(file.name ?? '?')} › ${assertionName(a)}`, message: strip(message) });
      }
    }
  }
  const missing = Math.max(0, expected - shards.filter((s) => s.json).length);
  const ok = failed === 0 && missing === 0 && total > 0;

  const lines = [
    `**${passed} passed, ${failed} failed, ${skipped} skipped — ${total} tests in ${shards.length} shard(s)**`,
    '',
    ...table,
  ];
  if (missing) lines.push('', `❌ ${missing} of ${expected} shard(s) sent no report: see the shard jobs, and any shard that failed before npm ci.`);
  if (total === 0 && !missing) lines.push('', '❌ No tests ran: check the `--suite` names and `--filter` text.');
  if (failures.length) {
    lines.push('', '#### Failed tests', '');
    for (const f of failures.slice(0, MAX_FAILURES)) {
      lines.push('', `**${f.test}**`, '', '````', f.message || '(no message)', '````');
    }
    if (failures.length > MAX_FAILURES) lines.push('', `… and ${failures.length - MAX_FAILURES} more failure(s); open the run's shard logs.`);
  } else if (ok) {
    lines.push('', 'All tests passed.');
  }
  return { markdown: lines, ok };
}

if (process.argv[1]?.endsWith('testReport.ts')) {
  const [dir = 'runs/shards', expectedRaw = '0', root] = process.argv.slice(2);
  const expected = Number(expectedRaw) || 0;
  const names = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  const shards: Shard[] = names.map((name) => {
    const file = join(dir, name, 'report.json');
    if (!existsSync(file)) return { name, json: null };
    try {
      return { name, json: JSON.parse(readFileSync(file, 'utf8')) as VitestJson };
    } catch {
      return { name, json: null }; // a truncated report is a failed shard, not a crashed report job
    }
  });
  const { markdown, ok } = summarize(shards, expected, root);
  console.log(markdown.join('\n'));
  process.exit(ok ? 0 : 1);
}
