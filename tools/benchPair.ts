import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { TICKS_PER_DAY } from '../src/sim/core/units';
import { takeFlag, taker } from './args';

const usage = `npm run bench:pair -- [--base origin/dev] [--head <ref>] [--mode sim|live]
  [--scenario midwest] [--seed 42] [--ticks ${TICKS_PER_DAY}] [--rounds 3]
  [--warmup 2160] [--block 120] [--chunk 12] [--json]`;
const root = resolve(import.meta.dirname, '..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const stateHash = (state: unknown) => createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 16);
type Options = ReturnType<typeof options>;

function options(args: string[]) {
  const take = taker(args);
  const value = (name: string, fallback: string) => {
    const result = take(name) ?? fallback;
    if (result === '') throw new Error(`--${name} needs a value.`);
    return result;
  };
  const integer = (name: string, fallback: number, min = 1) => {
    const result = Number(value(name, String(fallback)));
    if (!Number.isSafeInteger(result) || result < min) throw new Error(`--${name} must be an integer of at least ${min}.`);
    return result;
  };
  const mode = value('mode', 'sim');
  if (mode !== 'sim' && mode !== 'live') throw new Error('--mode must be sim or live.');
  const result = {
    base: value('base', 'origin/dev'),
    head: take('head'),
    mode,
    scenario: value('scenario', 'midwest'),
    seed: integer('seed', 42, Number.MIN_SAFE_INTEGER),
    ticks: integer('ticks', TICKS_PER_DAY),
    rounds: integer('rounds', 3),
    warmup: integer('warmup', 2160, 0),
    block: integer('block', 120),
    chunk: integer('chunk', 12),
    json: takeFlag(args, 'json'),
  };
  if (result.head === '') throw new Error('--head needs a Git ref.');
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(' ')}`);
  return result;
}

interface Workload {
  advance(ticks: number): void;
  finish(): { ticks: number; hash: string };
}

interface Timing {
  wallMs: number;
  cpuMs: number;
}

/** Load each revision's own simulation modules so the harness also works on commits predating this tool. */
async function loadWorkload(dir: string, opts: Options): Promise<() => Workload> {
  const load = (path: string) => import(pathToFileURL(join(dir, path)).href);
  if (opts.mode === 'sim') {
    const { SCENARIOS }: typeof import('../src/content/scenarios') = await load('src/content/scenarios/index.ts');
    const { initState }: typeof import('../src/sim/core/init') = await load('src/sim/core/init.ts');
    const { step }: typeof import('../src/sim/core/step') = await load('src/sim/core/step.ts');
    const scenario = Object.hasOwn(SCENARIOS, opts.scenario) ? SCENARIOS[opts.scenario] : undefined;
    if (!scenario) throw new Error(`Unknown scenario: ${opts.scenario}`);
    return () => {
      let state = initState(opts.seed, scenario);
      const startTick = state.tick;
      return {
        advance(ticks) {
          for (let i = 0; i < ticks; i++) state = step(state, [], scenario);
        },
        finish: () => ({ ticks: state.tick - startTick, hash: stateHash(state) }),
      };
    };
  }

  const { TICKS_PER_DAY: dayTicks }: typeof import('../src/sim/core/units') = await load('src/sim/core/units.ts');
  if (Math.max(opts.ticks, opts.warmup) > dayTicks) throw new Error(`Live mode supports up to one day (${dayTicks} ticks) per run.`);
  const { PACKS }: typeof import('../src/content/packs') = await load('src/content/packs.ts');
  const { advance, newRun, startDay }: typeof import('../src/game/run') = await load('src/game/run.ts');
  const pack = Object.hasOwn(PACKS, opts.scenario) ? PACKS[opts.scenario] : undefined;
  if (!pack) throw new Error(`Unknown scenario: ${opts.scenario}`);
  const { scenario, game } = pack;
  return () => {
    let run = startDay(newRun(scenario, game, opts.seed), game);
    const startTick = run.sim.tick;
    return {
      advance(ticks) {
        for (let i = 0; i < ticks; i += opts.chunk) {
          run = advance(run, scenario, game, Math.min(opts.chunk, ticks - i));
        }
      },
      finish: () => ({ ticks: run.sim.tick - startTick, hash: stateHash(run) }),
    };
  };
}

async function runPair(factories: [() => Workload, () => Workload], opts: Options, ticks: number, round: number, signal: AbortSignal) {
  const workloads = [factories[0](), factories[1]()] as const;
  const times: [Timing, Timing] = [{ wallMs: 0, cpuMs: 0 }, { wallMs: 0, cpuMs: 0 }];
  for (let done = 0, block = 0; done < ticks; done += opts.block, block++) {
    const count = Math.min(opts.block, ticks - done);
    const order = (block + round) % 2 === 0 ? [0, 1] as const : [1, 0] as const;
    for (const i of order) {
      const cpuStart = process.cpuUsage();
      const wallStart = performance.now();
      workloads[i].advance(count);
      times[i].wallMs += performance.now() - wallStart;
      const cpu = process.cpuUsage(cpuStart);
      times[i].cpuMs += (cpu.user + cpu.system) / 1000;
    }
    // Let interrupts reach the cleanup path between timed blocks.
    await setImmediate(undefined, { signal });
  }
  const result = (i: 0 | 1) => ({ ...times[i], ...workloads[i].finish() });
  const base = result(0);
  const head = result(1);
  if (base.ticks !== ticks || head.ticks !== ticks) {
    throw new Error(`Expected ${ticks} ticks. Base ran ${base.ticks}, head ran ${head.ticks}.`);
  }
  return { base, head };
}

type Pair = Awaited<ReturnType<typeof runPair>>;
const changePct = (base: number, head: number) => base === 0 ? null : 100 * (head / base - 1);
const formatPct = (pct: number | null) => pct === null ? 'n/a' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;

function medianChange(pairs: Pair[], field: keyof Timing): number | null {
  const changes = pairs.map(({ base, head }) => changePct(base[field], head[field]))
    .filter((pct) => pct !== null).sort((a, b) => a - b);
  if (!changes.length) return null;
  const mid = Math.floor(changes.length / 2);
  return changes.length % 2 ? changes[mid]! : (changes[mid - 1]! + changes[mid]!) / 2;
}

async function benchmark(opts: Options) {
  const baseSha = git('rev-parse', '--verify', '--end-of-options', `${opts.base}^{commit}`);
  const headSha = git('rev-parse', '--verify', '--end-of-options', `${opts.head ?? 'HEAD'}^{commit}`);
  const baseLabel = `${opts.base} (${baseSha.slice(0, 12)})`;
  const headLabel = opts.head === undefined ? `working tree (${headSha.slice(0, 12)})` : `${opts.head} (${headSha.slice(0, 12)})`;
  const temp = mkdtempSync(join(tmpdir(), 'goal-mode-bench-'));
  const worktrees: string[] = [];
  const checkout = (name: string, sha: string) => {
    const dir = join(temp, name);
    git('worktree', 'add', '--detach', '--quiet', dir, sha);
    worktrees.push(dir);
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    return dir;
  };
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const base = await loadWorkload(checkout('base', baseSha), opts);
    const head = await loadWorkload(opts.head === undefined ? root : checkout('head', headSha), opts);
    if (!opts.json) {
      console.log(`Base: ${baseLabel}\nHead: ${headLabel}`);
      const chunk = opts.mode === 'live' ? `, ${opts.chunk}-tick advances` : '';
      console.log(`${opts.mode} / ${opts.scenario}, seed ${opts.seed}, ${opts.ticks} ticks × ${opts.rounds} pairs`);
      console.log(`${opts.warmup} warm-up ticks, ${opts.block}-tick blocks${chunk}`);
    }
    if (opts.warmup > 0) await runPair([base, head], opts, opts.warmup, 0, abort.signal);
    const pairs: Pair[] = [];
    for (let round = 0; round < opts.rounds; round++) {
      const pair = await runPair([base, head], opts, opts.ticks, round, abort.signal);
      pairs.push(pair);
      if (!opts.json) {
        const { base, head } = pair;
        console.log(`Pair ${round + 1}: wall ${base.wallMs.toFixed(2)} → ${head.wallMs.toFixed(2)} ms (${formatPct(changePct(base.wallMs, head.wallMs))}), `
          + `CPU ${base.cpuMs.toFixed(2)} → ${head.cpuMs.toFixed(2)} ms (${formatPct(changePct(base.cpuMs, head.cpuMs))}), hashes ${base.hash} / ${head.hash}`);
      }
    }
    const summary = {
      wallChangePct: medianChange(pairs, 'wallMs'),
      cpuChangePct: medianChange(pairs, 'cpuMs'),
      hashesMatch: pairs.every(({ base, head }) => base.hash === head.hash),
    };
    if (opts.json) console.log(JSON.stringify({ options: opts, base: baseLabel, head: headLabel, pairs, summary }, null, 2));
    else console.log(`Median paired change: wall ${formatPct(summary.wallChangePct)}, CPU ${formatPct(summary.cpuChangePct)}. Hashes ${summary.hashesMatch ? 'match' : 'differ'}.`);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    for (const dir of worktrees.reverse()) git('worktree', 'remove', '--force', dir);
    rmSync(temp, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (takeFlag(args, 'help')) console.log(usage);
else {
  try {
    await benchmark(options(args));
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') console.error('Benchmark interrupted.');
    else console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
