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
- **RT-00 … RT-15 are the committed work.** RT-16 … RT-21 wait for a human playtest after RT-15: the list "finishing"
  in `dev-loop` (only blocked entries left) is the cue for that playtest. RT-14 waits for the `wlm-truth` core
  (WT-04 … WT-10, user decision 2026-11-10): run `dev-loop rca-truth,wlm-truth`, or `rca-truth` alone stops at RT-14
  and "finishes" before RT-14 and RT-15 are done, which is not the playtest cue. RT-22 … RT-24 are D1 and wait for the user.
- Entries that move truth labels (RT-02, RT-09, RT-14 and the `sim` entries) need a three-scenario
  `npm run sweep:remote`, because the strategy bots read `inc.truth` (docs/rca-design.md §4.8). One at a time.
- Interim fixes: RT-20 replaces the `failureMechanism` path; RT-12's relation test has replaced the RT-03 `anySubject`
  image test.

### RT-09 · Trigger and mechanism wording: "Change regression" (renamed id), "Policy or configuration"
`list: rca-truth · status: blocked: after RT-00 · priority: low · size: M · area: content`

User decision on Q2, 2026-11-10: yes, and rename the trigger id (user, 2026-11-10): `ACCESS_PATH_REGRESSION` becomes
`CHANGE_REGRESSION`, shown as "Change regression", because once other cards move to it the old id is a misnomer
that agents type in the play CLI and read in `--json` output. Other entries and docs that say
`ACCESS_PATH_REGRESSION` mean this trigger; this PR updates every mention (code, BACKLOG.md, docs/rca-design.md,
SPEC, Codex). §4.4(5):
- Rename the id everywhere in `src/`, `tools/` and `tests/`. Saves map the old id on load (incidents, filed RCAs,
  active cards). The play CLI's `rca` argument and command-log replay accept the old id as an alias, so older play
  files replay unchanged.
- Move ENCRYPTION_MANDATE, MONITOR_CREEP, QR_RELEASE, ZIIP_LOSS and SMF_AUDIT to `CHANGE_REGRESSION`. `POLICY` is
  shown as "Policy or configuration" (label only). Widen STORAGE's and CAPPING's help.
- This changes those cards' truth trigger, so goldens are regenerated with a Behaviour note and a three-scenario
  sweep is run (RT-00 keeps the bots' fix choice independent of the label).

Done when: `tests/game/rcaVocabulary.test.ts` covers the new texts, the Codex entries agree, a test loads a save and
replays a play file written with the old id and gets the same state, and no `ACCESS_PATH_REGRESSION` remains outside
the aliases.

### RT-13 · Proof recipes: evidence as a discriminating pair
`list: rca-truth · status: ready · priority: high · size: L · area: game`

User decision on Q3, 2026-11-10: yes. After RT-12. Recipes per mechanism and trigger in
`content/evidence.ts` (§4.6 table), judged over the up-to-three attached pins. Every common recipe (CPU family,
DEPENDENCY, DEMAND_SURGE, change regression, RUNAWAY_WORK) has a path that needs only tier-0/1 tools, so early-game
players can complete a proof. The CF and DASD recipes use RT-10's `CF_*`/`DASD_*` pins and the CICS-storage one
RT-11's `SOS_MIN` (all landed). A complete recipe for the filed, accepted mechanism replaces today's
relevance sum, a second for the trigger makes the evidence strong; the reply shows each predicate ticked or not.
Note: `ENDED_RATE` is `self`/`server` only today, so the DEMAND_SURGE recipe's "on the surging workload" and §4.4's
collateral-victim surrogate (a co-hosted workload's rate) need it widened to `competitor` here.
Done when: every mechanism and trigger has a recipe a test satisfies from a replayed incident, and one a test fails
with look-alike pins (surge against regression, capacity against priority), and a test shows a tier-0/1 path for
each common recipe.

### RT-14 · Card footprints: blame by resource and reach, fresh before background
`list: rca-truth · status: blocked: (needs user-attended session) · priority: high · size: L · area: game`

Sequencing (user decision 2026-11-10, docs/archive/wlm-audit-2026-11.md §7): footprints are measured on the WLM core of `wlm-truth`
(WT-04 … WT-10), which changes which work a card hurts; building them first would redo them.

User decision on Q5, 2026-11-10: yes. After WT-09 and WT-10 (WT-10 landed 2026-11-12). Replace `affects` matching with `footprint { resource, reach, direct }` on every card
(§4.4(1)), generalising PT-04's routing-based scope; rank direct before collateral, fresh before background, then
overlap, and accept both on a tie (no `uid` order); collateral victims accept the card's trigger and the fallback;
`disturbed` uses the footprint; BATCH is in reach like any workload; SMF_AUDIT gets a footprint. Moves truth
triggers: sweep.
Tests are built fixtures (a card, a footprint, an incident with a given mechanism on a given host), not replayed seed
incidents: those move with every WLM change (WT-09 moved RT-06's online incidents 0/1/14 → 0/2/16). R-3, R-8 and R-9
are checked once with the validator and the result recorded in the PR, not kept as standing assertions. Each
validator disagreement is classified: **footprint wrong** (the card loaded its resource on the hurt work's host or
its servers' hosts, and the footprint leaves it out, or the reverse) or **path effect** (the gain comes from a
changed WLM path, e.g. sysplex PIs, with the card's resource not loaded where the work waited); only the first
counts. Done when: U-1 … U-3 and the footprint fixtures are tests, R-3, R-8 and R-9 give the card's trigger to the
collateral incidents (validator output in the PR), the validator (RT-25) on seeds 1–5 of the three scenarios shows
fewer footprint-wrong disagreements than RT-25's baseline (path effects listed in the PR), and SPEC §9 and §10
describe footprints.

### RT-15 · Group incidents by cause, not by equal labels
`list: rca-truth · status: blocked: after RT-14 · priority: high · size: M · area: game`

User decision on Q4, 2026-11-10: yes, with two refinements. After RT-14 (before footprints, collateral victims
have no card cause and would still split off). `rcaGroup` links incidents with the same `truth.cause`: for a card
cause, any incident of the same played day; for the other causes (`new:`, `change:`, `none:`), incidents that
overlap or follow within two hours. The group's accepted set is the union; an incident inherits a filed RCA only for the same card `uid` (A13). Done when:
R-7 is one group, R-9's 13:00 incidents do not inherit a 10:00 RCA, R-6's batch night does not join the midday
incident unless the card reached it, a 48-hour MONITOR_CREEP hurting MOBILE at 09:00 and RBANK at 15:00 is one group,
and `tests/game/groupedRcaEvidence.test.ts` is updated.

### RT-16 · CPU split on the host of the delay, by displaceable CPU, with bands
`list: rca-truth · status: blocked: playtest (after RT-15; docs/rca-design.md §4.3, Q7) · priority: high · size: L · area: sim`

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
`list: rca-truth · status: blocked: playtest (after RT-15; docs/rca-design.md §4.4(4)) · priority: low · size: M · area: game`

After RT-14 and RT-17. DEMAND_SURGE without a card when arrivals are ≥ 1.25 × the slot baseline (payday, month-end,
deadline week); POLICY primary, naming the change, when a player change in the last 24 h touched a lever of the
winning mechanism on the judged host; new-work collateral for two days. Thresholds in `content/sla.ts`. Moves truth
triggers: sweep. Done when: a Revenue deadline-week incident is DEMAND_SURGE and R-14/R-15 replies name the change.

### RT-19 · Server CPU starvation and the thread-limit reference
`list: rca-truth · status: blocked: playtest (after RT-15; docs/rca-design.md §4.2(3)) · priority: low · size: M · area: sim`

After RT-17. Split the `dependency` part into `serverCpu` and `serverOther` (reporting-only); region CPU wait joins
the CPU group, other servers' CPU starvation stays DEPENDENCY with the CPU refinement accepted; THREAD_LIMIT is
credited with the queue at the baseline hold time, not the unqueued time (R-15). Sweep (`tunePolicyIncidents` reads
THREAD_LIMIT). Done when: R-15's 20:00 incident is THREAD_LIMIT/POLICY and R-14 is one CAPPING group.
Cross-note (WLM audit 2026-11-10): WT-09 (server periods) and WT-10 (waits are not delays) change the same
per-period split of region CPU wait and other waits; do this entry after them and share one split
(docs/archive/wlm-audit-2026-11.md §7, §8 Q1). WT-10 (landed 2026-11-12) keeps WLM's split in `adjust.ts`: `managedDelays` (CPU,
zIIP, I/O in velocity, storage, queue) and `waitingFrac` (waits over all samples); reuse them.

### RT-20 · Failure-only misses from the failure's source, not from a card
`list: rca-truth · status: blocked: playtest (after RT-15; docs/rca-design.md §4.2(4)) · priority: low · size: M · area: sim`

After RT-01. Record failed transactions by source per workload (slot-queue timeout, region abend, Db2 or MQ
unavailable, backlog timeout; reporting-only) and map them to THREAD_LIMIT, ROUTING, DEPENDENCY and the CPU family;
`failureMechanism` on cards goes away (U-12). Done when: SICK_AOR is ROUTING without the card field and a
MAXCONQW-style DBAT timeout hour is THREAD_LIMIT.

### RT-21 · BATCH incidents under the same rules
`list: rca-truth · status: blocked: playtest (after RT-15; docs/rca-design.md §4.4) · priority: low · size: M · area: game`

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

### PR-01 · A scheduled activation overrides a queued install
`list: pr-followups · status: ready · priority: high · size: S · area: game`

From the #179 review. `advance` pushes the policy-schedule activation after `pendingCommands` in the same tick
(`src/game/run.ts` `scheduledActivation`). So if the game is paused on an hour with a schedule entry (including 06:00
at day start), the scheduled policy replaces the player's queued install while the editor still says "Queued for next
tick: X". Show the scheduled entry in `plannedPolicy`, or apply the schedule before player commands.
Done when: the editor and the outcome agree, with a test.

### PR-02 · Cancel B then A leaves A's edit pending silently
`list: pr-followups · status: ready · priority: low · size: S · area: game`

From #180. A's edit stays in the pending policy and A's cancel message doesn't say so (also true before #180; the
edits are uninstalled and visible). Done when: the message says so.

### PR-03 · A suppressed install failure is silent
`list: pr-followups · status: ready · priority: low · size: S · area: game`

From #180. When a later install succeeds after an earlier one failed at day start, the play CLI's day-start text and
the mail don't say that the earlier install's edits went live through the later one. Done when: both say so.

### PR-08 · One unstyled frame on programmatic close
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #183. The `modal` class drops when state resets but `el.close()` runs in a passive `useEffect`; `useLayoutEffect`
would avoid the frame. `close()` also runs twice on cancel (harmless).

### PR-09 · No automated test for the dialog lifecycle
`list: pr-followups · status: ready · priority: low · size: M · area: ui`

#181/#183/#185 were verified by hand with Playwright. Cover the save dialogs and the in-app confirmation
(`src/ui/Confirmation.tsx`): open, close, Escape, reopen, delayed close events, confirm/cancel.

### PR-10 · Confirmation polish
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #185. During a file import the button still reads "Reading file…" while the prompt is open; the confirm button has
no primary/danger styling.

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
`list: balance · status: blocked: after RT-14 · priority: low · size: M · area: content`

Release sweep 2026-11-10 (dev `1300e69`, Normal, seeds 1–10): expert 5/10. All five losses are trust losses, mostly
on Markets (seeds 1, 2, 4, 7, 9); seed 4 (day 38) is new against the 6/10 the user accepted. Harbourline is gated
against Midwest's bands for reference only. The user accepted 5/10 for the release. Find why Markets trust runs out
for an expert player (event mix, Markets SLA tightness, the expert bot's blind spots such as never raising Db2 above
CICS) and decide whether to tune content or the bot. Done when: a 20-seed three-bot Harbourline sweep is recorded in
PROGRESS.md M8.2 with the decision, and any content change carries `// FICTIONAL:` notes.
Cross-note: the `wlm-truth` core (WT-04 … WT-09) changes how equal-priority crowding arises (docs/archive/wlm-audit-2026-11.md W2,
§6.2); tuning before WT-09 would be redone (§8 Q2).

### BL-02 · Revenue: do-nothing survives close to textbook
`list: balance · status: blocked: after RT-14 · priority: low · size: M · area: content`

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
