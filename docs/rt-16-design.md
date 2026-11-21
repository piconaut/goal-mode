# RT-16 design: the CPU split on the host of the delay, by displaceable CPU

Status: **decided, not built** (2026-11-21). The user answered docs/rca-design.md Q7 yes (2026-11-21) and accepted
every recommendation of §8 (Q7a … Q7e). The work is BACKLOG RT-16, RT-32 and RT-33 (§7). Source rules:
docs/rca-design.md §4.3 and §3 A4–A6.

## 1. What is already there

| Piece | Where | Since |
|---|---|---|
| Capping as share of the hour's ticks (`cappedTicksByLpar`, `CAPPING.minHourShare` 5 %) | `game/sla.ts` `cappedForHour` | RT-08 |
| Bands (`CPU_BANDS`: host 85/95 %, displaceable 5 %) widening the accepted set | `content/incidents.ts`, `game/rcaTruth.ts` | RT-07 |
| CICS region CPU in one server period (`$SRMS001`) that holds the regions' DP | `sim/wlm/holders.ts` | WT-09 |
| Per-period CAP delay on every LPAR tick (`ScpTick.delayCap`, `srvDelayCap`) | `sim/wlm/eval/types.ts` | — |
| A server role's CPU withheld by a resource-group cap (`LparTick.roleHealth[role].capped`) | `sim/core/types.ts` | RF-09 |
| Per-class `honorPriority`, IEAOPT `iipHonorPriority` | `sim/wlm/types.ts`, `sim/core/types.ts` | — |

What the verdict does today (`mechanismOf`, `capacityBasis`): CAPPING if *any* host image was capped; else
CPU_CAPACITY if *some* host is full (CPC ≥ 90 % or image ≥ 95 %) and under 10 % of its CP went to work *less
important* than the hurt class; else CPU_PRIORITY. The basis names the first full host or the busiest CPC. Every
measure is on the CP pool.

Its errors (rca-design A4–A6): mis-ranked work has no donors (R-13), same- or higher-importance culprits never count
(U-11), the hurt work's own Db2 counts as a donor (U-10, R-2, R-7), any capped host decides (U-9), the basis names the
wrong host (R-2), zIIP queueing is judged on CPs, and a resource-group cap is never CAPPING.

## 2. New reporting-only data

The sim hash must not move. Each field is written beside an existing one, read by nothing in `src/sim`, and proved
with `npm run compare -- --base origin/dev --drop <field>`.

**Sim (`src/sim`)**

1. `WorkloadTick.cpuWaitByLpar?: Record<lparId, { cp: number; ziip: number; backlog: number; completions: number }>`:
   completion-weighted seconds of `cpuQueue`, `ziipQueue` and `backlogWait`, per image, accumulated in
   `core/tick/dispatch.ts` where `addParts` already sums `parts`. The workload's `parts` stay the sum of these.
2. `LparTick.cpByRole?: Record<role, { cp: number; ziip: number; iipcp: number }>`: engines granted to address-space slices that
   have a `role` (DB2.MSTR, DB2.DIST, MQ, CICS.AOR …), from each slice result's `cpGranted` / `ziipGranted` / `iipcpGranted`. Needed
   because Db2 shares its STC class with monitors (STCMED in BASEPOL), so the class row cannot tell them apart.
   Omitted on images with no role slices.
3. `LparTick.cpByWorkload?: Record<workloadId, { cp: number; ziip: number; iipcp: number }>`: engines granted to transaction slices
   per workload. Two workloads can share one period (Revenue's analytics queries and e-filing in WEBDDF), so the
   period row cannot separate the hurt work from a runaway beside it.

   Review correction: retain IIPCP separately, so `cp` still reconciles with `ScpTick.cpEngines`, while CP-pool
   consumption is `cp + iipcp`. Native zIIP consumption is `ziip`. Earlier RT-16 records lacking `iipcp` contribute
   zero for that component when summed, without backfill; a loaded hour can therefore be partial.

**Game hour accumulator (`HourAcc`, `game/run/hourly.ts`)**

4. `cpuWaitByWorkloadLpar`: sum of (1) over the hour.
5. `cpByScpLpar: Record<lparId, Record<scKey, { cp, ziip, iipcp }>>`: engine-ticks per period per image, from `lt.scps`.
   `cpByImportance` stays, so an hour accumulated before this change still judges by it.
6. `cpByRoleLpar`, `cpByWorkloadLpar`: sums of (2) and (3).
7. `capDelayByScpLpar: Record<lparId, Record<scKey, { cap, samples }>>`: `delayCap` (with `srvDelayCap` for the
   server period) and using + delay samples, for the CAP-delay share WLMGL shows.
8. `roleCappedTicks: Record<"lparId:role", number>`: ticks with `roleHealth[role].capped`.
9. `ziipBusyById`, `ziipLparBusyById`: zIIP-pool counterparts of `cpcBusyById` / `lparBusyById`.

All plain records with sorted-key-independent sums, so determinism holds. Sizes: a few hundred numbers per hour.

## 3. The judging rules, in order

Applied when the delay group won is CPU (`cpuQueue + ziipQueue + backlogWait`), and by RT-19 later for `serverCpu`.

### 3.1 Host

For each host image `h` of the workload: `excess_h = wait_h − base × completions_h`, where `wait_h` is (4) summed
over the three keys and `base` the workload's per-transaction CPU-group baseline (the baseline is per workload, not
per host; APPROX). The **judged host** has the largest excess; ties by `lparId`. A second host with at least
`CPU_SPLIT.coHostFrac` (⅓) of the total excess is judged too, and its verdict joins the accepted set. Hours from
before the field fall back to today's "first full host, else busiest CPC".

If the judged host carries ≥ ⅔ of the excess while another host of the workload was under `CPU_BANDS.hostRoomFrac`
busy, ROUTING joins the accepted set (rca-design §4.1 "host imbalance").

### 3.2 Pool

On the judged host, `ziip` wait > `cp + backlog` wait ⇒ the **zIIP pool** is judged: busy is zIIP-pool busy (9),
displaceable use counts `ziip` engines. Otherwise the CP pool, as today.

On the zIIP pool, when zIIP work could not overflow (IEAOPT `IIPHONORPRIORITY=NO`, or the class's `honorPriority`
off) and the image's CPs were under `hostRoomFrac` busy, CPU_PRIORITY is the primary and POLICY joins the triggers:
"CPs never examine zIIP processor eligible work" with NO (z/OS 3.1 MVS Initialization and Tuning Reference
SA23-1380-60 PDF p.430 (printed 394); docs/research.md row "IIPHONORPRIORITY"). The setting is the player's, so it is
a policy cause.

### 3.3 Capping

CAPPING when, on the judged host, any of:

- the image was capped for ≥ `CAPPING.minHourShare` of the hour's ticks (as now, but only the judged host: U-9);
- a period of the hurt work on that host, or the server period holding its regions, shows CAP delay ≥
  `CAPPING.capDelayFrac` (5 %) of its samples (7). WLMGL CAP is delay from "a resource group maximum … or
  discretionary goal management", and "is NOT part of the CPU delay" (z/OS 3.1 RMF Report Analysis SC34-2665-60
  PDF p.540 (printed 500); docs/research.md row "WLMGL CAP delay");
- a server role the work depends on (`w.servers`, `w.hostRole`) on that host was capped (8) for ≥ `minHourShare` of
  the ticks.

For the last two the fallback trigger is POLICY (the resource group is the player's), and the cause identity is
`none:CAPPING:<host>:rg:<group>` so it does not group with an LPAR cap on the same image. Discretionary goal
management caps only work that overachieves, so it cannot cap the hurt period; no special case is needed.

### 3.4 Displaceable CPU

`displaceable(host, pool)` is the share of the image's pool engines used by consumers that are **none** of:

1. system work: SYSTEM, SYSSTC periods;
2. the hurt work itself: its own transactions' engines on the host (6, by workload, not by period: another workload
   in the same period stays displaceable), and the server period's engines when its regions serve only the hurt work
   (shared regions: in proportion to the hurt work's share of their transactions, APPROX);
3. the hurt work's servers: the engines of its server roles on the host (6), taken out of whatever STC period holds
   them (so STCMED's monitors stay displaceable and Db2 does not);
4. **work at risk**: periods and server roles of another SLA workload whose hour attainment was below its target plus
   `CPU_SPLIT.atRiskMargin` (PCT goals: within ¼ of the remaining percentage; RT goals: average above 0.8 × the SLA
   time), and, during the batch window, the batch class periods running critical jobs when the forecast end shown in
   the batch view is within `atRiskMargin` of the deadline.

The consumer's WLM importance does not enter. This counts, as displaceable, a looping STC at importance 1, TSO at
the victim's importance, ad-hoc queries in the victim's class, overnight batch ahead of a mis-ranked online class,
and a happy more important SLA class with margin (WT-07: WLM donates from a happy period "down to its goal"; the
whole of its CP counts here, APPROX, since the margin already keeps a class near its goal out).

Everything the rule reads is visible: classes and APPL % in WLMGL, address spaces in PROCU, SLA attainment on the SLA
view, the batch forecast in the batch view.

### 3.5 Capacity or priority

On the judged host and pool, with `busy = max(cpc, image)`:

- primary **CPU_CAPACITY** iff (cpc ≥ `CPU_CAPACITY.cpcBusyFrac` 90 % or image ≥ `lparBusyFrac` 95 %) and
  displaceable < `CPU_CAPACITY.donorFrac` 10 % (the lines stay; only "donor" changes meaning);
- otherwise **CPU_PRIORITY**;
- accepted set: unchanged RT-07 bands, fed the displaceable share instead of `donorPct`;
- a capacity-reducing card still adds CPU_CAPACITY.

`CPU_CAPACITY.donorFrac` and `CPU_BANDS.donorRoomFrac` are renamed `displaceableFrac` / `displaceableRoomFrac`.
New tunables (`CPU_SPLIT.coHostFrac`, `atRiskMargin`, `CAPPING.capDelayFrac`) go in `content/incidents.ts` with
`// FICTIONAL:` shape comments.

## 4. What the player sees

`CapacityBasis` gains `pool: 'CP' | 'ZIIP'`, `excessSharePct` (the judged host's share of the CPU excess),
`displaceablePct`, `topConsumers` (up to three `{ name, kind: 'class' | 'job' | 'space', pct }`, largest first) and
`capBy?: 'IMAGE' | 'GROUP' | 'SERVER'`. `donorPct` stays for saved incidents; readers prefer `displaceablePct`.

`mechanismExplanation` names the judged host and consumers, e.g. "PROD2 carried 91 % of the CPU wait: CPC 99 %
busy, 4 % of its CP displaceable (ADHOC 3 %); DB2A and DDF work at risk excluded". The CAPPING help on the RCA form
reads "the image or the class was capped".

**Proof alignment.** RT-13's CPU_PRIORITY recipe marks its APPL / JOB_APPL options `displaceable: true`, today "less
important than the hurt work". It switches to the same predicate (one helper, `game/displaceable.ts`, used by truth
and proof, reading the incident's `subjects` snapshot), so a truth the player can be judged on is a truth they can
prove. The predicate label becomes "a consumer WLM could have taken CPU from: not system work, not the work's own
servers, not SLA work at risk, ≥ 10 % of the image (WLMGL APPL, PROCU)". The CAPPING recipe's `DELAY_CAP` option adds
the `server` relation.

## 5. Expected results (to be confirmed by the build)

| Case | Today | After |
|---|---|---|
| U-9: host capped 6 % with no share of the excess | CAPPING | the judged host's verdict |
| U-10: Db2 (importance 3, the victim's server) at 11.5 % of a 99 % CPC | CPU_PRIORITY | CPU_CAPACITY, priority accepted (band) |
| U-11: 80 % of the CP at the victim's importance by a non-SLA consumer | CPU_CAPACITY | CPU_PRIORITY |
| R-2 | basis PROD1 | basis PROD2; CPU_CAPACITY primary, priority accepted |
| R-7 MOBILE | CPU_PRIORITY | by the displaceable share; both accepted (band, POWER_CAP card) |
| R-13 Revenue G1, days 0/5/8 21:00 | CPU_CAPACITY/GROWTH | CPU_PRIORITY/POLICY (batch displaceable) |
| Agent playtest 2026-11-21, Revenue seed 23 D8: runaway DDF query in the hurt class, PROD2's only zIIP 100 % busy, WLMGL zIIP delay 99.6 % | CPU_PRIORITY on "CPC 72.7 % busy" | judged on the zIIP pool of PROD2: full, and the runaway is another workload in the same class, so displaceable ⇒ CPU_PRIORITY with the query named in the basis; with IIPHONORPRIORITY=NO and the CPs at 73 %, also the §3.2 policy cause; RUNAWAY_WORK from the card as now |
| Agent playtest 2026-11-21, Harbourline seed 37 D2–D4: CPC 60–68 %, CPU delay 2–8 % | CPU_PRIORITY | still CPU_PRIORITY (room on the host); whether the CPU group should win at all is RT-17's floor |
| A resource-group maximum on the hurt class | CPU_PRIORITY | CAPPING/POLICY, DELAY_CAP pin proves it |

## 6. Bots and balance

`buyCapacityForIncidents` reads `truth.mechanism === 'CPU_CAPACITY'`: Revenue G1 stops triggering CP purchases, and
saturated Midwest days where only Db2 looked like a donor start to. `tunePolicyIncidents` is unaffected. Each
judging PR runs `npm run sweep:remote` on the three scenarios against `origin/dev` and checks the SPEC §16 bands;
any band call stays with the main agent.

## 7. Build plan: three PRs

RT-16 was size L. Split by the BACKLOG one-change rule (Q7e):

| Entry | Area | Content | Proof |
|---|---|---|---|
| RT-16 | sim + game (reporting) | §2 fields 1–9, no reader | `npm run compare --drop`; goldens regenerate only if they hash `last`, with a Behaviour note |
| RT-32 | game | §3.1, §3.2, §3.4, §3.5, §4 basis/explanation/proof alignment; U-9 … U-11 tests, R-2/R-13 replays; SPEC §10/§17 | sweep, three scenarios |
| RT-33 | game | §3.3 resource-group and server CAPPING, CAPPING form help, cause identity | sweep; realism test "a resource-group maximum on the hurt class is CAPPING, not CPU_PRIORITY" |

Report invariants (`tests/helpers/reportIdentities.ts`) join in RT-32: each `topConsumers` share matches the hour's
WLMGL APPL % (or PROCU) on the judged host, and `excessSharePct` over the hosts sums to 100.

Entries that wait on the split: RT-17 (hour-of-day baselines change `groupExcess`, which RT-32 reads), RT-28 (RT-32
rewrites `mechanismExplanation`), RT-31 (its time base applies to RT-32's lines and bands; every line here is the
clock-hour average until RT-31 decides otherwise) and RT-21 (batch nights) are `after RT-32`.

## 8. Decisions

All recommendations accepted by the user (2026-11-21).

| # | Question | Decision |
|---|---|---|
| Q7 | Adopt displaceable CPU on the judged host and pool, with the §3.5 lines, instead of importance donors? | Yes |
| Q7a | Build before the human playtest, or keep it parked? R-13 still teaches "buy a CP" for a policy flaw, and bots buy on it. | Build now (RT-16 unblocked 2026-11-21) |
| Q7b | "At risk" from SLA attainment plus a margin (§3.4.4), or from WLMGL PI ≥ 0.8? | SLA attainment: it is the game's own goal and needs no hour-PI accumulator. PI is the alternative if WLMGL should be the only source |
| Q7c | A happy more important class counts in full (APPROX), or only the CP above what its goal needs? | In full; the margin keeps near-goal classes out |
| Q7d | Critical batch at risk by the batch view's forecast end within the margin of the deadline? | Yes |
| Q7e | Split into RT-16 / RT-32 / RT-33 as §7? | Yes |
