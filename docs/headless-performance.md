# Headless performance plan, revised after review

Analyzed 2026-11-01; revised 2026-11-02 (America/Toronto). Simulation baseline:
`f3b0008`. No simulator, save-format, or golden changes are proposed in this pass.

## Decision

Investigate the historical slowdown and take the small runner fixes first. Defer
an evaluator rewrite. M8.1 closed with “revisit only if sweeps become the
bottleneck”; the UI's 4 ms/tick budget remains satisfied. Headless speed is not a
new correctness gate.

The user clarified that full-quarter sweeps run **daily**, superseding the earlier
answer of only around model changes. That establishes recurring demand for speed.
CI also shows a material sweep cost when goldens change. The daily local
bot/seed/scenario count is unspecified, so CI's 15-run timing must not be presented
as the duration of the user's entire daily workload.

Order of work:

1. Compare historical revisions on one host and investigate any isolated,
   avoidable regression before changing representation.
2. Apply small runner fixes: available concurrency and hourly-only diagnostics.
   Measure startup bundling before adding a build/dependency workflow.
3. If daily waits remain unacceptable, prototype sharing `prepareLpar` between
   normal evaluation and trials. Measure that before building a full `LparPlan`
   or introducing region caches with routing invalidation.
4. Consider a numeric evaluator only after those results. Keep it only with a
   measured ≥15% end-to-end gain on the real sweep workload **and deletion of the
   old production evaluation path within the same milestone**. Otherwise revert.

`advanceBatch` remains shelved. Tick cadence, trial count, physics, pure snapshots,
and exact hashes remain constraints.

## Historical comparison on one host

The M8.1 closing commit is `6035199` (2026-10-27). Its notes record Midwest
2.56 s/day and Harbourline 5.27 s/day on the then-current cloud box. The review's
current one-day runs took 4.96 s and 8.95 s. Those observations alone mix hosts,
runtimes, and potentially cold versus warm execution.

For this comparison, five revisions were bundled with the same installed esbuild
and run serially with Node `v24.19.0`, `--days 3 --seed 42 --hash`. The second pass
reversed both revision and scenario order. No tests or other simulations ran
concurrently. This environment reports three CPUs, two available CPUs, and a
two-CPU cgroup quota; the reviewer's four-CPU box is a different observation.
CI uses Node 22, so a subsequent optimization A/B should also be checked there.

Three-day total seconds, two runs per scenario:

| Revision | Checkpoint | Midwest | Harbourline |
| --- | --- | ---: | ---: |
| `6035199` | M8.1 closes | 11.54 / 12.99 | 16.19 / 17.68 |
| `02a34af` | Later Oct 27 | 12.53 / 13.45 | 17.18 / 18.53 |
| `76c0785` | Per-system CF service, Oct 28 | 11.09 / 11.38 | 23.34 / 18.77 |
| `668c8c1` | CP/zIIP backlog fix, Oct 29 | 16.34 / 12.11 | 25.33 / 19.37 |
| `f3b0008` | Current baseline | 15.68 / 15.64 | 25.46 / 24.42 |

The two-run means grew about **28% for Midwest and 47% for Harbourline** from
closure to the current baseline on this host. This establishes cumulative
code/workload growth, rather than a demonstrated 2x code regression. The closing
revision itself now takes 4.36–4.79 s on its first Midwest day and 6.21–6.81 s on
its first Harbourline day, already above the old recorded 2.56/5.27 values.
Host/runtime and cold/warm differences therefore matter too.

The intermediate results are noisy: `668c8c1` ranges from 12.11 to 16.34 s in
Midwest. These coarse checkpoints do not identify a single avoidable regression
or justify reverting a realism fix. Functional changes also alter the simulated
trajectory and how much projection work occurs.

Every hash repeated within its revision. Cross-revision hash differences are
expected from the realism changes. Full per-day timings and hashes are in
[the raw CSV](performance/headless-history-2026-11-02.csv). There are 21
sim-touching commits after the exact closing commit, including two later on
Oct 27; the review's count of 19 uses the later date cutoff.

A consecutive Harbourline CPU-profile comparison confirmed the growth: 18.49 s
at closure versus 27.08 s currently for three days with profiling. Inclusive
sample shares were:

| Stage | Closing commit | Current baseline |
| --- | ---: | ---: |
| `dispatchLpar` | 45.1% | 43.5% |
| `evaluateLpar`, normal evaluation and trials | 26.3% | 24.4% |
| `stepRmf` | 7.0% | 10.6% |
| `accumulateTick` within RMF | 6.0% | 9.3% |
| Policy trial `project` | 2.5% | 2.0% |
| GC | 3.7% | 3.0% |

Nested rows overlap and must not be added. In absolute sampled time, RMF grew
from roughly 1.3 to 2.9 s over three days, consistent with the expanded
per-system/structure CF reports. Evaluation and surrounding dispatch work also
grew. Projection explosion and GC are not supported as the explanation.

No single avoidable hotspot has been established. Expanded CF accumulation is a
bounded place to inspect next if runner changes leave a daily throughput problem;
that does not reopen the rejected in-place RMF scheme.

## Actual sweep costs

CI runs donothing/textbook/expert for seeds 1–5, each allowed up to the 40-day
quarter; runs can end earlier. It sweeps only when golden hashes change.
GitHub's job and step timestamps show:

| CI run | Check job | Sweep step | Trigger |
| --- | ---: | ---: | --- |
| [41365377713](https://github.com/piconaut/goal-mode/actions/runs/41365377713) | 1m53s | 8m51s | Golden-changing PR |
| [41377109525](https://github.com/piconaut/goal-mode/actions/runs/41377109525) | 1m59s | 12m33s | Golden-changing PR |
| [41389861007](https://github.com/piconaut/goal-mode/actions/runs/41389861007) | 1m55s | skipped | Ordinary push |

The sweep dominates these model-change checks, rather than every PR. PROGRESS
also records three-scenario, ten-seed, three-bot regressions after recent realism
fixes: 90 runs per set, up to 40 days each. Daily usage supports bounded
performance work, but does not establish that maintaining two evaluators is worth
it.

The connector omitted timestamps, so durations came from read-only
`gh api repos/piconaut/goal-mode/actions/runs/<id>/jobs`, using the sweep step's
start and completion rather than queued workflow time.

## Small runner fixes

Two changes are implemented in separate PRs from `dev`:

- [#138](https://github.com/piconaut/goal-mode/pull/138), `perf/sweep-parallelism`: replace `cpus().length` with
  `os.availableParallelism()` as the default. Preserve explicit `--jobs`. This is
  the OS's available concurrency estimate, not a custom cgroup-quota parser;
  verify its value on each host. A two-seed, one-day CSV matched baseline output
  with `--jobs 1`; explicit override smoke checks passed too.
- [#139](https://github.com/piconaut/goal-mode/pull/139), `perf/headless-hourly`: collect hourly-only statistics inside `if (hourly)` and
  remove per-tick CF-string formatting whose result was never printed. Daily
  summaries, requested RMF reports, final DPs, and logs remain available.

Headless smoke comparisons covered both scenarios with and without hourly output,
plus Midwest with a cap, selected RMF report, class detail, and WLM log. Every
output line matched after removing the elapsed-time line. Instrumented state
hashes matched: Midwest default `b1aa42059d46952e`, capped
`31418fda91f41cd6`, Harbourline `c47f6b8416f440f8`.

These single-pair smoke runs do not establish a robust timing gain. The final
candidate's quiet runs were faster and hourly runs slightly slower in that order;
the historical samples demonstrate substantial host variation. No achieved
percentage speedup is claimed. This CLI diagnostic change does not accelerate
the bot's simulation loop.

Typecheck passed in both runner worktrees. The shared suite passed: 57 files and
488 tests. The analysis worktree also passed typecheck; `git diff --check` passed
for all three changes.

Five alternating zero-day bot starts measured startup separately: median 0.259 s
with tsx versus 0.082 s with a prebuilt bundle, with identical JSON summaries.
That saves about 2.7 s across CI's 15 runs, against an 8m51s–12m33s sweep.
Bundling is deferred: this does not yet justify another build/dependency workflow
and says nothing about simulation time.

## Conditional simulator work

The earlier profile's evaluator target remains technically plausible, but it is
not the first investment. A six-day Midwest textbook bot at seed 42 spent about
90% of sampled time in `step`, 27% in `evaluateLpar`, 10% in projections, and 9.5%
in RMF. Bare Harbourline spent about 25% in evaluation and 2% in projections.
Eliminating projections cannot produce a large overall gain in those workloads.
GC took only 3–4%; object construction can cost CPU outside GC, but GC itself is
not the main bottleneck.

The cleanest small experiment is sharing `PreparedLpar`: the normal path prepares
it in `src/sim/wlm/eval/prepare.ts`, and the first trial prepares it again in `adjust.ts:89`.
Trials already reuse their preparation. Share it with the normal evaluation
without a cross-tick invalidation scheme, then measure the result. Preparation is
only a few percent of total cost, so expect modest savings.

`cicsRegions` is rebuilt each tick, and `scpsOnly` still builds full slice result
objects. These findings remain valid. However, routing can add/remove slices,
batch periods appear/disappear, policies change, and configuration commands
replace objects. A broad `LparPlan` cache needs careful invalidation; do not build
it until the cheap experiment and a new profile warrant it. Existing template,
classification, goal-info, and composite-key caches must not be duplicated.

A numeric kernel would need to preserve operation and iteration order, re-evaluate
all affected dependency/region/I/O coupling, and keep reusable scratch arrays out
of returned snapshots. Packed arrays versus `Float64Array` must be measured;
`Float32Array` would change the double-precision model. The previous field-by-field
slice construction made the engine about 40% slower, illustrating the risk.

For any such milestone, require ≥15% lower end-to-end time on the actual daily
workload, unchanged hashes, and no material regression on other scenarios. Delete
the old production evaluator in the same milestone; an adapter around the one
shared kernel is acceptable, a second physics implementation is not. Revert if
these exit conditions cannot be met. `advanceBatch` stays shelved.

## Validation before accepting simulator optimization

- Alternate reference/candidate bundles on the same host for at least five pairs.
  Separate first-day startup, later-day throughput, wall/CPU time, peak RSS, and
  completed sweep runs per minute. Do not run tests concurrently with timings.
- Compare full serialized state hashes for Midwest, Revenue, and Harbourline at
  days 1, 3, and 8 over several seeds; terminal scores alone are insufficient.
- Cover region TRANSACTION/REGION/BOTH modes, policy changes, routing, resource
  groups, I/O priority off, capping, zIIP overflow, paging/swap, batch queues,
  abends, and restarts. Preserve trial order, receiver choice, logs, floating-point
  operation order, and optional-field/key order, including unclamped projections.
- Retain an old input/output snapshot, advance again, and assert the old snapshot
  is unchanged. Compare one large advance against many small ones and save/reload
  midway. The current purity source scan cannot detect scratch-buffer leaks.
- Run `npm run check`. Keep goldens unchanged for pure optimization. Include early
  and late days plus reader tools before claiming daily sweep gains.

Do not use coarser ticks, fewer receivers/trials, partial re-evaluation below a DP,
approximate math tables, or in-place persisted accumulators as hash-neutral
optimizations. Do not omit RMF/response/Monitor III data merely because a caller
is headless: game accounting, diagnosis, tools, and strategies consume it.

## Reproduction

For each revision, archive into a temporary directory, bundle that revision's
`tools/bench.ts` with the current installed esbuild, and run each scenario with
`--days 3 --seed 42 --hash`. Repeat in reverse revision/scenario order. This avoids
changing the working checkout and keeps the toolchain constant. The CSV records
all 20 historical runs, not just selected samples.

For the profile comparison, use those bundles with:

```sh
node --cpu-prof --cpu-prof-dir=/tmp/goal-mode-perf --cpu-prof-name=closed-harbourline.cpuprofile /tmp/goal-mode-perf/history/6035199.mjs --scenario harbourline --days 3 --seed 42 --hash
node --cpu-prof --cpu-prof-dir=/tmp/goal-mode-perf --cpu-prof-name=review-current-harbourline.cpuprofile /tmp/goal-mode-perf/history/f3b0008.mjs --scenario harbourline --days 3 --seed 42 --hash
```

Inclusive percentages sum CPU-profile sample `timeDeltas` through each function's
stack ancestry, counting a repeated function once per sample. Profiled timings
are kept separate from unprofiled runs. No optimized simulator implementation was
benchmarked in this analysis.
