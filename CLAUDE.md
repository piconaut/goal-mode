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
  end of every working session: add decisions, note what's next. It is a snapshot, not a log (user request
  2026-11-16): keep it under 450 lines. "Current status" is one line per item (date, what, PR) for about the last ten
  days; a new sweep replaces the M8.2 reference instead of adding a row; narratives, per-PR results and investigation
  detail go in the PR body, `docs/` (e.g. `docs/audit-loops/`, `docs/playtests/`) or BACKLOG entries. A change that
  would take it past 450 lines deletes the oldest status lines in the same change; Git history keeps them.
- **`BACKLOG.md`** is the only list of work to pick up (user request 2026-11-09): scoped entries in named lists
  (`playtest-fixes`, `pr-followups`, `realism-fixes`, `cleanup`), each with a status. Implement only `status: ready`
  entries, and only from a list you were given; a vague request ("work through PROGRESS") isn't a list, so ask.
  Nothing in PROGRESS.md (design directions, proposals, roadmap, open questions) is a task until it is scoped into a
  BACKLOG entry. The PR that fixes an entry names it (`Backlog: PT-07`) and deletes it. New findings go into
  BACKLOG.md as entries (rules at its top).

## Stack and commands

TypeScript (strict) · Vite · React + Zustand · uPlot · Vitest · sim in a Web Worker · Node
headless runner for balancing. SPEC §15 has the stack plan.

Everyday commands (the full list, including every investigation and CI tool, is in
[`docs/tools.md`](docs/tools.md)):
```
npm install
npm run dev            # Vite dev server
npm test               # Vitest (unit + realism + golden)
npm run typecheck      # tsc --noEmit
npm run check          # typecheck + tests
npm run bench -- --hash [--scenario harbourline]   # 1 headless day, timing + end-state hash (must not change for pure optimisations)
npm run play -- runs/a.json new 42 | status | start | advance 3 | report WLM_SUMMARY   # headless play CLI (docs/agents.md)
npm run compare -- --base origin/dev   # behaviour diff vs base; exit 1 on any difference
npm run sweep:remote -- --bots donothing,textbook --seeds 1-20   # bot sweep on GitHub Actions
npm run test:remote    # the full suite on GitHub Actions, on committed HEAD
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
- **Cross-report invariants** (`tests/sim/report-invariants.test.ts`, SPEC §16): every figure a player can read in RMF,
  Partition Data, Monitor III, the SMF views and Finance must agree with the others and with the sim state it comes
  from, on every scenario in `SCENARIOS`. A new or changed report field joins an identity in
  `tests/helpers/reportIdentities.ts` in the same change (real z/OS behaviour with book and page, or a stated game
  rule; every tolerance with its reason; no scenario, LPAR, class or workload names). An identity that fails is a
  finding: fix a small reporting bug in its own commit, or file a BACKLOG entry and leave that identity out with a
  comment naming it. Never loosen or skip one to get green.
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
- Review comments: every review report an agent posts on a PR (any agent or vendor, any tool, a subagent or a
  coordinator) starts with a header line `Automated <role> report (reference only, not a GitHub approval)`, naming
  its role (`pr-reviewer`, `pr-fixer`, or e.g. `coordinated-review`). The loops find their reports by the exact
  `pr-reviewer` and `pr-fixer` headers, so other reviewers use another role name. Agents' comments are posted under
  the user's account, so a comment without such a header reads as the user's own decision.
- Hand reading long test and bench outputs (failing `npm run check`, sweep/bot logs) to `log-reader`; don't read
  them in the main context. Short checks (pass/fail summary line, bench hashes) are fine to read directly.
- Start long runs (sweeps, bot batches) with the Bash tool's `run_in_background` in a call of their own, never
  `nohup … &` inside another command: tracked tasks show up for the user and notify on exit,
  so there's no need to poll or guess with timed wakeups.
- Sweeps of more than a few seeds go to `npm run sweep:remote`: GitHub's runners do the work in
  parallel shards, so the session's cores stay free and no worker session is needed. It sweeps the committed HEAD,
  pushed or not, through a throwaway `sweep/*` branch the workflow deletes. Start it with `run_in_background` (~10 min for 20 seeds);
  the summary prints when it finishes. Local `npm run sweep` stays for quick checks and offline work.
- Full test runs go to `npm run test:remote` the same way (`--suite`/`--filter` narrow it, one job): it tests the
  committed HEAD through a throwaway `test/*` branch and prints one summary. A busy shared host makes the full suite
  hit its hook/test timeouts, so local `npm test` stays for quick checks.
- After publishing an artifact, unwatch it.
