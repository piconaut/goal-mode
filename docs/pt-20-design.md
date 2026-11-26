# PT-20: general operations instead of per-card fixes

Status: **decided** (user, 2026-11-26: Q1–Q7 of §8 as recommended). Revised the same day after an adversarial review
by a second agent (§11 lists what it changed). The work is BACKLOG.md PT-52, PT-56, PT-53, PT-54 and PT-55, in that order.

## 1. Why

Playtest round 2: a button that fixes one exact problem ("Recycle the PROD2 CICS AORs", "Cancel the looping CICSXLOG
job") feels inauthentic. The menu gives the diagnosis away, and a lever exists only while the game has a card that
names it. D1 (proof-gated fixes, docs/rca-design.md §5) kept the button and hid it behind proof. The user dropped it
on 2026-11-26 for this design: operations a real operator has every day, aimed at a target the player chooses.
Diagnosis becomes choosing the right target, which is what it is on a real system.

Today (`src/game/catalog.ts` `FIXES`, `src/game/run/events.ts`): 22 cards across the three scenarios carry one of 23
fix ids. `visibleFixIds` shows a card's fix once it has started, been forewarned or been rumoured. `endEventByFix`
ends every running card whose `fix` equals the applied id and queues the card's `end` commands. The fix itself has
no sim effect of its own, and applying one with no card running reports "no active event" (`NO_TARGET`), which tells
the player they guessed wrong. Harbourline adapts BOT_ATTACK, RETRY_STORM and ZIIP_LOSS with `fix: null`.

## 2. Rules for the design

1. **Every operation does something real whether or not a card is running, and every wrong target costs a sim
   effect, not only hours or trust.** Engineer-hours are in surplus late in a run (PT-22), so hours alone are no
   cost. Cancelling a legitimate job loses its work, recycling a healthy region fails its in-flight tasks,
   throttling fails real requests against the SLA (Q1).
2. **Every target list always holds plausible entries.** No entry appears only while a card runs: the address-space
   list, the thread and TSO rosters and the utility schedule exist every day, with a heavy-tailed spread so a large
   top entry is normal on a quiet day; the Change board carries harmless changes (PT-53).
3. **No verdict from the operation.** The `NO_TARGET` and `ARMED` log lines go (Q7). The player learns whether it
   worked from the reports.
4. **Operations are the same in every scenario.** An operation that silently does nothing on one scenario is a lie,
   so Harbourline's `fix: null` twins get targets too.
5. **Cards no operation fits keep no targeted fix**, solved with the levers everyone has (WLM policy, routing, PR/SM,
   capacity, job holds and restarts).
6. **Toggled state is visible.** A held recall queue or a gateway mode shows in a report ("HSM recalls HELD", the
   channel's gateway state) and costs every hour it stays on.
7. **Targets are entities.** A card built from a modifier (RUNAWAY's ×10 ADHOC CPU, SHADOW_IT's ×8 TSO CPU) gets an
   entity the operation can hit: the card's `begin` marks one roster entry as the culprit and puts the extra demand
   on it.

## 3. The operations

| Operation | Real command | Targets (where the player sees them) | Effect, card or not | Cost of a wrong target | Mode |
|---|---|---|---|---|---|
| **Cancel a job, started task or TSO user** | `CANCEL jobname`, `CANCEL U=userid` | Address spaces per image (Monitor III job list, WLMGL top consumers), excluding CICS and Db2 regions and system address spaces (refused with an operator warning); TSO userids by CPU (a daily roster) | The address space ends; site automation restarts a cancelled STC after N minutes (FICTIONAL), so a cancel stops a fault in an STC only until it restarts. A batch job ABENDs and needs a restart (`ABEND_JOB`, `RESTART_JOB`). A cancelled TSO user is logged off | A legitimate job's work is lost and rerun; a legitimate STC's function is missing until restarted (MONAGENT: the tool it feeds has a data gap); developers lose engineer-hours and Digital trust | Immediate, 0.5 h |
| **Cancel a Db2 thread** | `-CANCEL THREAD(token)` | The top threads by CPU per DDF workload and member (a new `-DISPLAY THREAD` view, a daily roster) | The thread's unit of work rolls back and its claims go; the requester sees a failure | The work reruns, so its CPU is spent twice, and the request fails | Immediate, 0.5 h |
| **Terminate a Db2 utility** | `-TERM UTILITY(id)` | Active utilities (`-DISPLAY UTILITY`) from each scenario's nightly utility schedule: REORG, COPY and RUNSTATS on most nights | The step stops and must be resubmitted: a terminated REORG reruns from the next night's schedule, and can overrun again no more often than any other night | That night's backup or statistics are lost | Immediate, 0.5 h |
| **Recycle CICS regions** | Immediate shutdown and restart of the region(s) | Every region, chosen individually | Each chosen region is down for its restart minutes, one at a time: its share of routed work fails (`regionFailFrac`) while down and the rest reroutes (§9); in-flight tasks are backed out; its EDSA use restarts at 0 with any leak still running (`leak {startMb: 0, sinceTick: now}`); a sick state clears | Failed in-flight and routed work, and the owner's trust | Immediate, 1 h |
| **Back out a change** | `REBIND SWITCH(PREVIOUS)`/`APREUSE`; back out a release or deployment | Entries in the Change board's other-teams section (PT-53) | The change's effect is reversed: a regression goes, and so does a harmless change's benefit or feature | A helpful change's benefit is lost (e.g. a better access path), or a feature and its owner's trust | A REBIND is immediate (a DBA command); a release or deployment goes through the Change Desk (Q3) |
| **Gateway protection for a channel** | Edge rate limit, client backoff, block source addresses | Each external channel and a mode | *Rate limit:* sheds a share of all arrivals, counted as failed transactions against the SLA. *Backoff:* retries back off and customers see "try later". *Block sources:* drops attack traffic and always sheds a small share of legitimate traffic (shared carrier NAT addresses); with no attack the edge team reports "no unusual source addresses" (Q4) | Failed legitimate requests every hour the mode stays on | Immediate, toggled, 1 h |
| **Hold DFSMShsm recalls** | `HOLD RECALL` / `RELEASE RECALL` | None | Recall I/O stops while held; non-WAIT recalls queue and run on release, draining at a capped rate (so a release can bring a spike back); batch WAIT recalls fail, so a job that needs a migrated data set ABENDs and needs a restart (§9) | Failed batch steps and owner trust every hour it is held | Immediate, toggled, 0.5 h |

Hours and trust amounts are today's `FIXES` values moved onto the operations (FICTIONAL, `content/`). New sim work:
the entity rosters (DDF threads, TSO userids), a permanent CICSXLOG STC on the image it runs on (low CPU, matching the
`CICS*` rule, so it's in STCHI every day), the nightly utility schedule, STC restart by automation, `RECYCLE_CICS`, a
gateway arrival cap with modes, and the HSM hold with its backlog. `REMOVE_ADDRESS_SPACE` today filters only
`extraAddressSpaces` (`src/sim/core/commands.ts`), so cancelling a base address space needs new code.

## 4. The cards

Every card with a fix today, plus Harbourline's three twins, grouped by the operation that ends it.

| Card (scenarios) | Fix today | Target entity | Ends it under PT-20 | Wrong targets and their cost | Other levers (unchanged) |
|---|---|---|---|---|---|
| RUNAWAY (Midwest, Harbourline), RUNAWAY_COMPLIANCE (Revenue) | CANCEL_RUNAWAY | One BI/analytics thread in the roster, given the card's extra CPU (replaces the ×10 workload modifier) | Cancel that thread | Cancelling another thread fails its request and reruns its CPU | DDF period goals, caps, zIIP overflow |
| XLOG_LOOP (Midwest, Revenue) | CANCEL_XLOG | The permanent CICSXLOG STC, which loops | Cancel CICSXLOG: the loop stops and automation restarts it healthy | Cancelling another STC loses its function until restart | Classification rule to a low STC class |
| SHADOW_IT (Midwest) | STOP_SHADOW_IT | Two or three TSO userids in the daily roster, given the extra CPU | Cancel those userids (a game rule: their manager is called, so they don't log back on) | Cancelling other developers costs engineer-hours and Digital trust | Cap DEVT, lower TSO importance |
| LOCK_ESCALATION (all) | COMMIT_SETTLEMENT_OFTEN | The lock-heavy settlement job running when the card starts (Midwest STL, Harbourline SET, Revenue REF), named by a new lock-holder clue (DISPLAY DATABASE LOCKS style) | Cancel that job: its locks are held while it backs out (APPROX, about as long as it ran; checked with zos-docs in PT-56), then clear; the job reruns and stretches the batch window (Q5) | Cancelling CRD or GLF, also lock-heavy, reruns them for nothing | Keep online work off the tables until the step ends |
| REORG_OVERRUN (all) | TERM_UTILITY | The night's REORG in the utility schedule; the LCU 21 volumes show which one is overrunning | Terminate it; it reruns from the next night's schedule | Terminating COPY or RUNSTATS loses that night's backup or statistics | Move aliases to LCU 21 |
| REGRESSION (Midwest, Harbourline), EFILE_REGRESSION (Revenue) | REBIND_REVERT, EFILE_REBIND_REVERT | The overnight REBIND entry on the Change board | Back it out (immediate) | Backing out a helpful REBIND loses its better access path | Absorb with capacity |
| MONITOR_CREEP (all) | ROLLBACK_MONITOR | The monitoring-agent release entry | Back it out | Cancelling MONAGENT stops the CPU only until automation restarts it, with a data gap in the tool it feeds | Cap, absorb |
| QR_RELEASE (Midwest) | ROLLBACK_TELLER_RELEASE | Teller release 4.2 entry | Back it out | A recycle does **not** help (the release is still installed) | Route to PROD2, add an AOR |
| ZIIP_LOSS (all) | NATIVE_SQL_PROCS, …_REV; Harbourline none | The external stored-procedure deployment entry | Back it out | Backing out a harmless deployment loses its feature | Cap, more CP |
| CICS_SOS (Midwest, Revenue) | RECYCLE_PROD2_AORS, …_REV | CICSAOR2 and CICSAOR4 | **Relieved, not ended** (§5): a recycle restarts the region's EDSA use at 0 and the leak continues | Recycling a healthy region fails its work for nothing | Raise EDSALIM, lower MXT, route to PROD1 |
| SICK_AOR (Harbourline) | RECYCLE_SICK_AOR | CICSAOR3 on PRDC; the reports must put the abends on AOR3, not on PRDC's other region | Recycle CICSAOR3 | Recycling the other PRDC region, or any healthy one | ABENDTHRESH/ABENDCRIT, quiesce the region |
| BOT_ATTACK (Midwest, Harbourline), FILING_BOTS (Revenue) | BLOCK_BOTS, BLOCK_FILING_BOTS; Harbourline none | The channel | Gateway: block sources | A rate limit fails real users too; backoff does nothing to bots | Protect other work, ride it out |
| RETRY_STORM (Midwest, Harbourline), REFUND_RETRY_STORM (Revenue) | MOBILE_BACKOFF, REFSTAT_BACKOFF; Harbourline none | The channel | Gateway: backoff | Blocking sources finds no attack and sheds some real users | Protect other work, ride it out |
| HSM_RECALL_STORM (all) | HOLD_HSM_RECALLS, …_REV | None | **Relieved, not ended** (§5): a hold stops the storm's I/O and builds a backlog that drains on release | Held with no storm: batch steps that need migrated data fail | Move aliases to LCU 30 |
| ENCRYPTION_MANDATE (Midwest, Harbourline), TAXDATA_ENCRYPTION (Revenue) | SCOPE_ENCRYPTION | — | Reply on the announcing inbox thread (Q6) | — | Absorb with tuning and capacity |
| VENDOR_PRICE (all) | NEGOTIATE_MLC_PRICE | — | Reply on the announcing inbox thread | — | Cut the peaks, Tailored Fit Pricing |
| SMF_AUDIT (all) | SCOPE_SMF_AUDIT | — | Reply on the announcing inbox thread | — | Absorb the MSU for three days |

So 21 cards end or are relieved through a general operation (the 18 with a fix today and Harbourline's three twins),
and 4 through a reply on the inbox thread that announced them. COMMIT_SETTLEMENT_OFTEN goes.

## 5. Ending a card, and the two relieved cards

Each card that an operation ends declares it:

```ts
endedBy: { op: 'CANCEL_AS', jobname: 'CICSXLOG', lparId: 'PROD1' }
endedBy: { op: 'BACKOUT', changeId: 'REBIND_RB01' }
endedBy: { op: 'GATEWAY', workloadId: 'MOBILE', mode: 'BLOCK' }
```

An operation's own sim effect always happens; if it also matches a running card's `endedBy`, the card ends and its
`end` commands run, as `endEventByFix` does today. A recycle that covers only some of a card's regions doesn't match.

**Relieved cards.** CICS_SOS and HSM_RECALL_STORM have no `endedBy`: the operation removes the symptom and the cause
keeps running until the card's timer. A recycled region's EDSA use restarts at 0 and the leak continues; with 40 MB an
hour against the headroom under EDSALIM, one recycle usually lasts the 4-hour card. A held storm builds a backlog that
replays on release. Both teach that the operation buys time.

**Footprint of a relieved card** (a stated game rule read from sim state each tick, so the RCA can be explained from
data the player has): CICS_SOS keeps its CICS storage footprint only on regions whose EDSA use is above the SOS
cushion, the same quantity the CICS report shows, region by region. Recycle only CICSAOR2 and the footprint stays on
CICSAOR4; if the leak refills a recycled region before the timer, that is a real recurrence and the footprint comes
back. HSM_RECALL_STORM keeps its LCU 30 footprint while the backlog or the storm's I/O is on the LCU.

## 6. Forewarned cards and the Change board

Today a forewarned card's fix can be armed before it starts (`armableEvents`). Under PT-20 that special case goes:

- A forewarned change (the overnight REBIND, teller release 4.2, the monitoring agent, the stored procedures) is an
  entry on the Change board's other-teams section from the day it is announced, with its time and owner (PT-53).
  Backing it out before it lands means asking the owning team to stop it: the same back-out, at the same cost.
- Harmless and helpful changes are announced the same way and match the card entries in owner, timing and frequency
  (this absorbs PT-19), so "back out whatever was announced" stops working. A helpful change has a real benefit, so
  landing it moves the goldens.
- The REORG forewarning works through the utility schedule.

## 7. Bots, saves and balance

- **PT-54:** bots' `ON_SIGHT_FIXES` map a card to its operation and target, still from truth. Expected band moves,
  listed in advance: the HSM backlog replay, the CICS_SOS relief, the REORG resubmission, the recycle outage, the
  rate-limit and block-sources sheds, and Harbourline's three twins becoming fixable.
- **PT-55:** bots choose targets from what a player can read (the top consumer, the Change board, the regions short on
  storage, the channel with the arrival surge) and release their toggles (HSM hold, gateway modes) when the reports
  say the storm is over; a sweep would otherwise measure holds left on forever. A card whose target the data doesn't
  single out shows in sweeps as never ended, a standing check of the clue paths. Expect the textbook band to move; a
  balance call after a three-scenario sweep.
- **Save migration (PT-54):** old saves can hold CICSXLOG in `extraAddressSpaces`, `armedEvents` on changes, and
  changes carrying fix ids. Migration removes the extra CICSXLOG copy (`REMOVE_ADDRESS_SPACE` must never delete the
  base one), turns an armed card that hasn't started into "backed out before it landed", and maps fix-id changes to
  their operation.

## 8. Decisions (user, 2026-11-26)

| # | Question | Decision |
|---|---|---|
| Q1 | Wrong targets cost a real sim effect, not just trust | Yes |
| Q2 | A CICS recycle relieves a storage leak instead of ending the card | Yes (the HSM hold relieves too, after review) |
| Q3 | Cancel, recycle, gateway and HSM hold immediate; back-outs through the Change Desk | Yes (a REBIND back-out is immediate, after review) |
| Q4 | "Block sources" with no attack says "no unusual source addresses" | Yes (and it always sheds some legitimate traffic, after review) |
| Q5 | LOCK_ESCALATION ended by cancelling the settlement job | Yes (with the backout lock hold and a lock-holder clue, after review) |
| Q6 | The four business cards as inbox replies | Yes |
| Q7 | Drop the `NO_TARGET` / `ARMED` verdict lines | Yes |

## 9. Real behaviour checked

| Fact | Source | Use here |
|---|---|---|
| CANCEL ends an active job, started task or TSO user immediately (`CANCEL jobname`, `CANCEL U=userid`) through an asynchronous ABEND 122 or 222; more than one CANCEL can be needed, and FORCE exists for when CANCEL fails | [z/OS 3.1 MVS System Commands (SA38-0666-60) PDF p.188 (printed 160)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag100_v3r1.pdf#page=188) | Cancel job/STC/TSO user. APPROX: the sim ends it on the tick |
| -CANCEL THREAD cancels processing for a local or distributed thread identified by its token from DISPLAY THREAD; a NOBACKOUT option exists, so by default the work is backed out | [Db2 13 Command Reference PDF pp.185–186 (printed 169–170)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_comrefbook.pdf#page=185) | Cancel a Db2 thread; the target list is DISPLAY THREAD |
| Best practice is CANCEL THREAD before cancelling the job; a cancelled distributed thread can go indoubt and its resources are released when that is resolved | [Db2 13 Command Reference PDF p.187 (printed 171)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_comrefbook.pdf#page=187) | APPROX: the sim releases claims at once |
| -TERM UTILITY terminates a utility job step and releases its resources, once the utility checks for the command; a terminated step cannot be restarted and must be resubmitted as a new utility job; REORG TABLESPACE termination has phase-specific consequences | [Db2 13 Command Reference PDF pp.713–714 (printed 697–698)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_comrefbook.pdf#page=713) | Terminate a utility; the REORG must be resubmitted |
| A Db2 process abend triggers implicit rollback. Locks protecting uncommitted data are held at least until the unit of work ends. Full rollback releases the unit's implicitly acquired locks | [Db2 13 SQL Reference PDF p.76 (printed 48)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_sqlrefbook.pdf#page=76), [PDF pp.2188–2189 (printed 2160–2161)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_sqlrefbook.pdf#page=2188) | PT-54 will keep the cancelled settlement job's locks through backout. The modelled duration is an approximation of the work since the last commit |
| Backout occurs when CICS starts with START=AUTO after an immediate or uncontrolled shutdown; after an abnormal termination, Recovery Manager restores in-flight tasks as shunted UOWs and backs them out after initialization | [CICS TS 6 Administering CICS PDF p.58 (printed 50)](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering_pdf.pdf#page=58), [PDF p.63 (printed 55)](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering_pdf.pdf#page=63) | Recycle is an immediate shutdown and restart: in-flight work is backed out. A normal shutdown that lets tasks finish is not modelled |
| HOLD RECALL stops all recall and migrated-data-set deletion tasks, automatic or by command; no new ones start, and it also stops processing from an already mounted migration tape. Non-WAIT requests stay queued. **WAIT recalls from batch or the storage administrator are failed (not queued)**; HOLD RECALL(TAPE) fails WAIT recalls from tape and still allows DASD recalls; HOLD RECALL(TAPE(TSO)) holds only TSO recalls from ML2 tape, and a TSO WAIT recall from tape is converted to non-WAIT, the user is told it stays queued until release. RELEASE RECALL releases held recalls (all volumes by default); TAPE, TSO and DASD variants exist; RELEASE RECALL(DASD) turns a full HOLD RECALL into HOLD RECALL(TAPE); there is no HOLD RECALL(DASD); RECALL(TAPE(TSO)) cannot be released while RECALL(TAPE) or RECALL is held | [z/OS 3.1 DFSMShsm Storage Administration (SC23-6871-60) PDF p.657 (printed 595)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/arcf000_v3r1.pdf#page=657), [PDF pp.965–966 (printed 903–904)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/arcf000_v3r1.pdf#page=965), [PDF pp.1093–1094 (printed 1031–1032)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/arcf000_v3r1.pdf#page=1093) | **Contradicts the design as drafted if recalls are meant to wait:** under HOLD RECALL a batch job that needs a migrated data set (WAIT recall) fails, it does not wait. Only non-WAIT requests, and TSO tape recalls under HOLD RECALL(TAPE(TSO)), wait on the queue until RELEASE. The book does not say how a TSO WAIT recall behaves under a full HOLD RECALL (the TSO conversion is stated only for tape recalls held with TSO). Model: batch recall fails with the held-recall condition; TSO tape recall queues |
| Dynamic routing does not route to a target region that is not eligible. A region with z/OS WLM health value 0 gets no work (cool-down lowers health gradually until it is ineligible; CLOSE/IMMCLOSE do it on purpose); health 1–99 only adds weight, so a poor region can still receive work if no healthier one is in scope. Target status QUIESCEING sends new transactions to another target; QUIESCED means not available to workload management. A route error (link out of service) makes CICSPlex SM try another target. Exception: an active affinity still targets its region and routing to it fails (EYUWR0003W or SYSIDERR) while it is unavailable. The book has no sentence about a region that has simply been shut down, only these states | [CICS TS 6 CICSPlex SM Managing Workloads PDF pp.71–72 (printed 65–66)](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/cpsm-managing-workloads_pdf.pdf#page=71), [PDF p.137 (printed 131)](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/cpsm-managing-workloads_pdf.pdf#page=137), [PDF p.58 (printed 52)](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/cpsm-managing-workloads_pdf.pdf#page=58) | Work reroutes to the remaining target regions while one is down; transactions with an affinity to it fail (SYSIDERR) instead of rerouting. APPROX: health 0 / unavailable maps to a down region |
| **Not found:** no CICS TS 6 book read states that a restarted region's DSA/EDSA use starts again from base or that leaked storage is freed by a restart. The Performance Guide describes DSA extents allocated as needed up to DSALIM/EDSALIM and short-on-storage handling; nothing on leaks across restarts | Searched [CICS TS 6 Performance Guide](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/performance_pdf.pdf#page=76) (PDF pp.76–77 (printed 68–69), SOS and DSA sections), Administering CICS (restart sections, PDF pp.62, 112), Troubleshooting Guide (DSA storage waits PDF p.218, storage violations PDF p.286) | Still a game rule: a recycle returns the region to base storage use. Not verified; do not cite as real behaviour |

**Not verified:** that a restarted region's storage use returns to base (a game rule; the books searched above do not state it). DFSMShsm hold/release recall and CICSPlex SM routing around an unavailable region are settled in the table above.

## 10. What the entries become

Five entries, in order; each leaves a coherent game, and only PT-52 and PT-54 move the bot bands.

- **PT-52** (sim, L): the entity rosters (DDF threads, TSO userids), a permanent CICSXLOG STC, the nightly utility
  schedule, STC restart by automation; the cards built from modifiers re-pointed at them; the lock-holder clue and
  per-region SICK_AOR abends. Cards still end by fix id. Goldens, a "Behaviour change" note and a sweep.
- **PT-56** (sim, M): the seven operations of §3 with their effects and costs, `RECYCLE_CICS`, the gateway modes, the
  HSM hold with its backlog, the DISPLAY THREAD and DISPLAY UTILITY views, report lines for toggled state, Codex
  entries. Nothing uses them yet: `npm run compare` shows no sim difference.
- **PT-53** (game, M): the Change board's other-teams section with card-introduced and harmless or helpful entries,
  the back-out operation and its costs; forewarnings post their entry. Moves goldens.
- **PT-54** (game, M): `endedBy` on the cards an operation ends, the two relieved cards and their footprint rule,
  LOCK_ESCALATION's backout lock hold, inbox replies for the 4 business cards, Harbourline's twins, removal of
  `FIXES`, `visibleFixIds`, `armableEvents` and the verdict lines; save migration; SPEC §9 and §10; goldens and a
  sweep against the expected moves of §7.
- **PT-55** (tooling, M): bots choose targets from report data and release their toggles; sweep and re-tune.

## 11. What the review changed

An adversarial review on 2026-11-26 found: cards built from modifiers had nothing to target (now entities, §2 rule
7); CICSXLOG and the REORG appeared only while their card ran (now permanent and scheduled); cancelling MONAGENT beat
backing out its release (now automation restarts STCs); Harbourline's fixless twins would make operations lie there
(now targeted); the HSM hold postpones a storm rather than ending it (now relieved); cancelling a lock holder doesn't
free its locks at once (now a backout period and a lock-holder clue); hours are no cost late in a run (now every wrong
target has a sim effect, and block sources sheds some real traffic); and the first draft's compare-clean claims for its operations and Change board entries
were wrong.
