# PROGRESS.md

Status tracker for **GOAL MODE**. Update at the end of every working session.

## Current status

- **Phase:** M0–M4 done (M2 leftovers: RG minimum, discretionary capping). The sim is feature-complete for a headless day: online, batch, I/O, CF, subsystems, capping, MLC and RMF reports.
- **Last updated:** 2026-10-19
- **Next up:** M5 game layer: run/day state machine, command handling (player verbs), economy (trust/hours/budget), change calendar, event deck, RCA, scoring.
- **Health:** `npm run check` green (102 tests). Headless: ~8 s/day (~0.9 ms/tick). Fine for the UI; slow for bots (see Risks).
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
- [ ] Run/day state machine (briefing → live → review); calendar; weekends auto-sim
- [ ] Economy: Trust (+facets), Engineer-Hours, Fatigue, Opex/Capex, Insight
- [ ] Change calendar, CAB, emergency changes, change failure risk, freezes
- [ ] Event deck engine + first 12 events (SPEC §9) with clues
- [ ] RCA mini-game
- [ ] Draft rewards, perks, constraint cards
- [ ] Scoring, win/loss, end-of-run report
- [ ] Midwest Mutual scenario with flaws F1–F12

### M6 — UI (playable vertical slice)
- [ ] Worker host + message protocol; snapshot coalescing
- [ ] Ops Console (PI heat map, LPAR strips, SLA tickers, R4HA gauge, batch Gantt, alerts)
- [ ] RMF report browser (text + charts, pin as evidence)
- [ ] WLM policy editor + classification test bench
- [ ] HMC screen with live polarity preview
- [ ] Briefing/inbox/calendar, Debrief/RCA/draft
- [ ] Save/load (IndexedDB)

### M7 — Analytics tool tree & depth
- [ ] Tier 1–4 tools (SPEC §8); Monitor III screens; WLM activity log
- [ ] Capacity planner + what-if fork
- [ ] Alert & automation rules engine; CPM
- [ ] Codex with source links

### M8 — Balance, polish, content
- [ ] Strategy bots and balance targets (SPEC §16) met on Normal
- [ ] Difficulty levels, Ironman, daily seed
- [ ] Additional scenarios (insurer, tax agency, airline)
- [ ] Audio/feedback polish, accessibility pass, tutorial (guided day 1)

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
