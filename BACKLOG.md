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
  in `dev-loop` (only blocked entries left) is the cue for that playtest. RT-22 … RT-24 are D1 and wait for the user.
- Entries that move truth labels (RT-02, RT-09, RT-14 and the `sim` entries) need a three-scenario
  `npm run sweep:remote`, because the strategy bots read `inc.truth` (docs/rca-design.md §4.8). One at a time.
- Interim fixes: RT-01 is replaced by RT-20 and RT-03 by RT-12; the replacing entry deletes the interim code path.

### RT-00 · Bots look up a card's fix by card, not by the incident's trigger
`list: rca-truth · status: ready · priority: high · size: S · area: tooling`

`obviousHourly` (`tools/strategies.ts`) applies a fix when a running card's trigger equals the incident's and takes
the fix from `FIX_BY_TRIGGER` (`RUNAWAY_WORK` → `CANCEL_RUNAWAY`, `ACCESS_PATH_REGRESSION` → `REBIND_REVERT`), plus
the `FIX_BY_AGENCY_CARD` exception. Bot behaviour then depends on trigger labels: once RT-09 moves
ENCRYPTION_MANDATE, MONITOR_CREEP, QR_RELEASE, ZIIP_LOSS and SMF_AUDIT to `ACCESS_PATH_REGRESSION`, the bots would
request `REBIND_REVERT` while those cards run, a fix that ends none of them. Replace both maps with an explicit set
of the card ids the textbook/expert "obvious" rule fixes today (every card, in all three decks and adaptations,
whose trigger is `RUNAWAY_WORK` or `ACCESS_PATH_REGRESSION`), taking each card's own `fix` from its definition. Source:
review of what RT changes do to the bots (2026-11-10). Done when: the set is listed in the code with a comment on
why it is frozen, `npm run compare` shows no difference on the three scenarios, and a three-scenario sweep (seeds
1–10) matches the 2026-11-10 reference in PROGRESS.md M8.2 exactly.

### RT-01 · A card fixed or expired inside the hour loses its `failureMechanism`
`list: rca-truth · status: ready · priority: high · size: S · area: game`

`failureMechanismOf` (`src/game/sla.ts`) needs the card `started && !ended` at hour close, so a storm drain recycled
at 10:48 is judged `QR_TCB/POLICY` instead of `ROUTING/POLICY` (A7, U-8, R-11). Give it the hour and use the same
half-open overlap test `triggerOf` uses (active at any time during the opening SLA hour). Update SPEC §10. Done when:
a test builds a SICK_AOR ended 50 minutes into the hour and gets ROUTING, one ending exactly at the hour's start
gets `null`, and a card that expired inside the hour is covered too. Interim: RT-20 replaces `failureMechanism`
with failure sources and deletes this path.

### RT-02 · Every card that can be blamed declares its `mechanisms`
`list: rca-truth · status: ready · priority: high · size: S · area: content`

Cards with `affects` but no `mechanisms` are blamed for incidents of any mechanism (A3: U-2 a 30-hour REGRESSION
takes an I/O incident from a DASD fault, U-4 a RETRY_STORM takes a lock incident). Declare them:
- CAMPAIGN, BOT_ATTACK, RETRY_STORM, MARKET_OPEN_SURGE, HOLIDAY_CARD_SPIKE, RUNAWAY, REGRESSION, XLOG_LOOP,
  ENCRYPTION_MANDATE, MONITOR_CREEP, SHADOW_IT: `CPU_CAPACITY, CPU_PRIORITY, CAPPING, DEPENDENCY, THREAD_LIMIT`
  (more arrivals or more CPU per transaction also lengthen the unqueued service time the thread-limit rule uses);
- ZIIP_LOSS: add `CPU_PRIORITY, CAPPING, DEPENDENCY` to its `CPU_CAPACITY` (U-6);
- CF_LINK and CF_FAILURE: `CF_SERVICE, LOCK_CONTENTION, DEPENDENCY, CPU_CAPACITY, CPU_PRIORITY` (slow sync requests
  cost z/OS CPU; a lost structure fails Db2 work);
- SICK_AOR: `ROUTING`; NEW_APP_GOLIVE: every mechanism except `JOB_FAILURE` (the new work is the cause whatever it
  waits for).
Leave SMF_AUDIT (empty `affects`) to RT-14. Adapted cards inherit. Done when: a content test fails for any card in
the three decks with non-empty `affects` and no `mechanisms`; `tests/game/incident-triggers.test.ts` covers U-2 and
U-4; SPEC §10 says the list is mandatory; goldens regenerated if they move, with a Behaviour note and a sweep.

### RT-03 · Pins from systems the hurt work does not run on count as evidence
`list: rca-truth · status: ready · priority: high · size: S · area: game`

`anySubject` metrics (`APPL`, `DELAY_CPU`, `LOCK_WAIT`, `CF_WAIT`) skip the "about the hurt workload" test, so WLMGL
SYSP SYSTEM#1 APPL 3.4 % and PROD2 TSO#1 CPU delay score for a MOBILE incident (A9, R-16). In
`judgeEvidenceRanked` an `anySubject` pin must still come from an image the incident's work runs on (`p.system` in
the incident's LPARs, or `*PLEX`); otherwise "not on a system MOBILE runs on". Give `APPL` a notable line of 5 %
(`content/evidence.ts`). Interim: RT-12 replaces the test with pin relations and removes it. Done when: `tests/game/evidence.test.ts` has the two R-16 pins
scoring 0 and a competing class on a host image still scoring.

### RT-04 · Evidence is judged against today's classification and routing
`list: rca-truth · status: ready · priority: high · size: M · area: game`

`judgeEvidenceRanked` classifies the workload with the current service definition and reads the current routing, so
moving the hurt work to its own class or another image before the review turns good pins into "not about X" (A10,
R-16). When an incident opens (`closeHour`, `batchMissIncident`), store what the judge derives today (service
classes including region classes, host LPARs, serving AOR jobnames) on the incident as `subjects`, and judge against
that; fall back to the live values for incidents without it (old saves). Done when: a test pins a class row, applies
`ADD_CLASS` + `ADD_RULE` for the workload and a `SET_ROUTING`, and gets the same verdicts as before the edits; SPEC §10
says evidence is judged against the incident's own subjects.

### RT-05 · Pin CPC busy, image busy, the capacity change and the CP/zIIP split
`list: rca-truth · status: ready · priority: high · size: M · area: game`

The facts that separate capacity from priority, and the clues of POWER_CAP and ZIIP_LOSS, cannot be pinned (A11).
Add metrics and pin requests (play CLI `pin`, and the existing pin control on those report rows):
- Partition Data and Monitor III CPC: `CPC_BUSY` (general-CP busy % of the CPC; CPU_CAPACITY; notable 90),
  `LPAR_BUSY` (image's use of the CP available to it; CPU_CAPACITY; notable 95), `CAPACITY_ADJ` (100 − capacity
  adjustment indication, SMF70CAI, MVS SMF p.589; CPU_CAPACITY and HARDWARE_FAULT; notable 1);
- WLMGL and PROCU: `APPL_CP`, `APPL_IIP` and `IIPCP` beside the summed `APPL` (CPU_CAPACITY, CPU_PRIORITY; triggers
  as `APPL`; half weight).
Thresholds are FICTIONAL, in `content/evidence.ts`. Done when: each is pinnable from the CLI and the UI row, judged
like the existing CPC pins, covered in `tests/game/evidence.test.ts`, and SPEC §10 lists them.

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

### RT-09 · Trigger and mechanism wording: "Change regression", "Policy or configuration"
`list: rca-truth · status: blocked: after RT-00 · priority: low · size: S · area: content`

User decision on Q2, 2026-11-10: yes. Labels and help text only (ids unchanged): §4.4(5). Move ENCRYPTION_MANDATE, MONITOR_CREEP, QR_RELEASE, ZIIP_LOSS
and SMF_AUDIT to `ACCESS_PATH_REGRESSION` (shown as "Change regression"); widen STORAGE's and CAPPING's help. Changes
those cards' truth trigger, so the bots' fix matching (`obviousHourly`) needs a sweep. Done when:
`tests/game/rcaVocabulary.test.ts` covers the new texts and the Codex entries agree.

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
`list: rca-truth · status: blocked: after RT-04 · priority: high · size: M · area: game`

User decision on Q3, 2026-11-10: yes. After RT-04. Each pin gets a relation to the incident (`self`, `server`, `competitor`, `host`) from the incident's
`subjects`; each metric says which relations it accepts; `anySubject` is removed; pins store the baseline beside the
value so a predicate can ask for "normal". Done when: R-16's table comes out as §4.6 describes and the existing
evidence tests are ported.

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
`list: rca-truth · status: blocked: after RT-00, RT-02, RT-06, RT-07 · priority: high · size: L · area: game`

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

### BL-02 · Revenue: do-nothing survives close to textbook
`list: balance · status: blocked: after RT-14 · priority: low · size: M · area: content`

Release sweep 2026-11-10: do-nothing median day 19 (p10 16, p90 23), textbook 27, expert 10/10. Do-nothing is inside
its 8–22 band (it moved there with #167's G1 retune), but the gap to textbook is 8 days against Midwest's 11 and
Harbourline's 19.5, so diagnosing earns less on Revenue. The textbook PREFILL losses around day 22 (PROGRESS.md
M8.2 follow-ups) belong here too. Decide whether the spread is wanted; if not, tune G1/G2 pressure or the deadline
week. Done when: a 20-seed three-bot Revenue sweep and the decision are recorded in PROGRESS.md M8.2.

## cleanup

### CL-04 · WLM's receivers-per-importance limit lives in content
`list: cleanup · status: ready · priority: low · size: S · area: sim`

`RECEIVERS_PER_IMPORTANCE = 2` is a tunable hard-coded in `src/sim/wlm/adjust.ts:137`, against the CLAUDE.md rule
that tunables live in `src/content/`. Move it to the WLM content with a `// FICTIONAL:` comment (the shape: how many
fixable receivers the search assesses at one importance before going on to the next; SG24-7621 p.105–106 for the
search order), and pass it through the adjust input like the other coefficients. Source: #260 milestone review,
note N3. Done when: `npm run compare` and the bench hashes show no difference.
