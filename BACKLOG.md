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

## rca-truth

RCA judging and incident truth: the work that makes RCA verdicts fair and evidence discriminating, ending in design
direction D1. Source for every entry: the RCA audit of 2026-11-09, [docs/rca-design.md](docs/rca-design.md) (finding
and repro ids A-n, R-n, U-n are its); the user's decisions on its §7 are recorded there. Entries are numbered in
dependency order, and `blocked: after …` holds an entry until the entries it names are merged (Rules).
- **RT-00 … RT-15 have landed**, RT-15 (grouping by cause) last. An agent playtest of four 8-day runs (2026-11-21)
  confirmed the CPU split and the baselines as the worst remaining judging problems, and the user unblocked RT-16 and
  RT-17 on it (2026-11-21). RT-16 goes first (user, 2026-11-21; docs/rca-design.md §6), split into RT-16, RT-32 and RT-33
  (docs/rt-16-design.md §7, user 2026-11-21), then RT-17; the playtest's
  findings RT-28 … RT-31 follow them; RT-29 was decided 2026-11-23 and split into RT-34 and RT-35. RT-18 … RT-21 still wait for a human playtest. RT-14 (card footprints) landed
  after the `wlm-truth` core (user decision 2026-11-10). RT-22 … RT-24 are D1 and wait for the user.
- Entries that move truth labels (RT-02, RT-09, RT-14 and the `sim` entries) need a three-scenario
  `npm run sweep:remote`, because the strategy bots read `inc.truth` (docs/rca-design.md §4.8). One at a time.
- Interim fixes: RT-20 replaces the `failureMechanism` path; RT-12's relation test has replaced the RT-03 `anySubject`
  image test.

### RT-34 · THREAD_LIMIT's ruling-out half must rule out QR for CICS
`list: rca-truth · status: ready · priority: high · size: S · area: game`

Source: RT-29 (agent playtest 2026-11-21; user decision 2026-11-23, docs/rca-design.md §7 Q11). Harbourline seed 37
D4 INC35: MXT wait 6762 ms/txn and CPU per transaction ×1.01 completed THREAD_LIMIT's recipe while the primary was
`QR_TCB/POLICY`. The second predicate (`content/evidence.ts` `MECHANISM_RECIPES.THREAD_LIMIT`) is an *or* of CPU per
transaction normal, QR wait < 5 ms/txn and job CPU wait low, so CPU per transaction alone passes. That cannot separate
the claim from its nearest look-alike: tasks waiting on a saturated QR TCB hold their MXT slots longer at unchanged
CPU per transaction. Decision: don't widen the accepted set to any completed recipe; fix the recipe. When the symptom
half is met by a CICS slot queue (`MXT_WAIT`, or `SOS_MIN` on a region), the ruling-out half must be `QR_WAIT` below
5 ms/txn on the same work. CPU per transaction stays an option for the DBAT queue and `JOB_CPU` for initiator waits.
The predicate options are an unconditional *or* today, so this needs either a per-option tie (like `sameWork`) or
separate CICS and DBAT recipes; pick whichever keeps the reply readable. Re-run the INC35 shape first: RT-17's slot
baselines may have changed which primary wins, and the recipe fix holds either way. Real THREAD_LIMIT incidents
where the limit is too low for normal hold times remain RT-19's. Done when: a test with an MXT queue behind QR
saturation (CPU per transaction flat, QR wait high) fails THREAD_LIMIT's recipe, and a test with a too-low MXT and QR
wait normal passes it; `tests/game/proofRecipes.test.ts` replays still prove THREAD_LIMIT; the reply names the failed
predicate as "QR wait < 5 ms/txn"; SPEC §10 states the rule.

### RT-35 · A resource far slower than its peers is an accepted mechanism
`list: rca-truth · status: ready · priority: high · size: M · area: game`

Source: RT-29 (agent playtest 2026-11-21; user decision 2026-11-23, docs/rca-design.md §7 Q11). Midwest Hard seed 54
D3 INC22: CF02 sync service time 1367 µs against CF01's 18 µs with 98 % async conversion was "CF itself slow: ✗",
and CF_SERVICE was not accepted. Two causes: the truth ranks mechanisms only by growth against the baseline
(`groupExcess`, `game/sla.ts`), so a standing slowdown has zero excess; and `CF_SYNC`/`CF_ASYNC_PCT` are notable only
past twice the row's own six-interval normal. That conflates mechanism (where the time goes) with trigger (what
changed): a standing misconfiguration is a valid mechanism with a GROWTH or POLICY trigger. Decision: judge "slow"
for CF and DASD against peers as well as own history, and add an accepted-set source; the primary stays the
growth-ranked one, so hints, AIOps, bots and the sim hash do not move.
- **Recipe:** CF_SERVICE's second half also accepts a CF whose sync service time (or async conversion) is at least
  `PEER_SLOW_RATIO` × the best CF of the same sysplex in the same interval; IO's second half accepts an LCU whose
  DISC or response time is at least that × the all-LCU median. A pin carries the peer reading it was judged against
  (frozen at pin time, like `baseline`), so the reply can quote it. Own-history options stay for faults arriving
  mid-day.
- **Truth:** a new row in the §4.1 accepted-set sources: the hurt work's CF (or I/O) time is at least
  `CO_DOMINANT_SHARE` of its response time in the judged hour and its resource meets the peer rule → accept CF_SERVICE
  (or IO). The trigger is unchanged; the reply's reason says "CF02 at 76× CF01's sync service time".
- **Coefficients:** `PEER_SLOW_RATIO` in `content/` with a `// FICTIONAL:` note. Check with the zos-docs skill what
  RMF CF Activity and DASD Activity present as typical sync service time and DISC, and cite them; do not present a
  "normal" figure as IBM's.
Truth labels move (accepted sets only), so the three-scenario `npm run sweep:remote` applies (§4.8 of
docs/rca-design.md). Done when: the INC22 shape (one CF slow since day 1, Db2 missing on CF time) is a test where
CF_SERVICE is accepted and its recipe completes from CF Activity; a CF slow against its peers but carrying under a
third of the response time is not accepted; a DASD equivalent test; SPEC §10 and §17 and docs/rca-design.md §4.1 and
§4.6 updated.

### RT-31 · The time base of the CPU verdict: the clock-hour average, or the intervals in it
`list: rca-truth · status: blocked: design · priority: low · size: M · area: game`

Source: agent playtest 2026-11-21, Midwest seed 11 D2 INC6 (run not committed). A pin of one 30-minute RMF interval
(CPC 90.1 % for 13:00–13:30) met "processor full", while `capacityBasis` (`src/game/sla.ts`) chose the truth from the
clock-hour average of every tick (87.1 %). Every CPU line and every RT-32 band is measured on that average
(docs/rca-design.md A5, §4.3); no section asks whether it should be. CAPPING already reads a share of the hour (capped
in ≥ 5 % of its ticks, RT-08), not its average. Design call: keep the hour average (the SLA is judged per clock hour),
use the worst RMF interval in the hour, or use the share of the hour's ticks over the line, as CAPPING does; and
whether the evidence predicates move to the same time base, so a pin and the truth read the same number. After RT-32,
so the choice applies to its bands. The reply wording half is RT-30's (landed: the reply now says the truth reads the
clock hour). Done when: the user decides, the INC6 shape
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
alternate; RT-23's rollback share now proves the two-pin trigger, so the pair is a card's, not a data gap). Options: a
fourth pin for strong evidence only; a trigger predicate that a mechanism pin can also meet where the data honestly
shows both; or accept the gap. Done when: the user decides and the test's list matches the decision.

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

## balance

Balance calls stay on the main agent (CLAUDE.md "Working process"); a loop may pick these only on the main agent.
Tune after the RT entries that move truth labels have landed (RT-00, RT-02, RT-09, RT-14), because they change what
the strategy bots do (docs/rca-design.md §4.8); tuning before them would be redone.

## cleanup

### CL-19 · A guard test for the service-class accumulator fields
`list: cleanup · status: ready · priority: low · size: S · area: tooling`

Source: codebase survey (2026-11-16); design decided 2026-11-23 (user). The per-period accumulator fields are
handled by hand in four places: `addScp` and `mergeAcc` in `src/sim/measure/rmf.ts`, `decayInto` and
`addAccInto`/`sumAcc` in `src/sim/wlm/runtime.ts`. The original entry proposed driving all four from one field
table, either generated or looped. Declined: the four are not one field list in four layouts. They differ in which
fields they carry (`addScp` has no `srv*`, `demand*`, `rtQueueSumSec`, `ziipEnginesView`), in formulas
(`cpuEngines` is `cpEngines` in `addScp` but `cpEngines + iipcpEngines` in `decayInto`; `ziipEngines` and `demand*`
seed at steady state; `srvDelayCap` has a compatibility fallback) and in presence rules and key order, which the
state hash reads. A table would need a per-field rules language and would put the hashes at risk on the hot path.
The real risk is a new field that misses one of the four functions, and a test catches that. Change, test-only:
- A field list typed with `satisfies Record<keyof Required<ScpAcc>, …>` (and the same for `ScpTick`'s fields), so a
  field added to either interface fails typecheck until it is listed.
- A unit test that fills a tick (and two accumulators) with a distinct non-zero value in every field, runs `addScp`,
  `decayInto`, `mergeAcc` and `sumAcc`, and asserts every listed field reaches each output non-zero, except fields a
  function deliberately omits, each listed with its reason.
No sim change. Done when: the test passes; removing any one field from any of the four functions makes it fail
(checked by hand once, noted in the PR); `npm run typecheck` clean.

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
