# PROGRESS.md

Status tracker for **GOAL MODE**. Update at the end of every working session.
Finished work is summarised; the full per-loop detail is in git history (`git log -p -- PROGRESS.md`).

## Current status

- **Phase:** M0–M7 and M8.9 done; M8 in progress; M9 released (user, 2026-10-26). Playable in the browser
  (`npm run dev`); published build: https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv (private; republish on request).
- **Last updated:** 2026-11-02
- **Next up:** a human UI playtest (M8.6), M8.4 events (27 in the deck; more only if a playtest asks for one). M8.1 and M8.2 closed (2026-10-27).
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
- **Health:** `npm run check` green (488 tests). Headless (cloud box): bench day 1 4.6–5.3 s (0.53 ms/tick).
  Bench hash (seed 42, 1 day) Midwest `b1aa42059d46952e`, Harbourline `c47f6b8416f440f8` (dev after #111, 2026-11-02).
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
- [x] ~~RMF interval < 15 min needs the tool~~ dropped: the Postprocessor interval is just SMF INTVAL on real systems
- [x] PROCU is per service-class period, not per address space (slices are not kept per tick). Add top address
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
- [x] Events to ~25 (SPEC §9); 27 now (deck complete; more only if a playtest asks for one). Since M5: REORG_OVERRUN, CF_FAILURE, SHADOW_IT, QR_RELEASE,
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
- [ ] Each scenario ships with its own flaw list (SPEC §13.3 rules) and story beats (done for Midwest, Revenue and Harbourline; applies to Continental and Global Airline when built)
- [x] *State Revenue Agency* playable (SPEC §13.4): scenario packs (`content/packs.ts`, `--scenario revenue`, picker in
  the new-run dialog and day-1 briefing), per-scenario facets, flaws G1–G3/H1–H2, story beats, 16-card agency deck.
  Follow-up: textbook's day-22 PREFILL losses (its PFILAPI class still misses)
- [x] Scenario (user request 2026-10-21; built as Harbourline Bank): **large bank, big mainframe estate**, a harder run for experienced players.
  - **Estate:** several CPCs and many LPARs and sysplex members.
  - **Analytics at the start:** some tools are unlocked from day 1, so the challenge is diagnosis, not visibility.
  - **Harder problems.** Two the user named:
    - **Strongly spiky online workload:** bursty arrivals well above the hourly mean (e.g. flash events, open-of-market).
      WLM's 10 s adjustment and R4HA/capping lag behind it, so the player has to choose between headroom, goals that
      tolerate bursts, and capping (e.g. defined capacity vs. absolute cap).
    - **Workload-balancing issues across the sysplex:** sysplex distributor / CICSPlex SM routing and WLM routing
      recommendations send work to the wrong images, through skewed weights, a sick-but-alive region (storm
      drain) or uneven zIIP capacity. Fixes trade affinity against even load.
  - [x] **Needs** (all built): a multi-CPC world (the hardware catalog and HMC assume one CPC), finer-than-hourly arrival bursts in
    the workload model, and routing that reacts to image health.
  - [x] Design: SPEC §13.5 "Harbourline Bank" (2 CPCs, 6 LPARs, starting tools; Problem 1 spiky markets work with
    four fix families; Problem 2 flaws B1–B4: static SD weights, storm drain, CP-only WLM weights, CF locality; build
    order multi-CPC → burst arrivals → routing policies → content)


**M8.6 Playtesting, polish & progression (user request 2026-10-26)**
- [x] Playtesting: human and agent playtests on all three scenarios (`goal-mode-player` and the persona agents for
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
- [x] UI polish pass: consistency of panels, spacing, labels and empty states; phone width; follow-ups from playtests
  - 2026-10-28, PR 1: `tools/screenshot.mjs` launches the pre-installed Chromium (`<outDir> [light|dark|3270] [--all]`);
    Change Desk "Systems, CF & I/O": DASD, Db2, MQ and CICS are setting rows in a column grid (name, input, now,
    actions) and Db2, MQ and CICS are separate sections. UI only; bench hashes unchanged.
  - 2026-10-28, PR 2: Codex "?" hints are labelled pills ("? PI", "? velocity", ...) in one `.hints` group after each
    title; one `Empty` style for every panel's empty state (Operations log and Inbox had none); the locked-view notes
    ("Analytics tab") are buttons that switch tab (callback from `App.tsx`); tabs share one `.page` gap instead of
    per-panel margins; Ops Console: Incidents, Operations log and Batch window stacked in one column. UI only.
    Not done: phone-width pass on the new setting rows (they scroll sideways inside their panel)
- [x] Multi-CPC views (user request 2026-10-28; done: Mon III CPC report shows a section per CPC with its own L:P, HMC LPAR picker groups by CPC; single-CPC scenarios unchanged): when the estate has more than one CPC (Harbourline), the Monitor III
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
- [ ] **Work at an equal DP should share CPU by ready units, not by demand.** The dispatcher splits a DP level's
  grant in proportion to each period's CP demand, backlog included, so a backlogged class crowds out light work at
  the same DP. Found 2026-11-02 (#111, Harbourline expert seed 9 day 29): MKTORD at FC drags all CICS work on PRDA
  to FC (free ride), tying with Db2 in STCHI; ONLHI's 13-engine demand on a 6.9-engine LPAR leaves Db2 about 40 % of
  its want, and everything waiting on Db2 stalls for 6 h. Real z/OS dispatches equal-priority work from one queue,
  a time slice per ready unit, so Db2's few busy SRBs/TCBs would keep a fairer share (APPROX today). Model a
  per-DP share by active units (or cap a period's share at its dispatchable units), then re-sweep. Changes goldens.
- [ ] **CICS transaction classes report work manager states, not using and delay samples.** For CICS and IMS,
  resource usage and state samples go with the regions' service classes; transaction classes get the work manager
  section (ACTIVE, READY, IDLE, WAITING FOR…, BTE/EXE) (*WLM Planning* 3.1, p.113; *RMF Report Analysis* p.536–537).
  The sim's WLMGL posts CPU using and delay on CICS transaction classes. Changing it moves the WLMGL report, the
  DELAY_CPU pins and the hints that point at them (playtest finding R, 2026-10-28).
- [x] **CICS/IMS regions must follow their transactions' goals.** Done 2026-11-01: "Manage Region Using Goals Of" per STC/JES rule (TRANSACTION, REGION, BOTH); in TRANSACTION the AOR/TOR address spaces' CPU dispatches at the most important CICS transaction class's DP and their samples leave the region class's managed PI (still reported); REGION/BOTH dispatch as the old REGION mode, and with every region REGION the transactions' completions reach only their report classes (*WLM Planning* p.103); old saves fall back to policy-wide `cicsRegionMode`. Decided 2026-10-31 (user, #111 Q1): model it, as
  its own PR, merged before item 15. By default WLM manages CICS/IMS regions to the goals of the transaction service
  classes they serve; REGION mode on the classification rule keeps the region's own goal (*WLM Planning* p.122;
  SG24-7621 §3.30–3.32; `docs/research.md`). The sim bills transaction CPU to ONLHI and region CPU to STCHI
  separately and sets each DP on its own, so raising ONLHI starves its own regions (#111, seed 7 15:00: STCHI PI
  0.69 → 31.9). Plan: a region class's DP and projection follow the most important transaction class it serves
  (server topology), with an optional REGION mode; overlaps the work-manager-states item above. Cross-layer
  and shifts balance in all three scenarios: sweeps needed.
- [x] **Equal-importance moves must narrow the PI gap.** Done 2026-10-30 (fix 20): `passes()` rejects a move whose projected gap to a harmed equal-importance class doesn't shrink; Midwest seed 7 PROD2 09:00–10:30 TSO#2/DDFPRD#2 moves 15 → 5, donor moves between them 6 → 1, no ED↔EB swaps (both now climb); goldens moved; sweeps below. When receiver and donor have the same importance and both
  miss, WLM brings their goal achievement closer together (SG24-6472 p.60); Enrico's test: the receiver's gain beats
  the donor's loss *and* the projected PIs end up less far apart (*How WLM Works*, slide 52; `docs/research.md`). `passes()` (`src/sim/wlm/adjust.ts`) checks
  only the first. Midwest seed 7 on dev: TSO#2 and DDFPRD#2 (imp 4) swap ED↔EB on PROD2 every 1.5–8 min from 09:20
  to 10:12, with DDFPRD#2 PI swinging 1.4–8.2; draft #111 shows the same pair FB↔F4 for hours on PROD1. Fix: add
  the disparity test (max of the two projected PIs must fall). Moves goldens; sweep.

Harbourline seed 42 realism audit (2026-10-28; experiments and numbers in `runs/lab/2026-10-28-harbourline-s42-audit.md`,
local only). Do these in order, each as its own PR; the first two are user-ordered.
- [x] **1. A resource group max on a server region must slow its dependents (do first).** Done 2026-10-29: health
  is `got / (want + cut)`; realism test added; goldens unchanged (no shipped policy caps a server region by default). The cap works by making
  the group's work units non-dispatchable for some time slices (*WLM Planning* p.60 note 4, p.57). Audit: STCHI
  (CICS/Db2/MQ regions) at 2 % max fell from 51.7 % to 11.8 % use, yet MKTORD went 48 → 45 ms. Cause:
  `prepareLpar` cuts the slice's demand (`sliceCut`, `src/sim/wlm/evaluate.ts:360-367`), then sets
  `want = sliceCp + sliceZi` from the cut demand (`:481`), so `health = got/want` stays 1, `roleHealth` never drops
  and neither `depDelay` (`:572`) nor batch dependency stretch sees the cap. Fix: health against `want + cut` (the
  response-time path already uses `want + cut`, `:562`). This also lets discretionary caps reach dependents, which
  is the same mechanism. Realism test: "RG max on the Db2 region class raises dependent transaction RT".
- [x] **2. A resource group on the CICS AOR class must cap the transactions that run in it (after 1).** Done
  2026-10-29: `hostRole: 'CICS.AOR'` on CICS workloads; `resourceGroupCaps` membership by host-region CPU share; test
  added; goldens unchanged. You cap CICS
  transactions by putting the resource group on their regions (*WLM Planning* p.60 note 1); transaction CPU is
  consumed in the regions, AORs most of it (p.122, p.130). The sim keeps transaction CPU in TXN slices classified by
  transaction class (`src/sim/workload/slices.ts`); the AOR slices carry only their base CPU, and no workload lists
  `CICS.AOR` as a server, so fix 1 does nothing for an AOR cap.
  - Content: optional `hostRole` on `WorkloadDef` (`'CICS.AOR'` for CICS workloads, the MPR role for IMS); unset for
    DDF, which runs in enclaves under its own service class.
  - `resourceGroupCaps` (`src/sim/core/step.ts:1243`): a TXN slice is a group member in proportion to the share of
    its LPAR's host-role regions in the group. The existing `capOf`/`cut` path does the queueing and timeouts.
  - **No double penalty:** a transaction's own host role does not also add `depDelay`; the cap on its CPU is the one
    effect (the documented mechanism). `depDelay` stays for true server roles (TOR, Db2, MQ). If a capped AOR
    should hurt more, tune a `content/` coefficient, not a second path.
  - APPROX notes: CAP delay posts on the transaction class, not the region class (see the finding R item above);
    with only some AORs in the group, the proportional share ignores CPSM routing away from them.
  - Perf: one O(slices) pass per tick, only when a group has a max (`resourceGroupCaps` returns early otherwise).
- [x] **3. MAXDBAT and MXT must queue without bound once offered load exceeds the limit.** Done 2026-10-29:
  `slotQueueStep` (`src/sim/subsys/slots.ts`) with a persistent queue per LPAR, timeouts in `content/subsys.ts`, MXT
  10–2000 in `SET_CICS`/`ADD_AOR`; CICS_SOS now cuts MXT to 10. THREAD_LIMIT RCA tests still pass. Goldens moved. Db2 queues further
  processing until an active DBAT ends (*Db2 13 Installation* p.212) and bounds the queue with MAXCONQN/MAXCONQW
  (p.213, p.365); CICS MXT is 10–2000 and a too-low MXT causes "excessive queuing delays" (*CICS Performance* p.89).
  Audit: MAXDBAT 1 on all members (≈ 10 DBATs wanted on PRDB) only took MKTQRY 51 → 116 ms, SLA 98–99 %, 0 failures;
  MXT 1 the same for RETAIL. Cause: `dbatQueueWaitSec` / `mxtQueueWaitSec` (`src/sim/subsys/db2.ts`, `cics.ts`)
  return `(rate·rt − limit)/rate`, always below one service time. Fix: throughput ≤ limit / rt (Little's law);
  excess arrivals go to the slice backlog, waits grow and fail at the workload timeout (DDF: a MAXCONQW-like
  timeout in `content/`), plus Erlang-C wait below saturation (`src/sim/zos/erlang.ts`). Reject MXT < 10 in
  `SET_CICS` (`src/game/commands.ts`). Re-check the THREAD_LIMIT RCA rule (decision 2026-10-28) against the new curve.
- [x] **4. CF service per connected system with a link-distance term (planted flaw B4).** Done 2026-10-29:
  `cfServiceForSystem` (`src/sim/cf/cf.ts`), `CpcConfig.siteKm` (Harbourline CPC2 15 km), per-LPAR `cfServiceSec`,
  CONNECTED SYSTEMS in CF Activity. Midwest behaviour unchanged (state gains `env.cfBySystem`); Harbourline moved. RMF CF Activity reports
  requests and service times per connected system and estimates link distance as round-trip µs ÷ 10 µs/km
  (*RMF Report Analysis* p.376, p.378). SPEC §13.5 B4 promises slower lock waits and higher async % on PRDC/PRDD.
  Audit: sync service 23.3 µs on every system, 0 % async; routing PAYMENTS near-only 182 → 192 ms. Cause: one
  plex-wide `cfServiceSec` (`src/sim/core/step.ts:150-158`), no distance in `src/sim/cf/cf.ts`. Fix: CPC → CF
  distance in content (Harbourline 15 km), per-system sync service = base + 2 × 5 µs/km × km (FICTIONAL base;
  10 µs/km round trip is the doc's figure), the existing sync→async heuristic per system, `cfServiceSec` per LPAR,
  and a SYSTEM breakdown in the CF Activity report. Moving LOCK1 or duplexing it must then change PRDC/PRDD.
- [x] **5. Partition capping fields must report only capping.** Done 2026-10-29: `cappedFrac` counts only a binding cap's removal against an uncapped allocation; new `softCappedFrac` feeds Partition WLM% (column renamed from CAPPED%) and Monitor III WLM Capping %; LPAR capping now posts CPU delay, WLMGL CAP delay is RG/discretionary only (folded in). Partition Data CAPPING shows DEF (Y/N for Initial
  Capping, absolute HW cap, HW group cap) and WLM% = time WLM capped the partition (*RMF Report Analysis* p.401;
  Monitor III CPC "WLM Capping %", p.98). Audit: with 6 CPs, an absolute cap of 6.0 delivered the same 3.05 engines
  as no cap, yet CAPPED% read 56.4 vs 0. Cause: `cappedFrac` in `src/sim/hw/pools.ts:145` is
  `(want − delivered)/want` whenever the cap is below demand, so PR/SM contention counts as capping. It also feeds
  WLMGL's CAP/CPU delay split (`evaluate.ts:494`), CPU incident detection (`src/game/run.ts:554`) and Monitor III
  WLM Capping % (`src/game/mon3.ts:324`). Fix: count the cap only when it binds (delivered ≥ cap − ε), and only the
  part the cap removed (uncapped allocation − delivered; one extra `allocatePoolDetailed` call per pool without
  caps); keep soft (WLM) capping and PR/SM absolute capping in separate fields, WLM% from soft capping only, and
  show absolute capping as the DEF flags. Same audit: WLMGL posts LPAR soft-cap delay as CAP, but RMF's CAP delay is
  resource-group and discretionary capping only and "NOT part of the CPU delay" (p.540); LPAR capping shows as CPU
  delay plus Partition WLM%. Fold that into this change (it is the `capFrac` split) or queue it right after.

Audit round 2 (2026-10-29, Harbourline seed 42; `runs/lab/2026-10-29-audit-r2.md`, local only). Not ordered yet.
- [x] **6. zIIPs offline must not inflate response time.** Done 2026-10-29: with no zIIP online the dispatcher reports the CP queue ratio (plus PR/SM delay) for the eligible work; dispatcher unit test added. With zIIPs defined but offline, eligible work runs on CPs
  as if it had no eligibility (*Init & Tuning* p.431). Audit: PRDC/PRDD zIIP logicals 3 → 0 took MKTQRY 48 → 82 ms,
  MOBILE 68 → 106 ms and ADHOC 2.8 → 36.7 s (still 36.4 s at 23:00 on an idle LPAR); the CP side is right (IIPCP
  filled, PRDC 3.39 → 3.73 CP engines). Cause: zero zIIP capacity gives rho = 1 (`src/sim/zos/dispatcher.ts:86`),
  the zIIP queue ratio clamps at 50 (`src/sim/wlm/evaluate.ts:505`) and RT bills `ziipSecPerTxn × (1 + zq)` (`:584`).
  Fix: with no online zIIP, zq = 0 and the eligible seconds are billed at CP speed with the CP queue ratio. Unit test
  on the dispatcher with zero zIIP capacity.
- [x] **7. WLM-managed initiators must add initiation delay to velocity.** Done 2026-10-29: queued jobs in WLM-mode classes add one `delayQueue` sample per tick to their class's first period (WLMGL QMPL column); realism test added. Initiator start rate/threshold left as is. Velocity's delay includes "initiation
  delays for batch jobs in WLM-managed job classes" (*WLM Planning* p.70, p.39 note 1). The size is the jobs' time
  on the queue (waiting for an initiator, class limits, affinity, operator holds), and with large queues it "can
  dominate the response time or velocity" (*JES2 Init & Tuning Guide* p.113–114). WLM reads it every 10 s policy
  interval and starts up to five initiators per interval on unconstrained systems, but on a system over 95 % busy only
  for work important enough to displace running work (SG24-6472-03, Mar 2008, p.211). Audit: class A at one
  initiator per system gave byte-identical WLMGL rows in JES and WLM mode (BATCHPRD velocity 94.5 %, PI 0.32) while
  critical jobs lost 10 770 s waiting for an initiator. Cause: queued jobs are in no slice
  (`src/sim/batch/batch.ts:139-176`) and `evaluate.ts` has no initiation-delay term. Fix: in WLM mode, queued jobs add
  delay samples to their service class (APPROX: one per queued job), so WLM sees the miss and raises initiators
  toward demand; JES mode stays invisible to velocity.
- [x] **8. Storage Critical must cost the unprotected work.** Protected work loses storage only to equal or more
  important work, and IBM warns it can reduce throughput (*WLM Planning* p.119). Audit: PRDA at 60 GB, STCHI storage
  critical: STCHI storage delay 37 → 0 %, velocity 61.6 → 92.1, every other class unchanged. Cause: paging is one
  image-wide fraction and `evaluate.ts:514` zeroes it for protected classes without moving it anywhere. Fix: keep the
  image's paging pressure constant and spread the protected classes' share over the unprotected ones (more to lower
  importance). A free lever breaks the "every lever has a cost" guardrail.
- [x] **9. Implicit CPU protection (IEAOPT CCImp, default 1 in z/OS 3.1).** CCImp=1 gives CPU protection to
  importance-1 single-period classes and first periods without CPU Critical; CCImpBoost (default 2) applies while a
  boost is active (*Init & Tuning* p.428). Audit (PRDA/PRDB at 4 logical CPs): MKTORD (imp 1) sat at DP 250 below
  TSO#2 (imp 5) and STCMED (imp 3) at 252; with CPU Critical on MKTORD it went 98.1 % / 109 ms → 99.7 % / 46 ms.
  Cause: `adjust.ts:84-92` checks only the explicit flag; no CCImp in the IEAOPT config. Fix: `ccImp` in the IEAOPT
  config (scenario content picks the value; the 3.1 default is 1), applied in `violatesCpuCritical`. A balance change:
  importance-1 work gets protected for free, so re-sweep and decide per scenario whether its world is pre-3.1
  (CCImp absent, effectively 0) or 3.1. Changes goldens.
- [x] **10. WLM edits must reject invalid goals and flags.** CPU Critical needs a single-period, non-discretionary
  class (*WLM Planning* p.120); velocity and percentile are 1–99, response time 1 ms–24 h (p.67). The sim accepts CPU
  Critical on two-period MKTDDF and discretionary DEVBAT, velocity 0 and 100, percentile 100, and AVG 0 s (WLMGL then
  prints `PERF INDX Infinity`). Fix: checks in `src/game/wlmEdit.ts` (`SET_FLAGS`, goal edits) with the doc's
  wording in the error. Same item (audit r3): SYSSTC is valid only in ASCH, JES, OMVS, STC and TSO rules, SYSTEM only in
  STC for high-dispatching-priority address spaces (*WLM Planning* p.102); `knownClass` (`wlmEdit.ts:264`) allows
  both anywhere (`ADD_RULE`, `SET_RULE_TARGET`, `SET_DEFAULT`). DDF → SYSSTC took Midwest ONLHI velocity 76.9 → 9.3.
  Audit r4: rules must use qualifiers valid for their subsystem (*WLM Planning* p.78 note 1, Table 7) and a
  qualifier cannot be nested in itself unless it is longer than 8 characters (p.99); `ADD_RULE` accepts TN on DDF, PK
  on TSO, TC on STC, a 12-character pattern and TN under TN, all of which never match. CLI only: `SET_PERIOD` accepts a
  null or negative duration and importance 9.

Audit round 3 (2026-10-29, Midwest seed 42; `runs/lab/2026-10-29-audit-r3.md`, local only).
- [x] **11. A resource group minimum on discretionary work must not override goal work.** For goal work below its
  minimum WLM helps even at the cost of more important work; for discretionary work only "if that action does not
  cause other work to miss its goal" (*WLM Planning* p.59). Audit (CP=7, DDFPRD period 2 DISC, type 2 minimum 30):
  RBANK 99.7 % / 63 ms → 73.7 % / 3 704 ms, TELLER 100 → 65.6 %, ONLHI velocity 76.9 → 24.1. Cause: `missingGoal`
  (`src/sim/core/step.ts:1210`) counts a DISC period as missing when delay > using, and `rgMin` lifts it at
  `RG_MIN_DP = 252` (`src/sim/wlm/evaluate.ts:326`), above all managed work. Fix: a DISC period's minimum is served
  only from capacity no goal period that misses its goal wants (dispatch it below managed work); goal periods keep DP 252.
- [x] **12. Lowering MQ MAXDEPTH must not discard queued messages.** Messages already on the queue above a reduced
  MAXDEPTH "remain intact"; only new puts fail (*MQ 9.4 Administration Reference* p.463, p.636). Audit (Midwest CP=5,
  PAYMQ MAXDEPTH → 100): the backlog fell from 19.4 s to 1.1 s of work in one tick with 0 completions; PAYMQ RT
  30.2 → 8.7 s. A free, instant backlog flush. Cause: `evaluate.ts:555-558` truncates `newBacklog` to the cap every
  tick. Fix: fail only this tick's arrivals beyond the cap, keep the excess and let it drain. Also allow MAXDEPTH 0
  (`src/game/commands.ts:379` refuses it; z/OS range 0–999 999 999).

Audit round 4 (2026-10-29, Revenue seed 42; `runs/lab/2026-10-29-audit-r4.md`, local only).
- [x] **13. Classification masks and wildcards must follow WLM syntax.** `%` masks one character (at the end it may
  also match nothing); `*` is a wildcard only in the last position or alone and a literal anywhere else (`CI*S`
  matches only `CI*S`); there is no `?` (*WLM Planning* p.104). `compileWildcard` (`src/sim/wlm/classify.ts:26`)
  treats `*` as a wildcard anywhere, `?` as one character and `%` as a literal: `DEPT58%I` misses `DEPT58AI`, the
  doc's own example. All three shipped policies use `rule('TN', '*IRLM', 'SYSSTC')` (`basepol.ts:73`, `hbpol.ts:44`,
  `revpol.ts:43`), which real WLM reads as the literal `*IRLM`. Fix: the doc syntax in `compileWildcard`, the
  policies to `%%%%IRLM` (names are `${ssid}IRLM`, 8 characters), the `RulesView.tsx:249` placeholder to
  "DB1* or AUTH%", unit tests from the doc examples. Goldens may move if any other content pattern relied on the
  old syntax; grep content for `?` and non-final `*` first.
- [x] **14. zIIP-eligible work must not soak up the CP backlog.** Capping and CP shortage limit general purpose CPs
  only (*WLM Planning* p.182); work that is not zIIP-eligible cannot run on a zIIP (INFERENCE from the eligibility
  rules, p.430–431 of *Init & Tuning*). Audit (PROD1 09:00–15:00): absolute cap 1.0 CP took zIIP engine-seconds
  3 463 → 7 188 while CP fell 32 770 → 21 600; DC 150 MSU took zIIP 0.19 → 0.36 engines with equal or fewer
  completions. Cause: `src/sim/core/step.ts:663-669` splits each slice's whole backlog by `cpShare`, so CP work left
  unserved drains on idle zIIPs. Misleads diagnosis ("zIIP busy doubled, add zIIP"). Fix: carry the backlog per pool
  (CP and zIIP), or grant zIIP no faster than the CP share of the same work allows. Changes goldens.

Audit round 5 (2026-10-30, Midwest seed 7; `runs/lab/2026-10-30-audit-r5.md`, local only).
- [x] **15. Most important missing work must stay receivable under a CPU cap.** Done 2026-11-02 in #111 (after #127): projections extend the percentile PI past 4.0 (`projectedPercentilePi`), and a transaction's wait for TRANSACTION regions is its CPU delay (SG24-7621 p.81, p.126). After #127 ONLHI's bottleneck read OTHER (TOR/AOR health 0.37, the regions starve at ONLHI's DP) and was "not WLM-fixable". With Db2 in STCHI at DC 200, seed 7, ONLHI is now the first PROD1 receiver once capped (14:00, FA→FC). It stays at about 7 s through the peak in every variant, because the shared regions also carry ONLMED: a capacity shortfall, not an inversion. Was blocked on the CICS regions item. Decided 2026-10-31 (user, #111): Q1 model region server topology first, then rebase #111 on it; Q2 ONLHI collapsing under a cap with Db2 below its clients is intended (F1), so the realism test uses a policy with Db2 above the work it serves; Q3 keep the veto (unclamped harm to more important missing work rejects the move, SG24-6472 p.66–67), no gain override. Found 2026-10-30: reproduces at DC 200 on seeds 7 and 11 (not DC 100); unclamping the projection (WIP `fix/r5-receiver-clamp`, local) is not enough, because raising ONLHI starves its own CICS regions (txn and region CPU compete; real regions follow their transactions' goals, *WLM Planning* p.122) and lowering STCMED lowers Db2 (flaw F1). Side effects: STCMED promotion vetoed ~1.5 h, TSO#2/DDFPRD#2 DP ping-pong. Draft PR #111 (not for merge) holds the WIP and the design questions. WLM helps the most important work
  missing its goal first (*WLM Planning* ch.1). Audit (PROD1 DC 100 MSU): ONLHI (imp 1) PI 0.50 → 4.00, RT 0.040 →
  7.5 s from 10:00 to about 21:00 at DP FA while STCMED (imp 3, PI 0.59), TSO#2 and DDFPRD#2 (imp 4) sit at FB; WLM
  log `ONLHI#1 PI=4.00 BTLNK=CPU no action with net value` every interval. Cause: the projected percentile PI is
  clamped at 4.0 (`goals.ts:11`), so `passes` (`adjust.ts:107`) never sees receiver value once a class is past 4×
  its goal; receivers are also taken from the per-tick `localPi` order. Fix: assess receiver value on an unclamped
  measure, so donors above a missing imp-1 class can be lowered. Confirm on a second seed first.
- [x] **16. CPU reports must show MVS BUSY next to LPAR BUSY.** Done 2026-10-30: `mvsBusyFrac` (`src/sim/hw/prsm.ts`) = CP demand / unparked logical CPs; Partition Data LPAR BUSY% (was LOG BUSY%) and MVS BUSY%, Monitor III MVS Util% from it; realism test added; goldens moved (state fields only). LPAR BUSY is dispatched time over online time; MVS
  BUSY is (time range − wait) over time range, with parked time excluded under HiperDispatch, and is "a direct
  indicator to see a CPU bottleneck" (*RMF Report Analysis* p.389). Audit (CPC 8 → 4 CPs, PROD1 weight 500 → 50):
  LOG BUSY 33.9 → 7.0 %, PR/SM DLY% 9.9 → 13.9, while SYSSTC velocity 90 → 10 and CPU delay 10 → 90 %; Monitor
  III MVS busy read 8.1 %. Cause: no MVS BUSY column; `mon3.ts:355` derives it as `lparBusy/(1 − prsmDelayFrac)`
  with only the short-engine term (`prsm.ts:169-177`). Fix: MVS BUSY = min(1, demanded engines / unparked logical
  CPs) in the Partition/CPU reports and Monitor III. Reporting only.
- Matches: defined capacity before the R4HA fills, batch under the cap, HyperPAV aliases 0 (IOSQ and I/O delay
  under load), tiny Db2 buffer pools (I/O delay, not CPU), IIPHONORPRIORITY=NO. Approx (known): BLWL promotion share
  on logical capacity (`evaluate.ts:431`), buffer pool miss multiplier capped at ×4. Noted, not queued: aliases 0 is
  inert at default load (volumes about 1 % busy), so the lever has no clue path until an event adds I/O.

Audit round 6 (2026-10-30, Harbourline seed 13; `runs/lab/2026-10-30-audit-r6.md`, local only).
- [x] **17. I/O priority management off must keep reporting I/O samples and DP-ordered IOSQ.** Done 2026-10-30: `usingIoNoVel`/`delayIoNoVel` keep the samples for reports and leave them out of velocity and the WLM bottleneck; IOSQ always DP-ordered; realism test replaced; goldens unchanged. NO "sets I/O
  priorities equal to dispatching priorities", and the DASD I/O using and delay samples "are reported even when I/O
  priority management is turned off"; only velocity leaves them out (*WLM Planning* p.115, p.70). Audit (LCU 10–12
  aliases 0 + 60 000 IOPS): OFF took ONLHI I/O delay 41 → 0 %, OTH 41 → 73 %, MKTORD RT 0.044 → 0.048 s. Cause:
  `evaluate.ts:518` zeroes I/O samples in the reports, and `:516` makes IOSQ FIFO. Fix: keep the samples for
  WLMGL, drop them only from velocity; order IOSQ by DP when off. APPROX: goal-based I/O priority when on is not
  modelled (on also orders by DP).
- [x] **18. CF Activity must show duplexed secondaries and per-structure system rows.** Done 2026-10-30: STRUCTURE SUMMARY PRIM/SEC rows with the secondary's traffic on its CF, STRUCTURE ACTIVITY per copy × system, SUBCHANNEL ACTIVITY per CF × system with the distance to that CF; realism tests added; goldens moved (state fields only). The Usage Summary marks
  PRIM/SEC for synchronously duplexed structures (*RMF Report Analysis* p.365). Audit: LOCK1 duplexed, CF02 shows
  16 733 req/s at 40.2 % UTIL, CF01 25 100 req/s at 30.1 %, no secondary row; the secondary's CPU is counted
  (`cf.ts:97-105`) but not its requests. CONNECTED SYSTEMS is blended over all structures (control PRDA shows
  15 km though its lock is local). Fix: PRIM/SEC rows with the secondary's requests, structure × system rows.
  Reporting only.
- Matches: Db2 address spaces below their work (delay in OTH, not CPU), LOCK1 move/duplex service and async
  share, period switching on DURATION, HiperDispatch polarity and the LPAR/MVS BUSY columns. Noted: Harbourline
  CPU and DASD have headroom (CPC1 ~60 %, IOSQ needs ~60 000 extra IOPS per LCU), so those levers bite only after
  an event or squeeze.

Audit round 7 (2026-10-30, Revenue seed 19; `runs/lab/2026-10-30-audit-r7.md`, specs `runs/lab/r7/`, local only).
- [x] **19. Monitor III DELAY must use RMF's columns and Primary Reason forms.** Done 2026-10-30: % Delayed for
  is PRC (CP + zIIP) DEV STR SUB OPR ENQ, plus IDL; no CAP or PRC IIP column; capping counts only in DLY %; Primary
  Reason is the heaviest other processor user's jobname or `*ENCLAVE`, `LCU <id>`, `LOCL` or `RG-Cap`; the
  `DELAY_CAP` pin moves to the RG-Cap cell. View model only, goldens unchanged. Source: *RMF Report Analysis*
  Table 20, p.106–110. p.109 says DLY % may exceed the column sum "such as WLM capping delay", and RG-Cap is a
  Primary Reason (p.110). The audit found the sim printing a CAP column and the resource name (`PRC`) as the
  reason. APPROX: rows stay service-class summaries, not jobs (overlaps the CICS work-manager item); DEV gives an
  LCU, not a volser; IDL/SUB/OPR/ENQ are not modelled.
- Matches:
  - capacity group capping, members held to the limit and split by weight (*WLM Planning* p.44–47);
  - sub-capacity billing capped by DC or group limit;
  - unclassified work goes to SYSOTHER as discretionary (*WLM Planning* p.37, p.103);
  - an unreachable velocity goal is chased at lower-importance work's expense.
- SCRT peak of hourly sums across LPARs: verified 2026-10-30 against the SCRT guide (e0zs100 p.38, p.139), added
  to the books repo on user request.
- Lab harness gaps reported (added 2026-10-30, see decision row):
  - no way to add a capacity group through `config`;
  - no per-interval state paths;
  - WLM log window (208 lines) too short;
  - no Monitor III dump.

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
| 2026-10-28 | Change Desk: edit-in-place drafts plus one change request banner replace per-row "+ basket · Apply" buttons (Operations and hardware orders excepted) | Per-row buttons and cost lines overflowed tables and made it unclear which cost belonged to which change; hours are per change but emergency trust and fail risk are per request, so the request shows them once. User request, iterated on an artifact preview |
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
| 2026-10-28 | Harbourline audit: five realism fixes queued (M8.7 items 1–5). Resource group fixes in two steps, server-region health first, then AOR caps reaching transaction CPU; a transaction's host region adds no `depDelay` on top of its CPU cap | User decision. Item 1 is a one-expression change that closes the "park Db2 in a capped group for free" exploit; item 2 needs a content field and design calls. One cause (CPU withheld in the region) counts once, through the documented mechanism (*WLM Planning* p.60) |
| 2026-10-29 | MXT/MAXDBAT slot queues persist across ticks and time out; a slot is held for the in-region time less the CPU backlog wait | Holding time with the backlog wait made CPU starvation and the slot limit fail the same transactions twice (zero completions in the RBANK CPU ×3 evidence test). Real CICS would move the queued tasks from CPU wait to MXT wait; the sim keeps them in the CPU backlog (APPROX). CICS_SOS cuts MXT to 10 (was 5, below the legal 10) |
| 2026-10-29 | LPAR capping (soft or absolute) posts as CPU delay; WLMGL CAP delay is resource-group and discretionary capping only. Folded into M8.7 item 5 | RMF's CAP delay is "NOT part of the CPU delay" and covers RG/discretionary capping (*RMF Report Analysis* p.540); LPAR capping is visible as Partition WLM% / ABS CAP. The CPC `% capped` evidence keeps the CAPPING clue path. Balance check deferred to the end-of-audit sweep |
| 2026-10-29 | Balance gate victory bands are a share of runs (expert 60–100%, donothing 0%), not counts; the gate takes an optional scenario name for its report title | The 5-seed count band (expert 3–5) failed every 10-seed review sweep, including the pre-fix baseline (9 of 10). Only Midwest has tuned bands; Harbourline and revenue sweeps are checked against them as a reference |
| 2026-10-29 | SMF_AUDIT may slow work on a system already at its CP share (Midwest PROD2 at 10:00: MOBILE 94 → 115 ms); clue text and realism test bound (1.3×) updated | M8.7 item 6 removed the ×51 zIIP queue billed on zIIP-less PROD2 (F7), which had hidden PROD2's CP-share sensitivity. Extra SYSSTC work on a CP-bound LPAR does delay lower work; the event stays a cost card elsewhere |
| 2026-10-29 | Storage Critical redistributes paging instead of deleting it: unprotected periods absorb the protected share by activity × steal weight (imp 1..5 → 1..5, discretionary 6), capped at 0.9 | Keeps the image's paging constant so the lever has a cost (WLM Planning p.119). No scenario sets Storage Critical by default, so goldens and bench hashes are unchanged |
| 2026-10-29 | IEAOPT CCIMP modelled per system, but every scenario stays pre-z/OS 3.1 (CCIMP 0); the player turns it on with SET_IEAOPT (CLI/change desk; no UI control yet) | Turning it on by default would protect importance-1 work for free and shift balance; as a lever it has a cost (fewer donors, lower work waits longer). Harbourline with PRDA/PRDB at 4 logical CPs: 3526 → 0 DP inversions under importance-1 first periods over 12 h. Goldens and bench hash unchanged |
| 2026-10-29 | WLM edit validation follows *WLM Planning* Table 7 (p.84) for the six modelled qualifiers: STC TN/UI/SY, JES TN/UI/TC, CICS TN/UI/TC, DDF UI/PK/CI, TSO UI/SY, MQ TN/UI/TC, OMVS TN/UI/SY. A qualifier may not appear under itself at any level (APPROX: p.99 shows the direct case) | The table has no SY for JES, CICS or DDF, so the sim's JES `SY` attribute is never matchable; no shipped policy or bot uses it. Existing invalid policies stay loadable; only the edit is refused |
| 2026-10-29 | Classification patterns follow WLM syntax (*WLM Planning* p.104): `%` one character (trailing `%` may match none), `*` wildcard only last or alone, literal elsewhere, no `?`; shipped IRLM rules become `%%%%IRLM` | `*IRLM` is a literal in real WLM; behaviour unchanged (goldens moved only by the pattern string in the hashed state; mapping it back reproduces the old hashes) |
| 2026-10-29 | zIIP no longer soaks up the CP backlog: transaction backlog carried per pool (`SimState.ziipBacklog`), batch CP/zIIP demand scaled by the pace the other pool allows (`JobRuntime.cpPace/ziipPace`) | Midwest seed 7, PROD1 absolute cap 1.0 CP, full day: zIIP 66 953 → 15 799 engine-s (uncapped 20 233), BATCHPRD zIIP 46 245 → 3 296. Uncapped batch zIIP also fell 13 318 → 8 591 (it was inflated by CP contention in the batch window); seed 42 MOBILE no longer has a rough day 1, so the hints test moved to seed 1. Goldens changed |
| 2026-10-29 | Expert/fixer bots recycle the PROD2 AORs on CICS_SOS on sight; the card's `affects` and clue name every PROD2 CICS workload (Midwest, revenue) | Post-M8.7 sweeps: fix 3 made CICS_SOS time out all PROD2 CICS work for 4 h, and no bot applied its fix, so expert lost Midwest seeds 6 and 10 (victories 9 → 7). With the fix, 10-seed sweeps on a27b131: Midwest expert 9 victories (was 7), revenue expert 10 (unchanged, scores +3 to +13), Harbourline unchanged (no CICS_SOS); donothing and textbook rows identical. All gates pass. `affects` only feeds incident attribution and the card's trigger is POLICY, the fallback those incidents already got, so no sim change; goldens unchanged |
| 2026-10-30 | Audit rounds run as a paced loop (`/audit-loop <rounds> <pace>`): Sonnet auditor subagents, vetting by the main agent, Opus `realism-fixer` subagents in worktrees, fixes landed one PR at a time, 10-seed sweeps per scenario on Sonnet worker sessions; a scheduled task launches audits and is deleted after the last round | User request. Each audit is processed as it finishes; sweeps go to separate containers because the 4-core box can't sweep and test at once; one golden-changing PR at a time still holds |
| 2026-10-30 | Partition Data shows LPAR BUSY% and MVS BUSY%; MVS BUSY = CP demand / unparked logical CPs; Monitor III MVS Util% uses it (was lparBusy/(1 − short-engine delay)) | Audit r5 item 16 (*RMF Report Analysis* p.389). Midwest seed 7, PROD1 weight 50 on 4 CPs: LPAR 7.0 / MVS 8.1 → 7.0 / 100. Reporting only; one-day state hash without the new fields equals dev, so no sweep |
| 2026-10-30 | Realism lab harness `tools/lab.ts` (`npm run lab`): JSON specs with `extends`, timed changes (commands, WLM edits, config patches), chosen report fields per interval, A/B side by side; auditor and fixer agents use it | User request: auditors were each writing their own harness (`runs/lab/r5.ts`, `runs/lab/r6/h.ts`); one shared harness keeps A/Bs comparable and lets fixers rerun the audit's exact specs |
| 2026-10-30 | Lab harness gains `paths` (any state path per row), `wlmLog` (the whole WLM adjustment log, optionally filtered; state keeps only 400 lines), a `MON3` dump (Monitor III DELAY rows with Primary Reason) and `config` `add` (e.g. a capacity group) | Gaps the round 7 auditor hit; it worked around them with `cmds`, `final` and the play CLI. Fold a gap in once it recurs, keep ad hoc scripts allowed. Tools only |
| 2026-10-30 | I/O priority management NO keeps DASD I/O using/delay in WLMGL, WLM_DETAIL and Monitor III, keeps the IOSQ ordered by DP, and leaves I/O out of velocity and of the WLM bottleneck | Audit r6 item 17 (*WLM Planning* p.115, p.70). Harbourline seed 13, busy LCUs, OFF at PRDA 10:00: ONLHI I/O delay 0 → 42 %, OTH 80 → 43 %, MKTORD RT 0.048 → 0.044 s (FIFO gone). Default policies keep I/O priority on: goldens and bench hashes unchanged, so no sweep |
| 2026-10-30 | CF Activity follows the RMF layout: duplexed structures get PRIM and SEC rows (the secondary's requests count on its CF), STRUCTURE ACTIVITY per structure copy × system, SUBCHANNEL ACTIVITY (was CONNECTED SYSTEMS) per CF × system with that CF's distance | Audit r6 item 18 (*RMF Report Analysis* p.365, p.372–378). Harbourline seed 13, LOCK1 duplexed: CF02 REQ/SEC 16 733 → 33 466; EST DIST per row 0/15 km instead of 15 everywhere. Reporting only: state hash without the new fields equals dev (f7c857525081d79f), so no sweep. APPROX: both copies report the duplexed request's elapsed time |
| 2026-10-30 | Equal-importance net value needs a shrinking PI gap (fix 20): a move that harms an equal-importance class is rejected unless the gap between the receiver's and that class's projected PIs shrinks (SG24-6472 p.60; Enrico slide 52). Applies to all equal-importance moves, not only when both miss | Stops TSO#2/DDFPRD#2 trading CPU every few minutes (Midwest seed 7: 15 → 5 moves 09:00–10:30). Leapfrogging upward (each raises its own DP, no projected harm) remains and is consistent with WLM. Bench midwest 88dac8daa434772b → 1b9844d8ee9e0fe8, harbourline b00a39eb23e07173 → b572057c3980beb1. 10-seed sweeps on 14c53c0, all inside bands: Midwest do-nothing 15 / textbook 27 / expert 9 victories (seed 2 trust, day 40); Harbourline 10 / 30.5 / expert 9 (seed 2 trust, day 33); revenue 8.5 / 28 / expert 10. In line with the last recorded sweeps |
| 2026-11-01 | CICS/IMS regions follow their transactions' goals: Manage Region Using Goals Of on STC/JES rules (TRANSACTION default, REGION, BOTH), WLM Planning p.102 and p.122 | Raising a CICS transaction class starved its own regions in the region class (#111, STCHI PI 0.69 to 31.9). Midwest seed 7 PROD1 DC 200 15:00: reported STCHI PI 0.70 to 11.2 (regions now wait with ONLHI, not managed), ONLHI completions 131 to 155/s. APPROX: no per-region split of a workload's transactions. Bench midwest 1b9844d8ee9e0fe8 to ce49e04837e95694, harbourline b572057c3980beb1 to acac2578d02b2cdd. 10-seed sweeps on 27d5b51: Midwest do-nothing 11 / textbook 27 / expert 9 victories (seed 2 trust), was 15 / 27 / 9; Harbourline 10 / 30 / expert 8 (seeds 2, 7 trust), was 10 / 30.5 / 9; revenue 7 / 28 / expert 10, was 8.5 / 28 / 10. Revenue do-nothing is below the Midwest band it borrows (8 to 22), accepted: unmanaged regions now wait with their transactions, so a hands-off run fails sooner, and the CI-gated Midwest stays in band |
| 2026-11-02 | WLM projections extend the percentile PI past 4.0; a transaction's wait for TRANSACTION regions is its CPU delay (#111, fix 15) | Receiver value was blind past 4× the goal, and after #127 ONLHI's region wait read OTHER (not WLM-fixable). SG24-7621 p.81, p.126; veto kept (user, Q3). Bench midwest ce49e04837e95694 to b1aa42059d46952e, harbourline acac2578d02b2cdd to c47f6b8416f440f8. 10-seed sweeps on b8d835e: Midwest do-nothing 16.5 / textbook 27 / expert 8 victories (seeds 1, 2 trust), was 11 / 27 / 9; Harbourline 9 / 29 / expert 6 (seeds 1, 2, 7, 9 trust), was 10 / 30 / 8; revenue 8.5 / 28 / 10, was 7 / 28 / 10 (back in band). Harbourline expert -2 accepted (user, 2026-11-02): seed 1 is marginal on dev too; seed 9 loses on day 29 because WLM now raises MKTORD to Db2's DP (STCHI FC), all CICS work rides there and crowds Db2 out. A realistic inversion (IBM advises Db2 above CICS); the expert bot never moves Db2 (bot gap), and the severity comes from demand-proportional sharing at an equal DP, logged in M8.7 Realism fixes |

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
- Waiting on the user: nothing open (#111 Q1–Q3 decided 2026-10-31). M9 released 2026-10-26. (VENDOR_PRICE: decided option 1, sim price multiplier, 2026-10-21.) (Booking go-live: decided (a) keep, 2026-10-21.)

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

- **2026-11-01:** Audited the zos-docs book map against all 24 stored IBM PDFs and IBM web
  sources. Added IP Configuration Guide, SCRT 30.1 (with its local alias and canonical URL),
  CPSM Managing Workloads and ABCs Volume 12; restored the separate RMF Programmer's Guide,
  completed message volumes 7–9, corrected titles/missing forms and stale draft status.
  Added dated per-entry validation evidence distinguishing title/form confirmation from
  exact filename verification; retained explicit unresolved candidates. Validation:
  `npm run check` green (57 files, 477 tests), all stored PDFs represented, local Markdown
  links checked, `git diff --check` clean. No game behaviour change.

Newest first. Entries before loop 48 are summarised in the milestones above; see git history for detail.
- **2026-11-01:** Set explicit Codex role models and reasoning: Luna low for log reading,
  Luna high for all three players, Sol medium for bounded implementation, Sol high for PR review
  and vetted realism fixes, Astra high for open-ended realism auditing. Assignments and rationale
  are in `docs/codex.md`; host-tool fallbacks must preserve the configured model/effort when supported.
- **2026-11-01:** Added Codex entry point `AGENTS.md`, eight native roles in `.codex/config.toml`
  and role wrappers that load the existing `.claude/agents/` briefs with Codex host adaptations.
  Shared briefs remain authoritative; models and permission policy inherit from the host (superseded: per-role models since #124).
  Setup and fresh-session role verification are documented in `docs/codex.md`. Game behaviour unchanged.
- **2026-10-30:** New skill `audit-loop` and agent `realism-fixer` (user request): paced audit → vet → fix → sweep
  loop driven by a scheduled task (see Decisions). `.gitignore` now keeps `.claude/skills/`.
- **2026-10-28:** New agent `goal-mode-realism-auditor` (user request): makes deliberate, drastic changes (defined
  capacity far below demand, resource-group caps on the STC classes Db2 and CICS depend on, MAXDBAT 1, no aliases...)
  in same-seed A/B runs, compares the results with IBM documentation through the zos-docs skill and `docs/research.md`,
  reads `src/` to explain gaps, and reports Matches / Approx / Mismatch / Not modelled / Inconclusive with draft
  research-ledger rows and realism-fix lines. Read-only on the repo; writes under `runs/lab/`. Not run yet.
- **2026-10-28:** Change Desk redesign (user request): rows edit drafts in place and one change request submits them.
  Every setting outside the WLM tab (Systems, CF & I/O; LPAR image profile; routing; job classes) is a segmented
  choice, a number field or a one-off action checkbox (DASD rebalance) with no per-row Apply or cost; a drafted value is
  highlighted with "was <live>" (always rendered, invisible until drafted, so columns don't shift). Drafts live in the
  existing basket, shown as a sticky "Change request" banner at the top (stacked with the pending WLM policy banner):
  one line per change with its hours, the request's emergency trust and fail risk once, Submit as one change; invalid
  fields block Submit and are named. Operations (restarts, event fixes) and hardware orders keep one-click buttons. WLM
  period goals and resource groups now edit the pending policy in place (no Save buttons); Remove Pn sits in the last
  period's row. Change board status tags no longer wrap. Goldens unchanged.
- **2026-10-28:** Removed the Harbourline day-0 handover mail from the outgoing analyst (story beat `HANDOVER`; user:
  it read one seed's day 1, "Markets screams first, then Cards", as fixed). The PRDA absolute cap (B1) now has no
  inbox clue before the first 09:00 open (no day-1 trust grace either, see playtest round 3 X); Partition Data and
  the HMC image profile still show it. Test keeps the cap check. SPEC §Harbourline Problem 1 updated. Goldens unchanged.
- **2026-10-28:** Rolled back (user request): `src/` is again as of `8b868d4` (#79) plus only the layout-gap fix of #81;
  #80 (Apply buttons only on changed rows, cost in the header), #82 (pick-then-confirm choices) and #83 (DASD header
  alignment, rebalance confirm) are undone, so their entries below no longer describe the code. With every row showing
  its buttons again, MQ moved to the left stack (z/OS options + DASD + MQ | Db2 + CICS) to balance the columns
  (1,141 vs 1,041 px); tab 2,379 → 2,050 px at 1920×1080. Artifact rebuilt from this state.
- **2026-10-28:** DASD table headers lined up with their columns again: each setting row is its own CSS grid and the
  rebalance column was `auto`, so it sized per row (0 px in the header) and pushed the header labels right; it is now a
  fixed 96 px. A picked `rebalance` shows its `+ basket · Apply` and cost in the row's action column instead of
  squeezing into that column. Tab split into "Systems" and "Db2, MQ & CICS" previewed for the user and not kept.
- **2026-10-28:** Change Desk one-click choices now pick-then-confirm (user request). RMF interval, IEAOPT
  (BLWLINTHD, IIPHONORPRIORITY), CF thin interrupts, structure placement, duplexing and DASD rebalance used to apply
  on a single click, with the cost only in a hover tooltip and shift-click to stage (neither works on touch).
  Picking a value now shows `+ basket · Apply` and the hours/trust/fail-risk line, like the typed setting rows;
  clicking the pick again cancels. Goldens unchanged.
- **2026-10-28:** Change Desk Systems tab layout gaps: below the full-width CF card the tab is now two independent stacks,
  z/OS options + DASD | Db2 + MQ + CICS (CICS no longer full width), instead of a row grid that left holes beside
  short cards. Tab 2,016 → 1,828 px at 1920×1080; one column below ~1,130 px, no phone overflow. LPARs and Batch tabs
  have two equal-height cards each, nothing to fill. Goldens unchanged.
- **2026-10-28:** Change Desk, Systems tab height (user: too much scrolling). Setting rows (DASD LCUs, Db2, MQ, CICS) show
  `+ basket`/`Apply` only once the value differs from now (the row gets an accent bar); the per-row cost moves to the
  table header (`per row: …`) and the Apply tooltip, and Enter on an unchanged row no longer stages a no-op. Tab
  2,379 → 2,016 px at 1920×1080 (DASD 595 → 431, Db2 536 → 345). Further ideas proposed, not done yet: one Db2 row per
  subsystem, help text behind the Codex hints, masonry layout/jump links, subsystem tabs and one shared add-rule form in
  the classification rules panel. Goldens unchanged.
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
