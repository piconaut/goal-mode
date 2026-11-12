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
  end of every working session: add decisions, note what's next.
- **`BACKLOG.md`** is the only list of work to pick up (user request 2026-11-09): scoped entries in named lists
  (`playtest-fixes`, `pr-followups`, `realism-fixes`, `cleanup`), each with a status. Implement only `status: ready`
  entries, and only from a list you were given; a vague request ("work through PROGRESS") isn't a list, so ask.
  Nothing in PROGRESS.md (design directions, proposals, roadmap, open questions) is a task until it is scoped into a
  BACKLOG entry. The PR that fixes an entry names it (`Backlog: PT-07`) and deletes it. New findings go into
  BACKLOG.md as entries (rules at its top).

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
npm run bench -- --hash [--scenario harbourline]   # 1 headless day, timing + end-state hash (must not change for pure optimisations)
npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1   # headless sim + RMF reports
npm run lab -- a.json b.json   # realism lab: A/B runs from JSON specs, side by side per RMF interval (format in tools/lab.ts)
npm run bot -- --bot donothing|textbook|expert|spendtowin|oraclerca --seed 42 [--tfp sign] [--difficulty story|normal|hard|ironman] [--reader] [--spectate runs/bot.json --pace 2]   # full runs with strategy bots
npm run bot -- --bot expert --scenario harbourline --seed 9 --days 29 [--changes] [--trace-day 29] [--dump 'PRDA D29 10:0'] [--tune rejectedSkipTicks=0]   # investigations: the bot's changes; one day's WLM an hour at a time (moves, outcomes, SLA, DPs); every candidate and trial of matching adjustments; POLICY_ADJUST overrides (tools/tune.ts; not balance)
npm run sweep -- --bots donothing,textbook --seeds 1-20 [--jobs 4] [--difficulty hard] [--resume] [--reader] [--tune k=v,...]  # bots over many seeds in parallel → CSV + summary; --resume continues a killed sweep from <out>.partial.jsonl; --reader adds a player who reads 5 reports/day and buys tools
npm run sweep:remote -- --bots donothing,textbook,expert --seeds 1-20 [--scenario harbourline] [--difficulty hard] [--tune k=v,...] [--shards 4] [--no-wait]   # same sweep on GitHub Actions, sharded by seed, on committed HEAD (no PR); waits, then runs/remote/<sha7>/summary.md + sweep.csv; --fetch <sha> collects a --no-wait run
npm run play -- runs/a.json new 42 | status | start | advance 3 | report WLM_SUMMARY   # headless play CLI for agents (docs/agents.md)
npm run play -- runs/a.json mon3 [system] [--json] [--at D2 10:40]   # Monitor III now or past: SYSINFO, CPC, DELAY, PROCU, ENCLAVE, SYSWKM, WFEX (text or --json); use it instead of ad-hoc scripts
npm run play -- runs/a.json finance | capacity | batch   # bill and TFP pace per product (overage $/MSU-hour by LPAR); CPC MSU, LPARs, initiators, capacity changes; last batch night by stream
npm run inspect -- runs/a.json dp PROD1 [--class ONL] [--from 'D19 20:00'] [--to 'D20 06:00']   # sim internals the player can't see (DPs per RMF interval): investigations only, never in player agents
npm run inspect -- runs/a.json wlm PROD1 --at 'D19 22:00' [--ticks 6] [--class ONL]   # why WLM did or didn't move DPs: receivers in order, each trial and its verdict (play-CLI files replay to any past time; browser saves trace forward)
npm run inspect -- runs/a.json blame [--json] [--incident N]   # counterfactual validator (RT-06): replay each online incident's opening hour once per card that affects the hurt workload, with the card ended at the hour start; report the game's blamed card against the cards whose removal met the SLA. Offline only (an hour of sim per card per incident); needs a play-CLI file
npm run inspect -- runs/a.json wlm-stats [system] [--from 'D1 06:00'] [--to 'D3 06:00'] [--ladder '12:00'] [--by-class] [--episodes] [--moves] [--json]   # policy adjustment statistics over a range (WT-01, the wlm-design audit's S-table): adjustments, candidates by outcome, trials by verdict, accepted and reversed moves, receivers assessed 30 adjustments without a move, and the DP ladder at a clock time; --by-class per period, --episodes lists the 30-assessment runs, --moves every accepted move. Needs a play-CLI file
npm run repro -- runs/s2.json S-2 | --scenario midwest --days 8 [--seed 42] [--difficulty normal]   # hands-off play-CLI file (start, advance 24 to day end, draft none): S-1 Midwest 2 days, S-2 Revenue 3, S-3 Harbourline 3, for inspect wlm / wlm-stats / blame
npm run compare -- [--base origin/dev] [--head <ref>] [--scenarios a,b] [--drop k1,k2]   # behaviour diff vs base: sim state (reporting excluded), game state, log, RMF report text/records, Monitor III views; exit 1 on any difference
npx vite build && npx vite preview --port 4173 &                  # then:
node tools/screenshot.mjs <outDir>                                 # headless UI screenshots
npx tsx tools/ci/behaviourNote.ts origin/dev     # CI gate: goldens changed ⇒ PR body needs "## Behaviour change" (PR_BODY env)
npx tsx tools/ci/balanceGate.ts runs/ci-sweep.csv 5 [scenario]   # CI gate: bot sweep inside balance bands (victories as a share of runs) (see .github/workflows/ci.yml)
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
5. **Performance budget:** ≤ 4 ms per tick in the worker. Headless speed (≤ 2 s per day was the old target) is
   no longer a gate (user decision 2026-10-27), but don't make it worse. Analytic/fluid models per tick; only batch
   jobs are discrete entities. Benchmark if you touch hot paths.

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

- **Check real behaviour with the `zos-docs` skill** (`.claude/skills/zos-docs/`; needs a clone of
  `piconaut/ibm-zos-books`) whenever you add, change or review anything that states or models z/OS behaviour or
  RMF/SMF/Monitor III report content (sim mechanics, report fields, Codex text, event clues). Cite book and page.
  Agents and subagents included: briefs for such work must say so. If the books aren't available, mark the claim
  unverified; don't guess.
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
- Confirmed facts go in `docs/research.md` (fact, page-linked source, sim status); check it before modelling
  something, and add a row when research settles a question. When the sim differs, also add an entry to
  BACKLOG.md list `realism-fixes`; update the ledger row and SPEC §17/§18 in the PR that changes the model.

## Testing expectations

- **Unit tests** for every pure model function (Erlang-C, polarity, PI, buckets, R4HA,
  capping, MLC, dependency health, classification matching).
- **Realism tests** (`tests/sim/realism.test.ts`): behavioural assertions from SPEC §16, e.g.
  "Db2 MSTR starvation raises DDF response time without raising DDF CPU delay".
- **Golden runs** (`tests/golden/`): seeded scripted runs hashed per day. If you change model
  behaviour intentionally, regenerate the goldens in the same commit and explain why in the
  commit message.
- **Behaviour claims:** back "report-only", "pure refactor" or "output-identical" with `npm run compare` and paste its
  summary in the PR. `--drop` names new reporting-only state fields so they don't count as a sim difference.
- Balance changes: run the headless strategy bots (SPEC §16) and record outcomes in
  PROGRESS.md.

## Game-design guardrails

- Diagnosis is the gameplay: new events must come with *symptoms*, *clues* (in which report),
  and *multiple valid fixes* (SPEC §9, §13.3).
- Every lever needs a cost or a trade-off. If a change is strictly better, it's a bug in the
  design.
- Anything a player can see must be explainable from data the game exposes. No hidden "gotcha"
  without a clue path.
- New z/OS concepts get a Codex entry (`src/content/codex/`) with a short explanation and a source
  link.

## Working process

- Work milestone by milestone (PROGRESS.md), picking tasks from BACKLOG.md. Keep the sim runnable headless at every step.
- Small, focused commits. Don't mix model changes with UI changes.
- Branches and PRs: one session branch per task, cut from `dev`; CI is the merge gate (PROGRESS.md "Branch workflow").
  Open a pull request for every task without waiting to be asked. When the task is done and pushed (check green
  locally, PROGRESS.md updated):
  1. Open a PR from the session branch into `dev` (never `main`; `dev` → `main` is the milestone PR in PROGRESS.md),
     with the body following `.github/pull_request_template.md`. Fill in "Behaviour change" whenever goldens change;
     label pure optimisations `perf`.
  2. Don't merge it or enable auto-merge: the review loop (below) reviews and merges PRs into `dev`. Open it as a
     draft when it isn't ready for review yet. (The `dev` → `main` milestone PR follows PROGRESS.md.)
  3. Subscribe to the PR's activity and keep CI green: fix red checks and review findings, and push again.
  Don't push to or merge anyone else's PR; report it to the user. The `pr-fix-loop` skill is the exception: it may push
  review fixes to, and merge, any open non-draft PR into `dev` not labelled `no-autofix` (plain fast-forward pushes
  only; never rebase or force-push).
  After your PR is merged, further work in the same session starts again from the latest `dev` on the same branch
  name, as a new PR.
- Before finishing a session: tests pass, typecheck clean, PROGRESS.md updated.
- Delegation (to save usage): hand well-scoped tasks to the subagents in `.claude/agents/`:
  - Sonnet `implementer`: content/data entries, tests for existing pure functions, small UI changes, from a precise
    brief.
  - Sonnet `log-reader`: digests bot/sweep logs, test failures, long reports.
  - Opus `pr-reviewer`: checks out a PR in a worktree, reads CI rather than rerunning `npm run check`, runs bench
    hashes (and a sweep for milestones), verifies the PR's claims, posts its report and returns a merge verdict.
  Keep sim model changes, balance decisions and cross-layer work on the main agent, and review every subagent diff
  before committing. In the `audit-loop` skill, vetted realism fixes go to the Opus `realism-fixer` subagent;
  vetting and balance calls stay on the main agent.
  Commit trailers: every agent-written commit (including a subagent's) ends with a `Co-Authored-By:` line naming the
  agent and the model it is itself running as, read from its own system prompt or environment. Never copy a trailer
  from a coordinator's brief or reminder, and if the agent can't tell which model it is, it omits the model name
  rather than guessing. For Claude sessions the line is `Co-Authored-By: Claude <Model> <noreply@anthropic.com>`,
  followed by a `Claude-Session:` line; the Anthropic address and `Claude-Session:` are specific to Claude sessions.
  Other agents (e.g. Codex) use their own name, model and vendor address (none if they have none), and no
  `Claude-Session:` line. Coordinators pass subagents only the session link and the PR/comment footer, never their
  own `Co-Authored-By` line.
- Loops (each tick of a scheduled task runs one skill, with its state in PR comment markers):
  - Review: `pr-fix-loop` (the Opus `pr-fixer` reviews each PR, fixes up to 5 mechanical findings itself or holds the
    PR for its author, then a Sonnet fix-check of the fixes against the whole PR, then it merges), or the older
    `pr-review-loop` (holds a PR on any finding, merges after a follow-up review shows them fixed).
  - Author: `dev-loop` implements the next ready entry of the named BACKLOG.md lists, answers a HOLD on its open PR,
    or skips.
- Hand reading long test and bench outputs (failing `npm run check`, sweep/bot logs) to `log-reader`; don't read
  them in the main context. Short checks (pass/fail summary line, bench hashes) are fine to read directly.
- Start long runs (sweeps, bot batches) with the Bash tool's `run_in_background` in a call of their own, never
  `nohup … &` inside another command: tracked tasks show up for the user and notify on exit,
  so there's no need to poll or guess with timed wakeups.
- Sweeps of more than a few seeds go to `npm run sweep:remote`: GitHub's runners do the work in
  parallel shards, so the session's cores stay free and no worker session is needed. It sweeps the committed HEAD,
  pushed or not, through a throwaway `sweep/*` branch the workflow deletes. Start it with `run_in_background` (~10 min for 20 seeds);
  the summary prints when it finishes. Local `npm run sweep` stays for quick checks and offline work.
- After publishing an artifact, unwatch it.
