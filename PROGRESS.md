# PROGRESS.md

Status tracker for **GOAL MODE**. Update at the end of every working session.

## Current status

- **Phase:** M0–M6 done. Playable in the browser (`npm run dev`); published build: https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv (private; republish on request).
- **Last updated:** 2026-10-19
- **Next up:** M7.4 automation rules (IF alert THEN action; can misfire) and Capacity Provisioning; what-if needs M8.1 perf first.
- **Repo:** https://github.com/piconaut/goal-mode (branch `main`).
- **Health:** `npm run check` green (174 tests). Headless: ~8 s/day (~0.9 ms/tick). Fine for the UI; slow for bots (see Risks).
- **Try it:** `npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1` prints daily SLA/batch/MLC summaries,
  hourly busy/PI, and Postprocessor-style WLMGL, Partition Data, CF and DASD reports. `--dc PROD2=420` sets a defined capacity.
- **Calibration (seed 42, BASEPOL, no player action):** Day 1–3 CPC peak ≈ 85% at 12:00; all SLAs met
  (RBANK 99.9%, CARDAUTH 99.98%, MOBILE 98%, TELLER/PAYMQ 99.98%). PROD2 runs hottest (no zIIPs + all ad-hoc BI).
  The payday (15th, day 13) pushes the CPC to saturation and MOBILE misses SLA.
- **Calibration after M3 (seed 42):** online SLAs 99.5–99.9% except MOBILE (96–98%). On day 1–2 batch
  starts at 20:00 into Mobile's evening peak and starves Db2 (F1) and DDF (F4), so DDF times out
  until WLM adapts. Critical batch (40 jobs) ends 04:13 → 04:44 (deadline 06:00) and erodes with
  0.4%/day batch growth. CF02 (shared, polling, weight 10): sync ≈ 1.4 ms, ~98% async (F8).

## Milestones

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

### M0 — Project scaffolding
- [x] Vite + React + TS strict; Vitest; `npm run typecheck` (ESLint/Prettier deferred; see decisions)
- [x] Folder layout per SPEC §15 (`sim/`, `game/`, `content/`, `ui/`, `worker/`, `tools/`, `tests/`)
- [x] Purity test (`tests/sim/purity.test.ts`) forbids `sim/` importing `game/`/`ui/`/`worker/`/react, DOM, `Math.random`, `Date.now`, timers
- [x] Seeded RNG (`sim/core/rng`), units helpers, clock, state types, tick pipeline skeleton
- [x] Headless runner stub `npm run sim`
- [x] CI-style script: `npm run check` (typecheck + test)

### M1 — Sim core: hardware, PR/SM, dispatcher (headless)
- [x] CPC model: pools, capacity settings, MP factor, zIIP full speed (`sim/hw/cpc.ts`, `content/hardware.ts`)
- [x] PR/SM entitlement, white-space redistribution, LCP limits, initial/absolute caps (`sim/hw/prsm.ts`, `sim/hw/pools.ts`)
- [x] HiperDispatch polarity (SPEC §5.3.3) and efficiency; VL parking
- [x] PR/SM overhead (LPAR + PHYSICAL) and short-engine effect
- [x] z/OS dispatcher by DP level; Erlang-C CPU delay; zIIP overflow / IIPCP (`sim/zos/dispatcher.ts`)
- [x] Unit tests: polarity table cases, Erlang-C sanity, entitlement math, Midwest polarity (F10)
- [x] Wire dispatcher into `step`
- [x] Use previous tick's effective/delivered ratio to convert OS demand to physical demand
- [x] PR/SM reports *available* capacity (entitlement + white-space share) for queueing, separate from delivered/consumed

### M2 — Workloads & WLM
- [x] Arrival model (diurnal bumps/weekly/payday/month-end/growth/AR(1) noise) + static routing (`sim/workload/arrivals.ts`)
- [x] Service definition data model; classification rule engine (nested rules, wildcards, forced SYSTEM, memoised) + tests
- [x] Multi-period ageing via log-normal partial expectations (`sim/workload/periods.ts`)
- [x] Using/delay derivation, velocity, RT composition, log-normal distribution, backlog + Little's-law wait, timeouts, retry storms, closed-loop TSO
- [x] Dependencies: server address-space health → "other" delay on dependents (pulled forward from M3)
- [x] PI (avg, percentile with 14 buckets, velocity, discretionary 0.81); local and sysplex (merged accumulators)
- [x] Policy adjustment loop (receiver, bottleneck, donors, receiver value, net value; one receiver per interval) + WLM activity log
- [x] CPU Critical constraint; blocked workload promotion (BLWLINTHD/BLWLTRPCT); IIPHONORPRIORITY; resource group *maximum* (types 1–3)
- [ ] Resource group *minimum*
- [ ] Discretionary goal management (capping of overachievers, SG24-7621 §4.22 conditions)
- [ ] I/O priority management, MPL/swap, storage delays (need M3 models)
- [x] Realism tests: importance ordering, SG24-7621 percentile PI example, priority inversion via Db2, zIIP flaw F7, determinism
- [x] Starting policy BASEPOL (flaws F1–F6) and Midwest workloads/address spaces content

### M3 — Subsystems, dependencies, I/O, CF, storage
- [x] Dependency graph + server health → dependency delay (done in M2)
- [x] CICS: QR TCB single-engine limit per AOR (Erlang M/M/1 + overload failures), MXT queueing (`sim/subsys/cics.ts`); 2 AORs per prod image
- [x] Db2: BP hit curve → physical I/O per txn, MAXDBAT queueing, batch↔online lock contention (`sim/subsys/db2.ts`)
- [x] MXT/DBAT waits are *outside* the work manager: users feel them (SLA RT), WLM/RMF don't
- [x] DASD model: IOSQ (HyperPAV exposures, hot-volume skew) + PEND (fabric) + DISC (cache miss × back end) + CONN (`sim/io/dasd.ts`)
- [x] CF model: utilisation, sync time, shared-engine dispatch wait (thin interrupts vs polling), sync→async heuristic, z/OS CPU spin cost (`sim/cf/cf.ts`); polling shared CFs burn their ICF share
- [x] Real storage / paging delay (storage-critical classes exempt) (`sim/zos/storage.ts`)
- [x] Batch: nightly DAG generator (9 streams, ~165 jobs, critical STL/CRD/GLF/STM), JES and APPROX WLM-managed initiators, discrete progress with CPU/zIIP/I-O stretch, Db2-health and lock stretch, critical-path projection, night summaries/deadline (`sim/subsys/batch.ts`, `content/batch/`)
- [ ] MQ queue depth model (PAYMQ currently plain CICS-style)
- [ ] CF structure rebuild / duplexing, CF link events (come with the event deck in M5)
- [ ] CICS REGION-mode management and "free ride"
- [x] Tests: DASD composition + alias effect, CF async conversion + thin interrupts, BP curve, DBAT/MXT, QR, paging, batch scheduling/stretch/projection/generator determinism

### M4 — Capping, cost, measurement
- [x] R4HA (48 × 5-min slots from IPL zeros), defined capacity, group capacity (weight shares + donation), capping delay as a separate WLM delay state (CAP, not WLM-fixable) (`sim/cost/r4ha.ts`)
- [x] MLC: hourly peak-of-sums per product with DC limiting, tiered price, monthly bill (`sim/cost/mlc.ts`, `content/pricing.ts`)
- [ ] TFP alternative (arrives as an M5 event/choice)
- [ ] SCRT-style monthly report renderer (data is there: `cost.hourly`, `cost.bills`)
- [x] SMF/RMF interval accumulators and records: 70.1-like CPU/partition, 72.3-like WLM per system + sysplex roll-up (PI, velocity, using/delay %, APPL%, buckets), 74.1 DASD, 74.4 CF, 30 job ends; interval length from config (F11: 30 min) (`sim/measure/rmf.ts`)
- [x] Postprocessor-style text renderers: WLM summary + detail with RT distribution, Partition Data, CF Activity, DASD (`sim/measure/reports.ts`)
- [x] Tests: R4HA window and capping hysteresis, spikes under DC, SG24-7621 group-capacity example, donation, full-sim DC hold, MLC peak-of-sums + DC limit + tiers, interval records + renderers

### M5 — Game layer
- [x] Sim command system for every player verb + event modifiers (rate/CPU/AS multipliers, CF/DASD degrade, lock boost, job abend/restart, new workloads, routing) (`sim/core/commands.ts`)
- [x] Per-workload response-time component breakdown (for incident ground truth)
- [x] Run/day state machine (briefing → live → review → draft) (`game/run.ts`); weekends not yet auto-simulated
- [x] Economy: trust facets, engineer-hours + overtime → fatigue, opex (MLC + CoD) vs budget, capex, insight
- [x] Change board: planned vs emergency changes, failure risk, freeze constraint, hardware lead times, temporary CoD with revert, event fixes (`game/catalog.ts`, `content/hardware-catalog.ts`)
- [x] Event deck engine + 9 events with clues/fixes, scripted story beats (CFO mandate, 05:00 deadline, merger, freeze) (`content/events/`)
- [x] Hourly SLA accounting, incidents with ground-truth mechanism/trigger vs healthy baseline, RCA scoring (`game/sla.ts`)
- [x] Draft rewards and perks (`content/draft.ts`); scoring; win/loss (trust, 2 batch misses, opex > 125%)
- [x] Bot runner `npm run bot -- --bot donothing|oraclerca` (`tools/bot.ts`, `tools/strategies.ts`)
- [x] BUG fixed: retry storms diverged to NaN (a failure counted by QR overload *and* as a timeout); retries now capped at 2× organic rate, failures per tick ≤ arrivals
- [x] Balance (seed 42): do-nothing loses on **day 15** (target 12–18); textbook bot (day-1 fixes F1–F11 + restarts + fixes) loses on **day 29** (target 28–32). Persistent events now self-resolve eventually (RLF governor 5 h, DBA 30 h, monitor rollback 48 h)
- [x] Incident capping attribution limited to the LPARs a workload runs on
- [ ] End-of-run report; weekend auto-sim; Insight spending (M7)
- [ ] Midwest Mutual scenario with flaws F1–F12 (F1–F11 in place; F12 trivially)

### M6 — UI (playable vertical slice)
- [x] Game in a Web Worker (`src/worker/game.worker.ts`), message protocol, 10 Hz view model with fog of war (`src/game/view.ts`)
- [x] Ops Console: LPAR CP/zIIP/ICF bars with polarity, MSU/R4HA/DC/CAPPED; SLA tickers; PI heat map (blue↔orange, colour-blind safe); batch window; incidents; ops log; speed controls 0–8×
- [x] RMF report browser (green-screen Postprocessor text): WLM summary/detail per system, Partition Data, CF, DASD; only intervals before today's 06:00 during the live day (tier-0 fog)
- [x] Change Desk: HMC (weight, logical CPs/zIIPs, defined capacity), WLM structured edits (period goals, new class, CPU critical, classification rules) + JSON review/activate, z/OS/Db2/CICS/CF/batch/routing actions, hardware orders, event fixes, job restarts
- [x] Briefing, end-of-day report card, RCA form, draft cards, game-over/victory overlays
- [x] Headless screenshot driver `node tools/screenshot.mjs <dir>` (needs `npx vite preview`); verified no JS errors and no mobile horizontal overflow
- [x] MSU and R4HA per-LPAR line charts (5-min samples): own SVG component instead of uPlot (crosshair tooltip, legend, direct labels, table view; palette validated with the dataviz validator in both themes) (`src/ui/LineChart.tsx`)
- [x] HMC live polarity preview while editing weights/logicals, with the 2:1 logical:physical warning
- [x] Classification test bench ("where does this work go?") against the pending or active policy
- [x] Autosave to IndexedDB on every phase change; "Continue saved run" in the day-1 briefing (`src/worker/storage.ts`)
- [x] BUG fixed (user report): WLM button edits seemed to do nothing. They edited a hidden pending policy, and "Install & activate" sent stale or empty JSON. Now the pending policy (auto-named BASEPOL2, 3, …) is shown with changed rows highlighted, Install activates it directly, Discard drops it, and the JSON view stays in sync (verified end to end in Chromium)
- [x] Theme tokens follow the artifact contract (dark-first, explicit light/dark overrides, `color-scheme`); build published as a multi-file artifact (`vite build --base ./`)
- [ ] Batch Gantt, PI history heat map (→ M7.3 / M8.5)
- [ ] Pin report values as RCA evidence (→ M7.3)

### M6.1 — User requests (do these first)
- [x] **Classification rules view** (requested 2026-10-19). Done: `src/ui/RulesView.tsx`, now folded
  into the Change Desk WLM section as a full-width expandable panel (user feedback; the separate tab is gone); `explainClassification` + `diffRows` (`src/game/classifyExplain.ts`);
  path-based `ADD_RULE` (with nesting), `DELETE_RULE`, `MOVE_RULE`, `SET_RULE_TARGET`,
  `SET_DEFAULT` edits; 8 tests; verified in Chromium (retarget DB* → STCHI shows "changed",
  pending BASEPOL2; no mobile overflow). Original brief: A dedicated, readable view of the WLM
  classification rules, so players can see where work goes without reading JSON:
  - New "WLM policy" area (tab or full-width Change Desk panel) listing, per subsystem type
    (STC, JES, CICS, DDF, TSO, OMVS…): the default service class/report class, then the rules
    **in evaluation order** (first match wins), nested rules indented, each row showing
    qualifier type, pattern, → service class, report class
  - Show active and pending side by side, or pending with a diff marker (added / removed / changed
    rows), consistent with the pending-policy indicator in the WLM panel
  - Per-rule actions: move up/down (order matters), edit target class, delete; "add rule here"
    (needs new `WlmEdit` ops: `MOVE_RULE`, `SET_RULE_TARGET`, plus nested insert)
  - "What lands here" column: which known workloads/address spaces each rule currently catches
    (run `classify` over the scenario's workloads + address spaces), and an "unclassified →
    SYSOTHER" warning row (ties into the audit constraint and new-app events)
  - Highlight the forced-SYSTEM address spaces and built-in defaults (SYSSTC for STC, SYSOTHER
    otherwise) so the implicit rules are visible too
  - Tests: `applyWlmEdit` for the new ops; a pure `explainClassification(def, scenario)` helper
    that returns rule → matched work, unit-tested against BASEPOL (e.g. `DB*` catches
    DB1AMSTR/DBM1/DIST but not DB1AIRLM, which `*IRLM` takes first)
- [x] **Change Desk quality-of-life pass** (requested 2026-10-19). Done: `src/ui/Actions.tsx` rewritten
  on a `ConfigView` (live config in the view model), shared `previewChange` (catalog.ts; also used by
  `requestChange`), pure helpers in `src/game/changeDesk.ts` (validation, "now → new" descriptions,
  basket merge, AOR naming), `cancelChange` + `CANCEL_CHANGE`, persistent results log. Enter stages
  into the basket (applying costs hours, so it takes an explicit click); one-click choices apply on
  click, shift-click stages. 8 tests; Chromium: stage → submit → cancel (refund) and
  stage → submit → start day → APPLIED, no phone-width overflow. Not done: Codex links (wait for
  M7.5); fixes are labelled "no open incident" rather than hidden. Original brief: Make every control show what it
  will change, what it costs, and what happened:
  - **Current values everywhere:** inputs prefill from the live config and show "now: X" beside
    the field (DEVT defined capacity, zIIP logicals, Db2 BP size and MAXDBAT, CICS MXT, job-class
    initiators, CF settings, routing). No hard-coded defaults such as `BP 60` or `zIIP 1`
  - **Cost preview before submit:** each submit button shows hours (e.g. "Set · 0.5h"). During the
    live day it also shows the emergency trust cost and the change-failure risk at current fatigue.
    Disable buttons the player can't afford, and say why
  - **Inline validation** instead of post-hoc toasts: weight 1–999, logical CPs ≤ online + reserved
    (show the max), memory vs unassigned CPC memory, defined capacity ≥ 1 MSU, freeze constraint
  - **Change basket:** stage several edits (weights, logicals, caps, policy) and submit them as one
    change-board item with one failure roll. Show a diff summary ("PROD1 weight 500 → 565")
  - **Change board:** cancel/undo a PLANNED change before the day starts (refund hours/capex);
    group by day; show what's on order (hardware delivery day, CoD expiry); collapse applied history
  - **Feedback that sticks:** keep a results log in the panel (toasts vanish after 4 s); failures
    say what to do next
  - **Subsystem controls driven by data, not presets:** Db2 member list from config; name new CICS
    AORs (no random names) and list existing regions with MXT/QR load; a generic routing editor
    (per workload, a share per LPAR, normalised); job-class editor (mode, initiators per LPAR)
  - **Context:** short "what this does / trade-off" help per control with a Codex link (M7.5);
    units on every field (MSU, GB, CPs × 100, seconds)
  - **Only relevant actions:** event fixes enabled only while a matching symptom is plausible (or
    marked "no active issue"); abended-job restarts listed with the job's stream and critical flag
  - **Layout:** collapsible sections (HMC, WLM, Subsystems, Hardware, Operations), Enter submits,
    visible focus states, works at phone width; keep the pending-policy banner pinned while editing
  - Tests: pure helpers for cost/risk preview and basket diff; one Chromium run through
    basket → submit → start day → applied

### M7 — Analytics, fog of war & strategic depth
Goal: turn "half blind" into the progression spine (SPEC §8). Insight is earned by investigating and
spent on tools; better tools reveal more data but cost CPU. Done when a player can buy their way from
end-of-day reports to live diagnosis and what-if planning, and the bots show tools change outcomes.

**M7.1 Insight economy & tool tree (game layer)** — done (loop 10)
- [x] `content/tools.ts`: 13 tool defs `{id, tier, insightCost, prereqs, unlocks, overhead, reveals, comingSoon}`; `RunState.tools/toolsOff`
- [x] Earning Insight: +1 per distinct report opened per played day (cap 5; resets at the next briefing), RCA points (exists), vendor trial (exists). +2 per what-if waits for M7.4
- [x] `game/tools.ts` `buyTool` / `setToolActive`: prereqs, Insight, measurement overhead re-issued as `SET_MODIFIER measureCpu` commands; `normalizeRun` migrates old autosaves
- [x] Measurement overhead model: new `mods.measureCpu` (stacks with event `cpu`/`asCpu` mods): SMF 101 +3% DDF/CICS, SMF 110 +4% CICS, Monitor III RMFGAT ×2, SMF 113 ≈ 0
- [x] Report gating: Partition Data needs its tool, CF/DASD need tier 2 (worker refuses, Reports buttons disabled); Monitor III shows today's closed intervals
- [x] UI: "Analytics" tab (tier columns, cost, overhead, prereqs, Install / Switch off), Insight in the top bar
- [x] Tests (4): prereqs/Insight, overhead on/off, SMF 110 overhead visible in WLMGL APPL% (+0.5–4%), report Insight cap/reset
- Tools whose data views don't exist yet are listed as "Coming soon" (all tier 2 except CF/DASD, tiers 3–4) so players can plan; they become buyable as M7.2–M7.5 land

**M7.2 Tier 1: live visibility** — mostly done (loop 11)
- [x] Fog of war is tool-driven (`features(run)` in `game/tools.ts`): today's intervals with Monitor III; Partition/CF/DASD gated (M7.1)
- [ ] ~~RMF interval < 15 min needs the tool~~ dropped: the Postprocessor interval is just SMF INTVAL on real systems, so gating it would be fake. The 30→15 planted inefficiency stays
- [x] RMF Monitor III tab (`src/ui/Monitor.tsx`, `src/game/mon3.ts`): SYSINFO, DELAY, PROCU, ENCLAVE, CPC, WFEX, built from WLM's smoothed accumulators (≈ 67 s effective range; APPROX for Monitor III's 100 s MINTIME)
- [x] WLM activity log live with Monitor III (otherwise readable after the day); click/hover explains each decision (`explainWlmLog`)
- [x] Live CPC view: weights, logicals, polarity, busy, PR/SM delay, overhead, capped %, L:P warning above 2:1
- [ ] PROCU is per service-class period, not per address space (slices are not kept per tick). Add top address spaces if a diagnosis needs it
- [ ] Report classes start to matter (per-workload WLMGL rows, F6): moved to M7.5 with the report class advisor tool
- Tests (6): visibility gating, PROCU ≈ delivered CPU, ENCLAVE zIIP use, a CPU regression raises delay + WFEX, log explanations, velocity scale
- Dev aid: in `npm run dev` builds `globalThis.__goalMode.send(msg)` reaches the worker, and `DEV_INSIGHT` grants Insight (used by headless UI checks)

**M7.2.1 Monitor III charting (user request 2026-10-19)** — done (loop 13)
New tier-2 tool **"Monitor III charting"** (`MON3_CHARTS`: prereq Monitor III, 10 Insight, RMFGAT CPU ×1.5)
charting today's Monitor III data over time; only the diagnosis-driving metrics are charted:
- [x] Sampling (`game/mon3Charts.ts`): one compact sample per sim-minute (`MON3_CHARTS.sampleTicks` = 6) from
  `buildMon3`, while both tools are on; reset at 06:00 (`startDay`); ≤ 1,440 samples/day (~1.7 MB JSON
  for a full day in `RunState.mon3Charts`); +~0.5 s per headless day only when owned
- [x] PI by period (importance 1–2 by default, toggle all) with the PI = 1 goal line
- [x] CP busy per system + CPC busy with the 100% line
- [x] Stacked delay breakdown for a chosen period (CPU, zIIP, I/O, CAP, other/UNK)
- [x] PR/SM dispatch delay per LPAR; % capped per LPAR (shown once any LPAR was capped)
- [x] DDF: response time of period 1 (toggle later periods: long queries would flatten it) and stacked
  zIIP vs IIPCP engines
- [x] Markers on every chart: WLM receiver decisions (tick at top), changes and policy activations
  (dashed), events/incidents (dotted); hover lists them; capped at 400/day (WLM ones trimmed first)
- [x] `LineChart` gained stacked areas, markers and drag-to-zoom; one shared zoom range drives all
  charts; palette extended to 8 validated categorical slots (light + dark, dataviz validator)
- [x] Worker sends history incrementally (`GET_MON3_CHARTS` from index) instead of in every VIEW
- [x] Tests (4): cadence + determinism, off without either tool, delay stack = DLY%, change markers + daily reset.
  Chromium: light + dark, zoom, tooltip; fixed a crash from a stale hover index after zooming
- Planned changes applied at 06:00 are now logged ("Planned change applied: …") so they show as markers
- [x] (user request) **Response time chart with a class picker** replaces the DDF-only RT chart: a dropdown of
  every transactional service-class period and every report class seen today, up to 8 at once; each picked
  class keeps its colour slot until unpicked. Samples now carry `rt` (period RT from the Mon III window)
  and `rcRt` (report-class RT from per-workload completions accumulated every tick since the last sample)
- [x] (user request) Colours follow the entity: series are ordered by first appearance in the day
  (`firstSeen`), so a new class (e.g. `DDFMOB`, which sorts before `DDFPRD`) no longer repaints older lines
- [x] Report classes are editable in the rules view (per-rule field + "report class" on Add rule);
  `applyWlmEdit` validates the name and registers it in `reportClasses`. Report-class RMF/WLMGL rows remain M7.5

**M7.3 Tier 2: deep data** — done (loops 12–16)
- [x] CF per structure (loop 15): `config.cfStructures` (name, LOCK/CACHE/LIST, share of requests, CF,
  cost) replaces the per-CF `requestShare`; a CF's load is the sum of its structures. Lock requests are never
  converted to async (APPROX), so a lock structure on a slow/shared CF spins every Db2 transaction on the z/OS
  CP. New `MOVE_STRUCTURE` command (SETXCF REBUILD, 1 h); CF Activity report gets a STRUCTURE SUMMARY
  (req/s, sync %, sync and average service); Change Desk structure placement table. Initial placement keeps the
  70/30 split (GBP0 + list structures on the weak CF02 = F8). Realism test: LOCK1 → CF02 more than doubles
  RBANK's CF time and raises PROD1 CPU; GBP0 → CF01 lowers it. Bots unchanged (do-nothing day 15, textbook day 29)
- [x] DASD per LCU (loop 16): 6 LCUs × 200 volumes (`config.dasd.lcus`: volumes, aliases, per-class I/O share,
  hot skew, utility `extraIops`) + `spareAliases`. HyperPAV aliases pool per LCU and are never borrowed across
  LCUs; an LCU addresses ≤ 256 devices. Utility I/O lands on hot volumes. `SET_LCU` (aliases from/to spares,
  hot skew, extra I/O); +64 aliases hardware now buys spares to assign. DASD Activity gets an LCU summary
  (vols, aliases, rate, resp, IOSQ, aliases per hot volume). Change Desk "DASD" section: aliases per LCU
  (staged releases count as spare; releases run first), rebalance (4 h, hot skew ×0.7, floor 0.15). New event
  REORG_OVERRUN (day ≥ 6, 20:30–22:30, 3 h): 55k utility I/O/s on LCU 21 exhausts its aliases → batch
  stretches; clues in the LCU summary and SMF 30; fixes: move aliases to LCU 21, or -TERM UTILITY (new fix,
  Finance trust −1). Day-to-day IOSQ stays ≈ 0 (calibrated against the old model: RANDOM resp ≈ 0.22 ms)
- [x] SMF 113 counters (`game/smf.ts` `smf113`): L1MP/RNI/CPI per image from the share of work off VH engines and CPC busy (FICTIONAL coefficients in `content/smf.ts`); LSPR category from IBM's L1MP/RNI table (`lsprCategory`)
- [x] Db2 accounting (SMF 101): per package (`DB2_PACKAGES`), class 1 elapsed, CPU/txn vs the workload's healthy baseline, class 3 lock / sync I/O / CF, not-accounted, DBAT queue; per closed hour (`RunState.smfHours`, 48 h) or the current hour. A ×3 REGRESSION shows as RB01 ×3 vs base; lock escalation as lock ms
- [x] CICS monitoring (SMF 110): per transaction CPU vs baseline, QR wait, MXT wait, dispatch wait, failures. Per-AOR QR busy not shown (the sim computes QR per LPAR, not per region)
- [x] SMF 30 batch analytics: Gantt of the latest night from RMF interval job-end records (queue + elapsed, critical jobs highlighted, stream filter, last critical job)
- [x] RCA evidence pinning (loop 14): 📌 on Monitor III (SYSINFO PI, DELAY reasons, PROCU APPL%, CPC PR/SM delay
  and capped %), Db2 101 and CICS 110 cells, plus a "Pin from this interval" form on the Workload Activity /
  WLMGL reports (tier 0 path). The worker builds each pin from a locator, so value and time are authoritative
  (`game/evidence.ts`). Up to 12 pins on an evidence board (Reports and Monitor III tabs); up to 3 per RCA.
  Each pin is judged (`judgeEvidence`): inside the incident window ± 1 h, about the hurt workload (its class,
  LPARs or the sysplex; server-side clues such as CPU delay, lock and CF may sit elsewhere), notable
  (FICTIONAL thresholds in `content/evidence.ts`), and pointing at the true mechanism or trigger. Specific
  clues count 1, catch-alls (other/UNK, APPL%, rate) 0.5, PI 0 ("a symptom, not a cause"). Evidence points
  only with the right mechanism; ≥ 2 relevance is "strong" (+5 Insight). The review shows a ✓/✗ verdict per
  pin with the reason; "Investigate" hides the review so players can pin, and the RCA shows the breach window.
  Codex unlock for strong evidence waits for the Codex (M7.5)
- UI: "SMF analytics" panel under the RMF Postprocessor (Reports tab); data via `GET_SMF`/`SMF` worker messages; Db2/CICS views earn report Insight per hour viewed
- Tests (8): LSPR table, hour retention, regression → package, lock escalation → lock ms, CICS rows, SMF 113 ranges, Gantt, tier-2 tools buyable

**M7.4 Tier 3: planning & automation**
- [ ] What-if simulator: fork `RunState.sim`, apply proposed changes, run tomorrow headless with forecast arrivals and no hidden events; report SLA/batch/R4HA deltas; costs hours + Insight. Needs ≥ 4× headless speed (see M8.1 perf)
- [x] Capacity planner (loop 17, tool CAP_PLANNER now buyable): daily peaks recorded at each day end
  (`RunState.capacityDays`: online-hours CPC busy 08–18, R4HA per LPAR and summed, DC, critical batch end).
  `game/planner.ts` fits a log-linear trend over the last 10 days (≥ 3) and projects 14 days with a 90%
  prediction interval (σ floor, widens with horizon). Forecasts: CPC busy (capped at 100%, limit 90%), R4HA
  sum (MLC), R4HA vs DC per capped LPAR, critical batch end vs 06:00; "will cross" / "at risk" tags and a
  plain verdict. Panel on the Analytics tab. Uses measured history only. Night CPC busy was excluded after the
  first Chromium check showed 99.6% every day (batch soaks up free CPU)
- Dev aid: `DEV_FAST_DAYS {days}` (dev builds) plays whole days headlessly to reach later-game states
- [x] Alert rules (loop 18, tool ALERTS now buyable): up to 10 rules over Monitor III data (`content/alerts.ts`:
  PI of a period, CPC busy, LPAR capped %, R4HA % of DC, batch slack to 06:00), evaluated every sim-minute in
  `game/alerts.ts`; a rule pages once after holding for N minutes and again only after clearing; optional
  pause (worker stops the clock and toasts the page; VIEW now carries `speed` so the UI shows it). Night pages
  (20:00–06:00) add 0.5 fatigue each: noisy rules cost. Monitor III tab panel with suggested rules, add/remove,
  firing tags and a page log. 3 tests; Chromium: a CPC rule paged at 06:05 and paused the game
- [ ] Automation rules (System Automation-like): `IF condition THEN command`, e.g. restart abended job once, activate policy override at 20:00; misfires possible and logged
- [ ] Capacity Provisioning Manager: On/Off CoD rules (refused for hard-capped LPARs, per IBM guidance)
- [x] WLM service policies + daily schedule (loop 19): save the pending/active policy under a name (≤ 4),
  schedule up to 4 daily switches (`game/policies.ts`); the run issues `V WLM,POLICY=name` on the hour at no
  cost; editing the schedule costs 0.5 h and is blocked by a change freeze. Change Desk section "WLM service
  policies and daily schedule". Trade-off: a batch-friendly night policy hurts night online spikes; a manual
  activation is replaced at the next switch. Real WLM "policy overrides" inside one policy are not modelled:
  whole policies are swapped (APPROX, same effect for the game). 2 tests; Chromium: 07:00 NIGHTPOL, 08:00 DAYPOL

**M7.5 Tier 4 & strategic options**
- [ ] AIOps anomaly detection: ranked RCA hypotheses with confidence, sometimes wrong (seeded), from `incident.truth` plus noise
- [ ] Tailored Fit Pricing offer (mid-run event): switch billing to consumption (MSU-hours vs baseline); capping no longer saves money
- [ ] SCRT-style monthly report renderer (from `cost.hourly`/`cost.bills`) and Finance view
- [ ] Multi-day projects (SPEC §6): threadsafe CICS conversion (qrFrac ↓), zIIP-enable Java, Db2 compression, SQL tuning sprint; progress per day, hours each day
- [ ] Codex: `content/codex/*.ts` entries per concept (WLM PI, velocity, polarity, R4HA, QR TCB, sync/async…) with IBM/practitioner source links; unlock on first encounter

**M7 sim leftovers that the tools expose**
- [ ] Resource group *minimum*; discretionary goal management (SG24-7621 §4.22 conditions)
- [ ] I/O priority management, MPL/swap delay; MQ queue-depth model for PAYMQ
- [ ] CF structure rebuild on CF failure (needs white space), duplexing cost
- [ ] CICS REGION-mode management and the "free ride"

### M8 — Balance, difficulty, content & polish
Goal: a run that is fair, readable and replayable. Done when bots hit their targets on every difficulty,
three scenarios ship, a new player can finish day 1 with the tutorial, and an accessibility pass is clean.

**M8.1 Performance (prerequisite for bots and what-if)**
- [ ] Target ≤ 2 s per headless day (now ~7–8 s): incremental dispatch in policy-adjust projections, skip receivers that failed recently, precomputed log-normal bucket tables, avoid per-tick object churn in batch/RMF accumulators (profile first; keep determinism)
- [ ] Benchmark script `npm run bench` with a fixed seed; record results here

**M8.2 Balance harness & targets (SPEC §16)**
- [ ] `tools/sweep.ts`: run bots over N seeds in parallel processes → CSV (day lost, cause, score, MLC, incidents by mechanism)
- [ ] Bots: donothing (lose day 12–18), textbook (≈ day 28–32), spendtowin (On/Off CoD every day: SLA fine, loses on opex), expert (scripted good play incl. capacity orders and caps: wins with grade A on Normal)
- [ ] Targets hold across ≥ 20 seeds (median and spread), not just seed 42; event-deck intensity, growth rates and trust weights tuned from sweeps
- [ ] Golden runs (`tests/golden/`): seeded scripted runs hashed per day; changes to them must be intentional

**M8.3 Difficulty & run structure**
- [ ] Difficulty presets (Story / Normal / Hard / Ironman): growth multipliers, event λ and severity tiers, budget generosity, starting flaws, pause disabled in Ironman
- [ ] Weekend auto-simulation at high speed with a summary card (maintenance batch, REORGs); optional "play the weekend"
- [ ] Endless mode after victory; daily seed challenge with shareable seed + score
- [ ] End-of-run report: R4HA over time, PI heat-map history, decisions timeline, biggest incident, best RCA, grade S–D
- [ ] Meta-progression (career XP → unlock scenarios, starting perks, starting tool; Codex persists) in IndexedDB

**M8.4 Content**
- [ ] Events to ~25 (SPEC §9): new-app go-live in SYSOTHER, CICS SOS, QR saturation, HyperPAV exhaustion, CF02 failure + rebuild, CP sparing, vendor price increase, power cap, hiring freeze, audit (SMF retention, unclassified work), shadow IT on DEVT
- [ ] More draft options and perks; constraint cards with persistent modifiers
- [ ] Scenarios: *Continental Insurance* (IMS-heavy claims batch, needs an IMS subsystem model), *State Revenue Agency* (tax-season spike, strict regulator), *Global Airline* (24×7, two CPCs/sites, GDPS-style constraints)
- [ ] Each scenario ships with its own flaw list (SPEC §13.3 rules) and story beats

**M8.5 UX polish & accessibility**
- [ ] Guided tutorial for day 1 (spot F1 via WLMGL, fix a classification rule, watch PI recover)
- [ ] Charts everywhere they help (MSU/R4HA, PI history, batch Gantt) with crosshair tooltips and table views (dataviz rules: validated palette, no dual axes)
- [ ] Keyboard-first controls, focus states, forced-colors support, every chart with a table view, contrast check in both themes
- [ ] Sound/feedback: pager chime on incidents, subtle tick at hour boundaries (mutable)
- [ ] Settings: theme toggle, classic 3270 colours, speed defaults; error boundary + crash-safe autosave
- [ ] Deploy target (static hosting) and a README

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
| 2026-10-19 | I/O: connect+disconnect count as *using*, IOSQ+pend as *delay* | APPROX; makes velocity goals for I/O-heavy work achievable. Needs confirming against MVS Planning: WLM (open question) |
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
| 2026-10-19 | CF load comes from named structures placed on CFs; lock requests never convert to async | Gives CF placement a real diagnosis path (lock vs GBP) and a trap; per-CF request shares were opaque |

## Open questions

- WLM I/O using vs delay: is disconnect time counted as using? Currently connect+disconnect = using.
- CICS: does WLM/RMF response time include MXT queue time? Currently treated as outside the work
  manager (like DBAT queueing before enclave creation). Verify against CICS performance docs.
- Policy-adjust projections don't model backlog/DBAT feedback, so WLM sometimes places batch above
  DDF while DDF is happy and then can't undo it quickly. Realistic in spirit, but watch in balancing.
- Real WLM learns server topology for CICS/IMS regions (and enclaves inherit DP). We charge
  transaction CPU directly to the transaction's service class ("manage regions by
  TRANSACTION goals"). REGION mode and the "free ride" are not modelled yet.

- Percentile PI edge cases: how exactly does WLM handle periods with very few completions
  (minimum-sample rules)? Currently an EWMA with a variable horizon. Check *MVS Planning: WLM*.
- WLM-managed initiator start/stop heuristics: the JES2 Init & Tuning Guide "queue delay
  measurements" section wasn't reviewed yet.
- How to visualise policy-adjustment decisions without overwhelming players? (WLM Activity log
  is Tier 1; maybe an "explain this DP change" tooltip.)
- R4HA after IPL: model the initial-window behaviour, or ignore it in v1?
- TFP details (baseline commitment, overage pricing) are left deliberately abstract; is
  that enough for the strategic choice to feel real?
- Should two-CPC topologies (cross-site sysplex) be in the base scenario or saved for the
  airline scenario?
- Tuning target for "fun density": how many meaningful decisions per live day? (Target: 3–6
  alerts that matter, 1–2 incidents in Act II+.)

## Risks

- **Model complexity vs performance:** policy-adjustment projections re-run the evaluator
  (≤2 receivers × ≤6 trials per system per tick). Now ~0.4 ms/tick (~3.7 s/day headless) against a
  2 s/day target. Fine for the UI (4 ms/tick budget) but slow for bots/what-if. Ideas: skip
  projections for receivers that failed in the last N intervals, incremental dispatch (only
  re-allocate levels at/below the moved DP), cheaper bucket math (precomputed z-tables).
  After M3: ~0.75 ms/tick; profile spread over step bookkeeping (~25%), evaluator (~30%), adjust (~15%).
- **Opaque cause and effect:** if players can't see *why*, it feels random. Mitigate with clue
  design rules (SPEC §13.3) and the WLM Activity log.
- **Balance whack-a-mole:** keep bots and golden runs from M2 onward.

## Session log
- **2026-10-19 (loop 19, hourly task):** saved WLM service policies with a daily switch schedule. 174 tests.
- **2026-10-19 (loop 18, hourly task; session had restarted):** alert rules with pause-on-page and night
  fatigue. 172 tests.
- **2026-10-19 (loop 17, hourly task):** capacity planner (daily peak history, trend + 90% bands,
  Analytics panel), `DEV_FAST_DAYS` dev aid. 169 tests.
- **2026-10-19 (loop 16, hourly task):** per-LCU DASD model, alias editor, LCU report, REORG_OVERRUN
  event + TERM_UTILITY fix; basket orders alias releases first. M7.3 complete. 165 tests. Bots (seed 42):
  do-nothing day 15 (unchanged); textbook day 28 by two consecutive batch misses (was day 29, trust) since
  it ignores REORG_OVERRUN; still inside the 28–32 target. Lesson: `pgrep -f` wait loops match their own
  command line; wait on files/PIDs instead.
- **2026-10-19 (loop 15, hourly task):** per-structure CF model and placement editor; CF Activity
  structure summary; realism test; bots re-run (unchanged). 160 tests.
- **2026-10-19 (loop 14, hourly task):** RCA evidence pinning end to end (pins, board, judging, review
  verdicts), verified in Chromium by playing day 1. Fixed: average-RT SLA attainment could show > 100%
  when an hour failed only on errors (display/log only; scoring uses breach hours). 157 tests.
- **2026-10-19 (user request):** Monitor III charts: response-time chart with a service/report class
  picker, first-seen colour order, report classes editable in the rules view. 152 tests.
- **2026-10-19 (loop 13, hourly backstop after a session restart):** re-created the 15-min cron
  (8378d3ec). M7.2.1 Monitor III charting tool (user request). `allWorkloads` moved to
  `game/workloads.ts` to keep game modules free of import cycles. 150 tests.
- **2026-10-19 (loop 12):** M7.3 tier-2 data: Db2 accounting, CICS monitoring, SMF 30 Gantt and
  SMF 113 counters; four tools now buyable; 48 h of hourly SMF detail kept in the run. Caught
  two tools still marked "coming soon" by a sloppy scripted edit (screenshot), fixed + test.
- **2026-10-19 (user request):** Classification rules moved from their own tab into the Change Desk:
  a "▸ Classification rules" toggle in the WLM section (with rule count and SYSOTHER warning)
  expands the full rules view below it; install/discard via the pinned pending-policy banner.
- **2026-10-19 (loop 11):** M7.2 Monitor III: live SYSINFO/DELAY/PROCU/ENCLAVE/CPC/WFEX views,
  live WLM log with explanations, dev hook for headless UI checks. 138 tests. Found and fixed a
  velocity ×100 bug via screenshots. Dropped "RMF interval < 15 needs a tool" (not realistic).
- **2026-10-19 (loop 10):** M7.1 Insight economy and tool tree: tool content, buy/switch-off,
  `mods.measureCpu` overhead, report gating, Analytics tab, Insight per report. 132 tests.
  Textbook bot unchanged (loses day 29). Lesson repeated: `pkill -f` matching its own shell
  kills the command (exit 144); use task IDs / `fuser -k`.
- **2026-10-19 (loop 9, hourly backstop):** M6.1 Change Desk QoL: live values, cost/risk on every
  button with disabled reasons, inline validation, change basket with diff summary, change board
  grouped by day with cancel/refund, on-order and CoD expiry, results log, data-driven Db2/CICS/
  CF/IEAOPT/routing/job-class editors, collapsible sections, pinned pending-policy banner. 128 tests.

- **2026-10-19:** Wrote the design. Researched IBM docs (WLM Redbook SG24-7621, Db2 WLM
  guidance, zIIP config, group capacity, IEAOPT, CF sync/async, LSPR/RNI, Capacity Provisioning)
  and practitioner sources (Watson & Walker Tuning Letter, IntelliMagic, Colin Paice,
  value-4it, Longpela, SHARE handouts). Created SPEC.md, CLAUDE.md and PROGRESS.md.
- **2026-10-19 (loop 1):** M0 scaffold (Vite/React/TS/Vitest, purity test, RNG, clock, types,
  step skeleton, headless runner). M1 PR/SM and dispatcher modules with 38 passing tests.
- **2026-10-19 (loop 2):** M2 end to end: Midwest workloads and address spaces, BASEPOL,
  classification, multi-period ageing, evaluator (dispatch, RT, dependencies, samples,
  backlog/timeouts/retries), PI and sysplex PI, policy adjustment with log, blocked workload,
  CPU Critical, RG max. Fixed: dispatcher used consumed instead of available capacity (ρ≈1
  everywhere); donors excluded unhappy lower-importance work (an importance-1 class starved).
  Calibrated day-1 load. 69 tests.
- **2026-10-19 (loop 3):** M3: DASD, CF, Db2 (BP/DBAT/locks), CICS (QR/MXT), paging, batch DAG
  with initiators and critical path; pipeline rewired with prev-tick `env`. Fixed: an MXT
  feedback loop (queue wait inflated its own concurrency estimate); one AOR per image overloaded
  the QR TCB on day 1; WLM gave up after two *unfixable* receivers (now skips them); DBAT
  exhaustion masked CPU delay (queue waits now outside WLM's view). 90 tests.
- **2026-10-19 (loop 4):** M4: R4HA/DC/group capacity with CAP delay, MLC peak-of-sums billing,
  RMF interval records and Postprocessor-style renderers; headless `--report/--detail/--dc`.
  Verified a 420 MSU DC on PROD2 holds it there and hurts DDF. 102 tests.
- **2026-10-19 (loop 5):** M5 core: commands/modifiers, run lifecycle, economy, change board,
  incidents + RCA, events, draft, bots. 112 tests. Do-nothing bot (seed 42): mild incidents on
  days 1–2 (batch overlap), then a calm stretch, then collapse on day 8 under stacked unfixed
  events (regression + runaway + CF link). Created the git repo and pushed to GitHub.
- **2026-10-19 (loop 8):** 15-minute cron loop. M6.1 classification rules view: per-subsystem
  rules in evaluation order, what each rule catches (workloads, address spaces, batch streams),
  SYSOTHER and forced-SYSTEM rows, pending-vs-active diff, move/retarget/delete/insert (nested).
- **2026-10-19 (loop 7):** Fleshed out M7/M8. Session restarted; 30-minute cron loop. M6
  finished (charts, polarity preview, classification bench, autosave/continue) and the WLM editor
  bug fixed; build published as an artifact. Added M6.1 (classification rules view, user request).
- **2026-10-19 (loop 6):** Switched to a 10-minute cron loop. Fixed the retry-storm NaN; bounded
  persistent events; textbook bot. Balance on target (do-nothing day 15, textbook day 29).
  M6 vertical slice: worker, view model, Ops Console, RMF browser, Change Desk, overlays.
