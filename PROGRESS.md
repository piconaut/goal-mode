# PROGRESS.md

Status tracker for **GOAL MODE**. Update at the end of every working session.
Finished work is summarised; the full per-loop detail is in git history (`git log -p -- PROGRESS.md`).

## Current status

- **Phase:** M0–M7 and M8.9 done; M8 in progress; M9 on hold until the user says start. Playable in the browser
  (`npm run dev`); published build: https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv (private; republish on request).
- **Last updated:** 2026-10-21
- **Next up:** M8.4 events (23 of ~25), M8.2 balance (textbook below target; waiting on the user), M8.1 structural perf.
- **Repo:** https://github.com/piconaut/goal-mode (build-loop branch `ccr-2af28431-vidfb0`; see M8.9 for `main`).
- **Health:** `npm run check` green (299 tests). Headless (cloud box): day 1 3.25–3.7 s, steady days ~2.0–2.4 s;
  bots ~4 s/day. Bench hash (seed 42, 1 day) `8a82ad7db2b258ae`.
- **Try it:** `npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1` prints daily SLA/batch/MLC summaries,
  hourly busy/PI, and Postprocessor-style WLMGL, Partition Data, CF and DASD reports. `--dc PROD2=420` sets a defined capacity.
- **Calibration (seed 42, BASEPOL, no player action):** day 1–3 CPC peak ≈ 85% at 12:00; online SLAs 99.5–99.9% except
  MOBILE (96–98%). PROD2 runs hottest (no zIIPs + all ad-hoc BI). On days 1–2 batch starts at 20:00 into Mobile's
  evening peak and starves Db2 (F1) and DDF (F4) until WLM adapts. Critical batch (40 jobs) ends 04:13 → 04:44
  (deadline 06:00) and erodes with 0.4%/day batch growth. CF02 (shared, polling, weight 10): sync ≈ 1.4 ms, ~98%
  async (F8). Payday (15th, day 13) saturates the CPC and MOBILE misses SLA.

## Milestones

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

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
- [ ] Target ≤ 2 s per headless day (now day 1 3.25–3.7 s, steady ~2.0–2.4 s on the cloud box)
- [x] Benchmark `npm run bench [-- --days N --seed S --hash]` (`tools/bench.ts`); `--hash` proves an optimisation is
  behaviour-neutral. Seed 42 hashes: 1 day `8a82ad7db2b258ae`, 3 days `55d9e06f477c9197`, 8 days `c2ec32ace44f6b06` (since PR #8)
- History: loop 21 ≈ 8.5 s/day → 2026-10-20 perf thread ~1.7–1.9× (index-based dispatcher/evaluator, shared
  projection demand stage, copy-on-write batch jobs, cached keys; textbook bot 6.3 → 4.1 s/day) → 2026-10-21
  `step` split into `lparDemand` / `dispatchLpar` stages sharing a `TickCtx` (day 1 4.05–4.18 → 3.25–3.7 s).
  Profile is flat (no function > 13% self); left: allocation (GC ~5–7%), log-normal buckets (~5%), and JIT
  deopts of `step` on days 1–4 as state objects change shape. Micro-opts are exhausted at ≤ 1% each (loops 91–92)
- 2026-10-21 (2nd thread): soft capping, PR/SM, policy adjustment and the R4HA/MLC/RMF tail are their own
  stages too (`softCap`, `prsm`, `adjustPolicies`, `stepCapping`, `stepCost`, `stepRmf`); `step` self time
  11% → 8%. Slice templates were already memoised; `buildSlices` now skips the key string and nested lookups
  per LPAR while inputs are unchanged, and Db2 use per workload is memoised. Hash-neutral; wall-clock gain is
  within this VM's noise (it measured ~2× slower than the day before: base 3-day run 14–17 s). Lesson: building
  slices with a field-by-field literal instead of a spread was ~40% slower overall (hidden-class split with
  the other slice copies), so keep slice copies as spreads
- [ ] Structural options for 4×, in expected-value order: (1) ~~cache per-LPAR slice specs~~ (templates
  cached; the per-tick spread copy and demand fill remain, ~3%); (2) evaluate projections on a reduced slice set (only the receiver's and donors'
  periods); (3) struct-of-arrays for scps/buckets to cut allocation; (4) evaluate DEVT/SYSP every 3rd
  tick (low-importance images, APPROX); (5) RMF accumulation every tick → running sums without object spreads.
  Each must keep the golden hash or regenerate it with a reason
- Decision: the what-if simulator doesn't wait on M8.1 (runs in the briefing with the clock stopped, chunked)

**M8.2 Balance harness & targets (SPEC §16)**
- [x] `npm run sweep -- --bots donothing,textbook --seeds 1-20 [--jobs N] [--days D] [--out f.csv]` (`tools/sweep.ts`)
  → CSV + per-bot summary (day p10/median/p90, median score, ends by cause)
- [x] Golden runs (`tests/golden/`, seed 42, 2 days; regenerate with `UPDATE_GOLDEN=1 npx vitest run tests/golden`)
- [ ] Bots: donothing (lose day 12–18), textbook (≈ day 28–32), spendtowin (On/Off CoD every day: SLA fine, loses on opex), expert (scripted good play incl. capacity orders and caps: wins with grade A on Normal)
- [ ] Targets hold across ≥ 20 seeds (median and spread), not just seed 42; event-deck intensity, growth rates and trust weights tuned from sweeps
  - Latest results, Normal (day p10 / median / p90):
    - **Post-PR #8 re-sweep (2026-10-21, seeds 1–20, 22 cards):** do-nothing 12 / 15 / 21, ends batch 10 · trust 10
      (median 15 is now on target, p90 a bit late); textbook 22 / 27 / 28, ends batch 12 · trust 8 (median 27 is still
      below the 28–32 target, p10 up from 17). Early textbook ends: seeds 13 (day 17) and 20 (day 24) are Retail trust
      collapses, and both drew NEW_APP_GOLIVE, so the booking decision still matters. Seeds 15, 17 and 5 (days 19–23)
      are batch ends, and all three drew REORG_OVERRUN + JOB_ABEND. Outlier: do-nothing seed 17 ends on batch on
      day 4 (JOB_ABEND only) and seed 9 on day 5. Cause: JOB_ABEND drawn on day 3 *and* day 4 (two unrestarted
      abends = two misses). Fixed: no card is drawn two days running (`drawEvents`); seed 17 now lasts to day 10.
    - **No-repeat re-sweep (loop 109, seeds 1–20):** do-nothing 10 / 16 / 21, ends trust 18 · batch 2 (seed 9 still ends
      day 5 on trust; next earliest seeds 12 day 8, 17 day 10); textbook 20 / 26 / 28, ends trust 12 · batch 8 (short: seeds
      1 day 15, 17 day 18, 3 day 20, all trust). Rule moved ends from batch to trust; textbook median 26 still below target.
    - **do-nothing** 9 / 13 / 18, ends trust 14 · batch 6 (loop 37; median ok, p10 a bit early; not re-swept since)
    - **expert** 40 / 40 / 40, victory 20/20 (loop 68, 19 cards); 4/4 victories in the loop 102 smoke sweep; loop 110 smoke after RETRY_STORM: 3/4 (seed 3 opex end day 28,
      bill month 1 898k vs 860k; it never drew RETRY_STORM and wins on the commit before, so it's the reshuffled deck,
      not the card). Watch in the full re-sweep
    - **spend-to-win** 28 / 28 / 28, ends opex 20/20 (loop 68): right cause, zero spread (opex wall is the month-1 close)
    - **textbook** 17 / 26 / 28, ends trust 14 · batch 6 (loop 68): **below target**. All eight Retail-trust
      collapses on days 16–24 drew NEW_APP_GOLIVE: the booking app is Retail-judged with an SLA and textbook never
      classifies it. Asked the user (keep / booking without an SLA or Internal stakeholder / forewarning that names
      the work / later minDay); no answer recorded yet
  - Textbook spread is near zero even without that card (loop 46: 27 / 28 / 28): the day-20 05:00 deadline beat
    plus 0.4%/day batch growth is a deterministic wall on days 27–28. Widening it (randomised growth or deadline)
    is a balance call for later. Idea (closed PR #3): give textbook one obvious batch reaction (e.g. more
    initiators when the critical path runs late) to lift its median toward 30 and widen the spread
  - User decision (loop 46): textbook is a "reads the manual, no diagnosis" floor: day-0 F-fixes, reacts only to
    abends and open SLA incidents. The diagnosing reactions live in the `fixer` base used by expert and spend-to-win,
    which end event cards on sight with their fix
  - Month-1 bill (loop 45 medians): textbook/expert/spend-to-win $832k / $862k / $837k against a $780k budget

**M8.3 Difficulty & run structure**
- [x] Difficulty presets Story / Normal / Hard / Ironman (`src/content/difficulty.ts`, applied in the game layer):
  growth, event rate and severity, constraint timing, budgets, start trust, starting fixes (Story: F7/F8/F11),
  hint level, pause rules; picker in the day-1 briefing and on the end screen; `--difficulty` on bot/sweep
  - [~] Bot sweeps per difficulty to check the presets land where SPEC §11.2 says (loop 52, seeds 1–10):
    **Story** textbook 28 / 29 / 30 (batch 5 · trust 5, Retail at 0), expert victory 10/10. **Hard** textbook
    18 / 24 / 26, expert 33 / 40 / 40 (victory 5 · trust 5). Hard separates well; Story barely helps a
    non-diagnosing player (same batch-deadline wall; merger lands in SYSOTHER). User decision: a clear merger
    hint two days ahead, on Story and Normal (`STORY_BEAT_HINTS`, loops 59/62). Bots don't read hints, so
    their numbers don't move. Re-sweep Story/Hard after the deck is complete
- [x] Morning hints (Story clear, Normal vague, none on Hard/Ironman; `src/game/hints.ts`, texts in `src/content/hints.ts`)
- [x] Weekend auto-simulation with the report card as summary; optional "play the weekend"
- [x] Endless mode after victory; daily seed challenge (`src/game/daily.ts`)
- [x] End-of-run report (`src/game/endReport.ts`): per-day score, PI heat-map history, R4HA chart, decisions
  timeline, biggest incident, best RCA, grade S–D
- [~] Meta-progression: career XP and seven levels unlocking starting perks (IndexedDB), level 7 unlocks a starting
  tool (Report Class Hoarder); Codex persists (localStorage). Still open: scenario unlocks (one scenario so far)

**M8.4 Content**
- [~] Events to ~25 (SPEC §9); 26 now (deck complete for this pass). Since M5: REORG_OVERRUN, CF_FAILURE, SHADOW_IT, QR_RELEASE,
  NEW_APP_GOLIVE, POWER_CAP, HSM_RECALL_STORM, CP_SPARING (red herring), HIRING_FREEZE, AUDIT_UNCLASSIFIED,
  ZIIP_LOSS (loop 104), CICS_SOS (loop 105), SMF_AUDIT (loop 106), RETRY_STORM (loop 110), XLOG_LOOP (loop 112: looping STC misclassified by the CICS* rule), ENCRYPTION_MANDATE and GREEN_IT_COD (loop 113). Re-sweep the bots once the deck is complete
  - VENDOR_PRICE pending: needs a run-level product price multiplier in the sim or a run-aware scenario; asked the user
  - HyperPAV exhaustion dropped: organic LCU I/O is ~2k/s, so even zero aliases moves IOSQ < 0.3 ms (no symptom)
  - STORAGE card (DBA grows DB1B buffer pools on PROD2) not added (loop 107): it exposed a swap deadlock, fixed
    with `STORAGE_SWAP.minSwappedIn: 1`, but with the fix even +60 GB BP costs < 0.2 h of critical path. Needs a
    harsher paging model first
  - HSM storm magnitude 60k (75k is past the LCU 30 cliff, ≈ 15× response)
  - RCA truth: cards may declare `mechanisms`; `triggerOf` blames an active card only for incidents with one of them
- [x] More draft options and perks: every SPEC §9.5 opportunity type, 11 perks, 2 pacts (`content/draft.ts`).
  Loop 102 smoke sweep (seeds 1–4): no regression
- [ ] Scenarios: *Continental Insurance* (IMS-heavy claims batch, needs an IMS subsystem model), *State Revenue Agency* (tax-season spike, strict regulator), *Global Airline* (24×7, two CPCs/sites, GDPS-style constraints)
- [ ] Each scenario ships with its own flaw list (SPEC §13.3 rules) and story beats

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
**HOLD: do not start M9 until the user explicitly says to start it (user request 2026-10-20), even if
M7–M8.9 are done; if the loop reaches this point, stop and ask instead.** When told to start: do all M9
work on a separate feature branch (e.g. `feature/simplified-mode`), not on `main`.
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
| 2026-10-21 | Browser worker and headless `play` share game-layer helpers (`pendingBase`/`nextPolicyName`, `applyReportClassAdvice`, `runWorkItems`, `renderReport`); `noUnusedLocals` on | The two front ends had drifted copies of the same logic; one copy means one place to fix and test |
| 2026-10-21 | Monitor III audit against *RMF Report Analysis* (SC34-2665, z/OS 2.5) ch. 2: new SYSSUM view holds goals vs actuals and PI (real SYSINFO has no PI); SYSINFO gets its real header (CPs/IIPs online, Avg CPU vs MVS Util%, Appl%/EAppl%/Appl% IIP) and per-period WFL%, Users ACT, AVG USG and avg delayed users; DELAY uses RMF columns (WFL/USG/DLY/UKN, PRC/DEV/STR/CAP) and server waits move from DLY % to UKN %; PROCU shows Time on CP % Total/IIP and EAppl % CP/IIP; ENCLAVE shows class, period, goal, EAppl% and USG/DLY/UNK; CPC shows the real header and Logical/Physical Util % columns (weight, polarity, PR/SM delay kept in a separate table); WFEX gets a Speed section and Name/Reason/Critical val. columns; ENCLAVE shows one line per DDF period (two DDF workloads in one class used to repeat the period's figures, and the DDF chart double-counted them) | Field names and formulas were invented or borrowed from other reports; UKN vs DLY changes how much "delay" a Db2-bound DDF period shows, which is the realistic reading. View-model only: no sim state change, hashes and goldens unchanged |

## Open questions

- HiperDispatch polarity for E < 1: SPEC/tests give 2 × VM for any E < 1.5 (Watson & Walker table as read). Under the
  "each VM ≥ 50% of an engine" rule an LPAR with E < 1 would get a single VM. Check the source before changing.
- CICS transaction classes with velocity or multiple periods: the editor now warns (WLM Planning says "not supported"),
  but the sim still splits such work like DDF. IBM documents no runtime behaviour for this case; model it if a source turns up.

- CICS_SOS (loop 105) is modelled as an effective MXT cut, so a player who raises MXT on the PROD2 AORs clears it. Real SOS gets worse with a higher MXT. A proper fix needs a DSA storage model (or a lock on MXT while the card runs).
- Soft capping by positive phantom weight lowers the LPAR's effective priority and can cut its VH/VM count (MVS Planning:
  WLM). The sim caps with a flat MSU limit and leaves polarity alone. Worth modelling once PR #9's polarity rework lands?
- SG24-7621 §4.22 lists "must be the last uncapped non-discretionary period" and "has not been a significant receiver
  candidate" among the discretionary-capping conditions; neither is modelled and the first is ambiguous as written.
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
- Waiting on the user: textbook vs the booking go-live (M8.2), VENDOR_PRICE price lever (M8.4).

## Risks

- **Model complexity vs performance:** policy-adjustment projections re-run the evaluator
  (≤2 receivers × ≤6 trials per system per tick). Steady days ~2.0–2.4 s headless against a 2 s/day target.
  Fine for the UI (4 ms/tick budget) but slow for bots and sweeps. Options in M8.1.
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
- **2026-10-21 (loop 110):** PR #10 (CICS goal checks) merged after check + hashes; RETRY_STORM card (mobile λ ×2.5, CPU/txn flat; fix MOBILE_BACKOFF) with realism test. 308 tests, bench hash unchanged.
- **2026-10-21 (IBM-docs realism thread):** audited WLM, capping, IEAOPTxx, CF heuristic against MVS Planning: WLM V2R5,
  Init & Tuning Ref and the WSC sync/async paper. Fixed I/O using (connect only), discretionary batch zIIP overflow and
  CF lock conversion (goldens/hashes regenerated); citations added to correct-but-uncited models. Seed 42 bots: do-nothing
  day 15 → 16, textbook day 25 → 26 (small easing).
- **2026-10-21 (loop 109):** no-repeat 20-seed re-sweep recorded: do-nothing median 16, textbook 26; ends now mostly trust. No code change.
- **2026-10-21 (loop 108):** do-nothing day-4 loss traced to back-to-back JOB_ABEND draws; no card repeats on consecutive days. Bench hash unchanged, 299 tests.
- **2026-10-21 (code-quality thread):** worker/play duplication folded into game helpers; policy names past 9 keep 8 chars (BASEPOL9 → BASEPO10, was BASEPOL1); `noUnusedLocals`. 8-day hash unchanged.
- **2026-10-21 (realism thread):** period aging for batch jobs and address spaces, sysplex-scope type 1 resource
  groups, SCRT capacity-group limit in MLC. Hash unchanged (25f061d42778588a). 294 tests.
- **2026-10-21 (bug-hunt thread):** fixed three bugs. Successors of a batch job that overran 06:00 stayed HELD forever
  (`closeNight` dropped the night's finished jobs while it still had stragglers). An SLA incident open at 06:00 kept
  counting into the day it started, so the new day reported 100% attainment and paid the clean-day trust bonus; incidents
  now split at the day boundary. Batch lock stretch used the online Db2 rate of the images dispatched so far, not the
  sysplex rate (PROD1 batch saw only PROD1 traffic); goldens and the bench hash change with it. (Type 1 resource groups
  were also applied in full on every system; left to the realism thread's PR #7.)
- **2026-10-21 (perf thread):** `step` split into per-LPAR stages; day 1 ~20% faster, hash unchanged. 288 tests.
- **2026-10-21 (loop 107):** STORAGE card tried; found and fixed a swap deadlock (`minSwappedIn: 1`); card not added (M8.4).
- **2026-10-21 (loop 106):** SMF_AUDIT card (22 cards); HyperPAV exhaustion dropped.
- **2026-10-21 (loop 105):** CICS_SOS card (21 cards), modelled as an MXT cut. Open question logged: raising MXT also clears it in the sim, unlike real SOS.
- **2026-10-21 (loop 104):** ZIIP_LOSS card (20 cards): new sim modifier `ziipEligMult` (neutral 1, so SET_MODIFIER's reset-at-1 works and project `ziipShift` is untouched). Bench hash unchanged; goldens unaffected. 286 tests.
- **2026-10-21 (loop 103):** career level 7 unlocks a starting tool (Report Class Hoarder).
- **2026-10-21:** post-PR #8 20-seed re-sweep: do-nothing median 15, textbook median 27 (still short of target; booking go-live + reorg/abend batch walls).
- **2026-10-21 (loops 93–102):** draft perks and the vendor tool trial; all SPEC §9.5 opportunities exist; smoke sweep, no regression.
- **2026-10-20 (loops 80–92):** play CLI, player agents, spectator mode (M8.9); perf profiling.
- **2026-10-20 (loop 79):** contrast audit fixed the light theme's status colours; contrast test for all themes. 273 tests.
- **2026-10-20 (loop 78):** career v1 (XP across runs → starting-perk unlocks, IndexedDB). 270 tests.
- **2026-10-20 (loop 77):** two pact draft cards (persistent perk + persistent downside). 267 tests.
- **2026-10-20 (loop 76):** weekend auto-run (full sim at worker speed, report card as summary); weekday shown. 265 tests.
- **2026-10-20 (loop 75):** day-1 guided tutorial (corner card, state-driven steps, F1 fix detection); ticked finished M7 items. 264 tests.
- **2026-10-20 (loop 74):** three new draft options (Weekend push, Friend at the Vendor, Well Connected). 262 tests.
- **2026-10-20 (loop 73):** hourly autosave during the live day (resume mid-day after a crash or reload; no more replaying a day from its briefing).
- **2026-10-20 (loop 72):** endless mode after victory (fresh capex, counts as a win, endless days in report and share line). 259 tests.
- **2026-10-20 (loop 69):** daily seed challenge (implementer subagent, reviewed): UTC-date seed, share line with Copy on the end screen. 257 tests.
- **2026-10-20 (loop 68):** 20-seed Normal sweep with 19 cards: expert 20/20, textbook median 26 (booking go-live drives early Retail collapses). Asked the user.
- **2026-10-20 (loop 67):** fixer bots (expert, spend-to-win) end cards on sight with their fix (REORG, monitor creep, shadow IT, teller release, HSM storm); expert seed 6 Normal now wins (was trust loss day 32).
- **2026-10-20 (loop 66):** AUDIT_UNCLASSIFIED card (implementer subagent; reviewed: tunables moved to content). 19 cards, 253 tests.
- **2026-10-20 (loop 65):** HIRING_FREEZE card (implementer subagent; reviewed: reason moved into the briefing). VENDOR_PRICE needs a product price lever in the sim or a run-aware scenario: asked the user. 250 tests.
- **2026-10-20 (loop 64):** RCA trigger truth respects card mechanisms. 249 tests.
- **2026-10-20 (loops 48–63):** morning hints, difficulty severity/timing/starting fixes, Story/Hard sweep, end-of-run report, six new event cards, merger hint (user decision). 229 → 246 tests.
- **2026-10-21 (loop 112):** XLOG_LOOP card: CICSXLOG log archiver matches the CICS* STC rule, lands in STCHI (imp 1) and loops on ~1 engine on PROD1. Fixes: cancel (Regulator −1) or a reclassification rule. Built as an STC rather than the SPEC's batch job because address spaces classify by jobname only; SPEC §9 row updated. Realism test; 311 tests, bench hash unchanged (eddf17fc…).
- **2026-10-21 (loop 113):** ENCRYPTION_MANDATE (permanent +6% CPU/txn on CARDAUTH/TELLER/PAYMQ; fix SCOPE_ENCRYPTION, Regulator −2) and GREEN_IT_COD (On/Off CoD refused for 7 days via a new `blocksHardware` card field checked in previewChange, so CPM automation is refused too). SPEC §9.4 rows updated. 313 tests; 1/3/8-day hashes unchanged. Full bot re-sweep started on the 26-card deck.
- **2026-10-21 (thread):** Monitor III realism audit vs *RMF Report Analysis* ch. 2 (SYSSUM view added; SYSINFO, DELAY, PROCU, ENCLAVE, CPC, WFEX columns and formulas fixed; UKN split out of DLY %). The *RMF User's Guide* PDF could not be located under the usual ibm.com/docs PDF names. Game/UI layer only; goldens unchanged.
