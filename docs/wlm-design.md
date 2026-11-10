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

## 3. Real WLM, step by step

The same steps as IBM describes them. "Silent" means none of the sources in §1 says; the best other evidence is then
given with its tier. Section numbers match §2.

### 3.1 Work and periods

- All dispatchable units of a service class period have the same base dispatching priority; WLM manages the period,
  not the address space or enclave ([SG24-6472 p.62][r62], [p.66][r66]; [WLM Services p.139][ws139]).
- Period switching counts accumulated service units against the period's duration ([WLM Planning p.69][wp69]).
  Whether zIIP service is normalised to CP speed for the duration: **not found** (searched WLM Planning for
  "normaliz" and "specialty … service units"); stays an open question.
- Work that takes a response-time goal "should have at least three transaction completions per 20 minutes of elapsed
  time"; for batch a transaction is a job ([WLM Planning p.71][wp71]). SG24-6472 [p.29][r29] and [p.190][r190] say ten
  in 20 minutes. The z/OS book wins: three.

### 3.2 State

- WLM keeps "a certain amount of historical data" and learned plots relating a resource to its effect (MPL delay,
  swap delay, paging rate, proportional aggregate speed, I/O delay, queue delay) ([SG24-6472 p.58][r58],
  [p.62][r62]; [WLM Services p.140–143][ws140]).
- A **skip clock** per period: "If a receiver is assessed and all actions to help it are rejected, a skip clock
  (counter) is set and the service class period will not be selected as a receiver again until the skip clock
  expires" ([WLM Services p.145][ws145]). Its length is not given. *Practitioner:* Enrico slide 53 describes a skip
  counter set when a period was chosen as a receiver and help was given.
- *Practitioner:* histories are rows covering the last 10 s, 30 s, 60 s, 5 min, 15 min and the 15 min before, so
  WLM can go back far enough for representative data (Enrico slide 29). *IBM web:* the patent takes response-time
  data for "thirty seconds or … ten samples", velocity data for at least thirty seconds and five hundred non-idle
  samples, and weights the last 10 seconds twice. IBM's books give no numbers.

### 3.3 Sampling

- States are sampled every 250 ms and summarised every 10 s with measured data such as CPU service and transaction
  ends ([SG24-6472 p.58][r58]; [SG24-7621 p.105][a105]).
- CPU, I/O and paging delay samples are counted per dispatchable unit; swap and MPL delays per address space
  ([SG24-6472 p.64][r64]).
- A potential receiver is skipped when it "hasn't accumulated any state samples that show it was delayed for any
  resource SRM manages during the last policy interval" (the "needs help" indicator, [WLM Services p.144][ws144]).

### 3.4 Performance index

- Formulas as in §2.4; percentile PI from 14 buckets, 0.5 … 4.0; discretionary 0.81 ([SG24-6472 p.54–58][r54];
  [WLM Services p.138][ws138]).
- Each period has a local PI per system and a sysplex PI; systems exchange response-time and using/delay data so
  each can compute the sysplex PI ([SG24-6472 p.54][r54]). "The sysplex performance index is the primary criteria
  used for selecting receivers and donors and assessing changes" ([WLM Services p.138][ws138]).
- How a PI behaves with few completions: only the planning guidance of §3.1; too few completions give "highly
  variable performance indexes" ([SG24-6472 p.60][r60]).
- Transactions served by CICS/IMS regions have no using or delay states of their own. The regions' samples are
  apportioned to the served classes by the time the regions spent serving each, giving a **proportional aggregate
  speed** per served class; a plot of PI against that speed is how a change to the regions is projected onto the
  served class ([WLM Services p.142][ws142]; [SG24-6472 p.62–64][r62]).

### 3.5 Receiver selection and order

- "SRM helps only one receiver during each policy interval, although it may assess multiple receivers before finding
  one to help" ([WLM Services p.137][ws137]). One change means the access of a *set* of periods is changed to help
  one ([SG24-6472 p.68][r68]).
- Order ([SG24-6472 p.63][r63]): (1) a period missing its goal in a resource group below its minimum, by amount
  below the minimum, then importance, then PI; (2) a period missing its goal, by importance, then PI; (3) a
  discretionary period in a resource group below its minimum; (4) **a period meeting its goal, by largest PI**.
- Within an importance, sysplex PI first, then local PI, then the next importance ([SG24-6472 p.55][r55], [p.59][r59];
  [SG24-7621 p.106–107][a106]). Some resources are addressed only on the sysplex pass (trace code
  `PA_NA_SYSPLEX_ONLY`, [WLM Services p.705][ws705]); which ones is not said.
- Skipped: no managed delay in the last interval (§3.3) and an unexpired skip clock (§3.2).
- No limit on the number of receivers assessed is documented. Responsiveness is the stated reason to keep active
  periods to 25–35 ([SG24-6472 p.60][r60]).

### 3.6 Bottleneck

- The receiver's delays are examined for the resources WLM manages: processor, swap-in, MPL, I/O, server address
  space, paging. Delay by capping, locks, enqueue or operator cannot be helped; the algorithm then takes another
  receiver ([SG24-6472 p.63–64][r63]).
- The largest delay is worked on first, then the next: the SMF 99 example goes swap delay (no receiver value), then
  processor (no donor), then MPL, which is taken ([WLM Services p.148][ws148]; flow in [SG24-6472 p.59][r59]
  Figure 2-3, "Are there other bottlenecks?").
- For a served class, the regions' delay samples are apportioned to it, the largest delay is found, and the region
  set with that delay is what the fix routines get ([SG24-6472 p.64][r64]).

### 3.7 Trials: the shape of a CPU change

- WLM "logically moves the service class to higher dispatch priority and then projects the change of CPU
  consumption, demand, and delays for all service classes at a lower and the same new dispatch priority"; if that is
  not enough it looks at moving others down, "and does the same calculations", until the receiver gains enough and no
  more important work is badly affected, or nothing is possible ([SG24-6472 p.66][r66]; [SG24-7621 p.111][a111]).
- The change is **composite**. In the Redbooks' example ([SG24-6472 p.67–68][r67], [SG24-7621 p.112–113][a112]) the
  receiver I moves up; H, at I's old priority, has to move up too "because otherwise no overall value" (a
  *secondary receiver*); then donors are moved down one at a time (C passes net value, B fails and stays, A passes);
  then I moves up again and now has receiver value. If nothing works, "all intermediate calculations are set back".
- Trace codes confirm the pieces: assess moving a secondary receiver up (`PA_PMU_SEC_REC`), a secondary donor down
  (`PA_PMD_SEC_DON`), a donor up as secondary receiver (`PA_PMU_DON_SEC_REC`), and "unchanged" donors, receivers and
  secondary donors and receivers whose access changes although their priority does not (`PA_PRO_UNC_*`)
  ([WLM Services p.707–708][ws707]).
- *IBM web (patent):* moves alternate between raising the receiver and lowering the donor.

### 3.8 Donors

- A donor uses the resource the receiver is delayed for ([SG24-7621 p.105][a105]). For CPU: periods "running at a
  dispatching priority higher than or equal to the receiver's" ([WLM Services p.147][ws147]).
- Order: "Donors are selected in the reverse order of receivers" ([WLM Services p.138][ws138]). In the SMF 99
  example the first donor is the period with "the best performance index" among those at or above the receiver's
  priority, and it has the receiver's importance ([p.147][ws147]). SG24-6472 [p.59][r59]: discretionary work first,
  then "from the lowest to the highest PI of 'happy' service class periods. Importance does not contribute to the
  algorithm when the service class periods are 'happy'". Read with the receiver order of §3.5, these agree: happy
  periods by lowest PI whatever their importance, then periods missing goals from the least important up.
  *IBM web (patent)* and *practitioner* (Enrico slide 38) say the same.
- A more important period can donate to a less important one when it overachieves and is projected still to meet
  its goal easily ([SG24-6472 p.60][r60]).
- A small processor consumer is not selected as a donor (`PA_SDO_DONFAIL_SPC`, [WLM Services p.708][ws708]).

### 3.9 Projection

- From samples and service WLM knows each period's CPU use and the use of all work at each priority. **Maximum
  demand** is "the theoretical maximum percentage of total system processor time the address spaces in a service
  class period would consume if they were suffering no processor delays"; **achievable maximum demand** is what
  they are projected to use given the maximum demand of all work at higher priorities ([WLM Services p.144][ws144];
  [SG24-6472 p.66][r66]).
- The projected change in use and delay is turned into a projected PI: through velocity for unserved work, through
  the proportional aggregate speed plot for served classes (§3.4).
- A period blocked by CPU delay and getting no service is projected from its "projected response time dist only"
  (trace codes `PA_CA2_BLKD_PER_NS`, `_CM`, [WLM Services p.727][ws727]); nothing more is said.
- Silent: how a backlog of unserved transactions enters demand. Maximum demand is a rate from samples, so it is
  bounded by the units that were ready, not by how much work is queued behind them (inference from the definition).

### 3.10 Receiver value, net value, convergence

- **Receiver value:** "a minimum performance index improvement, a minimum group service increase, or other minimum
  criteria designed to reject very small improvements" ([WLM Services p.138][ws138]). *IBM web (patent):* for
  example 10 % of the difference between the receiver's PI and 1.00. *Practitioner (Enrico slide 50):* the larger of
  10 % of the PI change needed to meet the goal and 0.05, or a cut in delay samples of at least half the largest
  delay.
- **Net value:** a receiver is helped by a donor only if that does not result "in more projected harm to the donor
  than projected improvement to the receiver. If so, the condition is traced, and another donor is selected." It
  "considers all external service policy specifications (resource group capacity minimums and maximums, importance,
  and goals) for both primary and secondary donors", and SRM "may decide not to help a receiver due to minimal net
  value for either a primary or secondary donor" ([WLM Services p.137–138][ws137]).
- The rule by importance is not in IBM's books beyond "no service classes with a higher importance are badly
  affected" ([SG24-6472 p.66][r66]). *IBM web (patent):* donor projected to meet its goal and receiver missing: net
  value; both missing: net value if and only if the receiver is more important; equal importance, or both meeting:
  net value if the PI gain exceeds the PI loss, counting only the part of each PI above 0.90; and if the receiver
  would end with a lower PI than the donor, the two must end closer than they were. *Practitioner (Enrico slide
  52):* receiver more important: move if the receiver misses its goal; receiver less important: never if the donor
  misses or is projected to miss; equal: benefit above loss *and* less disparity.
- **Equal importance, both missing:** WLM "will try to bring the goal achievement of both closer together"
  ([SG24-6472 p.60][r60]).
- **Secondary receivers' gain** is never said to count toward net value: the test is donor harm against "projected
  improvement to the receiver". A period that fails the test because of the move is handled by moving it too (§3.7),
  not by crediting others.

### 3.11 Server topology

- Regions found serving the same set of transaction service classes (and in the same resource group) form a
  **dynamic internal service class period** (`$SRMSnnn`), rebuilt up to once a minute. It is the unit that holds the
  dispatching priority and collects the regions' samples ([SG24-6472 p.86–88][r86]; [WLM Services p.136–137][ws136]).
- The served class is the **goal receiver or donor**; the internal period is the **resource receiver or donor**: "SRM
  adjusts resources for the resource receiver/donor to affect the performance of the goal receiver/donor"
  ([WLM Services p.138][ws138]; trace codes `PA_GREC_CAND`, `PA_RREC_CAND`, `PA_PRO_SERVED_GREC`, `_GDON`,
  [p.705][ws705], [p.708][ws708]). Net value rejections are traced for goal donors and goal receivers
  (`PA_PMD_GDON_NETVAL`, `PA_PMU_GREC_NETVAL`, [p.707][ws707]).
- The regions' priority follows "the most important and most unhappy" transactions they serve; less important
  transactions in the same regions get a free ride ([SG24-6472 p.62–63][r62]).
- "The external service class of a server is ignored" unless the region is managed to its own goal by its
  classification rule, or is serving no transactions ([SG24-6472 p.89][r89]; [WLM Planning p.122][wp122]).
- Enclaves are managed as work of their own class; no topology ([SG24-6472 p.86][r86]).

### 3.12 CPU protection

Less important work "will generally have a lower dispatch priority" than CPU-critical work ([WLM Planning
p.120][wp120]). WLM enforces it by moving the less important ("blocker") period: `PA_CPC_MOVE_DOWN`, "period is moved
down to make room for CPU critical period", and `PA_PCC_BLKR_MOVED` ([WLM Services p.705][ws705]).

### 3.13 Dispatching priority assignment

- The two Redbooks give different tables. SG24-7621 (2010) [p.110–111][a110]: 253 small consumer, 252–208 managed,
  207–202 unused, 201–192 discretionary, 191 quiesced. SG24-6472 (2008) [p.65][r65] gives that as "prior to z/OS
  1.8" and, "as of z/OS 1.8": 254 SYSSTC and SYSSTC1–5, 253–249 reserved, **248 small consumer, 247–203 managed**,
  202 unused, 201–192 discretionary, 191 quiesce. *Practitioner:* Enrico slide 49 shows the 1.8 table. The z/OS books
  give no numbers. The dated statement in SG24-6472 is preferred; the sim has the older table (W12).
- **Unbunching:** "After a dispatching priority change, service class periods may be remapped to different
  dispatching priorities such that there is an unoccupied priority between each occupied priority"
  ([WLM Services p.139][ws139]; housekeeping code `HSK_UNBUNCH_PRTY`, [p.705][ws705]).
- **Small consumers** are "assigned a relatively high dispatching priority and not assessed for dispatching priority
  changes" ([WLM Services p.138][ws138]); housekeeping moves periods to and from that priority (`HSK_TO_SPC_DP`,
  `HSK_FROM_SPC_DP`).
- Discretionary work runs at 192–201 under a mean-time-to-wait algorithm, I/O-bound work higher
  ([SG24-6472 p.66][r66]).
- Silent: the priorities a period gets at IPL or policy activation.

### 3.14 Equal priority in the dispatcher

"The dispatching order of all dispatchable units with the same dispatching priority in the same or in different
service class periods are periodically rotated" ([SG24-6472 p.66][r66]; "naturally rotated", [SG24-7621 p.111][a111]).
A CPU delay is being ready but not dispatched "because of active work at the same or higher dispatching priority"
([SG24-6472 p.53][r53]). No z/OS book describes the rotation further.

### 3.15 Resource groups and discretionary work

- A maximum is enforced by cap slices during which the group's work is not dispatchable; granularity 1/256 since
  z/OS 2.1 ([WLM Planning p.60][wp60]; WLM Services [p.140][ws140] still says 1/64).
- A minimum is "an overriding mechanism to circumvent the normal rules of importance": if the group's work is not
  meeting its goals, WLM "attempts to provide the defined minimum" ([WLM Planning p.57][wp57]). It works through
  receiver selection (§3.5, cases 1 and 3), and net value takes minimums and maximums into account (§3.10).
- For a discretionary member the trigger is service below the minimum (§3.5 case 3), after every period missing a
  goal and before periods meeting theirs. With a minimum, a discretionary goal "can be used as a sort of throughput
  goal" ([SG24-6472 p.68][r68]).
- Discretionary goal management: conditions as in research.md ([SG24-6472 p.68][r68]).

[wp57]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=57
[wp60]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=60
[wp69]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=69
[wp71]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=71
[wp120]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=120
[wp122]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=122
[ws136]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=136
[ws137]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=137
[ws138]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=138
[ws139]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=139
[ws140]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=140
[ws142]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=142
[ws144]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=144
[ws145]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=145
[ws147]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=147
[ws148]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=148
[ws705]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=705
[ws707]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=707
[ws708]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=708
[ws727]: https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw200_v3r1.pdf#page=727
[r29]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=29
[r53]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=53
[r54]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=54
[r55]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=55
[r58]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=58
[r59]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=59
[r60]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=60
[r62]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=62
[r63]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=63
[r64]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=64
[r65]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=65
[r66]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=66
[r67]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=67
[r68]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=68
[r86]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=86
[r89]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=89
[r190]: https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=190
[a105]: https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=105
[a106]: https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=106
[a110]: https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=110
[a111]: https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=111
[a112]: https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=112
