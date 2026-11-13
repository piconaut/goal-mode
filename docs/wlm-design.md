# WLM policy adjustment: real WLM and the sim's model

The design of GOAL MODE's WLM policy adjustment, the loop that sets dispatching priorities every 10 s:
- **§3** is real WLM, step by step, with page citations;
- **§5** is the sim's model as built: its loop, invariants and the tests that check them, its coefficients and
  approximations, what the player sees, and its known gaps.

SPEC §5.5.4 is the short form, and SPEC §17 the fidelity table. This is the WLM counterpart of
[rca-design.md](rca-design.md).

The history is archived in [docs/archive/wlm-audit-2026-11.md](archive/wlm-audit-2026-11.md), **for reference
only**: the 2026-11 audit of the old model, its findings (W1 … W15), repros and statistics (R-n, S-n), the order of
work, the user's decisions and each entry's results. Section numbers here are kept from the audit, so references
such as "§5.7" stay valid. The archive holds §1's repro recipes, §2, §4 and §6 … §9.

Keep this document current: a change to the model updates §5 (and §3 if research settles something) in the same
PR.

## 1. Sources

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

## 3. Real WLM, step by step

The same steps as IBM describes them. "Silent" means none of the sources in §1 says; the best other evidence is then
given with its tier.

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
  expires" ([WLM Services p.145][ws145]). Its length is 3 policy adjustment cycles, and since z/OS 1.11 it is not
  honoured when 5 or fewer service class periods miss their performance objectives (Sinram, *z/OS Workload
  Management Update for z/OS V1.11 and V1.12*, SHARE 2010 session 7777,
  [p.11](https://github.com/piconaut/ibm-zos-books/blob/main/products/share/115/S7777_WLM_Update.pdf); modelled in
  §5.3 and §5.10). *Practitioner:* Enrico slide 53 describes a skip counter set when a period was chosen as a
  receiver and help was given.
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

- Velocity PI = goal ÷ velocity; response-time PI = actual ÷ goal; percentile PI from 14 buckets, 0.5 … 4.0; discretionary 0.81 ([SG24-6472 p.54–58][r54];
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
  give no numbers. The dated statement in SG24-6472 is preferred, and the sim uses it (§5.6).
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

## 5. The sim's model

One loop, the same shape as IBM's (§3), sized for the sim:
- **Shared with IBM:** the 10 s interval, one receiver helped per image per interval, IBM's receiver order,
  projection of every change before it is made, net value, CPU protection, resource-group minimums and maximums.
- **Sized for the sim:**
  - projection re-runs the sim's own dispatcher model at sustained demand (§5.4), where WLM uses learned plots;
  - the coefficients IBM does not publish are invented (§5.10).

Code: `src/sim/wlm/adjust.ts` (the loop), `plan.ts` (plans), `ladder.ts`, `holders.ts`, `projection.ts`,
`batchRt.ts`, `goals.ts` and `runtime.ts` (PIs and accumulators), `src/sim/zos/dispatcher.ts`. The coefficients
are `POLICY_ADJUST` in `src/content/wlm/tuning.ts`.

### 5.1 Terms and state

- **Goal period**: a service class period whose goal isn't discretionary. It has PIs.
- **Holder**: whatever owns a dispatching priority. Every goal period is its own holder, with one exception for
  CICS transaction periods:
  - When any AOR on the image is managed to TRANSACTION goals, their holder is the image's **server period**
    `$SRMS001`. It holds the TRANSACTION regions and the CICS transactions, and has no goal and no PI.
  - Otherwise (REGION or BOTH), the transactions run at the region class's DP and each served class keeps a DP
    of its own.
  - APPROX: one server period per image, because the sim doesn't split a workload's transactions between regions.
    IBM has one per set of regions serving the same classes.
- **Attached region class**: a region class whose every member on the image is a transaction-server region. It is
  attached to the server period (`holderTopology`, the same in dispatch and adjustment). It is neither receiver
  nor donor, has no level on the ladder for placing new work, gives the server period no importance, and reports
  the regions' DP.
- **Ladder**: the holders of an image, grouped into **levels**, highest first. Only the order matters to dispatch.

State (all plain data, serialised in key order):

| Field | Where | Meaning |
|---|---|---|
| `dp` | `ScpState` | The DP of the period's holder, written from the ladder every interval, so reports and saves show it |
| `acc` | `ScpState` | Decayed sums (`accDecay` 0.85 per tick): samples, completions, response times and buckets, and also arriving demand in engines without backlog (`demandCp`, `demandZi`), zIIP engines used, and, for batch response-time goals, `rtQueueSumSec` |
| `skipUntilTick` | `ScpState` | The period isn't assessed as a receiver before this tick. Absent means 0 |
| `servers` | `WlmSystemState` | `[{ key: '$SRMS001', dp }]`, sorted by key. An old save without it gets the highest DP among the served periods |

### 5.2 Two PIs, each with one job

| | **Management PI** `m` | **Projected PI** `p` |
|---|---|---|
| From | the accumulators (`goalPi`): `mLocal` from this image, `mPlex` from all images summed. Samples of transaction-server regions are left out | `evaluateLpar` on the projection input (§5.4) at a given ladder. Percentile goals go through `projectedPercentilePi` (past 4.0, extrapolated from the mean response time); velocity has no reporting ceiling of 99 (the 0.1 % velocity floor stays); batch response-time goals scale the measured PI (§5.8) |
| Used for | who is a receiver candidate, and in what order; whether a donor is happy; "missing its goal"; the resource-group minimum; reports and the log's `PI=` | everything a plan is judged on: `base = p(current ladder)`, `after = p(trial ladder)` |

The formulas are IBM's (§3.4):
- velocity PI = goal ÷ velocity;
- average response-time PI = mean response time ÷ goal;
- percentile PI = the bound of the first bucket where the cumulative share reaches the goal percentile, 0.5 … 4.0;
- discretionary PI = 0.81.

Transaction buckets are filled each tick from a log-normal around the tick's mean response time, so a period
with few completions still has a smooth PI (approximation 1). Measured average and percentile PIs expire when
the decayed completion count reaches 1e-9.

Two rules read `m` inside a plan test, both because a projection cannot show the fact they test:
- the missing-goal rule (§5.3);
- the trust limit (`projectionTrustMax`, §5.4).

A candidate whose `base` is ≤ 1 is recovering by itself and gets no plan (`RECOVERING`).

### 5.3 The loop

```
policyAdjust(sys, def, tickInput, plexAcc, nowTick, C):
  info    ← goal periods of sys: goal, importance, cpuCritical, holder
  L       ← ladderOf(sys)                                  // holders by level, from stored DPs
  L       ← enforceCpuProtection(L, info, ccImp)           // logs CPU PROTECTION
  mLocal  ← { k: goalPi(goal_k, acc_k) };  mPlex ← { k: goalPi(goal_k, plexAcc_k) }
  missing ← count(k in info: mLocal[k] > 1)                // per image; APPROX: IBM does not say per system or sysplex
  budget  ← C.maxProjectionsPerInterval
  base    ← not computed yet

  for r in receiverOrder(info, mPlex, mLocal):             // importance 1 first; sysplex-missing, then local-only; worst PI first; key
                                                           // after a BUDGET stop: from the receiver it stopped on, wrapping
      if skipUntilTick[r] > nowTick and missing > C.skipClockMinMissing:
                                                  trace SKIP_CLOCK;        continue
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
      if tried:
          if missing > C.skipClockMinMissing: skipUntilTick[r] ← nowTick + C.rejectedSkipTicks + 1
          note the first rejected step and its reason                       // no clock at ≤ 5 missing (z/OS 1.11)
      else:     note "r PI=… BTLNK=<largest delay> not WLM-fixable"
  done:
  L ← canonical(L)                                         // §5.6
  write every period's dp from its holder's level; return dps, skip clocks, log, trace
```

Only periods missing their goals are candidates. IBM's last case, a period meeting its goal chosen by largest PI
(§3.5 case 4), is not modelled, so the ladder stays as it is while every period meets its goal (approximation 5).

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
  if T puts a holder below a bounded runaway (§5.4): return (false, PROJECTION_DISAGREES) // no projection
  if budget = 0: return BUDGET
  budget −= 1
  after ← p(evaluateWithBatchRecovery(P, T))               // every batch-recovery round must pass
  return netValue(r, base, after, info, C)

receiverValue(b0, a1, C):  a1 < b0  and  b0 − a1 ≥ max(C.receiverValueFrac × (b0 − 1), C.receiverValueMinPi)

netValue(r, base, after, info, C):                       // T: the trial ladder; L0: the ladder before the plan
  // The missing-goal rule: harm that the projection cannot show still counts.
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

**Plans.** Receiver value is judged on the whole plan against `base`. A step that passes net value but gains too
little is kept and built on, as in IBM's example (§3.10), and a plan with no receiver value at the end is discarded
whole.
- `buildPlan` is pure (`src/sim/wlm/plan.ts`).
- `maxPlanSteps` counts retained UP/CARRY/DONOR moves, including both moves of a repaired proposal.
- Receiver steps continue until blocked. A retained donor opens another receiver stage, and a failed donor
  advances to the next donor.
- A join-and-split repair keeps useful multi-level raises when the intermediate join fails net value (APPROX: one
  bounded lookahead, not an exhaustive search).
- Only a real proposal projection spends budget. CPU protection, the missing-goal rule and both projection guards
  are free. Every carry or split retry checks budget separately.
- Net value is judged on the whole plan too: `assess` always compares the trial ladder with `base`, never with the
  previous step.

**The missing-goal rule.** A less important receiver is never moved to or above more important work that is missing
its goal and uses the processor.
- **Why projection isn't enough.** A projected PI can be flat at the model's floor when both pools are saturated,
  so the harm doesn't show. Without the rule, a zIIP-bound importance-4 class took an importance-5 donor and gave
  the place back every 40 s.
- **Sources.** IBM's books don't state the rule. It comes from the patent ([p.19][pt19], FIG. 8 step 809) and
  Enrico slide 52 ("never … if donor is missing goal").
- **"Missing" is read as `max(base, mLocal, mPlex)`,** so the rule keeps the PI window's memory and doesn't lapse
  on a single quiet interval.
- **Work using less than `donorMinEngines` doesn't count.** It has nothing to lose, and counting it froze WLM on
  capped images.
- **User decision (2026-11-10): keep the strict reading.** On an image capped so hard that importance 1 and 2 miss
  for hours, WLM makes no move for less important work, and the log says why (`harms ONLHI#1, more important`).

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
  running batch jobs: their exact demand (`fixedDemand`), never lifted
  everything else (caps, I/O, paging, promotion, capacity, transaction timeouts) as this tick
```

- **The demand uplift.** A quiet tick doesn't hide a period's normal load: its demand is lifted to its smoothed
  level. A rising load is believed at once, because `f ≥ 1`. Without the uplift, Midwest's DDFPRD pair traded
  places on quiet ticks.
- **The backlog bound.** A backlog adds at most `backlogBoostFrac` of a period's sustained demand, so a class that
  has fallen behind is projected to want somewhat more than its rate, not everything. Without the bound,
  Harbourline's backlogged online classes flip-flopped.
- **Timeouts stay in the projection.** Projecting without the transaction timeout was tried. It gave response-time
  PIs no upper scale and lifted ONLHI over the Db2 it waits for.
- **The base costs one evaluation.** `evaluate(P, current ladder)` is the `base`, made only when a candidate has
  passed the skip clock and the delay test.

**Two guards for the bound** (APPROX: real WLM's demand data doesn't hide a backlog, WLM Services p.144). The bound
can hide a runaway:
- **Receiver side** (`projectionTrustMax`, verdict `PROJECTION_DISAGREES`). A receiver isn't raised when the bound
  cut its transaction backlog and its management PI is over 4 × its `base`. A percentile PI stops at 4.0, so a
  percentile receiver never trips it.
- **Everyone else** (verdict `PROJECTION_DISAGREES`, no projection spent). No trial puts a holder below a period it
  was not already below when that period meets all three conditions:
  - it isn't the receiver's holder;
  - it is missing its goal;
  - the bound cut its backlog.

  Without this guard, a happy server period donated below a runaway DDF class and starved every transaction it
  serves.

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

**The pool is holders.** A server period's entry (`holderDonorInfo`) combines the classes it serves:
- **importance:** the most important of them;
- **PI:** the worst of their PIs;
- **processor use:** the sum of theirs. APPROX: the regions' own overhead stays in the region class's
  accumulators.

The receiver's own importance, not its holder's, decides the "more important and missing" drop. A period with
neither PI counts as missing its goal (`managementWorstPi`), here and in the missing-goal rule.

Discretionary periods are fixed below the managed range and hold nothing a priority move could free, so they aren't
in the pool. They are IBM's "universal donor" for storage and through capping.

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

- **DP table.** The DPs follow the z/OS 1.8 table (§3.13): managed 247–203, with 247 (`MANAGED_MAX`) left free
  as the priority above the top level.
- **Capacity.** The canonical form holds 22 levels. If an image ever has more, every level from the 22nd down
  merges into the 22nd (APPROX; no shipped policy has 22 active goal periods on an image).
- **Order alone decides.** DPs are a function of the order, so two runs that reach the same order have the same
  DPs, and the ladder can't creep upward.
- **Placement of new work.** New periods are placed on the holder ladder:
  - a new served class takes its server's DP;
  - a new server period is placed by its most important class.
- **Reserved range.** A goal member's resource-group minimum runs at `DP.RG_MINIMUM` (249), and blocked-workload
  promotion at 253. Both are in the reserved range, above all goal work (APPROX: IBM doesn't say where they run).
  A discretionary member's minimum runs at 249 while no outside goal period has local PI > 1; otherwise at 202,
  above discretionary work only (§5.8).

### 5.7 Bottlenecks

```
managed delays: CPU, ZIIP, IO (the part in velocity), STORAGE, QUEUE.      CAP is reported, not managed.
managedDelayFrac(acc) ← Σ managed delays ÷ (using + delay in velocity), both without transaction-server samples (as goalPi)
fixableBottlenecks(acc, C) ← [CPU, ZIIP] ordered by delay, largest first, keeping those ≥ C.bottleneckMinFrac × Σ managed delays
```

`delayOther` (waits for locks, servers, the CF, the QR TCB) is not a delay state and takes no part.
- A period that is mostly waiting has little managed delay. It gets either `NO_MANAGED_DELAY`, or a CPU plan that
  finds no receiver value and sets the skip clock.
- "Mostly waiting" means waits over half of all samples. The no-action note then reads `… mostly waiting, CPU
  delay 6 %: not WLM-fixable`, which keeps the planted clue for a starved server (SPEC §5.5.4).
- The same note replaces `already recovering` (`RECOVERING`): the projection at sustained demand doesn't see the
  waits that hold the measured PI up.

### 5.8 Server periods, minimums, batch response times

**Server periods.**
- **Dispatch.** `evaluateLpar` takes the DP of the TRANSACTION regions and the CICS transactions from the server
  period, not from the served classes' maximum.
- **Moves.** A served class as receiver moves its holder, and the log names both: `RCVR=ONLMED#1 (regions $SRMS001) …`.
- **Free ride.** Served classes report their holder's DP, so the free ride shows.
- **Mapping.** `src/sim/wlm/holders.ts` maps each goal period to its holder, and `cicsRegions` sets `serverKey`
  under TRANSACTION.
- **Protection.** CPU protection and the CPU-critical check work on holders: a server period is protected when a
  class it serves is.
- **Carries.** A blocker that shares the receiver's holder is never carried.
- **The region class.** Its PI leaves out the server regions' samples. With only server regions in it, it has no PI
  and is attached (§5.1).
- **REGION and BOTH** keep a DP per served class. It isn't a player lever. Making the region class the holder
  would turn transaction classes into receivers that move a region managed to its own goal.

**Resource-group minimum.**
- **When it applies.** A group is *below its minimum and wanting* when its smoothed CP service is under the
  minimum and a discretionary member has CPU delay. Goal members want the minimum while `mLocal` > 1.
- **Service.** It is the sum of every member's `ScpAcc.cpuEngines × (1 − ACC_DECAY)`, including IIPCP and
  excluding zIIP, resolved against the same group types and sysplex share as dispatch.
- **Where a discretionary share runs.** At `DP.RG_MINIMUM` (249) while no goal period outside the group has
  `mLocal` > 1, otherwise at 202. That follows IBM's order: after periods missing goals, before happy ones
  (SG24-6472 p.63; WLM Planning p.57–59).
- APPROX: the gate uses measured local PI, not a projected new goal miss.
- **Tests:** `tests/sim/resourceGroupMinimum.test.ts`.

**Batch response-time goals: measurement.**
- **One completion per job.** A job's end adds one completion to its ending period's accumulator and to its
  assigned report class, with one exact bucket observation in each (WLM Planning 3.1 p.71, p.113).
- **Response time** = queue + elapsed, on the same tick-boundary clock as RMF's job-end record.
- **The queue part** is also kept, as `rtQueueSumSec`.
- **Advice.** The JES editor warns on RT goals, and the PI Codex entry gives IBM's three-completions-per-20-minutes
  advice.
- **Tests:** `tests/sim/batchResponseGoals.test.ts`, `tests/game/batchGoals.test.ts`.

**Batch response-time goals: projection.** IBM projects from resource plots (SG24-6472 p.62) but gives no formula for
a response-time goal. The sim scales the measured PI by the projected change in execution speed, on the execution
part only (`projectBatchRtPi`, `src/sim/wlm/batchRt.ts`; APPROX):

```
PI' = PI_measured × (Q̄ + Ē × v_ref / v') / (Q̄ + Ē)
```

The terms:
- **Q̄ and Ē** are the decayed mean queue and execution times of completed jobs (`rtQueueSumSec`, `rtSumSec`,
  completions): the components RMF reports for ended transactions (RMF Report Analysis 3.1 p.146–148).
- **`v_ref`** is the period's measured execution velocity, and **`v'`** its velocity in the evaluation at the base
  or trial DPs.

How it behaves:
- **Velocities.** Both leave out server and queue-delay samples, and the 0.1 % floor applies. The queue time is
  already in Q̄, and queued WLM-initiator jobs add `delayQueue` to measured ticks only.
- **Only Ē changes.** A DP move can't shorten the JES initiator wait (SG24-6472 p.222).
- **RECOVERING keeps its meaning.** The base uses `v'` at the current DPs, so a period is recovering when
  sustained-demand speed already meets the goal.
- **Null means no move.** The PI is null with no unexpired completion or no running job of the period: no DP
  speeds up work that isn't running.
- **PCT goals** take the same factor, with Q̄ and Ē from the means, because buckets keep no queue/execution split.
- **Donors** use the same formula.
- **When the formula is used.** Only while the period still has address-space work in the evaluation and a queue
  split. A class that now serves transactions keeps the transaction projection.
- **Old saves.** An old save has no queue split until its next batch completion.

**Rejected: forecasting each job's remaining work.** WLM doesn't know it, and RMF reports response times for ended
transactions only. The rule uses no data WLM and RMF lack, and it reproduces IBM's warning about sparse completions
rather than curing it: the PI jumps when a job ends and is gone 25 minutes after the last one. Started tasks have no
completions.

**Tests:** `tests/sim/batchRt.test.ts`.

### 5.9 Invariants and their tests

Each invariant is a named test in one of these files:
- `tests/sim/wlm-invariants.test.ts`: property tests over generated inputs, seeded with the sim's RNG. A generated
  input is 2–12 goal periods with random goals, importances, demands and backlog, on a 2–8 engine image.
- `tests/sim/wlm-realism.test.ts`, `tests/sim/realism.test.ts`: scenario assertions, SPEC §16 style.
- `tests/sim/wlm-servers.test.ts`: server periods.

| # | Invariant | Test |
|---|---|---|
| I1 | **Determinism.** Same state and input ⇒ same ladder, skip clocks, log and trace. No result depends on the order of `scps`, of slices within a period, or of object keys | Property: shuffle `scps` and the slice array; output identical after sorting. Golden runs |
| I2 | **One change per interval.** At most one receiver is helped per image per interval; all DP changes of an interval belong to its plan or to CPU protection | Property: diff of ladders before and after ⊆ plan moves ∪ protection moves |
| I3 | **Receiver order.** A candidate is assessed before every candidate of lower importance, and at equal importance sysplex-missing before local-only, worse PI first | Property on the trace order |
| I4 | **Receiver value.** An accepted plan has `base[r] − after[r] ≥ max(frac × (base[r] − 1), minPi)` | Property: recompute from the trace |
| I5 | **No harm to more important work.** No accepted plan takes a more important period from `base ≤ 1` to `after > 1`, or worsens one already above 1 by more than `harmEps` | Property. Realism: importance-1 class at its goal next to a starving importance-3 class keeps PI ≤ 1 for an hour |
| I6 | **Equal-importance convergence.** When an accepted plan harms an equally important period, the two projected PIs are closer than before and the receiver gains more than the sum of such harms | Property. Realism: two equal classes on a saturated image end within 0.3 PI of each other and stop moving |
| I7 | **Donor order.** The n-th donor tried is the n-th of `donorOrder`; a happy holder is tried before any unhappy one; a zIIP bottleneck never selects a donor with no zIIP use | Property on the trace; unit test |
| I8 | **One basis.** No plan is built for a receiver with `base ≤ 1`; every accept or reject compares `base` with `after` only | Property: every assessed candidate has `base > 1` |
| I9 | **Canonical ladder.** After every interval the occupied managed DPs are `MANAGED_MAX − 1 − 2i`; no goal period is at `MANAGED_MAX` or outside the managed range; SYSTEM, SYSSTC and discretionary DPs never change | Property. Realism: Midwest seed 42, eight days: PROD2's goal holders at D8 12:00 are on at least four levels, and nothing is at `MANAGED_MAX` |
| I10 | **CPU protection.** After every interval no less important holder is at or above a CPU-protected period's level | Unit and realism tests, on the ladder |
| I11 | **One priority per server.** TRANSACTION regions and the CICS transactions of an image are dispatched at their server period's DP; changing a served class's stored `dp` alone changes nothing | Unit (`tests/sim/wlm-servers.test.ts`) |
| I12 | **Skip clock, no starvation.** While more than five goal periods on the image miss their goals, a receiver whose plans were all rejected is not assessed again before its clock expires; at five or fewer the clock is not honoured (z/OS 1.11). With the budget not stopping the search, every candidate with `m` > 1 is assessed, skipped by clock, or found recovering within `rejectedSkipTicks + 2` intervals | Property over 40 intervals on generated images with a 6-projection budget |
| I13 | **Settles.** With constant demand, DP changes stop. In a run, no period's move is undone by its next move within two minutes, unless another receiver's accepted plan in between projected the period past its goal (conditions changed; user decision 2026-11-12). A slower alternation, a starving period getting a turn every few minutes under comfortable more important work, is WLM doing its job and is not counted | Realism: Midwest 42, PROD2, day 1 06:00–14:00 has at most one move undone within two minutes. `inspect … wlm-stats` counts reversals within two minutes (and those after another plan apart). The 2026-11 target of an 80 % fall was met on Midwest and Revenue; Harbourline's 19 → 8 was accepted by the user on 2026-11-13 |
| I14 | **Not fixable, not moved.** A receiver with no CPU or zIIP delay above `bottleneckMinFrac` causes no DP change and no projection beyond `base` | Property. Realism: "Db2 MSTR starvation raises DDF response without DDF CPU delay" logs the waiting note |
| I15 | **Minimum above goal work.** A resource-group minimum's share for a goal member is dispatched above every goal period | Unit on the dispatch demands |
| I16 | **Cost bound.** At most `1 + maxProjectionsPerInterval` projections per image per interval; none when no candidate passes the skip clock and the delay test | Property: count `evaluateLpar` calls through the trace. `npm run bench` on changes that touch it |
| I17 | **Projection is honest at rest.** With `f = 1` for every period and no backlog, `base` equals this tick's PIs | Unit |

### 5.10 Coefficients and approximations

Every number is in `src/content/wlm/tuning.ts` `POLICY_ADJUST`, with a `// FICTIONAL:` note on the shape it should
produce. IBM publishes none of them, so the "Origin" column says where a value came from, not that IBM uses it.

| Name | Value | Shape | Origin |
|---|---|---|---|
| `accDecay` | 0.85 | the management PI looks back about a minute | invented |
| `receiverValueFrac` | 0.1 | a plan must close a tenth of the gap to the goal | *patent (1994)* [p.19][pt19], an example; not stated for z/OS 3.1 |
| `receiverValueMinPi` | 0.05 | … and never less than this, so nothing moves for a hair | Enrico slide 50 (*practitioner*) |
| `creditFloor` | 0.9 | PI below 0.9 earns and costs nothing | *patent (1994)* [p.19][pt19]; not stated for z/OS 3.1 |
| `harmEps` | 0.02 | projection noise is not harm | invented |
| `needsHelpDelayFrac` | 0.02 | a period with no managed delay is not assessed | IBM's rule is "no delay samples" (WLM Services p.144); a fluid model never has exactly none |
| `bottleneckMinFrac` | 0.15 | a second bottleneck is tried only if it is a real share of the delay | invented |
| `rejectedSkipTicks` | 3 | a hopeless receiver is looked at every fourth cycle | IBM: 3 policy adjustment cycles (Sinram, SHARE 2010 session 7777 p.11; WLM Services p.145 gives the clock but not its length). One length on every difficulty: WLM's behaviour does not vary by difficulty |
| `skipClockMinMissing` | 5 | at five or fewer periods missing their goals, a quiet image reassesses every interval and starts no clock | IBM: the z/OS 1.11 exception (Sinram p.11) |
| `donorsPerReceiver` | 3 | bounds a plan's cost | invented |
| `donorMinEngines` | 0.01 | a holder using almost none of the processor is no donor | IBM: a donor uses the resource (SG24-7621 p.105) |
| `maxPlanSteps` | 6 | a plan is a handful of moves | invented |
| `maxProjectionsPerInterval` | 12 | the tick budget | invented |
| `demandUpliftMax` | 2 | a quiet tick is lifted to at most twice its demand | invented |
| `backlogBoostFrac` | 0.5 | work that fell behind wants up to 1.5 × its rate | invented |
| `projectionTrustMax` | 4 | a receiver whose backlog the bound cut and that is measured over 4 × its `base` is not raised (§5.4) | invented |

Don't tune a coefficient to move a balance band. Balance is tuned through scenario pressure in the `balance` list
(user decision 2026-11-10).

Approximations, each marked `// APPROX:` where it is coded:

1. **One exponential window.** `m` uses one window, not rows of history, and transaction PIs have no small-sample
   variability (§5.2). Discrete batch completions are the exception: their PIs jump and expire.
2. **The sim's dispatcher instead of plots.** Projection re-runs the dispatcher at sustained demand; WLM projects
   from demand, achievable demand and learned plots.
3. **Backlog.** A backlog's demand is a fixed boost, and slot-queue (MXT, DBAT) feedback is not projected. Two
   guards stand in for demand data that would show a backlog (§5.4).
4. **One server period per image.** All region wait of a served transaction counts as its CPU delay.
5. **Narrower policy adjustment** (§5.13):
   - only CPU and zIIP are fixed: no I/O priority, MPL or storage targets;
   - no receiver that meets its goal;
   - no small consumers;
   - discretionary work at one priority.
6. **Ladder position.** Where the canonical ladder sits in the managed range is a sim choice; IBM only says
   occupied priorities are spaced.
7. **Summed equal-importance harm.** Equal-importance harm is summed over all such periods, as well as tested per
   period. IBM tests net value per donor.
8. **Discretionary minimums yield broadly.** A discretionary minimum yields to any goal period missing its goal
   on the image, not to a receiver search.
9. **Rules IBM doesn't quantify:**
   - `needsHelpDelayFrac` and `maxPlanSteps` stand in for them;
   - `skipClockMinMissing`'s count is per image, because IBM doesn't say whether it is per system or across the
     sysplex.
10. **The batch response-time projection** (§5.8):
    - it scales the measured PI;
    - a job's response time covers its whole life, while a later period's samples cover only its part;
    - a mixed period takes the factor from all its samples;
    - the velocity floor applies to donor harm.

### 5.11 Cost

`evaluateLpar` is linear in slices and is the whole cost. I16 bounds it: 13 projections per image per interval
(117 evaluations with batch recovery), and none on an interval where every candidate is on its skip clock or fails
the delay test.

Steps whose cost grows with the number of service class periods `n`:
- `netValue`: O(n) per projection;
- `donorOrder` and `canonical`: O(n log n) per interval;
- `projectionInput`: O(slices) per assessed interval.

None grows with trials beyond the budget. Changes to the loop record `npm run bench` before and after; the
≤ 4 ms tick budget (SPEC §15) is their gate.

### 5.12 What the player sees

**The log.** The WLM activity log is the game's SMF 99 view.
- **A change:** one line per interval with the plan and the DPs in hex, e.g.
  `PROD2 RCVR=DDFPRD#1 PI=1.84 BTLNK=CPU DDFPRD#1 UP; DONOR TSO#2 DOWN`.
- **No change:** the first rejected step and its reason, such as:
  - `harms ONLHI#1, more important`;
  - `already recovering`;
  - `mostly waiting, CPU delay n %: not WLM-fixable`;
  - `next look hh:mm:ss` (skip clock).
- **The server period** appears by name: `RCVR=ONLMED#1 (regions $SRMS001)`.
- **RMF-style reports** show the served classes at the regions' DP.

**Tools.** `inspect wlm` shows each candidate's outcome (`SKIP_CLOCK`, `NO_MANAGED_DELAY`, `RECOVERING`, `BUDGET`)
and each plan step with `base → after`. The `wlm-why` skill turns that into a verdict: real z/OS behaviour, a sim
gap, or the player's policy.

**The Codex** explains the concepts: policy adjustment, donors and net value, the skip clock, dispatching
priorities and unbunching, server topology and the free ride.

**Levers and their costs:**

| Lever | Effect | Cost or trade-off |
|---|---|---|
| **Importance** | Holds under stress: more important work is never pushed past its goal for less important work | Raising one class's importance exposes everything below it; one change per 10 s limits how fast many classes are sorted |
| **Goal value** | Decides who is a receiver and who gives: the happiest period at or above the receiver donates first, whatever its importance | An easy goal makes a class the first donor. A goal that can't be met makes a permanent receiver, looked at every fourth cycle while clocks run |
| **CPU Critical / CCIMP** | Less important work never gets an equal or higher DP | Removes WLM's freedom to trade; less important work waits longer |
| **Splitting CICS classes** | The regions follow the most important unhappy class they serve | The free ride: a critical class lifts everything in the same regions. Real separation needs separate regions, not a lever in the game |
| **Resource-group minimum on discretionary work** | Served ahead of work meeting its goals | Takes from happy work and slows it toward its goal |
| **Response-time goal on batch** | Managed, with a PI that jumps with single jobs | IBM's advice: too few completions make it erratic, and velocity is steadier |

Diagnosis stays the gameplay: the planted pattern "missing its goal with little CPU delay: WLM can't help" keeps its
log clue (§5.7) and its realism test (I14).

### 5.13 Known gaps and open questions

Real WLM behaviour the sim doesn't model, each documented as an approximation (SPEC §17):
- **Receivers that meet their goals** (§3.5 case 4). When nobody misses, real WLM still tunes the order, largest PI
  first. The sim's ladder stays where the last busy period left it, so a ladder shaped by overnight batch can meet
  the morning ramp. It was left out on purpose: it would double the projections on quiet intervals for an effect
  players rarely see (user decision 2026-11-10; WT-14 dropped 2026-11-13).
- **Small consumers** (§3.13). They sit above the managed range and are neither receivers nor donors. In the sim, a
  tiny period is placed on the ladder like any other; `donorMinEngines` keeps it out of the donor pool.
- **Mean time to wait** (§3.13). Real WLM spreads discretionary work over 201–192, I/O-bound work higher. The sim
  runs every discretionary period at 196 and shares by ready units, which already favours work that wants little.
- **I/O priority, MPL and storage targets, WLM-managed initiators, routing recommendations.** None is a policy
  adjustment action in the sim (approximation 5).
- **Started tasks** report no transaction completions, so a response-time goal on one has no PI.
- **REGION/BOTH region management** keeps a DP per served class (§5.8).

Open questions:
- Whether zIIP service is normalised to CP speed for period durations: not found (§3.1).
- Whether the z/OS 1.11 skip-clock exception counts per system or across the sysplex: the sim counts per image
  (approximation 9).
- Whether real WLM projects a batch response-time PI anything like §5.8's rule: no book gives the formula.

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
