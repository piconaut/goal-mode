# PROGRESS.md history, through 2026-11-16 (archive)

**Reference only.** Dated status notes, maintenance logs, per-entry sweep rows, the closed WLM audit summary and
playtest rounds 1–2, moved out of [PROGRESS.md](../../PROGRESS.md) on 2026-11-16 to keep it short. Agents don't read
it by default; grep it when a question needs the history. Headings are the ones these notes had in PROGRESS.md.
Nothing here is a task: open work is in [BACKLOG.md](../../BACKLOG.md).

## Current status (dated notes, 2026-11-13 … 2026-11-16)

- **Codebase survey for refactors and cheaper tests (2026-11-16, direct user request, not a BACKLOG pick).** Five
  read-only researchers covered sim, game/content, ui/worker/tools, test cost and docs/process; findings are filed as
  BACKLOG `cleanup` entries CL-11 … CL-45. A local full `vitest run` (4 cores) took 234 s wall for 585 s of summed file
  time; the slowest tests are the WT-06 ladder test (49 s, left alone by user decision), inspect B1 (45 s, CL-11),
  realism CCIMP (23 s), golden (22 s) and what-if (21 s). Overlaps with existing entries are set as `after`
  dependencies (PR-13, CL-07, CL-10, PR-19, PR-20); PT-18 is related to CL-17 but stays separate.

- **Agent instructions pruned of incident notes (2026-11-14, direct user request, not a BACKLOG pick).** Skills and
  agents state each rule on its own; the PR or entry that prompted a rule (#107, #331, #333, #345, WT-12) stays in git
  history and this file, not in the instructions, so the rule lists don't grow with every incident. Report-format
  examples with sample PR numbers and the `wlm-why` mechanic tags (WT-07…) are kept: they're examples and lookups.
- **Cross-report invariant suite (2026-11-14, direct user request, not a BACKLOG pick).**
  - `tests/sim/report-invariants.test.ts`: 43 identities (24 real z/OS reporting behaviour, cited to book and page
    with the zos-docs skill; 19 game consistency rules) over one seeded headless day per scenario in `SCENARIOS`,
    shared by every identity. The run (`tests/helpers/reportRun.ts`) plays the scenario as shipped for four hours,
    then 16 stress phases derived from its own configuration through ordinary commands, then the evening batch.
    Identities are in `tests/helpers/reportIdentities.ts`. No assertion names a scenario, LPAR, class or workload.
    Two coverage tests fail if an identity, or one of 20 stress situations, is reached by no scenario.
  - All 43 hold on Midwest, Revenue and Harbourline (seed 7). About 37 s locally for the three runs.
  - Three reporting bugs found and fixed, each in its own commit, `npm run compare -- --base origin/dev`: sim
    state, game state, run log and Monitor III views the same on all three scenarios; RMF records differ only in the
    CF lines named below.
    - SYSINFO, WFEX and the header did not show an image as capped under capacity-group capping.
    - The header's PI heat map used WLM's raw samples, Monitor III and WLMGL the reported ones: a CICS region class
      had two PIs at once (Midwest STCHI#1 0.61 against 0.63).
    - A CF line's service times and ASYNC % were time-averaged, its structure lines request-weighted; a subchannel
      line's SYNC SERV was weighted by all requests. Goldens regenerated (the run hash includes the RMF accumulator).
  - Five divergences filed and their identities left out with a comment naming the entry: RF-05 (MSU from total
    dispatch time; RMF's is from effective), RF-06 (WLM% is the share of demand removed, not of time), RF-07 (WLMGL
    ENDED counts job ends only under a response time goal), RF-08 (a capacity group's average is on no report and
    starts empty), CL-10 (Monitor III's last-tick splits don't add up).
  - Decisions: the run uses the scenario's game content without its event deck, so a new card cannot change what
    the suite covers; stress phases run at a 5-minute RMF interval (10 when the scenario's own is 5), which gives
    each half-hour phase six intervals and makes the per-tick Monitor III window cheap; a failing identity is a
    finding to triage (CLAUDE.md "Testing expectations"), never loosened.
  - Not covered: the play CLI's text layouts (they render the same view models; the suite checks the report
    renderers print no NaN/Infinity/undefined), CF and DASD activity against per-transaction request counts (those
    coefficients are not player-visible), and generated configurations (optional in the request; not added).

- **PR-07 modal placement (2026-11-14):** native modal dialogs use the shared fixed-position rule; the overlay card
  remains relative. The source-level cascade regression rejects unsupported pseudo-classes instead of silently
  ignoring their placement rules. Native-browser lifecycle coverage remains the separate PR-09 backlog entry.

- **CL-09 (2026-11-13): loop and reviewer instructions, lessons from the WLM close-out.**
  - pr-fix-loop reviews `needs-user` PRs and holds only the merge. pr-fixer doesn't count the user's pending
    decision as a finding. dev-loop answers holds on those PRs and doesn't count them as blocking a pick.
  - dev-loop states a design question with two or three options checked with zos-docs, plus a recommendation
    (steps 3.3 and 5.2).
  - Status marks in docs are claims: dev-loop lists them in the PR body, and pr-reviewer check 5 verifies them.
  - pr-reviewer check 7 gains two prompts: new data in shared state, and a test for each rule.
  - AGENTS.md gains a Reviews section: the header, attribution last, read CI rather than rerun.

- **WT-17 and WT-14 (2026-11-13): the `wlm-truth` list is closed.**
  - docs/wlm-design.md is now the living design doc. It keeps the section numbers of the parts it retains:
    - §1 sources;
    - §3 real WLM;
    - §5 the model as built, rewritten as a description: invariants, coefficients and approximations, what the
      player sees, and known gaps (§5.13).
  - The audit, findings, repros, order of work, decisions and per-entry results moved to
    docs/archive/wlm-audit-2026-11.md (reference only). References across the repo are rewritten.
  - WT-14 is dropped, not done. Receivers that meet their goals, small consumers and mean time to wait stay
    unmodelled, documented as APPROX (§5.10, §5.13; SPEC §5.5.4 and §17; a comment at the receiver list in
    `adjust.ts`).

- **WT-12 batch RT priority projections (2026-11-13):** a batch AVG/PCT period's base and trial PIs are its measured
  PI with the execution part scaled by measured ÷ projected execution velocity (`PI × (Q̄ + Ē × v_ref / v') / (Q̄ + Ē)`,
  docs/archive/wlm-audit-2026-11.md §9.15). The queue time is held fixed and there is no forecast of each job's remaining work.
  `rtQueueSumSec` keeps the queue split beside `rtSumSec`; `batchRt.ts` applies the formula only where that field is
  present and the period still has address-space work (`kind: 'AS'`), so a decayed queue split does not override the
  transaction projection when the class later serves transactions (review B1). Null with no completions or no running job;
  PCT uses the same factor on the extrapolated percentile PI; donors use the same formula. Tests: `tests/sim/batchRt.test.ts`.
  W11 is fixed for batch; started tasks still have no completions. No shipped policy gives batch an RT goal, so
  goldens, bench hashes and `npm run compare` are unchanged.
  - User decision: a fair few installations use batch RT goals despite IBM's advice, and the user may want to play
    with them in game. Lower priority than the core WLM redesign, but the WLM work is not complete without it.

- **PR #333 review documentation (2026-11-13):** W11's no-PI/no-warning description is explicitly the state before
  WT-12. The remaining no-completions limitation covers all started tasks, including temporary tasks; it is not
  limited to indefinite tasks. No further model scope is claimed.

- **PR #333 review M2 (2026-11-13):** goal issues identify their subsystem. The service-class editor marks the
  CICS transaction tag bad only for CICS issues, while retaining JES advice in the combined issue list. Rendered
  active/pending-policy regressions cover shared CICS/JES classes with and without a genuine CICS warning.

- **PR #333 review M1 (2026-11-13):** completed AVG/PCT batch jobs now contribute the same completion, queue-plus-
  elapsed response time and exact bucket to their assigned report class (WLM Planning 3.1 p.113, rechecked).
  Regression cases cover AVG/PCT in first/later periods, separate report classes and unreported jobs, local and
  sysplex RMF rows, and no duplicate completion. Report-class grouping/heterogeneity rules are unchanged.

- **PR #333 review B1 (2026-11-13):** measured percentile PIs now use the same completion-count cutoff as average
  PIs. A lone job's bucket ratio no longer keeps a period missing its goal after its completion history expires;
  trial percentile projections retain their existing path. The AVG/PCT completion/25-minute-expiry regression
  reproduces the stale PI before the fix and passes with it. The fixed decay/cutoff remains a sim approximation.

- **WT-12 (2026-11-13):** completed batch jobs feed response-time goals with one queue-plus-elapsed observation
  in the ending period. JES RT goals carry the three-completions-per-20-minutes advice in the editor and PI Codex
  entry (WLM Planning 3.1 p.71). **Historical:** at this PR W11's batch priority projection was still open; the top
  WT-12 entry closes it. Started tasks remain without completions.

- **WT-11 (2026-11-13):** discretionary resource-group minima use smoothed CP consumption and CPU delay, run ahead
  of goal work meeting its goals, and yield while an outside goal period has local PI > 1. IIPCP counts toward
  consumption; zIIP service does not. Tests cover both priority cases and the trigger boundaries. No shipped
  policy has a minimum; validation is recorded in the PR. W10 is closed; WT-12's later projection entry closes W11
  (top entry).
- **WT-16 investigation (2026-11-13):** docs/archive/wlm-audit-2026-11.md §9.13 isolates the capped-STCHI 4.2652 → 26.3789 PI
  jump to address-space delay samples, despite a CP grant rising from 0 to 0.328816 engines. A two-slice fixed-demand
  counterexample excludes backlog, uplift, batch and server dependencies. S-1's DDF cases instead lose CPU when
  joining batch's level under the current fictional ready-unit counts. No simulation change; the correction followed
  in #331 (below).
- **WT-16 correction (2026-11-13; docs/archive/wlm-audit-2026-11.md §9.14):** offered-demand samples fix the capped-STCHI
  velocity inversion; projections expose gains past the PI ceiling of 99, with the existing velocity floor and
  planner limits retained. S-1 … S-3 quick reversals are 1/0/8, from 1/0/4. User decision (2026-11-13, #331): the
  Harbourline cost of 8 (58 % below the original 19, against I13's 80 %) is accepted with the corrected model. WT-16
  is closed and WT-17 is ready. No coefficient or backlog-guard tuning.

## Remaining work

### WLM policy adjustment audit (2026-11-10; WT-04 and WT-05 implemented 2026-11-11, WT-06 and WT-07 2026-11-12)

[docs/archive/wlm-audit-2026-11.md](docs/archive/wlm-audit-2026-11.md) checked the whole adjustment loop (`src/sim/wlm/adjust.ts` and what feeds
it) against IBM's description, step by step, and proposes one target model. Fifteen findings with seed-42 repros;
the four structural ones: receivers are chosen on the smoothed PI but every trial is judged on one tick's PI (W1);
the DP ladder only climbs and collapses at the top of the managed range within a day or two on a stressed image
(W2); each served CICS class owns a DP and only the highest counts (W3); donors are picked by importance and CPU
use, not by goal achievement (W4). The work is BACKLOG.md list `wlm-truth` (WT-01 … WT-15); WT-01's `inspect … wlm-stats` and
WT-12's batch response-time measurements have landed. User decisions on §8 (2026-11-10): all as
recommended, and the core (WT-04 … WT-10) lands after RT-06 and before RT-14, so RCA footprints and balance are
built once on the new WLM; the RT-15 playtest follows the core (§7).

### M8.2 Balance harness & targets: per-entry sweeps (WT-04 … WT-12)

- WT-04 sweep (2026-11-11, remote, Normal, seeds 1–10, `dev` `40b81dc` → WT-04 `1f2e8d3`): do-nothing / textbook
  median day, expert victories. Midwest 16.5 / 28 / 10 → 16.5 / 28 / 10 (identical); Revenue 19 / 27 / 10 → 20 / 27
  / 10; Harbourline 9.5 / 29 / 5 → 9.5 / 29 / **8** (trust losses 5 → 2; back inside the 60–100 % band). Every bot
  inside its band on all three. After the review fixes (`68ea72a`): Midwest 16.5 / 28 / 10, Revenue 20 / 27 / 10,
  Harbourline 10 / 29 / 8 (textbook 1 victory). As merged (`8f22df3`): Midwest 16.5 / 28 / 10, Revenue 20 / 27 / 10,
  Harbourline 9.5 / 29 / 8; all inside. The `wlm-truth` entries each add a row here; WT-15 closes with a 20-seed
  sweep.
- WT-05 sweep (2026-11-11, remote, Normal, seeds 1–10, WT-04 `ac84d6a` → WT-05 `e90a356`): Midwest 16.5 / 28 / 10,
  Revenue 20 / 27 / 10 (both unchanged); Harbourline 9.5 / 29 / 8 → 10 / 29 / 6, inside the bands with expert on the
  60 % edge. Seeds 7 and 9 freeze on D29 with the ladder at FC; the 6-interval skip clock is the cause (docs/
  docs/archive/wlm-audit-2026-11.md §9.6). User decision: ship, and WT-06 checks those seeds.
- WT-06 sweep (2026-11-12, remote, Normal, seeds 1–10, WT-05 `2f614b5` → WT-06 `a0904ec`): Revenue 20 / 27 / 10
  (unchanged); Midwest 16.5 / 28 / 10 → 9.5 / 28 / 10 (MOBILE's goal is looser than its SLA, and the ladder no
  longer over-serves DDF; real behaviour); Harbourline 10 / 29 / 6 → 10.5 / 30.5 / 7 (seed 9 back; seed 7 lost to
  W7, WT-10's note). All inside the CI gate's bands (`tools/ci/balanceGate.ts`; do-nothing 8–22). Midwest do-nothing
  is below SPEC §16's design target of day 12–18 and moved 7 days against the ±3 WT-06 expected; user decision
  (2026-11-12): accepted, no change to the ladder or the band.
- WT-07 sweep (2026-11-12, remote, Normal, seeds 1–10, `6c00eca`): Midwest 9.5 / 28 / 10 and Revenue 20 / 27 / 10
  (unchanged); Harbourline 10.5 / 30.5 / 7 → 10 / 30.5 / 7 (textbook 1 victory). Inside the CI gate's bands; Midwest
  do-nothing stays below the design target.
- WT-08 sweep (2026-11-12, draft #316 `e4902b7`, Normal, seeds 1–10): Midwest 16.5 / 28 / 10,
  Harbourline 10.5 / 30.5 / 7 (textbook 1 victory), Revenue 20.5 / 27 / 10. All inside the CI bands; Midwest
  do-nothing improves seven days versus WT-07, outside the expected small change, and returns to its pre-WT-06 16.5,
  inside SPEC §16's day 12–18 design target. The review-fix sweeps match `111cce1`'s preliminary medians/victories.
  User decision (2026-11-12): accepted, no balance entry. Coefficients were not tuned to recover the old outcomes.
  Final head after the last review fixes (`9122490`, remote, Normal, seeds 1–10): Midwest 16.5 / 28 / 10, Harbourline
  10 / 30.5 / 7 (textbook 1 victory), Revenue 20.5 / 27 / 10; all inside the bands
  ([Midwest](https://github.com/piconaut/goal-mode/actions/runs/43241910317),
  [Harbourline](https://github.com/piconaut/goal-mode/actions/runs/43241910407),
  [Revenue](https://github.com/piconaut/goal-mode/actions/runs/43241910326)).
  After the design-review planner fix (`d9617a4`, remote, Normal, seeds 1–10): Midwest 16.5 / 28 / 10, Harbourline
  10.5 / 30 / 7 (textbook 1 victory), Revenue 20.5 / 27 / 10; all inside the bands
  ([Midwest](https://github.com/piconaut/goal-mode/actions/runs/43253180617),
  [Harbourline](https://github.com/piconaut/goal-mode/actions/runs/43253182591),
  [Revenue](https://github.com/piconaut/goal-mode/actions/runs/43253182465)).

- WT-11 (2026-11-13): no shipped policy defines a resource-group minimum. The discretionary minimum correction
  leaves the Midwest/Revenue/Harbourline behaviour comparison unchanged and keeps both required one-day hashes
  unchanged (Midwest `d929cb76fb5328df`, Harbourline `3c6b010e5243936c`). Goldens stay unchanged; no bot sweep is
  needed for this entry (BACKLOG WT-11: no policy uses a minimum). Sources and the local-PI approximation are in
  SPEC §5.5.6 and docs/research.md.

- WT-12 (2026-11-13, before integrating WT-16): no shipped policy gives batch an RT goal; goldens and the
  three-scenario behaviour comparison were unchanged against `020ca0f`. Midwest/Harbourline one-day hashes were
  `d929cb76fb5328df` / `3c6b010e5243936c`.
  No bot sweep is required for this entry (BACKLOG WT-12: bots none); PR evidence records validation.
  After integrating WT-16 from `dev` (`866b322`), the three-scenario comparison is still identical to that base;
  hashes are Midwest `3988113566a9eb83`, Revenue `c7d26e933456fbf8`, Harbourline `3e0a8aa98af79e77`.
  The accepted I13 decision and WT-12's remaining projection-design gap are both retained.

### Playtest round 1 (2026-11-03, expert player, daily challenge 2026-11-03, Midwest Normal, days 1–2)

Player profile: sysperf/capacity team lead at a major bank; played an earlier build to day 8. Checklist:
[docs/playtest-checklist.md](docs/playtest-checklist.md). First incident (D2 23:44–04:12): the player's rule
`JES TN STM* → STCHI` (meant BATCHHI) put the 11-job critical STM fan in the CICS AORs' importance-1 class, so CICS
starved behind batch at its own DP and WLM found no donor. A legitimate player mistake, but the game hid it. All
findings are fixed (details in `3fd1762:PROGRESS.md`) except the finance feedback loop and the full-day tutorial,
which are proposals P1 and P2 above.
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
open findings are BACKLOG.md entries (below).
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

Builds: D1–D4 on `2253b11`, D5 onward on `d8ada51`. Investigation facts are in docs/research.md. Open findings are
BACKLOG.md entries PT-01…PT-24 (source "playtest round 2"); fixed findings and their validation are in the PRs and
in `3fd1762:PROGRESS.md`.
- Checked, realistic: On/Off CoD CPs revert at the start of the revert day and stop billing (D15 save: 9 CPs = 8 + 1
  permanent). DDF enclave CPU counts in PROCU EAppl only (RMF Report Analysis p.189). BATCHPRD "RG-Cap" with no
  resource groups is discretionary goal management. CPU Critical on a region's STC class doesn't protect
  TRANSACTION-managed regions; set it on the transaction class (WLM Planning p.100, p.111). Design note: the MP effect
  is applied as extra CPU per transaction (`slices.ts`), not to the capacity line, unlike SPEC §6's formula.

## Latest maintenance

- 2026-11-15: RT-15 grouping by cause (user decision on Q4; docs/rca-design.md §4.5, A13). Incidents now link to the
  day's earlier incident with the same `truth.cause` (game/run/grouping.ts): a card's victims group across the played
  day whatever mechanisms they show, and a cause with no card (`new:`, `change:`, `none:`) only while the incidents
  overlap or follow within two hours (`GROUP_FOLLOW_HOURS`). A filed RCA is inherited only through the same card; a
  later incident of a filed no-card cause is listed as new, so an RCA filed at 10:00 cannot silently cover four at
  13:00. No group crosses the 06:00 roll (an incident left open there is closed and the new day's continuation is
  written up on its own), which the pre-merge review caught: without it a day-1 incident could point at yesterday's lead
  and never be listed for an RCA. The group's accepted set is the union of its members' and its primary the lead's: `groupAcceptedOf` (scoring,
  the reply and the review) and `alsoAcceptedOf` (the "also accepted" lines) replace the per-incident score, whose
  `scoreRca` wrapper is gone; `rcaGroupOf` reads a group lead-first from any member's id. Cause prefixes (`CAUSE_PREFIX`,
  `fallbackCause`) live beside `truthCause` so writing and parsing cannot drift, and `addGroupedIncident` is the one
  place a new incident takes its `rcaGroup`/inherited `rca` — coalescing the unfiled episodes a retrospective batch
  night bridges, which the post-merge review caught splitting into two rewarded RCAs. Saves written before RT-07 have no cause and keep the labels'
  grouping. R-7 is now one group (MOBILE CPU_PRIORITY and CARDAUTH DEPENDENCY under one cap), R-9's 13:00 campaign
  incidents are separate from the creep's 10:00 RCA, and R-6's night joins the day only when the card reached the
  critical jobs; tests/game/groupingByCause.test.ts covers each, including one through `closeHour`, and
  tests/game/groupedRcaEvidence.test.ts gains the union's scoring and reply order. Scoring-only: goldens
  (bfee79653dfa04fa, 22318c84ac8a4396) and the bench hash are unchanged, so no sweep; `npm run check` is CI's job and
  no `balance` band can move (no bot but oraclerca files, and it reads no score).

- 2026-11-15: RT-14 card footprints (user decision on Q5; docs/rca-design.md §4.4 "As built (RT-14)"). Every card
  that can hurt work declares a `resource` (content/footprint.ts; its `mechanisms` derive from it) and a `reach`. Its
  `affects` stays as the direct set. Running cards resolve their reach each tick to images (and `JOB@LPAR` regions),
  and each hour keeps the union. Cards qualify for direct or collateral work (the work's images, or its servers'
  images or regions, in the reach). They rank direct, then fresh before background (`metWith`), then overlap; ties
  accept both triggers, with the earlier start as primary. Every qualifying card's trigger is accepted, and a
  collateral victim also accepts the fallback. BATCH uses the critical jobs' images. `disturbed` uses the footprint.
  - User decisions this session:
    - POWER_CAP's routed workloads are its direct set (so U-1 is HARDWARE_FAULT).
    - Only a permanent card stops disturbing a baseline once it is background; time-limited cards keep PT-13's rule.
  - Deviation from §4.4's wording: the footprint is three `EventDef` fields, not a `footprint` object. `affects`
    keeps its name so saves and `adapt()` overrides carry on unchanged.
  - The resource lists reproduce the old per-card mechanism lists. The exception is SMF_AUDIT: it was never blamed,
    and now has a `CP_OVERHEAD` footprint on the SMF address spaces (CPU_CAPACITY only, its old list; #359 review N1).
  - A card is background only for work its footprint reached (#359 review N2).
  - User decision 2026-11-15 (#359 review B1): keep footprint-based `disturbed`, so collateral work's baseline also
    freezes while a card reaches it, though it moves mechanisms as well as triggers (1 of 212 in the RT-25 sample).
    Staleness from long, wide cards belongs to RT-17's per-hour baseline. If a playtest shows odd mechanisms first,
    the fallback is to freeze collateral work only for narrow reaches, not sysplex-wide ones.
  - Validator (RT-25 sample: five passive days, seeds 1–5, three scenarios, Normal):
    - gain disagreements fall from 23 to 6 (midwest 0, revenue 0, harbourline 6);
    - footprint-wrong: 0;
    - path effects: RUNAWAY blamed as collateral on CARDS (CPU_PRIORITY) and MKTQRY (CAPPING) at −0.1 and −0.6 pp;
    - noise: four QR_TCB hours where a CP card shows +0.1 to +0.3 pp, under an unmeasured floor.
  - R-3, R-8, R-9 replayed on Midwest 42 day 12:
    - R-8: all three power-cap victims are HARDWARE_FAULT, with CHANGE_REGRESSION also accepted (was CARDAUTH
      CHANGE_REGRESSION alone);
    - R-9: CARDAUTH at 13:00 is DEMAND_SURGE, collateral to the campaign (was POLICY); CARDAUTH at 09:00 and the BATCH
      night take MONITOR_CREEP's trigger;
    - R-3: raises no incident on today's dev (the WLM core moved it), so it is covered by the fixture test instead.
  - Goldens and the bench hash are unchanged (ff6e21b2171a2586).

- 2026-11-15: RT-13 proof recipes (user decision on Q3; docs/rca-design.md §4.6 "As built (RT-13)"). Evidence now
  scores as a proof: `MECHANISM_RECIPES`/`TRIGGER_RECIPES` (two predicates each, symptom then discriminator) judged by
  `game/proof.ts` over the attached pins; a complete recipe for the accepted mechanism earns 3, one predicate 0.5,
  and the accepted trigger's recipe on top makes it strong (+5 Insight). New tier-0 pin `CPU_PER_TXN` (APPL% CP ÷
  END/S, refused on CICS transaction rows, RMF Report Analysis p.524/530/534); cost pins carry their row's rate, so
  one row proves a surge or a regression; `ENDED_RATE` accepts a competitor's row. Decisions: an ended rate's
  baseline is the slot baseline (same interval on earlier days), because the six preceding rows read the morning ramp
  as a 1.7× surge (seed 7); CPU_PRIORITY needs a *displaceable* (less important) consumer; 29 pairs need four pins and cannot
  reach strong evidence (RT-27, blocked: design). Bots attach no pins, so balance cannot move. Built independently
  of PR #356, which implements the same entry, at the user's request.
- 2026-11-12: WT-08 implements atomic policy plans (`buildPlan`): original-base net value, whole-plan receiver
  value, secondary carries, bounded join-and-split repair, six retained moves, and real-projection budget checks
  before every retry. Rejected/uncommitted plans leave live DPs untouched. Receiver stages advance until blocked;
  a safe donor opens another receiver stage. Traces and statistics distinguish proposals, plans, retained steps
  and net rank reversals; canonical stored DP targets with split anchors address PR-14. WT-08 remains open in
  BACKLOG while draft #316 is validated and the unmet historical criteria and scenario changes are settled.
  Audit, sweep and review results are recorded in docs/archive/wlm-audit-2026-11.md §9.9 and M8.2 when complete.

- 2026-11-12: WT-08 draft review fixes (`e4902b7`): aggregate NO_NET_VALUE names its largest equal-harm blocker;
  safe partial failures retain a player clue; new skip clocks log that clue off cadence; player explanations and
  inspect show complete plans. Full local check and CI pass 1 017 tests/90 files. Adversarial review found two
  convergence-test parsers that could miss live reversals; both now use committed ladder ordering, with explicit
  counterexamples. Final-head audit: plans 19/28/66, projections 1 093/3 318/2 814, reversals 1/3/10 (zero within
  two minutes), episodes 1/3/2. S-1 raw harm share 45.5% and S-3 reversals remain above their targets. RT-06:
  online incidents 2/2/13 → 0/2/15; S-3 adds two CARDS QR_TCB/POLICY misses, common causes/agreements unchanged.
  Midwest's survival shift, shadow-IT's adaptive MOBILE improvement and the longer capped ONLHI OTHER episode
  remain acceptance questions. No coefficient or happy-donor restriction was introduced to hide them.

- 2026-11-12: WT-08 accepted (user decision after the #316 review): the legal happy-donor plans, the scenario and
  balance changes (Midwest do-nothing 9.5 → 16.5, back inside SPEC §16's target; online incidents 2/2/13 → 0/2/15;
  the shadow-IT card can help MOBILE under adaptive WLM), and the two unmet Done-when criteria with restated
  targets (docs/archive/wlm-audit-2026-11.md §9.9). The capped-PROD1 ONLHI OTHER episode is WT-10's; its test now bounds it.
  Last review fixes: a plan's raise may no longer undo what its retained moves bought, and an unchanged skip-clock
  clue is logged at most every five minutes (seed 42 day 1: 105/66/25 → 33/40/20 lines on Midwest/Revenue/
  Harbourline).

- 2026-11-12: design review of WT-04 … WT-08 by the design's author (docs/archive/wlm-audit-2026-11.md §9.9). Fixed on #316: the
  planner now assesses the place above the next level when joining it is worse for the receiver (WLM Services p.707,
  code 630); the capped-PROD1 ONLHI episode is back to 30 adjustments, so it is not WT-10's. Criteria restated:
  WT-05 (a regression check by construction, §9.6), WT-08 (harm share dropped; assessed candidates ending in a plan
  must not fall without an explanation; reversals reported against the previous entry). §9.7 corrected: Midwest's
  do-nothing swing rides on W7. User decision: WT-10 goes before WT-09. New WT-16: why joining a level projects much
  worse than staying below it.

- 2026-11-12: WT-10 (managed bottlenecks in turn, W7). Plans are built for CPU and then zIIP delay, largest first,
  each when it is at least 15 % of the managed delay; waits and capping no longer outvote CPU delay (WLM Services
  p.148; SG24-6472-03 p.63–64). A period mostly waiting logs `mostly waiting, CPU delay n %: not WLM-fixable`, also
  where the projection calls it recovering. S-1 … S-3: no candidate is dropped for its waits any more (other
  572 / 4 771 / 5 520 → none; I/O 0 / 0 / 106 → 0 / 0 / 22); plans 19 / 24 / 54 → 21 / 24 / 107; `RECOVERING` grows
  (225 / 1 703 / 5 636 → 646 / 3 431 / 9 608), PR-20 updated to count it. The DDFPRD#1 case on WT-07's state gets an
  accepted CPU plan. Shadow IT slows MOBILE again under adaptive WLM; the RT-06 test fixture moves to Revenue seed 6.
  Harbourline seed 7 does not come back: §9.7's W7 attribution corrected (§9.10).

- 2026-11-13: WT-15 closes the `wlm-truth` core (docs/wlm-design.md status line). Codex: *Policy adjustment* rewritten
  (one receiver, plans of several moves, why "no action"), new *Donors and net value*, *The skip clock*, *Dispatching
  priorities and unbunching*, each checked against WLM Services p.137–139, 145, 147, SG24-6472-03 p.59–60, 65–66 and
  SHARE 2010 session 7777 p.11. `wlm-why` verdict table rewritten for the model as built (the skip clock was "a
  minute", and a fixed freeze bug was still listed). SPEC §5.5.4 gains WT-09's holder guard, §16 lists the
  invariants and their tests, §17's policy adjustment row names holders. New I3 receiver-order property test (the one
  invariant without a named test). Every finding W1 … W14 is marked fixed, settled, open or deferred. Sweep in M8.2.
  - User decision (2026-11-13): W10's discretionary half (WT-11) and W11 (WT-12) stay **open**, not parked: low
    priority but to be done, batch response-time goals especially. WT-15's Done-when listed them unnecessarily;
    WT-15 and the sweep went first. WT-17 is ready.

- 2026-11-13: RT-11, three more pin sources: CICS region storage, PROCU job rows and the WLMGL work-manager states
  (docs/rca-design.md A11).
  - `SOS_MIN`: an AOR's minutes short on storage in the hour, from the SMF 110 region storage view; THREAD_LIMIT and
    STORAGE, with APPLICATION_ERROR as a trigger; notable 1 minute; a `server` clue (the row names the region, and
    only a region serving the work matches it). Measured: 0 min on every normal day; CICS_SOS (the PROD2 AOR leak)
    puts 35+ min in the hour.
  - `JOB_APPL`: one address space's EAppl % CP from Monitor III PROCU; CPU_CAPACITY and CPU_PRIORITY with
    RUNAWAY_WORK; notable 25 % of an engine; the work's `server` when the jobname is one of its serving AORs,
    otherwise a specific `competitor` on an image it runs on. Measured: MONAGENT 10–14 % normal, CICSXLOG 90 %
    (XLOG_LOOP) and MONAGENT 30–37 % (MONITOR_CREEP; the decayed Monitor III window reads about 30 % an hour after
    the card starts and settles in the low-to-mid 30s, seeds 1–5), so the 25 % line is cleared by 5–12 points — the
    ~120 % first quoted here was the card's pre-dispatch intent (0.03 engines ×12), not the EAppl the report and the
    pin show.
  - `WM_LOCK` and `WM_READY`: the transaction class's LOCK and READY shares of RMF's STATE SAMPLES BREAKDOWN, read by
    the same `workManagerStatePct` helper the WLMGL report and Monitor III's SYSWKM panel print with (one formula, no
    drift). LOCK_CONTENTION for
    LOCK; CPU_PRIORITY, CPU_CAPACITY and QR_TCB for READY at half weight, because READY estimates QR dispatch waits.
    Lines: LOCK 35 % (normal maxima 27.9 / 22.5 / 34.5 % on midwest/revenue/harbourline; LOCK_ESCALATION 39–54 %);
    READY 5 % with 2× the row's own baseline (midwest and revenue normal maxima 2.5 / 1.3 %; QR_RELEASE 6–13 % on
    PROD1 — but harbourline's own READY runs to 85 %, so that row needs its baseline, and recipes (RT-13) are where
    this weak half-weight clue is really sorted out).
  - CLI `pin CICS <hour> <AOR> SOS_MIN` and `pin PROCU <system> <jobname>` (with `--at`), plus the pin buttons on the
    SMF storage rows, PROCU job rows and the Workload Activity metric list.
  - Not done: EDSA peak against EDSALIM stays a displayed fact without a metric, and a past PROCU pin needs the
    browser, whose history keeps the full Monitor III view; the CLI's trimmed history has no job rows (as for
    SYSWKM).

- 2026-11-13: RT-10, the CF Activity and DASD Activity rows are pin sources (docs/rca-design.md §4.6, A11). Five new
  metrics, all `server` clues for the infrastructure the work's Db2 and I/O wait on: `CF_SYNC` (a CF's sync service
  time, µs; CF_SERVICE, HARDWARE_FAULT), `CF_ASYNC_PCT` (its async conversion, %; CF_SERVICE), and `DASD_DISC`
  (DISC, ms; IO, HARDWARE_FAULT), `DASD_IOSQ` (ms; IO, DEMAND_SURGE and BATCH_OVERLAP) and `DASD_RESP` (response,
  ms; IO) per LCU, with DISC also on the ALL VOLUMES row. Pinned from the RMF CF/DASD interval (`pin CF <cf> …`,
  `pin DASD <LCU|ALL> …`, and the pin forms on those two report tabs), sized with the row's own baseline where the
  report has six earlier intervals.
  - New `notableMultiple` in `content/evidence.ts`: the two CF metrics and three DASD ones must clear a multiple
    (2×) of the row's own recent baseline as well as the absolute line. One line cannot serve rows whose healthy
    scale differs: CF02 runs on a weak shared ICF engine at 1.4 ms sync service, so without the second line a
    normal CF02 row would count for every CF incident. Measured day-0 norms (midwest, revenue, harbourline): sync
    17–23 µs (CF02 1368), async 0 % (CF02 98), DISC 0.07 ms, LCU IOSQ 0 ms, response 0.22–0.23 ms; the cards take
    CF01 sync to 109 µs with 69 % async (CF_LINK), DISC to 0.37 (DASD_DEGRADED), LCU 21 IOSQ to 21.5 (REORG),
    LCU 30 response to 0.48 (HSM). Lines: 50 µs, 1 %, 0.14 ms, 0.1 ms, 0.44 ms.
  - The DASD Activity LCU summary gains a DISC(ms) column (REPORT text change only): the sim already computed each
    class's DISC, so `LcuResult.discSec` now weights it by the LCU's I/O mix and `RmfInterval.lcus[].discMs`
    carries it. Pins read the same figure, so a pinned value is one the player can see.
  - Not done here: CF_FAILURE's "CF missing from the report" has no metric (A11's residue), and recipes (RT-13) are
    where these look-alikes get separated into pairs.

- 2026-11-13: RT-08, CAPPING is a share of the hour's ticks, not its worst tick (docs/rca-design.md §4.3, A6).
  `accumulateHour` now counts, per image, the ticks in which its CP demand was cut (`HourAcc.cappedTicksByLpar`,
  `cappedFrac > 0`), and `cappedForHour` calls the hour capped when that count is at least `CAPPING.minHourShare`
  (5 %, in `content/incidents.ts`) of the hour's ticks, so one tick in which 6 % of demand was cut no longer decides
  it. Both readers of the old threshold use the helper: `mechanismOf`'s CPU split and the `DEPENDENCY` server
  starvation test in `game/rcaTruth.ts`. `cappedByLpar` stays: an hour accumulated before RT-08 has no count (a
  save loaded mid-hour), so it keeps its worst-tick reading, and a night that folds in such an hour (`addHour`) keeps
  the worst-tick reading too; otherwise the night sums its hours' ticks, so a night is capped as time. Bench hashes
  unchanged; `npm run compare` identical on all three scenarios except the new field in the hour accumulators
  (game state same with `--drop hour,nightHour`), because a seed-42 day raises no capping verdict either way. Tests:
  one capped tick → CPU split, 18 of 360 ticks (exactly 5 %) and 36 → CAPPING (with 17 not), night tick sums with
  one hour under the line pulling the night under it, the old-hour fallback at both the night and the run level.
  A sweep of the three scenarios is in the PR body.

- 2026-11-13: RT-25, the counterfactual validator revised (user request; docs/rca-design.md §4.8). `inspect blame`
  now ends **every card active in the incident hour**, one at a time, from the opening and closing state (a cap's
  scope grows within the hour; a card may start inside it) instead of only cards whose `affects` names the hurt
  workload. Each card reports its **attainment gain** (the hour with it ended, less as-run) and is a cause when the
  gain clears the **noise floor** measured from red-herring controls (`CP_SPARING`, any card with no declared
  `affects`), whether or not the SLA would then have been met; controls are never causes. The RT-06 verdict stays
  (`causes`, `agrees`), with `gainPct`/`control` per card, `causesGain`/`agreesGain` per incident, and
  `noiseFloor`/`cardsTested`/`withGainCause`/`agreeGain`/`disagreeGain` in `--json`; `--floor <pp>` applies a
  scenario floor measured on a wider sample. Game attribution and the sim are untouched (tooling only;
  `npm run compare` identical, bench hashes unchanged).
  - New baseline (five passive days, seeds 1–5 of the three scenarios, Normal; 205 online incidents, 7 batch nights
    skipped, 0 not reproduced, 0 failed): **midwest** 17 incidents, 5 with a card active, 5 cards tested, RT-06 5
    with a met cause (1 agree, 4 disagree), RT-25 5 with a gain cause (1, 4); **revenue** 9, 8, 8, 8 (6, 2), 8
    (6, 2); **harbourline** 179, 31, 31, 8 (23, 8), 23 (14, 17). Total: 21 incidents with a met cause against 36
    with a gain cause — the 15 extra are the joint causes the binary verdict called bystanders — and 23 gain
    disagreements (13 CAPPING/POLICY, 6 CPU_PRIORITY/POLICY, 4 QR_TCB/POLICY, 3 CPU_CAPACITY/POLICY), all with no
    card blamed by the game.
  - RT-14's material is those disagreements: Harbourline's MARKET_OPEN_SURGE on CAPPING hours (CARDS 27.0, MOBILE
    23.6, RETAIL 22.1, PAYMENTS 13.6 pp in seed 4; 7.0/11.0/26.1/6.9 in seed 3) and small RUNAWAY gains (0.0–1.6 pp)
    on QR_TCB and CPU_PRIORITY hours; Midwest seed 2's REGRESSION taking 41.4 (TELLER), 52.6 (MOBILE), 60.3
    (CARDAUTH) and 100.0 (PAYMQ) pp off CPU hours it does not declare; Revenue's EFILE_REGRESSION (23.5) and
    FILE_EARLY_CAMPAIGN (11.6) on EMPLOYER. The near-zero entries show why a calibrated floor matters.
  - The floor is **unmeasured** in that sample: 0 control cards in 195 passive days. The only card with no declared
    work that can run before day 8 is CP_SPARING (six minutes); its three appearances in the 15 runs overlapped no
    incident hour, and HIRING_FREEZE (day 8), GREEN_IT_COD (8), VENDOR_PRICE/SMF_AUDIT (10) and AUDIT_UNCLASSIFIED
    (12) are outside a five-day run. The tool reports the count and marks the gains uncalibrated; a measured floor
    needs longer runs (or hundreds of seeds), which RT-14's refresh should do before reading small gains as causes.

- 2026-11-13: RT-25 filed (user request, after reviewing what RT-06 has found): the counterfactual validator ends
  every active card, reports attainment gain against a noise floor from red-herring cards, and gives RT-14 a fixed
  baseline; RT-14 is blocked on it. RT-14 tests footprints on built fixtures (seed incidents move with WLM changes)
  and counts only footprint-wrong validator disagreements, not path effects. WT-16: a fix in the backlog boost
  replaces both backlog guards.

- 2026-11-13: WT-09 (server periods, W3; docs/archive/wlm-audit-2026-11.md §9.12). The server period `$SRMS001` holds the DP of an
  image's TRANSACTION regions and CICS transactions. The served classes are its goal receivers and donors (one donor
  per server period), they report its DP (the free ride), and the log names it: `RCVR=ONLMED#1 (regions $SRMS001)`.
  A region class with only server regions is neither receiver nor donor. REGION/BOTH are unchanged, an open gap:
  served classes there keep their own DPs (not a player lever).
  - New guard: no trial puts a holder below a period that is missing its goal with a backlog the projection
    bounded (`PROJECTION_DISAGREES`). Without it, Revenue cycled six times on D2: the happy server donated below a
    runaway WEBDDF#1 and the CICS work starved.
  - S-1 … S-3: accepted plans 35/24/131 → 35/39/137; futile `NO_RECEIVER_GAIN` 1 652/6 242/10 222 →
    801/882/9 476; projections 6 700/20 624/19 648 → 6 244/13 113/15 437. Quick reversals 1/0/1 → 1/0/4: S-3's are
    market-open churn, and I13's per-scenario 80 % fall is missed by one on S-3 (recorded, not tuned).
  - RT-06 online incidents 0/1/14 → 0/2/16, with every carded incident still agreeing. Revenue's new EMPLOYER
    incident is collateral of the runaway query, for RT-14.
  - Bench flat (back to back: 6.43 → 6.14, 6.40 → 6.48, 12.12 → 12.15 s/day).
  - Realism tests: CCIMP and capped ONLHI compare holders, CICS SOS runs adaptive, and the adaptive shadow-IT test
    measures MOBILE on PROD1 (71.5 → 73.3 ms with the card). The sysplex figure now turns on an unrelated PROD2
    donor episode in the run without the card.
  - BACKLOG: WT-09 deleted; RT-14 and WT-15 ready.
  - User decision (2026-11-13, #324): the adaptive shadow-IT test measured on PROD1 is fine; it replaces the
    sysplex-wide assertion of the 2026-11-12 decision. Review B1 fixed: the region class attaches structurally
    (all members server regions), not only while its regions used CPU. Second review: dispatch placement uses the
    same attachment (an attached importance-5 region class no longer places new importance-5 work at the regions'
    DP), and every all-server region class is attached, not only the first AOR's.
  - User decision (2026-11-13, #324 review M1): S-3's quick reversals 19 → 4 (79 %, one short of I13's per-scenario
    80 %) are accepted, not tuned.

- 2026-11-12: shadow IT slows MOBILE again since WT-10 (111 against 80 ms in the adaptive realism test; WT-08 had
  117.61 → 83.74 ms). User decision: the restored behaviour stands and WT-08's acceptance of the improvement no
  longer applies (docs/archive/wlm-audit-2026-11.md §9.9 note, §9.10).

- 2026-11-12: WT-10 review (#318): the S-3 PRDD reversal within two minutes is three plans in a minute (a happy
  donor at its goal, then a more important receiver's plan that projects it at 25.36, then the donor raised back).
  User decision: accepted; I13 reworded to exclude reversals after another receiver's plan in between projected the
  period past its goal, and `wlm-stats` counts those apart (S-1 … S-3: 0 / 0 / 0, and 0 / 0 / 1 apart). Also fixed:
  a decayed history no longer reports bottleneck NONE (wlm-stats threw), and mostly waiting counts cover every
  outcome whose note says so.

- 2026-11-12: open WLM questions researched. A receiver whose delays are all unmanaged is not a receiver and gets no
  skip clock (SG24-6472-03 p.61, 64; WLM Services p.145): the sim's NOT_FIXABLE matches for capping, and W7 (waits
  outranking managed delay) is WT-10's. The skip clock lasts 3 cycles and since z/OS 1.11 is not honoured when 5 or
  fewer periods miss their goals (Sinram, SHARE 2010 session 7777 p.11, added to `ibm-zos-books` as
  `products/share/115/S7777_WLM_Update.pdf` and to the zos-docs book map): RF-03. Same-priority work is rotated
  (SG24-6472-03 p.66), which `shareByUnits` already models, so WT-16's leads are now demand, unit counts and the
  grant-to-PI step rather than the sharing rule.

- 2026-11-12: queued PR-20 for repeated `NOT_FIXABLE` checks: report those streaks separately from the existing
  `ASSESSED` episodes. WT-05's accepted episode counts measure trial-search retries; the capped-PROD1 example in
  #307 has 30 cheaper candidate checks over five minutes and one periodic no-action log entry. Clock and
  bottleneck policy remain separate model decisions, with the waits/delay question in WT-10.
- 2026-11-12: WT-06, the canonical ladder (docs/wlm-design.md §5.6; archive §9.7): goal periods are an order of levels at
  246, 244, … (unbunching, WLM Services p.139); receivers step one at a time, donors move to the receiver's level or
  just below (SMF 99 codes 530/540/620/635, p.706–707); the z/OS 1.8 DP table (managed 247–203; promotion 253 and the
  resource-group minimum 249 in the reserved range). S-1 … S-3: moves 13/29/49 → 25/26/44, undone within two
  minutes 0 everywhere, projections up 1.5–2×; bench (Harbourline) 1.37 → 1.44 ms/tick. Midwest PROD2 stays on 7–8
  levels through D8. Sweep in M8.2: Midwest do-nothing 16.5 → 9.5 (planted MOBILE goal/SLA gap no longer hidden),
  Harbourline expert 6 → 7. Fixed on the way: the missing-goal rule refused donor moves for a more important period
  that only shared the receiver's level.
- 2026-11-12: investigation tooling from the WT-05 work, committed (tools only; sim untouched): `inspect … wlm-stats`
  `--by-class`, `--episodes`, `--moves`; `npm run bot` `--changes`, `--trace-day`, `--dump` (tools/botTrace.ts) and
  `--tune` (POLICY_ADJUST overrides, tools/tune.ts), passed through `sweep` and `sweep:remote`; `npm run repro`
  builds the audit's S-1 … S-3 play files (and any hands-off run). Used for the Harbourline seed 7/9 ablation.
- 2026-11-11: WT-05, skip clocks, the delay test and a per-interval projection budget (docs/wlm-design.md §5.3,
  §9.6): a receiver whose every trial was rejected is skipped for a minute (WLM Services p.145); a period under 2 %
  managed delay is not assessed (p.144); `RECEIVERS_PER_IMPORTANCE` is replaced by 12 projections per image per
  interval, counted in real projections. S-1 … S-3: candidates assessed 1 358/4 066/4 600 → 251/723/892, moves
  19/26/79 → 13/29/49, undone within two minutes 0/1/4 → 0/1/0, episodes 5/5/11 → 1/2/2 (the rest are hopeless
  receivers re-assessed once a minute as the clock allows, §9.6). S-2 WEBDDF#1 on PROD2 assessed 418 times (2 846
  before WT-04). RT-06 validator: same incidents, triggers and verdicts. Bench (Harbourline) 1.65 → 1.56 ms/tick.
  Sweep in M8.2: Harbourline expert 8 → 6 of 10 (D29 freeze with the ladder at FC, from the skip clock; WT-06 note).
  Fixed on the way: `managedDelayFrac` subtracted waits that `delay` never held, so transaction classes with long
  waits were skipped as `NO_MANAGED_DELAY` (changes Midwest and Revenue; numbers above are after the fix).
  Review fixes (#296): a search the budget stopped resumes next interval at the receiver it stopped on
  (`ScpState.resumeSearch`), so twelve hopeless receivers at six projections each can no longer starve the receivers
  behind them; the delay test counts the goal PI's samples (transaction-server regions out, `srvDelayCap` added); a save from before `srvDelayCap` assumes its server history was all capping, so the test errs toward assessing).
  Neither fires in S-1 … S-3: one-day `compare` against the previous head is identical apart from the new fields.
- 2026-11-11: WT-04, one PI basis (docs/wlm-design.md §5.2–§5.4; archive §9.5): receivers chosen on the management PI,
  trials judged on projected PIs (`base` against `after`) at sustained demand (`src/sim/wlm/projection.ts`); a
  candidate with `base` ≤ 1 is `RECOVERING`; receiver value floor 0.05; a less important receiver never passes more
  important work that is missing its goal. From `proto/wlm-wt04`; the demand uplift and the backlog bound were
  measured apart and both kept. S-1 … S-3 (`wlm-stats`): moves 36/46/117 → 19/26/79, undone within two minutes
  6/6/19 → 0/1/4, `NO_NET_VALUE` 465/291/2 336 → 2/4/0. Bench (paired, Harbourline): about +5 % per tick (1.33 →
  1.40 ms). RT-06 validator: S-1 … S-3 same incidents, triggers and verdicts (hour attainment only); Midwest seed
  2's runaway no longer breaks MOBILE on D2 (on `dev` from 14:00), so the RT-06 tests use seed 3. Sweep in M8.2.
  User request 2026-11-11: WT-04 … WT-09 in one attended session, one PR each, in order.
  Review fixes (#295): the backlog bound hid a runaway on Midwest seed 2, so a receiver whose backlog the bound cut
  and that is measured over 4× its `base` is not raised (`projectionTrustMax`; measured against projecting its whole
  backlog, docs/archive/wlm-audit-2026-11.md §9.5; it rejects 39 % of S-2's and 68 % of S-3's trials, replacing other rejections
  without changing a move: WT-05's skip clock is what cuts those retries); running batch jobs are exact on every
  image and left out of sustained demand; `usedEngines` counts smoothed zIIP use. Seed 2 has no D2 incident now; the RT-06 tests moved to seed 3 (MOBILE, D2 13:00, RUNAWAY@1).

- 2026-11-11: WT-03 (docs only): SPEC §5.4 now says every discretionary period runs at DP 196 and small consumers
  and mean-time-to-wait are not modelled; §5.5.3 describes the sysplex PI as summed accumulators, the PI window as
  one 0.85-per-tick decay (about 67 s) and no small-sample variability for transactions; §5.5.4 lists the three PIs
  in use; §17 gains "PI window" and "Small consumer, mean-time-to-wait" rows. New docs/research.md row for small
  consumers and mean-time-to-wait (WLM Services p.138, SG24-6472 p.66).
- 2026-11-11: PR-12: the `blame` incident replay now stops a logged `advance` only on an abend new since the advance
  began (`stoppedEarly`), like the play CLI and `wlm-stats`; both replays share `replayAdvance` in `tools/inspect.ts`,
  tested with a restart and a re-abend inside one advance. Tooling only; no sim change.
- 2026-11-11: Queued BACKLOG PR-11 to align the RCA design's two-pin example with the evidence metric's accepted
  mechanisms. The correction is scoped as documentation only; proof recipes remain RT-13.
- 2026-11-11: WT-01 `inspect … wlm-stats`: a new `inspect` verb replays a play-CLI file over a range with the WLM
  trace sink installed and prints per system and in total the audit's counters — adjustments, adjustments with no
  candidate, candidates by outcome (assessed / not fixable by bottleneck / budget), trials by verdict, accepted
  moves split receiver-up vs donor-down, rejected trials whose receiver's own-tick PI (the before value the trial was
  judged on) was ≤ 0.9 or null, DP moves reversed by the period's next move, runs of 30 assessments without a
  receiver move, and with `--ladder` each system's DP ladder at a clock time each day (`--json` for scripts).
  `wlmStats` and `statsText` are pure and tested. On the audit's seed-42 Midwest file (D1 06:00 → D3 06:00) it
  reproduces docs/archive/wlm-audit-2026-11.md §1's S-1 column exactly: 69,120 adjustments, 67,101 with no candidate, 1,609
  candidates assessed, 481 not fixable (all OTHER), 5,934 trials, 36 accepted moves, 3,447 MORE_IMPORTANT_HARMED,
  793 rejected with the receiver's own-tick PI ≤ 0.9, 12 reversed moves and 7 episodes. It replays faithfully: a
  logged `advance` stops where the play CLI stopped (a fresh ABEND, the end of a played day) and a log that ends
  before `--to` says so, the DP ladder reads from each counted day's 06:00, range bounds are minute-validated and
  applied at second precision, and `CPU_CRITICAL` trials now record the receiver's before PI (trace only). The
  episode rule matches S-1 but gives 3 (not 4) for Revenue and 22 (not 20) for Harbourline; every other cell
  reproduces, and §1 footnotes the difference rather than guessing the old harness's rule. Tooling only: no sim
  behaviour change (`npm run compare` reports no differences). CLAUDE.md, docs/agents.md, docs/archive/wlm-audit-2026-11.md §1 and
  the `wlm-why` skill list the verb.
- 2026-11-11: RT-12 evidence baselines: moved the six-row lookback into
  `content/evidence.ts` as `EVIDENCE.baselineRows`, with a FICTIONAL note explaining the smoothing choice;
  the value and evidence behavior are unchanged.
- 2026-11-11: RT-12 pin relations (user decision on Q3, docs/rca-design.md §4.6). Every pin now has a relation to the
  incident, derived from the subjects recorded when it opened: `self` (the work's own class or period, its Db2/CICS
  accounting, its batch night), `server` (a `SYSWKM` row matching a serving region by jobname and image, or a region
  class), `host` (an incident image, or the CPC one of them sits on) or `competitor` (another class the definition
  knows, and only from an image the work runs on: a `*PLEX` roll-up cannot say where it ran). `IncidentSubjects`
  gained `serverClasses`, so a region's class row is the server's and not the work's own. `EVIDENCE_METRICS` replaced
  `anySubject`/`cpcSubject` with `relations`, and the judge rejects a pin whose relation the metric does not accept,
  before it looks at size or mechanism. R-16's residual is closed: TSO#1's CPU delay on a MOBILE image scores 0
  (another class's delay) while its `APPL` share is still the half-weight competitor clue, and a competitor's `*PLEX`
  row is rejected with its own reason. A class row in any relation must name an image the work runs on or `*PLEX`,
  so the mirror of A9 (the work's own class on an image it never ran on) does not count either, and a competitor is
  recognised from the row's shape rather than the live definition, so an `ACTIVATE_POLICY` cannot change a frozen
  row's verdict. Pins also store a `baseline` where a report gives one (median of the same row's six preceding
  report intervals or closed SMF hours; 1 for the `CPU_VS_BASE` ratio), for RT-13's "normal" predicates; Monitor III
  pins carry none because that view normalises APPL and ended/s differently. No truth label, sim behaviour or bot
  label changed: Midwest bench hash still `bde6d147471ece9f`, and the run-state golden is unchanged because the
  golden run opens no incidents. 913 tests pass.
- 2026-11-11: RT-07 accepted answer sets (user decision on Q1, docs/rca-design.md §4.1). `truth` now carries
  `accepted { mechanisms, triggers }` — always including the primary — with one line of reasoning per alternate
  (`notes`), and `cause` for RT-15's grouping. `scoreRca` and the evidence gate read membership, so a defensible
  reading earns the same as the primary; the post-RCA reply names the primary and lists the rest. Sources are rules,
  not per-incident lists: a card's declared `alsoTriggers`/`alsoMechanisms` (XLOG_LOOP and HSM_RECALL_STORM also
  POLICY, SHADOW_IT also RUNAWAY_WORK, RETRY_STORM and SICK_AOR also APPLICATION_ERROR, CICS_SOS also STORAGE), a
  capacity-lowering card adds CPU_CAPACITY, the §4.3 bands add the other side of the capacity/priority split,
  DEPENDENCY on a server image that was itself short of CPU adds CPU_PRIORITY, and no-card incidents accept GROWTH
  and POLICY together (a card that lowered capacity only widens a CPU-family or DEPENDENCY verdict). Primaries are
  untouched, so bot labels and bands do not move and the sim bench hashes hold; the run-state golden is regenerated
  because it hashes the whole `RunState`, whose incident truth grew. Old saves score the primary alone. The playtest's D12 answer (`CPU_CAPACITY/HARDWARE_FAULT`) now scores 5 on R-7's MOBILE incident.
- 2026-11-10: RT-06 counterfactual validator: `npm run inspect -- <file> blame [--json]` replays each online
  incident's opening hour from the play log, once unchanged and once per card that affects the hurt workload with
  that card ended at the hour start, then compares the card the game's trigger names with the cards whose removal
  met the SLA. Baseline (five passive days, seeds 1–5 of the three scenarios): 202 online incidents, 15 with a card
  to test, 12 counterfactual causes, 12 agree, 3 disagreements — all Harbourline CAPPING hours (seeds 2 and 4) where
  a demand card overlapped but removing it still missed (best 91.1 % against MOBILE's 95 %); 187 incidents had no
  card on the hurt workload, 7 batch nights are out of scope, and 0 hours failed to reproduce. Offline only (an
  hour of sim per card per incident); RT-14 consumes `--json`.
- 2026-11-11: Monitor III CPC view is one partition table (user request). The lower table's busy % had the same
  formula as Logical Util % Total; weight and polarity are on the Change Desk. Its `LPAR_BUSY` pin moved to Logical
  Util % Total and PR/SM delay % (pinned) and capped % joined the partition rows. UI only: the `Mon3Cpc` view model,
  pin requests and RT-05 judging are unchanged. `play mon3`'s CPC section is BACKLOG CL-08.
- 2026-11-10: WT-04 prototyped on branch `proto/wlm-wt04` (no PR, not merged; WT-04 stays
  open): docs/archive/wlm-audit-2026-11.md §9. `npm run check` passes there (851 tests, goldens regenerated); `npm run compare`
  differs in all three scenarios as intended; Midwest seeds 1–5 sweep ends every run on the same day and cause as
  `dev`. The first revision was worse on Revenue (flat projected PIs hide harm); the fix is a rule now in §5.3.
  User decision on §9.4 point 5 (2026-11-10): keep the strict rule (no WLM move for less important work past more
  important work that is missing its goal, also on a capped image). The prototype lives on branch `proto/wlm-wt04`.
- 2026-11-10: WLM policy adjustment audit and target model (design only, PR #265): docs/wlm-design.md, BACKLOG list
  `wlm-truth`, 21 docs/research.md rows. No file under `src/`, `tests/` or `tools/` changed. Repro harness and
  outputs are under `runs/wlm-audit/` (ignored); WT-01 has since turned the harness into `inspect … wlm-stats`.
- 2026-11-10: RT-00: the textbook/expert "obvious" rule (`obviousHourly`, `tools/strategies.ts`) looks up the fix
  by card from a frozen card-id set (RUNAWAY, REGRESSION, XLOG_LOOP, RUNAWAY_COMPLIANCE, EFILE_REGRESSION) instead
  of by the incident's trigger, so RT-09's relabelling can't change the bots' fix choice. One intended bot change
  (user decision 2026-11-10, PR #264): during XLOG_LOOP the bots used to request CANCEL_RUNAWAY, which ends no
  XLOG_LOOP card; they now request its own CANCEL_XLOG (ends the card, costs 1 Regulator trust). Textbook Midwest
  seed 3 splits from day 24 (score 1675 → 1679); seeds 1–2 identical. The entry's "matches the reference exactly"
  goal holds for the sweep medians in M8.2 (unchanged), not run by run. Scripted runs: `npm run compare` shows no
  differences, goldens unchanged.

- 2026-11-09: RCA judging and incident truth audited end to end (design only; no sim or game code changed, goldens
  unchanged). [docs/rca-design.md](docs/rca-design.md) has the truth inventory for all 27 Midwest cards, the
  Harbourline and Revenue cards and the scenario flaws, fourteen rule findings with repros (replays on Midwest,
  Harbourline and Revenue seed 42 with cards injected as `tests/game/power-cap.test.ts` does, plus direct calls to
  `triggerOf`/`mechanismOf`/`judgeEvidence`), a proposed truth model and a D1 draft. BACKLOG list `rca-truth`
  (RT-01 … RT-24, numbered in dependency order, gated with the new `blocked: after <ID>` status) and RF-02. User
  decisions 2026-11-10: Q1 (no family credit), Q2, Q3 (tier-0/1 recipe paths), Q4 (card causes group across the
  day; after footprints), Q5 yes; Q6 deferred; Q8 split; Q10 moved earlier as RT-06. Why a separate list: pick order
  ignores "After" notes, and the list finishing marks the playtest checkpoint. Ledger: two Db2 rows (the wait for
  a thread at MAXDBAT is not traced; QDSTQDBT via `-DISPLAY DDF DETAIL`), and the WLMGL CAP-delay row now says the
  report matches. Next: `/dev-loop rca-truth`.
- 2026-11-09: PT-06: RMF and Monitor III report IIPCP only where a zIIP is defined to the image (online or
  reserved; *Init & Tuning* 3.1 p.431, p.434 with PROJECTCPU default NO). On an image with none (Midwest DEVT/SYSP,
  harbourline DEV1) the eligible time on CPs stays plain CP work: `reportedTicks` folds it into APPL% CP and IIPCP
  is 0, so Monitor III's CP/IIPCP split and the RMF/SMF 72.3 rows agree. PROD2's reserved-only zIIP keeps IIPCP.
  Reporting only: `npm run compare -- --drop iipcpReported` leaves sim state, game state and the run log identical;
  the goldens are regenerated for the report values and the per-image `iipcpReported` fact.
- 2026-11-09: PT-04: a power cap's workload scope (`affects`) is re-resolved from the effective routing every tick
  while it runs, and each hour keeps the union of the scopes seen in it: work routed onto a capped CPC (or added)
  during the hour is attributed for that hour, and work moved off it loses the cap from the next hour, so remediation
  during the hour (including on its last tick) does not erase its trigger. The CPC set is kept on the event as
  `capacityCpcs` and the union's hour as `affectsHour`; the last hour's scope survives expiry. `npm run compare`
  shows no differences on the scripted runs and the goldens are unchanged.
- 2026-11-09: PT-13: SMF 101/110 "vs base" is frozen per closed hour (`cpuVsBase` on `SmfHour`) against the
  baseline in force during that hour, so a past row no longer moves with the EWMA; the baseline learns only from
  closed hours in which no card affected the workload, so a regression is not absorbed as the new normal. The Db2
  Whisperer tip now comes from "DBA team (Db2 Whisperer)". Scripted runs' run log and sim state are unchanged; game
  state differs only by the new frozen field (`compare --drop smfHours`: no differences).
- 2026-11-09: PT-09: a fix planned from a forewarning no longer goes to waste when the card starts after 06:00.
  A fix that finds no active target but whose card the player can see (inbox forewarning or revealed rumour) and
  that starts later that day is stored as `armedEvents` on the applied change; the card's begin and end apply in
  the same tick when it starts, and the log names the armed change. A guessed fix on an unseen card is still
  charged with "no active event matched this fix", so the Change Desk cannot be probed. The ZIIP-loss clue now
  says a later redeploy can bring the COBOL versions back.
- 2026-11-09: PT-05: the WLM activity log names a rejected move and its reason ("ONLCARD#1 DP F4→F6 rejected: harms
  DDFMOB#1, equal importance") on that receiver's own line, and WLMGL/SYSWKM mark a CICS region managed to the
  transactions' goals (TRANSACTION mode only; REGION/BOTH manage it to its own class's goal) — the region class's own
  goal is not used (WLM Planning p.120, p.122–123). No decision changes: goldens regenerate for the log text and the
  new interval flag, compare differs only in the log and report text.
- 2026-11-09: PT-03: the CPU_CAPACITY lines moved to `src/content/incidents.ts`; an RCA now says which line the
  incident hour missed ("CPC CPCA averaged 81 % busy, below the 90 % capacity line"), from figures recorded on the
  incident when its truth is decided; a capacity reduction keeps its normal setting and shows a CPU-Activity-style
  `CHANGE REASON=` line on Partition Data (SMF70CCR; SMF70CAI kept for tooling). Scoring and goldens unchanged.
- 2026-11-09: A player change carries only change-desk commands (`CHANGE_DESK_KINDS` in `src/game/catalog.ts`); a
  fix or hardware order can no longer carry commands, and event-only fields (CF degrade, LCU extra I/O, CICS leak)
  plus an over-large hot-skew rebalance are refused at no cost (PT-02).
- 2026-11-09: WLM's projection budget is per importance (`RECEIVERS_PER_IMPORTANCE` in `src/sim/wlm/adjust.ts`), so a
  receiver whose projections find no move of net value no longer keeps lower importances out (PT-01, playtest round 2
  D19: STCMED/STCHI held both importance-1 slots while ONLCARD/ONLRBANK sat at PI 4.0 until 22:30). Goldens
  regenerated for both scripted days; harbourline bench hash and `npm run compare` differ there by design, midwest
  and revenue are unchanged. Balance sweep (Normal Midwest, seeds 1–10): donothing 10/17/22 (median day 16.5),
  textbook 18/28/28 (27.5), expert 40/40/40 (victory every seed); all inside their bands.
- 2026-11-09: Milestone #243 (dev → main) merged. Review notes fixed: CF Activity CONTENTION % marked APPROX (a
  Monitor III CFACT column; the Postprocessor report shows -CONT counts, RMF RA p.373), MSU citation moved to WLM
  Planning p.44, test for `isNewWorkload` on a workload no event or story beat adds. Left open: `setWlmTraceSink`
  is module-level mutable state in `src/sim/wlm/adjust.ts` (inspect-only, decision-neutral).
- 2026-11-10: Added the original WLM design patent (US 5,473,773, IBM, issued 1995) to the `zos-docs`
  skill: ingested `patents/us5473773` into `ibm-zos-books` with text caches, taught `books.py`
  locate/ingest the `patents/` layout, and catalogued it in `references/zos-books.md`.
- 2026-11-06: Added five IBM Redbooks/Redpaper entries to the `zos-docs` catalog after checking their IBM publication pages and PDF title pages; ingested their PDFs and caches with `books.py`.
- Split `src/sim/core/step.ts` (1,458 → 278 lines at #217) into `src/sim/core/tick/`; bench hashes unchanged.
- 2026-11-09: Split `src/sim/wlm/evaluate.ts` (959 → 56 lines) into `src/sim/wlm/eval/` (types, prepare, grants,
  results, accounting, io, paging) with the public surface re-exported; bench hashes on Midwest, Harbourline and
  Revenue and `npm run compare` unchanged. Midwest now builds its topology with the shared `pool()` helper (#246),
  which closes the `cleanup` list.
- Stale remote branches (`claude/*`, `ccr-d83b42c6-*`, Oct 21–29) hold only already squash-merged work; delete
  when convenient.

- Pruned completed milestone checklists, superseded decisions, stale timings, and chronological session logs.
  Pending requirements/questions and current validation remain above; the full pre-prune tracker is recoverable
  from `1d9d5a2:PROGRESS.md` and `git log -p -- PROGRESS.md`.


### WT-07 · Donors by goal achievement and the delayed processor (2026-11-12)

Implemented docs/wlm-design.md §5.5 on merged WT-06 (`b2a9903`): pure `donorOrder` selects goal periods at or
above the receiver, filters smoothed use of CPU (CP + IIPCP) or zIIP, then orders happy periods by lowest worst
local/sysplex PI regardless of importance, followed by the rest from importance 5 up, lowest PI first. Missing
more important periods are excluded. `donorsPerReceiver` (3) joins the existing FICTIONAL tuning parameters.
The existing missing-goal, CPU-protection and projection checks still judge every move. No new persisted state.
IBM sources verified with zos-docs: WLM Services 3.1 pp.138,147,708; SG24-6472-03 (March 2008) pp.59–60;
SG24-7621 p.105. Tests cover I7 trace order, C-2 processor selection, smoothed history and IIPCP, tie order and
I5 (a happy more important donor must not be pushed past its goal). WT-07 deleted from BACKLOG; WT-08 remains
attended and user-gated. Finished on the same branch: a period with no PI yet counts as missing its goal (it was the
happiest donor); fixtures moved for the new order (one realism case: a happy STCHI holding Db2 donates and ONLHI is
briefly wait-bound; the projection sees it but ONLHI's PI is at its 0.5 floor). S-table, R-1 and sweep in docs/archive/wlm-audit-2026-11.md §9.8: moves 25/26/44 → 33/21/47,
nothing undone within two minutes, projections up to 1.7×, bench 1.53 → 1.58 ms per tick; sweep (Normal, seeds 1–10)
Midwest and Revenue unchanged, Harbourline do-nothing 10.5 → 10, all inside the CI gate's bands (M8.2).
Review fixes (#307 comments 6814997986 and 6815514698): a more important period at PI ≤ 1 can no longer be taken
past 1 by a harm under `harmEps` (I5; reviewer's three-period case as a test); one `managementWorstPi` rule for "no
PI counts as missing" in the donor order and the "missing goals are not passed" check; docs say periods, not
holders, until WT-09; the RCA "donors are less important" approximation is noted for RT-16; B5 (sysplex PI first)
is PR-19.
