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

CPC lists CP rows only. Real Monitor III CPC has per-type groups with *CP / *ICF / *IIP and PHYSICAL lines (RMF Report
Analysis p.97–98; check the Monitor III CPC page with zos-docs). RT-05 adds pins on the CPC rows: whichever lands
second keeps the pin controls on the new layout. Done when: the browser and `play mon3 CPC` show the groups.

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
for RT-07 and RT-13: accepted answer sets and recipe scoring raise RCA scores, which feed the grade.

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
- Interim fixes: RT-20 replaces the `failureMechanism` path and RT-12 replaces the RT-03 `anySubject` image test;
  the replacing entry deletes the interim code path.

### RT-06 · Counterfactual validator for incident triggers
`list: rca-truth · status: ready · priority: high · size: M · area: tooling`

A headless tool (`npm run inspect -- <file> blame` or a `tools/` script) that, for each incident in a run, replays its
opening SLA hour from the kept state once per qualifying card with that card's `end` commands applied at the hour
start, and reports whether the SLA would then have been met. The sim is deterministic, so this is exact; it costs
an hour of sim per card per incident, so it stays offline (never in the worker or the game's truth). Output: per
incident, the game's trigger against the cards that were counterfactual causes, and a summary of disagreements
(docs/rca-design.md §4.8, Q10, moved earlier by the user). Run it now on seeds 1–5 of the three scenarios and put
the disagreement counts in the PR: that is today's baseline. Done when: the tool runs on play-CLI files, has a test
on a hand-built run with one causal and one bystander card, is in CLAUDE.md's command list, and RT-14 can use it as
its acceptance test.

### RT-07 · Accepted answers: score an RCA against a set, name the primary
`list: rca-truth · status: ready · priority: high · size: M · area: game`

Add `truth.accepted { mechanisms, triggers }` (always containing the primary) and `truth.cause`; `scoreRca` and the
evidence gate use membership; the RCA reply names the primary and "also accepted" with a line each. First sources of
accepted answers, none of which changes a primary: card-declared `alsoTriggers`/`alsoMechanisms` (table in §4.1), a
capacity-reducing card adds CPU_CAPACITY, a CPU incident inside the §4.3 bands adds the other side, DEPENDENCY from a
CPU-starved server adds CPU_PRIORITY, and no-card incidents accept both GROWTH and POLICY. No partial credit for
the right resource with the wrong refinement (user decision on Q1, 2026-11-10). Bots and bands are unaffected (scoring only). Done when: the playtest D12 answer
(`CPU_CAPACITY/HARDWARE_FAULT`) scores 5 on R-7's MOBILE incident, old saves load, SPEC §10 and §12 are updated.

### RT-08 · CAPPING is decided by one capped tick, not by 5 % of the hour
`list: rca-truth · status: ready · priority: low · size: S · area: game`

`accumulateHour` keeps `max(cappedFrac)` per LPAR and `mechanismOf` compares it with 0.05, so a single tick in which
6 % of an image's demand was cut makes the hour's CPU incidents CAPPING (A6, U-9). SPEC §10 says "capped over 5 % of
the hour". Accumulate the number of ticks in which the image was capped (`cappedFrac > 0`) and call it CAPPING when
that is at least 5 % of the hour's ticks; keep `cappedByLpar` readable for old saves; the batch night
(`addHour`) sums ticks. Put the 5 % in `content/incidents.ts`. Done when: a test with one capped tick in an hour
gets the CPU split, one capped for 10 % of the hour gets CAPPING, and a sweep shows the bands hold.

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

### RT-10 · Pin CF Activity and DASD Activity rows
`list: rca-truth · status: ready · priority: low · size: M · area: game`

CF_LINK, CF_FAILURE, F8, DASD_DEGRADED, HSM_RECALL_STORM and REORG_OVERRUN are told apart only in reports that have
no pin source (A11). Add `CF_SYNC` (structure or CF sync service time, µs; CF_SERVICE, HARDWARE_FAULT),
`CF_ASYNC_PCT` (requests converted to async; CF_SERVICE), `DASD_DISC`, `DASD_IOSQ` and `DASD_RESP` per LCU (ms; IO;
`DASD_DISC` also HARDWARE_FAULT, `DASD_IOSQ` also DEMAND_SURGE and BATCH_OVERLAP), pinned from an RMF interval of the
CF_DASD reports, subject the CF or LCU, counted as server-side clues for work that uses Db2 or does I/O. Notable
lines are FICTIONAL and go in `content/evidence.ts` (start at twice the scenario's day-0 value). Done when: pinnable
from the CLI and UI, tested, and listed in SPEC §10.

### RT-11 · Pin CICS region storage, top-consumer jobs and work-manager states
`list: rca-truth · status: ready · priority: low · size: M · area: game`

Three more clues the cards' texts name but the board cannot hold (A11): `SOS_MIN` (minutes short on storage in the
hour, from the SMF 110 region storage view; THREAD_LIMIT, STORAGE, APPLICATION_ERROR; notable 1), `JOB_APPL` (CPU of
one address space from the Monitor III job rows, subject the jobname; CPU_PRIORITY, CPU_CAPACITY, RUNAWAY_WORK;
notable 25 % of an engine), and the WLMGL work-manager states of a CICS transaction class (`WM_LOCK` waiting for
lock → LOCK_CONTENTION; `WM_READY` → CPU_PRIORITY, CPU_CAPACITY, QR_TCB at half weight; RMF Report Analysis
p.536–537). Done when: pinnable from the CLI and UI, tested, listed in SPEC §10.

### RT-12 · Pin relations instead of `anySubject`
`list: rca-truth · status: ready · priority: high · size: M · area: game`

User decision on Q3, 2026-11-10: yes. After RT-04. Each pin gets a relation to the incident (`self`, `server`, `competitor`, `host`) from the incident's
`subjects`; each metric says which relations it accepts; `anySubject` is removed; pins store the baseline beside the
value so a predicate can ask for "normal". RT-04's snapshot holds a server's jobname and image only: widen it if a
relation needs the region's role or subsystem. Done when: R-16's table comes out as §4.6 describes and the existing
evidence tests are ported. That includes the residual RT-03 leaves: a competing class's `DELAY_CPU` row on a host
image (R-16's TSO#1 on PROD2) still scores full weight from the image test alone, and only the relation plus §4.6's
discriminator can say whether that class was ahead of the hurt work.

### RT-13 · Proof recipes: evidence as a discriminating pair
`list: rca-truth · status: blocked: after RT-05, RT-07, RT-12 · priority: high · size: L · area: game`

User decision on Q3, 2026-11-10: yes. After RT-05, RT-07, RT-12. Recipes per mechanism and trigger in
`content/evidence.ts` (§4.6 table), judged over the up-to-three attached pins. Every common recipe (CPU family,
DEPENDENCY, DEMAND_SURGE, change regression, RUNAWAY_WORK) has a path that needs only tier-0/1 tools, so early-game
players can complete a proof. The CF, DASD and CICS-storage recipes need RT-10 and RT-11: whichever of RT-10, RT-11
and RT-13 lands last adds them; a complete recipe for the filed, accepted mechanism replaces today's
relevance sum, a second for the trigger makes the evidence strong; the reply shows each predicate ticked or not.
Done when: every mechanism and trigger has a recipe a test satisfies from a replayed incident, and one a test fails
with look-alike pins (surge against regression, capacity against priority), and a test shows a tier-0/1 path for
each common recipe.

### RT-14 · Card footprints: blame by resource and reach, fresh before background
`list: rca-truth · status: blocked: after RT-00, RT-02, RT-06, RT-07, WT-09, WT-10 · priority: high · size: L · area: game`

Sequencing (user decision 2026-11-10, docs/wlm-design.md §7): footprints are measured on the WLM core of `wlm-truth`
(WT-04 … WT-10), which changes which work a card hurts; building them first would redo them.

User decision on Q5, 2026-11-10: yes. After RT-00, RT-02, RT-06, RT-07. Replace `affects` matching with `footprint { resource, reach, direct }` on every card
(§4.4(1)), generalising PT-04's routing-based scope; rank direct before collateral, fresh before background, then
overlap, and accept both on a tie (no `uid` order); collateral victims accept the card's trigger and the fallback;
`disturbed` uses the footprint; BATCH is in reach like any workload; SMF_AUDIT gets a footprint. Moves truth
triggers: sweep. Done when: R-3, R-8 and R-9 give the card's trigger to the collateral incidents, U-1 … U-3 are
tests, RT-06's validator on seeds 1–5 of the three scenarios shows fewer disagreements than its baseline (remaining
ones listed in the PR), and SPEC §9 and §10 describe footprints.

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

After RT-08 and RT-07. Reporting-only sim fields for CPU wait per workload per LPAR and CP use by address-space role
(prove with `npm run compare --drop`); judge on the host with the most excess, on the pool that queued (zIIP);
displaceable CP instead of lower-importance CP; bands from `content/incidents.ts`; CAPPING also for a resource-group
maximum on the class or its server, with `DELAY_CAP` as its evidence (RMF Report Analysis p.540); the basis and
`mechanismExplanation` name the judged host (A4–A6). Moves truth mechanisms and `buyCapacityForIncidents`: sweep.
Done when: R-13 is CPU_PRIORITY/POLICY, R-2's basis names PROD2, U-9 … U-11 are tests, SPEC §10 and §17 are updated.
Cross-note (WLM audit 2026-11-10): WT-09 makes CICS regions' CPU belong to a server period; do this entry after
WT-09 and take "CP use by address-space role" and the hurt work's own servers from it (docs/wlm-design.md §7, §8 Q1).

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
(docs/wlm-design.md §7, §8 Q1).

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

After RT-07, RT-13, RT-14, RT-22 (and PT-20's design call, made with this one). Q8 is split (user, 2026-11-10):
Q8a decides problem records (RT-22), Q8b the gating itself, including whether arming a forewarned fix needs proof. Per-card unlock claims and recipes (§5.2) in content;
`visibleFixIds`/`armableEvents` require a filed diagnosis with a complete recipe; costs and limits of §5.4; hint
ladder of §5.5 with difficulty and Mentor; strategy bots diagnose from report data before fixing (§5.7). Balance: a
three-scenario sweep and a re-tune call on the main agent. Start with REGRESSION and XLOG_LOOP. Done when: SPEC §9
and §10 are rewritten for it, the sweep is recorded in PROGRESS.md, and the bands are restored or re-decided.

## wlm-truth

WLM policy adjustment: the work that makes the adjustment loop behave like IBM's description as one model. Source
for every entry: the WLM audit of 2026-11-10, [docs/wlm-design.md](docs/wlm-design.md) (finding ids W-n, repro ids
R-n, S-n, C-n, invariant ids I-n and section numbers are its). Entries are numbered in dependency order.
- **Sequencing against `rca-truth`** (user decision 2026-11-10, docs/wlm-design.md §7): the core WT-04 … WT-09 and
  WT-10 land after RT-06 (the counterfactual validator) and before RT-14 (card footprints), so footprints and
  balance are built once, on the WLM players will keep. Each of those PRs reports RT-06's validator differences.
  WT-01 … WT-03 change no behaviour and are ready; WT-12 changes no shipped behaviour and is ready.
- **One at a time.** Each `sim` entry: goldens regenerated with a "Behaviour change" note, `npm run bench` before and
  after (tick budget, SPEC §15), a three-scenario `npm run sweep:remote` (seeds 1–10, Normal) recorded in
  PROGRESS.md M8.2, and the realism policy (cite docs/wlm-design.md §3's pages in code comments).
- **Coupled core:** WT-04 and WT-08 are not to be split or delegated; the main agent implements them. WT-09 is
  cross-layer and stays on the main agent too. The single-rule entries (WT-05, WT-07, WT-10, WT-11, WT-12) may go to
  the Opus `realism-fixer` subagent, with the main agent reviewing and running the sweep (user decision on §8 Q7,
  2026-11-10; an exception to the rule that `sim` entries stay on the main agent).
- **Attended sessions** (user decision 2026-11-10): WT-04, WT-08 and WT-09 are not for `dev-loop`. Each is done in
  a session the user watches; that session sets the entry to `ready` when it starts. Their `after` dependencies
  still hold. With them gated, `dev-loop rca-truth,wlm-truth` reporting both lists finished means "WT-04's turn",
  not the playtest cue.
- **Coefficients** go to `src/content/wlm/tuning.ts` `POLICY_ADJUST` with `// FICTIONAL:` notes (names and starting
  values in §5.10); approximations get `// APPROX:` (§5.10 list). Do not tune a coefficient to move a balance band
  (§8 Q2).
- Statistics named in "Done when" are from `inspect … wlm-stats` (WT-01) on seed 42, Normal, no player actions:
  S-1 Midwest days 1–2, S-2 Revenue days 1–3, S-3 Harbourline days 1–3 (baseline numbers in §1).

### WT-01 · `inspect … wlm-stats`: policy adjustment statistics for a run
`list: wlm-truth · status: ready · priority: high · size: M · area: tooling`

Add a verb to `tools/inspect.ts`: `npm run inspect -- <file> wlm-stats [system] --from 'D1 06:00' --to 'D3 06:00'
[--ladder '12:00'] [--json]`. It replays the play-CLI file as `wlmText` does, with `setWlmTraceSink` installed for
the whole range, and prints per system and in total: adjustments; adjustments with no candidate; candidates by
outcome; trials by verdict; accepted moves (receiver-up, donor); rejected trials whose receiver's own-tick PI was
≤ 0.9 and `null`; moves reversed by the same period's next move; episodes of a candidate assessed 30 intervals
running without a move; and with `--ladder`, each system's DPs (hex, highest first) at that clock time each day.
Pure functions `wlmStats(traces)` and `statsText(stats)` exported for tests. Investigation tooling only (same
warning as `inspect wlm`). Add the command to CLAUDE.md's command list and the `wlm-why` skill. No sim change:
`npm run compare` reports no differences. Done when: `tests/tools/inspect.test.ts` covers `wlmStats` on a
hand-built trace list (each counter once), and the verb reproduces §1's table for S-1 within the same commit
(numbers pasted in the PR).

### WT-03 · SPEC text that disagrees with the code (W13, W14)
`list: wlm-truth · status: ready · priority: low · size: S · area: tooling`

Documentation only. SPEC §5.4: discretionary work runs at one priority (196); mean-time-to-wait and the
small-consumer priority are not modelled. SPEC §5.5.3: the sysplex PI is computed from the systems' accumulators
summed, not as an average of local PIs; the PI window is one exponential decay (0.85 per tick, about 67 s), not a
horizon that grows; transactions never show small-sample variability (fluid completions). SPEC §5.5.4: the three
PIs in use today (docs/wlm-design.md §2.4). SPEC §17: add rows "PI window" and "Small consumer, mean-time-to-wait"
(Not modelled). No code. Done when: the four places are corrected and cite docs/research.md.

### WT-04 · One PI basis: projections at sustained demand, `base` against `after` (W1, W8, W9)
`list: wlm-truth · status: blocked: user (attended session, after RT-06; start from proto/wlm-wt04) · priority: high · size: L · area: sim`

**Coupled core; main agent only.** Implements §5.2, §5.4 and the `receiverValue`/`netValue` tests of §5.3 on the
*existing* single-move trials (the plan is WT-08).
- `src/sim/wlm/runtime.ts`: `ScpAcc` gains `demandCp`, `demandZi` (decayed arriving demand in engines, without
  backlog) and `ziipEngines`; `decayInto` fills them from new `ScpTick` fields set in `eval/accounting.ts`
  (`periodTicks`, from the prepared slice demand before backlog). `ACC_DECAY` moves to `POLICY_ADJUST.accDecay`.
- New `projectionInput(evalInput, system, C)` (new file `src/sim/wlm/projection.ts`, pure): the per-period uplift
  `f` and the bounded backlog of §5.4.
- `src/sim/wlm/adjust.ts` `policyAdjust`: compute `base` lazily (one `evaluateLpar` on the projection input at the
  current DPs); replace `before` (this tick's PI) by `base` everywhere; a candidate with `base ≤ 1` or `null` is
  traced `RECOVERING` and gets no trials and no budget use; `receiverValue` gains the 0.05 floor; `NO_NET_VALUE`
  only when `equalHarm > 0`; `harmEps` applies to equal importance too. `RECEIVER_VALUE_FRAC`, `DONOR_CREDIT_FLOOR`
  and the literal 0.02 move to `POLICY_ADJUST`. `playerReason` gains "already recovering".
- Old saves: missing accumulator fields start at this tick's values.

Tests (named): `wlm-invariants: I8 one basis`, `I4 receiver value`, `I17 projection is honest at rest`, `I1
determinism` (shuffled `scps` and slices); `projection.test.ts`: uplift never below 1 and capped, backlog bounded,
caps and I/O untouched; realism `WLM does not flip a period on one quiet tick` (R-1: Midwest 42, PROD2, D1
12:19–12:23, DDFPRD#2 is not moved up while DDFPRD#1's smoothed demand would push it past its goal). Goldens:
change. Done when: on S-1 … S-3 "rejected trials whose receiver's own-tick PI ≤ 0.9" is 0 by construction (the
counter is replaced by `RECOVERING` candidates), moves "undone by the same period's next move within two minutes"
fall by at least 80 % in total (6, 6 and 19 on `dev`), and the misleading `gain 0.00 ≤ harm 0.00` line no longer
occurs.
**Prototyped 2026-11-10** on branch `proto/wlm-wt04` (no PR; docs/wlm-design.md §9): start
from it. It added one rule the first design lacked, now in §5.3: a less important receiver never moves to or above
more important work that is missing its goal (management PI or `base`) and uses the processor. Left for this entry:
measure the demand uplift and the backlog bound separately and drop what does nothing (§9.4 point 7); keep the strict
rule on a capped image (§9.4 point 5, user decision 2026-11-10) and keep the WLM log's "harms X, more important" for it; `acc.ziipEngines`; SPEC and research.md; the three-scenario sweep. Bots: small; do-nothing and textbook medians within
± 1 day expected. SPEC §5.5.3–§5.5.4 and §17 "Policy adjustment" and "Percentile PI in WLM projections" updated.

### WT-05 · Skip clocks, the delay test and a per-interval projection budget (W6)
`list: wlm-truth · status: blocked: after WT-04 · priority: high · size: M · area: sim`

Implements the candidate gates of §5.3. `ScpState` gains `skipUntilTick` (absent = 0; `dispatchLpar` in
`src/sim/core/tick/dispatch.ts` carries it over; `adjustPolicies` in `tick/control.ts` passes the tick and stores
the returned clocks). In `policyAdjust`: skip a candidate whose clock has not expired (`SKIP_CLOCK`); skip one with
`managedDelayFrac < needsHelpDelayFrac` (`NO_MANAGED_DELAY`, no clock); set the clock to `nowTick +
rejectedSkipTicks` when every trial of an assessed candidate was rejected; replace the per-importance budget by
`maxProjectionsPerInterval` counted over the interval (`BUDGET` when it runs out: no clock). Delete
`RECEIVERS_PER_IMPORTANCE` and `AdjustInput.receiversPerImportance`. The log's no-action note appends `next look
hh:mm:ss`. Tests: `wlm-invariants: I12 skip clock, no starvation` (five unfixable and one fixable candidate at one
importance: the fixable one is helped within 8 intervals), `I16 cost bound`; unit: clock set, honoured, cleared by
expiry; a helped receiver gets no clock (WLM Services p.149: helped again 10 s later). Goldens: change. Done when:
S-2's WEBDDF#1 is assessed at most once a minute while it cannot be helped (2 846 → under 500 assessments in three
days), "assessed 30 intervals running without a move" is 0 in S-1 … S-3, and R-4's MKTDDF#1 (PRDD, D1 14:17:40) is
assessed. Bots: none expected beyond WT-04. docs/research.md row "skip clock" → Modelled; SPEC §5.5.4 "Projection
budget" rewritten; `wlm-why` skill table updated for the new outcomes.
Since CL-05: the carry-over is `dispatchLpar`'s 12a loop, which matches last tick's period by position when the order
is unchanged (else by key); `skipUntilTick` is per-tick state and stays out of the lookup plan (`tick/plan.ts`).

### WT-06 · The canonical ladder: priorities are an order (W2, W10)
`list: wlm-truth · status: blocked: after WT-05 · priority: high · size: M · area: sim`

Implements §5.6. New pure module `src/sim/wlm/ladder.ts`: `ladderOf(dps)`, `canonical(ladder)`,
`raiseOneStep(ladder, holder)`, `moveToLevel(ladder, holder, level | 'below')`, `placeNew(ladder, holder,
importance, info)`. `initialDp` (`runtime.ts`) and the first-seen path in `dispatchLpar` use `placeNew` on the
canonical form; `policyAdjust` ends with `canonical`; `enforceCpuProtection` works on levels. Receiver-up trials
become "one step" and "join the next level" for up to three levels (still single moves until WT-08); donor trials
move the donor to the receiver's level, or just below it if already there (WLM Services p.705, code 531). No goal
period is ever at `DP.MANAGED_MAX`, so `RG_MIN_DP` (252, `eval/grants.ts`) is above all goal work as its comment
says. Renumber in this entry (user decision on §8 Q5, 2026-11-10): `DP` in `zos/dispatcher.ts`, small consumer 248,
managed 247–203 (SG24-6472 p.65, "as of z/OS 1.8"; Enrico slide 49, practitioner), 249–253 for the minimum share
and promotion; research.md's "Dispatch priorities" row gives both Redbooks and the reason for preferring the dated
table. Old saves: the
ladder is made canonical on the first interval (order preserved). Tests: `ladder.test.ts` (canonical is idempotent
and order-preserving; `raiseOneStep` splits or joins; `placeNew` by importance); `wlm-invariants: I9 canonical
ladder`, `I10 CPU protection`, `I15 minimum above goal work` (C-4); realism `the ladder does not collapse` (S-4:
Midwest 42, eight days, PROD2 at D8 12:00 has its goal holders on at least four levels and nothing at
`MANAGED_MAX`). Goldens: change (every DP). Done when: those pass and R-4's shape (an importance-4 period on the top
level on day 1) needs a logged plan that put it there. Bots: this is the entry that moves the bands (§6.2):
do-nothing ± 3 days, Harbourline most; expert Harbourline up. Record the sweep; an out-of-band median is a `balance`
entry, not a reason to change the ladder. SPEC §5.4 (DP table), §5.5.4, §17 "DP ranges" updated; research.md rows
"unbunching" and "dispatch priorities" updated.
Since CL-05: the first-seen path is the `dpOf` fallback in `imageInput` (`tick/dispatch.ts`), built once per image per
tick; DPs are per-tick state, so `placeNew` belongs there, outside the lookup plan.

### WT-07 · Donors in IBM's order, by the processor that is short (W4)
`list: wlm-truth · status: blocked: after WT-06 · priority: high · size: S · area: sim`

Implements §5.5 `donorOrder` in `src/sim/wlm/adjust.ts` (pure, exported): pool = holders at or above the receiver
using at least `donorMinEngines` of the bottleneck's processor (smoothed: `acc.cpuEngines` for CPU,
`acc.ziipEngines` for zIIP, × (1 − decay)); happy holders first by lowest `max(mPlex, mLocal)`, importance
ignored; then the rest from importance 5 up, lowest PI first; an unhappy holder more important than the receiver is
left out; first `donorsPerReceiver`. Tests: `wlm-invariants: I7 donor order`; unit C-2 (zIIP bottleneck: a period
with 2 zIIP engines and no CP is a donor, one with 0.2 CP and no zIIP is not); unit "an over-achieving importance-1
period is tried before a struggling importance-4 one"; realism `a more important class is not pushed past its goal
as a donor` (I5). Goldens: change. Done when: R-1's donor list for DDFPRD#1 starts with the happy period of lowest
PI and does not include Db2's class while it is missing its goal. Bots: small; importance-4 and -5 work is hurt
less, over-achieving work more. research.md row "donor order" → Modelled.

### WT-08 · A change is a plan: receiver up, secondary receivers, donors down, judged together (W5)
`list: wlm-truth · status: blocked: user (attended session, after WT-07) · priority: high · size: L · area: sim`

**Coupled core; main agent only.** Implements `buildPlan`, `assess` and whole-plan `netValue`/`receiverValue` of
§5.3 in `src/sim/wlm/adjust.ts`, replacing the trial list. A plan alternates receiver steps (one ladder step; on a
net value failure by a period left at or below the receiver that is not less important, carry that period to the
receiver's level and assess once more) and donor moves (kept only if they lower the receiver's projected PI);
receiver value is tested on the whole plan against `base`; a rejected plan leaves the ladder untouched;
`maxPlanSteps` and the interval budget bound it. `AdjustOutput.log` lists the plan's moves; `WlmCandidateTrace`
records steps (`UP`, `CARRY k`, `DONOR d`) with `base → after` and the rejecting period. `playerReason` unchanged
in wording. Tests: `wlm-invariants: I2 one change per interval`, `I4`, `I5 no harm to more important work`, `I6
equal-importance convergence`, `I13 settles` (constant demand: no move after 30 intervals, no reversal), `I16`;
unit "secondary receiver is carried" (the Redbook's shape: I, H at one level, moving I alone fails net value on H,
moving both passes; SG24-6472 p.67); unit "a failing donor stays, the next is tried"; unit "a plan without receiver
value changes nothing". Goldens: change. Done when: in S-1 and S-3 the share of `MORE_IMPORTANT_HARMED` among
assessed steps falls below half its baseline (58 %, 42 %), "reversed by its next move" is at most 20 % of §1's
baseline in each of S-1 … S-3, and the existing equal-importance realism test (Midwest seed 7, PROD1 defined
capacity 200) still passes. Bench: tick time not above the WT-07 commit by more than 5 %. Bots: textbook 0 to + 2
days, others small. SPEC §5.5.4 pseudocode replaced by §5.3's; §17 "Policy adjustment" row rewritten; research.md
rows "CPU move is projected for every class…", "secondary receivers" updated.

### WT-09 · Server periods hold the regions' priority (W3)
`list: wlm-truth · status: blocked: user (attended session, after WT-08) · priority: high · size: L · area: sim`

**Main agent (cross-layer).** Implements §5.1 holders and §5.8. `WlmSystemState.servers` (`runtime.ts`);
`cicsRegions` (`tick/helpers.ts`) returns `serverKey` (`$SRMS001`) when any AOR on the image is TRANSACTION;
`evaluateLpar` (`evaluate.ts`) takes `txnDp` from the server period instead of the maximum over `reg.keys`;
`policyAdjust` maps a goal period to its holder for ladder, plan and `donorOrder` (a server period's goal periods are
the classes it serves; `worst` and `imp` per §5.5); served periods' stored `dp` is written from the holder; the log
names `(regions $SRMS001)` (§8 Q4). The region class keeps its PI without server regions' samples and is not on the
ladder while it has no other member with samples. Old saves: `servers` created with the highest DP among served
periods. Reporting: WLMGL/Monitor III DP of a served class is its holder's (no layout change). Tests:
`wlm-invariants: I11 one priority per server` (C-3 a, b, c); realism `the free ride` (an importance-3 CICS class in
regions that also serve a missing importance-1 class runs at the same DP and improves with it; SG24-6472 p.63);
realism `the region class's goal does not move the regions` (R-2: STCHI is not a receiver for its CICS regions).
Goldens: change. Done when: R-2 shows no `STCHI#1` move for the regions and ONLMED's reported DP equals ONLHI's on
PROD2. Bots: CICS-heavy scenarios (Harbourline) move; record the sweep. Cross-note: **RT-16** ("CP use by
address-space role", displaceable CPU) and **RT-19** (region CPU wait joins the CPU group) read the same topology;
do them after this entry and take the regions' CPU from the server period (§8 Q1). SPEC §5.5.1 (region management),
§5.6, §17 "CICS region management"; research.md rows on region management updated; Codex entry *server topology
and the free ride*.
Since CL-06: `cicsRegions` is built once per lookup plan (`regionsOf` in `tick/plan.ts`, called from `imageInput` in
`tick/dispatch.ts`) and may only read slice template fields; `serverKey` belongs there, while the server period's DP
and other per-tick region state stay out of the plan.

### WT-10 · Managed bottlenecks in turn; waits are not delays (W7)
`list: wlm-truth · status: blocked: after WT-05 · priority: low · size: S · area: sim`

Implements §5.7 in `adjust.ts`: `bottleneckOf` is replaced by `managedDelayFrac(acc)` and
`fixableBottlenecks(acc, C)`; `delayOther` leaves the comparison; CPU and zIIP are tried in order of delay when
each is at least `bottleneckMinFrac` of the managed delay, even when I/O, storage or cap is larger. `ScpAcc` gains
decayed `delayStorage` and `delayQueue` (today only in the `delay` total). The no-action note for a period that is
mostly waiting reads `mostly waiting, CPU delay n %: not WLM-fixable`. Tests: `wlm-invariants: I14 not fixable, not
moved`; unit "45 % other, 40 % CPU delay: a CPU plan is tried"; the existing realism test "Db2 MSTR starvation
raises DDF response time without raising DDF CPU delay" still passes and its log line has the waiting note.
Goldens: change. Done when: S-3's "not assessed: bottleneck OTHER / I/O" (5 291 / 4 208) are replaced by
`NO_MANAGED_DELAY` or assessed candidates, with the counts in the PR. Bots: small. Cross-note: **RT-19** splits the
same waits (`serverCpu`, `serverOther`) for RCA truth; share the per-period split rather than computing it twice.

### WT-11 · The resource-group minimum for discretionary work (W10)
`list: wlm-truth · status: blocked: after WT-06 · priority: low · size: S · area: sim`

Implements §5.8 in `rgMin` and `missingGoal` (`src/sim/core/tick/helpers.ts`) and `grantDispatch`
(`eval/grants.ts`): a group is below its minimum and wanting when its smoothed CP service is under the minimum and
a member has CPU delay (replaces `delay > using` for discretionary members); a discretionary member's share is
dispatched at the minimum's priority while no goal period outside the group has local PI > 1, else just below the
managed range as today. Cite SG24-6472 p.63 (receiver order, cases 1–3) and WLM Planning p.57. Tests: unit
"discretionary minimum is served ahead of work meeting its goals", "… and yields while a goal period misses";
existing resource-group tests. Goldens: unchanged unless a scenario gains a minimum (none ships one); say so.
Done when: the two unit tests pass and the PROGRESS open question is removed. Bots: none (no policy uses a
minimum).

### WT-12 · Response-time goals for batch: jobs are completions (W11)
`list: wlm-truth · status: ready · priority: low · size: S · area: sim`

User decision on §8 Q6, 2026-11-10: model job completions, and warn in the editor.

Implements §5.8. In `dispatchLpar` (`src/sim/core/tick/dispatch.ts`), a job ending this tick adds one completion,
its response time (queued + elapsed, as `stepRmf`'s `JobEndRecord` computes) and one bucket entry to the `ScpTick`
of the period it ended in, when that period has a response-time goal. The policy editor (`src/game/wlmEdit.ts`
warnings) notes on a JES class with a response-time goal: "needs at least three completions per 20 minutes (WLM
Planning p.71); with fewer the PI is erratic". Tests: unit "a batch class with an average goal has a PI after a job
ends and none 25 minutes later"; unit for the warning. Goldens: unchanged (no shipped policy gives batch a
response-time goal); prove with bench hashes. Bots: none. Codex: one line in the goals entry.

### WT-14 · Receivers that meet their goals; small consumers; mean-time-to-wait (W2, W13)
`list: wlm-truth · status: blocked: playtest (after WT-15; docs/wlm-design.md §8 Q3, Q8) · priority: low · size: M · area: sim`

Parked (user decisions on §8 Q3 and Q8, 2026-11-10: not now; SPEC is corrected by WT-03). IBM's receiver order ends with periods meeting their goals, largest PI first (SG24-6472 p.63), which keeps
the order improving when nobody misses; small consumers sit above the managed range and are neither receivers nor
donors (WLM Services p.138); discretionary work is spread over 192–201 by mean time to wait (SG24-6472 p.66). Not
modelled today (docs/wlm-design.md §5.10 approximation 5). Unblock only with a playtest finding that a stale order
or equal-priority discretionary work misleads players.

### WT-15 · Codex, SPEC, the `wlm-why` skill and the closing sweep
`list: wlm-truth · status: blocked: after WT-09 · priority: high · size: M · area: content`

Codex entries (`src/content/codex/`) with source links: *donors and net value*, *skip clock*, *dispatching
priorities and unbunching*, and a revised policy adjustment entry (one receiver, a plan of several moves, why "no
action"). `.claude/skills/wlm-why/SKILL.md`: the verdict table for the new outcomes and plan steps. SPEC §5.5.4,
§16 (the invariants as realism tests) and §17 read as one description of the model of docs/wlm-design.md §5, and
that document's status line says what is implemented. Then a 20-seed three-scenario sweep (`npm run sweep:remote`,
Normal), recorded in PROGRESS.md M8.2 against the bands, with out-of-band medians filed as `balance` entries.
Done when: the sweep table is in PROGRESS.md and every finding W1 … W11 in docs/wlm-design.md §4 is marked fixed,
parked or declined.

## pr-followups

Non-blocking findings from the reviews of #178–#185 (2026-11-04), each still present on `dev` at 7fbeffa.

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

### PR-04 · Planned-policy labels
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #178. CLASSIFY flags the planned policy only as `pending` (`src/worker/game.worker.ts` CLASSIFIED); the play CLI
`status` and `policy` output don't show the planned (queued or briefing) policy at all. Done when: both show it.

### PR-05 · The import dialog reads its result from toast wording
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #181. The dialog (`src/ui/RunFiles.tsx`) matches `Loaded run:` / `Import failed:` toast text. Since #185,
`submittedToast.current = toast` (after the confirmation wait) stores the toast from before the prompt opened, which is
harmless only because results are matched by prefix. Give the worker an explicit import-result message.
Done when: the dialog no longer reads toasts.

### PR-06 · Closing during an in-flight import still replaces the run
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #181, after the player has already confirmed. Done when: closing the dialog cancels the import, or the dialog
can't be closed until the import ends.

### PR-07 · The open modal scrolls with the page
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #181. `.modal { position: relative }` in `src/ui/styles.css`: the open modal dialog computes to position absolute
and scrolls with the page instead of staying fixed. Done when: it stays fixed (check at phone width).

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
Cross-note: the `wlm-truth` core (WT-04 … WT-09) changes how equal-priority crowding arises (docs/wlm-design.md W2,
§6.2); tuning before WT-09 would be redone (§8 Q2).

### BL-02 · Revenue: do-nothing survives close to textbook
`list: balance · status: blocked: after RT-14 · priority: low · size: M · area: content`

Release sweep 2026-11-10: do-nothing median day 19 (p10 16, p90 23), textbook 27, expert 10/10. Do-nothing is inside
its 8–22 band (it moved there with #167's G1 retune), but the gap to textbook is 8 days against Midwest's 11 and
Harbourline's 19.5, so diagnosing earns less on Revenue. The textbook PREFILL losses around day 22 (PROGRESS.md
M8.2 follow-ups) belong here too. Decide whether the spread is wanted; if not, tune G1/G2 pressure or the deadline
week. Done when: a 20-seed three-bot Revenue sweep and the decision are recorded in PROGRESS.md M8.2.
Cross-note: as BL-01, tune after WT-09 (docs/wlm-design.md §6.2, §8 Q2).

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
