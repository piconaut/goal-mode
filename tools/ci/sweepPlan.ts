// Remote sweep plan (.github/workflows/sweep.yml): validate the sweep arguments taken from a `Sweep-Args:` commit
// trailer or a workflow_dispatch input, and split the seed range into shards that run as parallel jobs.
//
//   npx tsx tools/ci/sweepPlan.ts "<sweep args>" [shards]   # prints args=, seeds=, matrix= lines for $GITHUB_OUTPUT

// Flags `npm run sweep` takes that are safe to set remotely; --out, --jobs and --resume are the workflow's own.
const VALUE_FLAGS = ['bots', 'seeds', 'days', 'difficulty', 'scenario', 'tune'];
const BOOL_FLAGS = ['reader'];
const VALUE = /^[A-Za-z0-9,._-]+$/;
/** `--tune` (tools/tune.ts): key=number pairs, comma-separated. Defined here so the workflow can check it without
 * importing the sim. */
export const TUNE_SPEC = /^[A-Za-z]\w*=-?\d+(\.\d+)?(,[A-Za-z]\w*=-?\d+(\.\d+)?)*$/;
export const DEFAULT_ARGS = '--bots donothing,textbook,expert --seeds 1-20';
// A 4-vCPU runner does 3 bots × 5 seeds in ~16 min; 2 seeds (6 runs) per job keeps a 20-seed sweep near 8 min.
const SEEDS_PER_SHARD = 2;
const MAX_SHARDS = 10;
const MAX_SEEDS = 200;

export interface SweepPlan {
  args: string; // everything but --seeds, for every shard
  seeds: string; // full range "lo-hi"
  shards: string[]; // seed ranges, one per job
}

export function planSweep(text: string, shardsWanted?: number): SweepPlan {
  const tokens = (text.trim() || DEFAULT_ARGS).split(/\s+/);
  const rest: string[] = [];
  let seeds = '1-20';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const name = t.startsWith('--') ? t.slice(2) : '';
    if (BOOL_FLAGS.includes(name)) {
      rest.push(t);
    } else if (VALUE_FLAGS.includes(name)) {
      const v = tokens[++i];
      if (!v || !(name === 'tune' ? TUNE_SPEC : VALUE).test(v)) throw new Error(`bad value for ${t}: ${v ?? '(missing)'}`);
      if (name === 'seeds') seeds = v;
      else rest.push(t, v);
    } else {
      throw new Error(`not allowed in a remote sweep: ${t} (allowed: ${[...VALUE_FLAGS, ...BOOL_FLAGS].map((f) => `--${f}`).join(' ')})`);
    }
  }
  const m = /^(\d+)(?:-(\d+))?$/.exec(seeds);
  if (!m) throw new Error(`--seeds must be N or LO-HI: ${seeds}`);
  const lo = Number(m[1]);
  const hi = Number(m[2] ?? m[1]);
  const count = hi - lo + 1;
  if (count < 1 || count > MAX_SEEDS) throw new Error(`--seeds ${seeds}: 1 to ${MAX_SEEDS} seeds`);
  const n = Math.max(1, Math.min(MAX_SHARDS, count, shardsWanted && shardsWanted > 0 ? Math.floor(shardsWanted) : Math.ceil(count / SEEDS_PER_SHARD)));
  const shards: string[] = [];
  for (let k = 0, at = lo; k < n; k++) {
    const size = Math.floor(count / n) + (k < count % n ? 1 : 0);
    shards.push(`${at}-${at + size - 1}`);
    at += size;
  }
  return { args: rest.join(' '), seeds: `${lo}-${hi}`, shards };
}

if (process.argv[1]?.endsWith('sweepPlan.ts')) {
  const plan = planSweep(process.argv[2] ?? '', Number(process.argv[3] ?? '') || undefined);
  console.log(`args=${plan.args}`);
  console.log(`seeds=${plan.seeds}`);
  console.log(`matrix=${JSON.stringify(plan.shards)}`);
}
