# WLM policy adjustment: audit and target model

Status: **proposal for the user** (2026-11-10). Nothing here is implemented. The work it leads to is in
[BACKLOG.md](../BACKLOG.md) list `wlm-truth` (WT-01 … WT-15); §8 lists the decisions it needs. This is the WLM
counterpart of [rca-design.md](rca-design.md).

Scope: one policy adjustment interval, end to end, on `dev` at `c0b065f`: `src/sim/wlm/adjust.ts`, `evaluate.ts`,
`eval/`, `goals.ts`, `runtime.ts`, `src/sim/zos/dispatcher.ts` and `src/sim/core/tick/`. Out of scope: WLM-managed
initiators, MPL and storage targets, I/O priority, routing recommendations, capping by defined capacity.

## 1. Scope and method

**What was checked.** Every step the code takes between two ticks to decide dispatching priorities (§2), against
what IBM documents about the same step (§3). The algorithm was built one realism fix at a time; this is the first
check of the whole, and most findings (§4) are interactions between steps that are each defensible alone.

**Sources**, in the order they were used:

| Short name | Source | Tier |
|---|---|---|
| WLM Planning | *z/OS 3.1 MVS Planning: Workload Management* (ieaw100), [PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf) | IBM book, page-checked |
| WLM Services | *z/OS 3.1 MVS Programming: Workload Management Services* (ieaw200), [PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf): ch. 11 "Using SMF record type 99" and Appendix A (trace codes). The most detailed product documentation of the algorithm | IBM book, page-checked |
| SG24-6472 | Redbook *System Programmer's Guide to: Workload Manager*, SG24-6472-03, Mar 2008, [PDF](https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf) | IBM Redbook, page-checked |
| SG24-7621 | Redbook *ABCs of z/OS System Programming Vol. 12*, SG24-7621-00, Jan 2010, [PDF](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf) | IBM Redbook, page-checked |
| Patent | US 5,473,773, *Apparatus and method for managing a data processing system workload according to two or more distinct processing goals*, Aman et al., IBM, filed 1994. <https://patents.google.com/patent/US5473773A/en>, accessed 2026-11-10 | **IBM web.** Read through a fetch tool that returns summaries and short quotes, so the wording is not page-checked. It describes the 1994 design: no sysplex PI, no CPU Critical, no zIIP |
| Enrico | Peter Enrico, *How WLM Works* (slides), Enterprise Performance Strategies. <https://www.epstrategies.com/library/content/Enrico.WLM032-WLMHowWLMWorks.pdf>, accessed 2026-11-10; the PDF text was extracted and read | **Practitioner** |

Page numbers are PDF page indexes (`#page=N`), as in [research.md](research.md). Where the two Redbooks or a Redbook
and a z/OS book disagree, §3 says so and prefers the z/OS book. A claim backed only by the patent or by Enrico is
labelled where it is used. Anything not found is marked *unverified*; nothing is filled in from memory.

**Repros.** All on seed 42, Normal difficulty, no player actions, through the play CLI's own code path:

- **Traces (R-n).** A play-CLI file and `npm run inspect -- <file> wlm <system> --at <time> --ticks <n>`. The file
  is made with `npm run -s play -- <file> new 42 [normal <scenario>]`, then per day `start`, `advance 24` (repeat
  until the day ends), `draft none`. Times are sim clock; "D2" is the second played day.
- **Statistics (S-n).** A scratch harness (`runs/wlm-audit/stats.ts`, not committed; WT-01 turns it into
  `inspect … wlm-stats`) that plays the same commands through `applyPlayCommand` with `setWlmTraceSink` installed
  and counts, over every policy adjustment of every system: candidates by outcome, trials by verdict, accepted
  moves, a DP move reversed by the next move of the same period, receivers assessed without a move 30 intervals
  running, and the DP ladder at chosen times.
- **Code reading (C-n).** Where no seed-42 replay hits the case, the finding says "by code reading" and gives the
  smallest input that would show it; that input is the regression test of its fix.

| Id | Run | What it shows |
|---|---|---|
| R-1 | Midwest, PROD2, D1 12:19:00–12:23:00 (`--at 'D1 12:19' --ticks 26`) | W1, W8: one period moved down, up, down, up in 3.5 minutes; receivers assessed on a PI they no longer have |
| R-2 | Midwest, PROD2, D2 10:21:00–10:23:10 | W2, W3: the region class as a receiver; five classes within two priorities of the top after 28 hours |
| R-3 | Revenue, PROD2, D1 10:41:50–10:44:30 | W6, W9: a zIIP-bound receiver re-assessed every interval; receiver value of 0.01 |
| R-4 | Harbourline, PRDD, D1 14:17:40 (and PRDC 15:39:20) | W2, W6, W7: an importance-4 period at the top managed priority on day 1 while the importance-2 period of the same class, local PI 4.0, is skipped by the budget |
| S-1 | Midwest, days 1–2 (69 120 adjustments on 4 systems) | counts below |
| S-2 | Revenue, days 1–3 (103 680 adjustments) | counts below |
| S-3 | Harbourline, days 1–3 (155 520 adjustments) | counts below |
| S-4 | Midwest, days 1–8, DP ladder of PROD1 and PROD2 at 12:00 each day | W2 |

| | S-1 Midwest | S-2 Revenue | S-3 Harbourline |
|---|---|---|---|
| Adjustments with no candidate (every goal met) | 67 101 | 97 719 | 144 888 |
| Candidates assessed (trials run) | 1 609 | 3 046 | 5 939 |
| Candidates not assessed: bottleneck OTHER / I/O | 481 / 0 | 2 999 / 0 | 5 291 / 4 208 |
| Candidates not assessed: budget | 0 | 0 | 4 |
| Trials (projections) | 5 934 | 8 456 | 18 690 |
| … accepted (= DP moves) | 36 | 46 | 117 |
| … `MORE_IMPORTANT_HARMED` | 3 447 | 278 | 7 873 |
| … `SMALL_GAIN` / `NO_RECEIVER_GAIN` | 1 096 / 755 | 2 498 / 5 342 | 4 548 / 3 502 |
| … `NO_NET_VALUE` / `EQUAL_DISPARITY` | 465 / 135 | 291 / 1 | 2 336 / 314 |
| Rejected trials whose receiver's own-tick PI was ≤ 0.9 | 793 | 383 | 5 188 |
| A period's move reversed by its next move | 12 | 22 | 44 |
| Receiver assessed 30 intervals running without a move (episodes) | 7 | 4 | 20 |

The numbers are from the harness on `c0b065f`; they will differ on another commit.

## 2. The algorithm as built

One tick is 10 sim-seconds. The WLM-relevant part of the tick pipeline (SPEC §5.1), per z/OS image:

```
lparDemand → planLpar → prsm/softCap → dispatchLpar (evaluateLpar, measurement) → adjustPolicies (policyAdjust)
```

### 2.1 Work, slices and periods

- `buildSlices` (`src/sim/workload/slices.ts`) makes one **slice** per workload × image × service class period
  (kind `TXN`) and one per address space (kind `AS`). Batch gets one `AS` slice per period of running jobs
  (`lparDemand`, `src/sim/core/tick/demand.ts`). A slice's demand is engines of CP and of zIIP-eligible CPU.
- **Period switching.** Transactions are split over a class's periods analytically by their service distribution
  (`splitPeriods`, `src/sim/workload/periods.ts`); a running batch job sits in the period its consumed service has
  reached (`scKeyAtService`, `jobServiceSu` in `tick/helpers.ts`: progress × (CP + zIIP seconds) × SU/s, zIIP time not
  normalised); a long-running address space sits in the last period.
- A **service class period** is the unit WLM manages. Its key is `CLASS#n`. SYSTEM and SYSSTC have no goal and fixed
  DPs 255 and 254; discretionary periods (and SYSOTHER) are fixed at DP 196 (`initialDp`, `runtime.ts`; `dpOf` default
  in `tick/dispatch.ts`). They never enter policy adjustment (`policyAdjust` builds `info` without them).

### 2.2 State

`WlmSystemState.scps[]` per image (`runtime.ts`): for each period `dp`, `starvedSec` (for blocked-workload promotion)
and one accumulator `acc` (`ScpAcc`): completions, response-time sum, the 14 response-time buckets, using and delay
"samples" (total and by CPU, zIIP, I/O, cap, other), CPU engines, and the parts left out of velocity (I/O with I/O
priority management off; transaction-server regions' samples). There is no other WLM memory: no history rows, no
record of past receivers or donors, no skip clocks.

### 2.3 Sampling

Every tick `evaluateLpar` (`evaluate.ts`) dispatches the image and returns one `ScpTick` per period
(`eval/accounting.ts` `periodTicks`): time-average concurrency in each state, standing in for 250 ms samples
(`eval/results.ts` `sliceResults`). `decayInto` (`runtime.ts`) folds the tick into the accumulator:
`acc = acc × 0.85 + tick` (`ACC_DECAY`), a fixed exponential window of about 67 s. A period with no work this tick
decays toward empty (`idleScpTick`).

- Using = CPU (CP, IIPCP), zIIP, DASD connect. Delay in velocity = CPU, zIIP, I/O, storage, cap, initiator queue.
  `delayOther` (dependency, lock, CF, QR TCB waits) is kept for the bottleneck choice but is not in velocity.
- An address space's processor delay is bounded by its ready units (`results.ts`).
- A transaction's wait for regions managed to its goals counts as its own CPU delay (`srvCpuSec`).

### 2.4 Performance index

`performanceIndex` (`goals.ts`):

- **Velocity:** goal ÷ (using ÷ (using + delay) × 100), capped at 99; `null` with no samples.
- **Average response time:** (response-time sum ÷ completions) ÷ goal; `null` with no completions.
- **Percentile:** the bound of the first bucket at which the cumulative share reaches the goal percentile, so
  0.5 … 4.0 (`percentilePi`). Buckets are filled each tick from a log-normal around the tick's mean response time
  (`addToBuckets`), so a tick with half a completion still spreads a full distribution.
- **Discretionary:** 0.81.
- **Multiple periods:** each period has its own accumulator, PI and DP; nothing links the periods of one class.

Three PIs are in use, and §4 W1 turns on the difference:

| Name here | Computed from | Used for |
|---|---|---|
| local PI | this image's accumulator, without transaction-server regions' samples (`goalPi`) | receiver list, donor "happy" test, resource-group minimum (`missingGoal`), discretionary capping |
| sysplex PI | the accumulators of all images summed, then one PI (`sysplexPis`) | receiver list (first), the log's `PI=` |
| tick PI | **this tick only** (`tickPi`; percentile goals through `projectedPercentilePi`, which extends past 4.0 from the mean response time) | every projection: receiver value, donor harm, net value (`instPi` in `policyAdjust`) |

Address-space work never reports completions, so a response-time goal on a batch or started-task class has a
`null` PI in all three (C-1).

### 2.5 Receiver selection and order

`policyAdjust` (`adjust.ts`), per image, after CPU protection (§2.12):

1. Candidates are goal periods with a tick this interval and PI > 1.
2. Order: importance 1 … 5; within an importance, first those with **sysplex PI** > 1, worst first, then those with
   **local PI** > 1, worst first; ties by key. A period is listed once.
3. Per importance at most `RECEIVERS_PER_IMPORTANCE` (2, `src/content/wlm/tuning.ts`) candidates are **assessed**
   (trials run). Later ones at that importance are skipped (`BUDGET`); the next importance gets its own two.
   A candidate whose bottleneck is not fixable (§2.6) does not use the budget.
4. The first candidate with an accepted trial ends the search: one DP change per image per interval.

Nothing excludes a candidate that was assessed and rejected on the previous interval, and a period meeting its goal
is never a receiver.

### 2.6 Bottleneck

`bottleneckOf` takes the largest of the accumulator's CPU, zIIP, I/O (without the part outside velocity), cap and
other delay. Only `CPU` and `ZIIP` lead to trials; anything else logs "not WLM-fixable" and the search goes on to
the next candidate. Storage and queue delay are not candidates. A second bottleneck is never tried.

### 2.7 Trials

For a receiver at DP `r`, in this order (`policyAdjust`):

1. **Receiver up:** for each of the (up to three) nearest occupied DP levels above `r`, a trial with the receiver at
   that level **+ 1**, capped at 252. With no level above and `r` < 252: `r + 1`.
2. **Donor down:** for each of up to three donors (§2.8), a trial with that donor at `r − 1` (not below 208).

Each trial changes exactly one period's DP. Trials are independent: none builds on another, and no other period is
moved along.

### 2.8 Donors

A donor is a goal period other than the receiver that (a) has DP ≥ `r`, (b) is **less important** than the receiver,
at any PI, or **equally important with local PI < 1**, and (c) used more than 0.0001 engines of CP (CP + IIPCP) this
tick. Order: least important first, then most CP used this tick, then key; the first three. A more important period
is never a donor candidate. The filter and the order use CP even when the bottleneck is zIIP (C-2).

### 2.9 Projection

`project` re-runs `evaluateLpar` on **this tick's input** with the trial DPs (`scpsOnly`, buckets only for
percentile periods, prepared demand shared). The input is this tick's arrivals plus the whole backlog carried in
(`prepareLpar`: demand = new work + backlog ÷ 10 s), this tick's caps, I/O and paging. On images with zIIPs,
`batchRecoveryAccepts` (`batchProjection.ts`) repeats the evaluation while batch jobs' cross-pool demand settles
(up to 8 rounds) and requires every round to pass. The result is the tick PI of every period under the trial.

### 2.10 Receiver value, net value, convergence

`passes` in `policyAdjust`, with `r0`, `r1` the receiver's tick PI now and projected, `p0`, `p1` another period's:

1. `CPU_CRITICAL`: reject a trial that puts a less important period at or above a CPU-protected one (§2.12).
2. `NO_RECEIVER_GAIN`: reject if `r0` or `r1` is `null`, or `r1 ≥ r0`.
3. `SMALL_GAIN` (receiver value): reject if `r0 − r1 < 0.1 × (r0 − 1)` (`RECEIVER_VALUE_FRAC`).
4. For every other goal period, `harm = max(0, p1 − max(p0, 0.9))` (`DONOR_CREDIT_FLOOR`):
   - **more important** than the receiver: reject (`MORE_IMPORTANT_HARMED`) if `p1 > 1` and `harm > 0.02`;
   - **equally important:** reject (`EQUAL_DISPARITY`) if `harm > 0` and `|r1 − p1| ≥ |r0 − p0|`; otherwise add
     `harm` to `equalHarm`;
   - **less important:** no test.
5. `gain = max(0, r0 − max(r1, 0.9))`. Accept if `gain > equalHarm`, else `NO_NET_VALUE`.

Every period on the image is tested, whichever way its DP relates to the move. Only the receiver's gain is
credited. The first accepted trial is applied.

### 2.11 Server topology (CICS)

- `cicsRegions` (`tick/helpers.ts`) finds, per image, the CICS transaction classes (`keys`), the regions whose rule
  says TRANSACTION (`servers`) and the region class key.
- **Dispatch** (`evaluateLpar`): TRANSACTION regions and, if any AOR is TRANSACTION, every CICS transaction slice run
  at `txnDp` = the **highest DP among the transaction classes served on the image**. Each transaction class still
  owns a DP of its own; only the highest has any effect. REGION/BOTH regions and their transactions run at the
  region class's DP.
- **Samples:** TRANSACTION regions' samples are reported in the region class but left out of its local and sysplex
  PI (`srvUsing`/`srvDelay`, `goalPi`). The region class stays a goal period with a DP and is a receiver for
  whatever else is classified into it.
- **Policy adjustment** knows none of this. A transaction class is an ordinary receiver or donor; a trial moves that
  class's own DP, and the projection shows an effect only if the move changes the maximum.
- **Enclaves (DDF):** `TXN` slices in their own class at their own DP; Db2's address spaces are `AS` slices in an STC
  class. A transaction's wait for a starved Db2 is `delayOther`.

### 2.12 CPU protection

`enforceCpuProtection` runs first: every period less important than a CPU-protected period (CPU Critical, or a
first period at or above IEAOPT CCIMP) is lowered below it. `violatesCpuCritical` then rejects trials that would
break it.

### 2.13 Dispatching priority assignment

- Start (and any period seen for the first time): `initialDp` = 250, 244, 238, 232, 226 for importance 1 … 5.
- DPs carry over a policy activation by period key.
- After that a DP changes only through an accepted trial or CPU protection. Nothing remaps, spreads or lowers DPs
  when goals are met; the small-consumer priority (253) is defined in `dispatcher.ts` and never assigned.

### 2.14 Equal-DP sharing in the dispatcher

`dispatch` (`zos/dispatcher.ts`) serves DP levels from the top, zIIP pool first, then CPs with zIIP overflow. Within
a level, `shareByUnits` gives every ready unit an equal turn (max-min fair): units are an address space's
TCB/SRB count (`DISPATCH_UNITS`), one per running batch job, and for transactions one per engine of new work
(backlog adds demand, not units; `prepareLpar`). CPU queueing delay at a level is Erlang-C at the utilisation of
that level and above.

### 2.15 Resource groups and discretionary capping

- **Maximum:** `resourceGroupCaps` (`tick/helpers.ts`) turns a group's limit into a per-slice cap applied before
  dispatch (`dispatchableDemand`); the cut is CAP delay. A receiver whose largest delay is CAP is not fixable.
- **Minimum:** `rgMin` gives a group's member periods a share while any member "misses its goal" (`missingGoal`:
  local PI > 1; for a discretionary member, delay > using). `grantDispatch` (`eval/grants.ts`) dispatches that share
  as a separate demand at `RG_MIN_DP` = 252, or 207 for a discretionary member.
- **Discretionary goal management:** `discretionaryCaps` caps periods with loose goals and local PI < 0.71 while
  discretionary work is waiting.
- **Blocked workload:** a period with CPU delay and under 1 % CPU for `BLWLINTHD` gets a share at DP 253.

### 2.16 What the player sees

One log line per accepted move (`RCVR=… BTLNK=… DP F4→F6`), and every 30th tick the first note of an interval with
no move, naming the first rejected trial and its reason (`playerReason`). `inspect wlm` shows the full trace.
