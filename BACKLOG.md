# BACKLOG.md

The development work that is scoped and ready to pick up, for **GOAL MODE**. Agents implement only from this file
(user request 2026-11-09). Anything else, including PROGRESS.md design directions, proposals awaiting the user,
milestone roadmaps and open questions, is **not** work to start until it has been scoped into an entry here.

## Rules

- **One entry per change.** Each entry is one PR's worth of work. Split it if it isn't.
- **Pick only `status: ready`.** `blocked: <reason>` entries wait for what the reason names:
  - `design`: a design call, by the user or the main agent with the user;
  - `user`: a user decision;
  - `balance`: a balance call, which stays with the main agent (CLAUDE.md);
  - `research`: an IBM-docs answer first;
  - `playtest`: a human playtest first (the entry says after what);
  - `after <ID>[, <ID>…]`: those entries merged first. The PR that fixes an entry sets every entry blocked only on
    `after` it (and nothing else still open) to `ready`, editing the `after` list otherwise.
  Unblocking an entry means rewriting it with the decision and setting it to `ready`, in a PR of its own or in the PR
  that settles the question.
- **Pick order** within a list: high/S, high/M, low/S, low/M, then L. Ties go by ID.
- **Claim by PR.** The PR that implements an entry names it in its body (`Backlog: PT-07`). An entry with an open PR
  naming it is taken. Don't write "in progress" into this file.
- **Remove on fix.** The PR that fixes an entry deletes it from this file, and records anything durable in SPEC §17,
  docs/research.md or PROGRESS.md decisions. A partial fix rewrites the entry to what remains. IDs are never reused.
- **Adding entries.** Each needs: a stable ID with its list's prefix (next free number), list, status, priority
  (`high` | `low`), size (`S` ≤ ~100 lines, `M` ≤ ~400, `L` more), area (`sim` | `game` | `ui` | `content` |
  `tooling`), source, what to change, and "Done when". `sim` entries are model changes: goldens, a "Behaviour change"
  note, a sweep (`npm run sweep:remote`) and the CLAUDE.md realism policy (zos-docs citations) apply. They stay on the
  main agent, not subagents.
- **Lists.** A loop or agent told to work through "the backlog" must be given a list name from the table below. A
  request that names no list, or names something that isn't a list here (e.g. "everything in PROGRESS.md"), isn't
  enough to start on.

| List | Prefix | What goes in it |
| --- | --- | --- |
| `playtest-fixes` | PT | Findings from human and agent playtests: bugs, clue-path gaps, UI and tooling problems |
| `rca-truth` | RT | RCA judging and incident truth, and D1 (docs/rca-design.md) |
| `wlm-truth` | WT | WLM policy adjustment against real WLM (docs/wlm-design.md) |
| `pr-followups` | PR | Non-blocking findings left open by PR reviews |
| `realism-fixes` | RF | Sim model changes queued by docs/research.md rows (sim status "Fix queued") or audit rounds |
| `balance` | BL | Balance tuning: bot bands, scenario difficulty, sweep regressions. Main agent only (CLAUDE.md) |
| `cleanup` | CL | Refactors and tooling tidy-ups with no behaviour change (prove it with `npm run compare`) |

## playtest-fixes

Sources: playtest round 2 (2026-11-04, Midwest Normal seed 467203, builds `2253b11` / `d8ada51`; narrative in
PROGRESS.md) unless stated. Investigation facts are in docs/research.md.

### PT-19 · Inbox change notices are always bad news
`list: playtest-fixes · status: blocked: design · priority: low · size: M · area: content`

By D26 the player rolls back any announced change on sight (Db2 REBIND, monitoring agent). Add changes that help
(better access path, cheaper agent) so impact has to be judged. Needs a design call: which changes, how often, and how
the player tells good from bad (SPEC §9 clue rules). Related: under D1 (RT-24) a rollback needs proof that the change
made work cost more (docs/rca-design.md §4.6, §5.1), which removes the "roll back on sight" habit; the regression
recipe is the "tell good from bad" mechanism. Decide with RT-24.

### PT-20 · General-purpose operations instead of per-event ones
`list: playtest-fixes · status: blocked: design · priority: low · size: L · area: game`

Add operations for common fixes that aren't tied to one event, and generalise event-specific ones (e.g. "Recycle CICS
AORs" with a choice of regions). Each event registers a general operation that fixes it, so `endEventByFix` matches on
effect, not on a card-specific fix id. Needs a design call, made together with RT-24 (D1): docs/rca-design.md §5.6
limits which general operations may end a card.

### PT-21 · Starving "Internal" work is free
`list: playtest-fixes · status: blocked: design · priority: low · size: M · area: game`

TSO and ADHOC have stakeholder `Internal` and SLA `NONE`. DEV batch is non-critical with `lockIntensity` 0, so capped or
discretionary work costs nothing (a lever with no cost). Candidates: an Internal trust facet or inbox escalation when
TSO/ADHOC degrade; capped work holding Db2 locks or ENQs (enqueue promotion); sysprog TSO during incidents.

### PT-22 · Pacing and late-game engineer hours
`list: playtest-fixes · status: blocked: design · priority: low · size: M · area: game`

D17: running out of things to spend engineer-hours on. D19: system well tuned, little to do. "Ask if anything could
hit the system" was the only good late use of hours (the player liked it). Options: more projects, late-game sinks,
dynamic difficulty.

### PT-23 · One job class for every batch stream
`list: playtest-fixes · status: blocked: design · priority: low · size: L · area: game`

All Midwest production streams are class A, so non-Db2 BKP and HSK can't go to SYSP (cheaper under TFP) without the Db2
streams. Player proposal: finer job classes (Db2 production, non-Db2 utilities, reports), each with initiators per
LPAR, reclassing via a Change Desk JCL change with lead time and a small failure risk. Information in tiers: SMF 30
class and program; inbox answers per stream; the batch analysis unlock shows the network. SCHENV later.

### PT-24 · Grade S (100) felt generous
`list: playtest-fixes · status: blocked: balance · priority: low · size: S · area: game`

The player doubted it. Check the grade's inputs and caps against sweep results; the call is the main agent's. Wait
for RT-13: recipe scoring raises RCA scores, which feed the grade.

### PT-48 · Play CLI pins: CF and DASD interval ids, PROCU history, pin labels
`list: playtest-fixes · status: ready · priority: high · size: S · area: tooling`

Source: agent playtest 2026-11-21 (runs not committed). `tools/playCore.ts` `pin` turns the interval id the CLI
shows into an interval index for WLMGL and CPC only, so `pin CF CF02 CF_SYNC 678` passes 678 as an index and fails
"No such CF Activity row" although `report CF 678` shows CF02; `pin DASD … <id>` has the same bug. Without an id a CF
or DASD pin reads the latest interval, not the incident's: say so in the pin's reply. Also: a pin's label shows the
interval end ("D1 12:30" for 12:00–12:30); label it with the interval's range as `report` does. Reported, not yet
confirmed: `pin PROCU --at` refused a past range (Revenue seed 23 D8). Done when: CF and DASD pins by interval id are
tested in the play CLI tests, labels match `report`, and the PROCU report is confirmed or fixed.

### PT-49 · Business-calendar facts and application owners are Midwest's in every scenario
`list: playtest-fixes · status: ready · priority: low · size: S · area: content`

Source: agent playtest 2026-11-21, Revenue seed 23. `src/content/inquiries.ts` `CALENDAR_FACTS` ("Payday is the 15th:
… mostly from their phones") and `APP_OWNERS` (Midwest workloads only) are not per scenario, so the revenue agency's
CALENDAR reply talks about bank paydays, and `ask APP_ENTRY ANALYTICS` falls back to "the ANALYTICS owner" (it gave no
reply within 17 h; check whether that is the 20 % don't-know or a bug). Move both into the scenario content for
Midwest, Revenue and Harbourline. Done when: each scenario's CALENDAR and APP_ENTRY replies use its own facts and
owners, with a test per scenario.

## rca-truth

RCA judging and incident truth: the work that makes RCA verdicts fair and evidence discriminating, ending in design
direction D1. Source for every entry: the RCA audit of 2026-11-09, [docs/rca-design.md](docs/rca-design.md) (finding
and repro ids A-n, R-n, U-n are its); the user's decisions on its §7 are recorded there. Entries are numbered in
dependency order, and `blocked: after …` holds an entry until the entries it names are merged (Rules).
- **RT-00 … RT-15 have landed**, RT-15 (grouping by cause) last. An agent playtest of four 8-day runs (2026-11-21)
  confirmed the CPU split and the baselines as the worst remaining judging problems, and the user unblocked RT-16 and
  RT-17 on it (2026-11-21). RT-16 goes first (user, 2026-11-21; docs/rca-design.md §6), split into RT-16, RT-32 and RT-33
  (docs/rt-16-design.md §7, user 2026-11-21), then RT-17; the playtest's
  findings RT-28 … RT-31 follow them. RT-18 … RT-21 still wait for a human playtest. RT-14 (card footprints) landed
  after the `wlm-truth` core (user decision 2026-11-10). RT-22 … RT-24 are D1 and wait for the user.
- Entries that move truth labels (RT-02, RT-09, RT-14 and the `sim` entries) need a three-scenario
  `npm run sweep:remote`, because the strategy bots read `inc.truth` (docs/rca-design.md §4.8). One at a time.
- Interim fixes: RT-20 replaces the `failureMechanism` path; RT-12's relation test has replaced the RT-03 `anySubject`
  image test.

### RT-17 · Healthy baseline per hour of day
`list: rca-truth · status: ready · priority: high · size: M · area: game`

Unblocked by the user 2026-11-21 (docs/rca-design.md §7 Q6: yes for this entry; RT-19 and RT-20 stay parked). Agent
playtest 2026-11-21 evidence: Harbourline seed 37 MKTORD at 318/s and 345/s against 133–204/s in other hours was
judged not ≥ 1.25 × "recent normal" (the daily peaks feed the rolling baseline); RT-18's surge test reads this slot.

One baseline per workload per clock hour (EWMA over days), with the rolling EWMA as fallback until a slot has data;
co-dominant groups (≥ ⅓ of the excess) are accepted; a floor of 10 % of the SLA budget below which no delay group
wins (A6). SMF "vs base" reads the slot. Moves truth mechanisms: sweep. Done when: R-6's and R-15's 20:00
`LOCK_CONTENTION/GROWTH` incidents are no longer lock contention, and PT-13's frozen "vs base" tests still pass.

### RT-28 · A grouped RCA reply says which victim each line is about
`list: rca-truth · status: ready · priority: high · size: S · area: game`

Source: agent playtest 2026-11-21, Midwest seed 11 D8 INC11 (run not committed). The reply's header names the lead's
primary (`CPU_PRIORITY/Change regression`, RBANK), while the explanation comes from the member whose truth matches the
filed mechanism (`src/game/run/rca.ts` `explainInc`: MOBILE, `CPU_CAPACITY`) and reads "MOBILE: … the machine, not the
policy, was short", so the reply seems to contradict itself. The accepted reasons are the union of the members'
(`groupAcceptedOf`) without naming whose they are, so RBANK, the REBIND's direct victim, reads as accepted "as a
neighbour". Harbourline seed 37 D8 INC63 shows the same header/explanation clash. Change: when members' primaries
differ, the header names each distinct primary with its workloads, and every accepted reason names the member it came
from. After RT-32 because RT-32 rewrites `mechanismExplanation`. Done when: a test with a two-member group whose
members have different primaries shows both primaries and per-member reasons, and a single incident's reply is
unchanged (`npm run compare` reporting-only).

### RT-29 · A complete proof for a mechanism the truth does not accept
`list: rca-truth · status: blocked: design (after RT-17) · priority: high · size: M · area: game`

Source: agent playtest 2026-11-21 (runs not committed). Harbourline seed 37 D4 INC35: both THREAD_LIMIT predicates
green (CICS 110 MXT wait 6762 ms/txn, CPU per transaction ×1.01), primary `QR_TCB/POLICY`, reply "THREAD_LIMIT proven,
but it was not the cause, so it earns nothing"; the same MXT-queue symptom was QR_TCB on D3/D4 and CPU_PRIORITY on
D2/D3, and on D1 one hour gave INC1 QR_TCB and INC2 CPU_PRIORITY. Midwest Hard seed 54 D3 INC22: CF02 sync service
1367 µs against CF01's 18 µs with 98 % async conversion was "CF itself slow: ✗", apparently because CF02 has always
been slow (a standing misconfiguration is its own baseline). Part of this is RT-17's (co-dominant groups) and RT-19's
(THREAD_LIMIT credited at the baseline hold time, docs/rca-design.md §4.2(3), A6). Re-run the two repros after RT-17;
what remains needs a design call: accept a mechanism whose complete recipe (including its ruling-out half) holds on the
incident's own rows and window, or keep it at zero with a reply that says which number made the primary win; and
whether "slow" for CF/DASD compares against a peer or a configuration norm rather than the resource's own history.
Done when: the user decides, both repros are tests, and SPEC §10 and §17 say what was decided.

### RT-30 · RCA reply wording: what was accepted, what was proven, and every pin
`list: rca-truth · status: blocked: after RT-28 · priority: high · size: M · area: game`

Source: agent playtest 2026-11-21, all four runs. Changes:
- "Mechanism right" beside "✗ not proven" (Midwest seed 11 INC11; Midwest Hard seed 54 INC27, INC31; Harbourline
  seed 37 INC11, INC63): say "accepted" for
  the answer and "your pins did not prove it" for the recipe.
- An accepted alternate never says it was not the primary: say "accepted (primary: X)".
- Ruling-out predicates read backwards when they fail, e.g. "✗ they failed rather than ran late: CPU or I/O wait
  < 25 %" beside a 61 % pin (Revenue seed 23 INC14, Midwest Hard seed 54 INC31): word each predicate as the fact the pin must show,
  and quote the pin's value when it fails.
- Pins that meet no predicate are left out of the verdict (Midwest seed 11 INC1 PIN2/PIN4, INC11 PIN16; Revenue seed 23
  PIN9, PIN16): list every filed pin with why it did not count (wrong window, wrong subject, value inside normal).
- When a pin meets a line the verdict's hour average does not (Midwest seed 11 INC6: pin CPC 90.1 % for 13:00–13:30, hour average 87.1 %), say that
  the truth reads the clock hour.
After RT-28 (same reply code). Done when: reply snapshots in the play CLI tests cover each case, and the browser RCA
panel shows the same text.

### RT-31 · The time base of the CPU verdict: the clock-hour average, or the intervals in it
`list: rca-truth · status: blocked: design · priority: low · size: M · area: game`

Source: agent playtest 2026-11-21, Midwest seed 11 D2 INC6 (run not committed). A pin of one 30-minute RMF interval
(CPC 90.1 % for 13:00–13:30) met "processor full", while `capacityBasis` (`src/game/sla.ts`) chose the truth from the
clock-hour average of every tick (87.1 %). Every CPU line and every RT-32 band is measured on that average
(docs/rca-design.md A5, §4.3); no section asks whether it should be. CAPPING already reads a share of the hour (capped
in ≥ 5 % of its ticks, RT-08), not its average. Design call: keep the hour average (the SLA is judged per clock hour),
use the worst RMF interval in the hour, or use the share of the hour's ticks over the line, as CAPPING does; and
whether the evidence predicates move to the same time base, so a pin and the truth read the same number. After RT-32,
so the choice applies to its bands. The reply wording half is RT-30's. Done when: the user decides, the INC6 shape
(one interval over the line, the hour below it) is a test, and SPEC §10 and §17 state the time base.

### RT-18 · Fallback triggers that are tested: surge by rate, the player's own change
`list: rca-truth · status: blocked: playtest (docs/rca-design.md §4.4(4)) · priority: low · size: M · area: game`

After RT-14 and RT-17. DEMAND_SURGE without a card when arrivals are ≥ 1.25 × the slot baseline (payday, month-end,
deadline week); POLICY primary, naming the change, when a player change in the last 24 h touched a lever of the
winning mechanism on the judged host; new-work collateral for two days. Thresholds in `content/sla.ts`. Moves truth
triggers: sweep. Done when: a Revenue deadline-week incident is DEMAND_SURGE and R-14/R-15 replies name the change.

### RT-19 · Server CPU starvation and the thread-limit reference
`list: rca-truth · status: blocked: playtest (docs/rca-design.md §4.2(3)) · priority: low · size: M · area: sim`

After RT-17. Split the `dependency` part into `serverCpu` and `serverOther` (reporting-only); region CPU wait joins
the CPU group, other servers' CPU starvation stays DEPENDENCY with the CPU refinement accepted; THREAD_LIMIT is
credited with the queue at the baseline hold time, not the unqueued time (R-15). Sweep (`tunePolicyIncidents` reads
THREAD_LIMIT). Done when: R-15's 20:00 incident is THREAD_LIMIT/POLICY and R-14 is one CAPPING group.
Cross-note (WLM audit 2026-11-10): WT-09 (server periods) and WT-10 (waits are not delays) change the same
per-period split of region CPU wait and other waits; do this entry after them and share one split
(docs/archive/wlm-audit-2026-11.md §7, §8 Q1). WT-10 (landed 2026-11-12) keeps WLM's split in `adjust/delays.ts`: `managedDelays` (CPU,
zIIP, I/O in velocity, storage, queue) and `waitingFrac` (waits over all samples); reuse them.

### RT-20 · Failure-only misses from the failure's source, not from a card
`list: rca-truth · status: blocked: playtest (docs/rca-design.md §4.2(4)) · priority: low · size: M · area: sim`

After RT-01. Record failed transactions by source per workload (slot-queue timeout, region abend, Db2 or MQ
unavailable, backlog timeout; reporting-only) and map them to THREAD_LIMIT, ROUTING, DEPENDENCY and the CPU family;
`failureMechanism` on cards goes away (U-12). Done when: SICK_AOR is ROUTING without the card field and a
MAXCONQW-style DBAT timeout hour is THREAD_LIMIT.

### RT-21 · BATCH incidents under the same rules
`list: rca-truth · status: blocked: playtest (docs/rca-design.md §4.4) · priority: low · size: M · area: game`

After RT-14. Cards whose footprint reaches the critical jobs' images or LCUs during the night qualify;
JOB_FAILURE only when the ABEND's lost time is the largest cause or the job never finished; co-dominant causes
accepted; capping by share of the night (A12). Done when: a DASD_DEGRADED at 22:00 that makes the window miss is
IO/HARDWARE_FAULT.

### RT-22 · Problem records: a diagnosis without an SLA incident
`list: rca-truth · status: blocked: user (decision on docs/rca-design.md §5.1, Q8a) · priority: low · size: L · area: game`

After RT-13. The player opens a problem on a subject and window and files mechanism, trigger and pins; an incident is
a problem the game opened. Needed because REORG_OVERRUN, ZIIP_LOSS, SMF_AUDIT and a roomy-day REGRESSION open no
incident (§5.1). Done when: browser and play CLI can open, file and review one, with tests.

### RT-23 · A discriminator for the retry storm
`list: rca-truth · status: ready · priority: low · size: M · area: sim`

Research settled 2026-11-21 (docs/research.md "Db2 and hardware configuration"): IBM has no retry field, but Db2
accounting (SMF 101, IFCID 3) class 1 counts commits (`QWACCOMM`) and rollbacks (`QWACABRT`, "the number of units
that were backed out": application program abends, rollback requests, deadlocks, operator cancels, thread abends from
resource shortage). With DDF's default `CMTSTAT=INACTIVE` the accounting interval starts at the first SQL statement and
ends at commit or rollback, so `QWACABRT / (QWACCOMM + QWACABRT)` per workload-hour is the documented retry signal for
work that is backed out. Retries that commit at Db2 are indistinguishable in aggregate; telling those apart needs
per-client identity (SMF 101 `QMDAAPPL`/`QMDAPLAT`/`QMDASUFX`, or client statistics IFCID 411/412 and the 2024
IFCID 417, SMF type 102), which the game's SMF 100/101 views do not collect — decided out of scope.
Change: add the rollback count to the DB2 (SMF 101) view and the Db2 statistics view, and make RETRY_STORM back out a
share of its retried transactions (the card is `mod('rate', 'MOBILE', 2.5)` only today, so it would raise arrivals with
no aborts). The rollback share then separates it from DEMAND_SURGE.
Done when: RETRY_STORM and its Revenue/Harbourline variants show a rising rollback share in the DB2 view, a
DEMAND_SURGE of the same rate does not, and tests pin both (R-5, docs/rca-design.md §5.3).

### RT-24 · D1: targeted fixes unlocked by proof
`list: rca-truth · status: blocked: user (decision on docs/rca-design.md §5, Q8b, and PT-20) · priority: low · size: L · area: game`

After RT-13, RT-14, RT-22 (and PT-20's design call, made with this one). Q8 is split (user, 2026-11-10):
Q8a decides problem records (RT-22), Q8b the gating itself, including whether arming a forewarned fix needs proof. Per-card unlock claims and recipes (§5.2) in content;
`visibleFixIds`/`armableEvents` require a filed diagnosis with a complete recipe; costs and limits of §5.4; hint
ladder of §5.5 with difficulty and Mentor; strategy bots diagnose from report data before fixing (§5.7). Balance: a
three-scenario sweep and a re-tune call on the main agent. Start with REGRESSION and XLOG_LOOP. Done when: SPEC §9
and §10 are rewritten for it, the sweep is recorded in PROGRESS.md, and the bands are restored or re-decided.

### RT-27 · Strong evidence for the pairs three pins cannot prove
`list: rca-truth · status: blocked: design · priority: low · size: S · area: game`

Source: RT-13 (`tests/game/proofRecipes.test.ts` `FOUR_PIN_PAIRS`; docs/rca-design.md §4.6 "As built (RT-13)"). (RT-26
is skipped: an open PR for the same entry uses it.) 29 of the 108 mechanism × trigger pairs need four separate facts,
so with `EVIDENCE.perRca` = 3 they earn the mechanism's 3 points but never strong evidence. Those a shipped card can
produce: CPU_CAPACITY, CAPPING and DEPENDENCY × RUNAWAY_WORK (RUNAWAY, SHADOW_IT), CPU_PRIORITY and CAPPING ×
HARDWARE_FAULT (POWER_CAP, CF_LINK, CF_FAILURE), and the CPU family and DEPENDENCY × APPLICATION_ERROR (RETRY_STORM's
alternate, unprovable anyway until RT-23). Options: a fourth pin for strong evidence only; a trigger predicate that a
mechanism pin can also meet where the data honestly shows both; or accept the gap. Done when: the user decides and
the test's list matches the decision.

## wlm-truth

WLM policy adjustment: the work that makes the adjustment loop behave like IBM's description as one model.
**All entries are done** (WT-17, 2026-11-13); new WLM findings go here with the next free number (WT-18). Source
for every entry: the WLM audit of 2026-11-10, now [docs/archive/wlm-audit-2026-11.md](docs/archive/wlm-audit-2026-11.md) (finding
ids W-n, repro ids R-n, S-n, C-n and its section numbers); the model as built and the invariants I-n are in
[docs/wlm-design.md](docs/wlm-design.md). Entries are numbered in dependency order.
- **Sequencing against `rca-truth`** (user decision 2026-11-10, docs/archive/wlm-audit-2026-11.md §7): the core WT-04 … WT-09 and
  WT-10 land after RT-06 (the counterfactual validator) and before RT-14 (card footprints), so footprints and
  balance are built once, on the WLM players will keep. Each of those PRs reports RT-06's validator differences.
- **One at a time.** Each `sim` entry: goldens regenerated with a "Behaviour change" note, `npm run bench` before and
  after (tick budget, SPEC §15), a three-scenario `npm run sweep:remote` (seeds 1–10, Normal) recorded in
  PROGRESS.md M8.2, and the realism policy (cite docs/wlm-design.md §3's pages in code comments).
- **Coupled core:** WT-04 and WT-08 are not to be split or delegated; the main agent implements them. WT-09 is
  cross-layer and stays on the main agent too. The single-rule entries (WT-05, WT-07, WT-10, WT-11) may go to
  the Opus `realism-fixer` subagent, with the main agent reviewing and running the sweep (user decision on §8 Q7,
  2026-11-10; an exception to the rule that `sim` entries stay on the main agent).
- **Attended sessions** (user decision 2026-11-10): WT-04, WT-08 and WT-09 are not for `dev-loop`. Each is done in
  a session the user watches; that session sets the entry to `ready` when it starts. Their `after` dependencies
  still hold. With them gated, `dev-loop rca-truth,wlm-truth` reporting both lists finished means "WT-08's turn"
  (WT-04 landed 2026-11-11), not the playtest cue. User request 2026-11-11: one attended session takes WT-04 …
  WT-09 in order, one PR each, so WT-05 … WT-07 are done there too rather than by `dev-loop`. User decision
  2026-11-12 (after the design review of WT-04 … WT-08): WT-10 goes before WT-09, in the same attended session.
- **Coefficients** go to `src/content/wlm/tuning.ts` `POLICY_ADJUST` with `// FICTIONAL:` notes (names and values
  in docs/wlm-design.md §5.10); approximations get `// APPROX:` (its list). Do not tune a coefficient to move a
  balance band (archive §8 Q2).
- Statistics named in "Done when" are from `inspect … wlm-stats` (WT-01) on seed 42, Normal, no player actions:
  S-1 Midwest days 1–2, S-2 Revenue days 1–3, S-3 Harbourline days 1–3 (baseline numbers in the archive's §1).

## pr-followups

Non-blocking findings from PR reviews. Entries PR-01–PR-10 came from #178–#185 (2026-11-04), each still present
on `dev` at 7fbeffa; later entries name their source.

## realism-fixes

### RF-05 · MSU is counted from total dispatch time, LPAR management included
`list: realism-fixes · status: blocked: balance · priority: low · size: M · area: sim`

Source: cross-report invariant suite (2026-11-14; identity `mon3-sysinfo-cpc`, left-out part). Real RMF computes a
partition's MSU from effective dispatch time: Partition Data `MSU ACT` is the "actual consumption based on the logical
processor effective dispatch time", and Monitor III CPC `MSU Act` likewise (RMF Report Analysis 3.1 p.402, p.98). The
sim's Monitor III CPC `msuAct` already does that, but `LparRuntime.msuRate` (`src/sim/core/tick/dispatch.ts`) is
`deliveredEngines × msuPerCp`, total dispatch time with LPAR management and polarity loss in it, and it feeds the
header MSU, Partition Data MSU AVG, the R4HA, soft capping, the SCRT-style bill and TFP MSU-hours. So one image has
two MSU figures at one moment (Midwest seed 7, 11:20: PROD2 CPC MSU Act 644, header 663, LPAR management 2.9 %).
Change: take `msuRate` from effective dispatch time; keep `deliveredEngines` for LPAR BUSY and physical busy. This
lowers every R4HA and bill by the overhead share, so it is a balance change: goldens, a Behaviour change note and a
three-scenario sweep. Done when: the identity "MSU Act = header MSU = Partition Data MSU AVG at the same time" is
added to `tests/helpers/reportIdentities.ts`, the docs/research.md row says "Matches", SPEC §17 is updated and the
sweep is recorded.

### RF-08 · A capacity group's 4-hour average is on no report, and starts empty when the group is defined
`list: realism-fixes · status: ready · priority: low · size: M · area: sim`

Source: cross-report invariant suite (2026-11-14; identity `soft-cap-flag`, left-out part). Research settled 2026-11-21
(docs/research.md "Resource groups, defined capacity and group capacity"): WLM starts the four-hour window with no usage
at IPL, so the average begins at zero; capacities may exceed the group limit "for the first four hours after an IPL and
for the hours immediately after adding LPARs to a group or changing the group's capacity" (Planning for Sub-Capacity
Pricing PDF p.69 (printed 53)); and a partition that joined less than four hours ago "will have a different view of
unused group capacity and, therefore, might cap differently than existing group members", with RMF flagging its LIMIT
with `*` (RMF Report Analysis PDF p.98 and p.400 (printed 58 and 360)). No page read says whether the combined average
is the sum of the members' own R4HAs — the only such wording found is a vendor's display description — so do not seed a
group window from members' R4HAs. No report prints the group's used average either: Partition Data's `AVAILABLE` is the unused side of it ("If the value is
negative, the group is capped"), so a member's view is about `limit − AVAILABLE`.
Change: give each member its own group-average window, zero-filled at group definition/IPL and at that member's join,
with the group limit check reading the member's window (APPROX: inferred from the documented "different view"; the
arithmetic is not stated); record the join tick and flag the member's LIMIT with `*` for four hours. Show `AVAILABLE`
and the `*` on Partition Data and the Monitor III CPC header, replacing the sim-only group state.
Done when: the suite's `soft-cap-flag` reads the group's state from a report instead of the sim,
`tests/helpers/reportIdentities.ts` covers AVAILABLE and the `*`, and docs/research.md and SPEC §17 are updated.

## balance

Balance calls stay on the main agent (CLAUDE.md "Working process"); a loop may pick these only on the main agent.
Tune after the RT entries that move truth labels have landed (RT-00, RT-02, RT-09, RT-14), because they change what
the strategy bots do (docs/rca-design.md §4.8); tuning before them would be redone.

### BL-01 · Harbourline expert wins 5 of 10
`list: balance · status: ready · priority: low · size: M · area: content`

Release sweep 2026-11-10 (dev `1300e69`, Normal, seeds 1–10): expert 5/10. All five losses are trust losses, mostly
on Markets (seeds 1, 2, 4, 7, 9); seed 4 (day 38) is new against the 6/10 the user accepted. Harbourline is gated
against Midwest's bands for reference only. The user accepted 5/10 for the release. Find why Markets trust runs out
for an expert player (event mix, Markets SLA tightness, the expert bot's blind spots such as never raising Db2 above
CICS) and decide whether to tune content or the bot. Done when: a 20-seed three-bot Harbourline sweep is recorded in
PROGRESS.md M8.2 with the decision, and any content change carries `// FICTIONAL:` notes.
Cross-note: the `wlm-truth` core (WT-04 … WT-09) changes how equal-priority crowding arises (docs/archive/wlm-audit-2026-11.md W2,
§6.2); tuning before WT-09 would be redone (§8 Q2).

### BL-02 · Revenue: do-nothing survives close to textbook
`list: balance · status: ready · priority: low · size: M · area: content`

Release sweep 2026-11-10: do-nothing median day 19 (p10 16, p90 23), textbook 27, expert 10/10. Do-nothing is inside
its 8–22 band (it moved there with #167's G1 retune), but the gap to textbook is 8 days against Midwest's 11 and
Harbourline's 19.5, so diagnosing earns less on Revenue. The textbook PREFILL losses around day 22 (PROGRESS.md
M8.2 follow-ups) belong here too. Decide whether the spread is wanted; if not, tune G1/G2 pressure or the deadline
week. Done when: a 20-seed three-bot Revenue sweep and the decision are recorded in PROGRESS.md M8.2.
Cross-note: as BL-01, tune after WT-09 (docs/archive/wlm-audit-2026-11.md §6.2, §8 Q2).

## cleanup

### CL-19 · One field table for the service-class accumulators
`list: cleanup · status: blocked: design · priority: high · size: M · area: sim`

**Design question (2026-11-18):** `addScp` runs once per period per tick. Should the single field-spec table *generate*
the four accumulator functions as static code at build time (checked by a regeneration test), or should all four use a
table loop, accepting whatever per-tick cost it adds? The entry itself leaves this open ("generate the code, or measure
that a table loop stays within budget"). Recommend generating static code: it keeps the exact object key order that
the golden and bench hashes depend on and leaves the hot path unchanged, at the cost of a generated file in `src/sim/`.
Waiting on the user or main agent's choice before building.

Source: codebase survey (2026-11-16). The fields of the per-period accumulator are listed by hand in four places,
each with the same optional-field quirks (`delayQueue`, `usingIoNoVel`, `srvUsing`, `workManager`):
`addScp` and `mergeAcc` in `src/sim/measure/rmf.ts`, `decayInto` and `addAccInto`/`sumAcc` in
`src/sim/wlm/runtime.ts`. A new report field needs four edits in lockstep (PR-21 adds several). Change: drive all four
from one field-spec table (additive, optional, decayed). `addScp` runs every tick and is written without spreads:
generate the code, or measure that a table loop stays within budget. No behaviour change; label
`perf`. Done when: bench hashes unchanged for Midwest, Harbourline and Revenue; `npm run compare` shows no
difference; per-tick timing before and after (`npm run bench`) in the PR.

### CL-41 · One workflow doc; AGENTS.md keeps only what is Codex-specific
`list: cleanup · status: blocked: needs user-attended session · priority: low · size: M · area: tooling`

Source: codebase survey (2026-11-16). The PR workflow is stated in three places: CLAUDE.md "Working process",
PROGRESS.md "Branch workflow" (about lines 553–582, with the CI gates and the GitHub settings) and AGENTS.md "Branch
workflow", "Reviews" and "Attribution". The "check before you finish" list is restated in `.claude/agents/pr-fixer.md`
and `realism-fixer.md`, and in the `dev-loop` and `audit-loop` skills. Change: `docs/workflow.md` becomes the single
source (branches, PRs, CI gates, GitHub settings, definition of done). CLAUDE.md keeps a short summary and the link;
PROGRESS.md, AGENTS.md, the agents and the skills link to it. Repoint every citation of "PROGRESS.md 'Branch
workflow'": `.github/workflows/ci.yml` line 1, the `audit-loop` skill and CLAUDE.md. The loops match the exact
strings `Automated pr-reviewer report` and `Automated pr-fixer report`, and the `<!-- pr-… -->` markers: keep them
word for word where the loops read them. Done when: each rule is stated once, a grep for "Branch workflow" finds
only the new doc and links to it, and the review header strings are unchanged.
