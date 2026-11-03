# PROGRESS.md

Current status, pending work, and active decisions for **GOAL MODE**. Update at the end of a working session.
Completed implementation details, superseded decisions, playtest rounds, and experiment logs are in Git history:
`git log -p -- PROGRESS.md`. The last full tracker before this pruning is at `1d9d5a2:PROGRESS.md`.
Design: [SPEC.md](SPEC.md). Research and citations: [docs/research.md](docs/research.md).

## Current status

- **Phase:** M0–M7 and M8.9 complete; M8 follow-ups remain. The M9 hold was lifted on 2026-10-26;
  simplified mode is planned (requirements below).
- **Next up (in order; user-approved overnight plan 2026-11-03):**
  1. **Playtest round 1 fixes** (section below), one PR each, in this order: save during the live day + save export +
     seed entry; WFEX "No work" for CICS transaction classes; SYSWKM pin target; Monitor III history gap; failed change
     request returns its changes to the basket; Ops Console layout; job-level PROCU/DELAY rows.
     (Change Desk JES-rule hint dropped by the user, 2026-11-03.)
  2. **CICS_SOS realism fix** (M8.7), then the **Revenue retune** (M8.7), with sweeps on Sonnet worker sessions.
  3. **`step.ts` split** (Maintenance), hash-neutral, labelled `perf`, last so model changes don't rebase onto it.
  4. Republish the artifact from `dev` when done.
  **Held for the user** (write proposals, don't implement): the finance feedback loop, the full-day tutorial, M9.
  The 27-card event deck is complete; add events only if a playtest asks for them.
- **Published build:** [artifact](https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv) (sharing is "anyone with the
  link"), rebuilt 2026-11-03 from `dev` at `2253b11` (#164). Republish on request.
- **Latest verified dev:** #155; 61 test files / 543 tests pass; production build boots without console errors.
- **Seed-42 one-day hashes (sampling fix):** Midwest `36b802653ffc3bbe`; Harbourline `6a9e3bcac18e138e`; Revenue `059401413bd9c8a3`.
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
| M8.7 | Completed researched realism fixes are recorded in SPEC §17 and docs/research.md; CICS_SOS is the next open fix below. |
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

### Playtest round 1 (2026-11-03, expert player, daily challenge 2026-11-03, Midwest Normal, days 1–2)

Player profile: sysperf/capacity team lead at a major bank; played an earlier build to day 8. Checklist:
[docs/playtest-checklist.md](docs/playtest-checklist.md). First incident (D2 23:44–04:12): the player's rule
`JES TN STM* → STCHI` (meant BATCHHI) put the 11-job critical STM fan in the CICS AORs' importance-1 class, so CICS
starved behind batch at its own DP and WLM found no donor. A legitimate player mistake, but the game hid it:
- [x] Velocity/PI/ACT inflated by double-counted delay samples (velocity 1, PI 497, ACT 256) — #153.
- [x] DELAY Primary Reason named a CICS region instead of the STM job (see M8.7).
- [x] **RCA trigger mislabel:** no card was active, yet the truth was CPU_PRIORITY/BATCH_OVERLAP and
  DEPENDENCY/BATCH_OVERLAP: `triggerOf` (`src/game/sla.ts`) returns BATCH_OVERLAP whenever the Db2 lock index > 1,
  before POLICY. Without a card, CPU priority and dependency misses are the policy's; keep BATCH_OVERLAP for lock
  contention. Fixed 2026-11-03: goldens and `compare` unchanged; Midwest textbook/expert seeds 1–5 identical.
- [x] **PROCU/DELAY are class rows:** real Monitor III lists jobs, so STMxxxx under STCHI is visible in seconds. Add the
  top jobs per class (expandable rows or a job-level PROCU), from the sim's per-job batch state and address spaces.
  Done 2026-11-03: PROCU lists jobs by EAppl % CP (erbb500 p.188–189: Jobname, CX, Service Class, Time on CP %, EAppl %),
  each system row's CPU shared among the class's address spaces and running jobs by estimated load (APPROX, the
  estimate DELAY's Primary Reason already used); DDF enclave CPU in DIST's EAppl only; click a class to filter, or
  switch to the class totals (which keep the EAppl% pins). Also in `play mon3`. DELAY stays class rows: the sim has no
  per-job state samples to show.
- [x] **WFEX Speed says "No work" for CICS transaction classes** with work (since #147 their resource samples moved to
  the AOR classes). Fixed 2026-11-03: their Speed is the serving region classes' workflow, marked "(regions)"
  (SYSWKM shows the serving address spaces' using and velocity, SG24-6645 p.277–278; see docs/research.md).
  Reporting only.
- [x] **SYSWKM: pinning a region's velocity pins the DELAY CPU-delay figure** instead (pin target mismatch). Fixed
  2026-11-03: the Veloc pin records that server row's velocity (new `VELOCITY` metric, source SYSWKM, a symptom
  with no cause weight, like PI); CLI: `pin MON3 <system> <txn class> VELOCITY <jobname>` (current range only).
- [x] **Monitor III history gap:** SYSSUM history went from 23:22 straight to 23:44 (check MINTIME snapshots and the
  history picker). Fixed 2026-11-03: recording has no gap (a replay of the worker's chunked loop over 20 sim hours
  held every 2-minute range); the slider does: ≈1,400 held ranges over a few hundred pixels, so one pixel of drag
  skips ~10 ranges (≈22 min). The time bar now has **Go to** (`D2 23:30`, the range ending at or before it) and
  labels the shown range (`D2 23:28–23:30`); ◀/▶ and the slider's arrow keys still step one range.
- [x] **Failed change requests:** a failed request should return its changes to the basket; the change list in the
  failure notice is truncated, so a failed 9-change request was unrecoverable. Fixed 2026-11-03: a backed-out
  change (emergency, or planned and failed at 06:00) hands its Change Desk changes back to the basket (a later
  draft of the same target wins) with a notice; policy activations keep going back to the pending policy; fixes
  and hardware orders aren't basket changes.
- [x] **Ops Console layout:** Batch Window above Operations Log; keep Incidents and Batch Window visible (the at-a-glance
  health panels) when the window is narrower than full desktop width or at phone width, instead of dropping them to the
  bottom. Done: below 1360 px the health panels lead the console (side by side when they fit), the log comes after;
  at desktop width Incidents, Batch window and the log stack in the last column.
- [x] **Saves during the live day, save export, seed entry** (2026-11-03). The live day already saved each sim hour,
  but only while no older save was on offer, and the phase-change save that replaced an older save never cleared
  that offer, so a session that started a new run over an old save never saved mid-day again (likely the
  reported fallback). Restarting from the first briefing (scenario, difficulty, daily challenge) also dropped the
  older save at once and saved over it within 400 ms (a likely cause of the lost save). Now: an older save stays on
  offer until the new run's first phase change (Start day asks first), the live day saves every 30 s real time (5 s at first; user request 2026-11-03) (and
  each sim hour, ≥2 s apart; a pagehide flush can't land because the worker dies first), actions save within 3 s
  in the live day; top-bar **⇩ export** / **⇧ import** of play-CLI run files; a Seed box on the first briefing
  and the new-run screen.
- [ ] **Finance feedback loop:** the monthly MLC bill arrives too late (a player who stops by day 8 never sees one; 40
  days leave little room to correct). Consider a weekly/rolling cost signal or a mid-month bill estimate.
- [ ] **Tutorial:** a full guided day for non-experts (the expert knew where to look; others won't).
- Positive: the batch critical-path estimate slipping on night 1 reads as a fair early warning of the day-27/28 wall.

### M8.7 Realism fixes

Facts/citations: [docs/research.md](docs/research.md). Model changes require updated goldens with a
“Behaviour change” note, re-sweeps, and the relevant SPEC §5/§17 updates.

- [x] **WLM state samples bounded by dispatchable units** (2026-11-03, playtest finding). Processor delay of an
  address-space slice is capped at its ready units minus its other states (RMF Report Analysis p.52–53, p.540).
  Before, a saturated pool's queue ratio times granted CPU was added to the unmet demand: 12 BATCHPRD jobs on
  3.4 engines showed 140 delay samples (velocity 3 %, Monitor III ACT 143); now velocity 38 %. Sweep (Normal,
  `ccr-18f028ce` head): Midwest seeds 1–10 do-nothing day 18 / textbook 28 / expert 10/10; Harbourline 1–10:
  10 / 29 / 6/10 (losses 1, 2, 4, 7); Revenue 1–5: 22 / 29 / 5/5. Revenue do-nothing was day 10 on dev (same
  seeds): G1's daily EFILE CPU_PRIORITY/POLICY misses partly came from WLM feeding a falsely suffering
  importance-4 batch class from WEBDDF. Follow-up below.
- [ ] **Revenue retune after the sampling fix:** do-nothing survives to day 22 (band top). Restore G1's pressure
  through content (compliance analytics load in WEBDDF, EFILE growth), not by reintroducing the inflated batch PI.
- [x] **Monitor III DELAY Primary Reason may name a job of the same class** (playtest: BATCHPRD named idle
  CICSAOR1; STCHI with misrouted STM batch named CICSAOR1). The own class competes with its other units, and a
  class's address spaces and running batch jobs compete by estimated CP engines (reporting only; `npm run compare`:
  sim/game/RMF identical, Monitor III Primary Reason values differ).
- [x] **CICS_SOS rewards the wrong fix.** (2026-11-03) Replaced the MXT cut with an EDSA model per AOR
  (`src/sim/subsys/cics.ts`, FICTIONAL sizes in `CICS_STORAGE`; IBM default EDSALIM 800 MB): the card starts a
  storage leak; once in-flight tasks outgrow EDSALIM the region is SOS and thrashes, so raising MXT no longer helps.
  Clues: SMF 110 region storage (EDSA peak / EDSALIM / SOS minutes, DFHSM0133). Fixes: recycle, raise EDSALIM
  (new Change Desk lever, SET_CICS `edsaLimitMb`), MXT down to what storage holds (fewer failures), route away.
  Not modelled: DSALIM/24-bit, and the doc's warning that a maximal EDSALIM hides a leak (a pre-emptive max EDSALIM
  is cheap insurance against this card; see Open questions).

- [x] **Work at an equal DP should share CPU by ready units, not by demand.** (2026-11-02) Equal-DP work now
  shares max-min by ready units (`shareByUnits` in `src/sim/zos/dispatcher.ts`): address spaces count their
  TCBs/SRBs (`DISPATCH_UNITS` in `content/subsys.ts`, FICTIONAL, at least one), batch one per running job,
  transactions one per engine of new arrivals; a backlog adds demand, not units. Db2 tied with a backlogged
  ONLHI keeps its CPU (realism test). A first try counting in-flight tasks by Little's law fed back: tasks waiting
  on a starved Db2 inflated ONLHI's units and starved Db2 further, so waits are not units. Side effects: light
  regions and Db2 at ONLHI's DP no longer share its shortage, so WLM finds no gain lifting a capped ONLHI over
  them (Midwest seed-7 capped test now asserts that); goldens regenerated; ~3 % slower per tick. CI sweep
  (Midwest, seeds 1–5): donothing day 15 / 0 wins, textbook day 27 / 0, expert day 40 / 4 of 5; all in band.
- [x] **CICS transaction classes report work manager states, not using and delay samples.**
  Reporting-only projection sends ordinary CICS resource usage/samples to AOR service/report classes;
  transaction rows retain RT/PI/buckets and estimated EXE state percentages. Monitor III, stored pins,
  evidence relevance and hints follow the attribution. Mixed classes retain non-CICS resource samples.
  The zos-docs audit corrected ACTIVE vs total population, READY vs BCP waits, BTE meaning, and
  mixed/BOTH velocity; it documents optional TRANS-APPL% accounting. Durable facts are in the research
  ledger; PR-specific evidence belongs in the PR discussion.
  APPROX: equal AOR allocation; combined ACTIVE SUB/APPL; READY from QR dispatch waits. TOR/BTE,
  IDLE, EXE coverage and optional transaction processor accounting are not modeled. Management unchanged.
  Merged with the alternative #148 after a side-by-side review (2026-11-02): WAITING FOR LOCK/PROD/MISC split
  (Db2 locks, Db2/MQ/server waits and CF, rest) in the RMF column layout instead of one MISC bucket; all-REGION
  mode leaves the breakdown to report classes; CICS event clues (access-path regression, retail, refund status,
  the SMF-audit CPU/txn clues, XLOG) read CPU from STCHI or CICS monitoring, with a content test guarding them.
  Follow-up after a zos-docs check (2026-11-02): Monitor III SYSWKM view (p.204–207) with the breakdown and serving
  AORs (velocity, Proc/I/O-Usg, Capp; pins go to the region class row), so CICS CPU diagnosis in Monitor III goes
  through the AORs; WLMGL SERVICE CLASSES BEING SERVED on region classes (p.525); MKTORD market-open and the
  card-auth/account lock clues rewritten (READY, SYSWKM, WAITING FOR LOCK); wider clue test. Open: AORs on one system
  show identical SYSWKM figures (CICS work is modelled per system, not per region); real WLMGL shows only non-zero
  states, a BTE row with RESP TIME %, ACTIVE SUB/APPL split and state-switched samples (not modelled).
  Simplified (2026-11-03): the parallel reporting projection (second tick list, second decayed accumulator per
  period, stored resource-sample flag, old-save seeding) became a `moved` tag on CICS transaction ticks plus a decayed
  `moved` in WLM's accumulator. WLMGL text and Monitor III views identical to the previous head in all three
  scenarios (records equal to the last bit, ~1e-16); sim state minus reporting equal; −45 source and −57 test lines;
  speed unchanged from the previous head (Midwest ~+8 %, Harbourline ~+8–10 % per tick vs dev, noisy).
  Validation: typecheck + 533 tests / 60 files pass; production build passes; reporting goldens regenerated
  and verified without update mode. Original PR-head CI sweep passed: donothing day 15 / 0 wins,
  textbook day 27 / 0, expert day 40 / 4 of 5. Performance follow-up reruns CI; PR #147 stays open.
  One-day seed-42 internal-state hashes matched dev in Midwest, Harbourline and Revenue after excluding
  reporting data. Independent review covered source claims, migration, sample/metadata expiry and backlog.
  Performance follow-up: Set transaction membership, sparse report ticks/history,
  reuse immutable RT/buckets, and reuse sorted region keys instead of rebuilding Sets per merge.
  Same-host medians of two interleaved seed-42 one-day runs (reverse order on trial 2), ms/tick:
  Midwest dev 0.439 / reviewed head 0.707 / revised 0.474 (+7.9% vs dev; -32.9% vs reviewed head);
  Harbourline 0.705 / 1.155 / 0.726 (+2.9%; -37.1%). Measurements ran without other CPU jobs.
  The module-level region topology cache was later removed: cache on/off benched within noise (Midwest
  0.89/1.06 vs 0.99/0.91 ms/tick; Harbourline 1.65/1.77 vs 1.74/1.55), same state hashes, and it relied on
  the WLM definition never being edited in place.
  Full-day hourly RMF/Monitor III report-value hashes match the reviewed head in all three scenarios;
  management hashes match dev. Raw goldens change because redundant serialized history is removed.
  Full check: 533 tests / 60 files pass; readonly goldens and the queue-reporting assertion pass; build passes.
  Per-PR audit file removed; Codex agent guidance now keeps PR evidence on the PR.

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
- CICS transaction classes with velocity or multiple periods: the editor now warns (WLM Planning says "not supported"),
  but the sim still splits such work like DDF. IBM documents no runtime behaviour for this case; model it if a source turns up.

- CICS_SOS (2026-11-03): EDSALIM raised to the max before the card is cheap insurance; should a large EDSALIM carry a cost (real storage, or a later abend when a leak finally exhausts it)?
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
- `npm run compare` (2026-11-03) backs "report-only" / "pure refactor" claims: sim state with reporting excluded, game
  state, log, every RMF report's text and records, Monitor III views, base vs head in worktrees (~20 s for three
  scenarios). `play … mon3` now prints SYSWKM too; use the play CLI for report and Monitor III questions.
- Keep new session updates brief: current status, changed decisions, unresolved work, and latest validation.
  Use commit/PR links for completed detail rather than rebuilding a chronological transcript.

## Latest maintenance

- [ ] **NEXT after CICS_SOS: split `src/sim/core/step.ts`** (~1,440 lines; most model fixes land there). Move each
  SPEC §5.1 pipeline stage into its own module with a `stepX(state, ctx)` entry point, keep `step.ts` as the
  orchestrator in contract order. Must be hash-neutral: label the PR `perf`/refactor so the `perf-hash` gate proves
  identical Midwest and Harbourline bench hashes; also compare Revenue by hand. `src/sim/wlm/evaluate.ts` (~910) is
  the next candidate.
- Stale remote branches (`claude/*`, `ccr-d83b42c6-*`, Oct 21–29) hold only already squash-merged work; delete
  when convenient.

- Pruned completed milestone checklists, superseded decisions, stale timings, and chronological session logs.
  Pending requirements/questions and current validation remain above; the full pre-prune tracker is recoverable
  from `1d9d5a2:PROGRESS.md` and `git log -p -- PROGRESS.md`.
