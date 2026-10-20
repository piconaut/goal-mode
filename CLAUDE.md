# CLAUDE.md

Guidance for Claude (and humans) working in this repository.

## What this is

**GOAL MODE**: a browser-based roguelike simulation of z/OS workload performance and capacity
management. The player runs a bank's mainframe one simulated day at a time (≈10 real minutes
per day), tuning WLM policy, PR/SM configuration, hardware capacity and analytics tooling to
keep SLAs green and software cost down while workload grows and events pile up.

- **`SPEC.md`** is the design source of truth. Read the relevant section before implementing
  anything. If you deviate, update SPEC.md in the same change and log why in PROGRESS.md.
- **`PROGRESS.md`** tracks milestones, status, decisions and open questions. Update it at the
  end of every working session: tick boxes, add decisions, note what's next.

## Stack (planned; see SPEC §15)

TypeScript (strict) · Vite · React + Zustand · uPlot · Vitest · sim in a Web Worker · Node
headless runner for balancing.

Commands, once scaffolded (keep this list accurate):
```
npm install
npm run dev          # Vite dev server
npm test             # Vitest (unit + realism + golden)
npm run typecheck    # tsc --noEmit
npm run check        # typecheck + tests (no lint script yet)
npm run bench -- --hash   # 1 headless day, timing + end-state hash (must not change for pure optimisations)
npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1   # headless sim + RMF reports
npm run bot -- --bot donothing|textbook|expert|spendtowin|oraclerca --seed 42 [--tfp sign] [--difficulty story|normal|hard]   # full runs with strategy bots
npm run sweep -- --bots donothing,textbook --seeds 1-20 [--jobs 4] [--difficulty hard]  # bots over many seeds in parallel → CSV + summary
npm run play -- runs/a.json new 42 | status | start | advance 3 | report WLM_SUMMARY   # headless play CLI for agents (docs/agents.md)
npx vite build && npx vite preview --port 4173 &                  # then:
node tools/screenshot.mjs <outDir>                                 # headless UI screenshots
# In `npm run dev` builds, globalThis.__goalMode.send(msg) talks to the worker (DEV_INSIGHT, DEV_FAST_DAYS, DEV_TFP_OFFER).
```

## Architecture rules (non-negotiable)

1. **Layering:** `content → sim ← game ← ui`. `src/sim` must never import from `game`, `ui`,
   `worker`, or any DOM/browser API. `src/game` must not touch the DOM.
2. **Determinism:** the sim is `step(state, commands, rng) → newState`.
   - No `Math.random()`, `Date.now()`, `performance.now()`, timers, or iteration over
     unordered structures whose order could vary. Use the seeded RNG from `sim/core/rng`.
   - State is plain serialisable data (no classes with hidden state, no closures, no Maps in
     persisted state unless serialised in sorted order).
   - Same seed + same command log ⇒ bit-identical results. Golden tests enforce this.
3. **Data-driven content:** scenarios, workloads, events, tools, perks, prices and coefficients
   live in `src/content/`. Don't hard-code tunables in sim logic.
4. **One tick = 10 sim-seconds** (the WLM policy adjustment interval). The pipeline order in
   SPEC §5.1 is the contract; new subsystems slot into it, they don't reorder it.
5. **Performance budget:** ≤ 2 s per headless sim day, ≤ 4 ms per tick. Analytic/fluid models
   per tick; only batch jobs are discrete entities. Benchmark if you touch hot paths.

## Conventions

- **Units in names**, always: `cpuSec`, `cpuMs`, `msu`, `suPerSec`, `ratePerSec`, `bytes`,
  `simSec`. Fractions are `0..1` and suffixed `Frac` (`busyFrac`, `hitFrac`); percentages only
  at display time.
- z/OS terms keep their real names and casing in identifiers where sensible: `serviceClass`,
  `period`, `importance`, `perfIndex`, `execVelocity`, `r4ha`, `definedCapacityMsu`,
  `logicalCps`, `polarity: 'VH' | 'VM' | 'VL'`. Use the real report names in UI text
  (WLMGL, Partition Data, CF Activity, DELAY, SYSINFO).
- Prefer pure functions with explicit inputs. Each sim module exports a `stepX(state, ctx)`
  that returns new sub-state, plus pure helpers that are unit-tested on their own.
- Keep comments sparse. Explain *why* or cite the real behaviour being modelled, e.g.
  `// Percentile PI clamped to [0.5, 4.0] by bucket layout (SG24-7621 §3.10)`.

## Realism policy

- The *mechanics* should behave like real z/OS. The *numbers* are fictional but plausible.
- When modelling a behaviour, cite the source (IBM doc, Redbook, or expert publication) in a
  comment or in SPEC §18. Prefer IBM docs, then established practitioners (Watson & Walker
  Tuning Letter, IntelliMagic, Peter Enrico, Colin Paice, SHARE handouts).
- Every invented coefficient lives in `content/` with a `// FICTIONAL:` comment describing the
  shape it should produce ("PR/SM overhead grows steeply above 2:1 LtoP").
- Never present invented numbers as real IBM figures (no real LSPR/MSU ratings or prices).
- If you're unsure how z/OS really behaves, say so in PROGRESS.md "Open questions" rather than
  guessing silently. Pick a reasonable model, mark it `// APPROX:` and move on.
- Update SPEC §17 (fidelity table) when you add or change a model.

## Testing expectations

- **Unit tests** for every pure model function (Erlang-C, polarity, PI, buckets, R4HA,
  capping, MLC, dependency health, classification matching).
- **Realism tests** (`tests/sim/realism/*`): behavioural assertions from SPEC §16, e.g.
  "Db2 MSTR starvation raises DDF response time without raising DDF CPU delay".
- **Golden runs** (`tests/golden/`): seeded scripted runs hashed per day. If you change model
  behaviour intentionally, regenerate the goldens in the same commit and explain why in the
  commit message.
- Balance changes: run the headless strategy bots (SPEC §16) and record outcomes in
  PROGRESS.md.

## Game-design guardrails

- Diagnosis is the gameplay: new events must come with *symptoms*, *clues* (in which report),
  and *multiple valid fixes* (SPEC §9, §13.3).
- Every lever needs a cost or a trade-off. If a change is strictly better, it's a bug in the
  design.
- Anything a player can see must be explainable from data the game exposes. No hidden "gotcha"
  without a clue path.
- New z/OS concepts get a Codex entry (`content/codex/`) with a short explanation and a source
  link.

## Working process

- Work milestone by milestone (PROGRESS.md). Keep the sim runnable headless at every step.
- Small, focused commits. Don't mix model changes with UI changes.
- Before finishing a session: tests pass, typecheck clean, PROGRESS.md updated.
- Delegation (to save usage): hand well-scoped tasks to the Sonnet subagents in `.claude/agents/` —
  `implementer` (content/data entries, tests for existing pure functions, small UI changes, from a precise
  brief) and `log-reader` (digest bot/sweep logs, test failures, long reports). Keep sim model changes,
  balance decisions and cross-layer work on the main agent, and review every subagent diff before committing.
