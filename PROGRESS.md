# PROGRESS.md

Current status, milestones, active decisions and open questions for **GOAL MODE**. Update at the end of a working
session. **Work ready to pick up is in [BACKLOG.md](BACKLOG.md)**, not here: nothing in this file is a task to start.
Completed implementation details, superseded decisions, playtest rounds, sweep rows and maintenance notes are in Git
history: `git log -p -- PROGRESS.md`. The dated notes up to 2026-11-16 were deleted by the commit "PROGRESS: delete
dated history (CL-42)"; read them at its parent. Older full trackers: `1d9d5a2:PROGRESS.md`, `3fd1762:PROGRESS.md`.
Design: [SPEC.md](SPEC.md). Research and citations: [docs/research.md](docs/research.md).

## Current status

Recent work, one line each (details in the PRs and Git history):
- 2026-11-16: PROGRESS history deleted (CL-42).
- 2026-11-15: codebase survey filed as BACKLOG `cleanup` CL-11 … CL-45 (#362).
- 2026-11-15: RCA truth: RT-13 proof recipes (#357), RT-14 card footprints (#359), RT-15 grouping by cause (#361).
- 2026-11-14: cross-report invariant suite, 43 identities per scenario (#347); RF-05 … RF-08 and CL-10 filed.
- 2026-11-14: agent instructions pruned of incident notes (#355); PR-04 … PR-08, PR-10 UI fixes (#348–#352, #358).
- 2026-11-13 … 11-14: RT-10 and RT-11 pin sources (#344, #345); RT-08 capping as share of the hour (#342); RT-25
  validator (#341).
- 2026-11-13: `wlm-truth` closed (WT-11, WT-12, WT-16, WT-17; WT-14 dropped); docs/wlm-design.md is the living design.
- 2026-11-10 … 11-12: WLM policy adjustment rebuilt (WT-04 … WT-10, RF-03) and lookup plans (CL-05, CL-06); milestone #340.

- **Phase:** M0–M7 and M8.9 complete; M8 follow-ups remain. The M9 hold was lifted on 2026-10-26;
  simplified mode is planned (requirements below).
- **Held for the user:** the finance feedback loop, the full-day tutorial, M9. Proposals are under "Proposals awaiting
  the user" in Remaining work; none is implemented.
  The 27-card event deck is complete; add events only if a playtest asks for them.
- **Published builds** (republish on request):
  - **Release (main):** [artifact](https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv) (sharing is "anyone with the
    link"), "GOAL MODE (release · main 0008a76)", rebuilt 2026-11-10 from `main` at `0008a76` (merge of #260).
  - **Preview (dev):** [artifact](https://claude.ai/artifact/MbFdETzQXwuj87CvtiQyNW) (private until shared),
    "GOAL MODE (preview · dev a77884a)", built 2026-11-13 from `dev` at `a77884a` (#338).
- **Latest verified dev:** `71a0685` (#288); 83 test files / 913 tests pass (single-worker `vitest`, 2026-11-11).
- **Seed-42 one-day hashes (`npm run bench -- --hash`, dev `1300e69`, 2026-11-10):** Midwest `bde6d147471ece9f`;
  Harbourline `ec94548d8283d76c`; Revenue `fb563b38750d988f`. Host timings vary; use adjacent comparisons rather than
  old absolute timings.
- **Try it:** `npm run dev`; `npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1`.
  CLI reference: [docs/agents.md](docs/agents.md).

## Completed milestones

| Milestone | Delivered |
| --- | --- |
| M0–M6 | Deterministic simulation, hardware/PRSM/WLM, subsystems, batch, capping/MLC, game loop, worker UI, charts, saves, Change Desk. |
| M7 | Insight/tool tree, Monitor III and history, SMF detail, evidence/RCA, what-if, planner, alerts, automation, policies, AIOps, TFP, Finance, projects, Codex. |
| M8.1–M8.3 | Bench/sweep harnesses, difficulty presets, hints, weekends, endless/daily modes, end reports, career XP and starting unlocks. Performance and balance targets closed by user decision; regression checks remain. |
| M8.4 | Midwest, Revenue, and Harbourline scenarios with flaws/story beats; 27-card Midwest deck, scenario adaptations, draft options, 11 perks and 2 pacts. |
| M8.5–M8.6 | Tutorial, accessibility/themes/contrast, keyboard controls, sound, autosave, agent playtests and CLI fixes, draft-based Change Desk, multi-CPC views. Human/phone follow-ups remain below. |
| M8.7 | Completed researched realism fixes are recorded in SPEC §17 and docs/research.md, including the CICS_SOS EDSA storage model (#166). |
| M8.9 | Headless play CLI, three player personas, deterministic command logs, spectator mode and take-over saves. |
| Maintenance | Shared storage/content/CLI helpers (#131–#136); modular Change Desk (#137), run lifecycle (#141), Monitor III (#142); circular UI imports removed (#143). |

## Remaining work

### Design directions (user, 2026-11-05; not scheduled, still being thought through; don't implement)

**D1. Targeted fixes unlocked by a correct RCA.** An event's cheap operations fix (e.g. `MOBILE_BACKOFF` for a Db2
retry storm) is offered only once the player has pinned proof of the cause; generic levers stay open, and wrong
guesses cost something. Design, notes and user decisions: [docs/rca-design.md](docs/rca-design.md) §5 (on the truth
model of §4; Q1–Q10 in §7). Plan: BACKLOG list `rca-truth` RT-00 … RT-15 are done; next a human playtest; RT-16 …
RT-21 are parked until it; then D1 itself (RT-22 problem records, RT-24 proof-gated fixes). The retry storm cannot
yet be told from a demand surge in any report, so RT-23 researches a discriminator and its fix stays ungated.

### WLM policy adjustment audit (2026-11-10 … 2026-11-13): closed

The `wlm-truth` list is closed. Living design: [docs/wlm-design.md](docs/wlm-design.md); history:
[docs/archive/wlm-audit-2026-11.md](docs/archive/wlm-audit-2026-11.md).

### Proposals awaiting the user (written 2026-11-03; not implemented)

**P1. Finance feedback loop.** Problem: the first MLC bill closes at month end, so a player who stops by day 8 never
sees one, and a 40-day run leaves one chance to correct. `estimateMonth` (bill-to-date at current peaks) already exists
and feeds the What-if panel and the end report. Proposal, game/UI only (no sim change, goldens unchanged):
- a **weekly cost statement** in the night briefing every 7th day: month-to-date estimate, change against last week,
  the top two drivers (the LPAR and product whose peak R4HA set it, with the hour), and the projected bill if the
  current peak holds;
- an **R4HA peak alert** in the live day when a new monthly peak is set, linking to Partition Data and Finance;
- the CFO mandate is judged against the projection mid-month (a warning only); the score still uses the real bill.
Cost or trade-off: the estimate tells the player *when* a peak happened, so capping decisions get easier. Keep it a
night-briefing artefact, not a live gauge, so the player still has to go and find the cause. Validation: reader-bot
sweeps should show fewer cost-driven losses. That is acceptable if expert results don't move.

**P2. Full-day guided tutorial.** Today's day-1 tutorial (`src/game/tutorial.ts`, `src/ui/Tutorial.tsx`) has 6
stages and one judged step (F1: Db2 below its clients). Proposal: a separate "Guided day" scenario mode on Midwest seed
1, with scripted events at fixed times, in the order a non-expert should learn the reports:
1. 06:00 morning check: SYSINFO → WLMGL (read a PI, find the red class);
2. 09:30 CPU contention: DELAY → PROCU, then fix it with a classification change through the Change Desk;
3. 12:00 Db2 dependency (F1, the existing judged step);
4. 14:00 a CICS short-on-storage message: Ops Console → SMF CICS storage → EDSALIM or MXT;
5. 17:00 batch window: critical path and initiators;
6. night: read the bill (ties in with P1).
Each step is data in `src/content/` (trigger, the report to open, a success predicate over existing state, a hint
ladder). Steps never auto-fix anything, and every step accepts more than one valid fix. Cost: about 2–3 PRs (content
and engine, UI, playtests). Risk: the scripted events must not leak into normal runs (a separate scenario flag).

**P3. M9 simplified mode.** Requirements are already listed under M9 below. Suggested order, each step on
`feature/simplified-mode`:
(a) bundle data model plus 3 bundles built on existing Change Desk commands, with undo as a unit;
(b) the run-start mode switch and a bundle panel beside the full policy editor;
(c) plain-language incident summaries generated from the existing alert/evidence data;
(d) a bundles-only bot and sweep against the textbook bands;
(e) the simplified tutorial, reusing P2's step engine.
Decision needed: whether P2 lands first (the step engine is shared) and whether simplified mode is a difficulty
level or a separate toggle.

### M8.1 Performance

- Worker budget is ≤ 4 ms/tick.
- Revisit performance when measured sweep cost warrants it.
- Same-host, reverse-order three-day comparisons across five revisions found current totals ~28% above M8.1
  closure for Midwest and ~47% for Harbourline. The older revision also slowed on this host, so the reported
  doubling is not all attributable to code. Profiles show distributed growth, including RMF.
- PR/SM pool plans already cache configuration-only work, including entitlement, by CPC and LPAR-array identity.
  A separate entitlement index showed no consistent day-level speedup across all three scenarios and was
  discarded. Configuration edits must replace those objects; in-place mutation can leave cached plans stale.
  Shared preparation is the first conditional simulation prototype; no full LPAR plan yet. Numeric-kernel work
  requires measured ≥15% end-to-end savings and removal of the old production path in the same milestone.
  Bot bundling (~0.18 s startup/run) is deferred; `advanceBatch` stays shelved.
- Option 1 of [docs/headless-performance-options.md](docs/headless-performance-options.md) (a lookup plan per
  config, hash-neutral) is scoped as BACKLOG `cleanup` CL-05 (profile, dispatch and demand; with a stop rule) and
  CL-06 (step, policy adjustment, RMF), 2026-11-10. It should land before the `wlm-truth` core changes the hot path.
  Option 2 (mutable engine, in-place accumulators) waits for a user decision; option 3 for a re-profile.
- CL-05 (2026-11-10): lookup plan `src/sim/core/tick/plan.ts`; dispatch and demand by index; image evaluator inputs
  built once per tick. Hash-neutral. Same-host paired 3-day medians: Harbourline −6.3 % (11 pairs), Midwest −6.6 %,
  Revenue −13.8 % (5 pairs); passes the 5 % stop rule, so CL-06 is ready. Results in docs/headless-performance-options.md.
- CL-06 (2026-11-11): CICS region topology once per plan; step and capping/policy stages read the plan. Against CL-05:
  Harbourline −3.7 %, Midwest −7.6 %, Revenue −6.9 % (7 pairs each). The re-profile puts `evaluateLpar` as the largest
  remaining share (25–27 %): option 3's trigger. Option 2 (RMF/state copying, ~13 %) still waits for the user.
  Option 1 in total: about −10 % Harbourline, −14 % Midwest, −20 % Revenue. Leftovers (classification results and
  period indices in the plan, two commands the plan test lists but never runs) are BACKLOG CL-07, measure-first.
- Evidence and current proposal: [docs/headless-performance.md](docs/headless-performance.md), raw results in
  [docs/performance/](docs/performance/). Preserve pure snapshots and exact hashes for optimizations.

### M8.2 Balance harness & targets

- Balance targets closed on 2026-10-27. Sweeps are regression checks: CI uses 5 seeds; use 20 to confirm
  balance-affecting changes. Textbook's day-27/28 batch wall is intended pressure, not a tuning target.
- Latest reference, WT-16 correction (2026-11-13, model `624c8bb`; remote, Normal, seeds 1–10): do-nothing /
  textbook median day, expert victories: [Midwest](https://github.com/piconaut/goal-mode/actions/runs/43397599539)
  16.5 / 28 / 10, [Revenue](https://github.com/piconaut/goal-mode/actions/runs/43397617988) 20.5 / 27 / 10,
  [Harbourline](https://github.com/piconaut/goal-mode/actions/runs/43397637534) 10.5 / 30 / 7. All inside the CI
  bands. I13: S-1 … S-3 quick reversals 1/0/8, accepted by the user (2026-11-13, #331).
- Latest 20-seed reference, WT-15 (2026-11-13, `dd52ba8`): [Midwest](https://github.com/piconaut/goal-mode/actions/runs/43381673208)
  17 / 27 / 20 of 20, [Revenue](https://github.com/piconaut/goal-mode/actions/runs/43381709546) 20.5 / 27 / 20 of 20,
  [Harbourline](https://github.com/piconaut/goal-mode/actions/runs/43381747813) 10 / 31 / 15 of 20 (expert losses
  all trust; textbook wins 2 of 20).
- Nonblocking follow-ups: Revenue textbook day-22 PREFILL losses; Hard Harbourline expert has no victories
  in the recorded sweep before its $1.6M budget; Story Midwest textbook reaches the batch wall, while
  Story Harbourline textbook wins 18/20. Recheck before drawing new tuning conclusions.
- Per-entry sweeps (WT-04 … WT-16, RF-03) are in their PRs and Git history.

### M8.4 Content and M8.6 playtesting/progression

Roadmap, not scoped: these become BACKLOG.md entries once designed.
- Human UI playtest; check the phone-width setting rows (currently scroll within panels).
- Additional scenarios: Continental Insurance (requires IMS model), Global Airline (24×7, two sites/GDPS).
  Revenue is already playable. Each new scenario needs its own flaw list and story beats (SPEC §13.3).
- Widen draft/starting perks, each with a cost or trade-off and data in `src/content/`.
- Expand career unlocks: scenarios, starting tools, cosmetic titles and further levels. Current career has
  seven levels, starting perks, and Report Class Hoarder at level 7; scenario unlocks remain open.

### Playtest rounds 1 and 2 (2026-11-03, 2026-11-04)

Details are in Git history; open findings are BACKLOG.md entries (source "playtest round 2").

### M8.7 Realism fixes

Completed fixes are recorded in SPEC §17 and docs/research.md (details: `3fd1762:PROGRESS.md` and the PRs). Queued
model changes go to BACKLOG.md list `realism-fixes`; model changes need updated goldens with a "Behaviour change"
note, re-sweeps, and the relevant SPEC §5/§17 updates.

### Realism audit loop (2026-11-02) — stopped after round 8

[Durable record](docs/audit-loops/2026-11-02.md). Round 8 (Midwest seed 23) found two contained mismatches, both
fixed and merged in #145: shared CICS Honor Priority now applies per region (all served classes must say NO,
WLM Planning 3.1 p.122), and WLMGL APPL% CP includes IIPCP (RMF 3.1 p.534). Rounds 9 (Harbourline seed 29) and
10 (Revenue seed 31) were planned but never ran; they are **not** scheduled. Restart with `/audit-loop` after the
playtest if wanted.

### M9 — Simplified mode (after M8; user request 2026-10-20)
Goal: the same simulation, made approachable for players who aren't z/OS experts. Nothing in `src/sim`
changes; simplified mode is a game/UI layer over the same commands, reports and scoring.
Hold released by the user on 2026-10-26 (was: don't start until told, 2026-10-20). Do all M9 work on a separate
feature branch (e.g. `feature/simplified-mode`), not on `main`.
- Mode switch at run start (Expert / Simplified); same seed gives the same world in both modes
- Keep the full WLM policy definition visible and editable, but offer **goal-level actions** that bundle
  the discrete changes an expert would make, e.g. "Protect mobile banking from ad-hoc queries" = new service
  class + classification rule + report class; "Protect the critical batch path" = BATCHHI rule for critical jobs
  + initiator change; "Stop dev from stealing production CPU" = DEVT weight/logicals + soft cap. Each bundle
  shows the exact changes it makes (expandable), its cost and trade-off, and can be undone as a unit
- Bundles are data in `src/content/` (preconditions, the change list, explanation, Codex links), built
  from the existing Change Desk requests so cost, change risk and the change freeze still apply
- Plain-language summaries of reports and incidents ("mobile is slow because it waits for CPU behind
  batch") with the raw RMF view one click away; fewer, friendlier Monitor III views
- Diagnosis stays the gameplay: symptoms → suggested bundles (more than one valid fix), not auto-fixes
- Balance: bots in simplified mode (bundles only) reach roughly the textbook bot's results
- Tutorial for simplified mode; Codex entries linked from each bundle

## Active decisions and conventions

- Batch response-time goals (user decision 2026-11-13, WT-12): a fair few installations use them despite IBM's
  advice, and players may want to try them, so they stay supported and modelled; the editor warns, it doesn't forbid.
- RCA baselines (user decision 2026-11-15, #359 review B1): `disturbed` stays footprint-based, so collateral work's
  baseline also freezes while a card reaches it. If a playtest shows odd mechanisms first, the fallback is to freeze
  collateral work only for narrow reaches, not sysplex-wide ones.
- Legacy save compatibility (user decision 2026-11-16): old browser saves and play files need not load. Delete the
  fallbacks that exist only for them (CL-20, CL-21) and give saves a format version, so an older file fails with
  one clear message rather than loading half-migrated.
- The WT-06 ladder test (`tests/sim/wlm-realism.test.ts`, Midwest to D8 12:00, ~49 s) stays as it is for now (user
  decision 2026-11-16), even though it is the slowest test; test-time work (CL-11 … CL-16) leaves it alone.

- Realism checks (user request 2026-11-05): work and reviews touching z/OS behaviour or report content use the
  `zos-docs` skill and cite book + page (CLAUDE.md "Realism policy"; `pr-reviewer`/`realism-fixer` have the Skill tool;
  PR template has a "Realism check" section).
- Backlog (user request 2026-11-09): [BACKLOG.md](BACKLOG.md) is the only list of work agents pick up, in named
  lists (`playtest-fixes`, `pr-followups`, `realism-fixes`, `cleanup`) with status, priority, size and area per
  entry. This file keeps status, milestones, decisions, design directions, proposals and open questions, none of
  which is work to start until it is scoped into a BACKLOG entry. The PR that fixes an entry deletes it. Why: the
  old tracker mixed ready fixes with held designs and questions, so an agent told to "work through PROGRESS"
  couldn't tell them apart. Migrated 2026-11-09 from `3fd1762:PROGRESS.md`.
- Architecture, deterministic simulation rules, units, validation, and contribution workflow are in
  [CLAUDE.md](CLAUDE.md); design and modeling details belong in SPEC and docs/research.md.
- Real z/OS mechanics with fictional tunable numbers; no real LSPR/MSU/pricing data. Tick = 10 sim-seconds;
  played day = 06:00–06:00; standard run ≈40 business days with weekends auto-simulated.
- Game randomness uses independent keyed streams for events, drafts, failures, AIOps, and inquiries.
- Diagnosis is the gameplay. Tools reveal data and cost CPU; every lever has a cost or trade-off. Starts have
  15 insight; RCA guessing may pay; GOODWILL stays +4 trust across stakeholders (accepted user decisions).
- Change Desk settings draft in place and submit as one request. Hours are per change; emergency trust/failure
  risk are per request. Operations and hardware orders keep one-click actions.
- Harbourline's outgoing analyst handover mail was removed at the user's request; PRDA's absolute cap has no
  day-0 inbox clue or day-1 trust grace. HMC and Partition Data expose it. This supersedes the older handover decision.
- Realism audit loop: paced audit → main-agent vetting → isolated fix → scenario sweeps; one golden-changing
  PR at a time. Agents/host adaptations: [AGENTS.md](AGENTS.md), [docs/codex.md](docs/codex.md), `.claude/agents/`.

- PR review (user request 2026-11-04): a scheduled task starts a fresh session per tick (no longer strictly hourly,
  commit 6040718) that runs `.claude/skills/pr-review-loop/`. First pass merges only a PR with no findings at all; a held PR merges once a
  follow-up review shows every earlier finding fixed and nothing new blocking; second-pass non-blocking leftovers
  go to BACKLOG.md list `pr-followups`. State is the hidden `pr-review-loop` marker in each review comment.
  A follow-up whose earlier findings were all non-blocking is reviewed on Sonnet instead of Opus (user request
  2026-11-05).

- Reviewers don't repeat CI (user request 2026-11-06): `pr-reviewer` (and `pr-fixer`, which follows its checks)
  no longer runs `npm run check` while reviewing; CI's required `check` job runs it on the merge ref, so the review
  reads that result and the failing lines from its log. Kept because CI doesn't cover them: bench hashes (Harbourline
  isn't in the goldens; determinism double-run; timing), the 10-seed review sweep (CI runs seeds 1–5 on the merge
  ref), `vite build`, and `pr-fixer`'s pre-push `npm run check` (guards pushes to someone else's branch).

- Remote sweeps (user request 2026-11-06): `.github/workflows/sweep.yml` runs `npm run sweep` on GitHub's runners,
  sharded by seed range (default 2 seeds per job, at most 10 jobs; free for a public repo), on a push to `sweep/**` or
  by workflow_dispatch. `npm run sweep:remote` (any agent or human with `gh`) pushes a throwaway commit (the swept
  commit's tree plus the current sweep workflow, args in a `Sweep-Args:` trailer), waits and downloads `sweep-result` to
  `runs/remote/<sha7>/`; the workflow deletes the branch afterwards. Arguments are whitelisted (`tools/ci/sweepPlan.ts`).
  `audit-loop` balance sweeps use it instead of Sonnet worker sessions. Why: a 20-seed sweep takes ~30 min on a
  session's 4 cores and starves other work (measured: 20 seeds × 3 bots of `dev` 1ec5957 in 17 min with 4 shards of 5 seeds and 8 min with 10 shards of 2, identical results both ways, every bot inside its band); a worker session costs tokens just to start and report.

- Remote tests (user request 2026-11-12): `.github/workflows/test.yml` runs `npm test` (vitest) on GitHub's runners,
  in one job, on a push to `test/**` or by workflow_dispatch. `npm run test:remote` mirrors `sweep:remote`: it pushes a
  throwaway commit (the tested commit's tree plus the current test workflow, args in a `Test-Args:` trailer), waits, and
  downloads `test-result` to `runs/remote-tests/<sha7>/`; the workflow deletes the branch afterwards. `--suite` (test
  directories) or `--filter` (filename text) narrows the run through `tools/ci/testPlan.ts`; the Vitest JSON report
  becomes one summary (`tools/ci/testReport.ts`); the run fails when a test or a whole test file fails, no report was
  written, or nothing ran. Why: the full suite is CPU-bound, and a shared session's cores are often busy with another
  session's sweep or repro, so `npm test` hits its 10 s hook and 30–120 s test timeouts and reports false reds (two
  `npm run check` runs on 2026-11-12 timed out in heavy game/tools tests while another session held the cores; the same
  files pass on a quiet box). Runners give a quiet, reproducible budget and keep the session free. CI's `check` job
  still gates PRs on the merge ref: this is for running the suite on a committed ref without a PR or a session's cores,
  e.g. a long golden-changing branch or a PR head you don't want to wait on.

- Review-and-fix loop (user request 2026-11-06): `.claude/skills/pr-fix-loop/` with the Opus `pr-fixer` agent, as a
  cheaper alternative to `pr-review-loop` (no author round trip, no second full review). Gate before fixing: 1–5
  findings, all mechanical (tests, docs, citations, local bugs, conflicts); anything that changes the PR's intent,
  balance, bench hashes or needs a design call holds the PR for its author with no partial fixes. Fixes must keep the
  PR head's bench hashes. A Sonnet fix-check of the fix commits replaces the second review; fixes over 150 lines
  get a full Sonnet review instead. Two failed fix-checks hold the PR. Label a PR `no-autofix` to keep it out.
  Open: compare cost per merged PR against `pr-review-loop` over a week before retiring it.
  Fix-check widened (user request 2026-11-09): it reads the fix commits against the whole PR diff at the fix head,
  checks each fix cures the cause (not a test bent to fit) and that the triage held, and reports blocking `Missed:`
  items as a FAIL. Why: the same agent finds, triages and fixes, so the fixes got the weakest review.

- Codex native `pr-fixer` role (user request 2026-11-11): `.codex/agents/pr-fixer.toml` now adapts the existing
  `.claude/agents/pr-fixer.md` brief for `pr-fix-loop`, registered in `.codex/config.toml`. It uses `gpt-6.1-sol`
  at high reasoning; a fresh Codex session still must verify native role selection before relying on it.

- Codex branch-workflow guard (user request 2026-11-11): `AGENTS.md` now states directly that every repository
  change goes through a task branch and PR into `dev`; "merge into dev" means open that PR, not a direct push.
  Auto-merge still needs explicit user authorization, as do any bypasses of the PR workflow.

- Dev loop and review loop take turns (user request 2026-11-09). On a `dev-loop` PR, the latest review marker
  decides who acts. No marker, MERGE, FIXED, or a fix-check under way: the review loop's turn. HOLD: dev-loop's turn,
  until it pushes or posts a `dev-loop-response` comment. pr-fix-loop still fixes mechanical findings on `dev-loop` PRs
  itself, so only HOLDs make the round trip. Both push fast-forward only, so a rare overlap fails one push and that
  side retries next tick. Reviewers reject a `dev-loop` PR that doesn't fix a ready BACKLOG entry (pr-reviewer check
  10, the backlog rule), and dev-loop closes a PR held on it.

- Manage Region Using Goals Of is fixed at TRANSACTION for the player (user decision 2026-11-05): the sim keeps
  REGION/BOTH (lab, tests); the Rules view drops the column and `playerWlmEditError` refuses `SET_RULE_REGION_MODE`
  in the worker and play CLI. All three scenarios start at TRANSACTION (`tests/game/scenarioRegionMode.test.ts`).

## Branch workflow

- **Dev loop (user request 2026-11-09; replaces the 2026-11-04 playtest fix loop):** a scheduled task runs
  `/dev-loop <list>` (`.claude/skills/dev-loop/`). Each tick does one of three things: it implements the next ready
  entry of the named BACKLOG.md list(s) and opens a PR labelled `dev-loop`; it answers the review loop's HOLD on that
  PR; or it skips. One `dev-loop` PR is open at a time (`needs-user` ones aren't counted). Branches are
  `dev-loop/<ID>-<slug>`. It never merges, enables auto-merge or force-pushes; the review loop merges. When the lists
  have no ready, unclaimed entry left, it disables its scheduled task. An invalid or missing list does nothing.

- **PRs to `main` (user request 2026-10-21):** open a PR `dev` → `main` at sensible milestones: a PROGRESS item or
  milestone ticked done (e.g. a scenario playable and swept, a model feature with goldens and sweep recorded), not for
  docs-only or in-progress work. Before opening: `npm run check` green, bench hash recorded, PROGRESS updated. Body:
  what changed since the last merge to `main`, test count, hashes, sweep results, anything waiting on the user. At most
  one open `dev` → `main` PR; later pushes to `dev` update it, so retitle/re-describe it instead of opening another.
  The body also needs a "## Behaviour change" section listing the golden changes since the last merge to `main` (CI
  `behaviour-note` gate). Each one gets a `pr-reviewer` review (base `main`, head `dev`), which it also posts on the PR
  as a reference comment. When the verdict is MERGE and all required checks are green, merge it with a **merge commit**
  (not squash, so `dev` and `main` keep shared history); otherwise fix or comment. No human approval is needed (user
  decision 2026-10-26). NEEDS USER verdicts go to the user.
- **Branch workflow (user request 2026-10-23):** each session works on its own branch cut from `dev`, opens a PR into
  `dev`, and the review loop merges it once reviewed and green (no auto-merge by default, user request 2026-11-09). CI (`.github/workflows/`): `check` (typecheck + all tests,
  goldens included); `behaviour-note` (a PR that changes `tests/golden/hashes.json` needs a filled-in
  "## Behaviour change" section, see the PR template); `perf-hash` (a PR labelled `perf` or titled "perf…" must keep
  the Midwest and Harbourline 1-day bench hashes of its base); `balance` (when goldens change: donothing/textbook/expert
  over seeds 1–5 must stay inside the loose bands in `tools/ci/balanceGate.ts`). After a rebase that conflicts on
  `hashes.json`, regenerate it with `UPDATE_GOLDEN=1`, never merge it by hand. Run one golden-changing PR at a time.
  GitHub settings (user): default branch `dev`; protect `dev` and `main` with these four checks required; allow
  auto-merge; delete head branches on merge. `main` requires the same checks but no approval: GitHub records Claude's
  PRs as authored by the user, who can't approve their own PR (user decision 2026-10-26).

## Open questions

- Settled research (sysplex routing and capping, 2026-10-26, and everything earlier) is in `docs/research.md`. Only
  open items stay here.
- Change Desk balance: trust and fail risk are paid per request, and the change request banner makes batching every
  edit into one request the default. Bots send commands directly, so sweeps can't see this; check in a playtest whether
  emergency trust costs now bite too little.
- Change Desk drafts don't notice a live value changing under them (e.g. a CF fails): the draft stays as typed. Add a
  "now X" check that drops drafts already satisfied, if playtests trip over it.
- CICS transaction classes with velocity or multiple periods: the editor now warns (WLM Planning says "not supported"),
  but the sim still splits such work like DDF. IBM documents no runtime behaviour for this case; model it if a source turns up.

- CICS_SOS (2026-11-03): EDSALIM raised to the max before the card is cheap insurance; should a large EDSALIM carry a cost (real storage, or a later abend when a leak finally exhausts it)?
- Period switching sums CP and zIIP seconds × SU/s without normalising zIIP time to CP speed (APPROX). Looked for in
  WLM Planning on 2026-11-10 ("normaliz", specialty processor service units) and not found; still open.
- WLM audit 2026-11-10: the questions on secondary receivers and donors, a region class as receiver, equal-DP
  sharing, percentile PI with few completions and backlog in projections are settled in
  docs/research.md ("WLM policy adjustment and dispatching") and docs/archive/wlm-audit-2026-11.md §4 W15; their fixes are WT entries.
- WLM audit: the numbers behind receiver value, the net value rule by importance and the 0.90 credit come from IBM's
  1994 patent (page-checked 2026-11-10, US 5,473,773 p.18–20) and Peter Enrico's slides; IBM's z/OS books state the
  tests without numbers, so they are the original design, not confirmed for z/OS 3.1. The skip clock's length, where the unbunched ladder sits in the
  managed range, and the priorities assigned at IPL or policy activation are not documented anywhere found.
- WLM audit: the dispatching priority table differs between SG24-7621 (252–208 managed) and SG24-6472 (247–203 as of
  z/OS 1.8); no z/OS book gives numbers (docs/archive/wlm-audit-2026-11.md W12, §8 Q5).
- CICS: does WLM/RMF response time include MXT queue time? Currently treated as outside the work
  manager (like DBAT queueing before enclave creation). Verify against CICS performance docs.
- TFP details (baseline commitment, overage pricing) are left deliberately abstract; is
  that enough for the strategic choice to feel real?
- Tuning target for "fun density": how many meaningful decisions per live day? (Target: 3–6
  alerts that matter, 1–2 incidents in Act II+.)
- Exported saves arriving with every backslash doubled (playtest round 2, D20 export): halving them gives exactly what
  `encodeRunJson` writes, so something on the artifact host's download path doubled them (not verified). Import
  (browser and play CLI) repairs it. If it recurs, look at how the artifact host saves a Blob download.
- Retry storm against real demand (RCA audit 2026-11-09): what does an analyst read to tell client retries from a
  campaign? Candidates are rolled-back or abnormally ended DDF threads in Db2 accounting or statistics and connection
  timeouts; a first search of Db2 13 Managing Performance did not confirm a field. BACKLOG RT-23.
- Resource-group capping as an RCA mechanism: WLMGL CAP delay is resource-group and discretionary capping (RMF Report
  Analysis p.540), so should a class held by a resource-group maximum be judged `CAPPING` (docs/rca-design.md §4.3
  proposes yes, with the help text widened from "the image" to "the image or the class")?
- zIIP shortage as capacity: the CPU split measures general CPs only. Whether a full zIIP pool with CP white space
  under IIPHONORPRIORITY=NO is "capacity" or "policy" is a game-rule choice (docs/rca-design.md §4.3 treats it as
  policy); no IBM source decides it.
- Waiting on the user: docs/rca-design.md §7 Q7, Q8a, Q8b, Q9 (after the RT-15 playtest); docs/archive/wlm-audit-2026-11.md §8
  Q1–Q9 are decided (2026-11-10). #111 Q1–Q3 are decided.

## Known approximations and risks

- Per-AOR QR busy is not shown in SMF 110 (QR is per LPAR); policy overrides are whole-policy swaps.
- Dispatch approximations: partially hosted resource-group slices can over-restrict outside-group zIIP overflow;
  conversion from effective execution to physical busy/MSU retains the full grant's efficiency (SPEC §17).
- Discretionary capping ignores recent receiver/donor status; TSO users are not swappable address spaces;
  homogeneous report classes are not split into periods; TFP unused baseline has no rollover.
- Modeling/reporting limitations and researched facts belong in SPEC §17 and docs/research.md.
- CICS reporting: AORs on one system show identical SYSWKM figures (CICS work is modelled per system, not per
  region); WLMGL shows every state, with no BTE row, ACTIVE SUB/APPL split or state-switched samples.
- Opaque cause/effect remains a playtest risk: keep clue paths, WLM logs, hints and Codex explanations usable.
  Balance changes need bot/golden regression checks; avoid tuning against stale sweep baselines.

## Tooling lessons

- The cloud host is noisy. Compare old/new back to back; prove behavior neutrality with bench hashes.
  Avoid concurrent suites/benches that cause subprocess timeouts.
- Track long jobs and stop their exact PIDs/task sessions; broad `pgrep -f`/`pkill -f` patterns can match themselves.
- `npm run compare` (2026-11-03) backs "report-only" / "pure refactor" claims: sim state with reporting excluded, game
  state, log, every RMF report's text and records, Monitor III views, base vs head in worktrees (~20 s for three
  scenarios). `play … mon3` now prints SYSWKM too; use the play CLI for report and Monitor III questions.
- Keep new session updates brief: current status, changed decisions, unresolved work, and latest validation.
  Use commit/PR links for completed detail rather than rebuilding a chronological transcript.
- zos-docs searches (2026-11-12): map hits with `pdf_find.py --grep … --pages-only` before reading, never cut search
  output with `head`, read the section that owns the topic (hit page ±1) and search in the book's words as well as
  the user's. A WLM answer missed ieaw100 3.1 p.61 ("no goals for CICS ⇒ region velocity goals") because the
  page says "address spaces", not "region", and the truncated hit list hid the pages around it. Rules in SKILL.md §3.

## Latest maintenance

Short dated notes on recent work, newest first. Older notes are in Git history.
