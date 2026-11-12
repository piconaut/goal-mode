# WLM policy adjustment: audit and target model

Status: **design, decided by the user** (2026-11-10). **WT-04 … WT-08 are implemented**: one PI basis, sustained
demand and the §5.3 missing-goal rule (WT-04, §9.5); skip clocks, the delay test and the interval budget (WT-05,
§9.6); the canonical ladder and the z/OS 1.8 DP table (WT-06, §9.7); donor order (WT-07, §9.8); atomic plans (WT-08, §9.9). Server periods (WT-09) and the other remaining entries are not. Findings W2, W4, W5, W10 and W12 below describe the sim before those
entries; each says what fixed it. §2 describes the sim as audited (2026-11-10), before any of them. WT-04 was prototyped on branch `proto/wlm-wt04`;
§9 has its results and the two changes it made to §5. The work it leads to is in
[BACKLOG.md](../BACKLOG.md) list `wlm-truth` (WT-01 … WT-15); §8 lists its questions and the user's decisions. This
is the WLM counterpart of [rca-design.md](rca-design.md).

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
| Patent | US 5,473,773, *Apparatus and method for managing a data processing system workload according to two or more distinct processing goals*, Aman et al., IBM, filed 1994. <https://patents.google.com/patent/US5473773A/en>, accessed 2026-11-10 | **Patent (1994), page-checked** in the `zos-docs` copy (`us5473773`, [PDF](https://patentimages.storage.googleapis.com/cc/1c/48/91d9841e71b3bd/US5473773.pdf), PDF pages 18–20). IBM's original design, not product documentation: it shows how WLM was designed, not how z/OS 3.1 behaves. It describes the 1994 design: no sysplex PI, no CPU Critical, no zIIP |
| Enrico | Peter Enrico, *How WLM Works* (slides), Enterprise Performance Strategies. <https://www.epstrategies.com/library/content/Enrico.WLM032-WLMHowWLMWorks.pdf>, accessed 2026-11-10; the PDF text was extracted and read | **Practitioner** |

Page numbers are PDF page indexes (`#page=N`), as in [research.md](research.md). Where the two Redbooks or a Redbook
and a z/OS book disagree, §3 says so and prefers the z/OS book. A claim backed only by the patent or by Enrico is
labelled where it is used. Anything not found is marked *unverified*; nothing is filled in from memory.

**Repros.** All on seed 42, Normal difficulty, no player actions, through the play CLI's own code path:

- **Traces (R-n).** A play-CLI file and `npm run inspect -- <file> wlm <system> --at <time> --ticks <n>`. The file
  is made with `npm run -s play -- <file> new 42 [normal <scenario>]`, then per day `start`, `advance 24` (repeat
  until the day ends), `draft none`; `npm run repro -- <file> S-1` (or `--scenario <id> --days <n>`) plays exactly
  that. Times are sim clock; "D2" is the second played day.
- **Statistics (S-n).** A scratch harness that played the same commands through `applyPlayCommand` with
  `setWlmTraceSink` installed and counted, over every policy adjustment of every system: candidates by outcome,
  trials by verdict, accepted moves, a DP move reversed by the next move of the same period, receivers assessed
  without a move 30 intervals running, and the DP ladder at chosen times. WT-01 turned it into the committed
  `npm run inspect -- <file> wlm-stats [system] [--from …] [--to …] [--ladder …]`, and it reproduces the S-1
  column below exactly (a rejected trial's PI is the before value its projection was judged on; a donor move does
  not end a period's "assessed without a move" run). It replays faithfully: a logged `advance` stops where the play
  CLI stopped (a fresh ABEND, the end of a played day), and a log that ends before `--to` says so. "Moves" are
  accepted trials only; the CPU-protection restorations a trace also carries are not counted (none in S-1 … S-3). A
  whole-run replay costs about 6 s per played day.
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
| Receiver assessed on 30 adjustments without a move (episodes) | 7 | 4* | 20* |

The numbers are from the harness on `c0b065f`; they will differ on another commit. \*The committed verb's episode
rule gives 3 for Revenue and 22 for Harbourline; every other cell reproduces exactly, so the old harness counted
episodes slightly differently. That difference is left open (WT-01's PR notes it) rather than guessed at.

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
  as a separate demand at `RG_MIN_DP` = 252, or 207 for a discretionary member (as audited; 249 and 202 since WT-06,
§5.6).
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
  WLM can go back far enough for representative data (Enrico slide 29). *Patent (1994), [p.18][pt18]:* the patent takes response-time
  data for "thirty seconds or accumulates ten samples, whichever is less", velocity data for at least thirty seconds and five hundred non-idle
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
- *Patent (1994), [p.19][pt19]–[20][pt20]:* moves alternate between raising the receiver and lowering the donor;
  when a net value check fails, secondary receivers (below the receiver, failing the check) and secondary donors
  (above the donor, failing the check) are moved with them and the combination is checked again.

### 3.8 Donors

- A donor uses the resource the receiver is delayed for ([SG24-7621 p.105][a105]). For CPU: periods "running at a
  dispatching priority higher than or equal to the receiver's" ([WLM Services p.147][ws147]).
- Order: "Donors are selected in the reverse order of receivers" ([WLM Services p.138][ws138]). In the SMF 99
  example the first donor is the period with "the best performance index" among those at or above the receiver's
  priority, and it has the receiver's importance ([p.147][ws147]). SG24-6472 [p.59][r59]: discretionary work first,
  then "from the lowest to the highest PI of 'happy' service class periods. Importance does not contribute to the
  algorithm when the service class periods are 'happy'". Read with the receiver order of §3.5, these agree: happy
  periods by lowest PI whatever their importance, then periods missing goals from the least important up.
  *Patent (1994), [p.19][pt19]* ("Importance is not used to differentiate among goal classes meeting their specified
  goals"; else the least important owners, best PI first) and *practitioner* (Enrico slide 38) say the same.
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
  criteria designed to reject very small improvements" ([WLM Services p.138][ws138]). *Patent (1994), [p.19][pt19]:* for
  example 10 % of the difference between the receiver's PI and 1.00. *Practitioner (Enrico slide 50):* the larger of
  10 % of the PI change needed to meet the goal and 0.05, or a cut in delay samples of at least half the largest
  delay.
- **Net value:** a receiver is helped by a donor only if that does not result "in more projected harm to the donor
  than projected improvement to the receiver. If so, the condition is traced, and another donor is selected." It
  "considers all external service policy specifications (resource group capacity minimums and maximums, importance,
  and goals) for both primary and secondary donors", and SRM "may decide not to help a receiver due to minimal net
  value for either a primary or secondary donor" ([WLM Services p.137–138][ws137]).
- The rule by importance is not in IBM's books beyond "no service classes with a higher importance are badly
  affected" ([SG24-6472 p.66][r66]). *Patent (1994), [p.19][pt19] (FIG. 8):* donor projected to meet its goal and receiver missing: net
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
[pt18]: https://patentimages.storage.googleapis.com/cc/1c/48/91d9841e71b3bd/US5473773.pdf#page=18
[pt19]: https://patentimages.storage.googleapis.com/cc/1c/48/91d9841e71b3bd/US5473773.pdf#page=19
[pt20]: https://patentimages.storage.googleapis.com/cc/1c/48/91d9841e71b3bd/US5473773.pdf#page=20
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

## 4. Findings

Severity: **high** = WLM reaches a wrong system-level result that a player meets in ordinary play; **medium** = wrong
in a situation that needs a particular policy or load; **low** = a difference with little effect, or documentation.
None crashes or corrupts state. W1–W4 are the structural ones; fixing them is the target model of §5.

Trace lines are `inspect … wlm` output, shortened. `rcvr PI a→b` is the receiver's tick PI before and projected.

### W1. Receivers are chosen on one PI and judged on another (high)

**Sim.** The receiver list uses the smoothed local and sysplex PI (§2.5). Every test of a trial uses the PI of the
current tick alone (§2.10). The two differ whenever load changes within a minute, which is whenever WLM has
something to do.

**Real.** One basis: the sysplex PI "is the primary criteria used for selecting receivers and donors and assessing
changes" ([WLM Services p.138][ws138]); projections are deltas from sampled history (§3.9).

**Repro R-1** (Midwest, PROD2, D1):

```
12:19:30 → RCVR=DDFPRD#1 PI=1.20 BTLNK=CPU DONOR DDFPRD#2 DP F5→F3
12:19:40 → no DP change
  1. DDFPRD#1 imp 2 PI 0.90 (local 2.00) DP F4 BTLNK CPU
       DDFPRD#1 DP F4→F6          NO_RECEIVER_GAIN  rcvr PI 0.50→0.50      (and four more trials, the same)
  2. DDFPRD#2 imp 4 PI 2.20 (local 2.20) DP F3 BTLNK CPU
       DDFPRD#2 DP F3→F5          MORE_IMPORTANT_HARMED  rcvr PI 10.14→0.47  DDFPRD#1 (imp 2) PI 0.50→4.36
  3. TSO#2 imp 4 PI 0.41 (local 1.20) DP F5 BTLNK CPU
       TSO#2 DP F5→FB             NO_NET_VALUE  rcvr PI 0.25→0.22  gain 0.00 ≤ equal-importance harm 0.00
12:20:20   DDFPRD#2 DP F3→F5      MORE_IMPORTANT_HARMED  rcvr PI 10.23→0.48  DDFPRD#1 (imp 2) PI 0.50→4.00
12:20:30 → RCVR=DDFPRD#2 PI=7.09 BTLNK=CPU DDFPRD#2 DP F3→F5        (the same move, accepted)
12:21:10   DDFPRD#2 F5→F3      12:22:50   DDFPRD#2 F3→F5            (S-1 "reversed by its next move")
```

Three effects, all visible here:

1. **Wasted assessments.** A receiver whose tick PI is already 0.50 is assessed for three more intervals on a
   smoothed PI of 2.00, 1.40, 1.10; all five trials can only fail. Across S-1 … S-3, 13 %, 5 % and 28 % of rejected
   trials had a receiver whose own-tick PI was ≤ 0.9. In Harbourline (R-4, PRDC from D1 12:51:50) MKTDDF#1 holds a
   local PI of 4.00 against a tick PI of 0.50 for more than 30 intervals, and is assessed in every one.
2. **A misleading reason.** `gain 0.00 ≤ equal-importance harm 0.00` is logged as "equal-importance harm outweighs
   the gain" when there was no harm and the receiver was fine. The same happens with a `null` tick PI (no
   completions this tick): `NO_RECEIVER_GAIN`, 10 times in S-3.
3. **A move accepted on one quiet tick.** DDFPRD#2 moving above DDFPRD#1 is rejected for five intervals because it
   would take DDFPRD#1 from 0.50 to 4.00, then accepted in the one interval whose tick shows no harm, and undone 40
   seconds later. Four reversals in 3.5 minutes; 12, 22 and 44 reversals in S-1 … S-3.

**Play.** The player sees DPs flapping in the WLM log and a PI that swings between 0.5 and 4.0 for the first period
of a class whose second period keeps overtaking it. The log's reason for the quiet intervals is wrong (2). The clue
path explains none of it: nothing the game exposes says that the test used a different PI from the one shown.

### W2. The priority ladder only climbs, then collapses at the top (high)

*Fixed by WT-06 (§5.6, §9.7).*

**Sim.** A receiver moves to an occupied level **+ 1** (§2.7); a donor moves to just below the receiver; nothing
ever spreads the ladder or brings it down (§2.13). Each episode on a busy image leaves the periods involved one or
two steps higher, and the top is 252.

**Real.** After a change the occupied priorities are remapped so that one unoccupied priority lies between each pair
(unbunching), and small consumers are parked above the managed range ([WLM Services p.138–139][ws139]). A receiver
can be a period that meets its goal when nobody misses (§3.5 case 4), so the order keeps being tuned.

**Repro S-4** (Midwest, PROD2, 12:00 each day; PROD1 has no misses and never changes):

```
D1  ONLHI#1=FA STCHI#1=FA DDFPRD#2=F5 STCMED#1=F5 DDFPRD#1=F4 ONLMED#1=F4 TSO#1=F4 TSO#2=EB
D2  ONLHI#1=FC STCHI#1=FC DDFPRD#2=FB STCMED#1=FB TSO#2=FB DDFPRD#1=FA TSO#1=FA ONLMED#1=F4 BATCHPRD#1=E8
D4  DDFPRD#2=FC ONLHI#1=FC STCHI#1=FC STCMED#1=FC TSO#1=FC DDFPRD#1=FB TSO#2=F9 ONLMED#1=F4 BATCHPRD#1=E8
D8  ONLHI#1=FC STCHI#1=FC DDFPRD#1=FB STCMED#1=FB TSO#1=FB TSO#2=FB DDFPRD#2=FA ONLMED#1=F4 BATCHPRD#1=E8
```

From day 2, seven goal periods of importance 1 to 4 sit on three adjacent levels, and on day 4 five of them,
including the importance-4 second period of DDFPRD, share 252. **R-4** (Harbourline, PRDD, D1 14:17:40):
`MKTDDF#2=FC STCHI#1=FB MKTORD#1=FA MKTDDF#1=F9 …`: an importance-4 period at the top managed priority eight hours
into the run.

Consequences that follow from the collapse, not from any one rule:

- At one level CPU is shared by ready units (§2.14), so among the periods at 252 importance and goals no longer
  matter. WLM's only remaining move for a receiver at 252 is a donor move, one period per interval.
- A receiver at 252 with nothing above it and no eligible donor has no trial at all ("no move to try").
- The resource-group minimum is dispatched at 252 too (W10).
- The order frozen at the end of an episode stays until the next miss: on D1 from 12:23 to the next morning the
  importance-4 periods DDFPRD#2 and TSO#2 run above the importance-2 periods (`inspect … dp PROD2`, D1 13:30 to
  05:30: `DDFPRD#2=F5 STCMED#1=F5 TSO#2=F5 DDFPRD#1=F4 ONLMED#1=F4 TSO#1=F4`). That part is real WLM behaviour while
  goals are met; the climb and the collapse are not.

**Play.** `inspect dp`, the WLM log and Monitor III show nearly everything at FA–FC after a day or two. A player who
knows WLM reads that as "the policy cannot separate this work" and looks for a policy flaw that is not there.
Importance, the game's main policy lever, loses force on exactly the images under stress.

### W3. Served transaction classes each own a priority; only the highest counts (high)

**Sim.** §2.11: the regions and all CICS transactions on an image run at the maximum of the served classes' DPs. The
adjustment loop moves one class's DP at a time and does not know which one the regions follow.

**Real.** The priority belongs to the internal server period; the served classes are goal receivers and donors
without a priority of their own, and the region's own class is ignored (§3.11).

**Repro R-2** (Midwest, PROD2, D2):

```
10:21:00  STCHI#1 imp 1 PI 0.82 (local 1.01) DP FA BTLNK CPU      STCHI#1 DP FA→FC   ACCEPTED
10:22:40  ONLHI#1 imp 1 PI 1.00 (local 1.30) DP FA BTLNK CPU      ONLHI#1 DP FA→FC   ACCEPTED
10:22:50  ONLHI#1 imp 1 PI 0.90 (local 1.30) DP FC BTLNK CPU      DONOR STCHI#1 DP FC→FB  NO_RECEIVER_GAIN 0.60→0.60
   ladder: ONLHI#1=FC STCHI#1=FC DDFPRD#2=FB TSO#2=FB STCMED#1=FB DDFPRD#1=FA TSO#1=FA ONLMED#1=F4
```

- The region class STCHI is a receiver in its own right (for the members that are not transaction servers) and
  takes the top priority; this is the open question from playtest round 2. Its DP does not reach the regions.
- ONLMED#1 stays at F4 for eight days (S-4) while its transactions run at ONLHI's FC: the F4 shown in every report is
  not where the work runs.
- By code reading (C-3): with ONLHI at FC and ONLMED at F4, (a) a trial that raises ONLMED to anything up to FC
  changes nothing and fails `NO_RECEIVER_GAIN`, so ONLMED as a receiver can be helped only by a jump above ONLHI;
  (b) ONLMED as a donor candidate passes the CP-use filter (its tick carries its transactions' CPU) and a trial
  lowering it changes nothing, using a donor slot; (c) lowering ONLHI by one drops every CICS transaction and region
  on the image to F4, a cliff of eight levels, because the maximum falls to the next class's stale DP.

**Play.** A CICS class's DP in the log and in `inspect dp` cannot be trusted, and the free ride (less important
transactions lifted by the regions' priority) is invisible in priorities although it is the documented behaviour
players are meant to learn. PT-01's "two hopeless importance-1 receivers" was this finding plus W6.

### W4. Donors are picked by importance and CPU use, not by goal achievement (high)

*Fixed by WT-07 (§5.5 `donorOrder`, §9.8).*

**Sim.** §2.8. Less important periods are donors whatever their PI, least important first, heaviest CP user first;
equal importance only if happy; more important never.

**Real.** §3.8: happy periods first, best PI first, importance ignored among them; then periods missing their goals
from the least important up. A more important period that overachieves can donate. The donor must use the delayed
resource.

Differences that matter:

1. A less important period that is **missing its goal** is taken before a happy one. The net value test allows it
   (the receiver is more important), so the sim pushes down work that is already suffering while an over-achiever
   at the receiver's own importance, or above it, keeps its place.
2. An over-achieving **more important** period is never moved down. The receiver can only go above it (a receiver-up
   trial), which also puts the receiver above everything between them.
3. For a zIIP bottleneck the donors are still filtered and ordered by CP use (C-2: a period using 2 zIIP engines
   and no CP is not a donor; one using 0.2 CP and no zIIP is).
4. The "happy" test is the local PI only; IBM names the sysplex PI as the primary criterion.

**Repro.** R-1 12:19:40 lists `DONOR TSO#2`, `DONOR STCMED#1`, `DONOR ONLMED#1` for DDFPRD#1 (importance 2): the
order is importance 4, 3, 2, and STCMED is Db2, whose own trial shows the receiver going 0.50→4.00 if it is lowered.
Under IBM's order the first candidate is the happy period with the lowest PI. No seed-42 replay isolates point 3
(Revenue's zIIP-bound receivers have no donor above them, R-3); it is by code reading.

**Play.** "WLM takes from the least important work first" is what the sim teaches, and it is not how WLM chooses
donors. A player who gives batch a loose goal expecting it to donate before a struggling importance-4 class sees the
reverse.

### W5. A change is one move of one period (medium)

*Fixed by WT-08 (§5.3, §9.9): changes are atomic plans of retained moves.*

**Sim.** §2.7: each trial moves one DP; any equally or more important period the move would harm rejects it.

**Real.** §3.7: the receiver's move, the co-moves of periods that would otherwise be harmed (secondary receivers)
and the donors' moves are built up and judged together; a donor that fails net value is left where it is and the
next one is tried.

**Evidence.** `MORE_IMPORTANT_HARMED` is 58 % of all trials in S-1 and 42 % in S-3. Each is a receiver-up or donor
move that real WLM would follow by trying to carry the harmed period along. How many would then pass cannot be
known without implementing it; R-1 12:19:40 is the pattern (DDFPRD#2 above DDFPRD#1 harms DDFPRD#1, and no trial
moves both).

**Play.** A less important period behind a more important one at the same or the next level is stuck until the
more important one is happy on the tick of the test (W1.3). Players see "harms X, more important" for hours.

### W6. No skip clock and no "needs help" test; a budget instead (medium)

**Sim.** Every candidate is assessed again every 10 s. The projection cost is bounded by assessing two per
importance (§2.5).

**Real.** §3.2, §3.3: a rejected receiver is skipped until its skip clock expires; a period with no managed delay in
the last interval is not assessed; no limit per importance is documented.

**Repro.** S-2: WEBDDF#1 on Revenue PROD2 is assessed 2 846 times in three days for a zIIP bottleneck that no
priority can fix (R-3: `E8→EF SMALL_GAIN 1.80→1.80`, `E8→FB MORE_IMPORTANT_HARMED … STCHI#1 0.63→1.59`).
"Assessed 30 intervals running without a move" happens 7, 4 and 20 times in S-1 … S-3. R-4: on PRDD at D1 14:17:40
MKTDDF#1 (importance 2, local PI 4.00) is `BUDGET`: two other importance-2 candidates were assessed first and
neither could be helped. The budget bit only 4 times in S-3, so today it is rare; it is the same defect PT-01
fixed across importances, left in place within one.

**Play.** A class can sit at PI 4 with "not assessed" in the trace and nothing in the log. Rare, but it is the
"why didn't WLM help X" question with no clue path.

### W7. One bottleneck, chosen among delays WLM does not manage (medium)

**Sim.** §2.6: the largest of CPU, zIIP, I/O, cap and other; if it is not CPU or zIIP the receiver is dropped.

**Real.** §3.6: only managed delays are considered, largest first, and the next one is tried when the first cannot
be fixed.

**Evidence.** S-3: 9 499 candidates dropped as not fixable (5 291 `OTHER`, 4 208 `IO`) against 5 939 assessed. A
candidate with 45 % other delay (lock, CF, a slow server) and 40 % CPU delay is never given a CPU trial. `OTHER` is
not a WLM delay state at all; it wins the comparison because the sim keeps it in the same list.

**Play.** For the planted lesson (work waiting on a starved Db2 shows little CPU delay; WLM cannot help) this is
right and stays. It is wrong when CPU delay is a close second: the log says "BTLNK=OTHER not WLM-fixable" for a
class a DP move would help.

### W8. Projections drain the whole backlog in one interval (medium)

**Sim.** §2.9: projected demand is this tick's arrivals plus the entire backlog. A backlogged receiver moved up is
projected to take everything until the backlog is gone.

**Real.** §3.9: demand is a rate from samples; IBM is silent on backlog.

**Repro.** R-1 12:19:40: moving DDFPRD#2 (tick PI 10.14, a backlog) one level above DDFPRD#1 is projected to take
DDFPRD#1 from 0.50 to 4.36 while DDFPRD#2 itself drops to 0.47. The projection is true of the sim's next tick and
false of the minute after it. Verdicts become all-or-nothing, which feeds W1.3 and W5. This is the PROGRESS open
question "projections ignore backlog and DBAT feedback" seen from the other side: the backlog is modelled in the
projection, as a one-tick spike. Slot-queue (MXT, DBAT) feedback is outside the projection and stays so (APPROX).

**Play.** A class that has fallen behind cannot be raised past equal or more important work until it has caught up
by itself, which is when it no longer needs to be.

### W9. Receiver value has no floor (low)

`SMALL_GAIN` needs 10 % of the distance to the goal. Near the goal that is nothing: R-3 10:42:00 `needs ≥ 0.01`.
*Practitioner:* Enrico slide 50 gives the larger of that and 0.05. Small moves near PI 1 add to the churn of W1.

### W10. The resource-group minimum is dispatched inside the managed range (medium)

*Collision fixed by WT-06:* a goal member's minimum runs at `DP.RG_MINIMUM` (249, in the reserved 253–249 range,
APPROX), above all goal work; a discretionary member's at `MANAGED_MIN − 1` (202), above discretionary work only. The
second paragraph (a discretionary member's minimum is weaker than in z/OS) still holds.

`RG_MIN_DP` is 252 with the comment "above every goal-managed period", and 252 is `DP.MANAGED_MAX`
(`eval/grants.ts`, `zos/dispatcher.ts`). Once a period reaches 252 (W2: day 2 on Midwest PROD2) the guaranteed share
competes with it by ready units. By code reading (C-4); no shipped policy has a minimum.

For a discretionary member the sim serves the minimum from capacity no goal period wants (DP 207) and decides
"missing" by delay > using. Real WLM makes such a period a receiver when its group is below the minimum, after
periods missing goals and before happy ones (§3.15), so happy goal work does give way. The lever "discretionary
batch with a minimum as a throughput goal" ([SG24-6472 p.68][r68]) is weaker in the sim than in z/OS.

### W11. A response-time goal on batch or started tasks is never managed (medium)

By code reading (C-1): address-space slices report no completions (`sliceResults`), so an average or percentile
goal on a batch or STC class has no PI: never a receiver, never "missing" for a minimum, no PI in WLMGL. IBM allows
response-time goals for batch with at least three completions per 20 minutes ([WLM Planning p.71][wp71]). The policy
editor accepts such a goal without comment.

### W12. Dispatching priorities use the table from before z/OS 1.8 (low)

*Fixed by WT-06:* the sim uses the z/OS 1.8 table (SG24-6472 p.65): 248 small consumer, 247–203 managed.

§3.13: 253 small consumer and 252–208 managed against 248 and 247–203. The two Redbooks conflict; the dated
statement and the practitioner source agree on the newer table. Cosmetic, but DPs are shown in hex in the WLM log
and `inspect`, and an expert knows F7 as the top managed priority. §8 Q5.

### W13. Small consumers and mean-time-to-wait are not modelled (low)

Every discretionary period runs at 196 (C4); SPEC §5.4 says 201–192 by mean time to wait. No period is ever a small
consumer. Effects are small: discretionary work at one level shares by ready units, which already favours work that
wants little.

### W14. SPEC and code disagree about the PI window (low, documentation)

SPEC §5.5.3 says the sysplex PI is "a completion-weighted average of local PIs" and that the PI uses "an EWMA whose
horizon grows when completions are sparse". The code sums the systems' accumulators and uses a fixed decay of 0.85
per tick. Because completions are fractional and each tick spreads a full distribution over the buckets (§2.4), a
period with one completion a minute has a smooth PI: the variable PIs IBM warns about with few completions (§3.4)
cannot happen. That is a deliberate property of a fluid, deterministic model; the open question "percentile PI with
few completions" is settled as *not modelled*.

### W15. Settled without a change

| Question (PROGRESS.md) | Answer | Source |
|---|---|---|
| Does net value credit other classes the regions serve (secondary receivers)? | No documented credit: the test is donor harm against the receiver's improvement. Served classes are checked as goal donors when their regions are moved down | [WLM Services p.137–138][ws137], [p.707][ws707] |
| Does equal-importance convergence apply to secondary donors? | Net value is assessed "for both primary and secondary donors"; convergence is part of the net value rule for equal importance (*patent (1994)*, [p.19][pt19]–[20][pt20]: the combination with secondary donors must pass the same FIG. 8 check, which includes it; SG24-6472 p.60 states convergence for "the receiver and the donor"). **Yes in the 1994 design; not stated for z/OS 3.1** | [WLM Services p.138][ws138] |
| How do equal-priority units share a CPU? | Their dispatching order is rotated. The sim's equal turn per ready unit is a fluid form of that | [SG24-6472 p.66][r66], [SG24-7621 p.111][a111] |
| CPU protection: lower the less important period or raise the protected one? | The less important one is moved down. The sim's direction is IBM's, not an approximation | [WLM Services p.705][ws705] |
| A region class as a receiver | Its goal is ignored for regions managed as servers; see W3 | [SG24-6472 p.89][r89] |
| Resource-group minimum for discretionary work: what is "missing"? | Group service below the minimum; see W10 | [SG24-6472 p.63][r63] |
| zIIP time in period switching | Not found; stays open | — |

### Interactions

The findings feed each other, which is why §5 is one model and not fifteen patches:

- W1 (a lucky tick) + W5 (single moves) + W8 (backlog cliff) produce the oscillation of R-1.
- W2 (the climb) is driven by W1 and W5: each oscillation and each jump "above" costs a level that is never given
  back.
- W3 (stale DPs of served classes) makes W2 worse: ONLHI and STCHI race to 252 because neither move does what the
  projection of the other assumed.
- W6 (reassess every interval) multiplies the cost of W1 (assessing the recovered) and hides fixable receivers
  behind unfixable ones.

## 5. Target model

One loop, the same shape as IBM's (§3), sized for the sim. What stays: the 10 s interval, one receiver per image per
interval, receiver order, projection by re-running the dispatcher model, the 0.9 credit floor, CPU protection,
resource-group caps, the dispatcher. What changes: one PI basis per decision (W1), a priority ladder that is an order
and nothing else (W2), a server period that owns the regions' priority (W3), IBM's donor order (W4), a change built
from several moves (W5), skip clocks instead of a per-importance budget (W6), managed bottlenecks in turn (W7) and
sustained demand in projections (W8).

### 5.1 Terms and state

- **Goal period**: a service class period with a goal that is not discretionary. It has PIs.
- **Holder**: what owns a dispatching priority. Every goal period is its own holder, except CICS transaction
  periods: their holder is the image's **server period** `$SRMS001` when any AOR on the image is managed to
  TRANSACTION goals, else the region class's period (REGION/BOTH, as today). The server period holds the TRANSACTION
  regions and the CICS transactions; it has no goal and no PI. APPROX: one server period per image, because the sim
  does not split a workload's transactions between regions (IBM: one per set of regions serving the same classes).
- **Ladder**: the holders of an image grouped into **levels**, highest first. Only the order matters to dispatch.

State (all plain, serialised in key order):

| Field | Where | New? | Meaning |
|---|---|---|---|
| `dp` | `ScpState` | no | The DP of the period's holder. Written from the ladder every interval, so reports and saves keep their shape |
| `acc` | `ScpState` | adds `demandCp`, `demandZi`, `ziipEngines` | Decayed sums like the rest: the period's arriving demand in engines (without backlog), and zIIP engines used |
| `skipUntilTick` | `ScpState` | yes | The period is not assessed as a receiver before this tick. Absent = 0 |
| `servers` | `WlmSystemState` | yes | `[{ key: '$SRMS001', dp }]`, sorted by key. Absent in an old save: created with the highest DP among the served periods, which is what runs today |

### 5.2 Two PIs, each with one job

| | **Management PI** `m` | **Projected PI** `p` |
|---|---|---|
| From | the accumulators (`goalPi`): `mLocal` from this image, `mPlex` from all images summed | `evaluateLpar` on the projection input (§5.4) at a given ladder; percentile goals through `projectedPercentilePi` |
| Used for | who is a receiver candidate and in what order; whether a donor is happy; the resource-group minimum; reports | everything a plan is judged on: `base = p(current ladder)`, `after = p(trial ladder)` |

No test mixes them. A candidate whose `base` is ≤ 1 is recovering by itself and gets no plan.

### 5.3 The loop

```
policyAdjust(sys, def, tickInput, plexAcc, nowTick, C):
  info    ← goal periods of sys: goal, importance, cpuCritical, holder
  L       ← ladderOf(sys)                                  // holders by level, from stored DPs
  L       ← enforceCpuProtection(L, info, ccImp)           // unchanged rule; logs CPU PROTECTION
  mLocal  ← { k: goalPi(goal_k, acc_k) };  mPlex ← { k: goalPi(goal_k, plexAcc_k) }
  budget  ← C.maxProjectionsPerInterval
  base    ← not computed yet

  for r in receiverOrder(info, mPlex, mLocal):             // §2.5 order, unchanged: importance; sysplex then local; worst first; key
                                                           // after a BUDGET stop: from the receiver it stopped on, wrapping (resumeSearch)
      if skipUntilTick[r] > nowTick:              trace SKIP_CLOCK;        continue
      if managedDelayFrac(acc_r) < C.needsHelpDelayFrac:
                                                  trace NO_MANAGED_DELAY;  continue
      if base not computed: P ← projectionInput(tickInput, sys); base ← p(evaluate(P, L))
      if base[r] is null or base[r] ≤ 1:          trace RECOVERING;        continue
      tried ← false
      for b in fixableBottlenecks(acc_r, C):      // §5.7
          if budget ≤ 0:                          trace BUDGET;            goto done     // no skip clock: the next search starts at r
          plan ← buildPlan(r, b, L, base, P, info, budget, C);  tried ← true
          if plan.accepted:
              L ← plan.ladder
              log "RCVR=r PI=… BTLNK=b" + plan.moves;                      goto done     // one change per interval
      if tried: skipUntilTick[r] ← nowTick + C.rejectedSkipTicks; note the first rejected step and its reason
      else:     note "r PI=… BTLNK=<largest delay> not WLM-fixable"
  done:
  L ← canonical(L)                                         // §5.6
  write every period's dp from its holder's level; return dps, skip clocks, log, trace
```

```
buildPlan(r, b, L0, base, P, info, budget, C):
  L ← L0; moves ← []; cur ← base[r]; preferUp ← true; upBlocked ← false
  donors ← donorOrder(r, b, L0, info, C); nextDonor ← 0
  while retained move count < C.maxPlanSteps:
      if preferUp and not upBlocked:
          T ← raiseOneStep(L, holder(r))
          if no step or repeated ladder: upBlocked ← true
          else:
              assess T against base (budget checked at the actual projection)
              on a named net-value blocker k at/below r of equal or greater importance:
                  try carrying k onto r's proposed level, if this changes T and two moves fit
              else on an unsafe join (NO_NET_VALUE / EQUAL_DISPARITY):
                  try the join-and-split above that level together, if two moves fit  // APPROX
              if net value passes:
                  retain the proposal in L, never in live state; cur ← after[r]
                  if receiverValue(base[r], cur): commit the whole plan
                  preferUp ← true; continue
              upBlocked ← true
      try the next untried donor still at/above r in L (skip donors a previous raise left below r)
      if one exists:
          T ← move it onto r's level, or just below if already there
          assess T against base
          if net value passes and after[r] < cur:
              retain T; cur ← after[r]; upBlocked ← false; preferUp ← true
              if receiverValue(base[r], cur): commit the whole plan
          continue                                      // a failing donor stays; earlier retained moves survive
      if upBlocked: reject the complete plan
      preferUp ← true                                   // no donors left; further safe raises can still help
  reject the complete plan                              // step limit, no receiver value
  // Any required projection without budget returns BUDGET; every uncommitted move is rolled back.

assess(r, T):
  if violatesCpuCritical(T): return (false, CPU_CRITICAL)
  if the missing-goal rule rejects T: return (false, MORE_IMPORTANT_HARMED k) // no projection
  if budget = 0: return BUDGET
  budget −= 1
  after ← p(evaluateWithBatchRecovery(P, T))               // as batchRecoveryAccepts today: every round must pass
  return netValue(r, base, after, info, C)

receiverValue(b0, a1, C):  a1 < b0  and  b0 − a1 ≥ max(C.receiverValueFrac × (b0 − 1), C.receiverValueMinPi)

netValue(r, base, after, info, C):                       // T: the trial ladder; L0: the ladder before the plan
  // Added by the prototype (§9.3): harm that the projection cannot show still counts.
  for k ≠ r in key order with importance(k) more important than r:
      if max(base[k], mLocal[k], mPlex[k]) > 1                      // k is missing its goal: a fact, not a projection
         and usedEngines(k) ≥ C.donorMinEngines                     // k holds processor time it could lose
         and T puts holder(r) at or above holder(k) where L0 had it below or level:
          return (false, MORE_IMPORTANT_HARMED k "is missing its goal and would be passed")
  if after[r] is null or after[r] > base[r]: return (false, NO_RECEIVER_GAIN)
  gain ← max(base[r], C.creditFloor) − max(after[r], C.creditFloor);  equalHarm ← 0
  for k ≠ r in key order, with base[k] and after[k] not null:
      harm ← max(0, after[k] − max(base[k], C.creditFloor))
      if importance(k) < importance(r) and base[k] ≤ 1 < after[k]:
          return (false, MORE_IMPORTANT_HARMED k)            // crossing its goal is harm, however small (I5)
      if harm ≤ C.harmEps: continue
      if importance(k) < importance(r):                     // more important
          if after[k] > 1: return (false, MORE_IMPORTANT_HARMED k)
      else if importance(k) = importance(r):
          if |after[r] − after[k]| ≥ |base[r] − base[k]|: return (false, EQUAL_DISPARITY k)
          equalHarm += harm
      // less important: no test. base[r] > 1 is guaranteed, and a receiver missing its goal may take from them
  if gain ≤ equalHarm and equalHarm > 0:
      return (false, NO_NET_VALUE k)                     // k has largest equal-importance harm; key order breaks ties
  return (true, –, after)
```

Receiver value is judged on the whole plan against `base`, so a step that passes net value but gains too little is
kept and built on, as in IBM's example. A plan with no receiver value at the end is discarded whole. WT-08 implements this with pure `buildPlan` in
`src/sim/wlm/plan.ts`; `maxPlanSteps` counts retained UP/CARRY/DONOR moves, including both moves of a repaired
proposal. Receiver steps continue until blocked; a retained donor opens another receiver stage, and a failed donor advances to the next donor.
A join-and-split repair preserves useful multi-level raises when the intermediate join fails net value (APPROX:
one bounded lookahead, not an exhaustive search). Only a real proposal projection spends budget; CPU protection,
the missing-goal rule and the trust limit are free. Every carry or split retry checks budget separately. Net value is
judged on the whole plan too: `assess` always compares the trial ladder with `base`, never with the previous step.

### 5.4 Projection input: sustained demand

```
projectionInput(tickInput, sys):
  for each period k with slices this tick:
      arrive   ← Σ over k's slices of (cpEngines + ziipEngines)                       // this tick, no backlog
      sustained← (acc_k.demandCp + acc_k.demandZi) × (1 − ACC_DECAY)                  // decayed sum → engines
      f        ← clamp(sustained / arrive, 1, C.demandUpliftMax)                      // never below the tick
      every slice of k: rate, cpEngines, ziipEngines, ioRate × f
  for each transaction slice s: backlog'[s] ← min(backlog[s], C.backlogBoostFrac × (cpEngines_s + ziipEngines_s) × TICK_SEC)
                                 ziipBacklog'[s] scaled by the same ratio
  everything else (caps, I/O, paging, promotion, capacity) as this tick
```

- A quiet tick no longer hides a period's normal load (W1.3): its demand is lifted to its smoothed level. A rising
  load is believed at once, because `f ≥ 1`.
- A backlog adds at most `backlogBoostFrac` of a period's sustained demand (W8): a class that has fallen behind is
  projected to want somewhat more than its rate, not everything.
- `evaluate(P, current ladder)` is the `base`. It costs one evaluation and is only made when a candidate has passed
  the skip clock and the delay test.

### 5.5 Donors

```
donorOrder(r, b, L, info, C):
  pool ← holders X ≠ holder(r) with level(X) ≥ level(holder(r))
           and smoothed use of b's processor ≥ C.donorMinEngines        // CP + IIPCP for CPU, zIIP engines for ZIIP
  worst(X) ← max over X's goal periods g of max(mPlex[g], mLocal[g])    // a server period: the classes it serves
  imp(X)   ← the most important of X's goal periods
  drop X with worst(X) > 1 and imp(X) more important than r             // net value could only reject it
  order: happy holders (worst < 1) by worst ascending, importance ignored;
         then the rest by imp descending (5 first), then worst ascending; ties by key
  return the first C.donorsPerReceiver
```

As implemented in WT-07 the pool is goal periods, not holders: until server periods exist (WT-09) every goal
period is its own holder, so CICS transaction periods sharing regions are separate donors, and a donor move of one
that is not the most important of the classes its regions serve changes no dispatching. A period with neither PI
counts as missing its goal (`managementWorstPi`), here and in the "missing goals are not passed" rule.

Discretionary periods are fixed below the managed range and hold nothing a priority move could free, so they are
not in the pool (they are IBM's "universal donor" for storage and through capping).

### 5.6 The ladder

```
canonical(L):      level i from the top (i = 0, 1, …) gets DP = DP.MANAGED_MAX − 1 − 2·i
                   // one free priority between occupied ones (unbunching); MANAGED_MAX itself is never occupied
raiseOneStep(L, H): if H shares its level → H alone on a new level directly above it
                    else                   → H joins the next level above        (alone on the top level: no step)
first ladder:      one level per importance present, importance 1 on top
a period seen for the first time: the level of the lowest period of its importance; if there is none, a new level
                   directly below the lowest level that holds a more important period (the top if there is none)
```

With 45 managed priorities the canonical form holds 22 levels; if an image ever has more, every level from the 22nd
down merges into the 22nd (APPROX; no shipped policy has 22 active goal periods on an image). DPs become a function of
the order alone, so two runs that reach the same order have the same DPs, and the climb of W2 cannot occur.
`MANAGED_MAX` is left free (a sim choice: the free priority above the top level, as unbunching leaves one between
levels). A goal member's resource-group minimum runs at `DP.RG_MINIMUM` (249) and blocked-workload promotion at 253,
both in the reserved range and above all goal work (APPROX: IBM doesn't say where they run), which closes W10's
collision; a discretionary member's minimum runs at 202, above discretionary work only.

### 5.7 Bottlenecks

```
managed delays: CPU, ZIIP, IO (the part in velocity), STORAGE, QUEUE.      CAP is reported, not managed.
managedDelayFrac(acc) ← Σ managed delays ÷ (using + delay in velocity), both without transaction-server samples (as goalPi)
fixableBottlenecks(acc, C) ← [CPU, ZIIP] ordered by delay, largest first, keeping those ≥ C.bottleneckMinFrac × Σ managed delays
```

`delayOther` (waits for locks, servers, the CF, the QR TCB) is not a delay state and takes no part. A period that is
mostly waiting has little managed delay: either `NO_MANAGED_DELAY`, or a CPU plan that finds no receiver value and
sets the skip clock. The no-action note then reads `… mostly waiting, CPU delay 6 %: not WLM-fixable`, which keeps
the planted clue for a starved server (SPEC §5.5.4).

### 5.8 Server periods, minimums, batch response times

- **Dispatch:** `evaluateLpar` takes the TRANSACTION regions' and CICS transactions' DP from the server period
  instead of the maximum over served classes. A served class as receiver moves its holder. The log names both:
  `RCVR=ONLMED#1 (regions $SRMS001) …`. Served classes report their holder's DP, so the free ride shows.
- **Region class:** unchanged PI (without server regions' samples). With only server regions in it, it has no PI and
  is never a candidate.
- **Resource-group minimum:** a group is *below its minimum and wanting* when its smoothed CP service is under the
  minimum and a member has CPU delay. Goal members: as today, while a member's `mLocal` > 1. A discretionary member:
  its share is dispatched at `MANAGED_MAX` while no goal period outside the group has `mLocal` > 1, else just below
  the managed range as today (IBM's order: after periods missing goals, before happy ones).
- **Batch response-time goals:** a job's end adds one completion with response time = queue + elapsed to its
  period's accumulator and buckets. The PI then exists for as long as the decayed completion count lasts (about 20
  minutes), and varies with single jobs, which is the behaviour behind IBM's "three completions per 20 minutes".

### 5.9 Invariants and their tests

Each is a named test in `tests/sim/wlm-invariants.test.ts` (property tests over generated inputs, seeded with the
sim's RNG) or `tests/sim/realism.test.ts` (scenario assertions, SPEC §16 style). "Generated input" = 2–12 goal
periods with random goals, importances, demands and backlog on a 2–8 engine image.

| # | Invariant | Test |
|---|---|---|
| I1 | **Determinism.** Same state and input ⇒ same ladder, skip clocks, log and trace. No result depends on the order of `scps`, of slices within a period, or of object keys | Property: shuffle `scps` and the slice array; output identical after sorting. Golden runs |
| I2 | **One change per interval.** At most one receiver is helped per image per interval; all DP changes of an interval belong to its plan or to CPU protection | Property: diff of ladders before and after ⊆ plan moves ∪ protection moves |
| I3 | **Receiver order.** A candidate is assessed before every candidate of lower importance, and at equal importance sysplex-missing before local-only, worse PI first | Property on the trace order |
| I4 | **Receiver value.** An accepted plan has `base[r] − after[r] ≥ max(frac × (base[r] − 1), minPi)` | Property: recompute from the trace |
| I5 | **No harm to more important work.** No accepted plan takes a more important period from `base ≤ 1` to `after > 1`, or worsens one already above 1 by more than `harmEps` | Property. Realism: importance-1 class at its goal next to a starving importance-3 class keeps PI ≤ 1 for an hour |
| I6 | **Equal-importance convergence.** When an accepted plan harms an equally important period, the two projected PIs are closer than before and the receiver gains more than the sum of such harms | Property. Realism: two equal classes on a saturated image end within 0.3 PI of each other and stop moving |
| I7 | **Donor order.** The n-th donor tried is the n-th of `donorOrder`; a happy holder is tried before any unhappy one; a zIIP bottleneck never selects a donor with no zIIP use | Property on the trace; unit test C-2 |
| I8 | **One basis.** No plan is built for a receiver with `base ≤ 1`; every accept or reject compares `base` with `after` only | Property: every assessed candidate has `base > 1`. Unit: the tick-PI helper is gone from `policyAdjust` |
| I9 | **Canonical ladder.** After every interval the occupied managed DPs are `MANAGED_MAX − 1 − 2i`; no goal period is at `MANAGED_MAX` or outside the managed range; SYSTEM, SYSSTC and discretionary DPs never change | Property. Realism (S-4): Midwest seed 42, eight days: PROD2's goal holders at D8 12:00 are on at least four levels (today seven periods on three), and nothing is at `MANAGED_MAX` |
| I10 | **CPU protection.** After every interval no less important holder is at or above a CPU-protected period's level | Existing tests, on the ladder |
| I11 | **One priority per server.** TRANSACTION regions and the CICS transactions of an image are dispatched at their server period's DP; changing a served class's stored `dp` alone changes nothing | Unit C-3 (a), (b), (c) |
| I12 | **Skip clock, no starvation.** A receiver whose plans were all rejected is not assessed again before its clock expires; every candidate with `m` > 1 is assessed, skipped by clock, or found recovering within `rejectedSkipTicks + 2` intervals | Property over 100 intervals with five unfixable and one fixable candidate at one importance (R-4's shape): the fixable one is helped |
| I13 | **Settles.** With constant demand, DP changes stop: no move after `K` intervals. In a run, no period's move is undone by its next move within two minutes (§9.3: a slower alternation between a starving period and more important work is legitimate) | Realism: Midwest 42, PROD2, day 1 06:00–14:00 has no move undone within two minutes (`tests/sim/wlm-realism.test.ts`, written by the prototype); S-1 … S-3 "undone within two minutes" fall by at least 80 % |
| I14 | **Not fixable, not moved.** A receiver with no CPU or zIIP delay above `bottleneckMinFrac` causes no DP change and no projection beyond `base` | Property. Realism: the existing "Db2 MSTR starvation raises DDF response without DDF CPU delay" test still passes and logs the waiting note |
| I15 | **Minimum above goal work.** A resource-group minimum's share is dispatched above every goal period | Unit C-4 on the dispatch demands |
| I16 | **Cost bound.** At most `1 + maxProjectionsPerInterval` projections per image per interval; none when no candidate passes the skip clock and the delay test | Property: count `evaluateLpar` calls through the trace. `npm run bench` on the entries that touch it |
| I17 | **Projection is honest at rest.** With `f = 1` for every period and no backlog, `base` equals this tick's PIs | Unit (keeps today's "projection = execution" property) |

### 5.10 Coefficients and approximations

Every number moves to `src/content/wlm/tuning.ts` as one object `POLICY_ADJUST`, each with a `// FICTIONAL:` note of
the shape it should produce. IBM publishes none of them; the origin of a starting value is given, not a claim that
IBM uses it.

| Name | Start | Shape | Origin |
|---|---|---|---|
| `accDecay` (moves from `runtime.ts` `ACC_DECAY`) | 0.85 | PI looks back about a minute | existing |
| `receiverValueFrac` (from `adjust.ts`) | 0.1 | a plan must close a tenth of the gap to the goal | *patent (1994)* [p.19][pt19], an example; not stated for z/OS 3.1 |
| `receiverValueMinPi` | 0.05 | … and never less than this, so nothing moves for a hair | Enrico slide 50 (*practitioner*) |
| `creditFloor` (from `adjust.ts`) | 0.9 | PI below 0.9 earns and costs nothing | *patent (1994)* [p.19][pt19]; not stated for z/OS 3.1 |
| `harmEps` (from `adjust.ts`, 0.02) | 0.02 | projection noise is not harm | existing |
| `needsHelpDelayFrac` | 0.02 | a period with no managed delay is not assessed | IBM's rule is "no delay samples"; a fluid model never has exactly none |
| `bottleneckMinFrac` | 0.15 | a second bottleneck is tried only if it is a real share of the delay | invented |
| `rejectedSkipTicks` | 6 | a hopeless receiver is looked at once a minute, not every 10 s | IBM gives no length |
| `donorsPerReceiver` | 3 | bounds a plan's cost | existing |
| `donorMinEngines` | 0.01 | a holder using almost none of the processor is no donor | IBM: small consumers are not donors |
| `maxPlanSteps` | 6 | a plan is a handful of moves | invented |
| `maxProjectionsPerInterval` | 12 | the tick budget (replaces `RECEIVERS_PER_IMPORTANCE`, which is deleted) | invented |
| `demandUpliftMax` | 2 | a quiet tick is lifted to at most twice its demand | invented |
| `backlogBoostFrac` | 0.5 | work that fell behind wants up to 1.5 × its rate | invented |

Approximations, each marked `// APPROX:` where it is coded:

1. `m` is one exponential window, not rows of history; no small-sample variability for transactions (W14).
2. Projection re-runs the sim's dispatcher at sustained demand; WLM projects from demand, achievable demand and
   learned plots.
3. A backlog's demand is a fixed boost; slot-queue (MXT, DBAT) feedback is not projected.
4. One server period per image; all region wait of a served transaction counts as its CPU delay (existing).
5. Only CPU and zIIP are fixed by policy adjustment. No I/O priority, MPL or storage targets; no receiver that
   meets its goal (§3.5 case 4); no small-consumer priority; discretionary work at one priority (§8 Q3, Q6).
6. Where the canonical ladder sits in the managed range; IBM only says occupied priorities are spaced.
7. Equal-importance harm is summed over all such periods as well as tested per period (IBM: per donor).
8. A discretionary minimum yields to any goal period missing its goal on the image, not to a receiver search.
9. `needsHelpDelayFrac`, `rejectedSkipTicks`, `maxPlanSteps` stand in for rules IBM does not quantify.

### 5.11 Cost

`evaluateLpar` is linear in slices and is the whole cost. Today's worst case per image per tick is 5 importances × 2
receivers × 6 trials × up to 9 batch-recovery rounds = 540 evaluations; the measured average is far lower (S-3: 0.12
projections per adjustment). The target is bounded by I16: 13 projections, 117 evaluations with batch recovery, and
zero on an interval where every candidate is on its skip clock.

Steps whose cost grows with the number of service class periods `n`: `netValue` (O(n) per projection),
`donorOrder` and `canonical` (O(n log n) per interval), `projectionInput` (O(slices) per assessed interval). None
grows with trials beyond the budget. The entries that touch the loop record `npm run bench` before and after; the
≤ 4 ms tick budget (SPEC §15) is their gate.

## 6. Effects on play and balance

None of this is measured: the model is not implemented. Directions are reasoned from §4's repros; each `sim` entry
in the list carries its own three-scenario sweep.

### 6.1 What changes for players

| Lever | Today | With the target model | Cost or trade-off that remains |
|---|---|---|---|
| **Importance** | Decides the receiver order, then fades: on a stressed image everything ends on two or three levels (W2) | Holds under stress: the ladder is an order, more important work is never pushed past its goal for less important work, and a struggling less important class is no longer the first donor | Raising a class's importance exposes everything below it; one change per 10 s still limits how fast many classes are sorted |
| **Goal value** | Mostly decides whether a class is a receiver | Also decides who gives: the happiest period at or above the receiver donates first, whatever its importance (W4) | A goal that is easy to beat makes a class the first donor. A goal that cannot be met makes it a permanent receiver that blocks less important receivers from taking from it, and is revisited once a minute |
| **CPU Critical** | Protects against less important work | Same, and now also the way to stop an over-achieving important class from donating to less important work | It still removes WLM's freedom to trade; less important work waits longer |
| **Splitting CICS classes** (a critical-path class) | The new class's DP is one of several, only the highest counts (W3) | The regions follow the most important unhappy class they serve; the free ride of the other classes is visible as their shared DP | The free ride is real: a critical class lifts everything in the same regions. Separating work for real needs separate regions (not a lever in the game) |
| **The region class's goal and importance** (STCHI) | Looks like a lever, moves the top of the ladder, does not reach the regions | Ignored for regions managed to transaction goals, and it shows | None: it stops being a trap |
| **Resource-group minimum on discretionary batch** | Only capacity nobody wants | Served ahead of work that meets its goals | It takes from happy work and slows it toward its goal |
| **Response-time goal on batch** | Silently unmanaged | Managed, with a PI that jumps with single jobs | IBM's own advice: too few completions make it erratic; velocity is steadier |
| **Number of active periods** | More periods, slower convergence | The same, softened by skip clocks | Unchanged |

**What the log and `wlm-why` say.** One line per interval with a change, listing the plan:
`12:19:30 PROD2 RCVR=DDFPRD#1 PI=1.84 BTLNK=CPU DDFPRD#1 UP; DONOR TSO#2 DOWN` with the DPs in hex. Without a
change, the first rejected step and its reason, in the same words as now, plus three new ones: `already recovering`
(projected PI at or under 1), `mostly waiting, CPU delay n %: not WLM-fixable`, and `next look hh:mm:ss` (skip
clock). `inspect wlm` adds the outcomes `SKIP_CLOCK`, `NO_MANAGED_DELAY`, `RECOVERING` and prints each plan step with
`base → after` for the receiver and the period that rejected it. The `wlm-why` skill's verdict table is rewritten
with these (WT-15). Every reason a player reads is then stated on the PI the log shows, which is not true today
(W1).

### 6.2 Bots and the balance bands

Bands: the design targets (SPEC §16) are do-nothing loses day 12–18, textbook reaches day 28–32, expert wins; the CI
gate (`tools/ci/balanceGate.ts`) is looser: do-nothing median day 8–22, textbook 20–36, expert 28–40 with 60–100 %
victories. "Inside the bands" in §9 means the CI gate unless a row says otherwise. Latest numbers: PROGRESS.md M8.2.

| Bot | Expected direction | Rough size | Why |
|---|---|---|---|
| do-nothing | Two opposite effects. **Later:** importance-1 and -2 online work keeps its place on stressed images. **Earlier:** Db2 in STCMED (flaw F1) no longer rides up to FB/FC with everything else (S-4 shows it there from day 2), so the planted flaw bites as designed | ± 3 days on the median; Harbourline (median 9.5, the collapse starts on day 1) moves most | W2, W4 |
| textbook | Slightly later: it fixes the policy flaws, after which WLM's quality only matters near the capacity wall | 0 to + 2 days | W1, W5 |
| expert | Harbourline up from 5/10: one accepted loss was "Db2 crowded out at equal dispatch priority", which the canonical ladder removes. Midwest and Revenue stay 10/10 | + 1 to + 3 victories of 10 on Harbourline | W2 |
| spend-to-win | None: it removes the contention WLM arbitrates | 0 | |
| oraclerca | Same incidents as do-nothing with different labels: fewer incidents on important work, more `CPU_PRIORITY` on importance-4 and -5 work | no band | RT-16 judges these |

If a median leaves its band after the core entries, the fix is scenario pressure (growth, event severity, flaw
size) in the `balance` list, not a WLM coefficient chosen to hit a band (§8 Q2). BL-01 and BL-02 tune numbers this
list moves, so they should follow WT-09.

### 6.3 Guardrails

- **Every lever keeps a cost** (table above). The two that lose force (the region class's goal, a low-importance
  class as the automatic donor) were not trade-offs but traps or defaults.
- **Explainable from exposed data.** The three PIs of today collapse to the one in WLMGL and the log; the server
  period and its DP appear in the log and the Codex; skip clocks are named in the log. New Codex entries: *server
  topology and the free ride*, *donors and net value*, *skip clock*, *dispatching priorities and unbunching*.
- **Diagnosis stays the gameplay.** The planted pattern "missing its goal with little CPU delay: WLM cannot help"
  keeps its log clue (§5.7) and its realism test (I14).

## 7. Order of work

The list is BACKLOG.md `wlm-truth`, numbered in dependency order.

1. **Ready now, no behaviour change (WT-01 … WT-03).** The statistics verb on `inspect` (the acceptance tests of
   everything after it), the trace fields the tests need, and the SPEC text that already disagrees with the code.
2. **The core, after RT-06 and before RT-14 (WT-04 … WT-09),** strictly in this order, one PR and one sweep each:
   - WT-04 the PI basis and sustained demand. First, because every later rule is judged through projections, and a
     projection that changes its mind with one tick makes the other fixes unmeasurable.
   - WT-05 skip clocks, the delay test and the per-interval budget. Needs WT-04's `RECOVERING` outcome.
   - WT-06 the canonical ladder. Before the plan, because plan steps are steps on the ladder.
   - WT-07 donor order. Small, and the plan needs it.
   - WT-08 the plan (receiver up, secondary receivers, donors) and net value on the whole plan.
   - WT-09 server periods. Last of the core: it changes who holds a priority, which touches every piece above.
3. **Independent of each other, after the piece they build on (WT-10 … WT-12):** bottlenecks, the minimum for
   discretionary work, batch response times.
4. **WT-15**: Codex, SPEC, the skill, and the closing sweep.

**WT-04 and WT-08 are too coupled to split or delegate.** WT-04 changes what every test compares; WT-08 replaces
the receiver/donor/net-value core in one piece (a half-built plan with the old single-move tests is not a state
worth merging). The main agent implements both. WT-09 is cross-layer (dispatch, measurement, reporting, adjustment)
and stays on the main agent too.

**Against `rca-truth`** (user decision on §8 Q1, 2026-11-10). W3 and W4 change which work is hurt when something
goes wrong, and §6.2 expects more `CPU_PRIORITY` incidents on importance-4 and -5 work. That is what RT-14 (card
footprints) and RT-15 (grouping by cause) measure, and what BL-01/BL-02 tune. Building them on today's WLM and then
landing the core would redo footprints and balance. So:

1. `rca-truth` RT-00 … RT-13 go first. They are mostly game-layer and do not depend on WLM; RT-06 (the counterfactual
   validator) must be merged before WT-04, so the core lands under a check that incident truths move only where
   expected. Its baseline numbers change once, deliberately, with each WT entry; each WT PR reports the validator's
   differences.
2. The core WT-04 … WT-09, and WT-10 (bottlenecks change which receivers are helped): `blocked: after RT-06` for
   WT-04, then in the order above.
3. RT-14 (`blocked: after … WT-09, WT-10`), RT-15, then BL-01/BL-02 once.
4. The human playtest that gates RT-16 … RT-21, on the WLM players will keep. RT-16 and RT-19 read the server-period
   signals of WT-09 (cross-notes on both).

The playtest moves out by the core's six entries either way; this order builds footprints and balance once.

## 8. Questions for the user

| # | Question | Recommendation |
|---|---|---|
| Q1 | The playtest after RT-15 gates RT-16 … RT-21. Play it before or after the WLM core (WT-04 … WT-09)? And RT-16/RT-19 before or after WT-09? | **After.** One playtest on the WLM players will keep; RT-16 and RT-19 after WT-09, so the CPU split is built on the server-period signals. Cost: the playtest moves out by six entries |
| Q2 | If the core moves do-nothing or textbook out of its band, tune scenario content (the `balance` list) or WLM coefficients? | **Content.** The coefficients of §5.10 are chosen for behaviour (I13 settles, I16 cost). BL-01 and BL-02 then follow WT-09 |
| Q3 | Model receivers that meet their goals (IBM's case 4) so the order keeps improving when nobody misses? | **Not now** (WT-14 parked). It doubles the projections on quiet intervals for an effect players rarely see; revisit if a playtest finds a stale order hurting the next morning's ramp |
| Q4 | Show the server period (`$SRMS001`) by name in the WLM log and Codex? In z/OS it is visible only in SMF 99 | **Yes** in the log and Codex (the log is the game's SMF 99 view); RMF-style reports stay as they are and show the served classes at the regions' DP |
| Q5 | Renumber dispatching priorities to the z/OS 1.8 table (managed 247–203, small consumer 248) (W12)? | **Yes, inside WT-06,** which changes every DP in the goldens anyway. Otherwise WT-13 does it alone later with a second golden change |
| Q6 | Batch response-time goals (W11): model job completions, or only warn in the editor? | **Model** (WT-12, small), plus a Codex line with IBM's three-completions advice |
| Q7 | May the single-rule entries (WT-05, WT-07, WT-10, WT-11, WT-12) go to the Opus `realism-fixer` subagent? BACKLOG's rule keeps `sim` entries on the main agent | **Yes for those five,** with the main agent reviewing and running the sweep; never WT-04, WT-08, WT-09 |
| Q8 | Small consumers and mean-time-to-wait (W13): leave unmodelled and correct SPEC §5.4? | **Yes** (WT-03 corrects the text) |
| Q9 | `rejectedSkipTicks` is invented (IBM gives no length). One minute, or longer on Hard as a difficulty knob? | **One minute everywhere.** WLM's behaviour should not vary by difficulty |

**User decisions (2026-11-10).** Q2–Q9 as recommended. Q1: the playtest after the core, and RT-16/RT-19 after
WT-09, as recommended; in addition the core lands **before RT-14**, not after RT-15 (§7). Effects in BACKLOG.md:
WT-04 waits only for RT-06; RT-14 waits for WT-09 and WT-10; WT-13 is folded into WT-06 (Q5); WT-12 is ready (Q6,
no shipped policy affected); WT-14 is parked for a playtest (Q3, Q8); the single-rule entries may go to the
`realism-fixer` subagent (Q7).

## 9. Prototype results (WT-04)

A prototype of the first coupled entry, **WT-04** (one PI basis, projections at sustained demand), on the existing
single-move trials, as its BACKLOG entry describes. Branch `proto/wlm-wt04`, cut from `dev` at
`59f4e7e`; no PR. It is a prototype: SPEC §5.5/§17 and docs/research.md are not updated, WT-04 stays open, and the
other entries (ladder, donors, plan, server periods, skip clocks, bottlenecks) are untouched.

### 9.1 What was built

| Piece | Where |
|---|---|
| `POLICY_ADJUST` (decay, receiver value share and floor, credit floor, harm epsilon, donor minimum, demand uplift cap, backlog boost), each with a `// FICTIONAL:` note | `src/content/wlm/tuning.ts` |
| Decayed arriving demand per period (`demandCp`, `demandZi`), seeded at steady state for a new period or an old save | `eval/accounting.ts`, `eval/types.ts`, `runtime.ts` |
| `projectionInput` and `demandUplift` (§5.4) | new `src/sim/wlm/projection.ts` |
| `base` computed lazily; every test compares `base` with `after`; outcome `RECOVERING`; receiver value floor; `NO_NET_VALUE` only with equal-importance harm; rejections named in key order; the rule of §9.3 | `src/sim/wlm/adjust.ts` |
| `RECOVERING` in the trace text; accepted trials carry their receiver PIs | `tools/inspect.ts`, `adjust.ts` |

Not built from the entry: `acc.ziipEngines` (only WT-07 needs it). `ACC_DECAY` is still exported from `runtime.ts`,
now read from content.

### 9.2 What held

- **`npm run check`:** typecheck clean; 82 files, 851 tests pass (11 new).
- **Invariant tests** (`tests/sim/wlm-invariants.test.ts`, 150 generated images each; each asserts that the generator
  reached the branch it tests):

  | Test | Result |
  |---|---|
  | I8 one basis: no trial for a receiver with `base ≤ 1`; every verdict's "before" is the candidate's `base` | passes |
  | I4 receiver value: an accepted move closes a tenth of the gap and at least 0.05 | passes |
  | I17 honest at rest: settled demand, no backlog, nothing at its timeout ⇒ `base` is exactly this tick's PI | passes |
  | I1 determinism: shuffled `scps` and ticks give the same DPs and the same log line; the same input twice is identical | passes, after rejections were made to iterate in key order (the named period used to depend on `scps` order) |
  | I1 for slices: reversing the slice array changes no DP | passes |

  `tests/sim/projection.test.ts` (5): uplift never below 1 and capped; nothing lifted returns the same object; backlog
  bounded with its zIIP part; batch slices fixed and caps, I/O, paging, capacity untouched; timeouts kept.
- **Realism** (`tests/sim/wlm-realism.test.ts`): Midwest seed 42, PROD2, day 1 06:00–14:00, no DP move undone by the
  same period's next move within two minutes. It **fails on `dev`** with the four moves of R-1 (09:07 and
  12:19–12:23) and passes on the prototype.
- **Existing tests that encoded the old basis** (changed, each with a comment):
  - `adjust.test.ts`, three "hopeless receiver" tests: importance-1 receivers that are at their goal locally and
    only miss on the sysplex PI are now `RECOVERING` and use no budget. The budget tests were rebuilt on receivers
    that miss locally for a reason no DP move fixes (PR/SM delay).
  - `batchProjection.test.ts`, one test: it changed demand without letting the accumulators see it, which is now
    exactly a "quiet tick"; the accumulators are settled first.
  - `mon3.test.ts`, one assertion made conditional (the CPU-delay *share* of a class that is already mostly delayed
    in the control); `realism.test.ts`, one assertion (§9.4).
- **Goldens** regenerated (both hashes).

### 9.3 Behaviour against `dev`

`npm run compare -- --base origin/dev` (seed 42, one day): **differences in all three scenarios**, as expected.
Sim state and game state differ everywhere; the run log is the same on Midwest and Revenue and differs on
Harbourline; RMF report text first differs at tick 1260 (09:30) on Midwest and Harbourline and tick 1800 (11:00) on
Revenue. Bench hash (Midwest, one day): `bde6d147471ece9f` → `2ccd39447a530771`.

Policy adjustment statistics, same runs as §1 (S-1 Midwest days 1–2, S-2 Revenue days 1–3, S-3 Harbourline days
1–3), `dev` → prototype:

| | S-1 Midwest | S-2 Revenue | S-3 Harbourline |
|---|---|---|---|
| DP moves | 36 → 19 | 46 → 26 | 117 → 79 |
| A period's move undone by its next move, at any distance | 12 → 4 | 22 → 12 | 44 → 23 |
| … within two minutes | 6 → 0 | 6 → 1 | 19 → 4 |
| Candidates assessed | 1 609 → 1 357 | 3 046 → 4 066 | 5 939 → 4 600 |
| Candidates `RECOVERING` (no trials) | 308 | 2 218 | 2 576 |
| Rejected trials whose receiver was fine on its own tick | 793 → 0 | 383 → 0 | 5 188 → 0 (by construction) |
| `NO_NET_VALUE` (mostly the `0.00 ≤ 0.00` line) | 465 → 2 | 291 → 4 | 2 336 → 0 |
| Assessed on 30 adjustments without a move (episodes) | 7 → 5 | 4 → 7 | 20 → 8 |

The ladder still climbs (W2 is WT-06's): Midwest PROD2 at D2 12:00 is `ONLHI=FA STCHI=FA DDFPRD#2=F9 STCMED=F9
TSO#1=F9 DDFPRD#1=F8 TSO#2=F8` against `FC FC FB FB FB FA FA` on `dev`; slower only because there are fewer moves.

**Sweep** (`npm run sweep -- --bots donothing,textbook,expert --seeds 1-5`, Midwest, Normal), with the same sweep
on `dev` for the same seeds:

| Bot | Band (SPEC §16) | `dev`: day p10 / median / p90, score median, ends | Prototype |
|---|---|---|---|
| do-nothing | loses day 12–18 | 10 / 16 / 22, 1025, trust 5 | 10 / 16 / 22, 1035, trust 5 |
| textbook | reaches day 28–32 | 16 / 27 / 28, 1679, batch 3, trust 2 | 16 / 27 / 28, 1682, batch 3, trust 2 |
| expert | wins | 40 / 40 / 40, 2780, victory 5 | 40 / 40 / 40, 2774, victory 5 |

Every one of the 15 runs ends on the same day for the same cause as on `dev`; scores move by at most 10 points and
final trust by a few points either way (do-nothing seed 4: 44 → 55; seed 2: 38 → 36). Do-nothing's median is inside
its band and textbook's median of 27 is one day under its band on both, so the prototype moves nothing against the
bands. Five seeds on one scenario is a quick check, not a balance result: WT-04's own entry asks for three scenarios
and ten seeds.

**Cost.** One-day bench, Midwest, noisy host: `dev` 7.2 s (0.83 ms per tick); prototype 6.6 s and 5.9 s on two runs.
No slowdown measured; the extra `base` evaluation is offset by fewer trials. The sweep's wall time was 815 s on
`dev` and 944 s on an earlier prototype revision, run one after the other on the same host; not re-timed.

### 9.4 What the prototype taught, and what it changes in the design

Five revisions were measured before the numbers above. The first did what §5 said and was **worse** on Revenue.

| Revision | Change | Moves / undone by next move: S-1, S-2, S-3 |
|---|---|---|
| `dev` | | 36 / 12, 46 / 22, 117 / 44 |
| 1 | §5.2–§5.4 as designed | 19 / 6, **117 / 93**, 130 / 41 |
| 2 | + no transaction timeout in projections | 14 / 4, 117 / 93, 127 / 39 |
| 3 | + never pass more important work whose `base` is over 1 | 23 / 16, 26 / 12, 111 / 36 |
| 4 | + "missing" read from the management PI too | 19 / 12, 26 / 12, 79 / 28 |
| final | timeout restored; the rule only for periods that use the processor | 19 / 4, 26 / 12, 79 / 23 |

1. **A flat PI hides harm, and one basis is not enough to fix that.** (Changes §5.3.) Revision 1 on Revenue PROD2
   (D2 11:18–11:20): WEBDDF#1 (importance 4, zIIP-bound) takes STCLO#1 (importance 5) as donor; 40 s later STCLO#1,
   starved at PI 99, moves back above it, accepted because WEBDDF's projected PI was 17.06 before and after. Its
   PI was at the floor of the queueing model (both pools saturated; the queue ratio is capped), so it could not get
   worse on paper. The cycle repeated all morning: 93 undone moves against 22 on `dev`, where the same flatness had
   hidden the *gain* instead and nothing moved. The more-important test of §5.3 asked for projected harm. It now
   also has a rule that needs no projection: **a less important receiver is never moved to or above more important
   work that is missing its goal and uses the processor.** Sources: the patent ([p.19][pt19], FIG. 8 step 809: both
   missing and the donor more important: no net value) and Enrico slide 52 ("never … if donor is missing goal"); both are labelled as in §1,
   and IBM's books do not state it. §5.3's `netValue` carries the rule.
2. **"Missing its goal" is a fact, so it is read from the management PI.** Revision 3 used `base` alone and Midwest
   got worse (16 undone moves): DDFPRD#1's `base` dipped under 1 on single intervals and DDFPRD#2 slipped past.
   With `max(base, mLocal, mPlex)` the rule has the PI window's memory. This is the hysteresis the design expected
   from sustained demand; the demand uplift alone did not give it, because a percentile PI near a capacity limit is
   a step (0.5 or 4.0) and the mean demand sits just under the step.
3. **Do not project without the timeout.** Revision 2 tried it to un-flatten the PI. It changed nothing on Revenue
   (the flatness there is the queue ratio, not the timeout) and broke an existing realism test: with no upper scale,
   ONLHI's response-time PI outweighed any velocity PI and ONLHI was lifted over the Db2 it waits for (Midwest seed
   7, PROD1 capped), then sat at PI 4.0 for four hours. Projections keep what execution does. §5.4 is unchanged; the
   attempt is recorded here so it is not repeated.
4. **The rule must not count work that has nothing to lose.** Applied to every passed period, it froze WLM on a
   capped image: nothing could move past a starved importance-3 class getting no CPU. Periods using less than
   `donorMinEngines` are left to the projection (IBM: a donor uses the resource, SG24-7621 p.105).
5. **One consequence, decided by the user (2026-11-10): keep the strict rule.** Midwest seed 7 with PROD1 capped at 200 MSU: importance 1 and 2 miss
   their goals for hours (capping), and under the rule WLM now makes **no move at all** on PROD1 from 10:00, where
   `dev` made one for a less important class. The existing test's last assertion was relaxed for it. By the two
   sources this is right, and the log says why ("harms ONLHI#1, more important"), but it is the stricter reading of
   IBM's "no service classes with a higher importance are badly affected". The user chose the
   strict reading: realistic, and the log gives the clue path. (The alternative, limiting the rule to periods whose
   projected PI is at the model's floor, is not taken.)
6. **The "undone by its next move" count was the wrong measure.** WT-04's "Done when" asked for it to halve. It
   counts a starving importance-4 period that gets a turn every ten minutes when the importance-2 period above it
   is comfortable, and loses it again, which is WLM doing its job on a full image. The measure that separates W1
   from that is "undone within two minutes": 6, 6 and 19 on `dev`, 0, 1 and 4 here. I13 and the entry are reworded.
7. **Not separated by the prototype.** How much the demand uplift and the backlog bound each contribute was not
   measured apart from the rest (switching the bound off changed neither failing test). The bound is the piece
   least like execution, which does drain a whole backlog in one tick; WT-04 proper should measure both with the
   rule of point 1 in place and drop what does nothing.
8. **Smaller things.** A receiver that misses only on the sysplex PI is `RECOVERING` locally and costs nothing,
   which removes the shape PT-01 was first reported with. The order of `scps` leaked into the log through the
   period a rejection names. Existing tests that build accumulators from one tick keep working because a new
   period's demand is seeded at steady state.

### 9.5 WT-04 as landed: the uplift and the bound measured apart

WT-04 took the prototype onto `dev` at `40b81dc` (after WT-01 … WT-03, RT-06, RT-07, RT-12, CL-05, CL-06) and settled
point 7 above. `npm run inspect -- <file> wlm-stats` on the S-1 … S-3 files (seed 42, Normal, no player actions),
with `demandUpliftMax` 1 for "no uplift" and `backlogBoostFrac` unbounded for "no bound". Cells: DP moves; moves
undone by the period's next move, of which within two minutes; episodes of 30 adjustments without a move.

| Variant | S-1 Midwest | S-2 Revenue | S-3 Harbourline |
|---|---|---|---|
| both (landed) | 19; 4 / **0**; 5 | 26; 12 / 1; 5 | 79; 23 / **4**; 11 |
| no uplift | 38; 20 / **17**; 3 | 21; 10 / 0; 5 | 70; 16 / 4; 10 |
| no bound | 19; 4 / 0; 5 | 22; 8 / 1; 4 | 84; 29 / **12**; 16 |
| neither | 38; 20 / 17; 3 | 17; 6 / 0; 4 | 52; 11 / 2; 6 |

Both stay. The uplift is what keeps Midwest's DDFPRD pair from trading places on quiet ticks (R-1); the bound is what
keeps Harbourline's backlogged online classes from being projected to want everything at once. Neither alone does
both jobs, and Revenue is close either way. The "both" row reproduces the prototype's §9.3 table (episodes on S-2: 5
by the committed verb's rule, 7 by the prototype's harness). `wlm-stats` gained the two counters this needed:
candidates `RECOVERING`, and reversals within two minutes (12 adjustments of the same system).

**Review of #295 (B1): the bound hid a runaway.** On Midwest seed 2 (D2 17:03–17:15) WLM raised the runaway
DDFPRD#2 (importance 4, management PI 56.6) past DDFPRD#1 three times: with its backlog bounded the projection put
it at 1.15 → 0.72 and showed no harm, while draining the real backlog put DDFPRD#1 and ONLHI#1 at 4.0 ten seconds
later. Two fixes were measured side by side (same cells as above; "seed 2" is Midwest seed 2, D1 06:00 to D2 18:00):

| Variant | S-1 | S-2 | S-3 | Seed 2 | Seed 2 incidents D2 17:00 |
|---|---|---|---|---|---|
| neither | 19; 4 / 0; 5 | 26; 12 / 1; 5 | 79; 23 / 4; 11 | 30; 11 / 4; 6 | MOBILE, CARDAUTH |
| 1: the receiver's own backlog projected whole | 19; 4 / 0; 5 | 22; 8 / 1; 4 | 85; 29 / **12**; 16 | 22; 7 / 2; 5 | none |
| 3: no raise while management PI > 4 × `base` | 19; 4 / 0; 5 | 26; 12 / 1; 6 | 81; 23 / 4; 11 | **20; 5 / 1; 5** | none |
| both | as 1 | as 1 | as 1 | as 1 | none |

Fix 1 is "no bound" for every backlogged receiver and brings back Harbourline's flip-flop; fix 3 removes the seed-2
moves and leaves S-1 … S-3 as they were. Fix 3 landed (`projectionTrustMax`, verdict `PROJECTION_DISAGREES`).
Seed 2 now has no incident on D2 at all (on `dev` MOBILE missed from 14:00), so the RT-06 tests moved to seed 3,
whose runaway still breaks MOBILE at D2 13:00. The same review made running batch jobs exact on images without
zIIPs (they were lifted there), kept them out of the sustained demand, and counted smoothed zIIP use in
`usedEngines`; the "neither" row includes those.

Second review: the check applied wherever the PIs disagreed, also to address-space classes with no backlog (Revenue
STCLO#1: local PI 8.99, `base` 1.89). It now applies only where the bound cut the receiver's transaction backlog. S-1,
S-2 and seed 2 keep their moves and S-3 goes back to the "neither" row (81 → 79 moves, 4 undone within two
minutes, 11 episodes); it still rejects 5 976 of S-2's 15 329 trials and 9 426 of S-3's
13 899, nearly all receiver-up trials of backlogged transaction classes, in place of other rejections. A percentile
PI stops at 4.0, so a percentile receiver never trips it (a known limit).


### 9.6 WT-05: skip clocks, the delay test and the interval budget

WT-05 adds the candidate gates of §5.3 on top of WT-04 (`ac84d6a`). Same files and settings as §9.5; "seed 2" is
Midwest seed 2, D1 06:00 to D2 18:00. Cells: DP moves; moves undone by the period's next move, of which within two
minutes; episodes of 30 assessments without a move.

| | S-1 | S-2 | S-3 | Seed 2 |
|---|---|---|---|---|
| WT-04 (`dev`) | 19; 4 / 0; 5 | 26; 12 / 1; 5 | 79; 23 / 4; 11 | 20; 5 / 1; 5 |
| WT-05 | 13; 2 / 0; 1 | 29; 12 / 1; 2 | 49; 9 / 0; 2 | 26; 5 / 1; 2 |
| candidates assessed | 1 358 → 251 | 4 066 → 723 | 4 600 → 892 | 1 810 → 339 |
| projections | 5 362 → 968 | 15 329 → 2 749 | 13 899 → 2 642 | 7 145 → 1 272 |
| `PROJECTION_DISAGREES` | 0 → 0 | 5 976 → 1 017 | 9 426 → 1 575 | 2 154 → 378 |

`BUDGET` never happens in these runs (once on S-3 before). S-2's WEBDDF#1 on PROD2 is assessed 418 times in three
days (2 846 before W6's repro, under the 500 the entry asked for); the rest of its intervals are skip clock (2 019),
recovering (422) or not fixable (74). The delay test never fires in S-1 … S-3: every candidate has at least 2 % managed
delay; the periods whose waits dwarf it are `NOT_FIXABLE` instead, since the bottleneck choice still counts waits (WT-10). An early version subtracted
waits from `delay`, which never held them, and skipped such periods as `NO_MANAGED_DELAY` instead (fixed; the S-table
is unchanged by the fix, Midwest's and Revenue's one-day bench hashes are not). R-4 changed shape under WT-04: at D1 14:17:40 on PRDD MKTDDF#1 is no
longer a candidate, and it is assessed whenever it is one (four times on D1); nothing on S-3 is cut by the budget.

The episodes that remain are not every-interval re-assessment: each is a receiver no move helps, assessed once a
minute as its clock expires (S-2: WEBDDF#1 from D2 10:05 to 17:24, 372 assessments, mostly `PROJECTION_DISAGREES`
and `SMALL_GAIN`; STCLO#1 from 11:19 to 15:54, `MORE_IMPORTANT_HARMED`; S-1: BATCHPRD#1 from D2 21:09 to 22:44).
That is the documented clock (WLM Services p.145), so the entry's "0 episodes" is not met as `wlm-stats` counts them;
counted as intervals running (a skipped interval ends the run) they are 0 by construction.

Seed 2's six extra moves are a climb on PROD2 from D2 09:46 to 10:11 (STCHI, TSO#1, TSO#2, DDFPRD#1, DDFPRD#2,
ONLHI: each two DPs up in turn) that the per-importance budget used to cut short. Every one agrees with its
projection (no trust-limit case) and none is undone within two minutes; a ladder that only climbs is W2, WT-06's
entry. The runaway raise of §9.5 (D2 17:03–17:15) does not come back. RT-06 validator on S-1 … S-3: the same
incidents, triggers and verdicts as WT-04; only the hour's attainment changes (S-3's PAYMENTS at D2 09:00 54.0 →
63.9 %, the rest within 1.1 points). Bench (paired, Harbourline): 1.65 → 1.56 ms per tick.

**Sweep and the two lost seeds.** Remote sweep, Normal, seeds 1–10 (do-nothing median day / textbook median day /
expert victories): Midwest 16.5 / 28 / 10 and Revenue 20 / 27 / 10, the same as WT-04; Harbourline 9.5 / 29 / 8 → 10
/ 29 / **6** (`e90a356`; 10 / 30 / 6 before the `managedDelayFrac` fix), inside its bands but on the edge. Expert seeds 7 and 9 become trust losses, both from the D29 morning
overload (first day of month 2), when every online workload sits near 0 % for 7–9 hours against 1–6 on `dev`.
Seed 9 is identical to `dev` through D28. On D29 at 07:00 PRDA has five goal holders at FC (three on `dev`). In the
overload the receivers (STCHI#1, TSO#1, STCMED#1) are at FC and can't rise, a donor's step FC→FB gains nothing, every
receiver is clocked, and WLM makes almost no moves until the load drops; `dev` keeps making deep donor moves
(FC→F8, FC→F3) that spread the ladder, and recovers. With `rejectedSkipTicks` 0, WT-05 reproduces `dev`'s D29
on seed 9 hour for hour; with 2 it nearly does, with 3 it is half way. The budget and the delay test change nothing
there. Seed 7 also differs earlier (WT-05 handles D12 better, so the expert bot buys CPs later), but its D29 freeze
goes away with the clock too. The clock is real (WLM Services p.145); what the sim lacks is a ladder that stays spread
without churn (W2), WT-06's entry. User decision 2026-11-11: WT-05 ships with the 6-interval clock, and WT-06 checks
those two seeds.

### 9.7 WT-06: the canonical ladder

WT-06 makes the DPs a function of an order (§5.6) and moves the table to z/OS 1.8's (§3.13). Same files and settings as
§9.6; cells as there.

| | S-1 | S-2 | S-3 | Seed 2 |
|---|---|---|---|---|
| WT-05 (`dev`) | 13; 2 / 0; 1 | 29; 12 / 1; 2 | 49; 9 / 0; 2 | 26; 5 / 1; 2 |
| WT-06 | 25; 2 / 0; 4 | 26; 5 / 0; 3 | 44; 0 / 0; 2 | 48; 0 / 0; 2 |
| candidates assessed | 251 → 341 | 723 → 727 | 892 → 900 | 339 → 357 |
| projections | 968 → 1 953 | 2 749 → 4 289 | 2 642 → 4 460 | 1 272 → 1 901 |

Moves are single steps now, so a climb that was one move is two or three (seed 2: 26 → 48), and a receiver tries up
to six raises (projections up 1.5–2×; bench, Harbourline, paired: 1.37 → 1.44 ms per tick). No move is undone within
two minutes anywhere. S-1's four episodes are DDFPRD#2 and BATCHPRD#1 on PROD2, each re-assessed once a minute as its
clock expires (`SMALL_GAIN`), as in §9.6. The ladder no longer collapses: Midwest 42's PROD2 is on 7–8 levels from D1
to D8 (S-4 test), nothing reaches F7. R-4 is gone: at D1 14:17 on PRDD MKTDDF#2 is second from the bottom.

**Sweep** (remote, Normal, seeds 1–10; do-nothing median day / textbook median day / expert victories): Revenue 20 /
27 / 10 (unchanged); Midwest 16.5 / 28 / 10 → **9.5** / 28 / 10; Harbourline 10 / 29 / 6 → 10.5 / 30.5 / **7**. All
inside the CI gate's bands; Midwest do-nothing is below the design target (day 12–18).

- *Midwest do-nothing.* On 8 of 10 seeds the hands-off run ends earlier (seed 1: D22 → D8), from a MOBILE miss every
  evening at exactly 40.0 %: PROD1's share of its routing meets the SLA, PROD2's misses it. MOBILE's SLA (95 % <
  0.4 s) is stricter than DDFPRD#1's goal (90 % < 0.5 s), a planted policy flaw. The collapsed ladder kept DDFPRD#1 on
  a shared level near the top and over-served it; on the ladder, periods that ask for help step past DDFPRD#1 while
  it meets its goal (allowed: it is not missing it), and WLM gives it what its goal needs and no more. The game names
  these incidents CPU_PRIORITY/POLICY, with WLMGL showing the goal met. Real WLM behaviour. It moves the median by 7
  days, more than the ±3 the entry expected, and below the design target of day 12–18 though inside the CI gate's
  8–22. User decision (2026-11-12): accepted, no change to the ladder or the band.
- *Harbourline expert seed 9* comes back (victory): on D29 WLM makes 20–58 moves an hour from 10:00 and SLAs are back
  near 100 % by 15:00 (WT-05: 7–9 hours near 0 %).
- *Seed 7* is still lost (day 36 → 39). Its D29 freeze is not the ladder or the clock: with `rejectedSkipTicks` 0 the
  day is the same (78.7 % against 77.7 %). At D29 11:00 on PRDA the most important receivers, MKTORD#1 (importance
  1) and ONLHI#1 (2), have 98 % CPU delay and are `NOT_FIXABLE` because their waits are larger (OTHER 157 and 144
  % of using + delay): W7, WT-10's entry. The collapsed ladder hid it by keeping everything near the top.

RT-06 validator: Midwest seed 3 gains a D1 21:00 MOBILE incident (POLICY, no card), the same flaw; the runaway's
incident at D2 13:00 and its verdict are unchanged.

### 9.8 WT-07: donors in IBM's order

WT-07 orders donors by goal achievement and takes them by the processor that is short (§5.5 `donorOrder`). Same files
and settings as §9.6; cells as there.

| | S-1 | S-2 | S-3 | Seed 2 |
|---|---|---|---|---|
| WT-06 (`dev`) | 25; 2 / 0; 4 | 26; 5 / 0; 3 | 44; 0 / 0; 2 | 48; 0 / 0; 2 |
| WT-07 | 33; 0 / 0; 3 | 21; 3 / 0; 3 | 47; 2 / 0; 2 | 48; 0 / 0; 2 |
| candidates assessed | 341 → 270 | 727 → 1 027 | 900 → 919 | 357 → 459 |
| projections | 1 953 → 1 978 | 4 289 → 7 347 | 4 460 → 6 859 | 1 901 → 3 378 |
| donor moves accepted | 1 | 3 | 3 | 0 |

The pool is wider (happy more important periods, unhappy equal-importance ones), so a receiver now nearly always has
three donor trials: projections up to 1.7× (S-2), mostly donor trials refused for harming more important work or
gaining nothing. Bench (Harbourline, paired): 1.53 → 1.58 ms per tick. No move is undone within two minutes.

**R-1** at D1 12:19:30 (PROD2, DDFPRD#1 at importance 2, CPU): donors `DDFPRD#2 ONLHI#1 STCMED#1`, the happy periods at
or above it by PI (0.45, 0.50, 0.53; STCHI at 0.70 is fourth; TSO#1 at 0.11 uses 0.007 engines, under
`donorMinEngines`). `dev` listed TSO#2, STCMED#1, ONLMED#1 by importance. STCMED (Db2) is in the list because it meets
its goal there.

A happy importance-1 STC class can now be lowered for a less important receiver. In the capped-PROD1 realism case
(Db2 moved into STCHI) STCHI donates to STCMED at D1 13:57, ONLHI is wait-bound on Db2 for one assessment (`BTLNK=OTHER`)
and STCHI, now at PI 0.99, is raised again at 14:02. The projection does see ONLHI's waits on Db2 (the #307 review
measured its projected mean response time rising from 38 to 50 ms and `delayOther` from 3.4 to 10.4), but ONLHI's percentile PI is at its 0.5
floor before and after, so harm judged on the PI is nil and the move passes. That follows from the bucketed PI
(SPEC §17, "Percentile PI in WLM projections"), not from a missing dependency model; whether real WLM would make
the same trade is unverified. The test allows the dip only right after such a donation.

Review of #307 (2026-11-12): a more important period just under its goal (PI 0.995) could be taken to 1.004 because
the 0.02 noise tolerance ran before the goal-crossing test. Crossing from ≤ 1 to > 1 is now refused whatever the
size (§5.3, I5; SG24-6472-03 p.60); a three-period case in `tests/sim/wlm-realism.test.ts` covers it. The
"missing goals are not passed" rule now reads a period with no PI as missing, like the donor order. Seed-42
one-day hashes for Midwest, Revenue and Harbourline are unchanged by both.

**Sweep** (remote, Normal, seeds 1–10; do-nothing median day / textbook median day / expert victories): Midwest 9.5 /
28 / 10 and Revenue 20 / 27 / 10, both unchanged; Harbourline 10.5 / 30.5 / 7 → 10 / 30.5 / 7 (textbook gains a
victory). All inside the CI gate's bands; Midwest do-nothing stays below the design target (§9.7). The entry expected
small changes.


### 9.9 WT-08: atomic policy plans

Built on WT-07 (`1f4f212`). The planner keeps safe intermediate moves, repairs a raise with one named secondary
receiver, tries donors in WT-07 order and discards every tentative move unless the complete plan has receiver
value. One bounded join-and-split proposal preserves useful raises whose intermediate join fails net value.
The original PI basis, strict more-important goal boundary, no-PI rule, CPU protection, skip clocks, resume cursor
and real-projection budget remain in force. Six retained moves bound a plan; retries spend budget only when they
project. Traces distinguish RETAINED proposals from the one ACCEPTED plan, and tools count plans, retained moves
and projections separately. Log targets are canonical stored DPs; `UP … (above X)` explains a split whose number
stays the same while its old mates move down.

Audit at `f683789` (same S-1 … S-3 recipes as §9.8; WT-07 → WT-08; S-1 and S-2 equal `e4902b7`'s, S-3 moved
with the last review fix below):

| | S-1 | S-2 | S-3 |
|---|---|---|---|
| accepted plans | 33 → 19 | 21 → 28 | 47 → 64 |
| retained moves in accepted plans | 28 | 40 | 121 |
| secondary carries | 1 | 0 | 2 |
| proposal projections | 1 978 → 1 093 | 7 347 → 3 318 | 6 859 → 2 820 |
| net rank reversals / within two minutes | 1 / 0 | 3 / 0 | 10 / 0 |

Reversals of a composite plan are measured from the net ordinal rank of each explicitly moved period, not the
last intermediate step or raw canonical DP deltas. Internal moves of one atomic plan cannot reverse live state.
The old §1 reversal targets are ≤2/4/8: S-3's 10 does not meet the target. S-1's raw MORE_IMPORTANT_HARMED share
is 45.5% (500/1 099), above its 29% target; S-3 is 15.1% (562/3 711), below 21%. Net value now has to be assessed before receiver value
for intermediate proposals, so some failures formerly classified SMALL_GAIN now name a harmed period. These
are not met as written; the user accepted both with the targets restated (below), not by tuning coefficients.

Historical W5 thresholds are 29%/21%
MORE_IMPORTANT_HARMED for S-1/S-3; WT-07 already measured 13.3%/15.4%, so passing them alone is not evidence that
composite planning works. Real-evaluator carry cases and independently recomputed whole-plan safety checks are
the functional acceptance tests; attempted proposals, retained moves and accepted plans have separate counts.

Review follow-up on the draft: aggregate NO_NET_VALUE now names the greatest equal-importance harm (key order
breaks ties), enabling a secondary carry. A real evaluator fixture raises G00, fails with gain 149.37 versus
harm 192.30, then accepts UP + CARRY G03. Safe partial plans that run out of steps or budget explain insufficient
receiver value. Each newly started skip clock records its rejection clue, including off the periodic log cadence.
Monitor III and `inspect --moves` describe every retained move of the committed plan, including split anchors.

The legal happy-donor rule is retained; no donor cap or coefficient was added to preserve old scenario outcomes.
At D1 09:41:10 PROD2 on Midwest seed 42, a six-move plan helps importance-4 DDFPRD#2 by lowering happy TSO#1
and DDFPRD#1 (importance 2). Their projected PIs still meet their goals. This changes subsequent adaptive WLM:
the 10:00 shadow-IT pair improves MOBILE from 117.61 to 83.74 ms instead of slowing it. A separate fixed-priority
pair tests the card's CPU pressure. On seed 3, the former D1 21:00 policy-only MOBILE incident disappears, leaving
the D2 runaway incident; the counterfactual test still checks one replay at the hour boundary and its cause.
These are explicit scenario/balance changes, accepted by the user (below), not golden noise or a new general
guarantee that increased demand helps MOBILE.

The capped-PROD1 seed-7 fixture also changes beyond WT-07's §9.8 five-minute episode: ONLHI is OTHER from 14:00
through the 16:00 end of the observation, despite STCHI's partial recovery at 14:02:30. STCHI remains below ONLHI.
Waits outside velocity dominate that bottleneck choice (OTHER exceeds 100%, the outstanding WT-10 issue).
The test preserves the missing-goal ordering checks and the restored CPU rejection clue, and checks the
preceding accepted STCHI donation and actual ladder rather than a distance between deduplicated log entries.
The user accepted this longer episode as WT-10's (below); it is not claimed fixed by WT-08.

RT-06 validation against WT-07 on the same seed-42 runs: S-1 online incidents 2 → 0 (the two policy-only MOBILE
misses disappear); S-2 2 → 2, still one testable runaway cause and agreement; S-3 13 → 15, adding card-free CARDS
QR_TCB/POLICY incidents at D1 12:00 and D3 11:00. All common incidents retain their truth/cause/agreement results.
Every incident is reached and reproduced; no validator failure. This is a changed incident set, not a grading fix.

The independent review found two old log parsers that could miss a reversal by retaining an internal move kind
or only reading the first period in a plan. The convergence tests now observe committed before/after ladder
ordering, with explicit carry-then-donor and second-period donor fixtures; internal plan steps are never live moves.

Validation: full local check and CI at `e4902b7` pass 1 017 tests/90 files. The two strengthened reversal scenario
checks and four direct measurement fixtures pass. Typecheck is clean. Three
alternating bench pairs repeat each state hash: Midwest `5e3d12e473a68684`, Harbourline `b4ddefae6ecb78b2`,
Revenue `a92778144a456760` (WT-07: `de5702f483716600`, `99607427db7d9fad`, `13d9a98c4ddd06af`). Goldens change for
atomic search and the new skip-clock log clues. Quiet median day timings, head/base: Midwest 4.38/4.53 s
(two pairs; first pair excluded for a concurrent test startup), Harbourline 8.44/8.51 s, Revenue 4.50/4.56 s;
no measured regression above the 5% budget. Final three-scenario Normal seeds-1–10 sweeps are recorded in
PROGRESS M8.2. Independent review found no further production defect and verified the reversal-test fixes;
its recommendation remains NEEDS USER for the explicit unmet criteria and behaviour/balance changes.

**User decision (2026-11-12, after the #316 review).** WT-08 is accepted as it stands:
- The happy-donor plans stay. SG24-6472-03 p.60 lets a more important class donate while it still meets its goals
  easily, and p.67–68's example keeps intermediate moves without receiver value. A margin for more important
  donors would not have stopped the 09:41 plan (its donors end at PI 0.13 and 0.5).
- The scenario and balance changes above are accepted. Midwest do-nothing returns to its pre-WT-06 16.5 days,
  inside SPEC §16's day 12–18 target, so no balance entry follows.
- The two Done-when criteria are restated rather than met. The MORE_IMPORTANT_HARMED share is now counted per
  proposal, and a plan makes several proposals per candidate (free pre-check rejections included), so it is not
  comparable with §1's per-trial baseline. Reversals are measured from net rank, and none occur within two minutes,
  W1's concern. The counts in the table above are the baseline later entries report against.
- The capped-PROD1 ONLHI episode is WT-10's. Its realism test bounds it at today's 720 OTHER adjustments.

Last review fixes (`64b98d3`, `f683789`). A receiver raise was judged only against the original base, so it could
pass while undoing what earlier retained moves had bought; it now also has to match the retained plan (a donor
already had to beat it). This changes S-3 as in the table and leaves the goldens and day-1 hashes unchanged. A
receiver stuck under its skip clock re-clocks every minute, and each clock logged its clue, which shrank the
400-line log window (seed 42 day 1: 105/66/25 such lines on Midwest/Revenue/Harbourline). An unchanged clue is now
logged at most every five minutes, and a new reason or a move logs it again: 33/40/20. `npm run compare
--drop log` over two days shows no other state change; the goldens changed only because the log is hashed.
