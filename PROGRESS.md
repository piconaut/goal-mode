# PROGRESS.md

Status tracker for **GOAL MODE**. Update at the end of every working session.
Finished work is summarised; the full per-loop detail is in git history (`git log -p -- PROGRESS.md`).

## Current status

- **Phase:** M0–M7 and M8.9 done; M8 in progress; M9 released (user, 2026-10-26). Playable in the browser
  (`npm run dev`); published build: https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv (private; republish on request).
- **Last updated:** 2026-10-28
- **Next up:** Separate per-CPC tables in the Monitor III CPC report and the HMC when there are several CPCs (M8.6, user request 2026-10-28), then a human UI playtest (M8.6), M8.4 events (27 in the deck; more only if a playtest asks for one). M8.1 and M8.2 closed (2026-10-27).
- **Repo:** https://github.com/piconaut/goal-mode (build-loop branch `dev`, renamed from `ccr-2af28431-vidfb0` on 2026-10-21; merged into `main` from time to time).
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
- **Health:** `npm run check` green (430 tests). Headless (cloud box): day 1 3.25–3.7 s, steady days ~2.0–2.4 s;
  bots ~4 s/day. Bench hash (seed 42, 1 day) Midwest `fef4fa052462d635`, Harbourline `a1984addb2403be0` (dev after #70; merged to main in PR #72).
- **Try it:** `npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1` prints daily SLA/batch/MLC summaries,
  hourly busy/PI, and Postprocessor-style WLMGL, Partition Data, CF and DASD reports. `--dc PROD2=420` sets a defined capacity.
- **Calibration (seed 42, BASEPOL, no player action):** day 1–3 CPC peak ≈ 85% at 12:00; online SLAs 99.5–99.9% except
  MOBILE (96–98%). Batch starts at 20:00 into Mobile's evening peak and starves Db2 (F1) and DDF (F4) until WLM
  adapts; critical batch ends 04:13 → 04:44 (deadline 06:00); payday (day 13) saturates the CPC.

### M0–M6 — Foundation and playable vertical slice (done)
- [x] M0 scaffolding: Vite + React + TS strict, Vitest, purity test (`tests/sim/purity.test.ts`), seeded RNG, `npm run check`
- [x] M1 hardware, PR/SM, HiperDispatch polarity, dispatcher with Erlang-C (`sim/hw/`, `sim/zos/dispatcher.ts`)
- [x] M2 workloads and WLM: arrivals, classification, periods, PI, policy adjustment, CPU critical, blocked
  workload, RG min/max, discretionary, I/O priority, MPL/swap; BASEPOL with flaws F1–F6
- [x] M3 subsystems: CICS (QR/MXT, REGION mode), Db2 (BP/DBAT/locks), DASD, CF (structures, rebuild, duplexing),
  paging, MQ queue depth, nightly batch DAG with critical path (`sim/subsys/`, `sim/io/`, `sim/cf/`)
- [x] M4 capping and cost: R4HA, defined/group capacity, CAP delay, MLC, SCRT report, RMF/SMF records and
  Postprocessor renderers (`sim/cost/`, `sim/measure/`)
- [x] M5 game layer: commands, run state machine, economy, change board, events, incidents + RCA, draft,
  bots; Midwest Mutual with flaws F1–F12
- [x] M6 UI: worker, Ops Console, RMF browser, Change Desk, overlays, charts (`src/ui/LineChart.tsx`), autosave,
  screenshot driver `node tools/screenshot.mjs`
- [x] M6.1 user requests: classification rules view, Change Desk QoL and polish (sub-tabs, basket, cost/risk
  previews), service class / resource group editor, Monitor III charts, Ask around (with stakeholder mood),
  report-card toggle, saves keep Change Desk work

### M7 — Analytics, fog of war & strategic depth (done)
Insight is earned by investigating and spent on tools (`content/tools.ts`, `game/tools.ts`); tools reveal data
and cost CPU (`mods.measureCpu`). Tier 1: Monitor III, live WLM log, CPC view. Tier 2: Monitor III charting, CF
per structure, DASD per LCU, SMF 101/110/30/113, RCA evidence pinning. Tier 3: what-if, capacity planner, alerts,
automation + CoD, saved policies with a daily schedule. Tier 4: report classes + advisor, AIOps, TFP offer,
Finance tab, multi-day projects, Codex with contextual "?" hints.
- [ ] ~~RMF interval < 15 min needs the tool~~ dropped: the Postprocessor interval is just SMF INTVAL on real systems
- [ ] PROCU is per service-class period, not per address space (slices are not kept per tick). Add top address
  spaces if a diagnosis needs it
- Known gaps (APPROX, revisit only if gameplay needs them): per-AOR QR busy not shown in SMF 110 (QR is per LPAR);
  WLM "policy overrides" not modelled (whole policies are swapped); discretionary capping ignores "not a recent
  receiver/donor"; TSO users are not swappable address spaces; RMF doesn't split homogeneous report classes into
  periods; TFP unused baseline is lost (no rollover); lock requests never convert to async
- Dev aids (dev builds): `globalThis.__goalMode.send(msg)` with `DEV_INSIGHT`, `DEV_FAST_DAYS {days}`, `DEV_TFP_OFFER`


### M8 — Balance, difficulty, content & polish
Goal: a run that is fair, readable and replayable. Done when bots hit their targets on every difficulty,
three scenarios ship, a new player can finish day 1 with the tutorial, and an accessibility pass is clean.

**M8.1 Performance (prerequisite for bots and what-if)**
- [x] Closed 2026-10-27 (user decision): the gate is ≤ 4 ms per tick in the worker, which holds; ≤ 2 s per headless
  day was a tooling convenience (Midwest 2.56 s, Harbourline 5.27 s on the cloud box). Revisit only if sweeps become
  the bottleneck
- [x] Benchmark `npm run bench [-- --days N --seed S --hash]` (`tools/bench.ts`); `--hash` proves an optimisation is
  behaviour-neutral. Seed 42 hashes: 1 day `8a82ad7db2b258ae`, 3 days `55d9e06f477c9197`, 8 days `c2ec32ace44f6b06` (since PR #8)
- [x] `step` is split into per-LPAR stages (`lparDemand`, `dispatchLpar`, `softCap`, `prsm`, `adjustPolicies`,
  `stepCapping`, `stepCost`, `stepRmf`) sharing a `TickCtx`; profile is flat. Lesson: build slices with a spread, not a
  field-by-field literal (hidden-class split made it ~40% slower)
- [x] Structural options closed 2026-10-27: no hash-neutral item is left above ~3 %. Projecting only periods at or
  below the touched DP was dropped (dependency health, CP queue ratio and I/O priority carry effects upward);
  in-place RMF sums shelved (break `step` purity, save-format and hash churn); behaviour-changing skips not wanted
- Decision: the what-if simulator doesn't wait on M8.1 (runs in the briefing with the clock stopped, chunked)

**M8.2 Balance harness & targets (SPEC §16)**
- [x] `npm run sweep -- --bots donothing,textbook --seeds 1-20 [--jobs N] [--days D] [--out f.csv]` (`tools/sweep.ts`)
  → CSV + per-bot summary (day p10/median/p90, median score, ends by cause)
- [x] Golden runs (`tests/golden/`, seed 42, 2 days; regenerate with `UPDATE_GOLDEN=1 npx vitest run tests/golden`)
- [x] Bots: donothing (lose day 12–18), textbook (≈ day 28–32), spendtowin (On/Off CoD every day: loses on opex),
  expert (scripted good play incl. capacity orders, caps and `tunePolicyIncidents`: wins with grade A on Normal)
- [x] Targets hold across ≥ 20 seeds. Closed 2026-10-27 (user decision): bot balance is done; sweeps are now a
  regression check (CI `balanceGate` on 5 seeds, 20 seeds to confirm a balance-affecting change), not a tuning
  target. Harbourline expert's four trust ends (seeds 1, 2, 15, 20) are accepted as the hardest scenario's spread.
  Harbourline opex budget is $1.6M (was $1.5M, user decision 2026-10-26); the opex ends are gone after that and the
  CoD revert fix. Textbook is a "reads the manual, no diagnosis" floor (user decision, loop 46): its day-27/28 batch
  wall is the REG_DEADLINE (05:00 from day 20) plus 0.4 %/day growth, intended pressure
- Latest accepted baselines, Normal, seeds 1–20 (day p10 / median / p90; ends by cause):
  - Midwest: do-nothing 11 / 16 / 21 (trust 14 · batch 6); textbook 20 / 28 / 28 (batch 10 · trust 10); expert
    victory 19 · opex 1 (score median 2790); spendtowin opex 20
  - Revenue: do-nothing 10 / 13 / 15 (trust 20); textbook 27 / 28 / 29 (trust 20); expert victory 20 (2777);
    spendtowin opex 20
  - Harbourline: do-nothing 8 / 12 / 15; textbook 29 / 31 / 37 (trust 18 · victory 2); expert victory 16 · trust 4
    (2965); spendtowin opex 16 · trust 4
  - Story (2026-10-26 full sweep): Midwest do-nothing 21 / 25 / 27, textbook 19 / 28 / 30, expert 20/20; Revenue
    do-nothing 15 / 16 / 19, textbook 29 / 30 / 31, expert 19/20; Harbourline do-nothing 11 / 15 / 18, textbook
    victory 18/20, expert 19/20. Hard: Midwest do-nothing 9 / 12 / 17, textbook 16 / 24 / 27, expert 28 / 40 / 40
    (victory 8); Revenue do-nothing 8 / 9 / 12, textbook 26 / 27 / 28, expert victory 16/20; Harbourline do-nothing
    8 / 10 / 11, textbook 18 / 26 / 28, expert 25 / 28 / 33 (no victories, before the $1.6M budget)

**M8.3 Difficulty & run structure**
- [x] Difficulty presets Story / Normal / Hard / Ironman (`src/content/difficulty.ts`; picker in the day-1 briefing and
  end screen; `--difficulty` on bot/sweep). Presets order every scenario as intended (Story > Normal > Hard). Open
  balance questions (not blocking): Hard Harbourline is unwinnable for the expert bot (checked before the $1.6M
  budget); Story Midwest textbook still hits the batch-deadline wall; Story Harbourline is won by textbook (18/20)
- [x] Morning hints (Story clear, Normal vague, none on Hard/Ironman; `src/game/hints.ts`, `src/content/hints.ts`)
- [x] Weekend auto-simulation with the report card as summary; optional "play the weekend"
- [x] Endless mode after victory; daily seed challenge (`src/game/daily.ts`), startable from the day-1 briefing too
- [x] End-of-run report (`src/game/endReport.ts`): per-day score, PI heat-map, R4HA chart, decisions timeline, grade S–D
- [~] Meta-progression: career XP and seven levels unlocking starting perks (IndexedDB), level 7 unlocks a starting
  tool (Report Class Hoarder); Codex persists (localStorage). Still open: scenario unlocks (one scenario so far)

**M8.4 Content**
- [~] Events to ~25 (SPEC §9); 27 now (deck complete for this pass). Since M5: REORG_OVERRUN, CF_FAILURE, SHADOW_IT, QR_RELEASE,
  NEW_APP_GOLIVE, POWER_CAP, HSM_RECALL_STORM, CP_SPARING (red herring), HIRING_FREEZE, AUDIT_UNCLASSIFIED,
  ZIIP_LOSS (loop 104), CICS_SOS (loop 105), SMF_AUDIT (loop 106), RETRY_STORM (loop 110), XLOG_LOOP (loop 112: looping STC misclassified by the CICS* rule), ENCRYPTION_MANDATE and GREEN_IT_COD (loop 113). Re-sweep the bots once the deck is complete
  - VENDOR_PRICE (2026-10-23, user's option 1): `SET_MLC_PRICE` sets `cost.priceMult` (absent = 1, goldens unchanged);
    card +8% from day 10, permanent, once per run, in all three decks; fix `NEGOTIATE_MLC_PRICE` (3 h, Finance −1);
    TFP terms are not affected, later TFP offers are priced at the new list price
  - HyperPAV exhaustion dropped: organic LCU I/O is ~2k/s, so even zero aliases moves IOSQ < 0.3 ms (no symptom)
  - STORAGE card (DBA grows DB1B buffer pools on PROD2) not added (loop 107): it exposed a swap deadlock, fixed
    with `STORAGE_SWAP.minSwappedIn: 1`, but with the fix even +60 GB BP costs < 0.2 h of critical path. Needs a
    harsher paging model first
  - HSM storm magnitude 60k (75k is past the LCU 30 cliff, ≈ 15× response)
  - RCA truth: cards may declare `mechanisms`; `triggerOf` blames an active card only for incidents with one of them
- [x] More draft options and perks: every SPEC §9.5 opportunity type, 11 perks, 2 pacts (`content/draft.ts`)
- [ ] Scenarios: *Continental Insurance* (IMS-heavy claims batch, needs an IMS subsystem model), *State Revenue Agency* (tax-season spike, strict regulator), *Global Airline* (24×7, two CPCs/sites, GDPS-style constraints)
- [ ] Each scenario ships with its own flaw list (SPEC §13.3 rules) and story beats
- [x] *State Revenue Agency* playable (SPEC §13.4): scenario packs (`content/packs.ts`, `--scenario revenue`, picker in
  the new-run dialog and day-1 briefing), per-scenario facets, flaws G1–G3/H1–H2, story beats, 16-card agency deck.
  Follow-up: textbook's day-22 PREFILL losses (its PFILAPI class still misses)
- [ ] Scenario (user request 2026-10-21): **large bank, big mainframe estate**, a harder run for experienced players.
  - **Estate:** several CPCs and many LPARs and sysplex members.
  - **Analytics at the start:** some tools are unlocked from day 1, so the challenge is diagnosis, not visibility.
  - **Harder problems.** Two the user named:
    - **Strongly spiky online workload:** bursty arrivals well above the hourly mean (e.g. flash events, open-of-market).
      WLM's 10 s adjustment and R4HA/capping lag behind it, so the player has to choose between headroom, goals that
      tolerate bursts, and capping (e.g. defined capacity vs. absolute cap).
    - **Workload-balancing issues across the sysplex:** sysplex distributor / CICSPlex SM routing and WLM routing
      recommendations send work to the wrong images, through skewed weights, a sick-but-alive region (storm
      drain) or uneven zIIP capacity. Fixes trade affinity against even load.
  - **Needs:** a multi-CPC world (the hardware catalog and HMC assume one CPC), finer-than-hourly arrival bursts in
    the workload model, and routing that reacts to image health.
  - [x] Design: SPEC §13.5 "Harbourline Bank" (2 CPCs, 6 LPARs, starting tools; Problem 1 spiky markets work with
    four fix families; Problem 2 flaws B1–B4: static SD weights, storm drain, CP-only WLM weights, CF locality; build
    order multi-CPC → burst arrivals → routing policies → content)


**M8.6 Playtesting, polish & progression (user request 2026-10-26)**
- [ ] Playtesting: human and agent playtests on all three scenarios (`goal-mode-player` and the persona agents for
  the headless side); record friction points and fix the worst ones
  - Round 1 (2026-10-27, play CLI; Midwest seed 11, Revenue seed 23, Harbourline seed 37, to about day 9): CLI
    friction fixed the same day. Findings A–F all done: A morning hint points at SMF 110/101 when WLMGL disagrees with
    the SLA; B batch-window misses open a `BATCH` incident with its own RCA and SMF 30 pins (mechanism JOB_FAILURE);
    C same-day same-truth incidents share one RCA (`rcaGroup`, trust reward scales with group size); D starting
    insight 15 (`INSIGHT.starting`); E forewarnings reworded off "tomorrow", operator fixes (CANCEL_RUNAWAY etc.)
    are `operational`; F Change Desk and `catalog` list only the scenario's fixes (`fixIdsOf`).
  - Round 2 (2026-10-27, seed 2027; to the day-8 briefing, three personas): play CLI pin/smf day and hour labels fixed.
    Findings done: G THREAD_LIMIT credited only with queue growth beyond baseline (`outsideRef`); H strain morning
    hint for classes whose PI reached 3 and doubled; J GOODWILL left as is; K id prefixes per kind (`INC13`, `PIN12`, `CHG14`;
    `src/game/ids.ts`), `status` lists projects, idle engineer-hours left as is; L `catalog` lists regions/MXT/MAXDBAT,
    `cancel`, bad targets refused before charging; M ABS CAP column in Partition Data and `pin CPC … <interval>`;
    N/O MXT queueing no longer scored THREAD_LIMIT, new trigger APPLICATION_ERROR for the JOB_ABEND card; P MLC
    estimate tooltip says it follows the month's peak R4HA, `smf BATCH` legend, pin hour labels.
  - [x] I: RCA guessing pays: CPU_PRIORITY/POLICY was right three times on CARDAUTH blips without evidence, and a
    JOB_FAILURE trigger POLICY (the player's own activation) cannot be derived; half-right RCAs still give +1 on
    every facet. User decision 2026-10-27: fine as it is (guessing may pay).
  - Round 3 (2026-10-28, seed 2028; to the day-8 briefing, personas rotated): round 2 fixes held; `new` checks its
    arguments and a cancelled policy activation keeps its edits. Findings done: Q new RCA mechanism ROUTING
    (`failureMechanism`, SICK_AOR); R CICS view column DISP−CPU plus failed %; S failed activations explain why and
    return edits to the pending policy; T `play policy [pending]`; U `restart <JOB>`, `advance` stops at an abend;
    V `ask` allowed in REVIEW; W strain hint skips thin response-time intervals (`STRAIN.minEnded`) and batch
    classes, `status` shows only the latest hints; X `pin` prints only its result, `smf BATCH` lists the critical path first, handover
    mail at Harbourline day 0 (story beat `HANDOVER`; no day-1 trust grace); report-card naming and GOODWILL kept.
- [x] Monitor III history follow-ups (2026-10-28): MON3 and CPC pins from a past range (browser: 📌 on a history view;
  CLI: `pin MON3|CPC ... --at D2 10:40`), stamped with that range's end; the play CLI keeps the pinnable values
  (`src/game/mon3PinHistory.ts`) for 48 h in `runs/a.mon3.json` beside the run file, ~5 MB on Harbourline, and shows
  them with `mon3 [system] --at`. Recording only runs in the CLI's `advance` (bots and sweeps don't use it). Monitor
  III MINTIME is now 120 s (was 100 s, RMF's default); the "Range" header still shows WLM's ≈ 67 s smoothing (§17)
- [ ] UI polish pass: consistency of panels, spacing, labels and empty states; phone width; follow-ups from playtests
- [ ] Multi-CPC views (user request 2026-10-28): when the estate has more than one CPC (Harbourline), the Monitor III
  CPC report and the HMC show a separate table per CPC (its own capacity, MSU, capping and partitions), not one list
  of every LPAR
- [ ] Additional perks: widen the draft and starting-perk pool (each with a cost or trade-off, data in `src/content/`)
- [ ] Expand career unlocks: more levels and unlock kinds (scenarios, starting tools, cosmetic titles), building on
  the career XP system (M8.3 meta-progression)

**M8.7 Realism fixes (researched 2026-10-26; facts and citations in `docs/research.md`)**
Each is a sim model change: regenerate the goldens with a "Behaviour change" note, re-sweep, update SPEC §5.5.5 and §17.
- [x] Soft capping cuts polarity: `resolveCpc` takes polarity from min(entitlement, soft-cap engines) (*MVS Planning: WLM* 3.1, p.46)
- [x] Discretionary goal management: capped from PI < 0.71, cap = 1 − (0.81 − PI), floor 50 % (`DISC_GOAL_MGMT` in
  `src/content/wlm/tuning.ts`; SG24-6472-03 p.183)
- [x] SERVERWLM weights are zIIP-aware: `WLM{distMethod: BASEWLM | SERVERWLM}` replaces `ziipAware`
  (`src/sim/workload/routing.ts`; PROCXCOST/PROCTYPE not modelled; Harbourline's B3 is "left on default BASEWLM")
- [ ] **CICS transaction classes report work manager states, not using and delay samples.** For CICS and IMS,
  resource usage and state samples go with the regions' service classes; transaction classes get the work manager
  section (ACTIVE, READY, IDLE, WAITING FOR…, BTE/EXE) (*WLM Planning* 3.1, p.113; *RMF Report Analysis* p.536–537).
  The sim's WLMGL posts CPU using and delay on CICS transaction classes. Changing it moves the WLMGL report, the
  DELAY_CPU pins and the hints that point at them (playtest finding R, 2026-10-28).

**M8.5 UX polish & accessibility** (done)
- [x] Day-1 guided tutorial; charts with crosshair tooltips and table views; keyboard shortcuts (Space, 1–5,
  Alt+1–8); forced-colors support; contrast test for dark, light and 3270 themes (`tests/ui/contrast.test.ts`);
  sound toggle; theme toggle; remembered speed; crash-safe hourly autosave; static deploy + README

### M8.9 — Game-playing agents (last work on `main`; user request 2026-10-20) (done)
After M7–M8 are done and **before** starting M9, add AI agents that can play the game, then stop pushing
to `main` (this is the last push there; M9 goes on its feature branch).
- [x] Headless play CLI `npm run play -- <runFile> <verb>` (`tools/play.ts`, `tools/playCore.ts`): reports, SMF,
  Monitor III, changes, WLM edits, RCA with evidence, ask, projects, notes, `advance N [--pace 2s]`; command log
  replays deterministically. Quick reference in `docs/agents.md`
- [x] Agents `.claude/agents/goal-mode-player.md`, `-cautious-operator`, `-cost-cutter` (no access to ground truth);
  smoke test (loop 83) played seed 42 day 1 through review; its friction reports were fixed (loops 83–85)
- [x] Spectator mode: `?spectate=<name>` polls `runs/<name>.json` read-only with the agent's latest command/note in a
  banner; `npm run bot -- ... --spectate runs/bot.json [--pace 2]`; "Take over this run" adopts it as a save

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

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-19 | Name: **GOAL MODE** | Nods to WLM goal mode; short and memorable |
| 2026-10-19 | Browser game, TypeScript + React, sim in Web Worker | Zero-install, shareable; worker keeps UI smooth; same TS sim runs headless in Node for balancing |
| 2026-10-19 | Tick = 10 sim-s (WLM policy interval); fluid/analytic model; batch jobs discrete | Matches the real WLM cadence; 8,640 ticks/day is cheap; batch critical path needs per-job identity |
| 2026-10-19 | Day runs 06:00 → 06:00 | Each day ends on the batch-window deadline, a natural climax |
| 2026-10-19 | Run = ~40 played business days, weekends auto-simulated; growth compressed | Roguelike-length runs (~7 h at 1×, less with speed-up) without 60-hour calendars |
| 2026-10-19 | Erlang-C for CPU queueing; log-normal RT distributions | Standard, cheap, captures engine-count effects and percentile behaviour |
| 2026-10-19 | HiperDispatch polarity uses the Watson & Walker published rules | Concrete and documented; teaches the "weight +1 flips VM→VH" lesson |
| 2026-10-19 | Real mechanics, fictional numbers (no real LSPR/MSU/price data) | Avoids presenting invented figures as IBM data; keeps the content tunable |
| 2026-10-19 | Pause allowed by default; Ironman disables it | Accessibility and analysis depth vs tension for experts |
| 2026-10-19 | Pinned TS 5.9, Vite 7, Vitest 4, React 19; `.npmrc` sets `legacy-peer-deps=true` | npm 10 crashed resolving Vitest's optional peer set (`edgesOut` null); TS 7 (native) skipped for stability |
| 2026-10-19 | Architecture rules enforced by a test (purity scan) instead of ESLint for now | Fewer deps; ESLint can come later |
| 2026-10-19 | Dispatcher returns delay-to-using *ratios* (queue, PR/SM) rather than samples | WLM sampling (M2) multiplies by using samples; keeps the dispatcher model independent of goal logic |
| 2026-10-19 | Dispatch per service-class period, then split grants to slices by demand | Equivalent (equal-DP work shares by demand) and ~3× cheaper; policy-adjust projections re-run the evaluator many times |
| 2026-10-19 | "Samples" are time-average concurrencies per state (engines using, units delayed) rather than discrete 250 ms counts | Same ratios as sampling, computed analytically |
| 2026-10-19 | I/O: connect+disconnect count as *using*, IOSQ+pend as *delay* | APPROX; makes velocity goals for I/O-heavy work achievable. Superseded 2026-10-21: connect only (see below) |
| 2026-10-19 | Dependency (server) waits are "other" delay: visible in RT, excluded from velocity, not WLM-fixable | Recreates the classic Db2-below-its-callers priority inversion diagnostic pattern |
| 2026-10-19 | Unmet CPU demand becomes backlog (engine-seconds); wait = backlog / service rate; timeouts drop work and feed retries | Gives realistic saturation collapse and retry storms |
| 2026-10-19 | Run calendar starts on the 3rd of a 30-day month | First payday (15th) lands on day 13, not day 1 |
| 2026-10-19 | Pure memoisation caches (classification, slice templates) keyed on the definition object | Big speed win; edits create a new definition object so caches stay correct |
| 2026-10-19 | Circular couplings (I/O RT, CF service, lock index, concurrency) use previous-tick values in `env` | Avoids fixed-point iteration each tick; 10 s lag is invisible at game scale |
| 2026-10-19 | Batch jobs aggregated into one slice per (image, service-class period); grants shared by demand | Same DP fairness as per-job dispatch, far cheaper |
| 2026-10-19 | Played day releases its job network at 06:00; jobs hold until their earliest start | Daytime DEV batch and evening streams share one mechanism; unfinished critical jobs roll into the next day (overlap with online) |
| 2026-10-19 | Midwest has 2 CICS AORs per prod image (qrFrac 0.6) and a CFTEST LPAR sharing the ICF with CF02 | 1 AOR overloaded the QR TCB on day 1; CFTEST makes F8 (low CF02 weight) real |
| 2026-10-19 | Soft cap enforced as a PR/SM cap at DC/msuPerCp engines; capping decided at each 5-min R4HA boundary | Matches "capped until the average drops below DC"; pattern capping's burstiness not modelled (APPROX) |
| 2026-10-19 | While capped, min(1, 4×cappedFrac) of undispatched CPU counts as CAP delay | APPROX attribution; keeps CAP visible in WLMGL and stops WLM chasing it |
| 2026-10-19 | Months are 30 played-calendar days; MLC samples hourly at tick boundaries | Simple, deterministic; ~1.3 bills per standard run |
| 2026-10-19 | Short-engine PR/SM delay coefficient lowered 0.35 → 0.15 | 10–25% PR/SM delay in the Partition Data report was implausibly high |
| 2026-10-19 | Classification rules live inside the Change Desk WLM section, expandable, not a separate tab | User feedback: rules are part of the policy you're editing; keeps the change board and pending banner in view |
| 2026-10-19 | TFP baseline is a committed monthly minimum, not a multi-year pool with rollover | A 40-day run is too short for annual true-ups; keeps the trade-off (lose capping savings, gain cheap growth) visible within the run |
| 2026-10-19 | CF load comes from named structures placed on CFs; lock requests never convert to async | Gives CF placement a real diagnosis path (lock vs GBP) and a trap; per-CF request shares were opaque. Lock part superseded 2026-10-21 (see below) |
| 2026-10-20 | Sonnet subagents `implementer` and `log-reader` in `.claude/agents/` | Save usage on well-scoped coding and log digestion; sim models and balance stay on the main agent (user request) |
| 2026-10-21 | Realism pass: batch jobs age through periods by consumed SU; address spaces sit in their class's last period; type 1 resource groups split their sysplex SU/s budget by demand (was applied in full on every system); MLC bills a capacity group at most its limit | All were divergences from real WLM/SCRT; behaviour-neutral for BASEPOL (no multi-period batch/STC classes, resource groups or capacity groups), so day-1 hash and goldens are unchanged |
| 2026-10-21 | CICS transaction classes: velocity, discretionary or multi-period goals are a warning in the editor, a resource group is a hard error (edit and install refused) | WLM Planning ch. 9–10 / SG24-6472 call the goals "not supported" but document an ISPF error only for the resource group; velocity stays valid on the region STC class |
| 2026-10-21 | IBM-docs realism audit: (1) WLM I/O using is device connect only, disconnect is neither using nor delay; (2) zIIP-eligible batch work in a discretionary period (or Honor Priority NO) never overflows to CPs (batch slices always could); (3) CF lock requests convert to async like cache/list ones, at a higher FICTIONAL threshold | (1) *MVS Planning: WLM* (V2R5) "Velocity formula"; (2) same, "Honor Priority" ("discretionary … never gets help from general purpose processors"); (3) IBM WSC *Heuristic Conversion of CF Operations*: since z/OS 1.2 lock requests are heuristic-eligible. The CF02 lock trap stays: converted lock requests take far longer. Goldens and bench hashes regenerated |
| 2026-10-21 | NEW_APP_GOLIVE stays as is (booking app Retail-judged with an SLA, no forewarning, same minDay); textbook's median below 30 on runs that draw it is accepted | User decision (option a): spotting and classifying new work is part of the game, and textbook by design never diagnoses |
| 2026-10-21 | Browser worker and headless `play` share game-layer helpers (`pendingBase`/`nextPolicyName`, `applyReportClassAdvice`, `runWorkItems`, `renderReport`); `noUnusedLocals` on | The two front ends had drifted copies of the same logic; one copy means one place to fix and test |
| 2026-10-21 | Monitor III audit against *RMF Report Analysis* (SC34-2665, z/OS 2.5) ch. 2: new SYSSUM view holds goals vs actuals and PI (real SYSINFO has no PI); SYSINFO gets its real header (CPs/IIPs online, Avg CPU vs MVS Util%, Appl%/EAppl%/Appl% IIP) and per-period WFL%, Users ACT, AVG USG and avg delayed users; DELAY uses RMF columns (WFL/USG/DLY/UKN, PRC/DEV/STR/CAP) and server waits move from DLY % to UKN %; PROCU shows Time on CP % Total/IIP and EAppl % CP/IIP; ENCLAVE shows class, period, goal, EAppl% and USG/DLY/UNK; CPC shows the real header and Logical/Physical Util % columns (weight, polarity, PR/SM delay kept in a separate table); WFEX gets a Speed section and Name/Reason/Critical val. columns; ENCLAVE shows one line per DDF period (two DDF workloads in one class used to repeat the period's figures, and the DDF chart double-counted them) | Field names and formulas were invented or borrowed from other reports; UKN vs DLY changes how much "delay" a Db2-bound DDF period shows, which is the realistic reading. View-model only: no sim state change, hashes and goldens unchanged |
| 2026-10-21 | VENDOR_PRICE card built on a run-level MLC price multiplier in sim cost state (default 1), changed by card commands | User decision (option 1 of 3): smallest sim change, keeps goldens, reusable by later perks or pacts |
| 2026-10-22 | Monitor III history: 48 h of 100 s intervals, held by the worker outside the run (not saved, not hashed); pins live-only | User request and retention choice. Keeping it out of RunState keeps saves small and goldens stable; the cost is losing history on reload |
| 2026-10-21 | Performance budget: ≤ 2 s per headless day applies to Midwest-size estates; larger estates (Harbourline, 6 LPARs, ~7 s/day) are accepted as they are, no structural perf work for now. ≤ 4 ms/tick is a Midwest target too | User decision. The profile is flat and reaching 2 s on 6 LPARs would need structural changes (fewer per-tick allocations, coarser ticks for quiet LPARs); not worth it yet |
| 2026-10-21 | HiperDispatch: 0 < E < 1 CP gets 1 × VM and the rest VL (was 2 × VM); 1 ≤ E < 1.5 keeps 2 × VM | Claim confirmed by the user (PR #9). DEVT 2VM+2VL → 1VM+3VL, SYSP 2VM → 1VM+1VL on Midwest; goldens and bench hashes regenerated |
| 2026-10-23 | Capacity chart: LPARs from the scenario; one stacked MSU chart per CPC (from the LPARs' `cpcId`, any CPC count; `overlay` series stay lines over the stack) with that CPC's dashed installed CP capacity line (rises with On/Off CoD), plus one R4HA chart for all LPARs; last played day stays on screen until the next day's first sample; `LineChart` end labels spread 12 px apart, shown for up to 8 series | User request 2026-10-22 (Harbourline chart was empty, labels overlapped). Per-CPC charts at user request 2026-10-23: one total capacity line squashed the LPAR lines on multi-CPC estates |
| 2026-10-23 | CI is the merge gate for `dev` and `main`: tests + goldens, a required "Behaviour change" note when goldens change, bench-hash equality for `perf` PRs, and a 5-seed bot sweep inside loose bands when goldens change | Sessions merge unattended, so the gates must be enforced by CI, not by the agent's own report. A valid behaviour change passes (regenerated goldens + note); an unexplained one or a "perf" change that moves the state does not |
| 2026-10-26 | `main` requires the four CI checks but no approving review; Claude merges milestone PRs (merge commit) after a `pr-reviewer` MERGE verdict, and the reviewer posts its report on the PR | Claude acts as the user's GitHub account, so a required approval could never be given (an author can't approve their own PR). The gate is CI plus a more thorough review: base-vs-head bench hashes for both scenarios, determinism re-run, a 10-seed sweep for milestones, adversarial read |
| 2026-10-26 | Daily challenge on the day-1 briefing: a "Daily challenge" button next to Scenario/Difficulty restarts on today's UTC seed; a daily run shows a tag and "Random seed instead", and changing scenario or difficulty keeps it daily | User request: the button was only on the end screen, so a first-time player could not start a daily before finishing a run |
| 2026-10-26 | M9 hold released; M8.6 added (playtesting, UI polish pass, more perks, wider career unlocks) | User request |
| 2026-10-26 | Routing/capping open questions researched against IBM PDFs: group limits only clip bursts with `AbsMSUcapping=YES` (sim matches the NO default); soft capping by positive phantom weight can cut VH/VM (to model); discretionary goal management caps from PI < 0.71 and holds 0.71–0.81 (to model); CPSM routing factors confirmed | User request; the two model changes are listed in CLAUDE.md "Pending realism changes" so the next model session picks them up |
| 2026-10-26 | Last two routing questions settled from books the agent now fetches itself (IP Configuration Guide, CPSM Managing Workloads, SG24-7621): SERVERWLM is zIIP-aware by default (realism change queued in CLAUDE.md); CPSM abend recovery matches the sim's shape, decay rate undocumented; `storm-drain` Codex thresholds corrected | User request |
| 2026-10-26 | Pending realism changes moved from CLAUDE.md to PROGRESS.md "M8.7 Realism fixes"; CLAUDE.md keeps only the rule for where they go | User: CLAUDE.md was a misstatement; to-dos belong with the milestones |
| 2026-10-26 | New `docs/research.md` ledger: one row per confirmed fact with a PDF page link and the sim status; settled research moved out of Open questions; SPEC §17 points to it, §18 stays the bibliography | User asked for one central place for researched facts. Pages re-checked against the 3.1 books; SPEC §17 "Discretionary capping conditions: Real" row dropped (the conditions are only partly modelled) |
| 2026-10-26 | Discretionary goal management caps from PI < 0.71, stays capped below 0.81, cap = 1 − (0.81 − PI), floor 50 % (was 0.7 / 0.9 / flat 80 %) | M8.7: real WLM holds capped work's PI in 0.71–0.81 (SG24-6472-03 p.183). Proportional cap is APPROX of WLM's projection; balance check deferred to the post-sweep re-sweep |
| 2026-10-26 | Routing `WLM{ziipAware}` → `WLM{distMethod}`: BASEWLM weighs systems by idle CP capacity, SERVERWLM by the CP/zIIP composite of displaceable capacity; Harbourline B3 recast as the distributor left on default BASEWLM | M8.7: SERVERWLM is zIIP-aware by default and BASEWLM is the default method, CP-only without PROCTYPE (IP Config Guide 3.1 p.555–556), so B3's puzzle keeps its fix with a real name. PROCXCOST not added: no crossover-penalty lever needed for B3. Harbourline hash changes; balance check deferred to the re-sweep |
| 2026-10-26 | Event deck draws from its own RNG stream per (seed, day), not the shared run RNG | Change failures, activation failures, AIOps hypotheses and drafts rolled the same stream, so any extra bot action reshuffled every later event and seed-by-seed comparisons of bot variants were invalid (seed 18 diverged on day 21 after one CoD rental). Win rates over independent seeds before this stay unbiased but carry ~±10 pp noise at 20 seeds; per-seed claims and small variant deltas made before this are unreliable. Goldens regenerated; balance sweeps re-baselined after (user decision). |
| 2026-10-26 | Every game roll gets its own keyed stream (`streamRng(seed, purpose, …key)`): events by day, draft by day, change and activation failures by day + label + attempt, AIOps by tick + workload, inquiries by ask tick + topic; `RunState.rng` removed | The event-only split (#41) still left the draft, failure, AIOps and inquiry rolls on one stream: in a paired sweep, seed 13's CoD rental shifted its day-9 draft (MENTOR instead of BELT_AND_BRACES) and the run lost ~4 trust on every facet from that alone. With keyed streams, seed 13 base and CoD draw identical events and drafts and differ only after the rental. Goldens regenerated; the paired sweep from #41 was stopped and is re-run on this. |
| 2026-10-27 | Hardware engine adds and their reverts are relative (`ADD_CPC_ENGINES` delta, clamped ≥ 0); capacity-setting changes stay absolute | On/Off CoD reverted with "set N" computed when the lease was requested, so a lease taken over a pending or overlapping change lost or kept a CP for good (spendtowin bled CPs on Harbourline). Deltas compose in any order. Goldens unchanged |
| 2026-10-27 | CPU_CAPACITY also when an image used ≥ 95 % of the CP available to it (online logical CPs, entitlement + white space), not only when its CPC was ≥ 90 % busy; the donor test is unchanged. Harbourline PRD images define 2 reserved logical CPs | User decision 2026-10-27. Seed 7 Harbourline: PRDA–PRDD sat at their logical CPs (13 of CPC1's 14 CPs, 10 of CPC2's 10) and the incidents read CPU_PRIORITY once a new CP lowered CPC busy to 86–89 %, the wrong clue. With no reserved CPs and no IPL lever a bought or rented CP could never reach production |
| 2026-10-27 | The expert bot buys a permanent CP (PERM_CP) after CPU_CAPACITY incidents on 2 days within 7 on one CPC, then raises prod logical CPs by 1; On/Off CoD variant not adopted | User decision. 20-seed sweeps: same ends as the base expert in all three scenarios; the CoD variant cost Harbourline seed 11 an opex end |
| 2026-10-27 | M8.1 closed: the performance gate is ≤ 4 ms per tick in the worker; ≤ 2 s per headless day is no longer a target | User decision. No hash-neutral optimisation above ~3 % is left, (2) and (5) were rejected, and the UI budget already holds. CLAUDE.md and SPEC §15 updated |
| 2026-10-27 | M8.2 closed: bot balance done; sweeps become a regression check (CI 5 seeds, 20 to confirm) | User decision. Do-nothing, textbook and spendtowin hold in all three scenarios; expert wins 19/20, 20/20, 16/20 |
| 2026-10-27 | Finding D: every run starts with 15 insight (`INSIGHT.starting`), was 0 | User decision among four swept options; bot outcomes unchanged, Monitor III affordable on day 1 |
| 2026-10-27 | Finding I: RCA guessing may pay; no change | User decision |
| 2026-10-27 | Finding J: GOODWILL (+4 trust with every stakeholder) stays as is | User decision; a draft reward's cost is the cards not picked |
| 2026-10-27 | RCA truth credits THREAD_LIMIT only with MXT/DBAT queueing beyond the in-region growth | Little's law: slower tasks hold MXT slots longer, so the queueing is mostly a symptom of CPU or QR TCB delay (playtest findings N, O) |
| 2026-10-28 | Finding Q: new RCA mechanism ROUTING, declared by a card for failure-only misses (SICK_AOR) | User decision; no delay grows when a region fails work fast, and DEPENDENCY means a slower server |
| 2026-10-28 | Finding R: CICS view shows DISP−CPU (incl. the CPU backlog wait); WLMGL CPU delay stays per dispatchable unit | User decision after a check against the RMF, WLM and CICS books (`docs/research.md`) |
| 2026-10-28 | Findings S–W: strain hints ignore thin response-time intervals (< 20 ended) and batch classes; ask allowed in REVIEW; play CLI gets `policy`, `restart`, abend stop on `advance` | Round 3 agents missed abends and chased hint noise; batch already has its own window hint; REVIEW asking matches planning a change there |
| 2026-10-28 | Harbourline day 0 gets a handover mail naming the 09:00 open, PRDA's absolute cap and Partition Data; X's report-card and GOODWILL notes kept as they are | User: soften D1 with a clue rather than a trust grace or a weaker burst; the first miss now has a clue path (CLAUDE.md: no gotcha without one) |
| 2026-10-28 | Pins from past Monitor III ranges; the play CLI keeps only the pinnable values (option A), 48 h at the browser's interval, beside the run file | User choice over full views (≈ 18 MB binary on Harbourline) or views inside the run file (≈ 120 MB): ~5 MB, +~0.5 s per CLI day, run file stays small for spectator polling |
| 2026-10-28 | Monitor III MINTIME 120 s (was 100 s, the RMF default) | User request. History and the CLI record every 12 ticks; the live view's smoothing is unchanged, so no golden moves |

## Open questions

- Settled research (sysplex routing and capping, 2026-10-26, and everything earlier) is in `docs/research.md`. Only
  open items stay here.
- CICS transaction classes with velocity or multiple periods: the editor now warns (WLM Planning says "not supported"),
  but the sim still splits such work like DDF. IBM documents no runtime behaviour for this case; model it if a source turns up.
- RMF Partition Data shows PR/SM absolute capping somewhere; the sim's ABS CAP column (engines, next to DEF CAP) is an
  APPROX of its name and place. Check the real report layout (*RMF Report Analysis*, Partition Data Report).

- CICS_SOS (loop 105) is modelled as an effective MXT cut, so a player who raises MXT on the PROD2 AORs clears it. Real SOS gets worse with a higher MXT. A proper fix needs a DSA storage model (or a lock on MXT while the card runs).
- Monitor III CAP column: the sim's capping delay mixes WLM resource-group capping (RMF RG-Cap) with work held back by
  a soft-capped image. On a real system the latter probably shows as processor (PRC) delay, since PR/SM just stops
  dispatching the logical CPs. Unverified; the DELAY report keeps one CAP column.
- Monitor III MVS Util% is derived as LPAR util ÷ (1 − short-engine wait) (APPROX). Real MVS busy also differs from LPAR
  busy through HiperDispatch parking and wait-completion settings; check against the CPU Activity report docs.
- Period switching sums CP and zIIP seconds × SU/s without normalising zIIP time to CP speed (APPROX).
- Resource group minimum for discretionary members: what exactly counts as "missing goals"? Modelled as delay > using.
- CICS: does WLM/RMF response time include MXT queue time? Currently treated as outside the work
  manager (like DBAT queueing before enclave creation). Verify against CICS performance docs.
- Policy-adjust projections don't model backlog/DBAT feedback, so WLM sometimes places batch above
  DDF while DDF is happy and then can't undo it quickly. Realistic in spirit, but watch in balancing.
- Percentile PI edge cases: how exactly does WLM handle periods with very few completions
  (minimum-sample rules)? Currently an EWMA with a variable horizon. Check *MVS Planning: WLM*.
- WLM-managed initiator start/stop heuristics: the JES2 Init & Tuning Guide "queue delay
  measurements" section wasn't reviewed yet.
- ~~R4HA after IPL~~ settled: *MVS Planning: WLM* says WLM starts with a four-hour window containing no usage, i.e. 48 zero slots, as modelled.
- TFP details (baseline commitment, overage pricing) are left deliberately abstract; is
  that enough for the strategic choice to feel real?
- Should two-CPC topologies (cross-site sysplex) be in the base scenario or saved for the
  airline scenario?
- Tuning target for "fun density": how many meaningful decisions per live day? (Target: 3–6
  alerts that matter, 1–2 incidents in Act II+.)
- Waiting on the user: nothing open (M9 released 2026-10-26). (VENDOR_PRICE: decided option 1, sim price multiplier, 2026-10-21.) (Booking go-live: decided (a) keep, 2026-10-21.)

## Risks

- **Model complexity vs performance:** policy-adjustment projections re-run the evaluator
  (≤2 receivers × ≤6 trials per system per tick). Midwest ~2.6 s, Harbourline ~5.3 s per headless day.
  Fine for the UI (4 ms/tick budget); the 2 s/day target was closed (M8.1, user 2026-10-27).
- **Opaque cause and effect:** if players can't see *why*, it feels random. Mitigate with clue
  design rules (SPEC §13.3), the WLM Activity log, morning hints and the Codex.
- **Balance whack-a-mole:** keep bots and golden runs green; sweep ≥ 20 seeds before tuning.

## Lessons (tooling)

- `pgrep -f` / `pkill -f` loops match their own command line (exit 144 kills the shell); wait on files or PIDs,
  stop with task IDs or `fuser -k`.
- ScheduleWakeup wakeups failed to fire twice (loop 50); the build loop schedules with `send_later` plus an
  hourly watchdog.
- The cloud box is noisy (±10–20%); compare perf old vs new back to back with esbuild bundles, and prove
  behaviour-neutrality with `npm run bench -- --hash`.

## Session log

Newest first. Entries before loop 48 are summarised in the milestones above; see git history for detail.
- **2026-10-28:** Milestone merge `dev` → `main` (PR #72, merge commit): pr-reviewer MERGE, 430 tests, hashes Midwest
  `fef4fa052462d635` / Harbourline `a1984addb2403be0`, 10-seed Normal Midwest sweep do-nothing 16 / textbook 28 /
  expert 9 of 10 wins. Health-line hashes updated. Follow-up idea: scale `balanceGate.ts` bands by seed count.
- **2026-10-27:** Play CLI fixes from playtest round 1 (M8.6). `rca` now says which half was right, the true
  mechanism/trigger and the trust effect. Times read `D1 Tue 00:30` (played day plus calendar weekday). RMF intervals
  have stable ids (end time in 5-minute slots) in `status`, `report`, `pin WLMGL` and incident lines, and `report`/`pin`
  respect the fog of war (today's intervals need Monitor III), as the browser does. Bare class names mean period 1;
  unknown rows list the valid keys. `status` shows the last completed hour's SLA when the current hour has no data
  and the PI > 1 rows of the latest interval. `mon3 [system] [--json]` prints SYSINFO/CPC/DELAY/WFEX tables;
  `smf` takes `12` or `D8 12`, lists hours by label and prints tables (`--json` for raw rows). REVIEW staging and
  empty `--evidence` messages say what to do; the SET_PERIOD error names the 0-based index and `docs/agents.md` uses
  `"period":0`. Goldens unchanged.
- **2026-10-27:** Play CLI fix: `new` crashed on every fresh run file (`apply()` read `file.run` before the `new` case), found by the first agent playtest round, which could not start. `new` now runs first and refuses an unknown scenario instead of silently falling back to Midwest; usage and `docs/agents.md` list `harbourline`. Goldens unchanged.
- **2026-10-23:** VENDOR_PRICE card (`SET_MLC_PRICE` → `cost.priceMult`, sub-capacity MLC ×1.08; fix `NEGOTIATE_MLC_PRICE`). Hashes unchanged (`be43ff16de564882`), 377 tests. Sweep seeds 1–5 (Normal, Midwest; card drawn in 8 of 15 runs): do-nothing 12 / 16 / 22 (batch 2 · trust 3), textbook 24 / 27 / 28 (batch 4 · trust 1), expert victory 5/5; inside the bands.
- **2026-10-23:** CI added (`.github/workflows/ci.yml`, `pr-gates.yml`, `tools/ci/`, PR template) for the per-session-branch → `dev` auto-merge workflow. Balance bands checked against current `dev` (seeds 1–5): do-nothing 12 / 16 / 22 (batch 3 · trust 2), textbook 22 / 26 / 28 (batch 3 · trust 2), expert victory 5/5; all inside the bands, 15 runs in ~7 min on 4 cores. Waiting on the user for the GitHub settings (default branch, branch protection, auto-merge).
- **2026-10-21 (loop 117):** revenue balance: REVPOL WEBDDF importance 3 → 4 (flaw G1); do-nothing median 22 → 14
  (seeds 1–10), textbook unchanged at 29. Heavier analytics tried first: no effect, reverted.
- Older entries (loops 48–139 and earlier): `git log -p -- PROGRESS.md`.
