# PROGRESS.md

Current status, milestones, active decisions and open questions for **GOAL MODE**. Update at the end of a working
session. **Work ready to pick up is in [BACKLOG.md](BACKLOG.md)**, not here: nothing in this file is a task to start.
Completed implementation details, superseded decisions, playtest rounds, sweep rows and maintenance notes are in Git
history: `git log -p -- PROGRESS.md`. The dated notes up to 2026-11-16 were deleted by the commit "PROGRESS: delete
dated history (CL-42)"; read them at its parent. Older full trackers: `1d9d5a2:PROGRESS.md`, `3fd1762:PROGRESS.md`.
Size rule (under 450 lines, one line per status item): CLAUDE.md. Design: [SPEC.md](SPEC.md). Research and citations: [docs/research.md](docs/research.md).

## Current status

Recent work, one line each (details in the PRs and Git history):
- 2026-11-26: PT-55 bots choose operation targets from player-visible reports and release gateway/HSM protection from offered traffic and recall demand; ambiguous targets stay unresolved, PROCU honors address-space CPU modifiers, and report-only offered-rate accounting keeps old saves readable. Three 20-seed sweeps stayed inside the bands (Midwest 17 / 27 / 40 and 19/20, Harbourline 10 / 32 / 40 and 17/20 (textbook 2/20), Revenue 20.5 / 27 / 40 and 20/20); PT-20's entries are done. [PR #TBD](https://github.com/piconaut/goal-mode/pull/TBD)
- 2026-11-26: PT-54 moves card resolution to operator effects, linked rollouts and inbox replies, retains the CICS/HSM relief footprints, models settlement backout, and migrates legacy saves. The three 20-seed sweeps stayed inside their balance bands. PT-55 is ready. [PR #501](https://github.com/piconaut/goal-mode/pull/501)
- 2026-11-26: PT-53 adds other teams’ rollouts and backouts to the Change board. Paired rollouts share a title and get distinct references. Routine rollouts save CPU while live. All three review sweeps passed. PT-54 is ready. [PR #500](https://github.com/piconaut/goal-mode/pull/500)
- 2026-11-26: PT-57 filed (backlog only; ready now that PT-56 merged): operator commands in the play CLI so player agents can use PT-56's operations.
- 2026-11-26: PT-56 adds targeted operator commands, live Db2 thread and utility views, and gateway and DFSMShsm status in Change Desk → Operations. PT-53 is unblocked for change backout on the board; PT-54 will connect these operations to card endings. Db2 lock release on rollback is verified for PT-54. The three-scenario comparison against `dev` with the PT-52 refactor is identical.
- 2026-11-26: PT-56 review decision (user): RMFGAT is the Monitor III gatherer and its cancel gaps that system only; MONAGENT runs the alert rules and its cancel pauses alerting. SMF-side gap queued as RF-12.
- 2026-11-26: PR #496 cleanup (simplify): one shared played-hour helper, CPU-slice scaling, fraction-modifier predicate, command-log line/cap and lock-holder rule; culprits resolve on the effective workloads' routing. No behaviour change (goldens unchanged).
- 2026-11-26: PT-52 the world's entities: daily DDF-thread and TSO-userid rosters (RUNAWAY and SHADOW_IT load their culprits), a permanent CICSXLOG STC with CANCEL and automation restart, a nightly Db2 utility schedule (REORG_OVERRUN overruns its REORG), the settlement lock holder in Db2 blockers, SICK_AOR abends per region; cards still end by fix id (RF-11 queued).
- 2026-11-26: PT-20 decided ([docs/pt-20-design.md](docs/pt-20-design.md); user: Q1–Q7 yes; revised after an adversarial review): seven general operations with real wrong-target costs on entities in always-present rosters, 21 cards end or are relieved through one, 4 business cards through inbox replies; five entries: PT-52 (entities, ready), PT-56 (operations), PT-53, PT-54, PT-55.
- 2026-11-26: Design call (user): D1's proof gate (RT-24) dropped, Q8b no; PT-20 becomes a design note for general operations, followed by PT-52 … PT-55; PT-19 folds into PT-53.
- 2026-11-25: Shadow week prologue designed ([docs/prologue-design.md](docs/prologue-design.md), #490) and scoped into BACKLOG list `prologue` (PRO-01 … PRO-07).
- 2026-11-25: RT-22 problem records: the player can open a record on a workload, service-class period, image or job over whole closed clock hours and file the same mechanism/trigger/pins as an RCA. `closeHour` stores quiet-hour facts for met hours that a card touched, that grew a delay group past the floor, or whose CF/LCU is far slower than its peers; the record freezes the window's truth (card, quiet hour, standing fault or no problem) and prices a filing at 0.25 engineer-hours, three a day one an hour, with −0.5 trust for a wholly wrong filing once a day. A correct answer earns an RCA's reward on the subject's facet, and one §4.5 episode pays once (an incident RCA and a record of the same episode; a later day or a fallback cause more than two hours on is new, and a record chains back-to-back quiet hours). No fix unlocks yet (Q8b). Browser Problems card, `play problem`, Codex and SPEC §10. Compare: no differences with `--drop quietHours`; without the drop Harbourline gains two quiet-hour facts (record-only state) while sim, log, RMF and Monitor III stay the same; goldens unchanged (the field is absent until a quiet hour exists); three-scenario sweeps (Normal, 10 seeds, all bots in band; runs 45552813412, 45552819909, 45552828780): Midwest 16.5 / 28 / 40 (10/10), Harbourline 10.5 / 30.5 (1) / 40 (8/10), Revenue 20.5 / 29 / 40 (10/10).
- 2026-11-24: PT-50 a slow TSO costs the team engineer-hours: each scenario's content gives TSO's first period an average 0.5 s goal (not an SLA), and when the newest two clock hours miss it every hands-on change, fix, restart, hardware order and CoD deactivation costs 1.5×; the Change Desk banner and cost labels say why, one developer complaint per episode names the response time and the goal (the WLMGL TSO row), and the price returns when the newest hours meet it. Project time and inquiries are planned, not hands-on, and are not surcharged. Coefficients FICTIONAL in `content/staff.ts`; compare: no differences; goldens regenerated for the scripted capped run's complaint and Codex marker; three-scenario sweeps (Normal, 10 seeds, all bots in band; runs 45524183792, 45524184079, 45524184330): Midwest 16.5 / 28 / 40 (10/10), Harbourline 10.5 / 30.5 (1) / 40 (8/10), Revenue 20.5 / 29 / 40 (10/10).
- 2026-11-24: PT-51 Midwest models CPU-paced DDF reader cohorts on the shared settlement partition. CS/RR readers can delay conflicting online work and all-class drains, UR readers affect drains, and Db2 accounting, statistics and blocker pins expose the separate waits and the holder. [PR #488](https://github.com/piconaut/goal-mode/pull/488)
- 2026-11-24: PT-51 research verified WLM chronic-contention promotion, Db2 read claims under CS/UR/RR, and accounting, statistics and blocker diagnostics. PT-51 is ready with scoped DDF lock and utility drain models and a holder clue path.
- 2026-11-23: RT-35 a CF or LCU far slower than its peers is accepted evidence: CF_SERVICE and IO accept a CF at ≥ 4× the work's best CF sync service time or async conversion, or an LCU at ≥ 4× the all-LCU median DISC or response (the pin freezes the peer reading), and the truth adds CF_SERVICE or IO when that resource carries ≥ ⅓ of the work's response time; the primary stays growth-ranked. INC22's standing CF02 flaw now proves from CF Activity but stays unaccepted at its 19.5 % share (the 1/3 line is kept), and the reply says why; the FAIL_CF structure-move state (36–44 %) is accepted. Three-scenario sweeps (Normal, 10 seeds, all bots in band; runs 45309639199, 45309638177, 45309636141): Midwest donothing 16.5 / textbook 28 / expert 40 (10/10), Harbourline 10.5 / 30.5 (1) / 40 (8/10), Revenue 20.5 / 29 / 40 (10/10).
- 2026-11-23: RT-34 THREAD_LIMIT's ruling-out half is tied to the symptom that met its first predicate (`rulesOut`): a CICS slot queue (`MXT_WAIT`, `SOS_MIN`) needs QR wait < 5 ms/txn on the hurt work, because tasks held on a saturated QR TCB keep their MXT slots longer at an unchanged cost per transaction; a DBAT queue keeps CPU per transaction normal and an initiator wait the jobs' CPU wait. Every met symptom needs its own reading on its incident, so a combined queue needs both. The INC35 shape no longer completes the recipe, a too-low MXT with QR normal still does, and the reply names the QR wait line. The replay's own incident (MXT lowered while QR is saturated) is still blamed on THREAD_LIMIT but proves neither recipe: that low-limit residue stays RT-19's, as the entry says. Proof recipes only: truth labels, goldens and sweeps do not move.
- 2026-11-23: Backlog design calls (user): RT-29 split into RT-34 (THREAD_LIMIT must rule out QR) and RT-35 (a resource far slower than its peers is accepted); RT-31 keeps the clock-hour average; CL-19 becomes a field guard test; PT-21 split into PT-50 (slow TSO costs engineer-hours) and PT-51 (research); Q8a yes, so RT-22 problem records is ready.
- 2026-11-23: CL-63 reconciled the stale docs/research.md "Fix queued" rows with the code and the pages: Honor Priority and offline zIIPs (PT-06), unbounded MAXDBAT/MXT queues (realism fix 3), a capped server's dependents (realism fix 1, RF-09) and an AOR group cap reaching transaction CPU (realism fix 2) now read Matches/Approx, and SPEC §17's R4HA row states the modelled phantom-weight polarity instead of a queued fix.
- 2026-11-23: M8.7 realism closed: audit fixes RF-01 … RF-09 merged (#428–#433, #478, #479) and BACKLOG `realism-fixes` is empty; RF-05 and RF-08 are on `main` via the dev → main milestone PR #481.
- 2026-11-23: RF-08 a capacity group gives each member its own view of the group's four-hour average (the group's slots since that member joined, zero-filled before), so a member added to an existing group sees more unused capacity and may cap later; Partition Data and the Monitor III CPC header print AVAILABLE and flag the LIMIT with `*` for four hours, a changed group limit restarts the views, and the cap decision reads the member's view, not the group's combined one.
- 2026-11-23: RF-05 MSU is charged on effective CP dispatch time (physical dispatch less the LPAR management share) instead of total dispatch time, so the header MSU, Partition Data MSU AVG, Monitor III CPC MSU Act, the R4HA, soft capping and the bill read one rate and an image no longer shows two MSU figures at once; R4HA and bills fall by the overhead share (1–3 % on the reference runs), while LPAR BUSY and physical busy keep total dispatch time. Ten-seed three-bot sweeps (Normal, all in band; runs 45111397822, 45115168408, 45115168291): Midwest donothing 17 / textbook 28 / expert 10 of 10, Harbourline 11 / 30.5 / 8, Revenue 21 / 29 / 10.
- 2026-11-23: RT-23 the retry storm backs out 20 % of its units, so Db2 accounting shows a rollback share (QWACABRT) and the Db2 statistics view shows rollbacks per member (Q3STABRT); APPLICATION_ERROR's recipe accepts the rollback share with the volume, which proves a storm and not a same-rate campaign. Reporting-only: the units still consume their CPU and time.
- 2026-11-22: PT-49 application owners and business-calendar facts move into each scenario's game content, so Midwest, Revenue and Harbourline answer `APP_ENTRY` with their own owner and `CALENDAR` with their own facts; absent data keeps the old fallbacks ("the <app> owner", no standing facts).
- 2026-11-22: RT-30 RCA replies separate the accepted answer from the proof (accepted / your pins did not prove it), mark an accepted alternate with the primary, quote the pin's reading on a failed predicate, list every filed pin with why it did not count, and say the truth reads the clock hour when a pin met a line the hour average misses; the RCA card renders the same text.
- 2026-11-22: RT-17 one healthy baseline per workload per clock hour (EWMA 0.5 over days, rolling EWMA as fallback) feeds the mechanism judgement, the CPU drill-down, AIOps and the frozen SMF "vs base" ratio; a delay group with ≥ ⅓ of the excess is accepted, and under 10 % of the response-time goal none explains the miss, so the 20:00 lock incidents (R-6, R-15) read as CPU.
- 2026-11-22: Per-PR timing of the November sim changes, the regressions it found and the remaining targets are in docs/headless-performance-options.md ("Results: November regressions").
- 2026-11-22: Per-tick WLM period records start with their sustained-demand fields, keeping one object shape through the evaluator (#295 regression; hash-neutral).
- 2026-11-22: RT-28 a grouped RCA reply names each distinct member primary with the workloads whose truth it is and attributes every accepted reason to its victim; a single incident's reply is unchanged.
- 2026-11-22: PT-48 play CLI pins name an RMF interval by the id `report` shows for CF and DASD as well as WLMGL and CPC (CF and DASD read the id as an array position), interval pins are labelled with the interval's range, and a CF/DASD pin without an id says it read the latest interval; a past PROCU pin stays refused because the CLI's `--at` history keeps no job rows.
- 2026-11-22: CF Activity accumulation shares a pass over structure samples and updates each subchannel's private row once per tick.
- 2026-11-22: Per-system CF accounting shares service calculations at each site within a tick and still records each system's own request rate.
- 2026-11-22: Added a paired benchmark for core and live runs across revisions and a Node CPU profile summarizer, with usage in `docs/tools.md`.
- 2026-11-22: Hourly CPU accounting reuses a private accumulator across ticks in each advance, preserving the saved hour records and deterministic results.
- 2026-11-22: CI `citations` passes at once on the `dev` → `main` milestone PR (user decision): its lines were gated on their PRs into `dev` or predate the rule; milestone #459 opened.
- 2026-11-21: RT-23 and RF-08 research settled and both entries unblocked: a retry storm is read as the SMF 101 class-1 rollback share (`QWACABRT / (QWACCOMM + QWACABRT)`) — a game inference, since IBM documents the backouts but not that they mean client retries — and retries that commit need SMF 102 client identity, which the game does not collect; a capacity group's average is modelled as a zero-filled per-member four-hour view (IBM states the symptoms, not the arithmetic; the Sub-Capacity Pricing book is now in the books repo). Ledger rows in docs/research.md qualify the `KEEPDYNAMIC(YES)` and `ACCTG(ALLCOMMIT)` accounting-interval exceptions.
- 2026-11-21: CL-30 split policy adjustment into a per-call context, trial assessment, candidate/donor selection and trace/delay helpers; public imports and existing tests stay unchanged.
- 2026-11-21: CL-35 split investigation subcommands into `tools/inspect/`; the dispatcher keeps its CLI and public exports, with implementation statements and tests unchanged.
- 2026-11-21: PR-25 citation gate accepts a printed-page token only in the parenthesis directly after its PDF page run, using the same rule for wrapped lines.
- 2026-11-21: CL-49 current-hour Db2/CICS evidence labels start at :00 through capture time; closed-hour labels, values and judging timestamps unchanged (SPEC §10).
- 2026-11-21: CL-48 PROCU's game-only class summary shows EAppl CP once, with its IIPCP subset and zIIP column; all evidence metrics remain available, job columns unchanged (SPEC §8).
- 2026-11-21: CL-47 sick-AOR event severity scales the absolute failure fraction from zero (Story 0.245, Normal 0.35, Hard/Ironman 0.4375), capped at 1; other modifier scaling unchanged (SPEC §11.2).
- 2026-11-21: RT-33 CAPPING also for a resource-group cap on the judged host: CAP delay ≥ 5 % on the hurt period or its server period, or a group-capped server role; trigger POLICY, cause `none:CAPPING:<host>:rg:<group>`; a DELAY_CAP pin alone proves it; no shipped policy has resource groups, so compare is identical (#449).
- 2026-11-21: RT-32 CPU verdict judged on the host with the most CPU-wait excess and the pool that queued, capacity vs priority by displaceable CPU (importance-free; the hurt work, its servers and at-risk SLA work excluded), shared with the CPU_PRIORITY proof; R-13 → CPU_PRIORITY/POLICY; sweeps in band, bots unchanged (#447).
- 2026-11-21: CI `citations` reads a PDF label wrapped onto the line above (the #446 false positive) (#448).
- 2026-11-21: RT-16 build design (docs/rt-16-design.md; Q7a … Q7e accepted, split into RT-16, RT-32, RT-33) and RT-16 reporting-only CPU accounting: CPU wait by workload per image, CP/zIIP/IIPCP by period, server role and workload, CAP-delay samples, capped server-role ticks, zIIP busy; goldens regenerated, `npm run compare --drop` identical (#446).
- 2026-11-21: agent RCA playtest (four bots, 8 days each, one per scenario plus Midwest Hard); RT-16 and RT-17 unblocked by the user (Q6, Q7), RT-16 first; findings filed as RT-28 … RT-31, PT-48, PT-49 (#445).
- 2026-11-21: CL-62 note on the archived WLM audit that its page citations predate the PDF-index rule; list `page-citations` finished and removed (#443).
- 2026-11-21: CL-61 `src/sim/hw/pools.ts` capping comment names `cappedFrac` as the sim's own measure; RMF PDF p.401 cited only for WLM% (#442).
- 2026-11-21: CL-60 docs/research.md citations labelled `PDF p.N (printed M)` from each page's footer; labels match their `#page=` links (#441).
- 2026-11-21: CL-59 PR gate `citations` (`tools/ci/citations.ts`): added lines may not carry a bare page citation, and a `PDF p.N` link label must match its `#page=` (#439).
- 2026-11-21: BACKLOG CL-59…CL-62, a smaller scope for the page-citation rule than the closed #436: a CI check on new citations, the research.md ledger, one wrong pools.ts citation, a note on the archived audit (#437; moved to list `page-citations` in #438).
- 2026-11-20: CLAUDE.md citation convention: PDF page index, labelled, printed page in parentheses, edition named (#435); zos-docs templates distinguish patent drawing sheets from text columns and use verified section breadcrumbs (#460).
- 2026-11-20: RF-09 a server role whose own cap left it under 10 % of its demand carries only its granted share: its dependents complete that share of their arrivals and the rest time out, their CPU falling with completions (Db2 MSTR/DBM1 hold commits and getpages); the bounded delay stays above the threshold and for image-wide shortages (SPEC §5.6, §17, docs/research.md) (#433).
- 2026-11-20: RF-07 every batch job that ends is one WLMGL/SMF 30 ended transaction with its queue-plus-elapsed response time in its ending period and report class, whatever the goal (velocity/discretionary classes no longer show ENDED 0); Monitor III ended rate and the `smf30-vs-wlmgl` identity cover every goal type; buckets stay for RT goals (docs/research.md, SPEC §17) (#432).
- 2026-11-20: RF-06 Partition Data WLM% is the share of the interval the soft cap was in force (SMF70NSW ÷ SMF70DSA), not the share of demand it removed (that stays CAPPED); Monitor III WLM Capping % shows the instant state; new `LparPoolRuntime.softCapInForce`, identity restored (docs/research.md, SPEC §17) (#431).
- 2026-11-19: CL-18 one game command layer (`src/game/commands.ts`) shared by the browser worker and the play CLI, with the validation/wording drift between them resolved (#427).
- 2026-11-19: RF-01 CPU Activity report renders the capacity-change reason (`CHANGE REASON=NONE | POWERSAVE | MACHINE`) in its header; Partition Data drops the line; clue texts, codex entry, SPEC §17 and docs/research.md updated (#428).
- 2026-11-19: RF-04 velocity floor moved to `src/content/wlm/tuning.ts` `VELOCITY_FLOOR` (0.1 %, FICTIONAL); velocity PI capped at 10 × goal, percentile projections extrapolate past 4.0 — which outweighs the other depends on starvation; no near-zero PI bound found in the WLM books checked (zos-docs: ieaw100 p.70-73, sg246472 p.54-56) (#429).
- 2026-11-20: RF-02 Db2 SMF 101 view drops the `DBAT queue ms/txn` column; new Db2 statistics (DISPLAY DDF) view shows the cumulative count of DBAT requests that waited per member per hour; `DBAT_QUEUE` evidence pin reads it from there; Codex entry, SPEC §17 and docs/research.md updated (#430).
- 2026-11-19: PT-17 browser saves carry their live day's start state and actions, so `inspect wlm --at` replays any time in the current day (cost: the save doubles, measured in the PR).
- 2026-11-19: PR-24 CPU-by-service-class chart gives every displayed period a distinct colour (#425).
- 2026-11-18: PT-15 Monitor III chart picker (per-viewer, stored), CP busy labels with a % of its CPC option, and a CPU-by-service-class chart (#423).
- 2026-11-18: PT-14 Monitor III CPC report groups by processor type (*CP, *IIP, *ICF) with PHYSICAL lines in the browser and `play mon3 CPC` (#422).
- 2026-11-18: PT-12 TFP offer per-product terms and run-rate projection in Finance and `play finance` (#421).
- 2026-11-18: PR-23 reconciled the merged PT-11 description with the shipped CoD/hardware changes (#420).
- 2026-11-18: PR-22 CoD deactivation button follows the handler phases (#419).
- 2026-11-18: PT-11 live lead-time hardware plans without emergency trust; CoD deactivates from tomorrow (#417); review reconciled IBM sources, content tunables, live wording and tested overlapping-lease billing through early and original expiry.
- 2026-11-18: PT-10 saved-policy "Activate now" and "Load into editor" in browser and play CLI (#416); review reconciled SPEC and the research ledger with the shipped actions and checked IBM's installed-policy requirement.
- 2026-11-18: PT-08 CICS short-on-storage alert metric and region subject; evaluation requires active CICS monitoring (#415).
- 2026-11-18: PR-21 Monitor III splits read from decayed components; sysplex rows sum their systems and reporting preserves source accumulators (#413).
- 2026-11-18: PR-20 separates consecutive no-trial candidate streaks from trial-search assessment episodes in `inspect … wlm-stats` (#411); simulation behaviour unchanged.
- 2026-11-18: PR-09 automated jsdom coverage for run-file and confirmation dialog lifecycles (#410).
- 2026-11-17: `pr-review-loop` retired; `pr-fix-loop` is the only review loop (CL-44, #391).
- 2026-11-17: `cleanup` list reviewed: CL-28/29/31/32/34/43 dropped, CL-27 and CL-36 narrowed, CL-10 moved to
  `pr-followups` as PR-21, CL-44 unblocked (no scheduled task runs `pr-review-loop`).
- 2026-11-16: round 3 finding: a starved Db2 only slows its dependents by a bounded factor (BACKLOG RF-09).
- 2026-11-16: playtest round 3 (RCA truth and WLM) started on preview `3da33f5`; `playtest-companion` now publishes an
  interactive checklist artifact per round ([round 3](https://claude.ai/artifact/4kPyWy6vcipRe76UwbVsA4)).
- 2026-11-16: milestone #363 merged to `main`; release and preview artifacts rebuilt. PROGRESS history deleted (CL-42, #364).
- 2026-11-15: codebase survey filed as BACKLOG `cleanup` CL-11 … CL-45 (#362).
- 2026-11-15: RCA truth: RT-13 proof recipes (#357), RT-14 card footprints (#359), RT-15 grouping by cause (#361).
- 2026-11-14: cross-report invariant suite, 43 identities per scenario (#347); RF-05 … RF-08 and CL-10 filed.
- 2026-11-14: agent instructions pruned of incident notes (#355); PR-04 … PR-08, PR-10 UI fixes (#348–#352, #358).

- **Phase:** M0–M7, M8.7 and M8.9 complete; M8 follow-ups remain; M9 simplified mode is planned
  (requirements below).
- **Held for the user:** the finance feedback loop, the full-day tutorial, M9. Proposals are under "Proposals awaiting
  the user" in Remaining work; none is implemented.
  The 27-card event deck is complete; add events only if a playtest asks for them.
- **Published builds** (republish on request):
  - **Release (main):** [artifact](https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv) (sharing is "anyone with the
    link"), "GOAL MODE (release · main 4a3a590)", rebuilt 2026-11-16 from `main` at `4a3a590` (merge of #363).
  - **Preview (dev):** [artifact](https://claude.ai/artifact/MbFdETzQXwuj87CvtiQyNW) (private until shared),
    "GOAL MODE (preview · dev 3da33f5)", built 2026-11-16 from `dev` at `3da33f5` (#364; the same game as the
    release, since #364 changed docs only).
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
| M8.7 | Researched realism fixes, recorded in SPEC §17 and docs/research.md: the CICS_SOS EDSA storage model (#166) and the audit round RF-01 … RF-09 (CPU Activity change reason, DISPLAY DDF view, velocity floor, MSU on effective dispatch, WLM% as cap-in-force share, every ended batch job a transaction, per-member capacity group R4HA, a starved server carrying its dependents at its granted share). Closed 2026-11-23 with list `realism-fixes` empty. |
| M8.9 | Headless play CLI, three player personas, deterministic command logs, spectator mode and take-over saves. |

## Remaining work

### Design directions (user, 2026-11-05; not scheduled, still being thought through; don't implement)

**D1. Targeted fixes unlocked by a correct RCA: dropped (user, 2026-11-26).** The proof gate kept the
"fix this exact problem" button that felt inauthentic. PT-20 replaces it with general operations (cancel work, recycle
CICS regions, back out a change, throttle a channel, hold HSM recalls) whose targets the player chooses; cards no
general operation fits keep no targeted fix. Plan: BACKLOG PT-52, PT-56, PT-53, PT-54, PT-55 ([docs/pt-20-design.md](docs/pt-20-design.md), decided 2026-11-26). Problem records
(RT-22) and the proof recipes stay as scoring. History: [docs/rca-design.md](docs/rca-design.md) §5 (superseded), §7 Q8b.

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

**P2. Guided prologue (the shadow week).** Superseded on 2026-11-25 by
[docs/prologue-design.md](docs/prologue-design.md): the real production handover in the last week of the prior month
(26th–30th, month-end), on the Midwest plant as is (separate optional scenario `midwest-prologue`, no golden or sweep
impact), five days with a retiring mentor, one prologue-only flaw (a forgotten DDF resource group cap), undo beats for
temporary fixes, four RCAs with less help each time, the month's bill, then Day 1 as today. Scoped into
BACKLOG list `prologue` (PRO-01 … PRO-07) on 2026-11-25.

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

- Worker budget is ≤ 4 ms/tick. Revisit performance when measured sweep cost warrants it.
- PR/SM pool plans cache configuration-only work, including entitlement, by CPC and LPAR-array identity.
  Configuration edits must replace those objects; in-place mutation can leave cached plans stale.
- Numeric-kernel work requires measured ≥15% end-to-end savings and removal of the old production path in the same
  milestone. Bot bundling (~0.18 s startup/run) is deferred; `advanceBatch` stays shelved.
- [docs/headless-performance-options.md](docs/headless-performance-options.md): option 1 (lookup plan) is done;
  option 2 (mutable engine, in-place accumulators) waits for a user decision; option 3 (`evaluateLpar`) for a re-profile.
- Evidence: [docs/headless-performance.md](docs/headless-performance.md), raw results in
  [docs/performance/](docs/performance/). Preserve pure snapshots and exact hashes for optimizations.

### M8.2 Balance harness & targets

- Balance targets closed on 2026-10-27. Sweeps are regression checks: CI uses 5 seeds; use 20 to confirm
  balance-affecting changes. Textbook's day-27/28 batch wall is intended pressure, not a tuning target.
- Latest reference, PT-55 (2026-11-26, remote, Normal, seeds 1–20). Median end day for do-nothing / textbook / expert,
  then expert wins. Midwest 17 / 27 / 40 and 19/20, Revenue 20.5 / 27 / 40 and 20/20, Harbourline 10 / 32 / 40
  and 17/20 (textbook wins 2/20). All inside the CI bands. The medians held against PT-54, moving at most 2.5 days
  and one expert win. [Midwest](https://github.com/piconaut/goal-mode/actions/runs/45909847217),
  [Revenue](https://github.com/piconaut/goal-mode/actions/runs/45909860939), [Harbourline](https://github.com/piconaut/goal-mode/actions/runs/45909854793).
- I13 quick reversals for S-1 through S-3 were 1/0/8, accepted by the user (2026-11-13, #331).
- Latest 20-seed reference, WT-15 (2026-11-13, `dd52ba8`): [Midwest](https://github.com/piconaut/goal-mode/actions/runs/43381673208)
  17 / 27 / 20 of 20, [Revenue](https://github.com/piconaut/goal-mode/actions/runs/43381709546) 20.5 / 27 / 20 of 20,
  [Harbourline](https://github.com/piconaut/goal-mode/actions/runs/43381747813) 10 / 31 / 15 of 20 (expert losses
  all trust; textbook wins 2 of 20).
- Nonblocking follow-ups: Revenue textbook day-22 PREFILL losses; Hard Harbourline expert has no victories
  in the recorded sweep before its $1.6M budget; Story Midwest textbook reaches the batch wall, while
  Story Harbourline textbook wins 18/20. Recheck before drawing new tuning conclusions.

### M8.4 Content and M8.6 playtesting/progression

Roadmap, not scoped: these become BACKLOG.md entries once designed.
- Human UI playtest; check the phone-width setting rows (currently scroll within panels).
- Additional scenarios: Continental Insurance (requires IMS model), Global Airline (24×7, two sites/GDPS).
  Revenue is already playable. Each new scenario needs its own flaw list and story beats (SPEC §13.3).
- Widen draft/starting perks, each with a cost or trade-off and data in `src/content/`.
- Expand career unlocks: scenarios, starting tools, cosmetic titles and further levels. Current career has
  seven levels, starting perks, and Report Class Hoarder at level 7; scenario unlocks remain open.

### M9 — Simplified mode (after M8; user request 2026-10-20)
Goal: the same simulation, made approachable for players who aren't z/OS experts. Nothing in `src/sim`
changes; simplified mode is a game/UI layer over the same commands, reports and scoring.
Do all M9 work on a separate
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
- Real z/OS mechanics with fictional tunable numbers; no real LSPR/MSU/pricing data. Tick = 10 sim-seconds;
  played day = 06:00–06:00; standard run ≈40 business days with weekends auto-simulated.
- Game randomness uses independent keyed streams for events, drafts, failures, AIOps, and inquiries.
- Diagnosis is the gameplay. Tools reveal data and cost CPU; every lever has a cost or trade-off. Starts have
  15 insight; RCA guessing may pay; GOODWILL stays +4 trust across stakeholders (accepted user decisions).
- Change Desk settings draft in place and submit as one request. Hours are per change; emergency trust/failure
  risk are per request. Operations and hardware orders keep one-click actions.
- Harbourline's outgoing analyst handover mail was removed at the user's request; PRDA's absolute cap has no
  day-0 inbox clue or day-1 trust grace. HMC and Partition Data expose it.
- Manage Region Using Goals Of is fixed at TRANSACTION for the player (user decision 2026-11-05): the sim keeps
  REGION/BOTH (lab, tests); the Rules view drops the column and `playerWlmEditError` refuses `SET_RULE_REGION_MODE`
  in the worker and play CLI. All three scenarios start at TRANSACTION (`tests/game/scenarioRegionMode.test.ts`).

## Branch workflow

- **PRs to `main` (user request 2026-10-21):** open a PR `dev` → `main` at sensible milestones: a PROGRESS item or
  milestone ticked done (e.g. a scenario playable and swept, a model feature with goldens and sweep recorded), not for
  docs-only or in-progress work. Before opening: `npm run check` green, bench hash recorded, PROGRESS updated. Body:
  what changed since the last merge to `main`, test count, hashes, sweep results, anything waiting on the user. At most
  one open `dev` → `main` PR; later pushes to `dev` update it, so retitle/re-describe it instead of opening another.
  The body also needs a "## Behaviour change" section listing the golden changes since the last merge to `main` (CI
  `behaviour-note` gate; `citations` passes at once on it, user decision 2026-11-22). Each one gets a `pr-reviewer` review (base `main`, head `dev`), which it also posts on the PR
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
- zIIP shortage as capacity: the CPU split measures general CPs only. Whether a full zIIP pool with CP white space
  under IIPHONORPRIORITY=NO is "capacity" or "policy" is a game-rule choice (docs/rca-design.md §4.3 treats it as
  policy); no IBM source decides it.

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
