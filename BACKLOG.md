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
| `rca-truth` | RT | RCA judging and incident truth (docs/rca-design.md) |
| `wlm-truth` | WT | WLM policy adjustment against real WLM (docs/wlm-design.md) |
| `pr-followups` | PR | Non-blocking findings left open by PR reviews |
| `realism-fixes` | RF | Sim model changes queued by docs/research.md rows (sim status "Fix queued") or audit rounds |
| `balance` | BL | Balance tuning: bot bands, scenario difficulty, sweep regressions. Main agent only (CLAUDE.md) |
| `cleanup` | CL | Refactors and tooling tidy-ups with no behaviour change (prove it with `npm run compare`) |
| `prologue` | PRO | The optional guided prologue, the shadow week (docs/prologue-design.md) |

## playtest-fixes

Sources: playtest round 2 (2026-11-04, Midwest Normal seed 467203, builds `2253b11` / `d8ada51`; narrative in
PROGRESS.md) unless stated. Investigation facts are in docs/research.md.

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

### PT-57 · Operator commands in the play CLI
`list: playtest-fixes · status: ready · priority: high · size: M · area: tooling`

Source: PT-56 review (2026-11-26). The operator commands PT-56 adds (cancel a job or started task, log off a TSO user,
cancel a Db2 thread, terminate a utility, recycle CICS regions, gateway modes, HSM recall hold) are reachable only from
the browser's Change Desk › Operations (game command `OPERATION`). `tools/play.ts` has no command for them, and its
`json` passthrough takes only `PlayCommand`, so the headless player agents (`.claude/agents/goal-mode-*.md`) cannot
use them and agent playtests never exercise PT-56. Add a `PlayCommand` that applies an `Operation` through
`applyGameCommand` (the path the browser and the day trace use), CLI verbs for each operation, and an `ops` listing of
what the player can target now: the same rows as `operationsView` (running jobs and cancellable address spaces, TSO
and DDF thread rosters, active and missed utilities, CICS regions with recycle state, gateway channels and modes,
recall state), with the ids the verbs take. Refusals print the game's message (IEE838I, subsystem servers). Document
the verbs in `docs/agents.md` and the player agent definitions. Not in scope: automatic bot strategy changes. Done when: each
operation can be issued and refused from the CLI, a test applies one of each through `playCore` and matches the
browser path's result, and a short agent playtest log shows a player agent using one.

## rca-truth

RCA judging and incident truth: the work that makes RCA verdicts fair and evidence discriminating. Source for every entry: the RCA audit of 2026-11-09, [docs/rca-design.md](docs/rca-design.md) (finding
and repro ids A-n, R-n, U-n are its); the user's decisions on its §7 are recorded there. Entries are numbered in
dependency order, and `blocked: after …` holds an entry until the entries it names are merged (Rules).
- **RT-00 … RT-15 have landed**, RT-15 (grouping by cause) last. An agent playtest of four 8-day runs (2026-11-21)
  confirmed the CPU split and the baselines as the worst remaining judging problems, and the user unblocked RT-16 and
  RT-17 on it (2026-11-21). RT-16 goes first (user, 2026-11-21; docs/rca-design.md §6), split into RT-16, RT-32 and RT-33
  (docs/rt-16-design.md §7, user 2026-11-21), then RT-17; the playtest's
  findings RT-28 … RT-31 follow them; RT-29 was decided 2026-11-23 and split into RT-34 and RT-35. RT-18 … RT-21 still wait for a human playtest. RT-14 (card footprints) landed
  after the `wlm-truth` core (user decision 2026-11-10). RT-22 (problem records) landed 2026-11-25 and stays; D1's proof gate (RT-24) was dropped (user, 2026-11-26) for PT-20's general operations.
- Entries that move truth labels (RT-02, RT-09, RT-14 and the `sim` entries) need a three-scenario
  `npm run sweep:remote`, because the strategy bots read `inc.truth` (docs/rca-design.md §4.8). One at a time.
- Interim fixes: RT-20 replaces the `failureMechanism` path; RT-12's relation test has replaced the RT-03 `anySubject`
  image test.

### RT-31 · The CPU verdict reads the clock-hour average: test it and say so
`list: rca-truth · status: ready · priority: low · size: S · area: game`

Source: agent playtest 2026-11-21, Midwest seed 11 D2 INC6 (run not committed): a pin of one 30-minute RMF interval
(CPC 90.1 % for 13:00–13:30) met "processor full" while `capacityBasis` (`src/game/sla.ts`) judged the clock-hour
average (87.1 %). Decided 2026-11-23 (user): keep the clock-hour average as the truth's time base. The SLA is judged
per clock hour; the worst RMF interval would let a reporting lever move the verdict (`rmfIntervalMin` is the
player's, and Midwest starts coarse on purpose, F11); a share of ticks over the line is visible in no report (CAPPING
can use a share because WLM% capped is one). The evidence predicates keep reading the pinned row. INC6 itself is
covered by RT-32's bands: a CPU_PRIORITY primary on a host at or above `CPU_BANDS.hostRoomFrac` accepts CPU_CAPACITY
(`game/rcaTruth.ts`). The residue (an interval ≥ 90 % in an hour under 85 %) is explained by RT-30's reply. Done when:
a test of INC6's shape (one RMF interval over the 90 % line, the hour average inside the 85–95 % band, CPU_PRIORITY
primary) shows CPU_CAPACITY accepted and its recipe scoring 3 from the interval pin; SPEC §10 and §17 and
docs/rca-design.md §4.3 state the time base and why.

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

### PR-26 · Report lines for held recalls and gateway modes
`list: pr-followups · status: ready · priority: low · size: S · area: game`

Source: PR #497 review (PT-56). PT-56 asked for report lines for held DFSMShsm recalls and gateway protection
modes; the PR shows both only in Change Desk › Operations (`operationsView`), so a player reading the reports after
the fact can't see why a channel shed work or why batch jobs failed with `HSM RECALL HELD`. Add a line for each to
the day's reports (the gateway mode per channel while enabled, the recall hold and its queued backlog), join a
report identity in `tests/helpers/reportIdentities.ts`, and point the `hsm-recall-hold` and `gateway-protection`
Codex entries at them. Done when: both lines render from sim state, an identity ties each to it, and
`npm run compare` against `dev` shows no sim difference.

## realism-fixes

### RF-10 · Utility drains on the settlement partition ignore online writers
`list: realism-fixes · status: blocked: design · priority: low · size: M · area: sim`

Source: PR #488 review (PT-51, finding N1). A drain prevents new claims in each claim class it drains and waits for
existing claims in those classes to be released; `DRAIN ALL` and `DRAIN WRITERS` both include the write class
([Db2 13 Managing Performance PDF pp.249–250 (printed 229–230)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_perfbook.pdf#page=249)).
The PT-51 model (`startDb2Contention`, `readClaims` in `src/sim/subsys/db2Contention.ts`) waits only for, and blocks
only, the tracked BI readers: the authored writers (`MIDWEST_DB2_CONTENTION.writes`) see no drain wait, and a
writers-only drain is granted at once and affects nothing. Design call needed: whether the Settlement REORG should
delay online postings (an SLA cost the player then has to diagnose) and how long writer claims last.

Done when: an all-class and a writers-only drain wait for and hold off the authored writers' claims, the writers'
SMF 101 drain-lock wait shows it, a realism test covers both kinds, SPEC §17 drops the APPROX note, goldens are
regenerated with a behaviour note and the three-scenario sweep is recorded.

### RF-11 · A runaway entity's CPU should not follow its image's arrival rate
`list: realism-fixes · status: ready · priority: low · size: M · area: sim`

Source: PT-52 (2026-11-26). A card's culprit (RUNAWAY's DDF thread, SHADOW_IT's TSO userids) carries its excess as a
CPU multiplier on its workload on its image (`SimState.entityLoads`), the shape of the workload modifier it replaced.
So the excess rises and falls with the image's arrival rate, and routing the workload off the culprit's image removes
it, though a real runaway thread keeps running where it is. Model a loaded entity as its own constant demand (one
enclave or address space in the workload's last period, at most its engines), sized so the card's average excess over
its usual hours stays about the same. Done when: a realism test shows the excess independent of the arrival rate and
of a routing change, SPEC §17 drops the APPROX note, goldens are regenerated with a behaviour note and the
three-scenario sweep is recorded.

### RF-12 · A stopped Monitor III gatherer leaves holes in its SMF records
`list: realism-fixes · status: blocked: design · priority: low · size: M · area: sim`

Source: PR review of PT-56 (2026-11-26), docs/research.md "RMF". Monitor III writes SMF records too (Monitor I, II and
III write types 70–79), and coupling facility structure detail for the CF Activity report is gathered only on the
master gatherer system, picked among systems whose Monitor III gatherer is active (Data Gatherer User's Guide PDF p.23
(printed 5), PDF p.99 (printed 81), PDF pp.102–103 (printed 84–85)). In the sim, cancelling RMFGAT gaps only the live
Monitor III views; the Postprocessor intervals are untouched. Design first: which RMF intervals the sim should treat as
Monitor III-written (the book's table of record types per monitor is the source), whether the master role moves when
its gatherer stops (not stated in the pages read; check before modelling), and how a partial interval shows. Done when:
cancelling RMFGAT on a system leaves the chosen records short for that interval and system, a realism test shows it,
the report invariants still hold, and SPEC §17 and the ledger row are updated.

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

### CL-64 · One helper for the "card is live" predicate
`list: cleanup · status: ready · priority: low · size: S · area: game`

Source: PR #502 simplify review (2026-11-26). The predicate "started, not ended, and not past its end tick" is spelled
out at four sites: `endEventsByOperation` (`src/game/run/events.ts`), the bot chooser (`tools/botOperations.ts`),
`gatewaySources` (`src/game/operations.ts`, as `!ended && startTick <= tick && …`), and `started && !ended` in
`obviousHourly` and the fixer's on-sight loop (`tools/strategies.ts`), the regulator audit (`src/game/run.ts`) and
`blockedHardware` (`src/game/run/changes.ts`), where the caller runs after `advance` has set `ended`. Add one
`cardLive(event, tick)` helper and use it. Do not fold in `advance`'s local `running()`, which also counts a card whose
`startTick` is this tick before its `started` flag is written; keep that tick-aware case explicit next to the helper.
Leave the different questions alone: `inboxReply` (announced, not started), `activeIn`/`markMet`/`counterfactual`
(window overlap), migration (scheduled today) and the begin/end/recycle triggers.

No behaviour change. Done when: the equivalent sites call the one helper; a test pins a card that starts and another
that ends in the current tick against both the live query and the engine's tick-aware case; `npm run compare --
--base origin/dev` reports no differences and `npm run typecheck` is clean.

## prologue

Source: [docs/prologue-design.md](docs/prologue-design.md) (merged in #490; user decisions in its §14). The prologue
is the optional scenario `midwest-prologue`, on the Midwest plant as is. Hard rule for every entry: no change to
goldens, bench hashes, bots or sweeps. Each PR pastes `npm run compare -- --base origin/dev` and the Midwest and
Harbourline bench hashes, and keeps the prologue out of `SCENARIOS`. Mentor text that states z/OS behaviour follows the
design doc's §12 (an existing SPEC or research.md citation, or a `zos-docs` check).

### PRO-01 · A scenario's calendar can start on another day of the month
`list: prologue · status: ready · priority: high · size: M · area: sim`

`clockAt` hard-wires a run's first Monday to the 3rd of a 30-day month (`src/sim/core/clock.ts`,
`dayOfMonth: ((calendarDay + 2) % 30) + 1`).
- Add `monthDayAtStart?` to the sim `Scenario` (default 3) and pass it to every reader of `dayOfMonth` (arrivals'
  payday and month-end multipliers, the batch network's month-end volumes, `closeMonth` in `tick/control.ts`, the MLC
  month fraction, the game layer's callers).
- Weekday arithmetic is unchanged, so day 0 stays a Monday.
- This is a sim change with no behaviour change: goldens untouched, no "Behaviour change" note, no sweep. Prove it
  with `npm run compare` (exit 0) and the bench hashes.

Done when:
- `npm run compare -- --base origin/dev` reports no difference, and the Midwest and Harbourline bench hashes match the
  base;
- a unit test shows that with 26, day 0 is Monday the 26th, day 3 has the month-end multiplier, day 4's night closes
  the month and writes a bill, and the tick after midnight is Saturday the 1st with the payday multiplier.

### PRO-02 · Prologue engine: scheduled cards, starting state, tutorial state, stop ticks
`list: prologue · status: ready · priority: high · size: L · area: game`

The game-layer engine from design doc §11.1–§11.3 and §11.6, with no content beyond a two-beat test script.
- **Content types:**
  - `GameContent.scheduledCards?` (`{ card, day, at, durationHours?, severity? }`, existing `EventDef`s; a run with
    it draws nothing from the deck);
  - `startingCommands?` (applied at run creation like `startingFixes`);
  - `startingCost?` (a seeded month-to-date `CostState`);
  - `prologue?`.
  All are absent on the three scenarios.
- **Run state and commands:**
  - `RunState.tutor` (`chapter, beat, step, done, hintsUsed, refiles, notes, undoBase`), absent on normal runs;
  - the game commands `TUTOR_NOTE { kind, ref }` and `TUTOR_ACK`, with no sim effect.
- **Steps:**
  - named predicates in `src/game/tutor/predicates.ts`;
  - beats as stop ticks in `advance` (speed set to 0 at the beat; speed isn't sim state);
  - condition beats checked at the existing incident boundaries.
- **Prologue-only rules**, gated on `content.prologue`: one RCA refile; a trust floor with the loss conditions
  disabled; a scripted change failure (the first change in a named beat fails, overriding the roll); the back-out list
  (the end state's configuration against the canonical Day 1 state, one line per difference, fixed order).
- **Registration:** a `PROLOGUE_SCENARIOS` map, not `SCENARIOS`.
- **Chapter start states:** replayed from a reference command log in `tests/fixtures/prologue/`, not stored saves
  (design §6.5, §11.6), so skip, replay and put it back start from them.
- **Headless:** `play new --scenario midwest-prologue` and `play tutor [ack | note <kind> <ref> | hint]`.

Done when:
- compare and bench hashes are unchanged;
- tests cover:
  - the test script's beats stop at their ticks;
  - a scheduled card starts at its tick with its footprint and RCA truth as a drawn card would;
  - `startingCommands` and `startingCost` apply;
  - each prologue-only rule;
  - the back-out list (empty for an unchanged run, one line per changed setting);
  - a chapter start state replays from its command log (the same state hash on two replays);
  - `SCENARIOS` has no prologue entry, and a Midwest run's state has no `tutor` field;
- `docs/tools.md` lists the new `play tutor` commands.

### PRO-03 · Prologue UI shell: mentor panel, spotlight, anchors, date, entry point
`list: prologue · status: blocked: after PRO-02 · priority: high · size: L · area: ui`

Design doc §6 and §11.4.
- **Panel and spotlight:**
  - `src/ui/tutor/` with `MentorPanel.tsx` (bottom right; bottom sheet at phone width; Hint, Next, Skip step;
    minimisable), `Spotlight.tsx` and `anchors.ts`;
  - the spotlight opens the tab and Change Desk section, scrolls to the target and moves focus to it, and never
    blocks clicks.
- **Hints:** the three-rung ladder (nudge, pointer, show me), where show me fills the Change Desk draft without
  submitting it.
- **Top bar:** "Mon 26 · Shadow week" in place of "Day N / 40" while the prologue runs.
- **New-run screen:** "Shadow week with Ruth (recommended, ~70 min)" / "Go straight to Day 1", skip and leave
  controls, and a chapter list after a first finish or skip.
- **Accessibility:** the outline is not colour alone, the panel is an ARIA live region, and no new single-key
  shortcuts.
- **Put it back:** Ruth's offer after a change that breaks the system badly reloads the chapter's start state (a
  reload, not an undo of the sim; design §6.4, §11.4).
- The day-1 corner tutorial (`src/ui/Tutorial.tsx`) stays as it is.

Done when the test script from PRO-02 plays end to end in the browser at desktop and phone width, with no horizontal
page scroll, and a render test asserts each test step's target anchor is on screen in that step's state.

### PRO-04 · Prologue Mon 26 and Tue 27, with the DDFLIMIT flaw
`list: prologue · status: blocked: after PRO-01, PRO-03 · priority: high · size: L · area: content`

Design doc §3.4, §5.1, §5.2.
- **Content:** `src/content/prologue/` (`game-prologue.ts`, `flaw.ts`, `schedule.ts`, `script.ts`, `tuning.ts`), with
  `monthDayAtStart: 26`.
- **The flaw:** BASEPOL plus the DDFLIMIT resource group on DDFPRD, its maximum `// FICTIONAL:`, tuned so that
  Monday's mobile peak runs warm with no SLA breach and Tuesday's scheduled `CAMPAIGN` (11:00) breaks MOBILE while
  PROD2 has room.
- **Beats:** M1–M6 and T1–T6, with their predicates (`ddfCapRelieved`, the ride-it-out route carried into Wednesday's
  briefing) and the draft without the MENTOR perk.
- **Monday we watch:** on Mon 26 the Change Desk's submit buttons say "Monday we watch" while the draft still works
  (design §5.1, §6.4).
- **Codex:** notebook pages for Mon and Tue, and a check that the resource groups entry has its own source.
- **Mentor text:** RCA #1 is written against the truth engine's actual answer and accepted set, not assumed.

Done when, for the two days, tests show:
- **do-nothing:** Monday has no incident and DDFPRD is warm with CAP delay; Tuesday's incident opens in T3's window,
  with the truth and accepted set equal to the script's `expect`;
- **reference:** every step completes, ≥ 2 engineer-hours are left each day, and the policy equals BASEPOL after the
  fix;
- **alternatives:** the cap raised, and ride it out;
- **coverage and anchors** pass for these beats.

### PRO-05 · Prologue Wed 28 and Thu 29: cooling fault, CICS SOS, undo beats, seeded bill
`list: prologue · status: blocked: after PRO-04 · priority: high · size: L · area: content`

Design doc §5.3, §5.4, §8.4.
- **Wednesday:** beats W1–W6 and H1–H5, with `POWER_CAP` at 12:00 and the scripted failure on the first change in
  W4.
- **Thursday:** `CICS_SOS` at 10:00 on the PROD2 AORs, and the Ask around reply scripted for ~09:30.
- **Undo beats:** W5 and H3, each either an emergency change now or a normal change in the next briefing, carried
  into H1 or F1.
- **Ruth's cost-centre tools:** `TOOL_TRIAL` with an expiry when the player is short of Insight.
- **The seeded month-to-date cost state** (`cost.ts`, `// FICTIONAL:`): the 1st–25th with a peak a little below what
  Tuesday's campaign afternoon produces when the cap is removed early and a little above a quiet week (design §8.4),
  under the opex budget.

Done when the do-nothing, reference and alternative playthroughs hold for these days:
- incidents open in their windows, with truth equal to `expect`;
- every alternative fix reaches its undo beat exactly when it should;
- RCA #3's planted DASD pin is judged "not about the work";
- after the reference undos, the LPAR profiles, CICS settings and routing equal their start-of-day values.

### PRO-06 · Prologue Fri 30 and the handover; rewards
`list: prologue · status: blocked: after PRO-05 · priority: high · size: L · area: content`

Design doc §5.5, §8.2, §8.3, §3.2.
- **Friday:** `RUNAWAY` at 09:30 (solo, hint ladder, AIOps hypothesis) and `JOB_ABEND` at ~01:40 with Ruth's alert
  and the automation rule.
- **Ruth's licences (F1, design §8.2):** Capacity planner, What-if, Alerts, Automation and AIOps on for the day on
  her cost centre; every tool bought or trialled that week goes at the handover, so Day 1 starts with 15 Insight and
  nothing bought.
- **The bill (F6):** read from the bill's own data. The peak is set by the week or held by the seed.
- **The handover (F7):**
  - the handover note, with the back-out list and the "never got round to" list naming only F6 and F9 (design §3.2,
    so Story's Day 1 message stays consistent);
  - Ruth's notebook in the Codex;
  - the transition to the new-run screen.
- **Rewards:** 50 career XP once (`src/content/career.ts`), Ruth's terminal (amber theme in `ThemeToggle` and
  `styles.css`, passing the existing contrast checks) and Ruth's pager (an alert sound in `sound.ts`). The two
  cosmetics are viewer preferences unlocked by finishing.

Done when:
- the full five-day reference playthrough ends with an empty back-out list and a bill;
- the reference run joins the cross-report invariants (`tests/sim/report-invariants.test.ts`) as an extra fixture
  (design §11.5);
- the reference run's bill moves or holds the month's peak as design §8.4 says (§11.5);
- the §9 coverage test passes for every tab and section;
- the XP is awarded once;
- a normal run started afterwards is identical to one started without the prologue (state hash at day 0).

### PRO-07 · Prologue playtests and fixes
`list: prologue · status: blocked: after PRO-06 · priority: high · size: M · area: tooling`

- Add an intern persona brief: knows JCL and SDSF, never owned a WLM policy, experience of other platforms.
- Play all five chapters headlessly with it, recording each step where it got lost.
- Run one human playtest with `docs/playtest-checklist.md`, writing it up in `docs/playtests/`.
- File findings as `playtest-fixes` entries. Fix the small ones in this PR.

Done when both playtests are written up, and every finding is fixed or filed.
