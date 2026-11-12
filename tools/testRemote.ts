// Run the test suites on GitHub Actions (.github/workflows/test.yml) instead of this machine, from any agent or a
// human: no PR, no branch switch, no working-tree change.
//
//   npm run test:remote -- [--suite golden,game,sim,tools,ui | --filter <text>] [--shards 4] [--name label]
//                           [--ref <commit|branch>] [--no-wait]
//   npm run test:remote -- --fetch <commit sha>     # wait for / download a run started with --no-wait
//
// --suite picks test directories under tests/ and --filter a filename substring (validated by tools/ci/testPlan.ts);
// they are alternatives, since vitest OR-s its file filters. No selection runs every test file. --ref tests another
// commit (a PR head, origin/dev) without checking it out; default HEAD. The tested tree gets this checkout's test
// workflow, planner and reporter overlaid, so any commit can be tested, even one cut before they existed. It makes a
// throwaway commit on top of the ref (its tree plus the overlay, `Test-Args:` / `Test-Shards:` trailers) and pushes it
// to `test/<label>-<sha7>`; the workflow deletes that branch when done. Result: runs/remote-tests/<sha7>/
// (summary.md), summary printed. Exit 0 when every test passed, 1 otherwise. Needs `gh` authenticated for the repo
// (cloud sessions have it). A full run takes ~2 min with the default 4 shards, plus npm ci.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planTest } from './ci/testPlan';

const argv = process.argv.slice(2);
const take = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : '';
};
const fetchSha = take('fetch');
const shards = take('shards');
const label = take('name');
const noWait = take('no-wait') !== undefined;
const ref = take('ref') || 'HEAD';
const testArgs = argv.join(' ');
if (fetchSha === '') throw new Error('--fetch needs the commit sha printed by a --no-wait run');
const shardsWanted = shards === undefined ? undefined : Number(shards);
if (shardsWanted !== undefined && (!Number.isInteger(shardsWanted) || shardsWanted < 1)) throw new Error(`--shards must be a positive whole number: ${shards}`);

const sh = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => execFileSync(cmd, args, { encoding: 'utf8', env: env ?? process.env }).trim();
const OVERLAY = ['.github/workflows/test.yml', 'tools/ci/testPlan.ts', 'tools/ci/testReport.ts'];

// The ref's tree with OVERLAY replaced by this checkout's copies, built in a scratch index (the real one is untouched).
function testedTree(commit: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'test-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  try {
    sh('git', ['read-tree', commit], env);
    for (const path of OVERLAY) sh('git', ['update-index', '--add', '--cacheinfo', `100644,${sh('git', ['hash-object', '-w', path])},${path}`], env);
    return sh('git', ['write-tree'], env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const gh = <T>(path: string): T => JSON.parse(sh('gh', ['api', path])) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => process.stderr.write(s + '\n');

const remote = sh('git', ['remote', 'get-url', 'origin']).replace(/\.git$/, '').split('/');
const repo = `${remote.at(-2)}/${remote.at(-1)}`;

let sha = fetchSha ?? '';
if (!fetchSha) {
  const plan = planTest(testArgs, shardsWanted); // fail fast, same rules as the workflow
  const parent = sh('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (ref === 'HEAD' && sh('git', ['status', '--porcelain', '--untracked-files=no'])) log('warning: uncommitted changes are not tested (committed HEAD only)');
  const trailers = [...(testArgs ? [`Test-Args: ${testArgs}`] : []), ...(shards ? [`Test-Shards: ${shards}`] : [])].join('\n') || 'Test-Args:';
  sha = sh('git', ['commit-tree', testedTree(parent), '-p', parent, '-m', `test: ${testArgs || 'all'}`, '-m', trailers]);
  const base = (label || (ref === 'HEAD' ? sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) : ref)).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40);
  const branch = `test/${base}-${sha.slice(0, 7)}`;
  execFileSync('git', ['push', '--quiet', 'origin', `${sha}:refs/heads/${branch}`], { stdio: 'inherit' });
  log(`pushed ${branch} (${sha.slice(0, 7)}, testing ${parent.slice(0, 7)}): ${plan.shards} shard(s), args "${plan.raw || 'all tests'}"`);
  if (noWait) {
    console.log(`test run started; fetch the result with: npm run test:remote -- --fetch ${sha}`);
    process.exit(0);
  }
}

interface Run { id: number; status: string; conclusion: string | null; html_url: string }
let run: Run | undefined;
for (let tries = 0; !run; tries++) {
  run = gh<{ workflow_runs: Run[] }>(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`).workflow_runs[0];
  if (!run) {
    if (tries > 20) throw new Error(`no workflow run for ${sha} after 5 min: is .github/workflows/test.yml in that commit?`);
    await sleep(15_000);
  }
}
log(`run ${run.html_url}`);
let last = '';
while (run.status !== 'completed') {
  await sleep(15_000);
  run = gh<Run>(`repos/${repo}/actions/runs/${run.id}`);
  const jobs = gh<{ jobs: { status: string }[] }>(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`).jobs;
  const line = `${run.status}: ${jobs.filter((j) => j.status === 'completed').length}/${jobs.length} jobs done`;
  if (line !== last) log((last = line));
}

const art = gh<{ artifacts: { id: number; name: string }[] }>(`repos/${repo}/actions/runs/${run.id}/artifacts`).artifacts.find((a) => a.name === 'test-result');
if (!art) {
  log(`run ${run.conclusion}, no test-result artifact: ${run.html_url}`);
  process.exit(1);
}
const dir = `runs/remote-tests/${sha.slice(0, 7)}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/result.zip`, execFileSync('gh', ['api', `repos/${repo}/actions/artifacts/${art.id}/zip`]));
execFileSync('unzip', ['-q', '-o', `${dir}/result.zip`, '-d', dir]);
rmSync(`${dir}/result.zip`);
console.log(sh('cat', [`${dir}/summary.md`]));
log(`\n→ ${dir}/ (run ${run.conclusion})`);
process.exit(run.conclusion === 'success' ? 0 : 1);
