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
  2. ~~CICS_SOS realism fix~~ (#166) and ~~Revenue retune~~ (M8.7) done.
  3. ~~`step.ts` split~~ done (#168, hash-neutral: Midwest/Harbourline/Revenue bench hashes unchanged).
  4. ~~Republish the artifact from `dev`~~ done (#168 build). Overnight plan complete; loop stopped.
  **Held for the user:** the finance feedback loop, the full-day tutorial, M9. Proposals are under "Proposals awaiting
  the user" in Remaining work; none is implemented.
  The 27-card event deck is complete; add events only if a playtest asks for them.
- **Published build:** [artifact](https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv) (sharing is "anyone with the
  link"), rebuilt 2026-11-06 from `dev` at `474ae40`. Republish on request.
- **Latest verified dev:** #170; 64 test files / 573 tests pass; production build boots without console errors.
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

### Design directions (user, 2026-11-05; not scheduled, still being thought through; don't implement)

**D1. Targeted fixes unlocked by a correct RCA.** Make analysis somewhat easier, but don't offer an event's quick
operations fix until the player has pinned an accurate RCA. Example: Db2 retry storm. If an unannounced event has
been running for a while, inbox hints arrive that start vague and get more specific (the app team notices many
duplicate request IDs). "Turn on retry backoff in the API gateway" (`MOBILE_BACKOFF`) becomes available only once the
player has pinned evidence that identifies a retry storm, such as a transaction rate metric. There may be a better
form of proof that isn't in the game yet.
Notes from discussion:
- **Prerequisite: RCA judging must be trustworthy first.** In the user's playthroughs it has been flaky and often
  unfair (see "Incident truth, RCA and evidence" under Playtest round 2). Gating fixes on it would turn every judging
  bug into a blocked fix, so that list (and a general review of `judgeEvidence` / incident truth) comes first.
- Proof should be a mechanism, not a single pin. A rate pin alone can't tell a retry storm from a demand surge. The
  discriminator is END/S up at unchanged CPU per transaction, so the unlock might take a rate pin plus a pin that
  rules out a surge, judged by the existing evidence matcher (`src/content/evidence.ts`).
- Only the targeted, cheap fix is gated. Generic levers (capacity, capping, WLM changes, "protect and ride it out")
  stay open, so the choice is between paying to mitigate now and diagnosing to get the cheap fix.
- Wrong guesses need a cost (Trust/Insight per wrong draft, or limited drafts per incident), or players will
  brute-force the RCA form to unlock fixes.
- The hint ladder interacts with difficulty (Story/Normal/Hard hint clarity) and the Mentor perk. A clue source must
  not be too generous (2026-11-05: no gateway retries view).
- Bots apply fixes directly today, so textbook and expert bots would need to diagnose first, and the balance bands
  would move.
- When settled, this rewrites SPEC §10 (RCA mini-game) and parts of §9 (events); move it to its own design doc if it
  grows.

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

- Worker budget remains ≤ 4 ms/tick; the former ≤ 2 s/headless-day target is closed (user, 2026-10-27).
- Full-quarter sweeps run daily (user clarification, 2026-11-02). Revisit performance when measured sweep cost warrants it.
- Same-host, reverse-order three-day comparisons across five revisions found current totals ~28% above M8.1
  closure for Midwest and ~47% for Harbourline. The older revision also slowed on this host, so the reported
  doubling is not all attributable to code. Profiles show distributed growth, including RMF.
- Runner fixes landed: available-parallelism sweep defaults (#138), hourly diagnostics only on demand (#139).
- PR/SM pool plans already cache configuration-only work, including entitlement, by CPC and LPAR-array identity.
  A separate entitlement index showed no consistent day-level speedup across all three scenarios and was
  discarded. Configuration edits must replace those objects; in-place mutation can leave cached plans stale.
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

### Playtest round 2 (2026-11-04, expert player, daily challenge 2026-11-04, Midwest Normal, seed 467203)

Same player as round 1. Run started on `8c0dd9e` (#160), which became unplayable through a UI problem; continued on the
published `2253b11` (#164), where the incident below happened. Player policy differs from the default in the way that
matters here: card authorisation moved from ONLHI (importance 1, 95% < 0.25 s) to ONLCARD (importance 2, 99% < 0.1 s),
the same tier as DDFMOB, TSO period 1 and the other CICS classes; CICS regions `TN=CICS* → STCHI`, managed to the
transactions' goals (the default). Replays: the player's save plus forward runs from it with `play` (`draft none`) on
`2253b11`; the WLM trial trace came from temporary scratch logging in `policyAdjust`, not committed.

**INC19 CARDAUTH, D4 23:02–23:30, PROD2** (noticed in the Ops Console service levels; resolved by itself; RCA
CPU_PRIORITY/BATCH_OVERLAP, truth CPU_PRIORITY/POLICY, partial credit). The player found the clues alone (DELAY
STCHI#1 CPU delay 42%, WLMGL PROD2 STCHI#1 CPU delay 34.6%, SYSWKM CICSAOR2 velocity 9.4%, SYSSUM ONLCARD PI 4.0) but
couldn't explain why CICS was CPU-delayed with little more important work around, or why WLM never raised the
priority of ONLCARD or STCHI. WLMGL 1074 PROD2: STCHI velocity 26.8%, PI 2.23; ONLCARD PI 4.00, 90.3% < 50 ms but 2.8%
> 0.4 s, FAILED 2528. Real behaviour, not a bug: regions managed to transaction goals run at the DP of the most important
transaction class they serve (F4 here), not at STCHI's own FA, so STCHI is never a receiver (WLM Planning p.122–123,
already in docs/research.md).
- Positive: DELAY Primary Reason named the right job; DELAY and WLMGL CPU-delay pins were marked "points at the cause".

**Days 5–15 on `d8ada51`** (#170; the player continued the same save). Incidents and events as the player reported them;
investigation results are folded into the items below as they land.
- D6 08:03 **Db2 REBIND access-path regression:** start-of-day mail said a rebind ran overnight; the player saw ×2.30 vs
  base in SMF 101 (purchased tool), pinned it, then got a Db2-team mail explaining the access-path change. Fix D7 06:00:
  REBIND with APREUSE / switch back (no open incident). Accounting didn't show clearly whether it helped.
- D8 10:55 **DDFADHOC runaway on PROD2:** spotted as IIPCP in the Monitor III charts (MOBILE is routed to PROD1, so IIPCP is
  normally low); PROCU confirmed DDFADHOC hot on PROD2 (no zIIPs). Discretionary, so "should be fine"? Emergency "Cancel the
  runaway DDF thread" D8 14:25 showed no effect by 15:22; it died down by 18:51.
- D9 06:00–07:20 **PROD2 to 100% after a strict resource-group maximum** (TSO, DEVBAT, DDFADHOC discretionary, one RG,
  ~100 SU/s; DEVT defined capacity 25 MSU the same morning). Monitor III CPC: PROD2 98.2% logical effective / 100% total
  on 4 CPs, while PROCU summed to under one engine of EAppl. Taking the classes out of the RG fixed it at once.
- D10 Mobile promotion: handled by the existing setup. Positive: a well-prepared configuration absorbs an event.
- D11 **Mobile API stored procedures redeployed as new COBOL versions:** the player predicted zIIP loss and confirmed it on
  WLMGL detail (D11 09:00–09:30 vs the day before). "Redeploy as native SQL procedures" applied D12 06:00 (planned) and
  again D13 08:35 (emergency); D15 12:45 WLMGL still shows DDFMOB mostly zIIP-ineligible CP.
- D12 13:32 **Data-centre power cap:** noticed via WLM PI flashing red and the Capacity Today line dropping; On/Off CoD +1 CP
  at 13:47 (and again 13:50); SLAs back by 14:02. RCA for RBANK and CARDAUTH (same evidence: WLMGL STCHI CPU delay 45.7%,
  DELAY STCHI CPU delay 84.6%, SYSSUM STCHI PI 10.9): player CPU_CAPACITY/HARDWARE_FAULT for both; truth RBANK
  CPU_PRIORITY/HARDWARE_FAULT, CARDAUTH CPU_PRIORITY/POLICY. Partial credit; the player calls it a gotcha (lost engines,
  yet CPU_CAPACITY isn't valid, and one cause gets two triggers), and finds "buy CoD to survive a power cap" odd.
- D13 13:33 **Unapproved model training on TSO:** seen only because the Operations Log printed "EVENT start"; no inbox mail.
  Stopped at once from Operations. The log gives a subtle event away.
- TFP offer: signed without enough data; a real decision needs $/MSU under R4HA and TFP and a cost estimate from history
  (a what-if tool might cover it).

Builds: D1–D4 on `2253b11`, D5 onward on `d8ada51`. Investigation facts in docs/research.md. Findings by category, open items first:

#### Sim and game-logic bugs

- [x] **zIIP purchase with nowhere to go (bug + design gap).** FIXED: every Prod LPAR in all scenarios starts with ≥1 reserved CP and ≥1 reserved zIIP (Midwest PROD2: 0 online + 1 reserved zIIP, so SET_LOGICAL/F7 fix works in the UI); `SET_LOGICAL` refuses a pool the LPAR lacks; ADD_ZIIP shows a warning when no z/OS LPAR on the CPC has a reserved zIIP. Goldens regenerated (config change). Original note: Midwest PROD1 has 2 logical zIIPs and 0 reserved, PROD2 no zIIP
  pool; ADD_ZIIP has no headroom check. The UI (`validateLogical`) forbids a PROD2 zIIP while the sim's `SET_LOGICAL`
  creates one (bots and the Story starting fix rely on it), so SPEC F7 can't be fixed in the browser. Fix: PROD2 0 online
  + 1 reserved zIIP (also makes its IIPCP reporting legitimate), `SET_LOGICAL` enforces reserved, warn on ADD_ZIIP.
- [ ] **CPU Critical freezes WLM when the protection is already broken (sim bug, high).** `violatesCpuCritical` in
  `src/sim/wlm/adjust.ts` tests the whole trial DP set, so when the current DPs already break protection every trial
  fails and the LPAR logs "no action with net value" for everything. Player's BASEPO10 (D20 06:00: STCHI, STCMED and
  every transaction class CPU Critical): ONLRBANK (CPU Critical, imp 2) rested at F4 below BATCHHI/BATCHPRD (imp 3/5,
  F9–FB); ONLCARD (CPU Critical) FA below BATCHPRD FB (RMF intervals ending D20 21:00). D20 21:15 "PROD1 ONLCARD#1
  PI=4.00 no action with net value"; the first move after BASEPO12 (21:18) is ONLCARD FA→FC, one of the few trials that
  clears the conflict. Real: less important work never gets an equal or higher DP than CPU-protected work (WLM Planning
  p.120); WLM enforces it, it doesn't stop managing. Also find how batch periods reach those DPs (DP held from before
  the period had work?). Still possible under BASEPO12: PROD2 ONLCARD (CPU Critical) FB = BATCHHI FB, D20 22:00–23:00.
- [ ] **Two-receiver budget starves the CICS transaction classes (sim bug / APPROX).** `adjust.ts:160` assesses at most
  two fixable receivers per interval. D19 22:00–22:27 both slots went to importance 1: STCMED (sysplex PI 1.9–2.5, all
  of it from DEVT's Db2 at PI 21.19 and 97 % CPU delay under DEVT's cap; PI 0.40–0.49 on PROD1/PROD2, so no move had
  net value) and STCHI (CICS region class: raising its DP FA→FC does not move TRANSACTION-managed regions, which run at
  the served classes' DP). ONLCARD and ONLRBANK sat at PI 4.0 with the regions at FA (PROD1) and FB level with BATCHHI
  (PROD2, BATCHHI raised F9→FB at 22:00) until ONLPAYMQ got a slot at 22:30 (F4→FC/FB; STCHI PROD2 PI 4.1 → 1.3). Real:
  if no receiver is selected WLM goes on at the next importance (SG24-7621 p.105); a per-interval limit is not
  verified. Option: stop counting a receiver whose projection found nothing against the budget, or cap by time.
- [ ] **Db2 batch starts on an LPAR without Db2 (sim bug, high).** `startJobs` (`src/sim/subsys/batch.ts:153`) puts a
  job without SYSAFF on any LPAR with a free initiator for its class and never checks `usesDb2`. With class A
  initiators on SYSP (no Db2), RPT, DWH, GLF and STM would run there faster than on PROD (`depStretch` reads SYSP's
  Db2 roles, none, so 1; `lockStretch` reads SYSP's online Db2 rate, 0, so 1; `src/sim/core/tick/dispatch.ts:135–162`).
  Real: the batch attachments (CAF, RRSAF, TSO attach) connect only to a Db2 subsystem on the same image; with none,
  the job fails at connect (-923 or an attach error; not verified against the books). Fix: such a job starts and
  fails at connect with a JES/SMF 30 clue and needs a rerun (symptom + clue + fix), rather than a silent refusal.
- [ ] **Db2 work on an LPAR without Db2 isn't billed to Db2 (sim bug).** Same case: the job's CPU lands only on the
  products licensed on SYSP (z/OS), dodging Db2, CICS and MQ under TFP. Mostly moot once the job fails at connect;
  check that nothing else can run Db2 work on an image outside the Db2 product's LPAR list.
- [x] **A repeat XLOG_LOOP burns no CPU (bug, fixed).** Expiry and cancellation now remove CICSXLOG from PROD1
  instead of leaving a zero-CPU address space. Each start clears the old zero modifier and replaces any duplicate
  extra address spaces with the same jobname and LPAR, so older saves recover on the next occurrence. The Revenue
  adaptation inherits the fix; no other card adds temporary address spaces. Regression tests cover first expiry,
  repeated CPU load, live cancellation, old-save cleanup and LPAR-scoped removal. Cancellation ends a started task
  (z/OS 3.1 MVS System Commands, PDF p.188; immediate cleanup remains an approximation).
- [x] **WLM projection inconsistent between adjacent intervals (sim bug, fixed).** With the same DPs, BATCHPRD#1's
  (importance 4) self-raise F2→F4 was projected at D5 22:22:50 to take ONLCARD's PI from 0.80 to 61.8 (rejected), and at
  22:23:00 to leave it at 0.80 (accepted). Batch then ties the CICS regions' DP on PROD2's 4 CPs; ONLCARD lowers it,
  BATCHHI (sysplex PI ≈0.8, taken as receiver on its local PI) lowers it again, and BATCHPRD raises itself back: a
  ~2.5-minute cycle in the WLM log, D4 23:00–23:22 (save) and again D5 22:20–22:36 (replay). BATCHHI also went F3→F5,
  above the importance-2 CICS classes, at D5 22:36:50. Find out why the projection base drops the CICS contention on
  some intervals. Cause: starvation cross-paced both CPU demands down on an image without zIIPs. CP-only images now
  retain ready demand; a blanket importance-based DP ceiling would be too strict without CPU Critical. Receiver
  candidates now follow global/local order within each importance tier (SG24-7621 pp.106–107). Separate-pool trials
  now follow a conservative envelope of demand already enabled by this tick's grants or restored by projected
  CPU grants, using execution's pacing
  formula. Every intermediate distribution must pass net value; unsettled trials are rejected at a bounded
  iteration limit. This remains an approximation, with I/O rates/backlogs and capacities held at the snapshot.
  Regressions cover recovery in either direction, CP help enabled/disabled, CP caps with spare zIIPs, a safe raise
  with headroom, and exhausted projection budgets. Save-inspired no-zIIP and receiver-order tests remain.
  Production replay from the uploaded save, D5 22:00–23:00: CARDAUTH 98.585% → 99.933% within SLA,
  failures 3,512 → 0 and BATCHPRD self-raises 8 → 0; all 40 critical jobs finish, 70 seconds later at 01:56:10.
  Validation: `npm run check` 553 tests passed; Midwest Normal CI sweep seeds 1–5 passed all bands (do-nothing
  median day 16, textbook 27, expert 40 with 5/5 victories). Golden hashes changed with the intended model behavior.
  Separate-pool follow-up: `npm run check` 573 tests passed (10 coupled-projection regressions); the final
  seed 1–5 sweep passes the same bands and 5/5 expert victories. Replaying the uploaded save through the final
  code preserves 99.933% attainment, zero card failures/self-raises, and all critical jobs on time. Isolated
  bench 3.27 s/day (0.38 ms/tick), versus 3.20 s/day before the extension; day-1 hash and existing goldens unchanged.
- [x] **A planned fix makes its event permanent (bug, high).** Fixed 2026-11-03: `startDay` now keeps one command
  queue, including the restoration commands appended by each successful event fix. Previously its final assignment
  discarded those commands after marking the event ended, leaving its modifiers permanent and skipping natural expiry.
  A duplicate planned fix is refused at no cost; a fix with no active event is charged and logs "no active event
  matched this fix" when it runs (a free refusal would let the Change Desk probe for hidden events; PR review). Regression tests
  cover all 37 fix cards in all three scenarios (planned and live), job restarts, project completion and
  temporary-change reversion together, command ordering, natural expiry, failed fixes and no-match requests.
  Old saves are not repaired (user request). Goldens and the default no-action scenario comparisons are unchanged.
- [x] **Resource-group cap creates phantom LPAR busy and MSU (sim bug, high).** Fixed 2026-11-03: PR/SM
  planning and dispatch share `dispatchableDemand`, including backlog and discretionary caps. Resource-group
  sleeping slices gate both normal and zIIP-eligible work; without online zIIPs both count toward the CP maximum.
  Type 1 budgets include backlog-only members across images; type 2 uses the current configuration's entitlement.
  Busy/MSU consumption uses dispatched CPU rather than unused PR/SM offers, including the batch initiator's
  previous-tick busy input. Overflow is reserved across the CPC before execution; actual dispatch and WLM
  priority trials share the reserved grants; queueing still uses available service capacity, so an idle CPC
  is not falsely saturated and counterfactual per-image availability cannot overcommit execution.
  Withheld work keeps its CP/zIIP pool in the backlog. IBM: WLM Planning 3.1 p.60 notes
  4–5, RMF Report Analysis 3.1 p.389 and p.98 (ledger and SPEC updated). APPROX: continuous awake fractions;
  1/256 granularity and recovery boost not modelled. Regressions cover all three maximum types on PROD2,
  eligible CP overflow, backlog-only caps, pool accounting and discretionary planning. Goldens regenerated
  because actual dispatch changes recorded CPU/MSU and subsequent game decisions. Targeted cap, physical-pool,
  batch-projection and WLM tests pass; the PR records full-suite, benchmark and bot regression evidence.
  The Monitor III CPU regression compares independent control/stressed runs at the same simulated time,
  checking CP-specific delay, processor-delayed users, PI, velocity and the affected WFEX result.
- [x] **Two policy installs in one briefing: the second drops the first (bug).** Fixed 2026-11-04:
  browser and CLI edits build on the latest planned activation due at today's 06:00, retaining earlier installs'
  goals, classification and resource groups. The briefing editor shows "Planned for 06:00: X" and its settings;
  JSON, classification previews and saving a named policy use that same base. The active policy stays unchanged
  until day start. Regression coverage includes two installs across a save/reload, cancellation and ignoring
  failed/applied/future-day changes. Validation: 67 files / 643 tests and production build pass; browser
  two-install/day-start check passes with no page errors; default three-scenario comparison has no differences.
  Follow-up from #178 review (2026-11-04): after Start day, briefing activations wait in the live command
  queue until the first tick. Edits and previews now retain that queue's latest activation, including successive
  live installs while paused; the editor labels it "Queued for next tick". Regression covers save/reload in
  that gap, two live installs and all earlier goals surviving execution. Validation: 67 files / 646 tests,
  typecheck, production build and paused-browser check pass; default three-scenario comparison has no
  differences. Restoration follow-up (2026-11-04): a failed earlier install is no longer returned as pending
  over a later successful activation that day. Cancelling an earlier install likewise keeps the later planned
  definition without restoring stale edits, and explains that copied edits remain in the later policy.
  Latest failed/cancelled installs still return their edits; future-day installs and non-policy changes do not
  suppress restoration. Regression replays cover both paths and verify the later edits survive further installs.
  Validation: 67 files / 650 tests, typecheck, production build and both browser replays pass; default
  three-scenario comparison has no differences and goldens are unchanged.

#### Incident truth, RCA and evidence

- [ ] **RCA evidence mark to check:** the PROCU pin "BATCHHI#1 APPL 442%" (D4 23:04) was marked "not about CARDAUTH",
  though batch at the CICS regions' DP on PROD2 was the CPU competitor. Check whether the evidence matcher should accept
  the competing class's CPU for CPU_PRIORITY.
- [ ] **Power-cap RCA is a gotcha (content/design gap).** INC52 RBANK: filed CPU_CAPACITY/HARDWARE_FAULT, truth
  CPU_PRIORITY/HARDWARE_FAULT (2 points); INC53 CARDAUTH: truth CPU_PRIORITY/POLICY (5 points). CPU_CAPACITY needs CPC
  ≥ 90 % (or LPAR ≥ 95 %) and < 10 % of CP to less important work (`src/game/sla.ts`; thresholds hard-coded, not in
  content/); CPCA was 70.9–82 % physical, so priority. The card lowers the capacity setting by one (slower CPs, same
  count); its affected workloads are only MOBILE and RBANK, so CARDAUTH falls back to POLICY although the drop is CPC-wide.
  The rule appears in no Codex entry or RCA form tooltip. Fix: affected workloads of capacity-drop cards = everything on
  the throttled CPC; Codex "RCA vocabulary" + form tooltips; explain after scoring ("CPC 81 % busy, below the 90 %
  capacity line"); show a capacity-adjustment clue (SMF70CAI/CCR, MVS SMF p.589) in CPC/Partition Data. CoD helps only a
  little; the card's cheaper fixes are capping DEVT, deferring discretionary work and protecting importance 1.
- [ ] **RCA evidence: the work ahead in the queue doesn't count (design gap).** PROCU "BATCHHI#1 APPL 662%" (D19 22:30)
  scored 0 ("not about RBANK"): APPL counts only for CPU_CAPACITY (`src/content/evidence.ts`) and only on the victim's
  own classes (`judgeEvidence`). The inbox hint asks "Who was ahead of it in the queue?"; a lower-importance class at an
  equal or higher DP with high APPL should count for CPU_PRIORITY. Same class of report as the D4 item above.
- [x] **RCA verdict text for grouped incidents (UI bug).** Completion takes effect on merge: grouped evidence keeps
  the highest relevance per pin, then prefers the verdict that passed more evidence checks; exact ties keep the first
  incident. A CARDAUTH pin on the RBANK group now shows its own symptom, size or cause rejection instead of "not about
  RBANK" when every incident scores 0. Regression tests cover zero-score reasons, window/subject precedence, stable
  ties and group-wide scoring/rewards; no simulation or evidence-scoring rules change.
- [x] **Incident truth only sees cards still running at hour end (bug, high).** Completion takes effect on merge:
  `triggerOf` uses retained card start/end ticks to match any activity during the opening SLA hour, including cards
  ended by expiry or remediation before hour close. This preserves RETRY_STORM → DEMAND_SURGE after MOBILE_BACKOFF
  instead of falling back to POLICY (INC157 MOBILE, D33). Half-open window guards exclude cards ending at the hour's
  start or starting at its end; workload/mechanism matching, fallbacks and player-visible data stay unchanged.
  Regressions cover 13:15 and hour-boundary fixes, expiry on the last tick, full RCA points and non-overlapping cards.
- [x] **New workloads stay "NEW_WORKLOAD" forever (bug).** Completion takes effect on merge:
  NEW_WORKLOAD expires two simulated days after go-live, including persistent go-live cards. Existing event history
  and scripted-beat dates recover the start without new save fields; unknown origins fall back to the current cause.
  Regression coverage checks new work, expiry boundaries, saved runs and unaffected event/policy/growth/lock triggers.
- [x] **POWER_CAP only blames MOBILE and RBANK (bug).** Completion takes effect on merge:
  the card resolves `affects` at start from the tick's effective routing, including pending changes and added
  workloads, to every CPC whose capacity it reduces. Workloads solely on a CPC already at the minimum setting
  are excluded; the existing site-wide capacity drop and restoration stay unchanged. Regressions cover all three
  scenarios, ACQBANK, retained expiry attribution, routing overrides (including pending changes when the cap starts)
  and the unaffected-CPC boundary. The shared card (including Revenue/Harbourline adaptations) only matches
  CPU_CAPACITY, CPU_PRIORITY, CAPPING and DEPENDENCY; I/O, lock, CF and storage incidents cannot be blamed on
  this cap. Regressions cover the mechanism filter and an I/O incident during the cap in all three scenarios.
  Known limitation: `affects` is a start-time snapshot, retained for expired-card attribution. Routing changes
  and workloads added after the cap starts do not refresh its RCA scope; mid-cap moves can leave stale attribution
  or miss newly exposed workloads. This follow-up remains outside this fix.
- [x] **zIIP delay pins are judged against the wrong mechanism (bug).** Completion takes effect on merge:
  `DELAY_ZIIP` supports CPU_PRIORITY as well as CPU_CAPACITY, matching the existing `mechanismOf` CPU split;
  INC157-style zIIP pins now count toward the RCA's evidence award. Subject, time-window and notability guards
  remain in place. Regressions cover two-pin scoring and strong-evidence Insight, wrong answers, unrelated
  subjects/mechanisms, low values, both window edges, and zIIP queue growth producing either CPU mechanism.
- [x] **Pins on a CICS region don't count for its workload (bug / UX).** Completion takes effect on merge:
  SYSWKM server jobnames map to CICS workloads through the existing AOR address spaces and positive routing shares,
  including added regions. Matching requires the server's system; unrelated names, systems and non-CICS workloads
  remain excluded. Velocity still scores zero as a symptom, with that verdict instead of "not about CARDAUTH"
  (INC133). Regressions cover shared workloads, added regions, routing, saved pins and the incident window;
  no evidence weights, save fields or simulation mechanics change.
- [ ] **CICS SOS is labelled POLICY / THREAD_LIMIT (design gap).** The card has trigger POLICY and mechanism
  THREAD_LIMIT; the player's STORAGE (INC168) is the better answer for a storage leak. Give the card a storage or
  software-defect label, and define each trigger/mechanism in the RCA form (the player asked what "policy" means).

#### Clue paths and realism

- [ ] **Clue path for "why didn't WLM raise CICS".** The player read the WLM log correctly but couldn't see why there
  was no receiver raise. Consider logging the best rejected trial and why ("ONLCARD F4→F6 rejected: harms DDFMOB, equal
  importance"), and showing on WLMGL/SYSWKM that a region class managed to transaction goals runs at the served classes'
  DP (its own PI is reported, not managed to).
- [ ] **IIPCP on an image without zIIPs (realism).** With PROJECTCPU=NO (default) and no zIIP configured, real RMF reports
  no IIPCP (Init & Tuning p.434); the sim always does. Moot if PROD2 gets a reserved zIIP.
- [ ] **Open question: a region class whose regions are transaction servers as a receiver.** In the sim STCHI's PI includes
  the CICS AORs' samples and WLM spends a receiver slot on it, but its DP doesn't reach the regions. WLM Planning p.111:
  servers "are managed according to the goals of the served transactions". How real WLM treats the region class's own
  PI is not verified.
- [ ] **No clue path from a sysplex PI to the LPAR behind it (design gap).** The D19–D20 STCMED alerts and "STCMED still
  suffering at 06:00" were DEVT's test Db2 (`TN=DB*` → STCMED, imp 1) under DEVT's cap; Monitor III DELAY named a PROD
  batch job (STM009) as STCMED's primary reason. Realistic (sysplex PI first, SG24-7621 p.105–106), but the UI should
  make the per-system split easy to find (WLMGL per system, a SYSSUM by system).
- [ ] **SOS doesn't move PI or alerts (realism OK, design gap).** Response times are for ended transactions only; a
  delay shows only once the transaction ends (RMF Report Analysis 3.1 p.148, GROUP report), and response-time goals
  need enough completions (SG24-6472 p.190). So PI looking fine while transactions stall is real. The game has no
  alert on what does show it (ended rate drop, SOS time, MXT waits); add one as an Analytics/automation rule.
- [ ] **No CF lock contention % (realism gap).** CFACT shows per lock structure "Contention %" (requests delayed by a
  lock held by someone else) and "False Contention %" (hash) (RMF Report Analysis 3.1 p.85). The sim's lock index
  raises Db2 lock wait but the CF report doesn't show contention, so the player looked at service time (normal, which
  is right) and found nothing. Add contention % from the lock index.
- [x] **Equal-importance veto from bystanders; co-served classes not credited (investigated).**
  At D5 22:21:00 ONLCARD's own raise F4→F6 (which lifts the CICS regions) was projected to take ONLCARD 61.8→0.80,
  ONLRBANK 82→0.5, ONLTELR 46→0.5 and ONLPAYMQ 13.9→0.17, but `passes()` rejected it because DDFMOB (68.7→74.7) and
  TSO#1 (27→29.6), also importance 2, got worse and the "PIs must end closer together" test failed. That test is for
  equal-importance *donors* (SG24-6472 p.60); here it vetoes on bystanders already far past goal, and the gain counts
  only the receiver, not the other transaction classes served by the same regions. WLM fell back to the weaker donor
  move. IBM's WLM Services p.147 describes secondary donors with unchanged DP, and its net-value rules (p.138) apply
  to primary and secondary donors; with IBM's 2002 Intelligent Resource Director paper they support evaluating donor
  harm and equal-importance convergence separately. Co-served improvements are projected, but pooled credit cannot
  override that veto; no change made. The sim's summed donor-harm comparison remains a separate fidelity question;
  co-served credit and equal-importance convergence for secondary donors are under "Open questions".
- [x] **Checked, realistic:** On/Off CoD CPs revert at the start of the revert day and stop billing (D15 save: 9 CPs =
  8 + 1 permanent). Capacity 1845 MSU = 9 × 205 at setting 7; the MP effect is applied as extra CPU per transaction
  (`slices.ts:86`), not to the capacity line, unlike SPEC §6's formula (design note). DB81ADIST PROCU 0.9 % Time on CP vs
  66.2 % EAppl % CP: DDF enclave CPU counts in EAppl only (RMF Report Analysis p.189, cited in `mon3.ts`). BATCHPRD
  "RG-Cap" with no resource groups: discretionary goal management (velocity ≤ 30, PI < 0.71, discretionary work waiting).
  CPU Critical on a region's STC class doesn't protect TRANSACTION-managed regions; set it on the transaction class
  (matches WLM Planning p.100, p.111).

#### Events and operations design

- [ ] **Silent events leak through the Operations Log (design bug).** `src/game/run.ts` logs "EVENT start/end: <name>" for
  every card; mail goes out only with an announcement; `src/game/mon3Charts.ts` turns the lines into named chart
  markers. The TSO model-training card has no announcement. Fix: log only announced cards, in their wording; keep
  silent ones out of the log and chart markers until revealed or the RCA is filed (run log changes → goldens).
- [ ] **A forewarned fix planned ahead is silently wasted (design gap).** D24 (build `d8ada51`): the inbox forewarned a
  stored procedure redeploy; the player planned "Redeploy as native SQL procedures" in the briefing. It applied at 06:00
  (`src/game/run.ts:133–137`), the event card started later that morning, `endEventByFix` found nothing started and
  the fix was spent (2 h) with the event still running. The build gave no warning; dev now logs "no active event
  matched this fix" but still discards it. A fix the player could see coming should either arm against the
  forewarned card (end it when it starts that day) or be refused at planning time with the reason, and the hours
  refunded if it found no target. Same card twice in this run (D11, D24), so the fix also isn't lasting: if the
  redeploy reintroduces COBOL procedures, say so in the card's clue.
- [ ] **LOCK_ESCALATION has no lever (design gap).** `fix: null`; lock wait is `lockWaitSecPerIndex × (sum of running
  jobs' lockIntensity + 6)` for 3 h. Buffer pools, LCUs and compression don't touch it, and running batch can't be
  cancelled. Only fewer concurrent lock-heavy jobs helps. Offer fixes: commit more often in the settlement job, lower
  LOCKMAX escalation (Db2 change), hold the job class.
- [ ] **Retry storm needs a non-log clue (design).** The clue is WLMGL MOBILE END/S ×2.5 at unchanged CPU per
  transaction; the player found it only from the Operations log. Add a codex line on reading END/S against yesterday.
- [ ] **Inbox change notices are always bad news (design).** By D26 the player rolls back any announced change on
  sight (Db2 REBIND, monitoring agent). Add changes that help (better access path, cheaper agent) so impact has to be
  judged.
- [ ] **Operations list spoils events not yet seen (design, high).** Fixes for events that haven't happened in this run
  are offered already (e.g. "Agree a narrower encryption scope" before any encryption mandate). Show an event-specific
  operation only once its event (or its forewarning) has occurred in the playthrough.
- [ ] **General-purpose operations instead of per-event ones (design).** Add operations for common fixes that aren't
  tied to one event, and generalise event-specific ones where possible: e.g. "Recycle CICS AORs" (choose regions)
  rather than "Recycle the PROD2 CICS AORs: restart CICSAOR2 and CICSAOR4 one at a time…". Each event must register
  a general operation that fixes it (e.g. CICS_SOS ends when its leaking regions are recycled), so `endEventByFix`
  matches on effect, not on a card-specific fix id.

#### Levers, economy and pacing

- [ ] **Activate a saved policy (design gap):** saved policies can only be scheduled; real `V WLM,POLICY=` exists. Add
  "Activate now" (an ordinary activation; emergency when live) and "Load into editor".
- [ ] **Hardware and On/Off CoD (design gap).** Every live change is an emergency (−1.5 trust per stakeholder, fail roll),
  including lead-time items (CP/zIIP/ICF, 4 days) that arrive later anyway; no "plan for tomorrow" while live. CoD: $9k/day
  for 3 days per order (player's two D12 orders ≈ $54k + 2× emergency trust), no early end. Fix: plan-for-tomorrow during
  the live day without trust cost, or exempt lead-time items; "Deactivate CoD" from the next day (real early deactivation
  not verified).
- [x] **MLC vs opex budget (UI gap).** Completion takes effect on merge: the header, Finance card and
  headless `status`/`finance` commands share the combined software estimate + CoD accrued total, budget and
  signed percentage difference. Finance breaks down the components and explains Finance trust penalties
  (up to 40 points); strictly over 25% at monthly billing ends the run. $819k vs $780k reads +5.0%.
  First-review follow-up restores the peak-R4HA clue, uses generic software labels for TFP, flags the
  unrounded over-limit comparison (including 25.04%), and keeps the header to three lines. Billing help
  documents the existing 00:00 software reset / 06:00 CoD settlement window and closing-month nightly fee.
  Billing rules, estimate timing and the held finance-feedback proposal are unchanged. Boundary/CLI tests
  cover the shared reporting helper; production build, project checks, browser fixtures and default
  three-scenario behaviour comparison validate the change. Run-specific evidence is in the PR.
- [ ] **TFP offer lacks the numbers (design gap).** Shows baseline $/month, sub-capacity bill at the peak and overage %;
  the per-product terms are stripped from the view and nothing projects TFP vs sub-capacity from history. Fix: per-product
  table (peak MSU and $/MSU, baseline MSU-hours and $/MSU-hour, MSU-hours used) and a run-rate projection.
- [ ] **Starving "Internal" work is free (design gap: a lever with no cost).** TSO and ADHOC have stakeholder `Internal` and
  SLA `NONE` (no incidents, trust or score; `src/game/run.ts`, `src/game/sla.ts`); DEV batch is non-critical with
  `lockIntensity` 0, so a capped or discretionary job holds no locks and its lateness counts nowhere. The only cost today
  is the RG phantom-busy bug. Real costs to consider: developer/BI complaints (an Internal trust facet or an inbox
  escalation when TSO/ADHOC response degrades), capped work holding Db2 locks or ENQs (lock-holder starvation, WLM
  enqueue promotion), and sysprog TSO on the production images during an incident.
- [ ] **Pacing (player).** D17: running out of things to spend engineer-hours on; add projects. D19: system well tuned,
  little to do; CP sparing and the degraded CF link needed no action. Consider dynamic difficulty.
- [ ] **One job class for every stream (design gap).** All Midwest production streams are class A, so the honest move
  (non-Db2 BKP and HSK on SYSP, cheaper under TFP) can't be made without also sending Db2 streams there. Player
  proposal, simpler than modelling SCHENV: finer job classes (e.g. Db2 production, non-Db2 utilities, reports), each
  with initiators per LPAR; reclassing a stream is a change desk JCL change with lead time and a small failure risk.
  Information in tiers: SMF 30 shows class and program (IKJEFT01 with a DSN command, or DSNTEP2, shows Db2 use); ask
  in inbox answers per stream (count, class, Db2, SYSAFF), not one job; the batch analysis unlock shows the network
  (streams, class, Db2 use, SYSAFF, predecessors, critical path and slack). SCHENV can come later.
- [ ] **Late-game engineer hours (design).** The player found "ask if anything could hit the system" the only good
  use of hours late on (and liked it). Give hours more late-game sinks.
- [ ] **Grade S (100) felt generous (balance, check).** The player doubted it; check the grade's inputs and caps.

#### UI and reports

- [ ] **SMF 101 "vs base" moves retroactively (design gap).** `src/game/smf.ts` divides past hours by today's baseline, an
  EWMA (0.8/h) learned from every SLA-met hour, so a regression is absorbed in ~3 h: at the D7 briefing the D6 08:00 row
  read 1.00 instead of ≈2.8. Fix: freeze each hour's ratio when it closes; learn the baseline only from hours without an
  active event of that mechanism, or a slow decay / same-hour-last-week reference. The Db2-team mail is the
  DB2_WHISPERER perk tip, sent at event start (not pin-driven); tag it "(Db2 Whisperer)".
- [ ] **Monitor III CPC and charts.** CPC has CP rows only (real: per-type groups with *CP/*ICF/*IIP and PHYSICAL lines,
  RMF Report Analysis p.97–98). "CP busy per system" plots % of logical CPs per LPAR and % of physical for the CPC line:
  relabel, add a "% of CPC" toggle. A CPU-by-service-class chart is feasible (per-class engines already sampled), with a
  chart toggle.
- [ ] **CPC busy forecast:** 10-day log-linear fit of daily peak busy as % of installed CPs; weekends (47 %, 34 %) and capacity
  added pull it down. Fit weekdays (or a weekday term) and forecast MSU demand against capacity; mark capacity changes.
- [ ] **Resource group units:** SU/s only. 1 MSU = 277.8 SU/s; SU/s per CP in `src/sim/hw/cpc.ts`. Show "≈ N MSU ≈ M CPs" in
  the editor and the Codex entry.
- [ ] **Codex:** no SMF 101 or SMF 110 entry (only a mention in the SMF-volume entry); add both, linked from the SMF tab.
- [x] **Layout:** (done 2026-11-06: now `PhaseActions` in the header) Start day / Briefing sit in a fixed bottom-right box shared with result toasts (they can overlap); the
  header's speed-button slot is empty during the briefing, so move them there.
- [x] **Automation misfire wording** (fixed 2026-11-04). "8 % misfire" is a failed action (the rule fires, the change doesn't happen, logged
  MISFIRE), not a false trigger; say so in the Automation panel.
- [x] **Change desk "catches" column ignores `SY=` rules (UI bug).** Completion takes effect on merge:
  address-space previews now carry `SY: lparId` and retain one item per (jobname, system). Shared jobnames collapse
  to one catch when every system reaches the same rule, default or forced-SYSTEM list; split destinations retain
  system labels, including distinct rule paths that assign the same class. Top-level and nested `SY=DEVT` rules
  therefore show the same address-space classification as the sim, with forced SYSTEM and default paths retained.
  Regression tests cover duplicate definitions, shared names, compact BASEPOL rows/forced lists and consistent
  SYSOTHER summaries. Validation: typecheck and all 74 files / 739 tests pass (single test worker); production
  build passes; the three-scenario comparison against `origin/dev` finds no
  sim/game state, run-log, RMF or Monitor III differences. STC system-name semantics verified in z/OS 3.1
  [MVS Planning: Workload Management, p.92](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=92).
- [x] **No way to add the first rule for a subsystem with no rules (UI bug, high).** Completion takes effect
  on merge: classification previews always include every supported subsystem, even without a policy entry or
  current work. Empty panels show their built-in default (STC → SYSSTC, others → SYSOTHER) or explicit default
  and expose the existing Add rule form. An OMVS userid rule can therefore be prepared before ACQSVC arrives,
  through the acquisition hint's Change Desk path. Classification mechanics and policy activation are unchanged.
  Regression coverage checks empty panels/defaults and adding the first rule before work arrives; browser
  validation exercises the editor and pending/activation flow. Run-specific validation evidence is in the PR.
- [x] **Capacity planner says "deadline 06:00" after DEADLINE_0500 (UI bug)** (fixed 2026-11-04, label from `instanceClock`). The line uses `batchDeadlineSec`, but
  the label is hard-coded (`src/game/planner.ts:74`).
- [ ] **HMC: show physical engines per type (UI).** Totals are only implied by the logical:physical ratio.
- [x] **⇩ export does nothing in the published artifact:** text transfer added 2026-11-04. Export opens a
  dialog with "Copy save to clipboard", a selectable save-text field for manual copying when clipboard access
  is blocked, and an explicit file download. Import accepts pasted save text as well as files, using the existing
  backtick-tolerant decoder. Failed imports keep their text and report an error; replacing the current run/save
  requires confirmation. No serialization or save-format changes. Validation: 67 files / 650 tests,
  typecheck and production build pass; browser copy/fallback, file and backtick-paste round-trips, invalid
  import and mobile checks pass. A download-blocked iframe with no clipboard still exposes selectable save
  text. Default three-scenario comparison has no differences; the artifact has not been republished.
  Dialog lifecycle follow-up from #181 review (2026-11-04): closed save dialogs no longer match `.modal`,
  restoring the documented screenshot flow. Native close events now reset the dialog state so Export and Import
  can reopen; delayed close events are ignored after reopening. Save transfer and its format are unchanged.
  Validation: 67 files / 650 tests and production build pass; native-close/reopen, Escape/focus and delayed-event
  browser checks pass. The unchanged screenshot tool completes with no errors or mobile overflow; default
  three-scenario comparison has no differences.
- [x] **Unplayable UI on `8c0dd9e`** (#160): the player's run stopped being playable there. The player confirmed it was
  the worker request loops, fixed in #164.
- [x] **`confirm()` is blocked in the published artifact:** replaced 2026-11-04 with a shared in-app
  confirmation dialog for save imports, the guarded new-run start and restarting with planned changes. It works
  without sandbox `allow-modals`; Cancel/Escape leave the run and pending work intact, and explicit confirmation
  performs the requested action. Import errors still retain the pasted/file text. The dialog traps focus,
  defaults to Cancel and restores focus on close. No worker, save-format or simulation changes. Validation:
  67 files / 650 tests, typecheck and production build pass; sandbox browser checks cover paste/file imports,
  invalid input, Cancel/Escape, planned-change restart and the older-save start guard, with zero browser
  `confirm()` calls or page errors. Default three-scenario comparison has no differences; no artifact republish.

#### Saves, export and tooling

- [ ] **Imported saves lack Monitor III history:** `mon3 --at` on an imported save shows nothing for past
  ranges (replay forward instead, or include the history).
- [ ] **Export:** besides downloads being blocked, copying the save string from dev tools corrupted 12 escaped quotes in
  inbox text (`\\"`), so the D15 save needed repair before it parsed; another reason for an in-artifact export.
- [ ] **Exported saves arrive with every backslash doubled (open question).** The player's D20 export
  (`goal-mode-midwest-467203-day20.json`) was invalid JSON: all 20 escaped quotes (inbox bodies quoting the change
  board) were `\\"`. Halving every backslash gives byte-for-byte what `encodeRunJson` writes, so the game's
  `JSON.stringify` is fine and something on the artifact's download path doubled them (not verified). Import (browser
  and play CLI) now repairs it, and also text pasted inside backticks (the D4 save). If it recurs, look at how the
  artifact host saves a Blob download.
- [ ] **Playtest companion skill and investigator subagent (proposal).** A `playtest-companion` skill holding the
  standing rules and setup, and an optional `playtest-investigator` subagent for deep code dives that returns
  only the finding in the report format and filters spoilers in its own context. Not built yet.
- [x] **Playtest agents updated from this round:** new `wlmlog [system] [--grep]` play verb (the Monitor's WLM activity
  log); player briefs now pin evidence, compare `*PLEX` with per-system rows, snapshot the run at incident onset and log
  the human incident checklist and pacing; new `goal-mode-firefighter` persona (emergency WLM edits, watches WLM's
  response); realism-auditor ideas from this round. Still to do: the lab harness should log which test rejected each
  WLM trial (needed to diagnose "no action with net value" without patching `adjust.ts`).
- [x] **Play CLI for playtest investigations:** `finance` (bill; under TFP, MSU-hours vs the prorated baseline,
  projection and overage $ per MSU-hour by LPAR), `capacity` (CPC MSU, LPARs, initiators, capacity changes by day),
  `batch` (last night by stream); `npm run inspect -- <file> dp <system>` for the DPs per RMF interval (sim internals,
  never for player agents). These replace the one-off scripts used for the D10–D20 questions.

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
- [x] **Revenue retune after the sampling fix** (2026-11-03): do-nothing survived to day 23 (above the 8–22 band).
  G1's pressure restored through content: compliance analytics queries (WEBDDF, with e-filing) peak 0.3 → 0.6/s and
  grow 2 %/day (was 0.5 %). Local sweep, Revenue Normal: do-nothing seeds 1–8 median day 19 (p10 16, p90 21, all
  trust losses); textbook seeds 1–10 median 27; expert 10/10 victories. Goldens unchanged (no Revenue golden).
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
  Sweep (3 bots × 20 seeds, base dev vs head): balance-neutral. Mean days survived and score unchanged within ±0.1 d
  and ±0.6 %, e.g. midwest textbook 24.3→24.4 d, revenue textbook 28.5→28.6 d; expert still 20/20 on both. Runs
  drawing CICS_SOS are likewise unchanged. Speed: bench 0.83 vs 0.85 ms/tick (midwest), 0.79 vs 0.82 (revenue),
  within noise; sweep wall time head +1–3 % with base and head sharing one machine.

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

### PR review follow-ups (open items from the hourly reviews of #178–#185, 2026-11-04)

Non-blocking findings the reviewer left open; each was still present on `dev` at 7fbeffa. Items fixed by a later PR
(06:00 queued-install gap → #179, restored-policy edit loss → #180, screenshot timeout and native dialog close → #183)
are not listed.

WLM policy editing (game/worker/CLI):
- [ ] **Scheduled activation overrides a queued install** (#179 review): `advance` pushes the policy-schedule
  activation after `pendingCommands` in the same tick (`src/game/run.ts` `scheduledActivation`), so if the game is
  paused on an hour with a schedule entry (06:00 at day start included) the scheduled policy replaces the player's
  queued install while the editor still says "Queued for next tick: X". Show the scheduled entry in `plannedPolicy`,
  or apply the schedule before player commands.
- [x] **Cancel message missing separator** (#180, fixed 2026-11-04): `src/game/run/changes.ts` cancel message appends
  "Later policy … keeps its current edits" with no `. ` before it ("(1.5h back) Later policy …").
- [ ] **Cancel B then A leaves A's edit pending silently** (#180): A's edit stays in the pending policy and A's cancel
  message doesn't say so (also true before #180; the edits are uninstalled and visible).
- [ ] **Suppressed failure is silent** (#180): when a later install succeeds after an earlier one failed at day start,
  the play CLI day-start text and the mail don't say that the earlier install's edits went live through the later one.
- [ ] **Planned-policy labels** (#178): CLASSIFY flags the planned policy only as `pending` (`src/worker/game.worker.ts`
  CLASSIFIED); the play CLI `status` and `policy` output don't show the planned (queued/briefing) policy at all.

Save transfer dialog (`src/ui/RunFiles.tsx`, UI only):
- [ ] **Import result read from toast wording** (#181): the dialog matches `Loaded run:` / `Import failed:` toast text;
  give the worker an explicit import-result message instead. Since #185, `submittedToast.current = toast`
  (RunFiles.tsx, after the confirmation wait) stores the toast from before the prompt opened; harmless only because
  results are matched by prefix. The explicit message fixes both.
- [ ] **Closing during an in-flight import still replaces the run** (#181; the player already confirmed).
- [ ] **`.modal { position: relative }`** (`src/ui/styles.css`, #181): the open modal dialog computes to
  position absolute and scrolls with the page instead of staying fixed.
- [ ] **One unstyled frame on programmatic close** (#183): the `modal` class drops when state resets but `el.close()`
  runs in a passive `useEffect`; `useLayoutEffect` would avoid the frame. `close()` also runs twice on cancel (harmless).
- [ ] **No automated test for the dialog lifecycle** (#181/#183/#185 were verified manually with Playwright); now
  also covers the in-app confirmation (`src/ui/Confirmation.tsx`, #185).
- [ ] **Confirmation polish** (#185): during a file import the button still reads "Reading file…" while the prompt is
  open; the confirm button has no primary/danger styling.

## Active decisions and conventions

- Realism checks (user request 2026-11-05): work and reviews touching z/OS behaviour or report content use the
  `zos-docs` skill and cite book + page (CLAUDE.md "Realism policy"; `pr-reviewer`/`realism-fixer` have the Skill tool;
  PR template has a "Realism check" section).
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

- Hourly PR review (user request 2026-11-04): a scheduled task starts a fresh session each hour that runs
  `.claude/skills/pr-review-loop/`. First pass merges only a PR with no findings at all; a held PR merges once a
  follow-up review shows every earlier finding fixed and nothing new blocking; second-pass non-blocking leftovers
  go to "PR review follow-ups" above. State is the hidden `pr-review-loop` marker in each review comment.
  A follow-up whose earlier findings were all non-blocking is reviewed on Sonnet instead of Opus (user request
  2026-11-05).

- Manage Region Using Goals Of is fixed at TRANSACTION for the player (user decision 2026-11-05): the sim keeps
  REGION/BOTH (lab, tests); the Rules view drops the column and `playerWlmEditError` refuses `SET_RULE_REGION_MODE`
  in the worker and play CLI. All three scenarios start at TRANSACTION (`tests/game/scenarioRegionMode.test.ts`).

## Branch workflow

- **Playtest fix loop (user request 2026-11-04):** one iteration per hour: one new discrete playtest fix or
  one follow-up for its existing PR (review feedback, CI or conflicts). Pick simple/high-priority findings first,
  then simple/low, complex/high, complex/low; explicit design holds still apply. Keep at most one open
  `playtest-fix/` PR into `dev`. Another session reviews and squash-merges: this loop must not merge or enable
  auto-merge. While awaiting review without actionable feedback, wait for the next iteration. After merge,
  start a fresh branch from fetched `origin/dev`; never build on the pre-squash branch. Rebase only unmerged
  fixes when `dev` advances, reverify, and push with `--force-with-lease`. Preserve other sessions' worktrees.

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

- WLM net value with server topology (playtest round 2, #170): does a move that lifts CICS regions credit the other
  transaction classes those regions serve (secondary receivers, WLM Services p.137, trace code PA_PRO_UNC_SEC_REC
  p.708)? Net value is described as donor harm vs "projected improvement to the receiver" (p.138), and SG24-6472
  p.63/p.81 call the co-served gain a "free ride" side effect, without saying whether it counts. Also unverified:
  whether the equal-importance convergence rule (SG24-6472 p.60, stated for "the receiver and the donor") applies to
  secondary donors. The sim credits only the receiver and applies convergence to every equal-importance period.
- CICS_SOS (2026-11-03): EDSALIM raised to the max before the card is cheap insurance; should a large EDSALIM carry a cost (real storage, or a later abend when a leak finally exhausts it)?
- Period switching sums CP and zIIP seconds × SU/s without normalising zIIP time to CP speed (APPROX).
- Resource group minimum for discretionary members: what counts as "missing goals" for DISC work? Still delay > using
  (`missingGoal` in `src/sim/core/tick/helpers.ts`, APPROX); item 11 settled only that it yields to goal work.
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
- Dispatch approximations: partially hosted resource-group slices can over-restrict outside-group zIIP overflow;
  conversion from effective execution to physical busy/MSU retains the full grant's efficiency (SPEC §17).
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

- [x] **Split `src/sim/core/step.ts`** (1,458 → 270 lines): `step()` stays the SPEC §5.1 orchestrator; stage bodies
  moved verbatim to `src/sim/core/tick/` — `ctx` (TickCtx, constants), `control` (soft cap, PR/SM, policy adjust,
  capping, cost, RMF), `demand` (3–4), `dispatch` (7–12a), `helpers` (routing, caps, CICS regions; public helpers are
  re-exported from `step.ts`). Bench hashes unchanged on all three scenarios. `src/sim/wlm/evaluate.ts` (~910) is the
  next candidate.
- [ ] **Midwest should use the shared `pool()` helper.** `src/content/scenarios/midwest.ts` defines its own `cp`, `ziip`
  and `icf` constructors; Revenue and Harbourline use `pool()` from `scenarios/pool.ts`. Switch Midwest to `pool()` and
  delete the local helpers (`icf` also needs its `dedicated` flag via `extra`). Pure refactor: `npm run compare` must
  show no difference.
- Stale remote branches (`claude/*`, `ccr-d83b42c6-*`, Oct 21–29) hold only already squash-merged work; delete
  when convenient.

- Pruned completed milestone checklists, superseded decisions, stale timings, and chronological session logs.
  Pending requirements/questions and current validation remain above; the full pre-prune tracker is recoverable
  from `1d9d5a2:PROGRESS.md` and `git log -p -- PROGRESS.md`.
