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
  link"), rebuilt 2026-11-03 from `dev` at `d8ada51` (#170). Republish on request.
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

### Playtest round 2 (2026-11-04, expert player, daily challenge 2026-11-04, Midwest Normal, seed 467203; in progress)

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
- [ ] **Clue path for "why didn't WLM raise CICS".** The player read the WLM log correctly but couldn't see why there
  was no receiver raise. Consider logging the best rejected trial and why ("ONLCARD F4→F6 rejected: harms DDFMOB, equal
  importance"), and showing on WLMGL/SYSWKM that a region class managed to transaction goals runs at the served classes'
  DP (its own PI is reported, not managed to).
- [ ] **⇩ export does nothing in the published artifact:** the claude.ai artifact sandbox blocks downloads. The player
  exported with a dev-tools IndexedDB script and "Copy string contents" (the JSON arrived wrapped in backticks). Use the
  artifact's file-save runtime capability, or add "Copy save to clipboard"; let ⇧ import take pasted text and strip
  stray backticks. Also: the save has no Monitor III history, so `mon3 --at` on an imported save shows nothing for
  past ranges (replay forward instead, or include the history).
- [x] **Unplayable UI on `8c0dd9e`** (#160): the player's run stopped being playable there. The player confirmed it was
  the worker request loops, fixed in #164.
- [ ] **RCA evidence mark to check:** the PROCU pin "BATCHHI#1 APPL 442%" (D4 23:04) was marked "not about CARDAUTH",
  though batch at the CICS regions' DP on PROD2 was the CPU competitor. Check whether the evidence matcher should accept
  the competing class's CPU for CPU_PRIORITY.
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

Investigation (2026-11-04; three subagents on `dev` = `d8ada51` + docs, the player's D15 12:45 save and seed replays; IBM
facts in docs/research.md). Ordered by impact:
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
  priority trials share the reserved grants, so counterfactual per-image availability cannot overcommit the CPC.
  Withheld work keeps its CP/zIIP pool in the backlog. IBM: WLM Planning 3.1 p.60 notes
  4–5, RMF Report Analysis 3.1 p.389 and p.98 (ledger and SPEC updated). APPROX: continuous awake fractions;
  1/256 granularity and recovery boost not modelled. Regressions cover all three maximum types on PROD2,
  eligible CP overflow, backlog-only caps, pool accounting and discretionary planning. Goldens regenerated
  because actual dispatch changes recorded CPU/MSU and subsequent game decisions. Targeted cap, physical-pool,
  batch-projection and WLM tests pass; the PR records full-suite, benchmark and bot regression evidence.
- [ ] **Power-cap RCA is a gotcha (content/design gap).** INC52 RBANK: filed CPU_CAPACITY/HARDWARE_FAULT, truth
  CPU_PRIORITY/HARDWARE_FAULT (2 points); INC53 CARDAUTH: truth CPU_PRIORITY/POLICY (5 points). CPU_CAPACITY needs CPC
  ≥ 90 % (or LPAR ≥ 95 %) and < 10 % of CP to less important work (`src/game/sla.ts`; thresholds hard-coded, not in
  content/); CPCA was 70.9–82 % physical, so priority. The card lowers the capacity setting by one (slower CPs, same
  count); its affected workloads are only MOBILE and RBANK, so CARDAUTH falls back to POLICY although the drop is CPC-wide.
  The rule appears in no Codex entry or RCA form tooltip. Fix: affected workloads of capacity-drop cards = everything on
  the throttled CPC; Codex "RCA vocabulary" + form tooltips; explain after scoring ("CPC 81 % busy, below the 90 %
  capacity line"); show a capacity-adjustment clue (SMF70CAI/CCR, MVS SMF p.589) in CPC/Partition Data. CoD helps only a
  little; the card's cheaper fixes are capping DEVT, deferring discretionary work and protecting importance 1.
- [ ] **Silent events leak through the Operations Log (design bug).** `src/game/run.ts` logs "EVENT start/end: <name>" for
  every card; mail goes out only with an announcement; `src/game/mon3Charts.ts` turns the lines into named chart
  markers. The TSO model-training card has no announcement. Fix: log only announced cards, in their wording; keep
  silent ones out of the log and chart markers until revealed or the RCA is filed (run log changes → goldens).
- [ ] **Two policy installs in one briefing: the second drops the first (bug).** The pending policy is always built from
  the active policy, not the one planned for 06:00. Headless repro: edit ONLHI, activate, edit ONLMED, activate, start →
  ONLMED 0.6 s but ONLHI back at 0.250 s. Fix: build on the day's latest planned activation; show "planned for 06:00: X".
- [ ] **WLM goal edit without an Install option: not reproduced.** New run (live and briefing) and the player's save: the
  button enabled ("Install & activate BASEPOL8"); #164 is not the cause. Likely: the "Add P2 after P1" row uses the same
  widgets and labels as P1, and typing there does nothing until "Add period" is pressed (matches the add/remove
  workaround); typed goals commit only on blur/Enter with no unsent cue; a disabled reason shows only as a tooltip. Fix:
  distinct add-period form, commit on change or show "unsent", visible disabled reason. Ask the player for exact steps.
- [ ] **Activate a saved policy (design gap):** saved policies can only be scheduled; real `V WLM,POLICY=` exists. Add
  "Activate now" (an ordinary activation; emergency when live) and "Load into editor".
- [ ] **Hardware and On/Off CoD (design gap).** Every live change is an emergency (−1.5 trust per stakeholder, fail roll),
  including lead-time items (CP/zIIP/ICF, 4 days) that arrive later anyway; no "plan for tomorrow" while live. CoD: $9k/day
  for 3 days per order (player's two D12 orders ≈ $54k + 2× emergency trust), no early end. Fix: plan-for-tomorrow during
  the live day without trust cost, or exempt lead-time items; "Deactivate CoD" from the next day (real early deactivation
  not verified).
- [ ] **zIIP purchase with nowhere to go (bug + design gap).** Midwest PROD1 has 2 logical zIIPs and 0 reserved, PROD2 no zIIP
  pool; ADD_ZIIP has no headroom check. The UI (`validateLogical`) forbids a PROD2 zIIP while the sim's `SET_LOGICAL`
  creates one (bots and the Story starting fix rely on it), so SPEC F7 can't be fixed in the browser. Fix: PROD2 0 online
  + 1 reserved zIIP (also makes its IIPCP reporting legitimate), `SET_LOGICAL` enforces reserved, warn on ADD_ZIIP.
- [ ] **IIPCP on an image without zIIPs (realism).** With PROJECTCPU=NO (default) and no zIIP configured, real RMF reports
  no IIPCP (Init & Tuning p.434); the sim always does. Moot if PROD2 gets a reserved zIIP.
- [ ] **D8 DDFADHOC was no event.** Normal Monday ad hoc peaks (APPL CP 36–46 % / IIPCP 18–24 % 10:00–16:30; 5.1/2.6 by
  19:30). "Cancel the runaway DDF thread" matched nothing, gave no feedback and cost 0.5 h (see the no-match item above).
  The routing editor lists only multi-target workloads, so ADHOC can't move to PROD1. Player read: fair, but needs feedback.
- [ ] **SMF 101 "vs base" moves retroactively (design gap).** `src/game/smf.ts` divides past hours by today's baseline, an
  EWMA (0.8/h) learned from every SLA-met hour, so a regression is absorbed in ~3 h: at the D7 briefing the D6 08:00 row
  read 1.00 instead of ≈2.8. Fix: freeze each hour's ratio when it closes; learn the baseline only from hours without an
  active event of that mechanism, or a slow decay / same-hour-last-week reference. The Db2-team mail is the
  DB2_WHISPERER perk tip, sent at event start (not pin-driven); tag it "(Db2 Whisperer)".
- [ ] **MLC vs opex budget (UI gap).** At each monthly bill MLC + CoD is compared with the budget: Finance trust
  −over %, > 25 % over ends the run (`src/game/run.ts`). The player's $819k vs $780k ≈ 5 % → −5 Finance, not a loss. The
  Finance card calls the opex line "CoD and other temporary charges" and the header shows MLC est and budget unsummed.
  Fix: "MLC + CoD = X vs budget (+N %; over 25 % ends the run)" in header and Finance card.
- [ ] **TFP offer lacks the numbers (design gap).** Shows baseline $/month, sub-capacity bill at the peak and overage %;
  the per-product terms are stripped from the view and nothing projects TFP vs sub-capacity from history. Fix: per-product
  table (peak MSU and $/MSU, baseline MSU-hours and $/MSU-hour, MSU-hours used) and a run-rate projection.
- [ ] **Monitor III CPC and charts.** CPC has CP rows only (real: per-type groups with *CP/*ICF/*IIP and PHYSICAL lines,
  RMF Report Analysis p.97–98). "CP busy per system" plots % of logical CPs per LPAR and % of physical for the CPC line:
  relabel, add a "% of CPC" toggle. A CPU-by-service-class chart is feasible (per-class engines already sampled), with a
  chart toggle.
- [ ] **CPC busy forecast:** 10-day log-linear fit of daily peak busy as % of installed CPs; weekends (47 %, 34 %) and capacity
  added pull it down. Fit weekdays (or a weekday term) and forecast MSU demand against capacity; mark capacity changes.
- [ ] **Resource group units:** SU/s only. 1 MSU = 277.8 SU/s; SU/s per CP in `src/sim/hw/cpc.ts`. Show "≈ N MSU ≈ M CPs" in
  the editor and the Codex entry.
- [ ] **Codex:** no SMF 101 or SMF 110 entry (only a mention in the SMF-volume entry); add both, linked from the SMF tab.
- [ ] **Layout:** Start day / Briefing sit in a fixed bottom-right box shared with result toasts (they can overlap); the
  header's speed-button slot is empty during the briefing, so move them there.
- [ ] **Export:** besides downloads being blocked, copying the save string from dev tools corrupted 12 escaped quotes in
  inbox text (`\\"`), so the D15 save needed repair before it parsed; another reason for an in-artifact export.
- [ ] **`confirm()` is blocked in the published artifact** (sandbox without `allow-modals`; console: "Ignored call to
  'confirm()'"). ⇧ import (`src/ui/App.tsx`), starting a new run over a saved one and Restart with planned changes
  (`src/ui/Overlays.tsx`) all gate on `confirm()`, which returns false, so they silently do nothing. Replace with an
  in-app confirmation dialog. Workaround used: patch the run in IndexedDB from dev tools (re-queue the lost event end
  commands) and reload; the player confirmed RBANK CPU/txn and MOBILE zIIP recovered.
- [ ] **Starving "Internal" work is free (design gap: a lever with no cost).** TSO and ADHOC have stakeholder `Internal` and
  SLA `NONE` (no incidents, trust or score; `src/game/run.ts`, `src/game/sla.ts`); DEV batch is non-critical with
  `lockIntensity` 0, so a capped or discretionary job holds no locks and its lateness counts nowhere. The only cost today
  is the RG phantom-busy bug. Real costs to consider: developer/BI complaints (an Internal trust facet or an inbox
  escalation when TSO/ADHOC response degrades), capped work holding Db2 locks or ENQs (lock-holder starvation, WLM
  enqueue promotion), and sysprog TSO on the production images during an incident.

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
- Stale remote branches (`claude/*`, `ccr-d83b42c6-*`, Oct 21–29) hold only already squash-merged work; delete
  when convenient.

- Pruned completed milestone checklists, superseded decisions, stale timings, and chronological session logs.
  Pending requirements/questions and current validation remain above; the full pre-prune tracker is recoverable
  from `1d9d5a2:PROGRESS.md` and `git log -p -- PROGRESS.md`.
