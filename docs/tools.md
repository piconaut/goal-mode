# Tools and commands

Every npm script and headless tool in the repository, with what it is for. The everyday ones also sit in
[`CLAUDE.md`](../CLAUDE.md) so a session sees them without loading this file; this page is the full list, and it is
the place to keep accurate when a script changes.

## Commands

```
npm install
npm run dev          # Vite dev server
npm run build        # typecheck + vite build → dist/ (static host, any sub-path)
npm test             # Vitest (unit + realism + golden)
npm run test:watch   # Vitest in watch mode
npm run typecheck    # tsc --noEmit
npm run check        # typecheck + tests (no lint script yet)
npm run bench -- --hash [--scenario harbourline]   # 1 headless day, timing + end-state hash (must not change for pure optimisations)
npm run bench:pair -- --base origin/dev [--head <ref>] [--mode sim|live] [--scenario harbourline]   # warm both revisions, alternate timed blocks, compare timings and hashes
npm run profile:summary -- [--limit 20] <profile.cpuprofile> [<profile.cpuprofile> ...]   # rank functions by self time and inclusive time
npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1   # headless sim + RMF reports
npm run lab -- a.json b.json   # realism lab: A/B runs from JSON specs, side by side per RMF interval (format in tools/lab.ts; example specs in tools/lab-examples/)
npm run bot -- --bot donothing|textbook|expert|spendtowin|oraclerca --seed 42 [--tfp sign] [--difficulty story|normal|hard|ironman] [--reader] [--spectate runs/bot.json --pace 2]   # full runs with strategy bots
npm run bot -- --bot expert --scenario harbourline --seed 9 --days 29 [--changes] [--trace-day 29] [--dump 'PRDA D29 10:0'] [--tune rejectedSkipTicks=0]   # investigations: the bot's changes; one day's WLM an hour at a time (moves, outcomes, SLA, DPs); every candidate and trial of matching adjustments; POLICY_ADJUST overrides (tools/tune.ts; not balance)
npm run sweep -- --bots donothing,textbook --seeds 1-20 [--jobs 4] [--difficulty hard] [--resume] [--reader] [--tune k=v,...]  # bots over many seeds in parallel → CSV + summary; --resume continues a killed sweep from <out>.partial.jsonl; --reader adds a player who reads 5 reports/day and buys tools
npm run sweep:remote -- --bots donothing,textbook,expert --seeds 1-20 [--scenario harbourline] [--difficulty hard] [--tune k=v,...] [--shards 4] [--no-wait]   # same sweep on GitHub Actions, sharded by seed, on committed HEAD (no PR); waits, then runs/remote/<sha7>/summary.md + sweep.csv; --fetch <sha> (full, or 7+ chars of a recent run) collects a --no-wait run
npm run test:remote -- [--suite golden,game,sim,tools,ui | --filter <text>] [--no-wait]   # vitest (`npm test`) on GitHub Actions in one job, on committed HEAD (no PR); waits, then runs/remote-tests/<sha7>/summary.md; --fetch <sha> collects a --no-wait run
npm run play -- runs/a.json new 42 | status | start | advance 3 | report WLM_SUMMARY   # headless play CLI for agents (docs/agents.md)
npm run play -- runs/a.json mon3 [system] [--json] [--at D2 10:40]   # Monitor III now or past: SYSINFO, CPC, DELAY, PROCU, ENCLAVE, SYSWKM, WFEX (text or --json); use it instead of ad-hoc scripts
npm run play -- runs/a.json finance | capacity | batch   # bill and TFP pace per product (overage $/MSU-hour by LPAR); CPC MSU, LPARs, initiators, capacity changes; last batch night by stream
npm run inspect -- runs/a.json dp PROD1 [--class ONL] [--from 'D19 20:00'] [--to 'D20 06:00']   # sim internals the player can't see (DPs per RMF interval): investigations only, never in player agents
npm run inspect -- runs/a.json wlm PROD1 --at 'D19 22:00' [--ticks 6] [--class ONL]   # why WLM did or didn't move DPs: receivers in order, each trial and its verdict (play-CLI files replay to any past time; a browser save replays any time in its current live day)
npm run inspect -- runs/a.json blame [--json] [--incident N] [--floor <pp>]   # counterfactual validator (RT-06, RT-25): replay each online incident's opening hour once per card active in it, with the card ended at the hour start; report each card's attainment gain against a noise floor measured from red-herring cards, and the RT-06 verdict (removal met the SLA) beside it. Offline only (an hour of sim per card per incident); needs a play-CLI file
npm run inspect -- runs/a.json wlm-stats [system] [--from 'D1 06:00'] [--to 'D3 06:00'] [--ladder '12:00'] [--by-class] [--episodes] [--moves] [--json]   # policy adjustment statistics over a range (WT-01, the 2026-11 WLM audit's S-table, docs/archive/wlm-audit-2026-11.md §1): adjustments, candidates by outcome, trials by verdict, accepted and reversed moves, receivers assessed 30 adjustments without a move, and the DP ladder at a clock time; --by-class per period, --episodes lists the 30-assessment runs, --moves every accepted move. Needs a play-CLI file
npm run repro -- runs/s2.json S-2 | --scenario midwest --days 8 [--seed 42] [--difficulty normal]   # hands-off play-CLI file (start, advance 24 to day end, draft none): S-1 Midwest 2 days, S-2 Revenue 3, S-3 Harbourline 3, for inspect wlm / wlm-stats / blame
npm run compare -- [--base origin/dev] [--head <ref>] [--scenarios a,b] [--drop k1,k2]   # behaviour diff vs base: sim state (reporting excluded), game state, log, RMF report text/records, Monitor III views; exit 1 on any difference
npx vite build && npx vite preview --port 4173 &                  # then:
node tools/screenshot.mjs <outDir>                                 # headless UI screenshots
npx tsx tools/ci/behaviourNote.ts origin/dev     # CI gate: goldens changed ⇒ PR body needs "## Behaviour change" (PR_BODY env)
npx tsx tools/ci/citations.ts origin/dev         # CI gate: page citations on added lines are labelled `PDF p.N (printed M)` and match their #page= links
npx tsx tools/ci/balanceGate.ts runs/ci-sweep.csv 5 [scenario]   # CI gate: bot sweep inside balance bands (victories as a share of runs) (see .github/workflows/ci.yml)
# In `npm run dev` builds, globalThis.__goalMode.send(msg) talks to the worker (DEV_INSIGHT, DEV_FAST_DAYS, DEV_TFP_OFFER).
```

`tools/lab-examples/` holds example lab specs (`dc-control.json`, `dc-treatment.json`) to pass to `npm run lab`.

## Performance investigations

Use `bench:pair` to compare a change against a Git revision in one Node process. The base defaults to
`origin/dev` and the head defaults to the current working tree, including uncommitted changes. Pass
`--head <ref>` to compare two commits. The tool checks out the requested refs in temporary worktrees
and shares the current checkout's installed dependencies, so both revisions need compatible dependencies.

```sh
npm run bench:pair -- --base origin/dev --mode live --scenario harbourline
npm run bench:pair -- --base ebf6ab6 --head 2f07636 --mode sim --scenario midwest
```

- `--mode sim` (the default) calls the simulation core's `step`. `--mode live` advances a normal game day with
  no player actions, including events and hourly accounting. Live mode supports up to one day per run.
- Each revision gets 2,160 warm-up ticks by default. Each of the three measured pairs starts from a fresh
  seed-42 state and runs 8,640 ticks. Set `--warmup`, `--rounds`, `--seed` and `--ticks` to override those values.
- The revisions take turns running 120 ticks per block. Their order alternates by block and round.
  Live mode calls `advance` in chunks of up to 12 ticks within each block. Adjust the sizes with `--block` and
  `--chunk`. On Linux, prefix the command with `taskset -c <cpu>` to pin the process to one CPU.
- Read the individual pairs and the median paired wall-time and CPU-time changes. The end-state hashes
  flag output changes while allowing timing comparisons across revisions that intentionally change state.
  Use `--json` for the results as data and `npm run compare` for a detailed behaviour diff.

Capture a CPU profile with Node, then pass the resulting file to `profile:summary`. These examples profile
one core simulation day and one day played by the hands-off bot.

```sh
mkdir -p runs/profiles
node --cpu-prof --cpu-prof-dir=runs/profiles --cpu-prof-name=core.cpuprofile --import tsx tools/bench.ts --scenario harbourline
node --cpu-prof --cpu-prof-dir=runs/profiles --cpu-prof-name=live.cpuprofile --import tsx tools/bot.ts --bot donothing --scenario harbourline --days 1
npm run profile:summary -- --limit 15 runs/profiles/core.cpuprofile runs/profiles/live.cpuprofile
```

Self time shows where the profiler sampled a function directly. Inclusive time also counts samples in
functions it called, counting a recursive frame once per sample. The percentages are shares of sampled time.

## Where the rest of the tooling lives

- `tools/` — the headless runners above plus the strategy bots (`bot.ts`, `strategies.ts`, `tune.ts`).
- `tools/ci/` — the PR gates: `balanceGate` (`ci.yml`), `behaviourNote` and `citations` (`pr-gates.yml`).
- [`docs/agents.md`](agents.md) — the full play CLI reference and the agent roles that play through it.
