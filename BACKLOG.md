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

### PT-08 · No alert for CICS short-on-storage stalls
`list: playtest-fixes · status: ready · priority: low · size: M · area: content`

Response times are for ended transactions only, so PI looking fine while transactions stall is real (RMF Report
Analysis 3.1 p.148; SG24-6472 p.190). The game has no alert on what does show it: ended-rate drop, SOS time, MXT waits.
Done when: an Analytics/automation alert rule for it exists in `src/content/`, with a test and a Codex mention.

### PT-10 · Activate a saved policy now
`list: playtest-fixes · status: ready · priority: low · size: M · area: game`

Saved policies can only be scheduled; real `V WLM,POLICY=` exists. Add "Activate now" (an ordinary activation,
emergency when live) and "Load into editor". Done when: both are in the browser and the play CLI, with tests.

### PT-11 · Hardware orders and On/Off CoD during the live day
`list: playtest-fixes · status: ready · priority: low · size: M · area: game`

Every live change is an emergency (−1.5 trust per stakeholder, fail roll). That includes lead-time items (CP/zIIP/ICF,
4 days) that arrive later anyway, and there's no "plan for tomorrow" while live. CoD costs $9k/day for 3 days per order,
with no early end. Fix: allow plan-for-tomorrow during the live day without the trust cost, or exempt lead-time items;
add "Deactivate CoD" from the next day (check real early deactivation with zos-docs first; if unverified, mark it
APPROX). Done when: implemented with tests; bot sweeps are unaffected (bots don't use emergencies).

### PT-12 · The TFP offer lacks the numbers
`list: playtest-fixes · status: ready · priority: low · size: M · area: ui`

The offer shows baseline $/month, the sub-capacity bill at the peak and overage %. The per-product terms are stripped
from the view, and nothing projects TFP against sub-capacity from history. Add a per-product table (peak MSU and
$/MSU, baseline MSU-hours and $/MSU-hour, MSU-hours used) and a run-rate projection. Done when: the offer shows both,
in the browser and `play finance`.

### PT-14 · Monitor III CPC report: per-type groups
`list: playtest-fixes · status: ready · priority: low · size: M · area: ui`

The browser CPC is missing an *IIP group and PHYSICAL lines (it has *CP and *ICF summary rows); `play mon3 CPC` prints
partition rows only, with no groups at all (RMF Report Analysis p.97–98; check the Monitor III CPC page with zos-docs).
RT-05 (#279) put pins on the CPC view: `CPC_BUSY` on the *CP Physical Total, `CAPACITY_ADJ` under the header table, and
since the single-table layout `LPAR_BUSY` on Logical Util % Total, `PRSM_DELAY` and `CAPPED` on their own columns of the
partition rows. Keep every pin control on the new layout. Done when: the browser and `play mon3 CPC` show the groups.

### PT-15 · Monitor III charts: choose which charts to show, fix CP busy labels, add CPU by service class
`list: playtest-fixes · status: ready · priority: low · size: M · area: ui`

Three changes to the Monitor III charts panel (`src/ui/Mon3Charts.tsx`):
- **Chart picker.** The player chooses which charts to show and which to hide, across **every** chart in the panel:
  PI, CP busy, delay breakdown, PR/SM delay, % capped, response time, arrivals, DDF engines, and the new chart below.
  Use one control in the panel header, like the existing class pickers. Remember the choice per viewer in
  localStorage, the way the panel's open/closed state is (`OPEN_KEY`; `useStored` for the pattern), and survive
  blocked storage. The default is today's set. Hidden charts leave no gap in the layout, including at phone width.
- **CP busy labels.** "CP busy per system" plots % of logical CPs per LPAR but % of physical CPs for the CPC line.
  Relabel it so each line says which it is, and add a "% of CPC" option that plots every LPAR against the CPC's
  physical CPs.
- **CPU by service class.** A new chart of CPU engines per service class (per-class engines are already sampled). It
  is an ordinary chart in the picker, hidden by default.

Done when: each chart can be hidden and shown again, the choice survives a reload (and falls back to the default when
storage is blocked), the CP busy chart says what each line is measured against, and the new chart is in the picker.
UI only: `npm run compare` shows no difference.

### PT-16 · CPC busy forecast ignores weekends and capacity changes
`list: playtest-fixes · status: ready · priority: low · size: S · area: game`

The forecast is a 10-day log-linear fit of daily peak busy as % of installed CPs. Weekends (47 %, 34 %) and added
capacity pull it down. Fit weekdays (or add a weekday term), forecast MSU demand against capacity, and mark capacity
changes. Done when: the fit skips weekends and uses MSU, with a test.

### PT-17 · Browser saves can't be traced into the past
`list: playtest-fixes · status: ready · priority: low · size: M · area: tooling`

`inspect wlm` replays a play-CLI file from seed + log, but a browser save holds only the current state, so a question
about an earlier moment (INC126 D29, asked from the D40 save) can't be answered. Option: keep the live day's
start-of-day state and its commands in the save. Measure the size cost first and put the numbers in the PR.
Done when: `inspect wlm --at` works on a browser save for any time in its current day.

### PT-18 · Imported saves lack Monitor III history
`list: playtest-fixes · status: ready · priority: low · size: M · area: game`

`mon3 --at` on an imported save shows nothing for past ranges. Replay forward to rebuild it, or include the history in
the export. Done when: `play mon3 --at` on an imported save shows earlier ranges of its current day.

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
- **RT-00 … RT-15 have landed**, RT-15 (grouping by cause) last. RT-16 … RT-21 wait for a human playtest: the list
  "finishing" in `dev-loop` (only blocked entries left) is the cue for that playtest. RT-14 (card footprints) landed
  after the `wlm-truth` core (user decision 2026-11-10). RT-22 … RT-24 are D1 and wait for the user.
- Entries that move truth labels (RT-02, RT-09, RT-14 and the `sim` entries) need a three-scenario
  `npm run sweep:remote`, because the strategy bots read `inc.truth` (docs/rca-design.md §4.8). One at a time.
- Interim fixes: RT-20 replaces the `failureMechanism` path; RT-12's relation test has replaced the RT-03 `anySubject`
  image test.

### RT-16 · CPU split on the host of the delay, by displaceable CPU, with bands
`list: rca-truth · status: blocked: playtest (docs/rca-design.md §4.3, Q7) · priority: high · size: L · area: sim`

After RT-08. Reporting-only sim fields for CPU wait per workload per LPAR and CP use by address-space role
(prove with `npm run compare --drop`); judge on the host with the most excess, on the pool that queued (zIIP);
displaceable CP instead of lower-importance CP; bands from `content/incidents.ts`; CAPPING also for a resource-group
maximum on the class or its server, with `DELAY_CAP` as its evidence (RMF Report Analysis p.540); the basis and
`mechanismExplanation` name the judged host (A4–A6). Moves truth mechanisms and `buyCapacityForIncidents`: sweep.
Done when: R-13 is CPU_PRIORITY/POLICY, R-2's basis names PROD2, U-9 … U-11 are tests, SPEC §10 and §17 are updated.
Cross-note (WLM audit 2026-11-10): WT-09 makes CICS regions' CPU belong to a server period; do this entry after
WT-09 and take "CP use by address-space role" and the hurt work's own servers from it (docs/archive/wlm-audit-2026-11.md §7, §8 Q1).
Cross-note (#307 review, 2026-11-12): since WT-07 WLM also takes CPU from a happy more important period, down to its
goal, while `capacityBasis` counts only less important CP; displaceable CP should count that headroom
(`docs/rca-design.md` A4, SPEC §17 "Incident ground truth").

### RT-17 · Healthy baseline per hour of day
`list: rca-truth · status: blocked: playtest (deferred by the user; docs/rca-design.md §4.2, Q6) · priority: high · size: M · area: game`

One baseline per workload per clock hour (EWMA over days), with the rolling EWMA as fallback until a slot has data;
co-dominant groups (≥ ⅓ of the excess) are accepted; a floor of 10 % of the SLA budget below which no delay group
wins (A6). SMF "vs base" reads the slot. Moves truth mechanisms: sweep. Done when: R-6's and R-15's 20:00
`LOCK_CONTENTION/GROWTH` incidents are no longer lock contention, and PT-13's frozen "vs base" tests still pass.

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
(docs/archive/wlm-audit-2026-11.md §7, §8 Q1). WT-10 (landed 2026-11-12) keeps WLM's split in `adjust.ts`: `managedDelays` (CPU,
zIIP, I/O in velocity, storage, queue) and `waitingFrac` (waits over all samples); reuse them.

### RT-20 · Failure-only misses from the failure's source, not from a card
`list: rca-truth · status: blocked: playtest (docs/rca-design.md §4.2(4)) · priority: low · size: M · area: sim`

After RT-01. Record failed transactions by source per workload (slot-queue timeout, region abend, Db2 or MQ
unavailable, backlog timeout; reporting-only) and map them to THREAD_LIMIT, ROUTING, DEPENDENCY and the CPU family;
`failureMechanism` on cards goes away (U-12). Done when: SICK_AOR is ROUTING without the card field and a
MAXCONQW-style DBAT timeout hour is THREAD_LIMIT.

### RT-21 · BATCH incidents under the same rules
`list: rca-truth · status: blocked: playtest (docs/rca-design.md §4.4) · priority: low · size: M · area: game`

After RT-14 and RT-16. Cards whose footprint reaches the critical jobs' images or LCUs during the night qualify;
JOB_FAILURE only when the ABEND's lost time is the largest cause or the job never finished; co-dominant causes
accepted; capping by share of the night (A12). Done when: a DASD_DEGRADED at 22:00 that makes the window miss is
IO/HARDWARE_FAULT.

### RT-22 · Problem records: a diagnosis without an SLA incident
`list: rca-truth · status: blocked: user (decision on docs/rca-design.md §5.1, Q8a) · priority: low · size: L · area: game`

After RT-13. The player opens a problem on a subject and window and files mechanism, trigger and pins; an incident is
a problem the game opened. Needed because REORG_OVERRUN, ZIIP_LOSS, SMF_AUDIT and a roomy-day REGRESSION open no
incident (§5.1). Done when: browser and play CLI can open, file and review one, with tests.

### RT-23 · A discriminator for the retry storm
`list: rca-truth · status: blocked: research (what a real analyst reads to tell retries from new demand; docs/rca-design.md §5.3, Q9) · priority: low · size: M · area: sim`

RETRY_STORM and CAMPAIGN are the same command and identical in every report (R-5). Find the real signal with the
`zos-docs` skill (candidates: rolled-back or abnormally ended DDF threads in Db2 accounting or statistics, connection
timeouts; not confirmed, see §5.3), add a ledger row, then model it on the card. Until then MOBILE_BACKOFF and
REFSTAT_BACKOFF are not gated by RT-24.

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

### PR-02 · Cancel B then A leaves A's edit pending silently
`list: pr-followups · status: ready · priority: low · size: S · area: game`

From #180. A's edit stays in the pending policy and A's cancel message doesn't say so (also true before #180; the
edits are uninstalled and visible). Done when: the message says so.

### PR-03 · A suppressed install failure is silent
`list: pr-followups · status: ready · priority: low · size: S · area: game`

From #180. When a later install succeeds after an earlier one failed at day start, the play CLI's day-start text and
the mail don't say that the earlier install's edits went live through the later one. Done when: both say so.

### PR-09 · No automated test for the dialog lifecycle
`list: pr-followups · status: ready · priority: low · size: M · area: ui`

#181/#183/#185 were verified by hand with Playwright. Cover the save dialogs and the in-app confirmation
(`src/ui/Confirmation.tsx`): open, close, Escape, reopen, delayed close events, confirm/cancel.

### PR-13 · One abended-job set for the play CLI and the `inspect` replays
`list: pr-followups · status: ready · priority: low · size: S · area: tooling`

Source: [#292 pr-fixer review, observation](https://github.com/piconaut/goal-mode/pull/292#issuecomment-6800632362)
(2026-11-11). The play CLI's `advance` decides where to stop from the view (`buildView(...).batch.abended`,
`tools/playCore.ts`), while the `inspect` replays read `sim.batch.jobs` status directly (`abendedNames` in
`tools/inspect.ts`). Both filter `status === 'ABENDED'` and key `day:name` today, so they agree, but a change to the
view's list (e.g. hiding restarted or non-critical jobs) would silently desynchronise the replays from the CLI they
reproduce. Change: one exported helper (in `tools/playCore.ts`, keyed `day:name` from the view) used by the CLI's stop
rule and by `abendedNames`'s callers. Done when: both use it, `npm run compare` shows no difference, and the
`inspect` tests still pass.

### PR-20 · Repeated non-fixable checks are invisible to the assessment episode counter
`list: pr-followups · status: ready · priority: low · size: M · area: tooling`

Source: [#307 follow-up review, N3](https://github.com/piconaut/goal-mode/pull/307#issuecomment-6815991988),
#296's accepted WT-05 done criteria, and user request (2026-11-12). In #307's capped-PROD1 fixture (`202d90d`,
Midwest seed 7, PROD1 defined capacity 200 MSU, Db2 classified into STCHI), ONLHI is `NOT_FIXABLE` / `OTHER` on
30 successive adjustments, D1 14:00:00–14:04:50. These are candidate checks every 10 s, with no trials or projections
for that candidate. The skip clock is set after a rejected trial search, not after `NOT_FIXABLE`. `countSystem`
(`tools/inspect.ts`) counts only `ASSESSED` toward its 30-assessment episodes and keeps those runs across skipped
intervals; these 30 checks contribute zero. Thus #296's accepted 1/2/2 episodes of once-a-minute assessments do not
establish that all unhelpable candidates avoid every-interval checks. The player log emits no-action notes every
30 ticks (five minutes, `adjustPolicies` in `tick/control.ts`); one printed entry is not one check or deduplication.

Change: add a separate streak metric to `inspect … wlm-stats` for at least 30 consecutive `NOT_FIXABLE` checks of
the same period on an image, with bottleneck, first/last tick and check count, exposed in text and JSON alongside
the existing episode details. Preserve the accepted `ASSESSED` episode counter and label both populations clearly.
End a streak when the outcome/bottleneck changes or the candidate is absent from an image's next adjustment.
Update SPEC §5.5.4 and docs/archive/wlm-audit-2026-11.md §9.6/§9.8 to distinguish candidate checks, trial-search assessments,
skip-clock retries and periodic log entries. This reporting task does not extend skip clocks or change bottleneck
selection. Since WT-10 (2026-11-12) waits no longer mask CPU or zIIP delay: the fixture's 14:00–14:04:50 run is ONLHI
mostly waiting, assessed every interval while five or fewer periods miss their goals (RF-03) or once per skip clock
otherwise, and `NOT_FIXABLE` is rare (S-1 … S-3: 0 / 0 / 22).
The large unassessed population is now `RECOVERING` (646 / 3 431 / 9 608; docs/archive/wlm-audit-2026-11.md §9.10), checked every
10 s with no trials: count streaks of any outcome without trials (`NOT_FIXABLE`, `RECOVERING`), not only
`NOT_FIXABLE`. Any proposed
suppression policy needs its own sourced sim entry and an explicit responsiveness/fairness decision.

Done when: a 30-tick `OTHER` trace reports one non-fixable streak, zero `ASSESSED` and zero existing assessment
episodes; changing outcome/bottleneck or omitting the candidate breaks the streak; 30 rejected-search assessments
separated by their five clock skips still count as one existing episode. The recorded #307 fixture is described as
30 checks over about five minutes, with one periodic log entry. Targeted inspect tests cover those distinctions,
and `npm run compare` confirms unchanged sim/game behaviour, logs and reports.

### PR-11 · Match the RCA evidence example to its accepted mechanisms
`list: pr-followups · status: ready · priority: low · size: S · area: content`

Source: [#288 independent fix-check, M1](https://github.com/piconaut/goal-mode/pull/288#issuecomment-6796163086)
(2026-11-11). `docs/rca-design.md` §3 A9 says two `DELAY_ZIIP` pins can reach strong evidence for any CPU or
dependency incident, but `src/content/evidence.ts` accepts that metric only for `CPU_CAPACITY` and `CPU_PRIORITY`;
`DELAY_CPU` also accepts `DEPENDENCY`. Verify the intended example against the metric definitions and judge, then
use `DELAY_CPU` or restrict the example to the CPU mechanisms. This is a documentation correction, not a scoring
change. Done when: A9's example matches the accepted mechanisms and relation/notability rules, preserving its
explanation of the remaining proof-recipe gap.

### PR-15 · A policy edit can leave discretionary work on the ladder, or a new goal at the bottom
`list: pr-followups · status: ready · priority: high · size: M · area: sim`

From the post-merge review of #302 (WT-06, comment 6813880925, 2026-11-12), checked against `dev` `b2a9903`. DPs are carried by period key (`held` in `src/sim/core/tick/dispatch.ts` `imageInput`; `control.ts` applies
`out.dps[k] ?? s.dp`), and `policyAdjust` only ladders goal periods, so a period whose goal kind changes in an
activated policy (`src/game/wlmEdit.ts` allows a discretionary last period) keeps its old DP:
- goal → discretionary: `DEVBAT#1` held at 246 stays at 246, on the top level (SPEC §5.4: discretionary runs at 196);
- discretionary → goal: held at 196, `placeNewPeriods` skips it (`held[k] !== undefined`, `src/sim/wlm/runtime.ts`)
  and `canonical` puts an importance-1 goal at the bottom.
Older than WT-06 (DPs were always carried by key), but WT-06's I9 and WT-07's donor comment ("discretionary work is
fixed below the managed ladder") assume it can't happen. Reset non-goal periods to `initialDp` (server periods
excepted) and place a held period whose goal kind changed, or whose DP is outside its range, as new; `initialDp`'s
dead goal branch can go. Done when: tests for both edits (policy activation mid-run), I9 checks non-goal periods at
their fixed DPs, goldens unchanged unless a golden run edits a goal kind (say which).

### PR-16 · `placeLateDp` can return MANAGED_MAX
`list: pr-followups · status: ready · priority: low · size: S · area: sim`

From the post-merge review of #302 (WT-06, comment 6813880925, 2026-11-12), checked against `dev` `b2a9903`. `src/sim/wlm/runtime.ts` `placeLateDp` caps at `DP.MANAGED_MAX` (`Math.min(goal[down]! + 1, DP.MANAGED_MAX)`):
`placeLateDp(BASEPOL, { 'STCMED#1': 246 }, 'STCHI#1')` is 247 for one interval, until the next canonical pass. It is
the fallback for a key `dpOf` meets after `placeNewPeriods` (a region key not in `slices`). Cap at `MANAGED_MAX − 1`
(join the top level). Done when: unit tests for `placeLateDp` and `placeNewPeriods` (neither has one), including
this case.

### PR-17 · Invariant I15 is stated for every resource-group minimum but holds only for goal members
`list: pr-followups · status: ready · priority: low · size: S · area: tooling`

From the post-merge review of #302 (WT-06, comment 6813880925, 2026-11-12), checked against `dev` `b2a9903`. docs/wlm-design.md I15 says a minimum's share "is dispatched above every goal period"; a discretionary member's
runs at `MANAGED_MIN − 1` = 202 (`src/sim/wlm/eval/grants.ts`), below all goal work and above discretionary work, by
design. The I15 test (`tests/sim/wlm-invariants.test.ts`) only covers the goal-member path. Split the invariant
(goal member above goal work; discretionary member above discretionary work, below goal work) and test both. Done
when: the doc and the test cover both paths.

### PR-18 · WT-06 test gaps
`list: pr-followups · status: ready · priority: low · size: S · area: tooling`

From the post-merge review of #302 (WT-06, comment 6813880925, 2026-11-12), checked against `dev` `b2a9903`. Tests only; no behaviour change:
- S-4 (`tests/sim/wlm-realism.test.ts`) checks ≥ 4 distinct DPs below `MANAGED_MAX` at D8 12:00; assert canonical
  spacing (`levelDp`) and the "7–8 levels from D1 to D8" of docs/archive/wlm-audit-2026-11.md §9.7.
- R-4 ("MKTDDF#2 second from the bottom on PRDD at D1 14:17", §9.7) has no test.
- The capped-PROD1 realism test (`tests/sim/realism.test.ts`, "nothing less important is raised past it") reads the
  trace's `dps`, which `finish` records before the move; a move accepted in the last interval is missed. Check the
  state after the step.
- The log clue ("first rejection that names what stood in the way") has no test: first trial `SMALL_GAIN`, a later
  one `MORE_IMPORTANT_HARMED`.
- I9 checks the set of goal DPs only; add order preservation across an interval with no move.
- `tests/sim/adjust.test.ts` "moving it above the less important one" asserts a join; rename it.
Done when: each is covered (or named here as not worth it).

### PR-19 · Donor happiness uses the worse of local and sysplex PI, not the sysplex PI first
`list: pr-followups · status: ready · priority: low · size: S · area: sim`

From the second review of #307 (WT-07, comment 6815514698, 2026-11-12), B5. `managementWorstPi`
(`src/sim/wlm/adjust.ts`) takes `max(local, sysplex)`, so a donor meeting its goal across the sysplex but missing
it on this image counts as unhappy, and the converse. WLM Services p.138 makes the sysplex PI the primary criterion
for selecting donors. Either justify the worse-of (a donor must be happy on both) with a source, or order by the
sysplex PI and keep the worse-of only for the "more important and missing its goal" exclusion; a two-image test
shows the choice either way. Done when: SPEC §5.5.4, docs/wlm-design.md §5.5 and the `docs/research.md` sysplex-PI
row agree with the code, and the test exists.

## realism-fixes

### RF-01 · CPU Activity report with the CHANGE REASON header
`list: realism-fixes · status: ready · priority: low · size: M · area: sim`

The sim has no CPU Activity report, so the capacity-change clue (SMF70CCR) is shown as a `CHANGE REASON=` line on
Partition Data instead. Real RMF puts it in the CPU Activity report header (`NONE | POWERSAVE (initiated by the
user) | MACHINE (cycle steering, initiated by the machine) | N/A`, RMF Report Analysis p.391–392), and the Monitor
III CPC Capacity report has no capacity-adjustment column (p.97–98). Done when: a CPU Activity report renders with
that header, Partition Data drops the line, the clue paths that name Partition Data name the new report instead, and
SPEC §17 and the `docs/research.md` SMF 70 row stop marking it APPROX.

### RF-02 · DBAT queue time is not in Db2 accounting
`list: realism-fixes · status: ready · priority: low · size: M · area: game`

The SMF 101 view shows "DBAT queue ms/txn" and the `DBAT_QUEUE` evidence metric is pinned from it. Db2 does not trace
the wait for a thread at MAXDBAT (Db2 13 Managing Performance p.143); the analyst's clue is the count of requests
queued at the limit, QDSTQDBT in the statistics record, shown by `-DISPLAY DDF DETAIL` (Db2 13 Command Reference
p.303). Source: RCA audit 2026-11-09 (docs/rca-design.md §3 A14). Change: drop the column from the accounting view,
show queued DBAT requests per hour per Db2 member in a Db2 statistics / DISPLAY DDF view under the same tool, and pin
`DBAT_QUEUE` from there (count per hour; THREAD_LIMIT; FICTIONAL notable line in `content/evidence.ts`). The sim's
queue model does not change. Done when: the view, the pin and the clue texts that name the old column are updated,
`tests/game/smf.test.ts` and the evidence tests cover it, and the two `docs/research.md` rows say "Matches".

### RF-04 · The velocity floor sets a starved period's projected PI, and outweighs percentile periods
`list: realism-fixes · status: ready · priority: low · size: S · area: sim`

From the pr-reviewer report on #331 (WT-16, N2, 2026-11-13). Since WT-16, projections judge velocity before the PI
ceiling of 99, so a starved velocity period's projected PI is set by the hard-coded 0.1 % velocity floor in
`performanceIndex` (`src/sim/wlm/goals.ts`): `goal.velocity / 0.1`, i.e. 10 × its goal (VEL 74 → 740). A percentile
PI stops at 4.0 and an average one at the timeout, so in net value's summed equal-importance harm and in the
disparity test a starved velocity period outweighs any response-time period by two orders of magnitude, whatever
its importance-equal rival's state. On #331's seed-1044 fixture G06 (VEL 74) goes 3.02 → 740.00 and turns the first
trial into `EQUAL_DISPARITY`. No net-value rule changed, but the effective weights did. How real WLM scales a
projected velocity PI near zero service is not documented in the books checked so far (unverified; check with
`zos-docs` before choosing).
Change: move the floor to `src/content/wlm/tuning.ts` with a `// FICTIONAL:` note describing the shape it should
give, and decide whether projected harm should be bounded comparably across goal types (e.g. a projection ceiling
for velocity like percentile's 4.0 past-the-mean scale, or harm counted on a common scale). That is a design call
for the main agent; report before changing the rule. Done when: the floor is a named content coefficient, the
choice is recorded in docs/wlm-design.md §5.10 and SPEC §5.5.4, a test shows a starved velocity period and a
missing percentile period of equal importance traded on the chosen scale, and goldens, the S-1 … S-3 table and a
three-scenario sweep (seeds 1–10) are recorded if behaviour changes.

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

### RF-06 · Partition Data WLM% is the share of demand removed, not the share of time capped
`list: realism-fixes · status: ready · priority: low · size: M · area: sim`

Source: cross-report invariant suite (2026-11-14; identity `partition-capping`, left-out part). Real `WLM%` is the
"Percentage of time when WLM capped the partition" (RMF Report Analysis 3.1 p.401–402): the samples in which "WLM
considers to cap" over all samples (SMF70NSW ÷ SMF70DSA, RMF User's Guide 3.1 p.186). Monitor III CPC `WLM Capping %`
has the same definition (p.98), and the Group Capacity report adds `ACT%` for the samples where capping actually
limited usage (SMF70NCA, p.406). The sim's `wlmCappingPct` (`src/sim/measure/rmf.ts`) and Monitor III
`wlmCappingPct` average `softCappedFrac`, the share of CP demand the cap removed. On Midwest seed 7 with a defined
capacity at 60 % of the R4HA, PROD1 was capped for the whole interval and showed WLM% 57; DEVT, capped all interval
but under its cap, showed 0. Change: carry "soft cap in force" on the image's CP pool runtime (a new `LparPoolRuntime`
field, so sim state changes shape though no behaviour does), report WLM% as the share of ticks it was in force, and
keep the share of demand removed as its own figure (the evidence metric and alerts read `cappedPct`, which does not
change). Done when: the identity "WLM% = share of the interval the image was capped" is in
`tests/helpers/reportIdentities.ts`, the Codex and clue texts that read WLM% as a size are checked, the
docs/research.md row says "Matches", and `npm run compare` shows only the reporting difference.

### RF-07 · WLMGL ENDED counts job ends only for batch classes with a response time goal
`list: realism-fixes · status: ready · priority: low · size: M · area: sim`

Source: cross-report invariant suite (2026-11-14; identity `smf30-vs-wlmgl`, left-out part). "The number of batch
transactions equals number of jobs" (WLM Planning 3.1 p.71) and RMF's ENDED is "the number of transactions that ended
during the interval" with no condition on the goal type; the book's own velocity-goal sample shows ENDED 9 (RMF
Report Analysis 3.1 p.530, p.522). The sim adds a completion, its response time and a bucket observation only when the
job's period has an AVG or PCT goal (`src/sim/core/tick/dispatch.ts`, added with WT-12), so every shipped batch class
(velocity or discretionary) shows ENDED 0 and no response time while SMF 30 lists its job ends (Midwest seed 7: 20
jobs ended in a discretionary class, WLMGL ENDED 0). Change: count every ended job as an ended transaction with its
queue + elapsed response time in its ending period and report class; response-time buckets stay for response time
goals (RMF also prints a per-system distribution for velocity periods: docs/research.md, not modelled). `acc.completions`
feeds no velocity PI, but it is WLM state, so goldens change: check with `npm run compare` that DPs, the WLM log and SLA
results are unchanged. Done when: the left-out part of `smf30-vs-wlmgl` is restored for every goal type, Monitor III
shows the ended rate, and docs/research.md and SPEC §17 "Batch response-time goals" are updated.

### RF-08 · A capacity group's 4-hour average is on no report, and starts empty when the group is defined
`list: realism-fixes · status: blocked: research · priority: low · size: M · area: sim`

Source: cross-report invariant suite (2026-11-14; identity `soft-cap-flag`, left-out part). The Partition Data header
shows GROUP NAME, LIMIT and `AVAILABLE`, the "long-term average of CPU service in MSUs/h which would be allowed by the
limit of the capacity group but is not used by its members. If the value is negative, the group is capped" (RMF Report
Analysis 3.1 p.399–400); LIMIT is flagged with `*` when the partition joined its group less than four hours ago. The
game shows the group and its limit (Monitor III CPC header) but not the group's average, so a player cannot work out
from any report why a group is or is not capping: the members' R4HAs do not add up to it, because the sim starts a
new group's window empty (`newR4ha(g.id)` in `src/sim/core/tick/control.ts`), as if the group had been IPLed. In the
suite's runs a group limit at 60 % of its members' summed R4HA never capped within an hour for that reason.
Research first (zos-docs): how WLM builds the group's average when a group is defined or a member joins (WLM Planning
3.1 p.46–47 says capping starts "when the 4-hour rolling average for the combined usage exceeds" the limit; whether
that is the sum of the members' own averages is not stated on the pages read). Then: show AVAILABLE (and the `*`) on
Partition Data and the CPC header, and build the group average as research says. Done when: the suite's `soft-cap-flag`
reads the group's state from a report instead of the sim, and docs/research.md has the row.

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

### CL-07 · Lookup plan leftovers: classification and period indices, two untested commands
`list: cleanup · status: ready · priority: low · size: S · area: sim`

Not a model change: pure optimisation and a test gap, label `perf`. Source: review of #277 and #278 (2026-11-11).
CL-05's review handed CL-06 three plan fields; CL-06 built CF structures by name (`structureShareOf`) but not the
other two, and its PR doesn't record them as dropped.
- **Measure first** (`node --cpu-prof`, Harbourline and Midwest, 3 days, seed 42, as docs/headless-performance-options.md):
  the self time of `classifyJob` (`tick/helpers.ts`, already cached) and of service class period key lookups in
  `dispatchLpar`/`lparDemand`. If together they are under 1 % of the profile, skip the code change, say so in
  docs/headless-performance-options.md "Results", and do only the test part.
- **Otherwise** add to `LparPlan` (`src/sim/core/tick/plan.ts`) workload and job-class classification results and
  integer indices for service class periods, keyed only on what the plan already keys on, and use them where the
  profile shows the lookups. Plan fields stay `readonly`; no per-tick state in the plan; no `SimState` change.
- **Test gap:** `tests/sim/plan.test.ts` lists `RESTART_JOB` and `SET_PRICING` in `NO_PLAN_INPUT` but never runs
  them; run both like `ABEND_JOB` and `SET_MLC_PRICE`, with the key-object snapshot around `step()`.

Done when: bench hashes unchanged for Midwest, Harbourline and Revenue (`npm run bench -- --hash`); `npm run compare
-- --base origin/dev` reports no differences; `npm run check` green; the profile numbers (and timing pairs, if code
changed) in the PR and docs/headless-performance-options.md.

### CL-08 · `play mon3` CPC table: same columns as the browser's CPC view
`list: cleanup · status: ready · priority: low · size: S · area: tooling`

Source: the single-table Monitor III CPC view (2026-11-11). The browser now shows one partition table (MSU Def/Act,
Proc Num, Logical Util % Effect/Total, Physical Util % LPAR/Effect/Total, PR/SM delay %, capped %) and dropped the
old second table (weight, polarity, busy %). `mon3Text` (`tools/playCore.ts`) still prints the CPC section as
`table(cpc)`, every `Mon3Cpc` field: `busyPct` (same formula as `logicalTotalPct`), `logical` (same as `procNum`),
`weight`, `polarity`, `overheadPct`, `capacityAdjPct`, `kind`, `cpcId`. Print the browser's columns with RMF-style
headers (*CP / *ICF group rows as in `src/ui/monitor/Cpc.tsx`), plus the capacity-adjusted line once per CPC; say in
the section heading which pin each column takes (`pin CPC <lpar> LPAR_BUSY|PRSM_DELAY|CAPPED`, `CPC_BUSY`,
`CAPACITY_ADJ`). Leave `--json`, `mon3PastText` (the pin-history dump) and the `Mon3Cpc` view model unchanged:
agents and pins read `busyPct` there. Weight and polarity stay in `play capacity`. Done when: `play mon3` and `play
mon3 PROD1` show the new CPC section, `--json` output is unchanged, and the docs/agents.md example (if any) matches.

### CL-10 · Monitor III splits by the last tick's mix don't add up
`list: cleanup · status: ready · priority: low · size: M · area: game`

Source: cross-report invariant suite (2026-11-14; identities `mon3-sysplex-sum` and `mon3-delay-states`, left-out
parts). WLM's smoothed accumulator keeps total Using and total CP time, so `row()` in `src/game/mon3.ts` splits them
by the last tick's mix (APPROX, SPEC §17): zIIP and IIPCP engines, and the users using PROC and DEV. Two things then
don't add up for the player: a sysplex row is split by the pooled mix, so it is not the sum of its systems' rows
(Midwest seed 7, 06:30, DDFPRD#1 zIIP 0.06222 against 0.06225); and when the last tick had no using sample the users
using PROC + DEV are 0 while USG % is not (DEVBAT#1 after its job ended: 0 users using, USG 30 %). PROCU and
ENCLAVE inherit both. Change: keep the decayed components the views need (using CPU, zIIP and I/O; zIIP and IIPCP
engines; the moved CICS parts with them) as reporting-only accumulator fields and read the split from them, dropping
`LastSplit`. Not a model change: `npm run compare -- --base origin/dev --drop <new fields>` must show sim state, game
state and RMF unchanged, with Monitor III differing only in the split figures. Done when: the left-out lines are
restored in both identities, and SPEC §17 "Monitor III views" no longer lists the last-tick split.

### CL-12 · Disk-cached test fixtures for shared start states
`list: cleanup · status: ready · priority: high · size: M · area: tooling`

Source: codebase survey (2026-11-16). Five files independently build the same start state: Midwest seed 7, content
`{...MIDWEST_GAME, events: []}`, `startDay`, then 6 h to noon. They are `tests/game/evidence.test.ts`,
`storageJobWmPins.test.ts`, `proofRecipes.test.ts`, `smf.test.ts` and `mon3.test.ts`. Evidence and storageJobWmPins
then also apply the same `RBANK cpu=3` hour on top. `tests/game/counterfactual.test.ts` plays 29 h of Revenue seed 6
in `beforeAll` (52 s file). Vitest runs each file in its own worker, so they can only share through disk.
Change: add a `tests/helpers/fixtureCache.ts` that stores a named `RunState` as JSON under
`node_modules/.cache/goal-mode-fixtures/`. The key is a hash of every file under `src/`, `tests/helpers/` and
`package-lock.json`, so any code change rebuilds the cache. Writes go to a temporary file and are renamed into place,
so parallel workers don't read a half-written file. Each read returns a fresh decoded copy. Use it for the noon state,
the noon + `RBANK` state and counterfactual's start state. First confirm each file's start state is byte-identical to
the shared one (`encodeRunJson`), and keep any file whose start differs on its own build. Done when: those files use
the cache; a cold run passes and a warm run is faster; deleting the cache directory or editing a `src/` file rebuilds
it; the per-file timings, cold and warm, are in the PR.

### CL-13 · Build once per file: realism midday base, play-file prefixes
`list: cleanup · status: ready · priority: high · size: S · area: tooling`

Source: codebase survey (2026-11-16). `tests/sim/realism.test.ts` builds the seed-42 Midwest midday state four times
(the `describe` blocks around `:194`, `:224`, `:242` and `:465`; 24 sim-hours). `tests/tools/play.test.ts` rebuilds
"new file, seed 7, start, advance 1–2 h" in about 15 tests. Change: one lazily built, module-level copy of each,
handed out as `structuredClone` copies (play files: decoded copies). Leave the `:689` base alone, because it sets
`POLICY_ADJUST.skipClockMinMissing` first. Leave `tests/sim/wlm-realism.test.ts` unchanged too (user decision
2026-11-16: the ladder test stays as it is for now). Done when: no test asserts against a state another test
mutated; `npm run check` is green; the file timings, before and after, are in the PR.

### CL-14 · One short determinism pair per scenario
`list: cleanup · status: ready · priority: low · size: S · area: tooling`

Source: codebase survey (2026-11-16). Several files play the same run twice to check that it is deterministic:
`tests/sim/harbourline.test.ts` (2 × 6 h), `multicpc` (2 × 3 h), `routing` (2 × 2 h), `tests/game/harbourline-pack`
(2 × 3 h), `realism.test.ts:182` and `mon3Charts.test.ts:17`. The golden tests cover only Midwest. Change: keep one
1-hour pair per scenario in `tests/sim/purity.test.ts` (or a new `determinism.test.ts`) with `SCENARIOS` as the loop,
and drop the per-file pairs. First check that no other assertion reads the dropped runs' output. Done when: every
scenario in `SCENARIOS` keeps a determinism check; `npm run check` is green; the timings are in the PR.

### CL-15 · Measure and cut per-file test overhead
`list: cleanup · status: ready · priority: high · size: S · area: tooling`

Source: codebase survey (2026-11-16). One local full run (4 cores, `--reporter=json`) took 234 s of wall time for
585 s of summed file time. That is well over the 146 s that 4 workers would need, so import, transform and collect
time per file is probably large; each file imports the whole sim afresh. Change: measure first. Run vitest's default
reporter and record its `Duration (transform … setup … collect … tests …)` line, then profile one cheap file. Based
on the numbers, try what fits: `deps.optimizer` / `server.deps.inline` settings, `pool: 'threads'` against `forks`,
`maxWorkers`, or merging the tiniest files. Don't use `isolate: false`: tests change module-level settings
(`POLICY_ADJUST` overrides, `setWlmTraceSink`). Done when: the breakdown and every setting tried, each with its wall
time, are in the PR and in docs/headless-performance-options.md "Results". Any config change that is kept is in
`vite.config.ts`, and `npm run check` and `npm run test:remote` are green.

### CL-16 · Hints dating test plays two days
`list: cleanup · status: ready · priority: low · size: S · area: tooling`

Source: codebase survey (2026-11-16). `tests/game/hints.test.ts` (`are dated for the next morning…`, 17 s) plays two
full Midwest days to check the dates on hints and forewarnings. Change: check which assertions really need day 2,
and whether a shorter start (CL-12's cache, or the earliest hour that sends a hint) covers the same dates; if not, say
why in the PR and close the entry. Done when: the assertions are unchanged or justified as equivalent, and the
timings are in the PR.

### CL-17 · One "advance N hours" loop for the worker and the tools
`list: cleanup · status: blocked: after PR-13 · priority: high · size: M · area: game`

Source: codebase survey (2026-11-16). The hour-by-hour advance is written out several times:
- `tools/playCore.ts` `advance`: Monitor III recording every MINTIME, stop at the hour a job abends;
- the advance loop in `tools/bot.ts`;
- `tools/repro.ts`;
- `src/worker/game.worker.ts` (`advanceSampled`, plus `recordMon3History` every `mintimeTicks`).

Change: a `src/game/` helper `advanceHours(run, content, hours, hooks)`, with hooks for "after each MINTIME" (Monitor
III recording) and "stop when" (PR-13's abended-job set), used by all four. `tools/compareDump.ts` runs inside the
base worktree that `compare.ts` checks out, so it keeps its own loop (it must not import code the base doesn't have).
Not in scope: the browser keeps `Mon3History` and the CLI keeps `Mon3PinHistory`; PT-18 deals with that.
Done when: `npm run compare -- --base origin/dev` shows no difference, the bench hashes are unchanged, and the
goldens and the play/bot tests pass unchanged.

### CL-18 · One game command layer for the browser worker and the play CLI
`list: cleanup · status: blocked: after CL-17 · priority: high · size: L · area: game`

Source: codebase survey (2026-11-16). `src/worker/game.worker.ts` (47 message cases) and `tools/playCore.ts` `apply`
both turn player commands into `RunState` changes by calling `src/game/*` themselves, each with its own validation
and its own wording. They have already drifted:
- only the CLI validates an RCA's mechanism, trigger, incident and evidence pins, and only its reply names the
  same-cause incidents the RCA also covers (the spreading itself is shared, in `submitRca`);
- the two word WLM-edit, activation and failed-policy results differently.

Change: `src/game/commands.ts`, `applyGameCommand(run, pending, cmd, content, sc) → { run, pending, ok, message }`,
covering start, change, restart, cancel, draft, rca, pin/unpin, WLM edit/activate/discard, buy, tfp, ask and project.
The worker and `playCore` become thin adapters. Validation is the union of both sides. List every difference in
validation or wording that this resolves in the PR, and say which side was kept. Done when: no game rule is left in
either adapter; `npm run compare` differs only in the result texts listed in the PR; the browser and CLI tests pass.

### CL-19 · One field table for the service-class accumulators
`list: cleanup · status: blocked: after CL-10 · priority: high · size: M · area: sim`

Source: codebase survey (2026-11-16). The fields of the per-period accumulator are listed by hand in four places,
each with the same optional-field quirks (`delayQueue`, `usingIoNoVel`, `srvUsing`, `workManager`):
`addScp` and `mergeAcc` in `src/sim/measure/rmf.ts`, `decayInto` and `addAccInto`/`sumAcc` in
`src/sim/wlm/runtime.ts`. A new report field needs four edits in lockstep (CL-10 adds several). Change: drive all four
from one field-spec table (additive, optional, decayed). `addScp` runs every tick and is written without spreads:
generate the code, or measure that a table loop stays within budget. No behaviour change; label
`perf`. Done when: bench hashes unchanged for Midwest, Harbourline and Revenue; `npm run compare` shows no
difference; per-tick timing before and after (`npm run bench`) in the PR.

### CL-20 · Delete legacy save fallbacks: game, tools and UI
`list: cleanup · status: ready · priority: high · size: M · area: game`

Source: codebase survey (2026-11-16). User decision 2026-11-16: old saves need not load; delete the compatibility code
to keep things simple. About 35 comments in `src/game`, `src/ui` and `tools` explain a fallback for saves or play
files "from before" a change. Examples:
- `proof.ts` `accepted?`;
- the RT-09 trigger alias: `canonicalTrigger` in `tools/playCore.ts` load and `rca`, and the worker's import mapping;
- the `?? []` / `?? {}` guards on fields that `newRun` always sets (about 107 fallbacks in `src/game` in all; some are
  genuinely optional).

Change: make those `RunState` / `PlayFile` fields required, delete the guards and alias paths that exist only for old
saves, and delete their tests (e.g. `tests/game/triggerAlias.test.ts`, if nothing else is in it). Add a save format
version to the browser save and the play file. A file from an older build then fails to load with one clear message
("saved by an older build; start a new run"), not a crash later on. Keep each optional field that is optional for a
reason other than old saves, and say so in the PR. Done when: a grep for "before RT-", "old saves" and "written
before" finds nothing in `src/game`, `src/ui` or `tools`; `npm run compare` shows no difference for new runs; an
older play file gets the clear message (tested).

### CL-21 · Delete legacy save fallbacks: sim state
`list: cleanup · status: ready · priority: low · size: S · area: sim`

Source: codebase survey (2026-11-16), user decision 2026-11-16 as CL-20. Fields marked "absent in old saves" in
`src/sim/measure/rmf.ts` (MVS BUSY, the absolute capping limit), `src/sim/wlm/runtime.ts` (the capping delay) and
`src/sim/core/types.ts` (the zIIP-eligible backlog) become required and lose their guards. Fields that are also absent
for another reason stay optional, e.g. `runtime.ts`'s "absent in a period's first tick". Done when: bench hashes are
unchanged for all three scenarios, `npm run compare` shows no difference, and those comments are gone.

### CL-22 · Dead code and file-private exports
`list: cleanup · status: ready · priority: low · size: S · area: game`

Source: codebase survey (2026-11-16). The following have no importer at all (checked with grep over `src`, `tests` and
`tools`): `BUILTIN_CLASSES` (`src/sim/wlm/types.ts`) and `codexEntry` (`src/content/codex/entries.ts`). The following
are used only in their own file, so they should not be exported. Re-check each with grep, `tests/` and `tools/`
included, first:
- `src/game`: `capexFor`, `leadDaysFor` (catalog), `pinText` (evidence), `routedImages` (footprint),
  `primaryDelayOf` (mon3), `sampleMon3` (mon3Charts), `effectCommands` (projects), `activeTools`, `onTrial`,
  `buyBlocker`, `overheadText` (tools) and `nightWindow` (sla);
- `src/content`: `cpcFor` (hardware-catalog);
- `src/sim`: `DISCRETIONARY_PI`, `PI_MIN_PERCENTILE`, `R4HA_SLOT_SEC`, `POOLS`, `erlangB`, `classifyUncached`,
  `calendarMultiplier`, `shapeAt`, `growthMultiplier`, `missingGoal`, `regionStat`, `routeCandidate`,
  `managedDelays`, `sharesOf`, `holderDonorInfo`, `parseScKey`, `initialDp`, `resolveRgCapEngines`, and the memo
  caches `jobClassCache`, `byIdCache`, `wlCache`, `asCache` and `usesDb2Cache`.

Types that name an exported shape may stay exported. Done when: the symbols are deleted or un-exported, typecheck is
clean and `npm run check` is green.

### CL-23 · `src/content` imports from `src/game`; enforce the layering
`list: cleanup · status: ready · priority: high · size: S · area: content`

Source: codebase survey (2026-11-16). CLAUDE.md's layering is `content → sim ← game ← ui`, but ten content files
import types from `game`: `game-midwest.ts`, `game-revenue.ts`, `game-harbourline.ts` and `packs.ts` (`GameContent`
from `../game/run`); `rca.ts`, `evidence.ts`, `footprint.ts`, `hints.ts` and `events/midwest-events.ts`
(`Mechanism`, `Trigger` from `../game/types`); `draft.ts` (`DraftOption`). Change: move those types, and the types they need, to a content-side
module (e.g. `src/content/types.ts`), with `src/game` re-exporting them where convenient. Extend
`tests/sim/purity.test.ts` so it also fails when `src/content` imports from `game`, `ui` or `worker`. Done when: the
purity test covers `src/content` and passes, and typecheck is clean.

### CL-24 · One argument parser for the tools
`list: cleanup · status: ready · priority: low · size: S · area: tooling`

Source: codebase survey (2026-11-16). `tools/args.ts` exports a 4-line `arg()`. Private copies, or hand-rolled
`argv` handling, live in `bench.ts`, `headless.ts` (which also skips values starting with `--`), `repro.ts` (`opt`),
`inspect.ts` (`opt`), `compare.ts`, `sweepRemote.ts`, `testRemote.ts` and `play.ts`. Change: `arg`, `flag` and
`num` in `tools/args.ts`, used everywhere except `tools/compareDump.ts`, which must stay self-contained (CL-17).
Replace the `process.argv[1]?.endsWith('<file>.ts')` main-module guards (7 in `tools/`), which silently stop running
when a file is renamed, with one `isMain(import.meta.url)` helper. Done when: every CLAUDE.md command line still
works as documented (spot-check each tool's `--help` or a short run), `bench --hash` prints the same hash, and the
tool tests pass.

### CL-25 · One clock formatter
`list: cleanup · status: ready · priority: low · size: S · area: sim`

Source: codebase survey (2026-11-16). Zero-padded clock text is built in `src/sim/core/clock.ts`,
`src/sim/core/tick/helpers.ts` (`instanceClock`), `src/sim/measure/reports.ts` (three places; its local `pad` pads
with spaces), `tools/playCore.ts` (`clockText`), `src/ui/App.tsx` (`hhmm`), and by slicing `formatClock(…)` in
`src/ui/Mon3Charts.tsx` and `src/ui/Monitor.tsx`. `src/game/view.ts` and `planner.ts` import `instanceClock` from
`sim/core/step`. Change: `pad2`, `hhmm` and `instanceClock` live in `src/sim/core/clock.ts` and every copy uses them.
Rename the reports `pad` to `padRight` (or similar), since it is not the same thing. Done when: `npm run compare`
shows no difference, RMF report text included.

### CL-26 · `basepol.ts` uses the shared WLM policy builders
`list: cleanup · status: ready · priority: low · size: S · area: content`

Source: codebase survey (2026-11-16). `src/content/wlm/basepol.ts` (lines 5–35) redefines `vel`, `pct`, `avg`,
`disc`, `sc` and `rule`, which `src/content/wlm/policyBuilders.ts` exports and `revpol.ts` / `hbpol.ts` use. Only
basepol's `sc` takes an `extra` argument. Change: add `extra` to the shared `sc` and import the builders in
basepol. Done when: the Midwest base policy is unchanged (`npm run compare`; bench hashes).

### CL-27 · Sim tunables into `src/content`
`list: cleanup · status: ready · priority: low · size: S · area: sim`

Source: codebase survey (2026-11-16). CLAUDE.md rule 3 puts coefficients in content, but these sit in sim code:
- `MOSTLY_WAITING_FRAC` (`src/sim/wlm/adjust.ts`) and `MAX_QUEUE_RATIO` (`src/sim/wlm/eval/results.ts`);
- `DEFAULT_EFF_RATIO`, `WLM_LOG_MAX` and `RMF_KEEP` (`src/sim/core/tick/ctx.ts`), and `MAX_TEMPLATE_SETS`
  (`src/sim/workload/slices.ts`);
- `MAX_RHO = 0.97` in `src/sim/io/dasd.ts`, beside another exported `MAX_RHO = 0.995` in `src/sim/zos/erlang.ts` with a
  different meaning;
- the bare `% 30` (`adjust.ts`, `tick/control.ts`), which repeats `CRITICAL_PROJECTION_EVERY`'s intent, and `% 360`
  (`tick/control.ts`).

Change: move the coefficients to content with `// FICTIONAL:` or `// APPROX:` notes. Rename the two `MAX_RHO`s
(e.g. `DASD_MAX_RHO`, `QUEUE_MAX_RHO`). Name the literals. Keep every value as it is. Done when: bench hashes are
unchanged and `npm run compare` shows no difference.

### CL-28 · One identity-memo helper for the sim's caches
`list: cleanup · status: blocked: after CL-07 · priority: low · size: M · area: sim`

Source: codebase survey (2026-11-16). About a dozen `WeakMap` caches keyed by object identity are written in three
different shapes:
- `src/sim/core/tick/helpers.ts`: `jobClassCache`, `byIdCache`, `workloadScope`/`wlCache` and `asCache`;
- `src/sim/core/tick/ctx.ts` (`usesDb2Cache`);
- `src/sim/core/tick/plan.ts`'s nested cache;
- `src/sim/hw/pools.ts`, `src/sim/wlm/classify.ts` and `src/sim/wlm/runtime.ts`;
- `src/sim/workload/slices.ts` (four).

Change: one `memoByIdentity` helper (single key and nested keys) in `src/sim/core`, used by all of them. Keep the
semantics exactly: the cache is keyed by identity and never by value. Label `perf`. Done when: bench hashes are
unchanged, `npm run compare` shows no difference, and the per-tick timing before and after is in the PR.

### CL-29 · Split `tick/helpers.ts` by concern
`list: cleanup · status: ready · priority: low · size: S · area: sim`

Source: codebase survey (2026-11-16). `src/sim/core/tick/helpers.ts` (545 lines) holds job classification, swap-out,
CICS routing (`updateRouting`, `regionStat`, `routeCandidate`, `cicsRegions`, `cicsHonorPriority`), workload and
address-space scoping, and resource-group and discretionary caps. Change: move-only split into `tick/routing.ts`,
`tick/scope.ts` and `tick/resourceGroups.ts`, with no logic change; `instanceClock` goes to clock.ts in CL-25. Done
when: bench hashes are unchanged, and the diff is moves and imports only.

### CL-30 · Split `policyAdjust`
`list: cleanup · status: blocked: after PR-19 · priority: low · size: L · area: sim`

Source: codebase survey (2026-11-16). `policyAdjust` in `src/sim/wlm/adjust.ts` is about 500 lines (368–868) with
about 25 closures (`instPi`, `projectionBase`, `runaways`, `backlogCut`, `violatesCpuCritical`, `periodDonor`, `assess`,
`candidates`, …). Change: build an explicit adjustment context once; move `assess` and the candidate and donor
selection into their own modules (`src/sim/wlm/adjust/`); move the trace types and `setWlmTraceSink` (lines about
113–205) and the delay-share helpers (about 24–75) to their own files. No logic change. PR-19 changes donor
selection in this function, so it goes first. Done when: bench hashes are unchanged; `npm run compare` shows no
difference, `inspect wlm` traces included; `tests/sim/adjust.test.ts` passes unchanged.

### CL-31 · Split `advance()` in `game/run.ts`
`list: cleanup · status: ready · priority: low · size: M · area: game`

Source: codebase survey (2026-11-16). `advance` in `src/game/run.ts` is about 125 lines (163–287): the tick loop,
with scheduled policy activation and event start and end (armed fixes included) written inline. It calls `closeHour`
(already in `run/hourly.ts`) and `endDay`, which sits beside it with `batchMissIncident` and `logConnectFailures`
(about 290–470). Change: move event activation into `src/game/run/events.ts`, and day close (`endDay`,
`batchMissIncident`) into its own `src/game/run/` module, leaving `advance` as the loop that calls them. Fold the 16
one-line re-exports at the file's end (lines 570–600) into grouped `export { … } from` statements. No logic change. Done when: `npm run compare` shows no difference, and the goldens
and `tests/game/run.test.ts` pass unchanged.

### CL-32 · One home for the RCA judging modules
`list: cleanup · status: blocked: design · priority: low · size: L · area: game`

Source: codebase survey (2026-11-16). RCA judging is spread across modules whose roles blur:
- `src/game/sla.ts` (hour attainment, but also mechanism attribution, card qualification, the batch-miss logic and
  accepted-answer scoring);
- `rcaTruth.ts`, `rcaExplain.ts`, `proof.ts` and `evidence.ts` (which imports `buildMon3` and `BATCH_INCIDENT` from
  sla);
- `footprint.ts`, `counterfactual.ts` and `run/rca.ts`.

A scoring change touches five or six files. Proposal: a `src/game/rca/` folder with truth (the accepted-answer
rules from sla.ts, rcaTruth.ts and rcaExplain.ts), attribution (card qualification), evidence, proof and footprint;
`sla.ts` keeps attainment and baselines; `counterfactual.ts` stays a separate offline tool. Blocked on design: the
target map needs the user's or main agent's agreement, and the move should wait for a quiet spell in `rca-truth`
(RT-16 … RT-27 edit these files), so it doesn't conflict with every open RT PR.

### CL-33 · Split `mon3.ts`
`list: cleanup · status: ready · priority: low · size: M · area: game`

Source: codebase survey (2026-11-16). `src/game/mon3.ts` (852 lines) holds 13 view interfaces (lines 23–235),
`buildMon3`, the PROCU job and classification logic (about 512–645), the speed and exception sections, and
`explainWlmLog`, a text formatter (about 734). Change: move-only split into `mon3/types.ts`, `mon3/procu.ts`,
`mon3/explainWlmLog.ts` and the builder. Done when: the diff is moves and imports only, and `npm run compare` shows no
difference, Monitor III views included.

### CL-34 · Split `playCore.ts`: commands and text
`list: cleanup · status: blocked: after CL-18 · priority: low · size: M · area: tooling`

Source: codebase survey (2026-11-16). `tools/playCore.ts` (751 lines) mixes the command layer (lines about 118–340)
with text renderers: status, mon3, policy and catalog (about 375–600), and finance, capacity and batch (about
648–751). Once CL-18 makes the command part thin, move the renderers to `tools/playText.ts`. Done when: the diff is
moves and imports only, and the play tests pass unchanged.

### CL-35 · Split `inspect.ts` by subcommand
`list: cleanup · status: blocked: after PR-20 · priority: low · size: M · area: tooling`

Source: codebase survey (2026-11-16). `tools/inspect.ts` (923 lines) holds the `dp`, `wlm`, `blame` and `wlm-stats`
subcommands with their renderers. Change: `tools/inspect/{dp,wlm,blame,wlmStats}.ts` with a thin dispatcher. PR-20
edits `countSystem` in this file, so it goes first. Done when: the diff is moves and imports only, and
`tests/tools/inspect.test.ts` passes unchanged.

### CL-36 · Worker: message handlers as a typed table
`list: cleanup · status: blocked: after CL-18 · priority: low · size: M · area: ui`

Source: codebase survey (2026-11-16). `src/worker/game.worker.ts` is one `onmessage` switch with 47 cases, mixing game
commands, `GET_*` view queries, the clock (`setInterval`, `speed`, `carry`, `speedBeforeAuto`) and storage. Change:
after CL-18, a `Record<ToWorker['type'], handler>` table (exhaustive by type, from `src/worker/protocol.ts`), split
into commands, queries, clock and storage modules. Done when: typecheck proves every message type is handled, and
the UI tests and a manual or `tools/screenshot.mjs` smoke run pass.

### CL-37 · Service class goal helpers out of the editor component
`list: cleanup · status: ready · priority: low · size: S · area: ui`

Source: codebase survey (2026-11-16). `goalOf`, `goalError` and `sameGoal` in `src/ui/ServiceClassEditor.tsx`
(about 124–159) are pure goal-validation logic inside a React file, and have no tests. Change: move them to
`src/game/` (next to `wlmEdit.ts`'s `serviceClassGoalIssues`, merging where they overlap), keeping `useGoalState` in
the UI, and add unit tests. Done when: they are tested, and the editor behaves as before
(`tests/ui/serviceClassGoals.test.ts` passes).

### CL-38 · Split `Overlays.tsx` and `App.tsx`
`list: cleanup · status: ready · priority: low · size: M · area: ui`

Source: codebase survey (2026-11-16). `src/ui/Overlays.tsx` (667 lines) holds 16 components from five screens: the new
run flow (`NewRun`, `StartingPerk`, `FirstDayDifficulty`, `SeedInput`, `CareerLine`), the end report (`EndReportView`,
`ShareBox`), `Briefing`, `Review`, and the RCA form (`Rca`, `RcaVocabulary`, `ProofView`, `AlsoAccepted`).
`src/ui/App.tsx` (481 lines) holds `Console` (about 165 lines), `Capacity`, `OpsLog`, `Inbox`, `TopBar`,
`ThemeToggle` and `SoundToggle` next to the tab shell. Change: move-only split into `src/ui/newRun/`,
`src/ui/endReport/` and `src/ui/rca/`, plus one file each for the App parts. Done when: the diff is moves and imports
only; the build succeeds; `tools/screenshot.mjs` output matches before and after.

### CL-39 · Scenario content without the boilerplate
`list: cleanup · status: ready · priority: low · size: M · area: content`

Source: codebase survey (2026-11-16). `src/content/scenarios/index.ts` (about 19–68) builds Revenue and Harbourline
as `{...MIDWEST, …}` overrides, with the Midwest CF tunables inline. `game-midwest.ts`, `game-revenue.ts` and
`game-harbourline.ts` repeat the same key set. Change: a named CF tunables constant with its `// FICTIONAL:` note,
and a `defineGame()` that supplies the defaults (`maxDays`, `facets`, …) so each game file states only what differs.
Done when: `npm run compare -- --scenarios midwest,revenue,harbourline` shows no difference, and the bench hashes are
unchanged.

### CL-40 · CLAUDE.md: everyday commands only, full list in docs/tools.md
`list: cleanup · status: ready · priority: high · size: S · area: tooling`

Source: codebase survey (2026-11-16). The CLAUDE.md commands block is about 5.1k characters, 28 % of the file that
every session loads. Lines run to 560 characters, and many are investigation or CI-gate commands (`wlm-stats`,
`blame`, `repro`, `tools/ci/*`). The heading still says "Stack (planned…)" and "Commands, once scaffolded".
`npm run build` and `test:watch` are missing. Change: move the full list, unchanged, to `docs/tools.md` (add
`build`, `test:watch` and `tools/lab-examples/`). In CLAUDE.md keep the everyday commands (`test`, `typecheck`,
`check`, `bench --hash`, `play`, `compare`, `sweep:remote`, `test:remote`) and a link. Rename the heading. First grep
skills, agents and docs for references to the CLAUDE.md commands list, and repoint them. Done when: CLAUDE.md is at
least 3k characters shorter, nothing that pointed at the old list is left dangling, and docs/tools.md is linked from
README.md.

### CL-41 · One workflow doc; AGENTS.md keeps only what is Codex-specific
`list: cleanup · status: ready · priority: low · size: M · area: tooling`

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

### CL-43 · Player persona agents share one body
`list: cleanup · status: ready · priority: low · size: S · area: tooling`

Source: codebase survey (2026-11-16). The four personas `.claude/agents/goal-mode-{player,cost-cutter,
cautious-operator,firefighter}.md` are 57–64 lines each, and 55 of those lines are the same in all four (rules of
engagement, the day loop, the log format). Only "## Style" differs. Change: put the shared part in docs/agents.md
("Persona rules"). Each persona keeps its front matter, a line telling it to read that section first, and its Style.
Check that `.codex/config.toml` and `.codex/agents/*` still load what they need. Done when: each persona file holds
only what is its own, and an agent playtest of one persona for one day (`goal-mode-player`, seed 42) still follows
the rules.

### CL-44 · Retire `pr-review-loop`
`list: cleanup · status: blocked: user · priority: low · size: S · area: tooling`

Source: codebase survey (2026-11-16). CLAUDE.md calls `pr-review-loop` "the older" review loop; `pr-fix-loop`
replaced it, but still parses its `<!-- pr-review-loop … -->` markers for PRs that were in flight. The skill is also
referenced from `.claude/skills/dev-loop`, `.claude/agents/pr-reviewer.md`, CLAUDE.md and AGENTS.md. Blocked on the
user: is any scheduled task still running it, and may it go? If yes: once no open PR carries its marker, delete the
skill, the marker handling in `pr-fix-loop` and the references.

### CL-45 · README: where to start; SPEC §15 freshness
`list: cleanup · status: ready · priority: low · size: S · area: tooling`

Source: codebase survey (2026-11-16). README.md's "Develop" section doesn't say what to read or in which order, and
it doesn't link CLAUDE.md, BACKLOG.md or docs/agents.md. SPEC §15 still calls parts of the stack "planned", and
describes `.claude/agents/` as "game-playing agent definitions", though it also holds the reviewers and fixers.
Change: a short "Where to start" block in README.md (play `npm run dev`, `npm run check`, SPEC §0–1, BACKLOG.md,
docs/tools.md and docs/agents.md, CLAUDE.md), a one-paragraph index of `docs/`, and SPEC §15 brought up to date.
Done when: every doc in the index exists, and no "planned" wording remains in §15 for things that are built.
