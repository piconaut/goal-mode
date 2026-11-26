# PT-20: general operations instead of per-card fixes

Status: **proposal for the user** (2026-11-26). Nothing here is implemented. The calls to make are in §8; the work
they lead to is BACKLOG.md PT-52 … PT-55, which this note's decisions rewrite.

## 1. Why

Playtest round 2: a button that fixes one exact problem ("Recycle the PROD2 CICS AORs", "Cancel the looping CICSXLOG
job") feels inauthentic. The menu gives the diagnosis away, and a lever exists only while the game has a card that
names it. D1 (proof-gated fixes, docs/rca-design.md §5) kept the button and hid it behind proof. The user dropped it
on 2026-11-26 for the alternative here: operations a real operator has every day, aimed at a target the player
chooses. Diagnosis becomes choosing the right target, which is what it is on a real system.

Today (`src/game/catalog.ts` `FIXES`, `src/game/run/events.ts`): 22 cards across the three scenarios carry one of 23
fix ids. `visibleFixIds` shows a card's fix once it has started, been forewarned or been rumoured. `endEventByFix`
ends every running card whose `fix` equals the applied id and queues the card's `end` commands. The fix itself has
no sim effect of its own, and applying one with no card running reports "no active event" (`NO_TARGET`), which tells
the player they guessed wrong.

## 2. Rules for the design

1. **Every operation does something real whether or not a card is running.** Cancelling a legitimate job loses its
   work, recycling a healthy region drops its in-flight tasks, throttling sheds real users. Without this, "recycle
   everything, cancel the top consumer" costs nothing and becomes the dominant play (CLAUDE.md: every lever needs a
   cost).
2. **Every target list always holds plausible entries.** The list never appears, grows or shrinks because a card
   started: the job list is the jobs that run, the change list carries harmless changes (PT-53), the region list is
   every region.
3. **No verdict from the operation.** The `NO_TARGET` and `ARMED` log lines go. The player learns whether it worked
   from the reports, as an operator does.
4. **Cards no operation fits keep no targeted fix.** About half the deck already has `fix: null` and is solved with
   the levers everyone has (WLM policy, routing, PR/SM, capacity, job holds and restarts). PT-20 doesn't change that.
5. **One operation per real command family**, named as the real command, so the Codex can teach it.

## 3. The operations

| Operation | Real command | Targets (where the player sees them) | Effect, card or not | Default cost | Mode |
|---|---|---|---|---|---|
| **Cancel a job, started task or TSO user** | `CANCEL jobname`, `CANCEL U=userid` | Address spaces on an image (Monitor III job list, WLMGL top consumers); TSO users by CPU | The address space ends (`REMOVE_ADDRESS_SPACE`). A batch job ABENDs and needs a restart (`ABEND_JOB`, `RESTART_JOB`); a TSO user loses the session | 0.25 h; the owner's trust; lost or rerun work | Immediate |
| **Cancel a Db2 thread** | `-CANCEL THREAD(token)` | The top threads by CPU per DDF workload and member (a new `-DISPLAY THREAD` view, PT-52) | The thread's unit of work rolls back and its locks and claims go (`CANCEL_DB2_READERS`); the requester sees a failure | 0.25 h; the owner's trust | Immediate |
| **Terminate a Db2 utility** | `-TERM UTILITY(id)` | Active utilities (`-DISPLAY UTILITY`; nightly REORG, COPY and RUNSTATS steps from batch content) | The step stops and must be resubmitted as a new job; its housekeeping is undone for the night | 0.5 h; Finance trust | Immediate |
| **Recycle CICS regions** | Shut down and restart the region(s) | Every region, chosen individually | Each chosen region is down briefly (one at a time), in-flight tasks are backed out, storage use returns to base, a sick state clears | 1 h; the owner's trust; failed in-flight work | Immediate |
| **Back out a change** | REBIND `SWITCH(PREVIOUS)`/`APREUSE`, back out a release or deployment | Entries on the Change board's other-teams section (PT-53) | The change's effect is reversed: a regression goes, and so does a harmless change's benefit or feature | 1–1.5 h; the owning team's trust | Change Desk (emergency on a live day) |
| **Gateway protection for a channel** | Edge rate limit, client backoff, block source addresses | Each external channel (mobile, e-filing, refund status, …) and a mode | *Rate limit:* sheds a share of all arrivals. *Backoff:* retries back off and customers see "try later". *Block sources:* drops the attack traffic | 1 h; the channel's facet trust | Immediate, toggled |
| **Hold DFSMShsm recalls** | `HOLD RECALL` / `RELEASE RECALL` | None | Recall I/O stops while held; jobs and users that open migrated data sets wait; the queued recalls run on release | 0.5 h; owner trust per hour held | Immediate, toggled |

Costs are today's `FIXES` hours and trust, moved onto the operations (FICTIONAL, `content/`). The real-effect parts
are new sim work: `RECYCLE_CICS`, a gateway arrival cap and an HSM hold are new commands; the rest reuse commands
that exist (`REMOVE_ADDRESS_SPACE`, `CANCEL_DB2_READERS`, `ABEND_JOB`, `RESTART_JOB`, `SET_CICS`, `SET_MODIFIER`).

Not operations: system address spaces (Db2 MSTR/DBM1, IRLM, SMF, JES, XCF) are refused with an operator warning, as a
site's automation and procedures would, instead of being listed.

## 4. The cards

Every card with a fix today, grouped by the operation that ends it.

| Card (scenarios) | Fix today | Ends it under PT-20 | Wrong targets and their cost | Other levers (unchanged) |
|---|---|---|---|---|
| RUNAWAY (Midwest, Harbourline), RUNAWAY_COMPLIANCE (Revenue) | CANCEL_RUNAWAY | Cancel the top ADHOC (BI) thread; on Revenue the ANALYTICS thread | Cancelling a mobile or online thread fails a customer request; a normal BI query annoys its analyst | DDF period goals, caps, zIIP overflow |
| XLOG_LOOP (Midwest, Revenue) | CANCEL_XLOG | Cancel `CICSXLOG` on PROD1 | Cancelling a CICS AOR in the same class is an outage; cancelling MONAGENT blinds monitoring | Classification rule to a low STC class |
| SHADOW_IT (Midwest) | STOP_SHADOW_IT | Cancel the top TSO users by CPU | Cancelling developers costs engineer-hours and Digital trust | Cap DEVT, lower TSO importance |
| LOCK_ESCALATION (all) | COMMIT_SETTLEMENT_OFTEN | **Proposed:** cancel the running lock-heavy settlement job (Midwest STL, Harbourline SET, Revenue REF); its locks go with the rollback and it reruns later | The rerun stretches the critical batch window; cancelling the wrong job reruns it for nothing | Keep online work off the tables until the step ends |
| REORG_OVERRUN (all) | TERM_UTILITY | Terminate the REORG utility | Terminating COPY or RUNSTATS loses that night's backup or statistics | Move aliases to LCU 21 |
| REGRESSION (Midwest, Harbourline), EFILE_REGRESSION (Revenue) | REBIND_REVERT, EFILE_REBIND_REVERT | Back out the overnight REBIND of RB01 / EF01 | Backing out a helpful REBIND loses its better access path | Absorb with capacity |
| MONITOR_CREEP (all) | ROLLBACK_MONITOR | Back out the monitoring-agent release | Cancelling MONAGENT also stops the CPU but loses the monitor's data | Cap, absorb |
| QR_RELEASE (Midwest) | ROLLBACK_TELLER_RELEASE | Back out teller release 4.2 | A recycle does **not** help (the release is still installed): a useful lesson | Route to PROD2, add an AOR |
| ZIIP_LOSS (Midwest, Revenue) | NATIVE_SQL_PROCS, …_REV | Back out the external stored-procedure deployment | Backing out a harmless deployment loses its feature | Cap, more CP |
| CICS_SOS (Midwest, Revenue) | RECYCLE_PROD2_AORS, …_REV | Recycle CICSAOR2 and CICSAOR4 (**relieves**, §5) | Recycling a healthy PROD1 region is a short outage for nothing | Raise EDSALIM, lower MXT, route to PROD1 |
| SICK_AOR (Harbourline) | RECYCLE_SICK_AOR | Recycle the PRDC region (CICSAOR3) | Recycling a healthy region; the abends move nowhere | ABENDTHRESH/ABENDCRIT, quiesce the region |
| BOT_ATTACK (Midwest), FILING_BOTS (Revenue) | BLOCK_BOTS, BLOCK_FILING_BOTS | Gateway: block sources on mobile / e-filing | A rate limit also sheds real users; backoff does nothing to bots | Protect other work, ride it out |
| RETRY_STORM (Midwest), REFUND_RETRY_STORM (Revenue) | MOBILE_BACKOFF, REFSTAT_BACKOFF | Gateway: backoff on mobile / refund status | Blocking sources finds no attack; a rate limit sheds real users too | Protect other work, ride it out |
| HSM_RECALL_STORM (all) | HOLD_HSM_RECALLS, …_REV | Hold HSM recalls | Held with no storm: batch and users wait on migrated data | Move aliases to LCU 30 |
| ENCRYPTION_MANDATE (Midwest, Harbourline), TAXDATA_ENCRYPTION (Revenue) | SCOPE_ENCRYPTION | Reply on the announcing inbox thread (negotiate the scope) | — | Absorb with tuning and capacity |
| VENDOR_PRICE (all) | NEGOTIATE_MLC_PRICE | Reply on the announcing inbox thread | — | Cut the peaks, Tailored Fit Pricing |
| SMF_AUDIT (all) | SCOPE_SMF_AUDIT | Reply on the announcing inbox thread | — | Absorb the MSU for three days |

So 18 of the 22 cards end through a general operation and 4 (one fix id each for the encryption, price and SMF
audit cards) through a reply on the inbox thread that announced them. Those are business negotiations, already
forewarned, so a reply gives nothing away. COMMIT_SETTLEMENT_OFTEN goes if LOCK_ESCALATION moves to "cancel the job"
(Q5); otherwise it stays as a request to the application team.

## 5. Ending a card: declared effect, with one exception

Each card with an operation declares what ends it:

```ts
endedBy: { op: 'CANCEL_AS', jobname: 'CICSXLOG', lparId: 'PROD1' }
endedBy: { op: 'BACKOUT', changeId: 'REBIND_RB01' }
endedBy: { op: 'GATEWAY', workloadId: 'MOBILE', mode: 'BLOCK' }
```

When an operation is applied, its own sim effect always happens; if it also matches a running card's `endedBy`, the
card ends and its `end` commands run, as `endEventByFix` does today. A recycle that covers only some of a card's
regions doesn't match.

**The exception is a storage leak.** CICS_SOS is a program that leaks; restarting the region frees the storage but
the program is still installed, so on a real system the leak resumes. Proposed: a recycle resets the region's EDSA
use to base and the card runs to its timer. With 40 MB an hour against the headroom under EDSALIM, one recycle
usually lasts the 4-hour card, so in play it feels like a fix, and it teaches that recycling buys time. No `endedBy`
for this card (Q2).

## 6. Forewarned cards and the Change board

Today a forewarned card's fix can be armed before it starts (`armableEvents`). Under PT-20 that special case goes:

- A forewarned change (the overnight REBIND, teller release 4.2, the monitoring agent, the stored procedures) is an
  entry on the Change board's other-teams section from the day it is announced, with its time and owner (PT-53).
  Backing it out before it lands means asking the owning team to stop it: the same back-out, at the same cost, with no
  special arming state.
- The REORG forewarning works the same way through the utility list: the REORG is scheduled and visible; terminating
  it ahead is possible once it runs.
- Harmless and helpful changes are announced the same way (this absorbs PT-19), so "back out whatever was announced"
  stops working.

## 7. Bots and balance

Through PT-54, bots' `ON_SIGHT_FIXES` map a card to its operation and target, still from truth, so bands should barely
move. PT-55 then makes bots choose targets from what a player can read: the top consumer, the Change board, the
regions short on storage, the channel with the arrival surge. A card whose target the data doesn't single out shows
in sweeps as a card that is never ended, which makes the sweep a standing check of the clue paths. Expect the
textbook band to move; that's a balance call after a three-scenario sweep.

## 8. Decisions for the user

| # | Question | Recommendation |
|---|---|---|
| Q1 | Do wrong targets cost a real sim effect (lost work, reruns, shed users, a short outage), not just trust? | Yes: without it, blanket use is free |
| Q2 | Does a CICS recycle *relieve* a storage leak (reset storage, the card runs to its timer) instead of ending the card? | Yes, as §5 |
| Q3 | Which operations are immediate, and which go through the Change Desk? | Cancel, recycle, gateway and HSM hold immediate (live-day emergency rules: trust, failure risk); back-out through the Change Desk |
| Q4 | Does "block sources" with no attack running tell the player there was none ("no unusual source addresses")? | Yes: a real edge team would say so, and it costs an hour like an inquiry. Accept it as a paid clue |
| Q5 | LOCK_ESCALATION: cancel the lock-holding settlement job (locks go with the rollback, the job reruns and stretches the window), instead of COMMIT_SETTLEMENT_OFTEN? | Yes: it's the operator's real move and has a real trade-off |
| Q6 | The four business cards (encryption ×2, MLC price, SMF audit) as inbox replies instead of operations? | Yes |
| Q7 | Drop the `NO_TARGET` / `ARMED` verdict lines? | Yes (§2 rule 3) |

## 9. Real behaviour checked

| Fact | Source | Use here |
|---|---|---|
| CANCEL ends an active job, started task or TSO user immediately (`CANCEL jobname`, `CANCEL U=userid`) through an asynchronous ABEND 122 or 222; more than one CANCEL can be needed, and FORCE exists for when CANCEL fails | [z/OS 3.1 MVS System Commands (SA38-0666-60) PDF p.188 (printed 160)](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag100_v3r1.pdf#page=188) | Cancel job/STC/TSO user. APPROX: the sim ends it on the tick |
| -CANCEL THREAD cancels processing for a local or distributed thread identified by its token from DISPLAY THREAD; a NOBACKOUT option exists, so by default the work is backed out | [Db2 13 Command Reference PDF pp.185–186 (printed 169–170)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_comrefbook.pdf#page=185) | Cancel a Db2 thread; the target list is DISPLAY THREAD |
| Best practice is CANCEL THREAD before cancelling the job; a cancelled distributed thread can go indoubt and its resources are released when that is resolved | [Db2 13 Command Reference PDF p.187 (printed 171)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_comrefbook.pdf#page=187) | APPROX: the sim releases claims at once |
| -TERM UTILITY terminates a utility job step and releases its resources, once the utility checks for the command; a terminated step cannot be restarted and must be resubmitted as a new utility job; REORG TABLESPACE termination has phase-specific consequences | [Db2 13 Command Reference PDF pp.713–714 (printed 697–698)](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_comrefbook.pdf#page=713) | Terminate a utility; the REORG must be resubmitted |
| Backout occurs when CICS starts with START=AUTO after an immediate or uncontrolled shutdown; after an abnormal termination, Recovery Manager restores in-flight tasks as shunted UOWs and backs them out after initialization | [CICS TS 6 Administering CICS PDF p.58 (printed 50)](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering_pdf.pdf#page=58), [PDF p.63 (printed 55)](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering_pdf.pdf#page=63) | Recycle is an immediate shutdown and restart: in-flight work is backed out. A normal shutdown that lets tasks finish is not modelled |

**Not verified:** DFSMShsm `HOLD RECALL` / `RELEASE RECALL` behaviour (the DFSMShsm Storage Administration book is not
in the books repo; PT-52 fetches and checks it before modelling the hold); CICSPlex SM routing around a region that is
down (Managing Workloads shows routing to available regions only in passing, for affinities, PDF p.58); that a
restarted region's storage use returns to base (a game rule until checked).

## 10. What the entries become

- **PT-52** (sim): the seven operations of §3 with their real effects, the DISPLAY THREAD and DISPLAY UTILITY target
  views, Codex entries. Cards and fix buttons unchanged; `npm run compare` clean.
- **PT-53** (game): the Change board's other-teams section with card-introduced and harmless entries (PT-19's helpful
  changes), the back-out operation and its costs; forewarnings post their entry. Compare clean.
- **PT-54** (game): `endedBy` on the 18 cards, the CICS_SOS relief, inbox replies for the 4 business cards, removal of
  `FIXES`, `visibleFixIds`, `armableEvents` and the verdict lines; save migration; SPEC §9 and §10; goldens and a
  sweep.
- **PT-55** (tooling): bots choose targets from report data; sweep and re-tune.
