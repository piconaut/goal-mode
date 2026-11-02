# PROGRESS.md

Current status, pending work, and active decisions for **GOAL MODE**. Update at the end of a working session.
Completed implementation details, superseded decisions, playtest rounds, and experiment logs are in Git history:
`git log -p -- PROGRESS.md`. The last full tracker before this pruning is at `1d9d5a2:PROGRESS.md`.
Design: [SPEC.md](SPEC.md). Research and citations: [docs/research.md](docs/research.md).

## Current status

- **Phase:** M0–M7 and M8.9 complete; M8 follow-ups remain. The M9 hold was lifted on 2026-10-26;
  simplified mode is planned (requirements below).
- **Next up:** a human UI playtest (M8.6), the two pending realism fixes (M8.7), and optional content/progression.
  The 27-card event deck is complete; add events only if a playtest asks for them.
- **Published build:** [private artifact](https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv), last recorded rebuild
  from `main` at `fbc518b` after milestone PR #129. Republish on request.
- **Latest verified dev:** #143; 57 test files / 488 tests pass. Independent reviews and CI passed for
  run-lifecycle, Monitor III, and shared-color refactors (#141–#143); no behavior or hash changes.
- **Seed-42 one-day hashes:** Midwest `58c0964974945e25`; Harbourline `c70c88eb43a9db09` (equal-DP ready units, 2026-11-02).
  Host timings vary; use adjacent comparisons rather than old absolute timings.
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
| M8.7 | Completed researched realism fixes are recorded in SPEC §17 and docs/research.md; two pending fixes remain below. |
| M8.9 | Headless play CLI, three player personas, deterministic command logs, spectator mode and take-over saves. |
| Maintenance | Shared storage/content/CLI helpers (#131–#136); modular Change Desk (#137), run lifecycle (#141), Monitor III (#142); circular UI imports removed (#143). |

## Remaining work

### M8.1 Performance

- Worker budget remains ≤ 4 ms/tick; the former ≤ 2 s/headless-day target is closed (user, 2026-10-27).
- Full-quarter sweeps run daily (user clarification, 2026-11-02). Revisit performance when measured sweep cost warrants it.
- Same-host, reverse-order three-day comparisons across five revisions found current totals ~28% above M8.1
  closure for Midwest and ~47% for Harbourline. The older revision also slowed on this host, so the reported
  doubling is not all attributable to code. Profiles show distributed growth, including RMF.
- Runner fixes landed: available-parallelism sweep defaults (#138), hourly diagnostics only on demand (#139).
  Shared preparation is the first conditional simulation prototype; no full LPAR plan yet. Numeric-kernel work
  requires measured ≥15% end-to-end savings and removal of the old production path in the same milestone.
  Bot bundling (~0.18 s startup/run) is deferred; `advanceBatch` stays shelved.
- Evidence and current proposal: [docs/headless-performance.md](docs/headless-performance.md), raw results in
  [docs/performance/](docs/performance/). Preserve pure snapshots and exact hashes for optimizations.

### M8.2 Balance harness & targets

- Balance targets closed on 2026-10-27. Sweeps are regression checks: CI uses 5 seeds; use 20 to confirm
  balance-affecting changes. Textbook's day-27/28 batch wall is intended pressure, not a tuning target.
- Latest accepted model-change sweep: Normal, seeds 1–10, `b8d835e` (2026-11-02, #111 fix 15):

| Scenario | Do-nothing median day | Textbook median day | Expert victories |
| --- | ---: | ---: | ---: |
| Midwest | 16.5 | 27 | 8/10 (seeds 1, 2: trust) |
| Harbourline | 9 | 29 | 6/10 (seeds 1, 2, 7, 9: trust) |
| Revenue | 8.5 | 28 | 10/10 |

- Harbourline's expert drop from 8/10 to 6/10 was accepted by the user: seed 1 is marginal; seed 9 crowds Db2
  out at equal dispatch priority (pending realism fix below), and the expert bot never moves Db2 above CICS.
- Historical 20-seed Normal reference (2026-10-27): expert victories Midwest 19/20, Revenue 20/20,
  Harbourline 16/20. These predate later model changes; full difficulty distributions are in Git history.
- Nonblocking follow-ups: Revenue textbook day-22 PREFILL losses; Hard Harbourline expert has no victories
  in the recorded sweep before its $1.6M budget; Story Midwest textbook reaches the batch wall, while
  Story Harbourline textbook wins 18/20. Recheck before drawing new tuning conclusions.

### M8.4 Content and M8.6 playtesting/progression

- [ ] Human UI playtest; check the phone-width setting rows (currently scroll within panels).
- [ ] Additional scenarios: Continental Insurance (requires IMS model), Global Airline (24×7, two sites/GDPS).
  Revenue is already playable. Each new scenario needs its own flaw list and story beats (SPEC §13.3).
- [ ] Widen draft/starting perks, each with a cost or trade-off and data in `src/content/`.
- [ ] Expand career unlocks: scenarios, starting tools, cosmetic titles and further levels. Current career has
  seven levels, starting perks, and Report Class Hoarder at level 7; scenario unlocks remain open.

### M8.7 Realism fixes

Facts/citations: [docs/research.md](docs/research.md). Model changes require updated goldens with a
“Behaviour change” note, re-sweeps, and the relevant SPEC §5/§17 updates.

- [x] **Work at an equal DP should share CPU by ready units, not by demand.** (2026-11-02) Equal-DP work now
  shares max-min by ready units (`shareByUnits` in `src/sim/zos/dispatcher.ts`): address spaces count their
  TCBs/SRBs (`DISPATCH_UNITS` in `content/subsys.ts`, FICTIONAL, at least one), batch one per running job,
  transactions one per engine of new arrivals; a backlog adds demand, not units. Db2 tied with a backlogged
  ONLHI keeps its CPU (realism test). A first try counting in-flight tasks by Little's law fed back: tasks waiting
  on a starved Db2 inflated ONLHI's units and starved Db2 further, so waits are not units. Side effects: light
  regions and Db2 at ONLHI's DP no longer share its shortage, so WLM finds no gain lifting a capped ONLHI over
  them (Midwest seed-7 capped test now asserts that); goldens regenerated; ~3 % slower per tick. CI sweep
  (Midwest, seeds 1–5): donothing day 15 / 0 wins, textbook day 27 / 0, expert day 40 / 4 of 5; all in band.
- [x] **CICS transaction classes report work manager states, not using and delay samples.** (2026-11-02) Report
  only: evaluateLpar tags each CICS transaction tick with the samples RMF reports elsewhere (`rmfMoved`, to the image's
  first AOR's service class and its report class, if any) and a work manager breakdown (`wm`); RMF accumulation moves
  them, and WLMGL detail shows RESPONSE TIME BREAKDOWN IN PERCENTAGE (one CICS EXE row). WLM still manages the
  transaction classes from the samples (SG24-7621 p.81). APPL% stays on the transaction class so per-class CPU clues
  keep working (open question below). Pinning a WLMGL DELAY_* metric on a CICS transaction row now points the player
  at the regions' class. Golden hashes changed only in the archived reports: sim state minus RMF and the run log are
  equal to dev for the golden script.

### Active realism audit loop (2026-11-02)

User request: three audits over three hours; one-hour launch spacing, first audit
started in the initiating turn. [Durable record](docs/audit-loops/2026-11-02.md).
Round 1/global r8: Midwest seed 23; r9 Harbourline seed 29 and r10 Revenue seed 31
are planned for the hourly continuations. Each round is vetted before contained
fixes land in serial PRs; design questions wait for the final loop report.

Audit round 8 (2026-11-02, Midwest seed 23, NORMAL): five behaviours tested, two
contained findings implemented and reviewed on the session branch. Exact setup/numbers are in the durable
record above; `runs/lab/r8/hp-*.json` reproduces both.
- Shared CICS Honor Priority is incorrectly per class: ONLMED IIPCP APPL%
  32.49 → 0 with ONLMED NO despite active ONLHI DEFAULT; all-NO is also 0
  (08:30–09:00 PROD1). IBM requires all classes in a transaction-managed region
  to say NO ([WLM Planning 3.1 p.122](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=122)).
- WLMGL APPL% CP omits IIPCP, which IBM defines as its subset
  ([RMF 3.1 p.534](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=534)).
  DDFPRD#1 reports CP 91.14 / IIPCP 76.66 instead of total CP 167.80 at 09:00.
  Correct the report only; preserve internal native/overflow CPU separation.
- After: mixed CICS matches DEFAULT (IIPCP 32.49%, RT 0.897 s), all-NO and DDF NO
  stay blocked. Corrected DDFPRD#1 CP is 167.7971%; ONLMED noon CP is 297.6879%.
  Report-state goldens regenerated intentionally; internal simulation/cost
  snapshots are equal. Combined check and three-scenario sweeps are pending.
- Matches: per-class DDF Honor Priority, HiperDispatch ON/OFF MVS report
  denominators, and system/plex WLM report aggregation. Cross-system WLM moves
  were not isolated. No design questions were raised by this round.

### M9 — Simplified mode (after M8; user request 2026-10-20)
Goal: the same simulation, made approachable for players who aren't z/OS experts. Nothing in `src/sim`
changes; simplified mode is a game/UI layer over the same commands, reports and scoring.
Hold released by the user on 2026-10-26 (was: don't start until told, 2026-10-20). Do all M9 work on a separate
feature branch (e.g. `feature/simplified-mode`), not on `main`.
- [ ] Mode switch at run start (Expert / Simplified); same seed gives the same world in both modes
- [ ] Keep the full WLM policy definition visible and editable, but offer **goal-level actions** that bundle
  the discrete changes an expert would make, e.g. "Protect mobile banking from ad-hoc queries" = new service
  class + classification rule + report class; "Protect the critical batch path" = BATCHHI rule for critical jobs
  + initiator change; "Stop dev from stealing production CPU" = DEVT weight/logicals + soft cap. Each bundle
  shows the exact changes it makes (expandable), its cost and trade-off, and can be undone as a unit
- [ ] Bundles are data in `src/content/` (preconditions, the change list, explanation, Codex links), built
  from the existing Change Desk requests so cost, change risk and the change freeze still apply
- [ ] Plain-language summaries of reports and incidents ("mobile is slow because it waits for CPU behind
  batch") with the raw RMF view one click away; fewer, friendlier Monitor III views
- [ ] Diagnosis stays the gameplay: symptoms → suggested bundles (more than one valid fix), not auto-fixes
- [ ] Balance: bots in simplified mode (bundles only) reach roughly the textbook bot's results
- [ ] Tutorial for simplified mode; Codex entries linked from each bundle

## Active decisions and conventions

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

## Branch workflow

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
  `dev` with auto-merge, and CI merges it when green. CI (`.github/workflows/`): `check` (typecheck + all tests,
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
- CICS transaction APPL%: real RMF reports CICS transactions' CPU service with the regions' service class (no
  address space runs in a transaction class); the sim keeps APPL% on the transaction class because event clues read
  "CPU per transaction" there. Moving it needs those clues rewritten to report classes or CICS SMF 110. Related: with
  every AOR in REGION mode, WLM manages the region class from the regions' own samples only, while real region samples
  include the transactions' work. Monitor III still shows delay samples on CICS transaction classes.
- CICS transaction classes with velocity or multiple periods: the editor now warns (WLM Planning says "not supported"),
  but the sim still splits such work like DDF. IBM documents no runtime behaviour for this case; model it if a source turns up.

- CICS_SOS (loop 105) is modelled as an effective MXT cut, so a player who raises MXT on the PROD2 AORs clears it. Real SOS gets worse with a higher MXT. A proper fix needs a DSA storage model (or a lock on MXT while the card runs).
- Period switching sums CP and zIIP seconds × SU/s without normalising zIIP time to CP speed (APPROX).
- Resource group minimum for discretionary members: what counts as "missing goals" for DISC work? Still delay > using
  (`missingGoal` in `src/sim/core/step.ts`, APPROX); item 11 settled only that it yields to goal work.
- CICS: does WLM/RMF response time include MXT queue time? Currently treated as outside the work
  manager (like DBAT queueing before enclave creation). Verify against CICS performance docs.
- Policy-adjust projections don't model backlog/DBAT feedback, so WLM sometimes places batch above
  DDF while DDF is happy and then can't undo it quickly. Realistic in spirit, but watch in balancing.
- Percentile PI edge cases: how exactly does WLM handle periods with very few completions
  (minimum-sample rules)? Currently an EWMA with a variable horizon. Check *MVS Planning: WLM*.
- TFP details (baseline commitment, overage pricing) are left deliberately abstract; is
  that enough for the strategic choice to feel real?
- Tuning target for "fun density": how many meaningful decisions per live day? (Target: 3–6
  alerts that matter, 1–2 incidents in Act II+.)
- Equal-DP sharing by ready units: real dispatch is a time slice per ready unit; our units are time-averaged
  estimates (one per engine of new transaction work, role counts for address spaces). Check IBM's dispatcher
  description (MVS Diagnosis / SG24-7621 §3.14) for how equal-priority TCBs/SRBs rotate, then add a ledger row.
- Waiting on the user: nothing open; #111 Q1–Q3 are decided.

## Known approximations and risks

- Per-AOR QR busy is not shown in SMF 110 (QR is per LPAR); policy overrides are whole-policy swaps.
- Discretionary capping ignores recent receiver/donor status; TSO users are not swappable address spaces;
  homogeneous report classes are not split into periods; TFP unused baseline has no rollover.
- Modeling/reporting limitations and researched facts belong in SPEC §17 and docs/research.md.
- Opaque cause/effect remains a playtest risk: keep clue paths, WLM logs, hints and Codex explanations usable.
  Balance changes need bot/golden regression checks; avoid tuning against stale sweep baselines.

## Tooling lessons

- The cloud host is noisy. Compare old/new back to back; prove behavior neutrality with bench hashes.
  Avoid concurrent suites/benches that cause subprocess timeouts.
- Track long jobs and stop their exact PIDs/task sessions; broad `pgrep -f`/`pkill -f` patterns can match themselves.
- Keep new session updates brief: current status, changed decisions, unresolved work, and latest validation.
  Use commit/PR links for completed detail rather than rebuilding a chronological transcript.

## Latest maintenance

- Pruned completed milestone checklists, superseded decisions, stale timings, and chronological session logs.
  Pending requirements/questions and current validation remain above; the full pre-prune tracker is recoverable
  from `1d9d5a2:PROGRESS.md` and `git log -p -- PROGRESS.md`.
