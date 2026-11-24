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

### PT-50 · A slow TSO costs the team engineer-hours
`list: playtest-fixes · status: ready · priority: low · size: M · area: game`

Source: PT-21 (playtest round 2; design decided 2026-11-23, user). TSO and ADHOC have stakeholder `Internal` and SLA
`NONE`, so capping them or making them discretionary frees CPU at no cost, which breaks the CLAUDE.md guardrail
"every lever needs a cost". The real cost of a slow TSO falls on the people who use it, including the player's own
sysprogs. Change: a game-rule response goal on TSO's first period in each scenario's content (not an SLA, no
incident, no penalty in the SLA score). While its hour attainment misses over a sustained window (a tunable, e.g. two
consecutive clock hours), operations that consume engineer-hours cost more (a `// FICTIONAL:` multiplier in
`content/`), the Change Desk and operation dialogs show the surcharge and why, and the inbox gets one developer
complaint per episode naming the TSO response time. The clue path: RMF WLMGL for the TSO class shows the response time
against the goal. Also a Codex note on why TSO is usually first-period-short and importance-high in real policies.
DEV batch stays free to starve: it runs on DEVT against its own Db2, and parking test jobs is what discretionary is
for. Done when: a test where capping TSO past the window raises the engineer-hour cost and files one inbox item, and
releasing it restores the price; the surcharge shows in the UI with its reason; SPEC (engineer-hours and §9) states
the rule; the strategy bots' sweep (three scenarios) is recorded, since a bot that caps TSO now pays.

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
  after the `wlm-truth` core (user decision 2026-11-10). RT-22 … RT-24 are D1: RT-22 (problem records) is ready after the user's yes to Q8a
  (2026-11-23); RT-24 waits for Q8b.
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

### RT-22 · Problem records: a diagnosis without an SLA incident
`list: rca-truth · status: ready · priority: low · size: L · area: game`

Source: docs/rca-design.md §5.1; user decision 2026-11-23 (§7 Q8a: yes, independent of Q8b). The player opens a
**problem record** on a subject (workload, service class, image or job) and a time window of whole clock hours within
what the reports still hold, and files mechanism, trigger and pins on the same form and judge as an incident RCA; an
incident becomes a problem record the game opened. Needed because REORG_OVERRUN, ZIIP_LOSS, SMF_AUDIT and a
roomy-day REGRESSION open no incident, and because standing faults (RT-35) and quiet regressions are what a good
analyst finds before anything pages. It also gives the late game a skilled use of engineer-hours (PT-22). Without D1
(Q8b open) a problem record unlocks no fix; it earns what a correct RCA earns.
- **Truth for a window:** a card whose footprint (§4.4) touches the subject in the window gives its mechanism and
  trigger, as for an incident; otherwise the §4.2 rules on the window's hours against the slot baseline, plus the
  RT-35 peer rule once it lands. When neither finds anything (no card, no delay group over the floor, no standing
  fault), the truth is "no problem": any filed mechanism is wrong. Pins and recipes are judged as in §4.6, with the
  relation snapshot taken from the subject when the record opens.
- **Reward:** a correct mechanism with its complete recipe earns the trust and insight of a correct RCA, on the
  facet of the subject's workload stakeholder (an image or job subject: the facet of the workloads it hurt in the
  window, or none). **Cost and anti-fishing** as §5.4: 0.25 engineer-hours per filing, a wrong mechanism −0.5 trust
  on that facet once per record per day, at most three filings per record per day, re-filing after one simulated
  hour. These values are §5.4's defaults, in `content/rca.ts` with `// FICTIONAL:` notes; set them by a sweep, not
  by hand.
- **Grouping:** a record whose cause matches an open or closed incident's (§4.5) joins that group and cannot earn
  twice for one cause.
- **Bots:** unchanged in this entry (they file none); the expert bot may file records later, as a balance call.
Done when: the browser and the play CLI can open, file and review a problem record, with tests for each truth case
(a card without an incident, a standing fault, no problem) and for the anti-fishing limits; the RCA reply renders for
a record; SPEC §10 and the Codex describe problem records; a three-scenario `npm run sweep:remote` shows the bands
unchanged (bots file none).

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
