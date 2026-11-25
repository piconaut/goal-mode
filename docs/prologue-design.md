# The Shadow Week: a guided prologue (design)

Status: **proposal, not scheduled** (written 2026-11-25). It supersedes PROGRESS.md proposal P2 ("full-day guided
tutorial") and keeps P2's rules: steps are content data, nothing is fixed automatically, every step accepts more than
one valid fix, and the scripted events never leak into normal runs. Nothing here is a task until it is scoped into
BACKLOG.md entries (§13 lists the proposed ones). Open questions for the user are in §14.

## 1. Summary

Before Day 1 of a normal Midwest Mutual run, the player spends a **shadow week**, five scripted days, with
**Ruth Abernathy**, the capacity and performance lead who retires on Friday. Each day introduces one area of the
craft. At fixed times a scripted event fires, the game **pauses**, and Ruth walks the player through it: where to
look, what to pin, which change to make, how the root-cause analysis is filed and how it is scored. The deck is
empty: no random cards, no growth surprises, no draws. Help gets thinner as the week goes on: Monday is a guided
tour, Friday's incident is the player's own, with hints only when asked.

By Friday night the player has opened every tab, at least one view in every section of each, and has seen every
subsystem the game models at least once. Then Ruth hands over, and **Day 1 starts as it does today**: same state,
same seed choice, same difficulty picker, nothing carried over that changes the balance.

Target length: about 70 minutes, in five chapters of 10–15 minutes. Each chapter can be resumed, replayed or
skipped.

## 2. Who it is for

Two players, and anyone between them:

- **The intern** with 1–2 years on the mainframe: knows TSO/ISPF, JCL, SDSF and what a CICS region is, has probably
  read an RMF report without knowing what to look for, has never owned a WLM policy or a capacity bill.
- **The intermediate engineer from elsewhere** (I read "zero maintenance experience" as zero *mainframe*
  experience; §14 Q1): knows queueing, CPU saturation, p95 latency, dashboards and incident reviews, but not
  service classes, PR/SM, R4HA or why a Db2 address space's importance matters.

So the prologue never explains what a CPU or a percentile is, and never assumes the player knows what a velocity
goal, a logical CP or an EDSA is. Each z/OS term is introduced once, in plain words, with a Codex link, at the
moment it first matters, and not before.

**What the player should be able to do at the end:**

1. Read the Ops Console and say which business service is hurting and since when.
2. Go from "service X is slow" to "class Y is waiting for resource Z on system W", in Monitor III or RMF.
3. Tell a full machine from work standing in the way of other work (CPU_CAPACITY vs CPU_PRIORITY), and both from a
   subsystem limit (threads, storage, I/O, CF).
4. Make a change through the Change Desk, and know when it takes effect and what it costs (hours, trust, risk).
5. File an RCA with a mechanism, a trigger and pins that prove them, and understand the reply.
6. Know where the money goes: R4HA, the monthly bill, and which levers move it.
7. Know that every tool in Analytics exists, roughly what it does, and that Monday's run starts without most of them.

## 3. Framing

### 3.1 The mentor

Ruth has run performance and capacity at Midwest Mutual for three decades. She is dry, practical and a little
impatient with dashboards. She never does the work for you. She talks in short paragraphs, asks questions before
she gives answers, and admits uncertainty ("I've seen this be the CF twice and the network once"). Sample voice:

> "Don't touch anything today. Somebody always wants you to fix something on your first morning. Watch it run once,
> so you know what normal looks like."

> "Orange on the heat map means a class is missing its goal. It doesn't tell you why, and it doesn't tell you
> whether anybody outside this room has noticed. The SLA tickers tell you that."

> "That's your first RCA. You'll write a hundred of these. The scoring cares about two things: did you name what
> actually happened, and can you show it from the reports. Being right without proof is a guess."

### 3.2 Why the events are scripted: the replay plex

The shadow week runs on **PLEXQ**, Midwest Mutual's QA sysplex: a clone of production with the same WLM policy,
the same PR/SM configuration, the same hardware, and production's arrivals replayed from last month's SMF. Ruth uses
it to train people: she replays incidents from the bank's past, on schedule.

> "This is the plex I train people on. Same policy as production, same box, last month's traffic played back. I'll
> drop in a few of the bank's greatest hits. Nothing you do here touches PLEXP1, so go ahead and break things."

This framing solves three design problems at once:

- **No randomness needs explaining.** The events are Ruth's replays, so they come at fixed times and she can pause
  them.
- **Day 1 starts clean.** PLEXQ is a copy. Whatever the player changed on it, production on Monday morning is the
  canonical day-1 state. Ruth says so in her handover: "Anything you fixed on the clone, you get to fix again on
  production, through the change board, with your name on it." The main game's flaws are not spoiled, because she
  only teaches the one the day-1 tutorial already teaches (F1); §14 Q2.
- **Mistakes are cheap without being meaningless.** Trust, hours and stakeholder moods all move as in a real run,
  shown as **shadow scores** ("this is what it would have cost on production"). The run cannot be lost, and no
  score carries over.

The UI names the systems as in the main game (PROD1, PROD2, DEVT, SYSP) so that nothing has to be relearned on Monday.
Only the sysplex name and a "QA replay" badge in the top bar differ.

### 3.3 The calendar

The shadow week is the Monday to Friday before Day 1, shown as **Shadow Mon … Shadow Fri** (never "Day 1–5"). Shadow
Friday is the last business day of the month, so it is a **month-end** (higher batch volumes, a heavier night),
and the month closes while Ruth is still there: the right moment for the Finance lesson to come back. Day 1 is the
following Monday, as today.

## 4. Structure at a glance

| Chapter | Theme | Scripted event (card) | Help level | New tabs and overlays | Subsystems met |
|---|---|---|---|---|---|
| **Shadow Mon** "Look before you touch" | Reading the console; goals and PI; the report card; the first RMF report | none (a normal day, replayed) | tour | Briefing, Ops Console, Codex, Inbox, report card, RMF Reports | WLM (service classes, PI), batch window |
| **Shadow Tue** "Who's waiting, and for what" | Monitor III, delays, pins, classification, the change board, RCA #1 | marketing campaign on mobile (`CAMPAIGN`, forewarned Monday) exposing Db2 below its clients (F1) | guided | Analytics (buy Monitor III), Monitor III, Evidence board, Change Desk › WLM, review › RCA, draft | Db2, DDF, CICS, z/OS dispatcher |
| **Shadow Wed** "The box" | PR/SM, weights and polarity, capacity vs priority, capping, R4HA, the bill | cooling fault (`POWER_CAP`) | assisted | Partition Data, Monitor III CPC, Change Desk › LPARs & hardware, Finance | PR/SM, HiperDispatch, CPC capacity, zIIP pool, MLC |
| **Shadow Thu** "Inside the subsystems" | SMF detail, thread and storage limits, Ask around, what "normal" looks like for CF and DASD | CICS short on storage on PROD2 (`CICS_SOS`) | prompted | SMF analytics (CICS 110, Db2 101/statistics), CF and DASD Activity, Change Desk › Systems, CF & I/O, Inbox › Ask around | CICS, Db2, MQ, CF, DASD |
| **Shadow Fri** "Nights and the long game" | A solo RCA, emergency vs planned, batch and the critical path, planning tools, handover | runaway ad-hoc query (`RUNAWAY`) by day; a critical job abend (`JOB_ABEND`) at month-end night | solo | Change Desk › Batch & operations, › Projects, Analytics tier 3–4 (loaned), SMF 30 batch | Batch/JES2, initiators, TSO, automation |

One scripted incident per day keeps each day about one idea. Tours of the other views happen in the quiet hours
around it.

### 4.1 Pacing

- Between beats the replay runs at 8× by default, and a **Skip to next beat** button jumps there (a stop tick, §11.3).
  A day at 8× is about 75 seconds of wall time, so time is spent in the lessons, not waiting.
- A beat pauses the clock. While paused, the whole UI works: the player can wander anywhere, and Ruth waits.
- About 3–5 beats a day, each 1–6 steps. A step is one instruction and one thing to do.
- Every chapter starts at 06:00 with the briefing and ends with that day's review, so the chapter boundary is the
  game's own day boundary.

### 4.2 Help levels

| Level | Used on | Ruth's role |
|---|---|---|
| **Tour** | Mon | Points at each thing, explains it, asks the player to click it. No decisions. |
| **Guided** | Tue | Says exactly where to look and what to do, and why, and accepts alternatives the player finds. |
| **Assisted** | Wed | Names the report and asks the question ("is the box full, or is someone in the way?"); the player picks the rows and the fix. |
| **Prompted** | Thu | Asks the question only; points at a report only on request. |
| **Solo** | Fri (day) | Says "your incident", then waits. The hint ladder (§6.3) is there if the player asks. |

## 5. The script, day by day

Times are sim time. "Beat" = the game pauses and Ruth speaks. "Step" = one instruction with a success condition
(§6.2). The fixes listed are those the step accepts; Ruth suggests the first one and comments on the trade-off of
whichever the player picks.

### 5.1 Shadow Mon: "Look before you touch"

Goal: the player can read the console and one RMF report, and knows the day's rhythm (briefing → live day → review).
The Change Desk is closed today ("Monday we watch"); every other tab is open.

**Beat M1, 06:00, briefing.** Ruth introduces herself and the replay plex. Steps:
1. The briefing: inbox messages, stakeholder moods (the trust facets: Retail, Cards, Digital, Finance, Regulator,
   and why each cares about different things), engineer-hours (8 a day; "the team's time is the budget you'll run out
   of first"), the calendar.
2. The forewarning for Tuesday's `CAMPAIGN` card, from Digital ("marketing is pushing a mobile promo"). Ruth:
   "Remember that one." (So the player learns that the inbox predicts things.)
3. Start the day.

**Beat M2, 06:10, the Ops Console tour.** Steps, one element each, spotlighted:
1. Clock and speed controls: pause, ½×–8×, Skip to next beat; Space pauses.
2. LPAR busy strips: four images on one machine, CP and zIIP; "this is how busy each system is, not whether anyone's
   happy".
3. SLA tickers: one per business service, mapped to a stakeholder. "These are what the bank sees."
4. The PI heat map: rows are service class periods; a PI below 1 means the class meets its goal, above 1 means it
   misses. Click a row's label to open the Codex entry for **performance index** (step done when the Codex entry is
   opened). Ruth: "The Codex has every term you'll meet. Use it."
5. The operations log and the incidents panel (empty for now).

**Beat M3, 10:45, the morning peak.** Retail banking and tellers peak around 10:30. Steps:
1. "Something on the heat map is warmer than it was at seven. Click it." Any period with a PI above 0.9 is accepted;
   if none is, Ruth uses the warmest row and says "green isn't the same as comfortable". The script is tuned so DDFPRD
   period 2 (ad-hoc queries that ran long) is the warmest; Ruth notes it without explaining it ("we'll come back to
   ad-hoc queries on Friday").
2. "Is anyone outside this room unhappy?" The player checks the SLA tickers: all green. Lesson: **a class missing its
   goal is not yet an incident; an SLA breach is.**

**Beat M4, 18:00, the batch window.** Steps:
1. The batch window panel: the critical path, the 06:00 deadline, the projected finish. "This is what gets you
   phoned at three in the morning."
2. Which business owns it (the Regulator, and Retail on a miss). Then let the night run.

**Beat M5, review.** Steps:
1. The report card: each service's attainment, the trust deltas (shadow), the MLC tracker. No incidents today, so no
   RCA: "a quiet day is the best kind".
2. RMF Reports › Workload Activity. "Postprocessor reports only cover intervals that have ended. That's why you
   read them in the evening, until you buy something better." Open it.
3. WLMGL detail: find ONLHI period 1; read its goal, its actual, its PI and its using and delay samples. Spotlighted
   field by field. Step done when the player has opened WLMGL and selected the 10:30 interval.
4. The interval selector: the reports are at 30 minutes ("I always meant to make that 15. Write it down."). This is
   flaw F11; Ruth does not fix it and the player can't yet.
5. Insight: the top bar counter went up when the reports were opened. "Reading pays. You'll spend it tomorrow."

### 5.2 Shadow Tue: "Who's waiting, and for what"

Goal: the player can find a delay in Monitor III, pin evidence, make a WLM classification change through the change
board, and file a first RCA, with every field explained.

**Beat T1, 06:00, briefing.**
1. Analytics tab: the tool tree, Insight, and the price of measurement ("monitors burn CPU too"). Buy **RMF Monitor
   III** (15 Insight, as every run starts with). Step done when the tool is owned.
2. Engineer-hours check: about 8 today; Ruth estimates the day's work at 3–4 hours.

**Beat T2, 08:30, the Monitor III tour.** Quiet morning, so the views show normal. Steps:
1. SYSSUM: goals vs actuals, live.
2. SYSINFO: the LPAR view and the z/OS view of CPU.
3. DELAY: using, delayed, unknown. "Unknown is mostly time inside Db2, CICS, the CF. RMF can't see it. That's normal
   when the PI is fine."
4. BREF/FREF: step back one interval and forward again. "Monitor III keeps history. You can look at what happened
   ten minutes ago, which is usually when it started."

**Beat T3, ~11:40, the campaign bites.** The scripted `CAMPAIGN` card started at 11:00 (forewarned Monday). Mobile
traffic doubles; PROD2 gets busy; DDF response times grow; the MOBILE SLA ticker turns, and an incident opens.
Steps:
1. Console: the incident panel names MOBILE. "Who's hurting? Since when?"
2. Monitor III SYSSUM: DDFPRD period 1 is red. DELAY for DDFPRD: mostly unknown. "Unknown, with a red PI. So
   DDF's work is waiting inside something. What does DDF wait on?" Answer: Db2.
3. PROCU on PROD2: the Db2 address spaces are among the heavy users. DELAY for STCMED (where Db2 is classified):
   processor delay. "Db2 is waiting for CPU. Who's in front of it?"
4. Change Desk › WLM › Service classes: STCMED is importance 3; the CICS regions and DDF work it serves are
   importance 1–2. "Db2 is below the work it serves. WLM is doing exactly what we told it to." This is F1, the
   existing day-1 tutorial's judged step (`db2AboveItsClients`).
5. Pin two pieces of evidence, each spotlighted: STCMED's CPU delay on PROD2, and DDFPRD's ended rate (or MOBILE's
   ended rate) on PROD2. Ruth explains a pin: "a reading, at a time, on a row. You'll attach these to the RCA."
   The Evidence board shows them.

**Beat T4, right after T3, the change.** Still paused.
1. Classification rules: the STC rule `DB*` → STCMED. The **test bench**: "where does DB1BMSTR go?" Step done when
   the test bench has been run on a Db2 jobname.
2. Point `DB*` at STCHI or SYSSTC. Both are accepted. Ruth on the trade-off: SYSSTC runs above every goal;
   STCHI keeps Db2 under goal management at importance 1. (What IBM recommends for each Db2 address space, IRLM
   included, is checked with `zos-docs` before this text ships; §12.)
3. **When it happens, and what it costs.** Ruth explains the two ways in: install and activate now, an
   **emergency change** (costs trust: ×1 while an incident is active, ×3 otherwise; a small failure risk), or plan it
   for 06:00 tomorrow, a **normal change** at no trust cost. Both are accepted. "In my day, we rode it out and took
   it to the board. You decide." If the player goes emergency, Ruth shows the trust cost on the shadow score.
4. Validate → Install → Activate (or Plan). Step done when the change is planned or applied with `db2AboveItsClients`
   true on the installed policy (the same check the day-1 tutorial uses).

**Beat T5, 13:00 (or when the campaign ends).** If the change went in live: Ruth shows the PI heat map recovering.
If planned: "Tomorrow morning you check it worked. Always check."

**Beat T6, review: RCA #1, fully guided.** This is the scoring lesson. Steps:
1. The RCA form: the affected service and window (prefilled), and what an incident is (an SLA breach episode).
2. **Mechanism**: the resource × the way it failed. Ruth gives it and says why. **Trigger**: what started it. Ruth
   gives it and says why. The expected answers are whatever the truth engine produces for the scripted incident
   (§11.5): Ruth's dialogue is written against that truth and against the full accepted set, so when the player picks
   an accepted alternative Ruth says "that's also defensible, because …" using the accepted-answer reason line.
3. **Evidence**: attach the two pins. Ruth explains the proof: a recipe of two predicates, the symptom on the right
   subject and then the reading that rules out the look-alike; a complete recipe for the mechanism earns full
   evidence points, half a recipe earns a little, and a complete recipe for the trigger too makes the evidence
   **strong** (+5 Insight).
4. **Remediation**: link the classification change.
5. File it. Ruth walks the reply line by line: "accepted" vs "not accepted" for the answer, "proven" vs "your pins
   did not prove it" for the evidence, each pin counted or with the reason it didn't count. Then the scoring summary:
   3 points for an accepted mechanism, 2 for an accepted trigger, evidence on top; a correct RCA earns trust and
   Insight; a wrong one costs a little trust; skipping costs nothing but the reward; one RCA covers every incident with
   the same cause.
6. The **draft**: pick one of three opportunities. Ruth: "Every evening you get to choose one. On the clone they're
   pretend. On Monday they're real." The pick applies for the rest of the shadow week only. The *A mentor* perk is
   left out of prologue drafts (Ruth is the mentor).

### 5.3 Shadow Wed: "The box"

Goal: the player understands that four systems share one machine, how PR/SM divides it, how to tell a full machine
from work in the way, what capping does, and what sets the bill.

**Beat W1, 06:00, briefing.**
1. "Did yesterday's change work?" The change results in the Requests section; the policy now active. If the
   player planned it, it activated at 06:00.
2. Buy **Partition Data** (Insight from Monday and Tuesday).

**Beat W2, 07:00, the machine.** A quiet hour. Steps:
1. Partition Data: one CPC, 8 shared CPs, four images, their weights, logical CPs and share. Ruth explains
   **weight → entitlement** in one paragraph with PROD1's numbers.
2. Change Desk › LPARs & hardware › HMC: the live **HiperDispatch polarity preview** (VH/VM/VL). Change a weight in
   the draft and watch the polarity change, then discard the draft. "Vertical highs are engines that are really yours.
   Lows are borrowed." Step done when the preview has shown a change. (F9 and F10 are visible here; Ruth doesn't
   name them.)
3. Monitor III CPC: logical and physical utilisation per partition, PR/SM delay.
4. The zIIP pool: one line in Partition Data and PROCU's IIP column. "Java and DDF can run on zIIPs, which are cheaper.
   When zIIP work runs on a CP, PROCU shows it." (Introduces the idea; F7 stays undiscovered.)

**Beat W3, 08:00, the money.** Steps:
1. Finance tab: the monthly opex budget, the bill to date, the R4HA chart, product MSU by hour. "Software is billed
   on the peak four-hour rolling average of the month, not the average. One bad afternoon sets the bill."
2. Console's R4HA gauge against the month's peak.
3. DEVT is uncapped, so its busy hours add to the peak. Ruth: "Dev is everyone's favourite thing to cap. It's also
   the developers' whole day."

**Beat W4, ~12:20, the cooling fault.** The scripted `POWER_CAP` card starts at 12:00: the CPC runs one capacity
setting lower for about six hours, and Facilities' announcement arrives as in the main game. Ruth: "Same machine,
less of it. Now what?" Steps (assisted: Ruth names the report and asks):
1. "Same engines. What changed?" The player finds it in SYSINFO or Partition Data (less MSU per image; a capacity
   adjustment). Any of the two accepted.
2. "Is the box full, or is someone in the way?" Ruth explains CPU_CAPACITY vs CPU_PRIORITY: if the processor is
   saturated and nothing displaceable is running, it's capacity; if a less important class is using CPU that the
   hurt work could have had, it's priority. The player looks at CPC busy and at what's running at low importance.
   Ruth accepts either answer if the truth's accepted set does (a CPU verdict inside the §10 bands accepts both
   sides), and explains why the line is blurry.
3. Pick a response. Accepted: lower DEVT's weight or cap it (HMC: initial capping, or a defined capacity), hold
   discretionary batch, lower TSO's importance, protect importance-1 work. Ruth notes what On/Off CoD is and that
   it's billed daily, and points out that buying capacity for a six-hour fault is expensive.
4. Ruth shows the cost of the choice in the shadow score: a DEVT cap costs Digital's patience.

**Beat W5, review: RCA #2, assisted.** Ruth asks the questions, the player answers:
1. "Which resource?" The player picks. "What started it?" The player picks.
2. "Which reading shows the machine got smaller?" The player pins from Partition Data or SYSINFO.
3. File. If the answer is not accepted, Ruth explains with the reply's own lines and, as a prologue-only rule,
   offers **one refile** (§14 Q6), so the player sees a correct reply too.
4. Ruth points at the trust line: an RCA's trust reward counts once per incident in its group.

### 5.4 Shadow Thu: "Inside the subsystems"

Goal: the player knows that RMF shows CPU and delays by class, but the reason inside a subsystem is in the
subsystem's own records; meets each subsystem's view once; learns that a pin has to be about the hurt work.

**Beat H1, 06:00, briefing.**
1. Inbox › **Ask around**: Ruth suggests asking the CICS team whether anything changed recently. It costs a little
   time; the answer arrives later in office hours as one fragment. (Scripted: the reply, around 09:30, mentions a new
   release on PROD2 "using more storage in test".)
2. Buy **CICS monitoring (SMF 110)** and **CF/DASD reports**, or take Ruth's loan if the player is short of Insight
   (§8.2). Note their CPU overhead.

**Beat H2, ~10:40, CICS short on storage.** The scripted `CICS_SOS` card starts at 10:00 on the PROD2 AORs. Retail
service slows on PROD2 only. Steps (prompted: Ruth asks, points only on request):
1. "Retail is slow, but only some of it. Where?" Monitor III SYSWKM or WFEX: CICS work queued for a task slot on
   PROD2.
2. "CPU's fine. So what are the tasks waiting for?" SMF › CICS monitoring: MXT wait up on PROD2 only, CPU and QR
   wait normal. The region storage view: EDSA peak at EDSALIM, SOS minutes.
3. Ruth explains in two sentences: a region has a storage limit; when tasks no longer fit, CICS stops starting new
   ones, so they queue for a slot even though MXT would allow more.
4. Fixes, all accepted: recycle the PROD2 AORs (an operations fix; immediate; costs Retail trust), raise EDSALIM
   (Change Desk › Systems › CICS), lower MXT to what storage holds, route CICS work to PROD1 (Routing). Ruth warns
   before the player raises MXT: "more slots doesn't help when it's storage that's short." If the player raises it
   anyway, it is allowed and the replay shows it doesn't help.

**Beat H3, ~14:30, the subsystem tour.** No incident. One or two steps each: "learn normal, so you can see
abnormal".
1. SMF › Db2 accounting (101): class 1 elapsed, CPU per transaction against its baseline, class 3 suspensions.
   Db2 statistics: DBAT waits at MAXDBAT.
2. Change Desk › Systems › MQ: the queue managers and queue depth; where MQ's address spaces are classified.
3. RMF › CF Activity: two coupling facilities, sync and async requests. "When a CF is slow, z/OS spins waiting for it,
   so a CF problem can look like a CPU problem." (F8 is visible here; Ruth doesn't name it.)
4. RMF › DASD Activity: response, IOSQ, DISC per LCU; Change Desk › Systems › DASD: HyperPAV aliases per LCU.
5. SMF › CPU MF (113): one sentence on cache misses and why low-polarity engines lose cache. (Only if SMF 113 is on
   loan; otherwise Ruth names it as a tool to buy.)

**Beat H4, review: RCA #3, prompted.** The player fills the form alone. Before filing, Ruth suggests adding a DASD
pin from H3 ("it was a busy LCU, wasn't it?"). After filing, the reply shows that pin as **not counted: not about the
work**, and Ruth explains relevance: a pin counts only if it is about the hurt work, its server or its host, in the
incident window, and notable. "I set you up. Sorry. Everybody pins the scary number once."

### 5.5 Shadow Fri: "Nights and the long game" (month-end)

Goal: the player handles an incident alone; meets batch, initiators and the night; sees the planning tools; is
handed over.

**Beat F1, 06:00, briefing.**
1. Ruth's loans (§8.2): Capacity planner, What-if, Alerts, Automation and AIOps are switched on for today. "These were on
   my budget. They leave with me."
2. **What-if**: Ruth asks: "If we'd made yesterday's change, what would today look like?" The player forks today
   with any basket and compares SLA hours, batch end, R4HA peak and the MLC estimate. One engineer-hour.
3. **Capacity planner**: the R4HA forecast with its widening bands. "This is the conversation you'll have with Finance
   in week three."
4. Change Desk › Projects: multi-day improvements (threadsafe CICS, zIIP-enable Java, SQL tuning). Ruth: "These pay
   off in weeks. You'll want one going by your second week." Booking one is optional and it doesn't carry over.
5. Alerts: Ruth's own rule, "page me if a critical job abends", already defined. Fatigue from night pages.

**Beat F2, ~10:15, the runaway (solo).** The scripted `RUNAWAY` card starts at 09:30: one ad-hoc DDF query burns CPU
and zIIP for hours. Ruth: "This one's yours. I'm getting coffee." The hint ladder is available (§6.3); AIOps shows its
top hypothesis on the incident card with its confidence, and Ruth adds "it's right more often than it's wrong. That
isn't the same as right."
Accepted fixes: cancel the thread (an operator command: costs hours and Digital trust, no change board trust), or
classify ad-hoc queries away from MOBILE's class (a WLM change), or both. No step tells the player which. The beat
completes when the incident closes or the player says they're done.

**Beat F3, review of the day (before the night).** RCA #4, solo. Ruth comments only after the reply.

**Beat F4, 18:00, the month-end night.** Steps:
1. SMF 30 batch (on loan): last night's critical path as a Gantt, initiator queue time vs elapsed. "Batch is a
   chain. The chain is as fast as its slowest link and its longest wait for an initiator."
2. Change Desk › Batch & operations: job classes and initiators; Routing. Look, don't change.
3. TSO and the team's own goal: "If TSO gets slow, everything we do takes longer." (PT-50.)

**Beat F5, ~01:40, the abend.** The scripted `JOB_ABEND` card: a critical job abends. Ruth's alert pages (and the
pause is the page). Steps:
1. Operations log and batch window: which job, how much slack is left.
2. Operations › restart the job. Ruth: "Find out why it abended before it abends again. Tonight, just restart it."
3. Let the night run. If the critical path still misses 06:00, a BATCH incident opens and the final review includes
   a fifth RCA (optional, Ruth shows the SMF 30 pins). If it makes it, Ruth: "No incident is the best RCA."
4. Automation: Ruth shows the rule "if job X abends, restart once" and its cost: it can misfire.

**Beat F6, the handover (after the last review).**
1. A shadow-week report card: the week's shadow score, the RCAs, the changes made.
2. Ruth's **handover note** in the inbox: what she learned, three general habits (look before you touch; check every
   change the next morning; pin the discriminator, not the scary number), and a short list of "things I never got
   round to" that is deliberately vague on Normal and Hard ("the reporting granularity is poor"; "development has
   more processors than it needs") and clearer on Story. §14 Q2.
3. The Codex gains **Ruth's notebook**: one page per lesson, written in her voice, linking the Codex entries it used.
   It persists across runs.
4. "Production's yours on Monday." The new-run screen opens on Midwest Mutual with the difficulty picker
   (recommending Story for a first run), and Day 1 starts exactly as it does today.

## 6. Interaction model

### 6.1 The mentor panel and the spotlight

- A **mentor panel** docks at the bottom right (bottom sheet at phone width): Ruth's portrait, the current step's
  text, the step counter ("Beat T3 · 2/5"), and buttons: **Hint**, **Next** (for read-only steps) and **Skip step**.
- The **spotlight** dims the page and outlines the target: a tab, a section header, a report row, a field, a button.
  Targets are named anchors (`data-tour="console.pi-heatmap"`, `reports.wlmgl.row:ONLHI#1`), so the content says what
  to point at and the UI finds it. The spotlight opens the tab and expands the section first, scrolls the target
  into view and moves keyboard focus to it.
- The spotlight is advisory: the player can click anywhere. Ruth's panel never blocks the page.
- The panel can be minimised; it reappears at the next beat.

### 6.2 Steps

A step is data: `{ id, say, target?, done, hints[], accepts?, onAlt? }`.

- **`done`** is a predicate. Two kinds:
  - *Game-state* predicates over `RunState` (a tool owned, a change planned whose policy satisfies
    `db2AboveItsClients`, a pin of a given metric and relation in the window, an RCA filed). Pure functions in the
    game layer, tested headlessly.
  - *Navigation* predicates (a tab opened, a Codex entry opened, a report interval selected, the test bench run).
    The UI reports them with a no-op game command, `TUTOR_NOTE { kind, ref }`, which the game layer records on the
    run's tutorial state and the sim never sees (the same pattern as `reportsOpenedToday`). So navigation shows up in
    the run file, and headless play can drive the whole prologue.
- A step is **done however the player gets there**. If they pin the right row before Ruth asks, the step completes
  as soon as it starts, with a short "you're ahead of me".
- **`accepts`** lists the alternatives (any period with PI > 0.9; STCHI or SYSSTC; any of four CICS fixes), and
  **`onAlt`** gives Ruth's comment per alternative, so a different valid fix is acknowledged with its trade-off,
  never corrected.
- A step whose precondition no longer holds (the player already fixed it in a way the script didn't expect) is
  skipped with a line: "Already done. Good."

### 6.3 The hint ladder

Three rungs, each one click on **Hint**, in the voice of the morning hints (SPEC §11.2):

1. **Nudge**: the question. "What does DDF spend its time waiting on?"
2. **Pointer**: the place. Spotlights the tab or report.
3. **Show me**: the exact row, field or button. For a change, fills the Change Desk **draft** (never submits it).

On the solo day, hints cost nothing but are counted in the shadow-week report card ("solved with 1 hint").
Ruth never makes a change, files an RCA or picks a draft for the player.

### 6.4 Off-script play

The prologue is a sandbox inside a script. The player may make any change at any time after Monday (the clone is
theirs to break). Rules:

- A change that would defuse a later lesson (capping DEVT on Tuesday before Wednesday's cooling fault) is allowed;
  the later lesson's steps are written to still work ("you already capped dev, so look at what's left").
- A change that breaks the replay badly (an absurd policy) triggers Ruth's "want me to put it back?" offer, which
  reverts to the start-of-day state of the chapter (a reload, not an undo of the sim; §11.4).
- Changes are never blocked by the script, except on Shadow Mon, when the Change Desk's submit buttons say "Monday we
  watch" (the draft still works, so the player can explore the forms).

### 6.5 Leaving, skipping, replaying

- First launch offers **Shadow week with Ruth (recommended, ~70 min)** or **Go straight to Day 1**. Both are on the
  new-run screen from then on.
- **Skip chapter** at any beat jumps to the next chapter's 06:00. **Leave the prologue** goes to the new-run screen.
- After finishing (or skipping) once, a chapter list allows replaying any chapter from its 06:00.
- Chapter start states are produced by replaying a reference command log (§11.6), not stored save blobs, so they
  stay correct as the sim changes.

## 7. Teaching root-cause analysis

The RCA is where diagnosis is scored, so it gets four passes with less help each time:

| RCA | Incident | What Ruth does | What it teaches |
|---|---|---|---|
| #1 Tue | MOBILE during the campaign, Db2 starved | Gives each answer and why; walks the reply | The form; mechanism vs trigger; pins; proof recipes; points; accepted alternatives |
| #2 Wed | CPU incident during the cooling fault | Asks the question per field; one refile | Capacity vs priority; that the accepted set can hold both; trust per incident in a group |
| #3 Thu | Retail on PROD2 during CICS SOS | Comments after filing; plants an irrelevant pin | Subsystem records as evidence; the ruling-out predicate (QR wait low); pin relevance |
| #4 Fri | The runaway query | Nothing until the reply | Doing it alone |
| (#5 Fri night) | Batch miss, if it happens | Optional; shows SMF 30 pins | Batch incidents exist and have their own evidence |

Two scoring rules are explained explicitly because players otherwise discover them by surprise: **one RCA per root
cause** (incidents of the same card group together), and **a pin outside its relation scores nothing** (another
class's CPU delay is not evidence about this class; only its APPL share is).

The prologue's RCAs are scored by the real engine (the same truth, accepted sets, proof recipes and reply wording as
any run). Only the rewards are shadow rewards.

## 8. Economy in the prologue

### 8.1 What's real and what's shadow

| Resource | In the prologue |
|---|---|
| Engineer-hours | Real (8 a day, the usual costs). Each day's script is budgeted to leave at least 2 hours spare (§11.5 tests it). |
| Trust and facets | Shown and moving as usual, labelled **shadow**. Cannot end the run; a floor at 20 keeps the UI sane. Not carried over. |
| Insight | Real, earned as usual (reports read, RCAs). Spent on Tuesday–Thursday tools. Not carried over. |
| Opex, capex, MLC | Real figures, shadow budget. The Finance lesson reads them; nothing is billed against the run. |
| Fatigue | Real, so Friday's night page shows it. Reset on Day 1. |
| Draft picks | Real effects for the rest of the shadow week. Not carried over. |
| Change failure risk | Zero, except for any single scripted failure (§14 Q5). |

### 8.2 Loaned tools

Tools the player can't afford yet are **loaned** by Ruth for the lesson that needs them (SMF 110 and CF/DASD on
Thursday if the player is short of Insight; tier 3–4 on Friday). A loan is a tool owned with an expiry, using the
draft's existing vendor-trial mechanism (`TOOL_TRIAL`). The tool tree shows "on loan from Ruth until Friday night".
This keeps the fog-of-war spine of the main game intact: on Monday, the player starts with 15 Insight and nothing
bought, as today.

### 8.3 What carries into the main game

Only things that don't change the balance:
- Ruth's notebook in the Codex, and the Codex entries opened during the prologue.
- A career line ("completed the shadow week"); no XP, so the career curve is unchanged (§14 Q3).
- The viewer preference that the prologue is done, so the day-1 corner tutorial isn't shown again (§14 Q4).

## 9. Coverage

Every tab, the sections in it, and every modelled subsystem, against the beats that introduce them. A content test
checks this table against the step targets (§11.5), so coverage cannot silently drop.

| Tab / overlay | Sections and views | Introduced |
|---|---|---|
| Briefing | inbox, stakeholder moods, hours, calendar, starting perk (Day 1 only, mentioned) | M1 |
| Ops Console | clock and speed, LPAR busy, SLA tickers, PI heat map, operations log, incidents, batch window, R4HA gauge, AIOps hypothesis | M2–M4, W3, F2 |
| Monitor III | SYSSUM, SYSINFO, DELAY, PROCU, SYSWKM, WFEX, ENCLAVE, CPC, WLM activity log, BREF/FREF | T2–T3, W2, H2, F2 (ENCLAVE in the runaway's hint ladder; WLM activity log in T5) |
| RMF Reports | Workload Activity, WLMGL detail, CPU Activity, Partition Data, CF Activity, DASD Activity, interval selector | M5, W2, H3 (CPU Activity in W4's accepted views) |
| SMF analytics | Db2 101, Db2 statistics, Db2 blockers, CICS 110 and region storage, SMF 30 batch, CPU MF 113 | H2–H3, F4 (Db2 blockers named in H3) |
| Evidence board | pins, relations, judged verdicts | T3, T6, H4 |
| Change Desk › WLM | service classes, classification rules and test bench, report classes, policies and daily schedule | T3–T4 (report classes and policy schedule named in T4 and F1) |
| Change Desk › LPARs & hardware | HMC image profile, polarity preview, capping, hardware orders, On/Off CoD | W2, W4 |
| Change Desk › Systems, CF & I/O | z/OS options (RMF interval), CF and structures, DASD aliases, Db2, MQ, CICS | M5 (named), H2–H3 |
| Change Desk › Batch & operations | event fixes, job restart, routing, initiators, job classes | H2, F2, F4–F5 |
| Change Desk › Projects | multi-day projects | F1 |
| Change Desk › requests | basket, planned vs emergency, results | T4, W1 |
| Finance | budget, bill to date, R4HA, product MSU by hour, bills, SCRT report, TFP (named) | W3, F6 |
| Analytics | Insight, tool tree, overhead, capacity planner, What-if, alerts, automation, AIOps | T1, W1, F1, F5 |
| Codex | entries, CodexHint links, Ruth's notebook | M2, F6 |
| Inbox | messages, forewarnings, Ask around | M1, H1 |
| Review | report card, RCA, draft | M5, T6, W5, H4, F3 |

| Subsystem / model | Introduced |
|---|---|
| WLM goals, importance, PI, periods | M2–M5 |
| WLM classification, policy activation | T3–T4 |
| z/OS dispatcher and CPU delay | T3 |
| Db2 (address spaces, accounting, DBATs) | T3, H3 |
| DDF and enclaves | T3, F2 |
| CICS (regions, MXT, storage, QR) | H2 |
| MQ | H3 |
| Batch / JES2 / initiators / critical path | M4, F4–F5 |
| TSO and the team's goal | F4 |
| PR/SM weights, logical CPs, HiperDispatch | W2 |
| CPC capacity, zIIPs, CoD | W2, W4 |
| Capping, R4HA, MLC, TFP | W3–W4, F6 |
| Coupling facility | H3 |
| DASD, HyperPAV | H3 |
| SMF 113 / LSPR | H3 |
| Measurement overhead | T1 |

## 10. Relationship to existing work

- **The day-1 tutorial** (`src/game/tutorial.ts`, `src/ui/Tutorial.tsx`, SPEC §11.1) teaches F1 in six stages. The
  prologue's Tuesday contains it, using the same `db2AboveItsClients` check. Proposal: keep the corner card only for
  players who skipped the prologue (§14 Q4).
- **P2** proposed one guided Midwest day. This is P2 spread over five days with an empty deck, a mentor and the
  replay framing; its step engine is the same thing P2 described.
- **P3 / M9 simplified mode** planned to reuse P2's step engine for a simplified tutorial. The engine here (§11.2)
  is generic enough for that: a simplified prologue would be another script over the same engine, with bundles in
  place of raw changes.
- **Morning hints** (SPEC §11.2) and the hint ladder share their tone and their rule: point at the report and the
  question, never the answer.

## 11. Technical design

### 11.1 Content

`src/content/prologue/`:
- `game-prologue.ts`: a `GameContent` for the prologue (`defineGame`), Midwest's sim scenario, `events: []` (no
  deck), `story` for the inbox beats, a `prologue` flag, and `maxDays: 5`.
- `schedule.ts`: the **scheduled cards**: `{ card: 'CAMPAIGN', day: 1, at: '11:00', durationHours?, severity? }`.
  The cards are the existing Midwest `EventDef`s, so footprints, announcements, fixes, RCA truth and accepted sets
  work unchanged. Overrides (an announcement for the silent `POWER_CAP`; a fixed duration) are fields on the
  schedule entry, not edits to the card.
- `script.ts`: chapters → beats → steps (§6.2), with mentor text, targets, predicates by id, hint ladders and
  alternatives. All mentor text lives here.
- `tuning.ts`: `// FICTIONAL:` prologue knobs: volume factor for the replay (≈0.9 of day-1 volumes), growth 0, noise
  scale, shadow trust floor, loan list.

Content types gain `GameContent.scheduledCards?` and `GameContent.prologue?`. Absent on the three scenarios, so their
saved states and hashes don't change.

### 11.2 Game layer

- **Scheduled cards** start through the same path as drawn cards (the daily draw in the game layer): a run with
  `scheduledCards` draws nothing and starts each entry at its tick. The sim sees ordinary commands at fixed ticks,
  so determinism holds (CLAUDE.md rule 2).
- **Tutorial state** on `RunState`: `tutor: { chapter, beat, step, done: string[], hintsUsed, refiles, notes }`,
  plain serialisable data. `TUTOR_NOTE` and `TUTOR_ACK` (Next / Skip) are game commands with no sim effect.
- **Predicates** live in `src/game/tutor/predicates.ts` as named pure functions over `RunState` (plus the recorded
  notes). Content names them by id; no closures in content.
- **The refile rule** (one refile per prologue RCA) and the **trust floor** are game-layer checks gated on
  `content.prologue`, so a normal run can never reach them.

### 11.3 Pausing at a beat

Beats are **stop ticks**. `advance` already chunks at boundaries for history and Monitor III; the next beat's tick
becomes one more boundary, and reaching it sets the speed to 0 and raises the beat. Speed isn't sim state, so this
changes no hash. Beats triggered by a condition (an incident opening, a card ending) are checked at the hour or
chunk boundary where the game already evaluates incidents, which is coarse but deterministic; the script's
condition beats name the earliest tick they may fire.

### 11.4 UI

- `src/ui/tutor/`: `MentorPanel.tsx`, `Spotlight.tsx`, `anchors.ts` (the target registry). `data-tour` anchors added
  to the components the script targets, one commit per area, no behaviour change.
- The spotlight opens tabs and Change Desk sections through the existing tab state and `Section` ids.
- Phone width: the panel is a bottom sheet; the spotlight scrolls the target into view above it; nothing needs
  horizontal scroll.
- Accessibility: the outline is not colour alone (a thick outline plus a label); focus moves to the target; the
  panel is an ARIA live region; no new single-key shortcuts (1–5 and Space are taken).
- "Put it back" (§6.4) reloads the chapter's start state.

### 11.5 Validation the content depends on

The script makes claims ("an incident opens around 11:40", "the expected mechanism is X"), and the sim decides
whether they're true. So:

- **Do-nothing playthrough** (every navigation step acked, no changes): each scripted incident opens inside its
  beat's window, and the truth engine's primary and accepted answers match the script's `expect` for that RCA.
- **Reference playthrough** (the script's suggested fix at every step): every step completes; each day leaves ≥ 2
  engineer-hours; the later lessons still have their incidents after the earlier fixes.
- **Alternative playthroughs**, one per `accepts` alternative: the next lessons still fire.
- **Coverage test**: every tab and section in §9 is the target of at least one step.
- **Anchor test**: every step target names an anchor that exists in the UI registry.
- The prologue's reference run joins the cross-report invariants (`tests/sim/report-invariants.test.ts`) as an extra
  fixture.
- The prologue is not in `SCENARIOS`, so bots, sweeps, goldens and the balance gate are unchanged.

Tuning order: first set the replay volume and card severities until the do-nothing run produces the intended
incidents with the intended truth; then write Ruth's RCA dialogue against that truth. Never the other way round.

### 11.6 Headless

- `npm run play -- runs/p.json new --prologue` starts the prologue; `play tutor` prints the current step and its
  target; `play tutor ack | note <kind> <ref> | hint` drive it. So the existing persona agents can playtest it, and
  a new persona brief ("intern: knows JCL and SDSF, never owned a WLM policy") can report confusion step by step.
- The reference command log in `tests/fixtures/prologue/` is what produces the chapter start states.

## 12. Realism

Every statement Ruth makes about z/OS behaviour is a statement about z/OS behaviour (CLAUDE.md realism policy). Most
of what she says restates mechanics already modelled and cited in SPEC (§5, §8, §9, §10) and `docs/research.md`;
those lines cite the same source in `script.ts` comments. A new claim (a phrasing that goes beyond the model, e.g.
"many shops put Db2's address spaces in SYSSTC") is checked with the `zos-docs` skill before it ships, or marked
unverified and softened. Each lesson's Codex links must point at entries with their own sources. The "replay plex"
is a game fiction; a real QA sysplex doesn't replay production traffic this faithfully, and Ruth's text should not
claim that it does.

## 13. Delivery plan (proposed BACKLOG list `prologue`)

To be scoped into BACKLOG.md entries once the user approves the direction:

1. **PRO-01 engine**: `scheduledCards`, `prologue` content flag, tutorial state on `RunState`, `TUTOR_NOTE`/`TUTOR_ACK`,
   stop ticks, predicates, headless `play tutor`. Game layer only; goldens unchanged (`npm run compare` against
   `dev`).
2. **PRO-02 UI shell**: mentor panel, spotlight, anchor registry, new-run choice. No content beyond a test chapter.
3. **PRO-03 Shadow Mon + Tue**: content, tuning, the do-nothing / reference tests, Codex notebook pages.
4. **PRO-04 Shadow Wed + Thu**.
5. **PRO-05 Shadow Fri + handover**, loaned tools, transition to Day 1, retiring or gating the day-1 corner card.
6. **PRO-06 playtests**: the intern persona agent through all five chapters; one human playtest
   (`docs/playtests/`); fixes.

Each content PR runs the §11.5 tests; none touches the sim.

## 14. Open questions for the user

1. **Audience reading.** I read "intermediate engineer with zero maintenance experience" as zero *mainframe*
   experience. Is that right, or did you mean someone with mainframe experience but none in performance and capacity?
2. **Which flaws to teach.** The draft teaches only F1 (as today's tutorial does), shows F8–F11 without naming them,
   and keeps the handover's to-do list vague on Normal and Hard. Teach more (e.g. F3 via Friday's runaway, F7 via
   PROCU) or fewer?
3. **Rewards.** No XP, nothing balance-affecting, only the notebook and a career line. Or a small XP award, or a
   cosmetic?
4. **The day-1 corner tutorial.** Keep it for players who skipped the prologue, or remove it once the prologue ships?
5. **A scripted change failure.** Should one change in the week fail on purpose (e.g. Wednesday's HMC change), to
   teach change risk and the Requests results? It's honest about the game; it may feel unfair in a tutorial.
6. **Refile.** The prologue allows one refile per RCA so the player sees a correct reply. A normal run never allows
   it. Acceptable as a prologue-only rule?
7. **Length.** Five days, about 70 minutes. A three-day version (merging Mon into Tue and Thu into Fri) would take
   about 45 minutes and lose the "watch a normal day first" lesson and some of the subsystem tour.
8. **The replay plex.** The QA-clone framing explains the scripted events and the clean Day 1. The alternative is the
   prologue on production itself, with Day 1 carrying the player's changes, which breaks "Day 1 as today".
9. **Month-end bill.** Should the month that closes on Shadow Friday produce a visible (shadow) bill in the handover,
   computed from the five replayed days plus the rest of the month at its average?
