// Behaviour diff between two revisions: does a change alter what WLM does, what the player sees, or neither?
// Runs tools/compareDump.ts in a worktree of each revision (the working tree for the head by default) and compares
// sim state (reporting excluded), game state, the run log, every RMF report's text and numbers, and Monitor III views.
// Usage: npm run compare -- [--base origin/dev] [--head <ref>] [--scenarios midwest,harbourline,revenue]
//          [--seed 42] [--days 1] [--every 3] [--drop k1,k2] [--tol 1e-9] [--keep]
// --drop: more state keys to leave out of the sim/game hashes (reporting-only fields a change adds or removes).
// --tol: relative tolerance for numbers in RMF records and Monitor III views (0 = exact). Exit code 1 on any difference.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt;
};
const root = resolve(import.meta.dirname, '..');
const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const tol = Number(arg('tol', '1e-9'));
const dumpArgs = ['scenarios', 'seed', 'days', 'every', 'drop'].flatMap((k) => (argv.includes(`--${k}`) ? [`--${k}`, arg(k, '')] : []));
const tmp = resolve(root, 'runs/tmp/compare');
mkdirSync(tmp, { recursive: true });

/** A checkout of `ref` with the head's dump script and node_modules; the working tree when ref is null. */
function tree(ref: string | null): { dir: string; label: string; temp: boolean } {
  if (ref === null) return { dir: root, label: 'working tree', temp: false };
  const sha = git('rev-parse', '--short=12', ref);
  const dir = resolve(tmp, sha);
  if (!existsSync(dir)) git('worktree', 'add', '--detach', '-q', dir, sha);
  if (!existsSync(resolve(dir, 'node_modules'))) symlinkSync(resolve(root, 'node_modules'), resolve(dir, 'node_modules'));
  copyFileSync(resolve(root, 'tools/compareDump.ts'), resolve(dir, 'tools/_compareDump.ts'));
  return { dir, label: `${ref} (${sha})`, temp: true };
}

function dump(t: { dir: string; temp: boolean }, out: string): Promise<void> {
  const script = t.temp ? 'tools/_compareDump.ts' : 'tools/compareDump.ts';
  return new Promise((ok, fail) => {
    const p = spawn('npx', ['tsx', script, out, ...dumpArgs], { cwd: t.dir, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`dump failed in ${t.dir} (exit ${code})`))));
  });
}

/** A readable index for report rows: system and class, or the RMF interval's end tick. */
function label(x: unknown): string | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const sys = o.lparId ?? o.system;
  if (typeof o.scKey === 'string') return `${typeof sys === 'string' ? `${sys} ` : ''}${o.scKey}`;
  return typeof o.tick === 'number' ? `tick ${o.tick}` : null;
}

/** First differences between two JSON values, numbers within the relative tolerance. */
function diff(a: unknown, b: unknown, path: string, out: { paths: string[]; count: number; maxRel: number }): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return;
    const rel = Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));
    out.maxRel = Math.max(out.maxRel, rel);
    if (rel <= tol) return;
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length) return a.forEach((x, i) => diff(x, b[i], `${path}[${label(x) ?? i}]`, out));
  } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort()) diff(ao[k], bo[k], `${path}.${k}`, out);
    return;
  } else if (a === b) return;
  out.count++;
  if (out.paths.length < 3) out.paths.push(`${path}: ${JSON.stringify(a)?.slice(0, 60)} → ${JSON.stringify(b)?.slice(0, 60)}`);
}

function firstTextDiff(a: { tick: number; text: string }[], b: { tick: number; text: string }[]): string | null {
  if (a.length !== b.length) return `${a.length} intervals → ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.text === b[i]!.text) continue;
    const la = a[i]!.text.split('\n'), lb = b[i]!.text.split('\n');
    const j = la.findIndex((l, k) => l !== lb[k]);
    const at = j < 0 ? la.length : j;
    return `interval ending tick ${a[i]!.tick}, line ${at + 1}:\n      - ${la[at] ?? '(end)'}\n      + ${lb[at] ?? '(end)'}`;
  }
  return null;
}

const headRef = argv.includes('--head') ? arg('head', 'HEAD') : null;
const base = tree(arg('base', 'origin/dev'));
const head = tree(headRef);
const outA = resolve(tmp, 'base.json'), outB = resolve(tmp, 'head.json');
console.log(`base: ${base.label}\nhead: ${head.label}`);
await Promise.all([dump(base, outA), dump(head, outB)]);
const A = JSON.parse(readFileSync(outA, 'utf8')) as Record<string, Record<string, unknown>>;
const B = JSON.parse(readFileSync(outB, 'utf8')) as Record<string, Record<string, unknown>>;

let same = true;
for (const id of Object.keys(A)) {
  const a = A[id]!, b = B[id]!;
  console.log(`\n${id}`);
  for (const [k, label] of [['simHash', 'sim state (reporting excluded)'], ['gameHash', 'game state (reporting excluded)'], ['logHash', 'run log']] as const) {
    const eq = a[k] === b[k];
    same &&= eq;
    console.log(`  ${label.padEnd(32)} ${eq ? 'same' : `DIFFERS (${a[k]} → ${b[k]})`}`);
  }
  const text = firstTextDiff(a.rmfText as { tick: number; text: string }[], b.rmfText as { tick: number; text: string }[]);
  same &&= text === null;
  console.log(`  ${'RMF report text'.padEnd(32)} ${text === null ? 'same' : `DIFFERS at ${text}`}`);
  for (const [k, label] of [['rmf', 'RMF records'], ['mon3', 'Monitor III views']] as const) {
    const d = { paths: [] as string[], count: 0, maxRel: 0 };
    diff(a[k], b[k], k, d);
    same &&= d.count === 0;
    const near = d.maxRel > 0 ? ` (max relative difference ${d.maxRel.toExponential(1)})` : '';
    console.log(`  ${label.padEnd(32)} ${d.count === 0 ? `same${near}` : `DIFFERS in ${d.count} values${near}`}`);
    for (const p of d.paths) console.log(`      ${p}`);
  }
}
for (const t of [base, head]) if (t.temp && !argv.includes('--keep')) git('worktree', 'remove', '--force', t.dir);
console.log(same ? '\nNo differences.' : '\nDifferences found.');
process.exit(same ? 0 : 1);
