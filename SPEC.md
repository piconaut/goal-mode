# GOAL MODE — Design Specification

> *A z/OS workload performance & capacity management roguelike.*
> You are the newly hired capacity & performance lead at a mid-size bank. Keep the
> service level agreements green, the software bill down, and the CIO off your back,
> one simulated day at a time, while the business grows faster than your hardware.

Status: **design v0.1**, written before any code. Where this document and the code disagree, fix
whichever is wrong and record the decision in `PROGRESS.md`.

---

## 0. Table of contents

1. Vision & design pillars
2. The core loop
3. Time model
4. The simulated world (topology)
5. Simulation model (the engine)
   - 5.1 Tick pipeline
   - 5.2 Workload & arrival model
   - 5.3 Hardware & PR/SM
   - 5.4 z/OS dispatcher
   - 5.5 WLM: goals, PI, sampling, policy adjustment
   - 5.6 Dependencies & server address spaces
   - 5.7 I/O subsystem
   - 5.8 Storage (real memory, buffer pools)
   - 5.9 Coupling facility & data sharing
   - 5.10 Subsystem specifics (CICS, Db2/DDF, MQ, batch/JES2)
   - 5.11 Capping & software cost (R4HA, MLC, TFP)
   - 5.12 Measurement: SMF/RMF data generation
6. Player verbs (what you can change)
7. Economy & resources
8. Analytics: fog of war & the tool tree
9. Events, incidents, constraints (the roguelike deck)
10. Root-cause analysis mini-game
11. Progression: difficulty curve, run structure, meta-progression, game modes
12. Scoring, win & loss
13. Starting scenario: "Midwest Mutual" (the flawed starting topology)
14. UI / screens
15. Technical architecture
16. Balancing & validation
17. Model fidelity notes (what's real, what's simplified, what's invented)
18. References

---

## 1. Vision & design pillars

**Elevator pitch.** *FTL / Slay the Spire meets RMF.* Each run is a fiscal quarter at a bank.
Each played day is a 24-hour simulated production day that takes about 10 real minutes. The
online day peaks, the batch window runs overnight, and a regulatory deadline lands at 06:00.
Between days you read reports, diagnose, and change the WLM policy, the LPAR configuration and
the hardware plan. Workload grows, the deck of events gets nastier, and finance keeps adding
constraints. You lose when the business loses confidence in you.

### Pillars

1. **Authentic mechanics, honest abstractions.** The concepts are the real ones and they
   interact the way they do in real systems: service classes, importance, velocity and
   percentile goals, the performance index (PI), dispatching priorities, the 10-second policy
   adjustment, LPAR weights, HiperDispatch polarity, R4HA soft capping, zIIP offload, CF sync/async
   conversion, the CICS QR TCB limit, Db2 address-space placement. A z/OS performance analyst
   should nod along. Numbers are plausible but fictional and data-driven (see §17).
2. **Diagnosis is the gameplay.** The fun is *figuring out why*. Symptoms show up first
   ("mobile response degraded 10:40"). The cause is hidden in data you have to pull and read.
   The game rewards forming a hypothesis, testing it, and fixing the right thing.
3. **Trade-offs, not right answers.** Every lever has a cost: performance against software cost,
   protecting one workload against starving another, capacity now against budget later,
   measurement overhead against visibility, emergency change against change-board trust.
4. **Readable under pressure.** The real-time day needs glanceable signals (PI heat map,
   SLA tickers, R4HA gauge, batch critical-path countdown). Deep analysis happens while paused
   or between days.
5. **Teach by playing.** Every concept you touch unlocks a *Codex* entry that explains the real
   z/OS behaviour behind the mechanic. The game should leave players understanding WLM better
   than before.

### Non-goals

- Not a cycle-accurate emulator, and no real JCL, ISPF, or 3270 data stream. We *evoke* the
  green screen; we don't emulate it.
- No real IBM pricing, LSPR ratings or machine model numbers. Everything is fictional but
  proportionally plausible.
- Not multiplayer (v1).

---

## 2. The core loop

```
 ┌──────────── RUN (≈ one fiscal quarter, ~40 played days) ─────────────┐
 │                                                                      │
 │  ┌─ DAY ──────────────────────────────────────────────────────────┐  │
 │  │ 1. MORNING BRIEFING (paused, untimed)                          │  │
 │  │    • Debrief of yesterday's batch window (06:00 deadline)      │  │
 │  │    • Inbox: business requests, warnings, vendor offers         │  │
 │  │    • Calendar: known upcoming events (some are fogged)         │  │
 │  │    • Spend Engineer-Hours: analyse data, plan changes,         │  │
 │  │      take changes to the CAB (Change Advisory Board)           │  │
 │  │ 2. LIVE DAY (06:00 → 06:00, ≈10 min real time at 1×)           │  │
 │  │    • Watch dashboards; alerts fire; incidents unfold           │  │
 │  │    • Pause, change speed (½× … 8×)                             │  │
 │  │    • Emergency actions (cost trust and hours)                  │  │
 │  │ 3. END-OF-DAY REVIEW                                           │  │
 │  │    • SLA report card, MLC tracker, trust delta                 │  │
 │  │    • Optional RCA submissions for today's incidents            │  │
 │  │    • DRAFT: pick 1 of 3 opportunities (roguelike reward)       │  │
 │  └────────────────────────────────────────────────────────────────┘  │
 │  Month-end / quarter-end "boss days", audits, hardware deliveries    │
 └──────────────────────────────────────────────────────────────────────┘
 Meta: career XP → unlock scenarios, starting perks, codex, difficulty
```

**The day starts at 06:00**, just after the batch window closes, and ends at 06:00 the next
morning. So every day ends on a cliffhanger: will the critical batch path make the deadline?

---

## 3. Time model

| Concept | Value | Notes |
|---|---|---|
| Sim day | 86,400 sim-s | 06:00 → 06:00 |
| Real time per day at 1× | 600 s (10 min) | 144 sim-s per real second |
| Sim tick | **10 sim-s** | Same as WLM's policy adjustment interval. 8,640 ticks per day, 14.4 ticks per real second at 1× |
| WLM sampling | modelled analytically per tick (as if sampled every 250 ms) | Using/delay "samples" are derived fractions (§5.5) |
| R4HA update | every 5 sim-min | 48 five-minute values in the rolling 4 hours |
| RMF interval | 15 sim-min by default (configurable 5/10/15/30/60) | One SMF 70/72/74/78 record set per interval |
| Speed controls | pause, ½×, 1×, 2×, 4×, 8×, "skip to next alert" | *Ironman* difficulty disables pause during the live day |

The **sim core must be able to run a whole day headless in under 2 s** (balancing harness,
what-if forecasting, fast-forwarding weekends).

**Calendar.** A run starts on a Monday. Weekends are *auto-simulated* by default at high speed
with a summary (weekend maintenance and REORG batch, low online); the player can choose to play
them. *(Implemented: on a Saturday or Sunday the briefing offers "Auto-run the weekend day" next to "Play it", and
the speed bar has an Auto button; the worker then advances the day as fast as it can (~10 s in a browser) and the
end-of-day report card is the summary. The day is simulated in full, so seeds and goldens are unaffected.)* The calendar includes month-end (day 1 and the last business day), a quarter-end close
(the run's final week), paydays (1st/15th), and a seasonal peak if the scenario has one.

**Growth compression.** Real organic growth is ~10–30%/year. In-game it is compressed so a
40-day run feels like ~18 months of growth. Mobile/API traffic grows fastest.

---

## 4. The simulated world (topology)

```
                         ┌─────────────── CPC A (Gen N-1, "M-series") ──────────────┐
                         │ Shared CP pool:  8 CPs @ capacity setting 6 (sub-capacity) │
                         │ Shared zIIP pool: 2 zIIPs (always full speed)            │
                         │ ICF: 2 (CF engines)            Memory: 768 GB            │
                         │                                                           │
  Sysplex PLEXP1         │  PROD1  w=500 LCP=6 zIIP=2   (CICS AORs, Db2 DB1A, MQ)  │
                         │  PROD2  w=350 LCP=6 zIIP=0   (CICS AORs, Db2 DB1B, DDF) │
                         │  DEVT   w=100 LCP=4          (dev/test, TSO, test Db2)  │
                         │  SYSP   w=50  LCP=2          (sysprog sandbox)          │
                         │  CF01   dedicated ICF        (lock, GBP primary, XCF)  │
                         │  CF02   shared ICF  ← flaw   (GBP secondary, list)     │
                         └───────────────────────────────────────────────────────────┘
                                  │ FICON
                         ┌────────┴─────────┐
                         │ DASD subsystem    │  cache, HyperPAV aliases, base volumes
                         └───────────────────┘
```

Entities (all data-driven, defined in `content/scenarios/*`):

- **CPC (machine):** generation, capacity setting (sub-capacity level 4/5/6/7 per CP), engine
  counts per pool (CP, zIIP, ICF), memory, installed but inactive engines (CoD), temporary
  capacity records.
- **LPAR (image):** pool memberships, logical processors per pool, weight per pool, capping
  flags (initial capping / absolute cap), defined capacity (MSU), group-capacity membership,
  memory, reserved CPs/memory, HiperDispatch on/off.
- **z/OS system** (one per z/OS LPAR): IEAOPT-like settings (BLWLTRPCT, BLWLINTHD,
  IIPHONORPRIORITY, CCIMP), SMF/RMF settings, address spaces.
- **Sysplex:** the set of systems sharing one WLM service definition and one CF set.
- **CF image:** engines (dedicated/shared), weight, structures (lock, group buffer pools,
  list/XCF), dynamic dispatching/thin interrupts setting.
- **Subsystem instances:** CICS regions (TOR/AOR), Db2 members (MSTR, DBM1, DIST, IRLM),
  MQ queue managers (MSTR, CHIN), JES2, TCP/IP, VTAM, monitors.
- **Workloads:** business traffic sources mapped to subsystems via routing (§5.2).
- **DASD subsystem:** throughput capacity, cache size and hit model, base volumes, HyperPAV
  alias pool, optional zHyperLink.

---

## 5. Simulation model (the engine)

Design principle: **analytic/fluid model per tick, not discrete events per transaction.**
Thousands of transactions per second over 8,640 ticks per day means we model *rates*,
*utilisations* and *queueing approximations*. The outputs are the same quantities RMF reports:
using/delay percentages, response times, distributions, rates. Batch jobs are the exception;
they are tracked as discrete entities (§5.10.4), because the critical path is a story the player
follows job by job.

### 5.1 Tick pipeline (every 10 sim-s)

```
1. Clock & calendar          → time of day, day type, active events
2. Arrivals                  → λ per workload (§5.2)
3. Routing                   → λ split across LPARs/regions (sysplex distributor, CICSPlex SM)
4. Demand                    → CP-s, zIIP-s, I/O, CF requests, locks per service-class period
5. PR/SM                     → physical capacity delivered to each LPAR (§5.3)
6. Capping                   → defined/group capacity & absolute caps applied (§5.11)
7. z/OS dispatch (per LPAR)  → CPU granted & CPU delay per DP level (§5.4)
8. Dependencies              → server health → dependency delays (§5.6)
9. I/O, storage, CF          → I/O response, paging, CF service times (§5.7–5.9)
10. Response composition     → per-period response time, distribution, velocity, completions
11. Batch progression        → job steps progress, completions, critical path (§5.10.4)
12. WLM policy adjustment    → one receiver per system per tick (§5.5.4)
13. Measurement              → accumulate SMF/RMF interval counters (§5.12)
14. Game layer               → SLA accounting, alerts, event triggers, scoring
```

Every step is a **pure function** of (previous state, player inputs this tick, seeded RNG).

### 5.2 Workload & arrival model

For each workload *w*:

```
λ_w(t) = base_w
       × diurnal_w(hourOfDay)             // piecewise curve, see table
       × weekly_w(dayOfWeek)
       × calendar_w(date)                 // payday, month-end, holidays, seasonal peak
       × growth_w(day)                    // compounded: (1+g_w)^day
       × Π eventMultipliers(t)            // campaigns, outages elsewhere, retries
       × noise_w(t)                       // AR(1) log-normal noise, σ≈0.05–0.15, seeded
```

**Retry storms:** when a workload's response time passes its client timeout, a fraction of
failed requests are retried. Effective λ inflates, which makes it worse. This is the classic
positive-feedback collapse and is shown on the console as "RETRY STORM".

Starting workloads ("Midwest Mutual"); all values are content data:

| Workload | Subsystem path | Shape | Peak λ (day 1) | CPU/txn (CP-ms) | zIIP-eligible | I/O per txn | Growth/day | SLA |
|---|---|---|---|---|---|---|---|---|
| Retail banking (`RBANK`) | VTAM/TCP → CICS TOR → AOR → Db2 | 08–18 twin peaks (10:30, 14:00) | 900 tps | 2.4 | 0% | 5 | 0.3% | 95% < 250 ms |
| Card authorisation (`CARDAUTH`) | TCP → CICS → Db2 (data sharing) | 24×7, evening peak, holiday spikes | 700 tps | 1.1 | 0% | 2 | 0.4% | 99% < 100 ms |
| Mobile API (`MOBILE`) | TCP → z/OS Connect/DDF → Db2 | 07–23, lunch & evening peaks, campaign spikes | 500 tps | 3.8 | 55% | 4 | **1.5%** | 95% < 400 ms |
| Branch teller (`TELLER`) | VTAM → CICS | weekdays 09–17 | 250 tps | 3.0 | 0% | 6 | 0% | 90% < 500 ms |
| Payments/MQ (`PAYMQ`) | MQ CHIN → CICS/Db2 | bursts on the hour, 08–20 | 150 msg/s | 4.5 | 10% | 8 | 0.6% | avg < 1 s |
| BI / ad-hoc DDF (`ADHOC`) | DDF → Db2 | 09–18, heavy-tailed | 3 qps | 1,800 | 60% | 2,000 | 0.5% | best effort |
| TSO/ISPF devs (`TSO`) | TSO (DEVT mostly) | 08–19 weekdays | 120 users | – | 0% | – | 0% | internal |
| Nightly batch (`EOD`) | JES2 job network | 20:00 → must finish 06:00 | ~140 job nodes | §5.10.4 | 5–20% | heavy | 0.4% | critical path by 06:00 |
| System overhead | SYSTEM/SYSSTC | flat + per-workload % | – | – | – | – | – | – |

Each workload has a **response-time dispersion** σ (log-normal shape) and a **client timeout**.

### 5.3 Hardware & PR/SM

#### 5.3.1 Capacity units

- **Per-CP capacity** `cpMSU(gen, capSetting)`: a fictional table, e.g. Gen N full speed
  (setting 7) = 250 MSU/CP, setting 6 ≈ 0.68×, 5 ≈ 0.46×, 4 ≈ 0.26×. Sub-capacity CPs are
  *slower engines*: per-txn CPU *time* goes up, which matters for response times. That is the
  "short/slow engine" effect a player should feel.
- **zIIPs always run at full speed**, whatever the CP capacity setting (true on real
  hardware, and a key reason zIIP offload is attractive).
- **MP effect:** `capacity(n) = n × cpMSU × mpFactor(n)`, with `mpFactor(n) = 1 − k·ln(n)`,
  k≈0.04 (content-tunable, LSPR-like diminishing returns).
- **Workload nest intensity (RNI-like):** each LPAR has an effective RNI class
  (LOW/AVERAGE/HIGH). It is driven by workload mix and cache pressure (more LPARs busy on the
  same chip and more VL engines raise effective RNI). It scales CPU/txn by ±10%. With SMF 113
  analytics the player can see RNI and L1MP, using IBM's L1MP/RNI decision table to classify
  the workload ([IBM: Relating production workloads to LSPR](https://www.ibm.com/support/pages/relating-production-workloads-lspr-workloads)).

#### 5.3.2 Weights & entitlement

For each shared pool *p* (CP, zIIP, ICF):

```
entitlement_L (in engines) = weight_L / Σ weight(active LPARs in pool) × physicalEngines_p
```

- Weights matter only under contention. Unused entitlement is redistributed ("white space")
  to LPARs with demand and spare logical processors, in proportion to weight.
- An LPAR can never use more than `logicalCPs_L` engines' worth.
- **Initial capping** (hard cap to weight share) and **absolute capping** (cap in engines × 100)
  are supported.

#### 5.3.3 HiperDispatch polarity

With HiperDispatch on, PR/SM assigns vertical polarity from entitlement *E*. We implement the
published rule set (Watson & Walker, *Tuning Letter* 2022 No. 1, reprint on LPAR weights):

| Entitlement E | Polarity |
|---|---|
| E < 1.5 | 2 × VM (remaining logicals VL) |
| 1.5 ≤ E < 2 | 1 × VH + 1 × VM |
| E ≥ 2, frac(E) < 0.5 | (⌊E⌋−1) × VH + 2 × VM |
| E ≥ 2, frac(E) ≥ 0.5 | ⌊E⌋ × VH + 1 × VM |
| Remaining logicals | VL (parked unless white space exists) |

Effects:
- **VH** engines get near-dedicated cache affinity: efficiency 1.00.
- **VM** engines share their physical engine: efficiency ~0.96.
- **VL** engines are *parked* when there is no white space; unparked VL work runs at
  efficiency ~0.85–0.90 (cache misses, higher RNI) and is the first capacity to vanish when
  the CPC gets busy.
- *Teaching moment:* changing a weight by 1 can flip a VM to a VH. The HMC screen shows
  resulting polarity live as the player edits.

#### 5.3.4 PR/SM overhead & logical:physical ratio

```
overheadFrac = base(0.01)
             + 0.006 × max(0, LtoP − 1.0)        // per pool, logical:physical ratio
             + 0.004 × (#unparked VL engines)
```

- IBM's common rule of thumb is to stay at or below **2:1 logical:physical**
  ([IBM z/VM performance tips: managing PR/SM overhead](https://www.vm.ibm.com/perf/tips/prsmovhd.html)).
  Above 2:1, overhead and dispatch elongation rise steeply (multiply the term by 3).
- Overhead is shown in the RMF Partition Data report as LPAR management time, split between
  time charged to LPARs and *PHYSICAL* time not chargeable to any LPAR.
- **Short-engine effect:** an LPAR with a small entitlement per logical CP (e.g. 0.3 of an
  engine per LCP) suffers dispatch latency, because a logical CP can be ready while not
  dispatched on a physical engine. This adds a "PR/SM delay" component to CPU delay that WLM
  *cannot fix* (WLM manages priorities inside the image, not engine access).

### 5.4 z/OS dispatcher (per LPAR, per pool)

Capacity available to the image this tick: `C = delivered physical engine-seconds × efficiency
− overhead`. Priority-ordered allocation:

```
DP 255  SYSTEM          (fixed)
DP 254  SYSSTC*         (fixed)
DP 253  "small consumer" (I/O-bound periods, WLM-assigned)
DP 252–208  managed periods (WLM-assigned, importance 1–5)
DP 201–192  discretionary (mean-time-to-wait: I/O-bound higher, CPU-bound lower)
DP 191  quiesced work
```
(DP ranges from IBM Redbook SG24-7621 §3.13–3.14.)

Algorithm per pool:
1. Group demand by DP level, from high to low.
2. At each level, `avail = C − consumedByHigherLevels`. Periods sharing a level split the
   available capacity in proportion to demand (z/OS rotates equal-DP work).
3. **CPU queueing delay** even when demand is fully granted: use an **Erlang-C (M/M/c)**
   approximation with `c = online logical engines (unparked)` and `ρ = utilisation by work at
   ≥ this DP`. Delay ratio `Wq/S = ErlangC(c, ρ·c) / (c·(1−ρ))`, with ρ clamped to 0.995 and
   overflow carried as backlog. This yields the real behaviour: a 2-way at 90% hurts far more
   than a 12-way at 90%.
4. **zIIP-eligible demand** goes to the zIIP pool first. If zIIPs are saturated and
   `IIPHONORPRIORITY=YES`, overflow is allowed onto CPs at the work's DP, after a "needs help"
   latency penalty. It is reported as IIPCP ("zIIP-eligible on CP"). Discretionary work
   gets no zIIP help ([IBM Db2 12: configuring zIIPs](https://www.ibm.com/docs/SSEPEK_12.0.0/perf/src/tpc/db2z_ibmziip.html)).
   If the LPAR has no zIIPs, *all* eligible work runs on CP. That costs MSU and software
   dollars, a planted flaw in the starting scenario.
5. **Blocked workload support:** periods that got 0 CPU for longer than `BLWLINTHD` (default
   20 s) get a trickle of promotion, capped at `BLWLTRPCT` (default 0.5%) of LPAR capacity.
   This matters for priority inversion (§5.6). It does not apply to zIIPs
   ([IBM WSC: blocked workload support](https://www.ibm.com/support/pages/system/files/inline-files/blocked_v3.pdf)).
6. **Resource group caps/minimums** (§5.5.6) and **discretionary capping** (§5.5.5) are applied
   as constraints during allocation.
7. **CPU Critical** periods: lower-importance work may never be assigned a DP ≥ theirs. It does
   *not* protect them from equal or higher importance work.

Outputs per period: `cpuUsingFrac`, `cpuDelayFrac` (split into *dispatch delay* and *PR/SM
delay*), `ziipUsing`, `ziipDelay`, `iipcp`, `cappingDelay`.

### 5.5 WLM: goals, PI, sampling, policy adjustment

#### 5.5.1 Service definition model

- **Service definition** → policies (one active, plus overrides) → **workloads** (reporting
  groups) → **service classes** → **periods** (goal, importance, duration in service units).
- Goal types: **average response time**, **percentile response time** (percentile 1–99),
  **execution velocity** (1–99), **discretionary**. Discretionary is allowed only in the last
  period.
- Importance 1 (highest) to 5.
- Attributes: CPU Critical, Storage Critical, Honor Priority (zIIP overflow), resource group,
  I/O priority group.
- **Classification rules** per subsystem type (CICS, DDF, JES, STC, TSO, MQ, OMVS) with
  qualifiers: TN (transaction/job name), UI (userid), CI (correlation ID), PK (package),
  PN (plan), TC (job class), SPM, SY (system), nested rules. Default class per subsystem.
  Anything unmatched in a non-STC subsystem goes to **SYSOTHER** (discretionary).
- **Report classes** (pure reporting, cost nothing) — required for granular RMF views.
- CICS/IMS region management: "Manage regions using goals of TRANSACTION | REGION".
- CICS transaction classes (any class a CICS rule or the CICS default points at) take one period with a
  response-time goal. The editor warns on velocity, discretionary or multi-period goals ("not supported",
  WLM Planning ch. 9–10) and refuses a resource group on such a class, the one case IBM documents the ISPF
  application rejecting. The sim does not change how it manages such work.

Built-ins (cannot be edited): **SYSTEM** (DP 255), **SYSSTC** (DP 254), **SYSOTHER**.
System-critical address spaces (*MASTER*, WLM, XCFAS, GRS, CONSOLE, SMF, CATALOG, …) are forced
into SYSTEM regardless of rules, as z/OS does
(SG24-7621 §3.13).

#### 5.5.2 Using/delay states & velocity

Per tick, per period, we derive "sample" fractions as if sampled every 250 ms:

- **Using:** CPU, zIIP, I/O (if I/O priority management on).
- **Delay:** CPU, zIIP, I/O, paging/storage, capping, MPL/swap, queue (initiator/thread wait).
- **Idle / unknown:** excluded from velocity.

```
EXEC VELOCITY % = USING / (USING + DELAY) × 100        (SG24-7621)
```

Velocity is notoriously sensitive to engine count, which is realistic and a trap. Db2's
guidance gives achievable velocity for its address spaces by CP count: 1–5 CPs → 50–70,
6–15 → 60–80, >15 → 70–90 ([IBM Db2 12: velocity goals](https://www.ibm.com/docs/en/SSEPEK_12.0.0/perf/src/tpc/db2z_determinevelocitygoals.html)).
The sim reproduces this: on small LPARs, high velocity goals are unachievable however much
priority they get.

#### 5.5.3 Performance Index

| Goal | PI |
|---|---|
| Average RT | actual avg RT / goal |
| Percentile RT | (bucket RT at which the goal percentile is reached) / goal RT; clamped to **[0.5, 4.0]** |
| Velocity | goal velocity / actual velocity |
| Discretionary | fixed **0.81** |

**Percentile buckets** exactly as WLM/RMF: 14 buckets with bounds at 50%, 60%, 70%, 80%, 90%,
100%, 110%, 120%, 130%, 140%, 150%, 200%, 400% of goal, and >400%
(SG24-7621 §3.10; bucket boundaries confirmed against
[Colin Paice's walkthrough of RMF WLM reports](https://colinpaice.blog/2021/06/27/one-minute-mvs-performance-work-load-manager-looking-at-wlm-reports/)).
We fill buckets from the log-normal response distribution, Φ((ln b − μ)/σ), times completions.

PI is tracked **locally** (per system) and as a **sysplex PI** (a completion-weighted average of
local PIs). WLM uses PI over a longer window for low-activity periods (min ~ N completions);
we use an EWMA whose horizon grows when completions are sparse.

#### 5.5.4 Policy adjustment (every tick = 10 s, per system)

Modelled on SG24-7621 §3.12–3.15 and the WLM patents:

```
for importance in 1..5:
    candidates = periods at this importance with sysplex PI > 1  (worst PI first)
    if none: candidates = periods with local PI > 1 (second pass)
    for receiver in candidates:
        bottleneck = largest delay type of receiver (CPU, zIIP, I/O, storage, MPL/initiator, queue)
        if bottleneck is not WLM-fixable (capping, PR/SM delay, lock wait, dependency): record & continue
        for each candidate action (move receiver up 1..k DP; move donors down):
            project new CPU distribution with the dispatcher model (re-run §5.4 on a copy)
            receiverValue = improvement ≥ 10% of (PI_receiver − 1)   // reject marginal moves
            netValue      = no higher-or-equal-importance period harmed beyond its goal;
                            receiver gains more than donors lose (PI credit only above 0.90)
            if receiverValue && netValue: apply, mark done for this interval; return
    // at most ONE receiver helped per interval per system
```

- Donors are preferably *happy* (PI < 1) *heavy users of the bottleneck resource*, of lower
  importance, chosen in reverse order of receivers.
- **Non-WLM-fixable bottlenecks** (lock contention, a starved dependency server, PR/SM delay,
  soft-cap delay) cannot be fixed by WLM. It flails, and RMF shows the receiver unhappy with
  little CPU delay. *This is the key diagnostic pattern the player learns.*
- Other WLM actions at lower cadence: start/stop **WLM-managed initiators** (batch queue delay),
  adjust **MPL**, **storage protection**, **I/O priority**, **server address-space priority via
  topology** (CICS regions take on the most important unhappy class they serve, giving
  less important transactions in the same region a "free ride").
- A *WLM Activity* log (unlocked by Monitor III) shows each decision:
  `10:41:20 SYS1 RCVR=DDFMOB P1 PI=1.84 BTLNK=CPU DONOR=BATCHPRD DP F3→F1`.

#### 5.5.5 Discretionary goal management

Happy periods may be internally capped to give discretionary work cycles, only if *all* hold
(SG24-7621 §4.22): not currently receiver/donor; not in a resource group; not a small consumer;
velocity goal ≤ 30 **or** RT goal > 1 min; projected PI < 0.7; not a significant recent
receiver candidate.

#### 5.5.6 Resource groups

- **Type 1:** service units/second, sysplex scope. **Type 2:** % of LPAR share, system scope
  (LPAR share = min(weight share, LP cap, defined capacity)). **Type 3:** CPs × 100, system
  scope.
- **Maximum** is always enforced (cap). **Minimum** is honoured only while the group's work
  misses goals, even if that hurts more important work (SG24-7621 §4.16–4.19).
- Max 32 per definition; one per service class.

### 5.6 Dependencies & server address spaces

Every unit of business work flows through a **dependency chain** of server address spaces. Each
server has a health score per tick:

```
health_s = clamp( granted_s / demand_s , 0, 1 )         // CPU-starvation health
         × availability_s                                // 0 if down
         × internalLimit_s                               // e.g. thread/MXT/QR saturation
```

Dependents pay a **dependency delay** per request:

```
depDelay = Σ_over_servers  baseLatency_s × ( 1/max(health_s, ε) − 1 ) × criticality_s
```

The delay shows in RMF as *unknown/other* delay or elongated queue time, not as CPU delay
of the transaction class. That makes it hard to spot and very realistic.

**Dependency graph (starting scenario):**

```
        ┌──────────── everything ─────────────┐
        │ *MASTER* XCFAS GRS CONSOLE SMF WLM   │  (forced SYSTEM)
        │ JES2 VTAM TCPIP RRS LLA VLF SMS      │  (SYSSTC by default)
        └──────────────────────────────────────┘
               ▲                  ▲
   CICS txns → CICS TOR → CICS AOR → Db2 (DBM1, MSTR, IRLM) → CF lock/GBP
   DDF txns  → TCPIP → Db2 DIST → DBM1, MSTR, IRLM → CF
   MQ msgs   → MQ CHIN → MQ MSTR → CICS bridge → Db2
   Batch     → JES2 initiators → Db2 (batch threads) / DFSMS / catalog
   All Db2   → IRLM (locks), DBM1 (BP & I/O), MSTR (logging; log write I/O)
```

**Canonical traps** (all real; the game teaches each one):
- IRLM not in SYSSTC → lock-wait spikes for *every* Db2 user.
- MSTR/DBM1/DIST in a low-importance velocity class → DDF and CICS degrade while their own
  classes show little CPU delay (priority inversion). IBM recommends one high-importance
  (typically importance 1) velocity class for MSTR/DBM1/DIST/WLM-SPAS, and IRLM, TCP/IP and VTAM
  in SYSSTC ([IBM Db2 12: velocity goals](https://www.ibm.com/docs/en/SSEPEK_12.0.0/perf/src/tpc/db2z_determinevelocitygoals.html)).
- A CPU-heavy task wrongly placed in SYSSTC → starves *all* managed work (there is no goal
  above it).
- A low-importance batch job holding an ENQ/lock needed by online work → blocked-workload
  promotion trickles help; ERV and BLWLINTHD tuning (IEAOPT) are levers.
- TCP/IP starved → everything network-facing collapses at once.

### 5.7 I/O subsystem

DASD response time, per RMF's standard decomposition: **IOSQ + PEND + DISC + CONN**.

- **IOSQ** (queued in z/OS for the device): M/M/c on device-level concurrency, with
  `c = 1 + HyperPAV aliases available`. Alias pool shortage → IOSQ rises. Ideally ≈ 0.
- **PEND** (channel/director/host adapter path): grows with FICON/port utilisation.
- **DISC** (cache miss/back-end): `missRate × backendLatency`, back-end utilisation inflating.
- **CONN** (data transfer): bytes / channel speed.
- WLM **I/O priority** orders IOSQ queues (small effect, real).
- **zHyperLink** (unlockable): synchronous reads for Db2 at very low latency for eligible
  I/O, at a CPU cost (sync I/O spins).
- Db2 **log write** latency is MSTR-critical: slow log I/O raises commit time for all
  updating work.

### 5.8 Storage

- **Real memory per LPAR** against working-set demand (sum of address spaces + Db2 buffer pools +
  CICS DSAs + system). If overcommitted, paging delay feeds into "storage delay" samples, and
  **Storage Critical** classes are protected first.
- **Db2 buffer-pool hit ratio** follows a working-set curve:
  `hit = 1 − missBase × (BPsize / workingSet)^(−α)`, so more memory means fewer I/Os per
  transaction (and less CPU, since I/O has a CPU cost). Buying memory and resizing BPs is a
  powerful, realistic optimisation.
- **CICS short-on-storage (SOS)** event: when a region's DSA limit is exceeded, tasks stall.

### 5.9 Coupling facility & data sharing

- Per CF image: CF CPU utilisation from request rate × service cost per request type.
- **Guideline: keep each CF below ~50% busy**, leaving white space so the other CF can absorb
  rebuilt structures ([IBM: Parallel Sysplex performance topics](https://es.slideshare.net/slideshow/parallel-sysplex-performance-topics/7674725)).
- **Sync service time** grows with CF utilisation. On **shared CF engines**, sync service time
  can stretch from microseconds to milliseconds, and z/OS's heuristic converts requests to
  **async**. Async requests are slower and cost more z/OS CPU
  ([IBM: sync/async heuristic](https://www.ibm.com/support/pages/system/files/inline-files/Sync_Async_Heuristic.pdf);
  [IBM docs: sync→async conversion](https://www.ibm.com/support/knowledgecenter/en/SSLTBW_2.2.0/com.ibm.zos.v2r2.ieaf100/huer.htm)).
- **Dynamic CF dispatching / thin interrupts** on a shared CF improves response consistency
  (player toggle).
- Sync requests **spin on the z/OS CP**, so slow CF responses *burn z/OS CPU*. That is a hidden
  MSU cost the player discovers with CF Activity reports.
- **Lock structure:** global lock contention and false contention rise with update intensity
  and with batch overlapping online.
- **Structure duplexing** (opt-in resilience) doubles some traffic and adds cost.
- CF link failure event: CF requests reroute or slow down. Losing a CF forces a structure
  rebuild on the surviving CF, which needs white space.

### 5.10 Subsystem specifics

#### 5.10.1 CICS

- **TOR → AOR routing** via CICSPlex SM: round-robin, by weight, or WLM goal-based (unlock).
- **QR TCB limit:** non-threadsafe work in a region serialises on one QR TCB, which can use
  at most **one engine's worth of CPU**. A busy AOR whose QR TCB nears 100% of one engine gets
  sharply rising internal queueing, *however idle the LPAR is*
  ([IBM CICS threadsafe white paper](https://public.dhe.ibm.com/software/uk/itsolutions/leveragingmiddleware/new-face-of-cics/cics-threadsafe-whitepaper.pdf)).
  Fixes: add AORs (memory and a change), or invest in a "threadsafe conversion" project
  (multi-day, cuts QR dependence; TCB switching costs vanish too).
- **MXT** (max tasks): above it, tasks queue (queue delay).
- **Region management** under WLM: TRANSACTION vs REGION goals (§5.5.4).
- **CICS SMF 110 monitoring** (analytics unlock) gives per-transaction CPU and wait breakdowns
  but adds ~3–5% CPU per transaction (tunable).

#### 5.10.2 Db2 & DDF

- Address spaces: MSTR, DBM1, DIST, IRLM (§5.6 placement).
- **DDF enclaves:** each DDF request is an enclave classified under subsystem type DDF. A
  **multi-period** class is typical: period 1 short RT goal (e.g. duration 2,000 SU), period 2
  velocity, period 3 discretionary. Long ad-hoc queries age into later periods, which is the
  point.
- **Thread limits** (MAXDBAT, CONDBAT): exceeding them queues DDF requests (queue delay).
- **Access-path regression** event: after a REBIND, one package's CPU/txn jumps ×3–×10.
  Diagnosable only via Db2 accounting (SMF 101) with the package (PK) breakdown, or by
  noticing CPU/txn (service per transaction) jump for that class in RMF.
- **Data sharing:** inter-system lock contention and GBP traffic through the CF (§5.9).
- **Db2 accounting** class 1/2/3 times (unlock): in-Db2 elapsed, CPU, and suspensions (lock,
  I/O, log, other) for diagnosis.

#### 5.10.3 MQ

- CHIN dispatchers and adapters; queue depth builds when consumers (CICS bridge) lag. The
  PAYMQ SLA measures end-to-end message latency. Deep queues raise memory and paging.

#### 5.10.4 Batch (JES2) — discrete model

- The **nightly job network** is a DAG of ~100–200 nodes (content data, procedurally
  perturbed per run). Each job has: CP-seconds, zIIP fraction, I/O operations, Db2 updates
  (lock intensity), earliest start (time or predecessor), job class, critical flag, and
  restartability.
- Job progress per tick = min(CPU granted rate, I/O completion rate, lock-wait factor).
- **Initiators:** JES-managed (fixed count per class) or **WLM-managed** (`MODE=WLM`; WLM
  starts initiators per service class from queue delay, importance and capacity). Too few
  initiators → queue delay. Too many → thrash and lock contention.
- **Critical path** computed live (longest remaining path to the 06:00 deadline). The console
  shows a Gantt chart and projected finish time with confidence bands (the band is narrow
  only with the forecasting tool unlocked).
- **Overrun into the online day** → lock contention with RBANK/CARDAUTH → online SLA damage.
  Classic and painful.
- **Job abends** (events): a job fails and must be restarted; restart costs Engineer-Hours
  unless the automation tool is unlocked.
- Month-end adds ~30% more jobs; quarter-end adds a regulatory reporting stream with a 05:00
  deadline.

#### 5.10.5 TSO

- Two-period class (short first period, velocity second). Mostly on DEVT. Dev complaints are a
  minor "trust with IT staff" factor.

### 5.11 Capping & software cost

#### 5.11.1 R4HA & soft capping

- Every 5 sim-min, compute each LPAR's MSU consumption. Each LPAR keeps 48 five-minute values;
  the **R4HA** is their average (WLM samples every 10 s and keeps the 5-minute values)
  ([value-4it: z/OS soft capping](https://www.value-4it.com/wp/?p=165)).
- **Defined Capacity (DC)** per LPAR: when R4HA > DC, the LPAR is soft-capped to DC until R4HA
  falls back under. Spikes above DC are allowed while the average is under it
  (SG24-7621 §4.20). When DC is below the LPAR's weight-based share, enforcement uses a capping
  *pattern* (on/off), which produces bursty "capping delay". When DC is above weight share, a
  *phantom weight* is used ([IBM docs: group capacity](https://www.ibm.com/support/knowledgecenter/SSLTBW_2.1.0/com.ibm.zos.v2r1.ieaw100/grcap.htm)).
- **Group capacity:** an LPAR group with one MSU limit. Each member's share of the group under
  capping is proportional to weight. Unused share is redistributed to members with demand, and
  no member exceeds its own DC (SG24-7621 §4.21).
- Capping is shown as **capping delay** in WLM samples. WLM cannot fix it; the PI reflects
  it.
- An IPL resets the rolling average with a "start-up credit" (initial window). It's a small but
  real detail; future scope.

#### 5.11.2 Monthly License Charge (MLC)

- Products: z/OS (all z/OS LPARs), Db2 (PROD1, PROD2, DEVT), CICS (PROD1, PROD2, DEVT),
  MQ (PROD1, PROD2).
- **Per product, per month, the bill uses the peak hour of the summed R4HA across the LPARs
  where the product runs** ("peak of the sums", not "sum of the peaks"). Where DC/GC applies,
  the hourly value is the lower of the R4HA and the cap
  ([IntelliMagic: MLC capping 101](https://www.intellimagic.com/?p=7302);
  [Planet Mainframe: sub-capacity pricing and capping 101](https://planetmainframe.com/?p=1640)).
- Price per MSU is **tiered and decreasing** (fictional curve in content). The game produces a
  monthly **"SCRT-style" report**: peak hour per product, contributing LPARs, and cost.
- **Peak-shaving** is therefore a real strategy: move batch off the online peak, soft-cap
  DEVT, offload to zIIP (zIIP MSU are not counted toward MLC), cut CPU/txn.
- **Tailored Fit Pricing (TFP)** offer (mid-run event): switch to consumption pricing
  (pay per total MSU-hours with a committed baseline). Capping becomes pointless, total
  efficiency becomes everything, and peaks no longer matter. The incentive shift is real and a
  strategic choice. Implemented as an IBM offer at the end of day 10, open 4 days, signed in the
  Finance tab during the briefing (2 h): baseline = month-to-date average product MSU × 720 h
  × 1.03, priced at 97% of the sub-capacity bill at the current peak; growth above it at 50% of
  the price; unused baseline is lost (APPROX: real contracts roll it over). The rest of the
  signing month stays sub-capacity, prorated (`content/pricing.ts` TFP_OFFER, `game/tfp.ts`).

#### 5.11.3 Hardware economics (fictional prices)

| Item | Lead time | Cost model |
|---|---|---|
| **On/Off CoD** temporary CP/zIIP | immediate (activation in minutes) | per engine-day, plus its MLC impact |
| **CBU** (capacity backup) | immediate, disaster events only | test/activation limited per year |
| Permanent upgrade (**MCU**: add engines or raise capacity setting) | 3–5 days | capex |
| Add zIIPs / ICFs | 3–5 days | capex (zIIPs cheap relative to CPs) |
| Memory upgrade | 3 days; LPAR use needs reserved storage or IPL | capex |
| New-generation CPC | 15–25 days + a migration-weekend event | big capex; +10–15% per-engine capacity, new caches |
| DASD alias / cache upgrade | 2 days | capex |

Rule from IBM: capacity provisioning should not be used with hard-capped LPARs
([IBM z/OS Capacity Provisioning](https://www-03.ibm.com/systems/z/os/zos/features/cpm)).

### 5.12 Measurement: SMF/RMF data generation

Each RMF interval writes a snapshot of interval accumulators. Record families (names are real;
contents simplified):

| Record | Report | Content in game |
|---|---|---|
| SMF 70.1 | CPU Activity, **Partition Data** | Per-LPAR physical/logical busy, weights, LCPs, polarity, effective/total dispatch, LPAR mgmt overhead, capping %, R4HA |
| SMF 72.3 | **Workload Activity (WLMGL)** | Per service/report class period: transactions (AVG, MPL, ENDED, END/S), ACTUAL/EXECUTION/QUEUED time, APPL% CP/IIPCP/IIP, service units, using/delay %, EX VEL, PI, RT distribution buckets, PROMOTED (BLK/ENQ/LCK) |
| SMF 74.1 | DASD Activity | Per volume/LCU: rate, IOSQ/PEND/DISC/CONN, alias use |
| SMF 74.4 | **CF Activity** | CF util, per-structure rates, sync/async service times, conversion %, contention |
| SMF 74.5/.8 | Cache | Hit ratios (unlock) |
| SMF 78.3 | I/O queuing | Channel/LCU queues |
| SMF 113 | HIS counters (unlock) | CPI, RNI, L1MP per LPAR |
| SMF 101 | Db2 accounting (unlock) | Class 1/2/3 times per plan/package |
| SMF 110 | CICS monitoring (unlock) | Per-transaction CPU, wait-type breakdown |
| SMF 30 | Job/step accounting | Batch job elapsed/CPU, initiator queue time |

- **SMF overhead:** each enabled record family adds a small CPU cost (very small for 70–79,
  noticeable for 101 class 3 and 110 detail).
- **Report rendering:** a faithful *Postprocessor-style* monospace text layout (with a chart
  toggle), so the reports feel like the real thing.

---

## 6. Player verbs (what you can change)

All changes go through the **Change Calendar**. Each has an Engineer-Hours cost, an activation
point (now, next policy activation, next IPL, after a hardware lead time) and a CAB risk.

| Area | Verb | Activation | Hours | Notes |
|---|---|---|---|---|
| WLM | Edit service classes, periods, goals, importance, CPU/Storage Critical | on policy activation (dynamic) | 0.5–2 | Validate → Install → Activate, as in the ISPF WLM application |
| WLM | Edit classification rules, report classes | on activation | 0.5 | Misclassification is the most common real problem |
| WLM | Resource groups | on activation | 0.5 | |
| WLM | Policy overrides (e.g. a "NIGHT" or "MONTHEND" policy) | scheduled activation | 1 | Schedulable switch at given times |
| z/OS | `RESET jobname,SRVCLASS=x` | immediate | 0.25 | Live emergency verb |
| z/OS | Cancel job/query, quiesce address space | immediate | 0.25 | Business may object (trust) |
| z/OS | IEAOPT parms (BLWLINTHD, BLWLTRPCT, IIPHONORPRIORITY, ERV) | immediate (SET OPT) | 0.5 | |
| z/OS | SMF/RMF interval and record selection | immediate | 0.25 | |
| PR/SM | LPAR weights | dynamic | 0.5 | HMC screen shows resulting VH/VM/VL |
| PR/SM | Logical CPs (online/reserved) | dynamic if reserved defined, else next IPL | 1 | |
| PR/SM | Capping: initial/absolute cap, defined capacity, group capacity | dynamic | 0.5 | |
| PR/SM | Memory (reserved → online) | dynamic if reserved, else IPL | 1 | |
| Hardware | On/Off CoD activate/deactivate | ~immediate | 0.5 | Daily cost |
| Hardware | Order permanent upgrade / new CPC | lead time | 2 | Capex approval may be needed |
| Subsystem | CICS: add/remove AOR, MXT, routing algorithm | next day (region restart) | 2 | Needs memory |
| Subsystem | Db2: BP sizes, MAXDBAT/CONDBAT, REBIND (revert access path) | dynamic / next day | 1–2 | |
| Subsystem | DDF/Sysplex distributor routing weights or WLM routing | dynamic | 0.5 | |
| Batch | Reschedule streams, change job classes, initiator counts/mode, split jobs, add dependencies | next batch window | 1–3 | |
| Projects | Multi-day projects: threadsafe CICS, zIIP-enable Java, Db2 compression, SQL tuning sprint, archive old data | n days | 8–40 | Permanent per-txn CPU/I-O improvements |
| Analytics | Buy/enable tools (§8) | varies | varies | |
| Ops | Take an IPL (in a change window) | weekend/night | 2 | Needed for some changes; brief LPAR outage |

**Change windows & CAB.** Planned changes submitted in the morning briefing are normal changes
and cost no trust. Changes during the live day are **emergency changes**: they cost
Trust ×(1 if an incident is active, ×3 otherwise). Every change has a small **failure risk**
(scaled by complexity and by "Team Fatigue"): a mistyped classification rule, a policy
that doesn't validate, a weight change that fails on the HMC. A **validation** tool (unlock)
reduces the risk.

**Freeze periods** (constraint cards): during freezes only emergency changes are allowed.

---

## 7. Economy & resources

| Resource | Meaning | Gained | Spent |
|---|---|---|---|
| **Trust** (0–100) | Leadership's confidence in you. **Run ends at 0.** | Good SLA days, correct RCAs, cost savings delivered, keeping promises | SLA breaches (weighted by business criticality), missed batch deadline, emergency changes, outages, broken promises |
| **Engineer-Hours** (8/day base) | Your team's capacity | Daily refill; hires/perks | Analysis, changes, projects, restarts |
| **Fatigue** (0–100) | Team burnout | Overtime (hours beyond base), pages at night | Raises change-failure risk; decays on quiet days |
| **Opex budget** (monthly) | Software MLC + On/Off CoD + tool subscriptions | Monthly; cost-saving wins | Monthly bill (SCRT); daily CoD |
| **Capex budget** (quarterly) | Hardware purchases | Quarterly; CFO events | Upgrades, memory, zIIPs, DASD |
| **Insight** | Research currency for analytics tools | Running diagnostics, correct RCAs, studying reports | Unlocking tools/skills |

Trust also has **stakeholder facets**: Retail, Cards, Digital, Finance, Regulator. Each SLA
maps to a stakeholder, and their mood shows as portraits in the briefing. Finance doesn't care
about SLAs but hates bill overruns; the Regulator cares only about batch deadlines and audit
findings. The overall Trust is a weighted mean, and any single facet at 0 triggers a crisis
event ("Head of Cards escalates to CEO").

---

## 8. Analytics: fog of war & the tool tree

You start **half blind**. That is the roguelike "fog of war" and the progression spine.

**Tier 0 (start):**
- RMF Postprocessor *Workload Activity summary* and *CPU Activity* reports, **available only
  after the day ends**, at a 30-min interval (a planted inefficiency: you can change it to 15).
- Console: LPAR busy %, SLA tickers per business service, batch "on time / late" light.
- Business complaints in the inbox (late, vague, sometimes wrong).

**Tier 1 (Insight cost: low):**
- **RMF Monitor III** (live): SYSINFO, DELAY, PROCU, ENCLAVE, WFEX (exceptions), CPC capacity.
  Enables the WLM Activity log.
- **Partition Data report** (PR/SM view, polarity, overhead).
- **Report class design tool**: suggests report classes for granularity.

**Tier 2:**
- **Monitor III charting** (requires Monitor III): today's PI, busy, delay breakdown, PR/SM delay,
  capping and DDF over time at 1-minute resolution, with WLM decisions and changes marked.
- **CF Activity** and **DASD/Cache** reports.
- **SMF 113 counters** (RNI, CPI, L1MP; LSPR workload classification).
- **Db2 accounting** (SMF 101; CPU cost when on).
- **CICS monitoring** (SMF 110; CPU cost when on).
- **SMF 30 batch analytics**: critical-path Gantt with per-job CPU/I-O/wait.

**Tier 3:**
- **Capacity planner**: forecast R4HA, utilisation and SLA risk *N* days ahead from growth
  trends, with confidence bands that widen with horizon.
- **What-if simulator**: during the briefing, fork the run and play *today* twice (as planned, and with
  the change basket), using *forecast* arrivals: no hidden events and a re-seeded noise stream. Compares
  SLA breach hours, incidents, batch end, CPC and R4HA peaks and the MLC estimate. 1 engineer-hour per run.
  This is the "zPCR-like" planning experience.
- **Alerting rules**: custom thresholds raise pager alerts (`PI(ONLHI#1) > 1.5 for 5 min`), optionally
  pausing the game; pages at night cost team fatigue, so noisy rules have a price.
- **Automation rules** (System-Automation-like): `IF CARDAUTH PI > 2 THEN ACTIVATE POLICY
  PEAKPOL`; `IF job X abends THEN restart once`. Saves hours, can misfire.
- **Capacity Provisioning Manager**: rules that activate On/Off CoD automatically (not with
  hard-capped LPARs).

**Tier 4 (endgame, expensive):**
- **AIOps anomaly detection**: flags anomalies and offers ranked RCA hypotheses. *Sometimes
  wrong*, with confidence shown. Accepting a wrong hypothesis is your fault.

**Implementation (M7.1):** tools live in `content/tools.ts` (`insightCost`, `prereqs`, `unlocks`
feature flags, `overhead`). Buying is instant and costs no engineer-hours; owned tools with
overhead can be switched off (data disappears, CPU is saved). Tier 0 reports are the Workload
Activity summary and WLMGL detail; Partition Data needs its tool, CF and DASD reports need
tier 2. Monitor III also lifts the "yesterday only" restriction on Postprocessor intervals.
Insight income: +1 per distinct report opened per played day (cap 5), RCA points, vendor-trial draft.

**Insight** is earned by doing analysis (opening and reading reports, running what-ifs), so
players who investigate get stronger. Measurement has **CPU cost**. The tension between seeing
everything and paying for it is deliberate and realistic.

---

## 9. Events, incidents, constraints (the roguelike deck)

Events are drawn each day from weighted decks whose intensity scales with run progress
(§11). Each event card has: trigger (time/condition), *visible symptoms*, *hidden mechanics*,
*diagnostic clues* (which report shows what), *valid fixes*, duration, and *forecastability*
(seen on the calendar ahead, fogged, or surprise).

### 9.1 Workload events
| Event | Hidden mechanic | Where the clues are |
|---|---|---|
| Marketing campaign | MOBILE λ ×2–4 for 1–3 h | Calendar (fogged until the Digital stakeholder mentions it); DDF END/S |
| Payday / month-end | RBANK, PAYMQ ↑, batch +30% | Calendar (known) |
| Runaway ad-hoc query | One DDF enclave burns zIIP and CP for hours | Mon III ENCLAVE; DDF period 3 consuming; IIPCP ↑ |
| Looping batch job in a high class | Misclassified job at imp 2 eats CPU | WLMGL: BATCHHI service ↑; SMF 30 |
| Retry storm | Timeout → retries → λ ↑ | END/S ↑ while successes ↓; console banner |
| Bot attack on mobile login | λ ×5 on one transaction, CPU-cheap but RACF-heavy | DDF period 1 END/S; TCPIP CPU |
| New app go-live (`NEW_APP_GOLIVE`) | Branch booking app (BOOKING, OMVS, PROD1) starts with no classification rule → SYSOTHER; stays (once per run) | WLMGL SYSOTHER service ≠ 0 on PROD1. Fixes: add a rule into a goal class, or a report class first to measure it |
| Shadow IT on TSO (`SHADOW_IT`) | Unapproved model training: TSO CPU/txn ×8, mostly on uncapped DEVT (F9) and at imp 2 on PROD (F5) | Partition Data: DEVT MSU ↑, PROD share ↓; WLMGL TSO APPL% ↑ with END/S flat. Fixes: stop it, cap DEVT, lower TSO importance |

### 9.2 Software & config events
| Event | Hidden mechanic | Clues |
|---|---|---|
| Access-path regression (REBIND) | One package CPU/txn ×4 | Service/txn jump; Db2 accounting PK |
| Lock escalation in batch | Lock waits for online | Db2 class 3 lock suspensions; CF lock contention |
| CICS SOS (`CICS_SOS`) | Storage leak in both PROD2 AORs: effective MXT 5 per region for ~4 h (APPROX: SOS as an MXT cut); silent, rumoured | CICS report / Mon III: MXT wait ↑ on PROD2 only, CPU and QR normal; WFEX "queued for a task slot". Fixes: recycle the PROD2 AORs (Retail trust −1), route teller work to PROD1 |
| SMF retention audit (`SMF_AUDIT`) | Regulator keeps full SMF 101/110 detail for 3 days: SMF address space CPU ×10 on every system (APPROX: overhead charged to SMF only); forewarned, once per run, rumoured | WLMGL: SYSSTC APPL% ↑ everywhere, SMF top consumer, MSU/R4HA ↑ ~5% with no workload slower. Fixes: negotiate scope to sampled records (Regulator trust −2), or absorb the MSU |
| QR TCB saturation | Region at ~1 engine | CICS 110 dispatch/QR; region CPU ≈ 100% of 1 CP |
| Non-threadsafe release (`QR_RELEASE`) | Teller release forces QR on the PROD1 AORs (QR fraction 0.6 → 0.95) for ~36 h | CICS report: QR wait per txn ↑ in CICSAOR1/3 only, low CPU delay. Fixes: roll back, route to PROD2, add an AOR |
| z/OS/Db2 maintenance level gift | −3% CPU/txn after you apply it (an IPL) | Release notes in inbox |
| Stored procedures lose zIIP offload (`ZIIP_LOSS`) | Mobile API procs redeployed as external stored procedures (TCBs in WLM SPAS): 70% of MOBILE zIIP time moves to general CPs for ~48 h (`ziipEligMult` 0.3); forewarned, rumoured | WLMGL: DDFPRD CP APPL% ↑, IIP% ↓, END/S and total CPU/txn flat; MSU/R4HA ↑. Fixes: redeploy as native SQL procedures (Digital trust −1), or absorb it (cap, more CP) |
| Monitor overhead creep | A vendor monitor doubles its CPU after an upgrade | WLMGL STC class service ↑ |

### 9.3 Hardware events
| Event | Hidden mechanic | Clues |
|---|---|---|
| CP failure, sparing (`CP_SPARING`) | Transparent: a spare PU takes over; only a log note and an announcement (day ≥ 3, any hour, ~6 min; `affects` empty so it is never blamed for an incident) | HMC message only; a red herring |
| DFSMShsm recall storm (`HSM_RECALL_STORM`) | Month-old migration policy change: 60k random I/O/s of recalls on LCU 30 (system + catalogs) for 2.5 h, exhausting its aliases; rumoured, trigger `DEMAND_SURGE` | DASD Activity: LCU 30 IOSQ/RESP up, Db2 LCUs normal; anything opening data sets slows. Fixes: hold HSM recalls (Retail trust −1), or move aliases to LCU 30 |
| Power cap (`POWER_CAP`) | Cooling fault: CPC one capacity setting below its current one for ~6 h, then back to that setting, not rumoured | SYSINFO / Partition Data: same engines, less MSU per LPAR; CPU delay ↑ everywhere. Fixes: cap/quiesce DEVT, defer discretionary batch, protect imp-1 work |
| CF link degraded | CF sync time ↑, async conversion | CF Activity |
| CF02 failure | Structures rebuild to CF01; it must have white space | CF util before/after |
| DASD back-end degraded | DISC ↑ on a subset of volumes | DASD Activity |
| HyperPAV alias exhaustion | IOSQ ↑ under load | DASD Activity IOSQ |

### 9.4 Organisational constraints ("curses"; persistent modifiers)
- **CFO cost mandate:** MLC −10% vs last month or lose Finance trust.
- **Change freeze** (peak season / audit week): emergency changes only.
- **Hiring freeze (`HIRING_FREEZE`):** −2 engineer-hours/day for 5 days (`hoursDelta`), announced by HR in that morning's briefing; does not stack. Responses: automation, prioritising changes, the contractor perk.
- **Regulator audit (`AUDIT_UNCLASSIFIED`):** for 5 days (once per run, day ≥ 12) each end of day scans the RMF intervals for SYSOTHER service on any LPAR (> 0.1% APPL): Regulator trust −5 with a finding in the inbox, or +1 if none. Forewarned that morning by the regulator. Responses: classification rules, a catch-all default service class per subsystem, report classes to find the unclassified work.
- **Pervasive encryption mandate:** +x% CPU on I/O-heavy work (CPACF), plus a new audit SLA.
- **Regulatory deadline moved:** batch must finish by 05:00.
- **Vendor price increase:** MLC per-MSU +8%.
- **Data centre power cap (Green IT):** On/Off CoD limited to N engine-days/month.
- **Merger:** a new LPAR with an unfamiliar workload and a bad policy lands on your CPC in 5 days.
- **Audit:** SMF retention requirements; unclassified work becomes an audit finding (Regulator
  trust).
- **Shadow IT:** DEVT used for a "temporary" production reporting job; it can't be capped
  without Digital's approval.

### 9.5 Opportunities (draft rewards, pick 1 of 3 at end of day)
Vendor tool trial (temporary unlock: the costliest overhead-free tool whose prerequisites you own, free for 3 days; buy it to keep it, `TOOL_TRIAL`), training course (permanent perk), CFO capex bonus,
contractor (temporary +hours), SQL tuning consultants (6 free hours on the SQL tuning sprint project, `SQL_SPRINT`), "friendly IBM CE" (shorter hardware
lead times), TFP contract offer, zIIP promotion pricing, codex insight.

**Perks** (sample): *Db2 Whisperer* (the DBA team tips you off when a REBIND regresses an access path; the card is otherwise silent), *HMC Ninja* (PR/SM changes
cost 0 hours), *Friends in Finance* (+10% opex), *Night Owl* (no fatigue from night pages),
*Belt and Braces* (−50% change-failure risk), *zIIP promotion* (zIIP engines cost 25% less capex for the rest of the run), *WLM training course* (policy activations take half the engineer-hours), *A mentor* (morning hints one level clearer; not offered when they are already clear), *Report Class Hoarder* (the report class advisor tool for free, so WLMGL can show each business workload on its own row; not offered once the tool is owned),
*Friend at the Vendor* (the "friendly IBM CE": hardware with 2+ days' lead arrives a day sooner), *Well Connected*
(asking around costs no hours). One-off: *Weekend push* (+3 hours tomorrow for +15 fatigue, so more change risk).
**Pacts** (constraint cards with persistent modifiers, offered in the same draft): *Offshore night desk* (+2
hours every day for the rest of the run, change-failure risk ×1.3) and *Capex for opex* (+$500k capex now, monthly
opex budget −10% for the rest of the run). Sizes in `DRAFT_TUNING`.

---

## 10. Root-cause analysis mini-game

At end of day, each **incident** (an SLA breach episode) can be investigated with an **RCA**:

1. Pick the **affected service** and **time window** (pre-filled).
2. Pick a **root cause** from a structured taxonomy: Resource {CPU, zIIP, I/O, storage, CF, lock,
   thread/MXT, QR TCB} × Mechanism {demand surge, misclassification, priority inversion,
   capping, PR/SM, hardware fault, software regression, batch overlap, dependency starvation}.
3. Attach **evidence**: pin 1–3 data points from reports (e.g. *WLMGL 10:30 DB2STC
   CPU delay 38%*). Evidence is scored for relevance against the event's hidden "clue set".
4. Propose a **remediation** (it links to a change on the calendar).

Ground truth for the trigger: an active event card that lists the hurt workload, provided the card's declared
`mechanisms` (if any) include the incident's mechanism; otherwise new work, batch overlap (lock index), policy or
growth. Without the mechanism check an I/O card could take the blame for an unrelated CPU meltdown.

**Implementation:** evidence is pinned from structured report data (Workload Activity/WLMGL interval rows,
Monitor III, Db2 101, CICS 110). A pin is relevant when it falls in the incident window (± 1 h), concerns the
hurt workload (or is a server-side clue), is notable, and its metric is evidence for the true mechanism or
trigger (`content/evidence.ts`). PI is a symptom and never counts. Evidence points need the right mechanism.

Rewards: correct cause → Trust + Insight. Correct cause with strong evidence → bonus and a codex
unlock. Wrong cause → small Trust loss ("the problem recurs next week"). Recurring incidents
after a correct RCA *and* remediation never recur. Players can skip RCAs (no penalty except
lost reward).

---

## 11. Progression: difficulty curve, run structure, meta-progression

### 11.1 Run structure (standard mode)
- **~40 played business days** (8 weeks), weekends auto-simulated. Two month-ends; the final
  week is **quarter-end close** (the boss).
- **Act I (days 1–10) "Settle in":** fix the starting topology's flaws; events are mild;
  campaign spikes ×2.
- **Act II (11–25) "Growth":** compounding growth bites; the first CFO cost mandate; hardware
  decisions with lead times; 1–2 constraint cards.
- **Act III (26–40) "Squeeze":** merger/new workload, regulatory deadline, quarter-end,
  overlapping events, freeze.
- After a win, **Endless mode**: keep going with escalating growth until Trust breaks. The escalation is the
  scenario's own compound growth carrying on past the quarter (no extra multiplier); the event deck keeps drawing,
  a fresh quarter's capex arrives when the player continues, and the run counts as a victory whenever it ends
  (grade uncapped; the end report and share line show the endless days).
- **Day-1 tutorial:** a skippable corner card walks the first day: watch the PI heat map, read WLMGL after the
  day closes, move the `DB*` STC rule above its clients (flaw F1), and check day 2. Steps advance from game state
  (`tutorialDb2Fixed` checks the installed or pending policy); progress is kept per viewer in localStorage.

### 11.2 Difficulty knobs
Growth multipliers, event-deck intensity (cards/day, severity tiers), constraint frequency,
starting flaws count, budget generosity, Ironman (no pause during live, no undo).

Implemented presets (`src/content/difficulty.ts`, applied in the game layer: the sim sees a scenario whose
workload and batch growth rates are scaled; Normal is the untouched balance baseline):

| | Growth | Event cards/day | Opex budget | Capex | Start trust | Pause | Hints |
|---|---|---|---|---|---|---|---|
| Story | ×0.6 | ×0.6 | ×1.15 | ×1.3 | 75 | yes | clear |
| Normal | ×1 | ×1 | ×1 | ×1 | 70 | yes | vague |
| Hard | ×1.3 | ×1.3 | ×0.92 | ×0.85 | 65 | yes | none |
| Ironman | as Hard | | | | | no (alerts slow to ½× instead) | none |

Event severity scales each card's magnitudes (the excess of a multiplier over 1, lock boosts, extra I/O):
Story 0.7×, Normal 1×, Hard/Ironman 1.25×. Constraint beats arrive 3 days later on Story
(which also drops the CFO mandate) and 4 days earlier on Hard/Ironman. Story starts with the infrastructure flaws
F7, F8 and F11 already fixed (announced in a handover message); the WLM and PR/SM flaws stay on every difficulty.

**Morning hints (lower difficulties):** on Story (and optionally Normal) the briefing inbox gets a
nudge or two based on what went wrong the previous day: e.g. "MOBILE missed its SLA while batch
ran; the DELAY breakdown in WLMGL for DDFPRD might show why" or "the critical path finished at
05:52; which jobs were waiting for an initiator?". Hints point at the right report and question,
never the answer or the fix, so diagnosis stays the gameplay (§13.3). They are built from the
same ground truth as RCA scoring (incident mechanism and trigger, batch-window slack, capping,
storage/paging) and get vaguer as difficulty rises; none on Hard or Ironman. On Story and Normal, big story beats also get a clear
advance hint (the merger: two days ahead, asking whether any classification rule catches the new OMVS work). Implemented: Story shows up to two
hints (workload, report and question), Normal one (the report only); a missed batch deadline leads, a tight
window (<30 min slack) comes after incident hints.

### 11.3 Meta-progression ("Career")
- Career XP from runs → unlock **scenarios**: *Midwest Mutual* (bank), *Continental Insurance*
  (IMS-heavy, claims batch), *State Revenue Agency* (tax-season spike, strict regulator),
  *Global Airline Reservations* (24×7, two CPCs across sites, GDPS-style constraints).
- Unlock **starting perks** (choose 1–2 per run) and **starting tool**.
- **Codex** persists: every real concept you encounter, explained with links to IBM docs.
- *Implemented (career v1):* XP per finished run = 10 per day played + 150 for a win + a grade bonus (S 120 … D 0),
  × difficulty (Story 0.5, Normal 1, Hard 1.5, Ironman 2); seven levels (`src/content/career.ts`) each unlock one
  draft perk as an optional **starting perk**, picked in the day-1 briefing (not on the daily challenge); the top
  one (Report Class Hoarder) is the starting tool: it installs the report class advisor. The career
  lives in IndexedDB next to the save; a run counts once (`careerRecorded`), so endless days add nothing. Scenario
  unlocks wait for a second scenario.
- **Daily seed challenge**: everyone plays the same seed; compare scores. Implemented: the seed is an FNV-1a hash of the UTC date
  (`dailySeed`), the run records `daily`, and the end screen offers a copyable one-line result (`shareText`).

---

### 11.4 Game modes: Expert and Simplified (planned, PROGRESS M9)

The default is **Expert**, the game as specified in the rest of this document. **Simplified** mode keeps
the *same simulation* (same sim code, same seed gives the same world, same reports and scoring), but
abstracts the gritty z/OS details for players who aren't already experts:

- **Goal-level actions ("bundles"):** one action makes all the discrete changes an expert would make for a
  goal. For example, *Protect mobile banking from ad-hoc queries* = a new service class + a classification
  rule + a report class; *Protect the critical batch path* = a BATCHHI rule for critical jobs + an
  initiator change; *Stop dev from stealing production CPU* = DEVT weight and logical CPs + a soft cap.
  Each bundle lists the exact changes it makes (expandable), its cost and trade-off, and can be undone as a
  unit. Bundles are content data built from ordinary Change Desk requests, so engineer-hours, change risk
  and the change freeze still apply.
- **The full WLM policy definition stays visible and editable**; bundles are a shortcut, not a wall.
- **Plain-language summaries** of reports and incidents, with the raw RMF view one click away.
- **Diagnosis is still the game:** symptoms suggest several bundles (more than one valid fix); nothing is
  fixed automatically.
- Balance target: a bot using only bundles does about as well as the textbook bot (§16).

## 12. Scoring, win & loss

**Daily score** = Σ_services weight_s × attainment_s
           − cost overrun penalty
           + RCA bonuses
           + efficiency bonus (MSU per business transaction, improved over baseline)

**Loss:** Trust = 0 ("You've been reassigned to the printer fleet") · two consecutive
regulatory deadline misses (regulator fine, run over) · opex overrun > 25% in a month.

**Win:** survive the quarter-end close with Trust > 0. A grade (S–D) from cumulative score,
cost efficiency, and trust.

**End-of-run report:** a "career review" with graphs of the run: R4HA over time, PI heat map
history, decisions timeline, biggest incident, best RCA.

---

## 13. Starting scenario — "Midwest Mutual" (decent but flawed)

The starting state is **plausible and mostly works**, which is what makes the flaws interesting.
Each flaw has a discoverable symptom.

### 13.1 Starting WLM policy `BASEPOL`

| Service class | Period | Goal | Imp | Classified work | Flaw? |
|---|---|---|---|---|---|
| SYSTEM / SYSSTC | – | – | – | system tasks, JES2, VTAM, TCPIP, IRLM, RMF | ✔ fine |
| STCHI | 1 | Velocity 60 | 1 | CICS regions, MQ MSTR/CHIN | ✔ ok |
| STCMED | 1 | Velocity 40 | 3 | **Db2 MSTR/DBM1/DIST**, monitors | ✖ **F1: Db2 below the work it serves** |
| STCLO | 1 | Velocity 20 | 5 | misc STCs | ✔ |
| ONLHI | 1 | 95% < 0.25 s | 1 | RBANK, CARDAUTH (CICS) | ✖ **F2: cards and retail share a class; cards' 99%/100 ms SLA invisible** |
| ONLMED | 1 | 90% < 0.5 s | 2 | TELLER, PAYMQ | ✔ |
| DDFPRD | 1 | 90% < 0.5 s, dur 2,000 SU | 2 | **all DDF incl. ADHOC** | ✖ **F3: ad-hoc queries in the same class as MOBILE; long ones stall in period 2** |
|  | 2 | Velocity 30 | 4 | | |
| BATCHPRD | 1 | Velocity 30 | 4 | **all prod batch, critical and not** | ✖ **F4: no critical-path protection** |
| BATCHHI | 1 | Velocity 50 | 3 | *(no rules point here)* | ✖ unused |
| TSO | 1 | Avg 0.5 s, dur 400 | **2** | TSO | ✖ **F5: devs at importance 2 on PROD** |
|  | 2 | Velocity 20 | 4 | | |
| DEVBAT | 1 | Discretionary | – | DEVT batch | ✔ |
| SYSOTHER | – | Discretionary | – | unclassified | (✖ new apps will land here) |

No report classes beyond service classes (**F6: poor granularity**).

### 13.2 Starting PR/SM & hardware
- **F7:** PROD2 has **no zIIPs online**, while DDF (zIIP-eligible) is routed 60% to PROD2.
- **F8:** CF02 on a **shared ICF** with low weight and no thin interrupts → async conversion,
  CPU burn on z/OS.
- **F9:** DEVT has **4 logical CPs at weight 100** (entitlement ≈ 0.8 CP): VL-heavy, raises the
  LtoP ratio, and it's **uncapped**, so its peaks add to z/OS/Db2/CICS MLC.
- **F10:** Weights sum to 1000 on 8 CPs. PROD1 (500) → E=4.0 → 3VH+2VM+1VL. PROD2 (350) →
  E=2.8 → 2VH+1VM+**3VL**. DEVT (100) → E=0.8 → 2VM+2VL. SYSP (50) → E=0.4 → 2VM. That's 6 VLs
  plus too many VMs. Rebalancing to 565/335/65/35 (still summing to 1000) gives PROD1
  E=4.52 → **4VH+1VM**, while PROD2 keeps 2VH+1VM at E=2.68. Trimming PROD2/DEVT logicals
  then cuts VLs, which improves cache efficiency and LPAR overhead. The trade-off: DEVT's
  guaranteed share shrinks. The HMC screen previews this live.
- **F11:** RMF interval 30 min (coarse); no SMF 113.
- **F12:** IEAOPT BLWLINTHD=20 (default); IIPHONORPRIORITY=YES (fine, but the player should
  understand it).
- No defined capacity anywhere → highest possible MLC (the CFO notices in week 3).

### 13.3 Design rule for flaws
Every flaw must (a) be *harmless-ish on day 1*, (b) become *visibly harmful* under growth or an
event by Act II, (c) have *one or more diagnosable symptoms* with Tier 0–1 tools, and (d) have
*multiple valid fixes* with different trade-offs.

---

## 14. UI / screens

Visual language: **two layers**. A modern, dark, data-dense dashboard for *operating*, and
**green-screen monospace panels** for *authentic artefacts* (RMF reports, WLM ISPF-style
editor, HMC image profile). Toggle "classic 3270 colours" for purists.

1. **Ops Console (live day):** clock and speed; per-LPAR CP/zIIP busy strips (stacked by
   importance); **PI heat map** (service classes × time, blue < 1 < red); SLA tickers per
   business service; R4HA gauge vs DC and the month peak; batch critical-path Gantt with
   projected finish; alert feed; stakeholder mood strip; Engineer-Hours left.
2. **Reports (RMF):** report browser by interval and type, Postprocessor-style text with
   "chart this" on any column; pin a value as RCA evidence.
3. **Monitor III** (unlock): live delay reports, WLM Activity log.
4. **WLM Policy Editor:** a tree of service definition → workloads → classes → periods;
   classification rule editor with test bench ("where does transaction `AUTH` from
   `DB2P` go?"); validate/install/activate; diff vs active policy.
5. **HMC:** CPC view (pools, engines, temporary capacity), LPAR image profiles (weights, LCPs,
   caps, DC, groups), *live polarity preview*, order upgrades.
6. **Topology map:** sysplex diagram with the dependency graph; nodes glow by health; click to
   inspect a server address space.
7. **Change Calendar & Inbox:** scheduled changes, CAB status, lead-time deliveries,
   **Ask around** (questions to people in the organisation: costs a little time, answers arrive
   hours later in office hours, one incomplete fragment each: a critical job, a lock-heavy job, a job
   class's meaning, how an app is classified, a growth estimate, a rumour of what's coming),
   stakeholder messages.
8. **Capacity Planner / What-if** (unlock).
9. **Debrief:** SLA report card, MLC tracker, trust deltas, RCA board, draft choice.
10. **Codex:** concept encyclopedia with source links.
11. **Run map / calendar:** weeks ahead with known and fogged events.

Accessibility: colour-blind-safe palettes (PI heat map uses a blue↔orange diverging scale, not
red/green); every chart has a table view; pause is always available except in Ironman;
keyboard-first.

---

## 15. Technical architecture

- **Language:** TypeScript (strict). **Build:** Vite. **UI:** React plus Zustand for UI state.
  **Charts:** uPlot for dense time series (fast), plus lightweight SVG for small widgets.
  **Tests:** Vitest.
- **Sim core runs in a Web Worker**; the UI receives a snapshot stream (per tick at ≤ 15 Hz,
  coalesced) and sends **commands**. Headless runner via Node for balancing.
- **Determinism:** seeded PRNG (xoshiro128** or similar); *no* `Math.random`, `Date.now` or
  wall-clock in the sim. State is plain serialisable data. `step(state, commands, rng) → state`.
  Same seed + same command log ⇒ identical run (replays, daily seeds, bug repro, what-if forks).
- **Save system:** state snapshot at each phase change and every sim hour of the live day (crash-safe: a reload resumes mid-day, so a day cannot be replayed from its briefing), plus a command log; IndexedDB.

```
src/
  sim/                 # PURE, deterministic. No DOM, no game rules about trust/score.
    core/              # clock, rng, units, state types, tick pipeline
    hw/                # cpc, pools, prsm (entitlement, polarity, overhead), capping, r4ha
    zos/               # dispatcher, erlang, ieaopt, address spaces, storage
    wlm/               # service definition, classification, pi, sampling, policy adjustment, resource groups
    io/                # dasd model
    cf/                # coupling facility, structures, sync/async
    subsys/            # cics, db2, ddf, mq, jes2/batch
    workload/          # arrival curves, growth, routing, retry dynamics
    measure/           # smf/rmf accumulators & record builders
    cost/              # mlc/scrt, tfp, hardware price application
  game/                # run state, economy, trust, events deck, rca, perks, progression, scoring
  content/             # DATA: scenarios, workloads, events, tools, perks, price curves, codex
  ui/                  # React app, screens, components, rmf text renderers
  worker/              # sim worker host & message protocol
tools/
  headless.ts          # run N days with a scripted/autopilot policy → CSV/JSON
  balance/             # strategy bots, sweeps
  play.ts              # text play interface for AI agents (planned, PROGRESS M8.9)
.claude/agents/        # game-playing agent definitions (planned, PROGRESS M8.9)
docs/agents.md         # how to run the agents
tests/
  sim/…                # unit + "realism" property tests
  golden/              # golden-run snapshots (seeded) to detect unintended model drift
```

Layering rule: `content → sim ← game ← ui`. The sim never imports game or ui code. The game
never touches the DOM.

---

## 16. Balancing & validation

- **Realism tests** (unit/property): e.g.
  - Importance-1 class gets CPU before importance-3 when both want it and PIs > 1.
  - Erlang-C delay for c=2, ρ=0.9 ≫ c=12, ρ=0.9.
  - R4HA > DC ⇒ capping engaged; LPAR MSU ≈ DC on average while capped.
  - Polarity table matches the published rules for E ∈ {0.8, 1.6, 2.3, 2.7, 4.0}.
  - Percentile PI is clamped to [0.5, 4.0] and computed from buckets exactly like the
    SG24-7621 example (70% goal / 0.6 s → PI 0.5 for the published distribution).
  - zIIP-eligible work on an LPAR with no zIIPs shows up as CP time, not IIP.
  - Db2 MSTR/DBM1 starvation increases DDF response without increasing DDF CPU delay.
  - Discretionary capping only triggers under all listed conditions.
- **Golden runs:** fixed seed + scripted commands → hashed day summaries; changes that alter
  them must be intentional (update the golden file in the same commit with an explanation).
- **Strategy bots** for balance (headless):
  - *Do-nothing*: should **lose between days 12–18** on Normal.
  - *Textbook fixer*: fixes F1–F12 with known-good settings, no hardware → survives to
    ~day 28–32.
  - *Spend-to-win*: buys CoD every day → wins on SLA but trips the opex loss condition.
  - *Expert*: scripted good play → wins with grade A on Normal.
- **Agent players** (planned, PROGRESS M8.9): AI agents play full runs through a headless text interface
  (`tools/play.ts`): it prints the briefing, inbox, incidents and requested reports as text and accepts the
  same actions the UI offers (Change Desk requests, WLM edits, RCAs, tool purchases, advance N hours).
  Agents see only what a player sees; no hidden ground truth. Runs are deterministic (seed + command log),
  so agent results can be compared with the strategy bots. Agent definitions live in `.claude/agents/`;
  `docs/agents.md` explains how to run them. A spectator mode lets a person watch an agent's run live in the normal UI
  (read-only, polling the run file `play.ts` writes after every command).
- **Performance budget:** ≤ 2 s per headless day on a mid laptop; ≤ 4 ms per tick in the
  worker at 8×.

---

## 17. Model fidelity notes

| Area | Fidelity | Notes |
|---|---|---|
| WLM goal types, importance, PI formulas, percentile buckets, discretionary PI 0.81 | **Real** | Per SG24-7621 |
| DP ranges, SYSTEM/SYSSTC/SYSOTHER behaviour, forced-SYSTEM address spaces | **Real** | |
| Policy adjustment (one receiver per 10 s, donors, net value / receiver value) | **Faithful simplification** | Projection uses our dispatcher model; exact IBM thresholds are not public beyond patents |
| Discretionary capping conditions | **Real** | |
| CF failure, structure rebuild, duplexing | **Simplified** | Rebuild by preference list and white space, fixed rebuild times, lost-structure effects as failure fractions; duplexing as a sync multiplier and extra CF CPU |
| Swap / MPL delay | **Simplified** | Only batch jobs are swappable; swap out least important first when storage overcommits; swap-in immediate when it frees |
| MQ queue depth (PAYMQ) | **Simplified** | One queue per queue manager; no timeout, put failures past MAXDEPTH, depth adds memory; no MQ SMF 115/116 |
| WLM I/O priority management | **Simplified** | IOSQ reordered by DP per image and I/O class (priority M/M/1, mean conserved); NO excludes I/O from velocity |
| Discretionary goal management | **Simplified** | SG24-7621 §4.22 conditions except the recent receiver/donor test; cap level fictional |
| Resource group types 1/2/3 semantics | **Real** | Minimum: member share dispatched above goal work while the group misses goals (APPROX for discretionary members). Type 1 is a sysplex SU/s budget split across systems by this tick's member demand (APPROX) |
| Period aging | **Real mechanics** | Transactions split analytically over periods by DUR; running batch jobs move period by the service they have consumed; long-running address spaces sit in the last period |
| HiperDispatch polarity rules | **Real (published rule of thumb)** | Watson & Walker 2022 |
| PR/SM overhead, short-engine effect | **Plausible model** | Coefficients invented, shape matches guidance (2:1 rule) |
| R4HA (48 × 5 min), DC/GC enforcement, peak-of-sums MLC | **Real mechanics** | Prices fictional. SCRT-style hourly value = R4HA limited by DC, and a capacity group's members together limited to the group limit (pro-rata split APPROX) |
| Tailored Fit Pricing (consumption) | **Simplified** | MSU-hours vs a committed monthly baseline, growth at 50% price; real contracts are multi-year with rollover. Month of signing prorated |
| Erlang-C CPU queueing | **Standard approximation** | Real z/OS dispatching is more complex |
| Measurement overhead (SMF 101/110 tracing, Monitor III gatherer) | **Plausible model** | Flat per-transaction CPU multiplier per subsystem (`mods.measureCpu`); real cost depends on trace classes and transaction profile |
| Monitor III views (SYSINFO, DELAY, PROCU, ENCLAVE, CPC, WFEX) | **Faithful simplification** | Built from WLM's exponentially smoothed state samples (≈ 67 s), not a fixed 100 s range; PROCU by service-class period, not job |
| Multi-day projects (threadsafe, zIIP-enable, compression, SQL tuning, archive) | **Plausible model** | Flat per-transaction multipliers on CPU, I/O and zIIP eligibility; sizes FICTIONAL. Events can also cut eligibility (`ziipEligMult`, moves zIIP time back to CP) |
| Report classes in WLMGL (homogeneous / heterogeneous) | **Faithful simplification** | One row per report class; goal and PI only for a single service-class period (RMF would show report class periods) |
| WLM service policies and scheduled V WLM,POLICY= switches | **Faithful simplification** | Whole policies are swapped; policy overrides within one policy are not modelled separately |
| DASD per LCU, HyperPAV alias pools, 256 devices per LCU | **Faithful simplification** | Aliases pooled per LCU (real HyperPAV); hot volumes = top 10% with a skew; utility I/O lands on hot volumes; batch sees class-level SEQ response (APPROX) |
| CF structures (LOCK/CACHE/LIST), placement, sync→async by type | **Faithful simplification** | Heuristic conversion for cache/list; lock requests never converted (APPROX); no duplexing or rebuild disruption yet |
| SMF 101/110 views | **Faithful simplification** | From the sim's per-transaction response-time parts; all transaction CPU shown as class 1 CPU; CF time stands in for GBP/lock-structure suspensions |
| SMF 113 counters, LSPR category | **Plausible model / real table** | L1MP/RNI/CPI are FICTIONAL functions of polarity mix and CPC busy; the LOW/AVERAGE/HIGH table is IBM's |
| Response-time distributions | **Log-normal assumption** | Tunable σ per workload |
| CF sync/async, 50% CF guideline, shared-CF penalties | **Real concepts, invented coefficients** | |
| CICS QR TCB single-engine limit | **Real** | |
| Db2 address space placement guidance | **Real (IBM)** | |
| Machine capacity, MSU/CP, price tables | **Fictional** | Proportions plausible; no real LSPR numbers |
| WLM samples | **Analytic equivalent** | Time-average concurrency per state instead of 250 ms sample counts |
| I/O using/delay split | **APPROX** | Connect+disconnect = using, IOSQ+pend = delay |
| Dependency delay | **Plausible model** | `latency × (1/health − 1 + queueRatio)` per server role; counted as "other" delay |
| CICS region management | **Simplified** | CICS work on an image shares the AOR regions' DP: most important served period (TRANSACTION, free ride) or the region STC class (REGION); no per-region split of work |
| Pre-work-manager queueing (MXT, DBAT) | **Real concept** | In users' response time, not in WLM/RMF response time |
| DASD | **Plausible model** | IOSQ via M/M/c on hot volumes with HyperPAV exposures; PEND/DISC with utilisation inflation |
| CF | **Real concepts, invented coefficients** | Sync spin CPU, async conversion above a threshold, shared-engine dispatch wait, polling burns ICF share |
| Batch | **Discrete jobs, fluid CPU** | Single-threaded elapsed = CPU + I/O, stretched by CPU/zIIP starvation, Db2 health, lock contention |

Whenever a coefficient is invented, it lives in `content/` with a `// FICTIONAL:` comment and
the shape it is meant to reproduce.

---

## 18. References

Primary IBM sources:
- IBM Redbook **SG24-7621**, *ABCs of z/OS System Programming Volume 12* (WLM): PI formulas,
  percentile buckets, sampling (250 ms), policy adjustment (10 s), DP ranges, special service
  classes, resource groups, soft/group capping, discretionary capping, CICS topology.
  https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf
- IBM Db2 12: *Velocity goals for Db2 address spaces*.
  https://www.ibm.com/docs/en/SSEPEK_12.0.0/perf/src/tpc/db2z_determinevelocitygoals.html
- IBM Db2 12: *Configuring zIIPs for Db2*.
  https://www.ibm.com/docs/SSEPEK_12.0.0/perf/src/tpc/db2z_ibmziip.html
- IBM docs: *Group capacity* (defined capacity, phantom weight, capping patterns).
  https://www.ibm.com/support/knowledgecenter/SSLTBW_2.1.0/com.ibm.zos.v2r1.ieaw100/grcap.htm
- IBM docs: *IEAOPTxx parameters* (BLWLTRPCT, BLWLINTHD, IIPHONORPRIORITY, ERV).
  https://www.ibm.com/support/knowledgecenter/SSLTBW_2.1.0/com.ibm.zos.v2r1.ieae200/spi.htm
- IBM WSC: *Blocked workload support*.
  https://www.ibm.com/support/pages/system/files/inline-files/blocked_v3.pdf
- IBM docs: *How z/OS performs sync→async conversion of CF requests*.
  https://www.ibm.com/support/knowledgecenter/en/SSLTBW_2.2.0/com.ibm.zos.v2r2.ieaf100/huer.htm
- IBM: *Sync/Async heuristic*.
  https://www.ibm.com/support/pages/system/files/inline-files/Sync_Async_Heuristic.pdf
- IBM: *Relating production workloads to LSPR workloads* (RNI/L1MP table).
  https://www.ibm.com/support/pages/relating-production-workloads-lspr-workloads
- IBM: *CPU MF formulas*.
  https://www.ibm.com/support/pages/system/files/inline-files/CPU%20MF%20Formulas%20April%202025_0.pdf
- IBM z/VM performance tips: *Managing PR/SM overhead* (2:1 logical:physical).
  https://www.vm.ibm.com/perf/tips/prsmovhd.html
- IBM: *CICS threadsafe white paper* (QR TCB).
  https://public.dhe.ibm.com/software/uk/itsolutions/leveragingmiddleware/new-face-of-cics/cics-threadsafe-whitepaper.pdf
- IBM: *z/OS Capacity Provisioning*.
  https://www-03.ibm.com/systems/z/os/zos/features/cpm
- IBM: *RMF Monitor III reports* (SYSINFO, DELAY, WFEX, ENCLAVE…).
  https://www.ibm.com/docs/SSLTBW_2.2.0/com.ibm.zos.v2r2.erbb500/toc.htm
- IBM: *What is Tailored Fit Pricing for IBM Z?* (consumption baseline, discounted growth, no capping).
  https://www.ibm.com/support/knowledgecenter/SSLTBW_2.3.0/com.ibm.zos.v2r3.izsc100/containerPricingOverview.htm

- IBM: *z/OS Workload Manager: Service classes and report classes* (homogeneous vs heterogeneous report classes).
  https://www.ibm.com/docs/en/SSGMCP_5.4.0/fundamentals/workload/workload_lp_classes.html

Practitioner sources:
- Precisely, *IBM Tailored Fit Pricing: optimize mainframe* (baseline from 12 months of MSU, rollover).
  https://www.precisely.com/blog/mainframe/ibm-tailored-fit-pricing-optimize-mainframe/
- Watson & Walker, *Cheryl Watson's Tuning Letter* 2022 No. 1 (Jim Horne), "A Different Way
  to Define LPAR Weights": HiperDispatch polarity rules.
  https://tuningletter.planetmainframe.com/wp-content/uploads/samples/Reprint-of-Jims-LPAR-Management-article.pdf
- Colin Paice, *One Minute MVS performance: looking at WLM reports*.
  https://colinpaice.blog/2021/06/27/one-minute-mvs-performance-work-load-manager-looking-at-wlm-reports/
- Colin Paice, *One Minute MVS performance: DASD*.
  https://colinpaice.blog/2021/06/19/one-minute-mvs-performance-dasd/
- IntelliMagic (John Baker), *MLC Capping 101*. https://www.intellimagic.com/?p=7302
- IntelliMagic, *Tune WLM policies to improve performance and resiliency*.
  https://www.intellimagic.com/?p=14925
- Planet Mainframe, *Sub-capacity pricing and capping 101*. https://planetmainframe.com/?p=1640
- value-4it, *z/OS soft capping: balancing cost & performance*. https://www.value-4it.com/wp/?p=165
- Longpela Expertise, *Is discretionary bad?* (DGM, ERV).
  https://www.longpelaexpertise.com.au/ezine/IsDiscretionaryBad.php
- Peter Enrico, *WLM: revisiting goals over time* (SHARE).
  https://share.confex.com/share/123/webprogram/Handout/Session15850/Peter.Enrico.WLM.Revisiting.Goals.Over.Time.pdf
- SHARE: *WLM – Are you set up to fail?*
  https://share.confex.com/share/123/webprogram/Handout/Session15707/WLM%20-%20Are%20you%20Set%20Up%20to%20Fail.pdf
- SHARE: *Capping, capping, capping*.
  https://share.confex.com/share/123/webprogram/Handout/Session15719/S15719_Capping%20capping%20capping%20AllCharts.pdf
- IBM: *Parallel Sysplex performance topics* (CF < 50% busy).
  https://es.slideshare.net/slideshow/parallel-sysplex-performance-topics/7674725

Further reading to mine during implementation: *z/OS MVS Planning: Workload Management*
(SA23-1390), *z/OS RMF Report Analysis*, *z/OS RMF Performance Management Guide*, the JES2 Init &
Tuning Guide (WLM initiator queue-delay measurement), *Db2 for z/OS Data Sharing: Planning and
Administration*, Frank Kyne's and Cheryl Watson's Tuning Letter archives, and Peter Enrico's
WLM and capacity sessions.
