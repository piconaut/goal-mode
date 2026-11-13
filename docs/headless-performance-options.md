# Headless performance: options for a significant speed-up

Analysed 2026-11-04 on `dev` at `1eaa7e7`. Options are described as analysed; the results of what has landed are in "Results" below. Speed-up figures are estimates
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

## Results: option 1, step 1 (CL-05, 2026-11-10)

What landed: `src/sim/core/tick/plan.ts` (`lparPlan`, memoised on scenario, config, WLM definition and the effective
workload and address-space lists, which carry routing and run additions). It holds per-image indices, IEAOPT, pool,
Db2 and CICS configs, CPU speeds, workload@system and slot-queue keys and the CICS region count. `dispatchLpar`,
`reserveOverflow`, `lparDemand` and `planLpar` read it, and look up runtime arrays by index with a check
(`atOrFind`). The evaluator inputs that PR/SM's grants don't change (`cicsRegions`, `cicsHonorPriority`, DP map,
promotion set, RG sysplex shares) are built once per image per tick (`TickCtx.imageInputs`). Before, the zIIP
overflow probe built them and dispatch built them again. Hash-neutral: 3-day hashes (seed 42) unchanged, Midwest
`c79b2b893f2ff1ec`, Harbourline `0f4993768dbab687`, Revenue `513f4775588e15ee`. `npm run compare` reports no
differences.

Correction to the identity measurement above: `config` and the definition keep their identity, but Harbourline's
CPSM goal routing replaces `routing` about every 8 ticks (246 of 2,000 ticks), so the plan is rebuilt then. It's the
same cadence the slice-template cache already pays, and the rebuild is 0.2 % of the profile.

Timing: cloud host, 4 CPUs, Node 22.23, esbuild bundles of `tools/bench.ts` from `dev` (`2f8a631`) and the
candidate, 3 days, seed 42, run alternately with nothing else running (raw:
[performance/cl05-timing-2026-11-10.csv](performance/cl05-timing-2026-11-10.csv)). Medians:

| | Harbourline (11 pairs) | Midwest (5 pairs) | Revenue (5 pairs) |
|---|---:|---:|---:|
| 3-day total, ref → candidate | 28.97 → 27.56 s | 12.81 → 12.22 s | 12.55 → 11.34 s |
| Paired change (range) | −6.3 % (−10.4 … +0.4) | −6.6 % (−11.7 … −0.1) | −13.8 % (−14.1 … −7.0) |
| Day 1 | 10.43 → 9.63 s | 5.15 → 4.85 s | 5.23 → 4.54 s |
| Days 2–3, ms per tick | 1.061 → 1.021 | 0.450 → 0.428 | 0.424 → 0.389 |
| Peak RSS | 209 → 211 MB | 128 → 122 MB | 129 → 128 MB |

The first 5 Harbourline pairs gave a −2.0 % median, the next 6 gave −7.9 % (range −10.4 … −5.0). Host noise is
of the same order as the gain, so read the 11-pair median, not either batch. Every tick stays far inside the UI's
4 ms budget (about 1 ms on Harbourline).

CPU profile, 3-day bench, inclusive shares (nested rows overlap). Profiled totals were Harbourline 31.8 → 28.4 s and
Midwest 14.8 → 12.6 s:

| Stage | Harbourline before | after | Midwest before | after |
|---|---:|---:|---:|---:|
| `dispatchLpar` | 34.4 % | 30.8 % | 35.1 % | 34.6 % |
| `lparEvalInput` (+ `imageInput` after) | 9.4 % | 0.8 + 5.0 % | 7.3 % | 3.2 + 5.3 % |
| `cicsRegions` | 5.2 % | 3.0 % | 4.4 % | 3.3 % |
| `reserveOverflow` | 11.8 % | 12.4 % | 6.0 % | 6.4 % |
| `lparDemand` | 7.3 % | 7.8 % | 6.2 % | 5.5 % |
| `evaluateLpar` | 22.5 % | 23.5 % | 24.3 % | 25.9 % |
| `stepRmf` / `accumulateTick` | 12.3 / 11.2 % | 13.8 / 12.5 % | 12.7 / 11.1 % | 12.8 / 11.1 % |
| `adjustPolicies` | 8.5 % | 9.0 % | 11.8 % | 12.0 % |

Textbook bot, Harbourline, 5 days, seed 42, one profiled run each: 48.6 → 48.3 s with identical output. Shares
moved the same way as the bench (`lparEvalInput`+`imageInput` 8.5 → 5.6 %, `cicsRegions` 5.0 → 2.9 %), but one
run can't show a gain this size against host noise.

What didn't help, or hardly: the `.find()` replacements themselves. The config arrays are a few entries long, and
the self time of those lookups was well under 1 %. Most of the gain comes from not building the image inputs twice.
`cicsRegions` is still about 3 % (CL-06 moves it into the plan). The other large remaining costs are the per-tick
record work in `accumulateTick` and the `step` body (copying and rebuilding state), which is option 2's territory,
and the evaluator.

## Results: option 1, step 2 (CL-06, 2026-11-11)

What landed:
- `cicsRegions` is computed once per plan (`regionsOf`), not every tick. It reads only slice template fields, which the
  plan's keys fix; batch slices carry no CICS role. A test checks that the result is the same at different rates.
- `step.ts` reads the plan for its CPC record, z/OS and CF images, Db2 images, structure request shares, job classes
  and their WLM home, and CPC sites.
- `control.ts`: `softCap` and `stepCapping` take capacity groups and their members from the plan, and capping state by
  index. `adjustPolicies` reads LPAR ticks by index and IEAOPT from the plan.
- `measure/rmf.ts` is unchanged. Its per-tick lookups are on `LparRuntime` pools, which are per-tick state, and the
  rest run once per RMF interval, so a config plan has nothing to offer there.

Checks: hashes as in CL-05, `npm run compare` no differences, and a 1-day A/B against `dev` with mid-run config edits
(capacity group, defined capacity, ADD_AOR, IEAOPT honor priority off, a WLM routing policy, CF fail and recover)
gives identical hashes on Harbourline and Midwest.

Timing against CL-05 (`dev` `8a7a0e1`), same protocol, 7 alternating pairs per scenario (raw:
[performance/cl06-timing-2026-11-11.csv](performance/cl06-timing-2026-11-11.csv)). Medians:

| | Harbourline | Midwest | Revenue |
|---|---:|---:|---:|
| 3-day total, CL-05 → CL-06 | 27.28 → 25.69 s | 12.84 → 11.62 s | 11.50 → 10.58 s |
| Paired change (range) | −3.7 % (−9.1 … −1.0) | −7.6 % (−12.9 … −1.1) | −6.9 % (−10.0 … +0.8) |
| Days 2–3, ms per tick | 1.028 → 0.965 | 0.446 → 0.397 | 0.395 → 0.363 |
| Peak RSS | 209 → 214 MB | 128 → 122 MB | 126 → 126 MB |

**Stop rule:** CL-06 took over CL-05's "Done when", and Harbourline's −3.7 % is below its 5 % bar. Read that way, it
merges only if it also simplifies the code. It does in part:
- the per-tick rebuild of the CICS region topology is gone;
- `step` and the capping stages lose their ad hoc `.find()`/`filter` chains for a named record each.

But the source grows by about 30 lines net, and the plan now has a lazily filled field that WT-09 has to respect. The
user accepted it on the combined result (2026-11-11). Midwest (−7.6 %) and Revenue (−6.9 %) clear the bar on their own.

Option 1 in total is roughly 10 % on Harbourline and 14 % on Midwest, from the two steps' medians compounded. That
sits at the low end of the 15–25 % estimate: the `.find()` calls were cheap, and the gain came from not rebuilding
the image inputs and the region topology.

Re-profile, 3-day bench, inclusive shares, CL-05 → CL-06 (profiled totals: Harbourline 28.4 → 27.6 s, Midwest 12.6 →
12.0 s):

| Stage | Harbourline | Midwest |
|---|---:|---:|
| `dispatchLpar` | 30.8 → 32.0 % | 34.6 → 34.4 % |
| `evaluateLpar` | 23.5 → 24.7 % | 25.9 → 27.3 % |
| `imageInput` / `cicsRegions` | 5.0 / 3.0 → 1.8 / 0.4 % | 5.3 / 3.3 → 1.7 / 0.0 % |
| `reserveOverflow` | 12.4 → 9.6 % | 6.4 → 4.2 % |
| `stepRmf` / `accumulateTick` | 13.8 / 12.5 → 14.1 / 12.6 % | 12.8 / 11.1 → 14.5 / 13.0 % |
| `adjustPolicies` | 9.0 → 9.6 % | 12.0 → 12.3 % |
| `lparDemand` | 7.8 → 8.8 % | 5.5 → 6.2 % |
| GC (self) | 6.1 → 6.7 % | 4.5 → 4.7 % |

**`evaluateLpar` is now the largest remaining share** (25–27 %). `dispatchLpar` contains it; outside the evaluator,
`dispatchLpar` is about 7 %. This is option 3's trigger. Next come RMF accumulation (`accumulateTick`, 12–13 %, nearly
all record copying of persisted accumulators) and the `step` body's own per-tick copies (5–7 % self). Both are
option 2's territory, which still needs a user decision. No config lookup is left that shows in the profile.

## Reproduction

```sh
npx esbuild tools/bench.ts --bundle --platform=node --format=esm --outfile=/tmp/bench.mjs
node /tmp/bench.mjs --scenario harbourline --days 2 --hash
node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=hb.cpuprofile /tmp/bench.mjs --scenario harbourline --days 2
```

Inclusive shares sum CPU-profile `timeDeltas` over each function's stack ancestors, counting a function once per
sample.
