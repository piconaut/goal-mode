# Headless performance: options for a significant speed-up

Analysed 2026-11-04 on `dev` at `1eaa7e7`. Nothing below is implemented yet. Speed-up figures are estimates
from profile shares, not measurements. Builds on [docs/headless-performance.md](https://github.com/piconaut/goal-mode/blob/dev/docs/headless-performance.md).

**Summary:** the cost is mostly glue code, not physics. Time goes to building fresh objects every tick and to
string-keyed lookups. Three hash-neutral changes could make Harbourline roughly 2× faster (perhaps 2.5×).

## Measurements

Cloud host, 4 CPUs, Node 22.23, esbuild bundle of `tools/bench.ts`, seed 42, no player actions.

| | Midwest | Harbourline |
|---|---|---|
| Time per simulated day | 3–4 s (0.34–0.47 ms/tick) | ~9 s (~1 ms/tick) |
| Simulator state at end of day 1 | 1.7 MB (RMF 1.6 MB) | 6 MB (RMF 6 MB) |

CPU profile, 3-day Harbourline run (bench and textbook bot gave the same picture). Inclusive shares; nested rows
overlap, so they don't add up:

| Stage | Share |
|---|---:|
| `step` (whole simulation step) | 87–91% |
| `dispatchLpar` | 39–41% |
| `evaluateLpar` (the evaluator; the only real physics) | 21% |
| `stepRmf` / `accumulateTick` | 13% / 12% |
| `lparDemand` | 10% |
| `adjustPolicies` | 7–8% |
| Garbage collector | 7% |
| Bot and game layer outside `step` | ~6% |

Other observations:

- **`dispatchLpar` outside the evaluator (~18%):** `.find()` lookups, string keys built per slice (`wlLparKey`),
  `Record` rebuilds, `cicsRegions` and `decayInto`.
- **`accumulateTick`:** copies its accumulator maps (`{ ...acc.scps }`, `{ ...acc.lpars }`, ...) every tick.
- **GC tuning doesn't help:** `--max-semi-space-size=64` was no faster (15.0–15.5 s vs 14.0–15.1 s for 2 days).
  The cost is building objects, not GC pauses.
- **`config` and `wlm.definition` keep their identity:** across 8,640 ticks with no commands, neither object was
  replaced (0 changes in either scenario). A cache keyed on those objects therefore needs no extra invalidation
  logic.

## Options, best value first

### 1. Precompute lookups once per config (hash-neutral)

Keep a precomputed lookup structure ("plan") for each config. Store it in a `WeakMap` keyed on the `scenario`,
`config`, `wlm.definition` and routing objects themselves. The plan holds:

- integer indices for each system, pool and service-class period;
- pre-built workload×system keys;
- classification results for workloads and batch job classes;
- CPU speeds, CF structures by name, and slice templates.

`step`, `dispatchLpar`, `lparDemand`, `prsm` and `accumulateTick` then use array indices instead of `.find()` and
string keys. A command that changes config already produces a new object, so the cache can't go stale. This
answers the invalidation concern about a broad `LparPlan` in docs/headless-performance.md.

- **Estimate:** 15–25% end to end.
- **Risk:** low. It can land in small `perf` PRs with the Midwest and Harbourline bench hashes unchanged on each.

### 2. Mutable engine with snapshots on demand (the re-architecture)

Replace `step(state) → newState` with an engine that changes its own state each tick:

- `engine.step(commands)` updates the state in place.
- `engine.snapshot()` and `Engine.from(snapshot)` serve saves, UI worker posts, policy trials, `project` and goldens.
- Accumulators (RMF, WLM period state) become flat numeric arrays indexed by the plan from option 1.

Determinism doesn't need a new immutable state per tick. Same seed and same command log still give bit-identical
results. This removes the per-tick copying of RMF accumulators, period-state arrays, workload state and
`Record`s.

- **Estimate:** a further 20–30%.
- **Costs and risks:**
  - It reverses the earlier rejection of "in-place persisted accumulators". That needs a user decision.
  - It needs a snapshot-isolation test: change the engine after a snapshot, then assert the snapshot is unchanged.
    The current purity source scan can't detect this.
  - Snapshots must serialise with the same key order and the same optional fields, or the state hash changes even
    though behaviour doesn't.
  - The UI worker posts snapshots at its own pace instead of keeping one state object per tick.

### 3. Rewrite the evaluator as a flat-array numeric routine (last)

Store slice fields in `Float64Array` columns (never `Float32Array`, which would change the double-precision
model). Prepare the arrays once per plan and reuse scratch arrays across policy trials. Floating-point operation
order and iteration order must stay as they are.

The evaluator is only 21% of the time, so on its own it can't clear the doc's ≥15% end-to-end bar. After options
1–2 it could plausibly halve, for about another 10%. The old evaluator would be deleted in the same milestone.

### Combined estimate

The kernel would go from about 21% to about 11%. The glue would go from about 60% to about 20%. GC would go from
about 7% to about 2%. That leaves about 45% of today's time: roughly **2×**, perhaps 2.5×.

### 4. Changes that alter behaviour (only with new goldens and a balance re-sweep)

- **Slower update rates:** recompute DASD/CF queueing, PR/SM and routing every N ticks, or only when their inputs
  change beyond a tolerance. The rates should come from real z/OS behaviour; check against IBM docs first.
- **Quiet-tick reuse:** reuse the previous tick's results for idle systems or at night.

Both break bit-identity and loosen the 10-second-tick contract (CLAUDE.md rule 4), so they rank last.

## Faster CI without touching the sim

The CI bot sweep (8m51s–12m33s) runs 15 runs on one 2-CPU runner. Splitting it across a GitHub Actions matrix
would cut wall time roughly in proportion to the number of jobs.

## Not worth it

| Idea | Why not |
|---|---|
| Rewrite in WebAssembly | Two codebases, plus floating-point determinism risk (`Math.exp`/`log`), for little over flat arrays in JS |
| Threads inside a tick | A tick is about 1 ms, and sweeps already use every core |
| GC flags | Measured: no gain |
| Bundling the bots | Saves about 0.2 s per run |

## Proposed order

1. Option 1 as a series of hash-neutral `perf` PRs. Re-profile after each.
2. User decision on option 2, then a prototype on RMF accumulation first (the clearest copying cost), validated
   with `npm run compare` and snapshot-isolation tests.
3. Option 3 only if the re-profile still shows the evaluator as the largest remaining share.

## Reproduction

```sh
npx esbuild tools/bench.ts --bundle --platform=node --format=esm --outfile=/tmp/bench.mjs
node /tmp/bench.mjs --scenario harbourline --days 2 --hash
node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=hb.cpuprofile /tmp/bench.mjs --scenario harbourline --days 2
```

Inclusive shares sum CPU-profile `timeDeltas` over each function's stack ancestors, counting a function once per
sample.
