// Run a balance sweep on GitHub Actions (.github/workflows/sweep.yml) instead of this machine, from any agent or a
// human: no PR, no branch switch, no working-tree change.
//
//   npm run sweep:remote -- --bots donothing,textbook,expert --seeds 1-20 [--difficulty hard] [--scenario harbourline]
//                           [--reader] [--days 40] [--tune k=v,...] [--shards 4] [--name label] [--ref <commit|branch>] [--no-wait]
//   npm run sweep:remote -- --fetch <commit sha>     # wait for / download a sweep started with --no-wait (7+ hex chars
//                                                    # resolve against the last 100 sweep runs)
//
// --tune overrides POLICY_ADJUST in every run (tools/tune.ts); refused for a ref without tools/tune.ts, whose
// tools/sweep.ts would ignore it.
// --ref sweeps another commit (a PR head, origin/dev) without checking it out; default HEAD. The swept tree gets this
// checkout's sweep workflow and planner overlaid, so any commit can be swept, even one cut before they existed.
// It makes a throwaway commit on top of the ref (its tree + the overlay, `Sweep-Args:` trailer) and pushes it to `sweep/<label>-<sha7>`;
// the workflow deletes that branch when done. Result: runs/remote/<sha7>/ (summary.md, sweep.csv, partial.jsonl),
// summary.md printed. Exit 0 when the run succeeded (the balance gate line is reference only), 1 otherwise.
// Needs `gh` authenticated for the repo (cloud sessions have it). Waiting takes ~10 min for 20 seeds: in Claude Code, start it
// with run_in_background.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planSweep } from './ci/sweepPlan';
import { takeFlag, taker } from './args';

const argv = process.argv.slice(2);
const take = taker(argv);
const fetchSha = take('fetch');
const shards = take('shards');
const label = take('name');
const noWait = takeFlag(argv, 'no-wait');
const ref = take('ref') || 'HEAD';
const sweepArgs = argv.join(' ');

const sh = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => execFileSync(cmd, args, { encoding: 'utf8', env: env ?? process.env }).trim();
const OVERLAY = ['.github/workflows/sweep.yml', 'tools/ci/sweepPlan.ts'];

// The ref's tree with OVERLAY replaced by this checkout's copies, built in a scratch index (the real one is untouched).
function sweptTree(commit: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-index-'));
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

interface Run { id: number; status: string; conclusion: string | null; html_url: string }

// A bare `--fetch` must not fall through to starting a new sweep.
if (fetchSha === '') throw new Error('--fetch needs the sweep commit sha (7-40 hex chars)');
if (fetchSha !== undefined && !/^[0-9a-f]{7,40}$/i.test(fetchSha)) throw new Error(`--fetch: "${fetchSha}" is not a commit sha`);

// Sweep commits live only on the sweep/* branch the workflow deletes, so git can't expand a short sha, and the runs
// API's head_sha= matches full shas only: match the prefix against recent sweep.yml runs instead.
function resolveSweepSha(prefix: string): string {
  const p = prefix.toLowerCase();
  if (p.length === 40) return p;
  // --jq keeps the output small: 100 full run objects overflow execFileSync's 1 MB buffer.
  const all = sh('gh', ['api', `repos/${repo}/actions/workflows/sweep.yml/runs?per_page=100`, '--jq', '.workflow_runs[].head_sha']);
  const shas = [...new Set(all.split('\n').filter((s) => s.startsWith(p)))];
  if (shas.length === 1) return shas[0]!;
  throw new Error(shas.length
    ? `--fetch ${prefix} is ambiguous: ${shas.join(', ')}`
    : `--fetch ${prefix}: no sweep run among the last 100 starts with it; pass the full sha`);
}

let sha = fetchSha !== undefined ? resolveSweepSha(fetchSha) : '';
if (fetchSha === undefined) {
  const plan = planSweep(sweepArgs, Number(shards) || undefined); // fail fast, same rules as the workflow
  const parent = sh('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (/(^|\s)--tune\s/.test(sweepArgs)) {
    try {
      sh('git', ['cat-file', '-e', `${parent}:tools/tune.ts`]);
    } catch {
      throw new Error(`--tune: ${ref} has no tools/tune.ts, so its sweep would ignore the overrides`);
    }
  }
  if (ref === 'HEAD' && sh('git', ['status', '--porcelain', '--untracked-files=no'])) log('warning: uncommitted changes are not swept (committed HEAD only)');
  const trailers = [...(sweepArgs ? [`Sweep-Args: ${sweepArgs}`] : []), ...(shards ? [`Sweep-Shards: ${shards}`] : [])].join('\n') || 'Sweep-Args:';
  sha = sh('git', ['commit-tree', sweptTree(parent), '-p', parent, '-m', `sweep: ${sweepArgs || 'default'}`, '-m', trailers]);
  const base = (label || (ref === 'HEAD' ? sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) : ref)).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40);
  const branch = `sweep/${base}-${sha.slice(0, 7)}`;
  execFileSync('git', ['push', '--quiet', 'origin', `${sha}:refs/heads/${branch}`], { stdio: 'inherit' });
  log(`pushed ${branch} (${sha.slice(0, 7)}, sweeping ${parent.slice(0, 7)}): ${plan.shards.length} shard(s) over seeds ${plan.seeds}, args "${plan.args}"`);
  if (noWait) {
    console.log(`sweep started; fetch the result with: npm run sweep:remote -- --fetch ${sha}`);
    process.exit(0);
  }
}

let run: Run | undefined;
for (let tries = 0; !run; tries++) {
  run = gh<{ workflow_runs: Run[] }>(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`).workflow_runs[0];
  if (!run) {
    if (tries > 20) throw new Error(`no workflow run for ${sha} after 5 min: wrong sha, or no .github/workflows/sweep.yml in that commit?`);
    await sleep(15_000);
  }
}
log(`run ${run.html_url}`);
let last = '';
while (run.status !== 'completed') {
  await sleep(30_000);
  run = gh<Run>(`repos/${repo}/actions/runs/${run.id}`);
  const jobs = gh<{ jobs: { status: string }[] }>(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`).jobs;
  const line = `${run.status}: ${jobs.filter((j) => j.status === 'completed').length}/${jobs.length} jobs done`;
  if (line !== last) log((last = line));
}

const art = gh<{ artifacts: { id: number; name: string }[] }>(`repos/${repo}/actions/runs/${run.id}/artifacts`).artifacts.find((a) => a.name === 'sweep-result');
if (!art) {
  log(`run ${run.conclusion}, no sweep-result artifact: ${run.html_url}`);
  process.exit(1);
}
const dir = `runs/remote/${sha.slice(0, 7)}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/result.zip`, execFileSync('gh', ['api', `repos/${repo}/actions/artifacts/${art.id}/zip`]));
execFileSync('unzip', ['-q', '-o', `${dir}/result.zip`, '-d', dir]);
rmSync(`${dir}/result.zip`);
console.log(sh('cat', [`${dir}/summary.md`]));
log(`\n→ ${dir}/ (run ${run.conclusion})`);
process.exit(run.conclusion === 'success' ? 0 : 1);
