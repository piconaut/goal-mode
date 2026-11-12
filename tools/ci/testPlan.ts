// Remote test plan (.github/workflows/test.yml): validate the vitest arguments taken from a `Test-Args:` commit
// trailer or a workflow_dispatch input, and split the run into parallel shards.
//
//   npx tsx tools/ci/testPlan.ts "<test args>" [shards]   # prints raw=, filters=, shards=, matrix= lines for $GITHUB_OUTPUT
//
// `--suite` names test directories under tests/ (several are a union); `--filter` matches file paths (a filename
// substring, e.g. `tests/sim/wlm`). They are alternatives: vitest OR-s positional filters, so asking for a suite and a
// filter together would widen the run rather than narrow it.

/** Test directories under tests/ that `--suite` may name. */
export const SUITES = ['golden', 'game', 'sim', 'tools', 'ui'] as const;
export type Suite = (typeof SUITES)[number];
const VALUE = /^[A-Za-z0-9._,/-]+$/;
const DEFAULT_SHARDS = 4;
/** A 4-vCPU runner runs the whole suite in a couple of minutes; ten shards keeps a long run near one job each. */
const MAX_SHARDS = 10;

export interface TestPlan {
  raw: string; // the arguments as typed, for the run title
  filters: string[]; // positional vitest filters, e.g. ['tests/sim', 'tests/golden']; empty means every test file
  shards: number; // parallel jobs, each running `vitest run --shard=<k>/<shards>`
}

export function planTest(text: string, shardsWanted?: number): TestPlan {
  const raw = text.trim();
  const tokens = raw ? raw.split(/\s+/) : [];
  const suites: Suite[] = [];
  const filters: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const name = t.startsWith('--') ? t.slice(2) : '';
    if (name === 'suite') {
      const v = tokens[++i];
      if (!v || !VALUE.test(v)) throw new Error(`bad value for --suite: ${v ?? '(missing)'}`);
      for (const s of v.split(',')) {
        if (!(SUITES as readonly string[]).includes(s)) throw new Error(`unknown suite ${s} (suites: ${SUITES.join(' ')})`);
        suites.push(s as Suite);
      }
    } else if (name === 'filter') {
      const v = tokens[++i];
      if (!v || !VALUE.test(v)) throw new Error(`bad value for --filter: ${v ?? '(missing)'}`);
      filters.push(v);
    } else {
      throw new Error(`not allowed in a remote test run: ${t} (allowed: --suite, --filter; --shards is its own argument)`);
    }
  }
  if (suites.length && filters.length) {
    throw new Error('use --suite <dirs> or --filter <path text>, not both: a filter can name a suite path (e.g. --filter tests/sim/wlm)');
  }
  // Vitest OR-s the positional filters: `--filter a b` runs the files matching either.
  const suiteFilters = [...new Set(suites)].map((s) => `tests/${s}`);
  const n = Math.max(1, Math.min(MAX_SHARDS, shardsWanted && shardsWanted > 0 ? Math.floor(shardsWanted) : DEFAULT_SHARDS));
  return { raw, filters: [...suiteFilters, ...filters], shards: n };
}

if (process.argv[1]?.endsWith('testPlan.ts')) {
  const requested = Number(process.argv[3] ?? '');
  const plan = planTest(process.argv[2] ?? '', Number.isFinite(requested) ? requested : undefined);
  console.log(`raw=${plan.raw}`);
  console.log(`filters=${plan.filters.join(' ')}`);
  console.log(`shards=${plan.shards}`);
  console.log(`matrix=${JSON.stringify(Array.from({ length: plan.shards }, (_, i) => i + 1))}`);
}
