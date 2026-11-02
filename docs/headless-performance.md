# Headless performance proposal

Analysis date: 2026-11-01 (America/Toronto). Source: `f3b0008` on `dev`.
This is a proposal; no simulator or runner behavior was changed.

The best prospect for a material improvement is a shared evaluator kernel with
compiled LPAR metadata and reusable temporary buffers. Optimize the normal tick
evaluation as well as WLM projections. Faster projections alone cannot deliver a
large overall gain in the workloads measured here.

## Evidence and limits

Measured in the managed Linux environment with Node `v24.19.0`, seed 42, serial
processes, esbuild bundles, and no spectator output. The machine exposes three
CPUs, `os.availableParallelism()` returns two, and cgroup CPU quota is two CPUs.
CI currently uses Node 22; repeat the eventual A/B comparison there too.

Two separate workloads were CPU-profiled:

- Midwest textbook bot, Normal, six complete days: about 35 seconds including
  profiler overhead. This runs the actual `game.advance` path, hourly bot actions,
  policy changes, events, accounting, and reports. Final summary: day 6 complete,
  score 390, overall trust 73.3, two incidents, zero batch misses.
- Harbourline, three bare simulation days with no player commands: 26.91 seconds
  including profiler overhead. This exercises the larger estate and dynamic routing, but
  does not substitute for a Harbourline strategy-bot benchmark.

Inclusive sample shares, rounded; nested rows overlap and must not be added:

| Function / stage | Midwest bot, 6 days | Harbourline bare sim, 3 days |
| --- | ---: | ---: |
| `step` | 90.2% | 95.0% |
| `dispatchLpar` (including normal evaluation) | 33.4% | 44.2% |
| `evaluateLpar` across normal evaluation and projections | 27.1% | 24.8% |
| `adjustPolicies` (including projections) | 19.9% | 10.0% |
| `project` inside policy adjustment | 9.9% | 1.9% |
| `lparDemand` | 8.1% | 12.5% |
| `stepRmf` | 9.5% | 9.8% |
| `accumulateHour` | 4.3% | n/a |
| Garbage collection | 3.4% | 3.1% |

Unprofiled bare-sim timings from two fresh processes per scenario, three days per
process. The same end-state hash was reproduced in both runs; the Harbourline
profile also produced the same hash.

| Scenario | First day | Later individual days | Three-day total | Day-3 state hash |
| --- | ---: | ---: | ---: | --- |
| Midwest | 5.70–6.29 s | 4.09–5.05 s | 14.76–15.44 s | `bf00428ee23a9475` |
| Harbourline | 9.16–9.76 s | 7.09–8.13 s | 24.35–24.58 s | `9ef0c8246b23b71c` |

The bot's sim work is about 90% of total sampled time. Removing all game-layer
overhead would therefore save less than 10% of this workload. Removing the
projection subtree entirely would save roughly 10% in this bot and 2% in bare
Harbourline; merely speeding it up saves less. A 2x speedup of a subtree taking
27% of time saves roughly 13.5% overall,
before any integration overhead. These are cost bounds, not achieved speedups.

Garbage collection takes only a few percent. Object construction, property access,
temporary maps, and repeated traversals still cost CPU outside GC, but the profile
does not justify claiming that GC itself is the main bottleneck.

The existing one-day bench and two-day Midwest golden test are useful, but neither
represents a full sweep. Late-quarter growth, all three scenarios, hard difficulty,
reader tools, and long-lived process memory need coverage before an optimization
is called sweep-ready. No speedup estimate below is presented as measured.

## Recommended implementation sequence

### 1. Compile stable LPAR metadata and share preparation within a tick

Relevant code: `src/sim/core/step.ts` (`lparDemand`, `dispatchLpar`, `cicsRegions`),
`src/sim/wlm/evaluate.ts` (`prepareLpar`, `iosqByPriority`, `slicePagingFrac`), and
`src/sim/wlm/adjust.ts` (`project`).

The code already caches workload templates, classifications, goal information,
and several composite keys. Adding those caches again will not help. The remaining
opportunity is the structure built around them on every evaluation:

- `cicsRegions` rebuilds sorted transaction keys, region modes, server keys, and
  address-space associations every tick, although these do not depend on rates.
- The evaluator repeatedly maps aggregate IDs back to period IDs, identifies
  `~srv` aggregates, builds report-class membership, and maps slices to aggregates.
- The normal evaluation calls `prepareLpar`; the first policy trial prepares the
  same LPAR again. Trials then reuse that preparation, which is already a useful
  optimization and should be retained.
- Paging distribution is independent of trial DPs. I/O arrival rates and slice
  membership are also independent; the priority ordering and waits are not.

Introduce an immutable `LparPlan` for topology and a per-tick prepared input for
numeric demand. Store period, dispatch-aggregate, report-class, dependency-role,
and I/O-class indices in the plan. Prepare demand, paging fractions, and I/O rates
once, and pass that preparation to both the normal evaluation and every trial.
Continue recalculating dispatch, server health, I/O priority waits, and response
composition for each trial.

Invalidate by policy, relevant configuration, workload/address-space additions,
and slice topology. Routing may remove or add a slice when a share crosses zero;
batch periods and report classes may appear or disappear. Do not key a plan only
by scenario or LPAR ID. Separate stable online topology from the batch overlay,
and preserve existing first-seen and sorted orders. Keep caches bounded under
dynamic routing, as the template cache already does.

This is the first bounded prototype. Measure it independently: much of preparation
is only a few percent of runtime, so this change alone should not be sold as a
large speedup.

### 2. Replace intermediate evaluator objects with a shared numeric kernel

Relevant code: `src/sim/wlm/evaluate.ts:427`, especially the per-slice result
creation at lines 544–697 and aggregation at lines 700–745;
`src/sim/zos/dispatcher.ts`; the consumer in `dispatchLpar`.

`scpsOnly` already skips response-part objects, SLA CDFs, and report classes, but
still builds a full `SliceResult` object for every slice. Both modes allocate
dispatch demands/results and multiple numeric arrays, then traverse the slice
results again to aggregate period samples. The normal caller makes another pass
to collect backlogs, workload totals, holds, diagnostics, and batch grants.

Use one shared numeric evaluator with a workspace sized to the LPAR plan. Reuse
its temporary arrays across evaluations of that LPAR within a tick, and across
ticks through an explicit workspace owned by the advancing caller. `game.advance`
can allocate that workspace once per chunk; standalone headless runners can own
one outside persisted state. A compatible `step` wrapper can allocate temporary
storage for callers that do not supply a workspace. Reset every active numeric
range before use, and grow/rebuild the workspace when topology changes. Benchmark
packed number arrays against `Float64Array`; typed arrays are not automatically
faster. Do not use `Float32Array` for this deterministic double-precision model.

Accumulate service/report-class samples in slice order while composing responses.
The normal path can expose numeric result columns to `dispatchLpar` and build
response diagnostics only where consumed. The projection path needs only the
goal inputs and can avoid materializing per-slice result objects entirely. Keep
the current object-returning `evaluateLpar` as a wrapper/reference until its
consumers and tests can move safely.

Scratch storage must never be reachable from a returned `SimState`, a returned
evaluation that a caller retains, or a shared immutable plan. Allocate fresh
persisted outputs. This retains the current pure `step` contract and save format;
it does not require mutating input states or maintaining a second physics model.

This is the largest shared kernel in the profiles. Set an acceptance target of
at least 15% lower end-to-end time for steps 1 and 2 combined, with matching hashes
and no material regression on the other scenarios. That is a target for deciding
whether to keep the work, not a forecast or a measured result. A 2x overall claim
is not supported by the current profile.

### 3. Evaluate an owned batch-advance API only if more improvement is needed

Relevant code: `src/sim/measure/rmf.ts:187`, `src/sim/wlm/runtime.ts:122`, and
`src/game/run.ts:531`.

RMF accumulation, WLM decay, and hourly accounting construct fresh records and
bucket arrays on every tick. The previous performance pass explicitly shelved
in-place RMF accumulation because `step` is pure. That remains a valid constraint;
mutating `prev.rmf.acc` inside the existing `step` is not a compatible optimization.

An alternative worth prototyping later is `advanceBatch`: clone the mutable
accumulators once at an externally visible advance boundary, own them privately
for the chunk, then return an immutable snapshot in the existing format. Keep
`step` as the reference and share its numerical logic. Preserve event, alert,
automation, hourly, report-interval, and day boundaries exactly; a chunk cannot
defer any behavior that feeds the next tick. Completed intervals must not alias
an accumulator reused in the next interval.

This requires an explicit architecture decision and more differential testing.
Its isolated cost envelope is modest: RMF is about 10% and hourly accounting
about 4% in the Midwest bot profile, and neither can be eliminated completely.
Prioritize the shared evaluator before reopening this decision.

## Runner changes with narrower benefits

- In `tools/sweep.ts:16`, replace the CPU-count default with a concurrency limit
  that respects affinity and cgroup quota, while keeping `--jobs`. The current
  environment defaults to three workers on a two-CPU quota. Compare completed
  runs per minute and peak RSS at jobs 1, 2, and 3; extra workers are not free
  simulation speed. Independent seeds are already parallelized.
- Extract a callable bot runner and use a bounded persistent worker pool if
  short runs are common. Each sweep job currently launches Node plus tsx again,
  discarding warm code. This amortizes startup and JIT work, not the tick cost;
  the benefit shrinks on full-quarter runs. Bound memoization and verify running
  seeds A, B, A in one worker gives identical A results. Recycle workers if RSS
  grows. Bundling the entry point is a simpler startup experiment.
- In `tools/headless.ts:37`, collect hourly-only diagnostics only when `--hourly`
  is requested. The runner currently collects PI arrays and formats CF strings
  even when they will not be printed. When enabled, replace each PI array with
  sum/count, preserving addition order. This helps `npm run sim`, not the bare
  bench or bot loop.
- In `game.advance`, index event definitions and reuse unchanged event objects
  between transitions if a late-run profile warrants it. This is secondary:
  game overhead is small in the measured bot run.

## Approaches to avoid

- Coarser ticks, fewer receivers/trials, or running policy adjustment less often:
  these change feedback, outcomes, and the model contract rather than just speed.
- Re-evaluating only periods below the changed DP: dependency health, region
  coupling, CP/zIIP sharing, and I/O priority propagate effects elsewhere. The
  prior rejection in PROGRESS M8.1 still applies.
- Removing RMF, response diagnostics, or Monitor III just because a caller is
  headless. Game scoring, incident diagnosis, tools, and strategies consume these.
- Approximate CDF/Erlang tables or reassociated sums under a hash-neutral label.
  Exact memoization may be valid, but these math helpers are not the dominant
  sampled cost here. Preserve the new unclamped percentile projection behavior.
- Assuming completed batch history grows without bound. `closeNight` prunes
  completed instances, retaining predecessors only while that instance has
  unfinished jobs. Optimize active-job indexing only if a straggler-heavy profile
  shows it is material.

## Validation and measurement contract

1. Keep a reference and candidate bundle and alternate A/B runs on the same host.
   Report fresh-process first-day time, later-day time, total wall and CPU time,
   peak RSS, and sweep throughput separately. At least five paired repetitions
   should establish whether a result exceeds this cloud host's noise.
2. Compare serialized state hashes for Midwest, Revenue, and Harbourline at days
   1, 3, and 8, using several seeds. Add intermediate checkpoint comparisons when
   debugging: matching the terminal score alone is insufficient.
3. Use the existing scripted golden run plus differential command sequences for
   per-region TRANSACTION/REGION/BOTH modes, policy activation, dynamic routing,
   resource-group minimums/maximums, I/O priority off, capping, zIIP overflow,
   paging/swap, queued batch jobs, abends, and restarts. Preserve trial order,
   receiver choice, logs, float operation order, and optional-field/key ordering.
4. Retain an old input/output snapshot, advance the candidate again, and assert
   the old snapshot is unchanged. Also compare one large advance against many
   small advances and save/reload midway. These checks catch scratch-array and
   chunk-ownership leaks that the current purity source scan cannot detect.
5. Run `npm run check`. Do not regenerate goldens for a pure optimization. Run
   normal and reader bot workloads through early and late days before claiming
   sweep gains; retain complete bot outcomes and report hashes, not just timings.

Reproduce the profiled workloads (bundles and CPU profiles are temporary files):

```sh
mkdir -p /tmp/goal-mode-perf
./node_modules/.bin/esbuild tools/bench.ts --bundle --platform=node --format=esm --sourcemap --outfile=/tmp/goal-mode-perf/bench-current.mjs
./node_modules/.bin/esbuild tools/bot.ts --bundle --platform=node --format=esm --sourcemap --outfile=/tmp/goal-mode-perf/bot-current.mjs
node --cpu-prof --cpu-prof-dir=/tmp/goal-mode-perf --cpu-prof-name=current-bot-midwest.cpuprofile /tmp/goal-mode-perf/bot-current.mjs --bot textbook --days 6 --seed 42 --json
node --cpu-prof --cpu-prof-dir=/tmp/goal-mode-perf --cpu-prof-name=current-harbourline.cpuprofile /tmp/goal-mode-perf/bench-current.mjs --scenario harbourline --days 3 --seed 42 --hash
node /tmp/goal-mode-perf/bench-current.mjs --scenario midwest --days 3 --seed 42 --hash
node /tmp/goal-mode-perf/bench-current.mjs --scenario harbourline --days 3 --seed 42 --hash
```

Percentages above use CPU-profile sample `timeDeltas`, summed over a function's
stack ancestry for inclusive cost; repeated occurrences on one stack count once.
Profiler times and unprofiled bench times must be kept separate. This session did
not benchmark an optimized implementation.
