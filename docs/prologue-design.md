# The Shadow Week: a guided prologue (design)

Status: **designed; scoped into BACKLOG list `prologue`** (written 2026-11-25, rewritten the same day for the real-handover framing). It
supersedes PROGRESS.md proposal P2 ("full-day guided tutorial") and keeps P2's rules: steps are content data, nothing
is fixed automatically, every step accepts more than one valid fix, and the scripted events never leak into normal
runs. Nothing here is a task until it is scoped into BACKLOG.md entries (§13; now BACKLOG list `prologue`). The user's
decisions are in §14.

**Hard requirements (user, 2026-11-25):**
- The prologue is **optional**. It must not change goldens, bench hashes, bots or sweeps.
- It is its own scenario id, `midwest-prologue` (user permission 2026-11-25), on the **Midwest Mutual plant exactly as
  it is**: same CPC, LPARs, workloads and policy, with no new plant setup. The differences are game content only:
  - an empty deck and scheduled cards;
  - the script and the mentor;
  - the dates (the last week of the prior month);
  - one prologue-only WLM flaw;
  - a seeded month-to-date bill.

## 1. Summary

The week before Day 1 of a normal Midwest Mutual run, the player sits next to **Ruth Abernathy**, the capacity and
performance lead, for her last five days before she retires. It is the real production handover, in the last week of
the prior month: Monday the 26th to Friday the 30th, a month-end.

- **Each day introduces one area of the craft.** At fixed times something happens, the game **pauses**, and Ruth walks
  the player through it: where to look, what to pin, which change to make, how the root-cause analysis is filed and
  how it is scored.
- **There is no random deck.** On a single run the player can't tell the difference.
- **Help gets thinner as the week goes on.** Monday is a guided tour; Friday's incident is the player's own, with hints
  only when asked.
- **Ruth leaves one flaw for the player to find and fix:** a WLM resource group cap that someone put on the DDF class
  months ago and never took out. It isn't in the main game's starting state, so fixing it in the prologue is
  consistent with Day 1.
- **Temporary changes get taken back out.** Every other change the week calls for is a temporary one, and Ruth makes
  the player undo it when the problem has passed. That is the same lesson the leftover cap teaches.
- **The month closes on Friday night** and the player sees its software bill. The 1st–25th come from plausible
  seeded figures; the week they played decides whether the month's peak moves.

By Friday night the player has opened every tab, at least one view in every section of each, and has seen every
subsystem the game models at least once. Then Ruth hands over, and **Day 1 starts as it does today**: Monday the 3rd,
the same state, the same seed choice and difficulty picker. The day-1 corner tutorial (F1) is still there, and
nothing carries over that changes the balance.

Target length: about 70 minutes, in five chapters of 10–15 minutes. Each chapter can be resumed, replayed or
skipped.

## 2. Who it is for

Two players, and anyone between them (user, 2026-11-25):

- **The intern** with 1–2 years on the mainframe: knows TSO/ISPF, JCL, SDSF and what a CICS region is, has probably
  read an RMF report without knowing what to look for, has never owned a WLM policy or a capacity bill.
- **The engineer from other platforms** with no mainframe experience: knows queueing, CPU saturation, p95
  latency, dashboards and incident reviews from other software and platforms, but not service classes, PR/SM, R4HA or
  why a server address space's importance matters.

So the prologue never explains what a CPU or a percentile is, and never assumes the player knows what a velocity
goal, a logical CP, a resource group or an EDSA is. Each z/OS term is introduced once, in plain words, with a Codex
link, at the moment it first matters, and not before.

**What the player should be able to do at the end:**

1. Read the Ops Console and say which business service is hurting and since when.
2. Go from "service X is slow" to "class Y is waiting for resource Z on system W", in Monitor III or RMF.
3. Tell a full machine from work standing in the way of other work (CPU_CAPACITY vs CPU_PRIORITY), both from work
   held back by a cap, and all three from a subsystem limit (threads, storage, I/O, CF).
4. Make a change through the Change Desk, and know when it takes effect, what it costs (hours, trust, risk), that it
   can fail, and when to take it back out.
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

> "Every temporary change is permanent unless somebody takes it out. That cap you found on Tuesday was somebody's
> temporary change."

### 3.2 A real handover

This is production, and Ruth says so: "I retire Friday. This week you sit next to me. Next Monday it's yours." The
game doesn't explain why things happen when they do; a bank's week is busy, and the player has no second run to
compare it with.

Four things make it hold together with Day 1:

- **The prologue-only flaw** (§3.4) is fixed during the week, so production on Monday doesn't have it. That is the
  Day 1 state as today.
- **Temporary fixes are undone in the script.** Each lesson whose fix is temporary (a cap during a cooling fault, a
  routing change during a CICS leak) has a follow-up beat when the problem is over: Ruth asks the player to put it
  back, and the step checks that they did (§5, §6.4).
- **Anything else is backed out at handover.** If the player made a change the script didn't ask for and it is still
  in on Friday night, Ruth's handover note lists it by name: "These are still in from this week. They're under my
  name and I won't be here to own them, so operations are backing them out tonight. If they were right, take them to
  the board on Monday under yours." The list is computed from the run's state against the Day 1 state (§11.2), so it
  is always accurate.
- **Story's starting fixes.** On Story, Day 1 starts with F7, F8 and F11 already fixed, announced by the previous
  team's inbox message (`content/game-midwest.ts` `startingFixes`; SPEC §11.2). The difficulty is picked after the
  prologue, so Ruth's text has to hold either way:
  - she never claims F7, F8 or F11 is left undone. Her M6 line about the RMF interval is "I've asked for that to go
    to 15", and her handover's "never got round to" list draws only on flaws no difficulty fixes at the start (F6,
    F9);
  - on Story, the previous team's message then reads as Ruth's team finishing her asks over the weekend. On Normal
    and Hard it doesn't arrive, and nothing Ruth said promised it would.

  Day 1's content doesn't change.
- **Trust, Insight, hours, fatigue and draft picks** reset to their Day 1 values without comment (user, 2026-11-25:
  the player won't notice or care). Tools are the one reset with a story, because the player bought them: they ran on
  Ruth's cost centre, which closes with the month (§8.2).

Nothing has to be relearned on Monday: every name on screen (PLEXP1, PROD1, PROD2, DEVT, SYSP, CF01, CF02) is the
main game's, and the only visible difference during the week is the date and a "Shadow week" badge in the top bar.

### 3.3 The calendar

Under the sim's 30-day months, Day 1 of every run is Monday the 3rd (`src/sim/core/clock.ts`). The shadow week is the
Monday to Friday before it:

| Played day | Date | Calendar effects (existing model) |
|---|---|---|
| Mon | 26th | ordinary weekday |
| Tue | 27th | ordinary weekday |
| Wed | 28th | ordinary weekday |
| Thu | 29th | month-end traffic multipliers and month-end batch volumes (`dayOfMonth ≥ 29`) |
| Fri | 30th | month-end; the month closes at midnight, so Friday's night writes the bill |
| (Sat 1st) | Friday's night only | Friday's played day runs to 06:00 on Saturday the 1st, so from 00:00 the payday multiplier and the weekend flag apply (`arrivals.ts`), including F5's ~01:40 abend; the rest of Saturday and Sunday the 2nd are not played |

The top bar shows the date ("Mon 26 · Shadow week") instead of "Day N". Day 1 follows, as today.

### 3.4 The flaw Ruth leaves for the player

**DDFLIMIT: a forgotten resource group on DDFPRD.** Last quarter, during a Db2 migration, someone capped the DDF
service class with a resource group "to stop DDF swamping the new member", and never removed it. DDFPRD holds the
MOBILE work. The cap is in the starting policy of the prologue only: the prologue's starting commands activate
BASEPOL plus this group (§11.1). BASEPOL, the policy the main game starts with, has no resource groups, so removing
DDFLIMIT during the week produces exactly the Day 1 policy.

| | |
|---|---|
| Mechanics | Existing resource group model (SPEC §5.5.6): the maximum is always enforced and capped work sleeps; WLM capping shows as delay with RG-Cap as the primary reason in Monitor III DELAY, and as CAP delay in WLMGL. |
| Harmless-ish on Monday | The maximum is tuned so Monday's normal mobile peak just fits: DDFPRD runs warm (PI near 1) around 12:30 and 20:30, with some CAP delay, and no SLA breaks. Ruth notices the warm row on Monday and says "we'll look at that tomorrow". |
| Harmful on Tuesday | The forewarned `CAMPAIGN` card doubles mobile traffic. DDFPRD hits the maximum, MOBILE breaks its SLA, and PROD2 still has spare CPU. |
| Clues | Monitor III DELAY: DDFPRD delayed, primary reason RG-Cap. SYSINFO or CPC: PROD2 not full. WLMGL: CAP delay on DDFPRD. Change Desk › WLM › Resource groups: DDFLIMIT and its member. |
| Fixes | Remove DDFPRD from the group or delete the group (the real fix, and the Day 1 state); raise the maximum (a stopgap, accepted, with Wednesday's briefing asking the player to finish the job); or ride it out and make the removal in Wednesday's briefing (a normal change, at 06:00 that day). |
| Trade-off | Without the cap, a runaway DDF query can take more CPU (which Friday shows). Ruth: "Caps are a fine tool. A cap nobody remembers isn't." |

It was chosen over the alternatives because:
- its clue is unusually legible for a first diagnosis: RG-Cap is named in a column, and the machine visibly has room;
- its fix exercises the full WLM edit → install → activate path;
- it sets up Wednesday's contrast between a WLM cap and an LPAR cap;
- it doesn't spoil a main-game flaw. An MQ class problem would mirror F1 too closely; a new app landing in SYSOTHER
  overlaps the booking go-live card. The cap's story doesn't mention ad-hoc queries; F3 is shown on Friday (the
  runaway) but not named, as with the other main-game flaws (§14 decision 2).

## 4. Structure at a glance

| Chapter | Theme | Scripted event (card) | Help level | New tabs and overlays | Subsystems met |
|---|---|---|---|---|---|
| **Mon 26** "Look before you touch" | Reading the console; goals and PI; the report card; the first RMF report | none (a normal day; DDFPRD runs warm) | tour | Briefing, Ops Console, Codex, Inbox, report card, RMF Reports | WLM (service classes, PI), batch window |
| **Tue 27** "Who's waiting, and for what" | Monitor III, delays, pins, resource groups, the change board, RCA #1 | marketing campaign on mobile (`CAMPAIGN`, forewarned Monday) running into DDFLIMIT | guided | Analytics, Monitor III, Evidence board, Change Desk › WLM, review › RCA, draft | WLM resource groups, DDF, Db2, z/OS dispatcher |
| **Wed 28** "The box" | PR/SM, weights and polarity, capacity vs priority, LPAR capping, R4HA, the bill; a failed change; undoing a temporary fix | cooling fault (`POWER_CAP`) | assisted | Partition Data, Monitor III CPC, Change Desk › LPARs & hardware, Finance, Requests results | PR/SM, HiperDispatch, CPC capacity, zIIP pool, MLC |
| **Thu 29** "Inside the subsystems" | SMF detail, thread and storage limits, Ask around, what "normal" looks like for CF and DASD | CICS short on storage on PROD2 (`CICS_SOS`) | prompted | SMF analytics (CICS 110, Db2 101/statistics), CF and DASD Activity, Change Desk › Systems, CF & I/O, Inbox › Ask around | CICS, Db2, MQ, CF, DASD |
| **Fri 30** "Nights and the long game" | A solo RCA, emergency vs planned, batch and the critical path, planning tools, the month's bill, handover | runaway ad-hoc query (`RUNAWAY`) by day; a critical job abend (`JOB_ABEND`) at month-end night | solo | Change Desk › Batch & operations, › Projects, Analytics tier 3–4, SMF 30 batch, Finance › Bills | Batch/JES2, initiators, TSO, automation |

One scripted incident per day keeps each day about one idea. Tours of the other views happen in the quiet hours
around it.

### 4.1 Pacing

- Between beats the day runs at 8× by default, and a **Skip to next beat** button jumps there (a stop tick, §11.3).
  A day at 8× is about 75 seconds of wall time, so time is spent in the lessons, not waiting.
- A beat pauses the clock. While paused, the whole UI works: the player can wander anywhere, and Ruth waits.
- About 3–6 beats a day, each 1–6 steps. A step is one instruction and one thing to do.
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
whichever the player picks. Beats marked **(undo)** are the follow-ups that take a temporary fix back out.

### 5.1 Mon 26: "Look before you touch"

Goal: the player can read the console and one RMF report, and knows the day's rhythm (briefing → live day → review).
The Change Desk can't submit today ("Monday we watch"); every other tab is open.

**Beat M1, 06:00, briefing.** Ruth introduces herself and the week. Steps:
1. The briefing:
   - inbox messages;
   - stakeholder moods: the trust facets (Retail, Cards, Digital, Finance, Regulator) and why each cares about
     different things;
   - engineer-hours: 8 a day ("the team's time is the budget you'll run out of first");
   - the calendar: "Thursday and Friday are month-end. Friday night the month closes."
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
   if none is, Ruth uses the warmest row and says "green isn't the same as comfortable".
2. "Is anyone outside this room unhappy?" The player checks the SLA tickers: all green. Lesson: **a class missing its
   goal is not yet an incident; an SLA breach is.**

**Beat M4, 12:40, the lunchtime mobile peak.** DDFPRD runs warm against DDFLIMIT. One step: Ruth points at the row.
"That one's been warm at lunch for months. Nobody's complained, so nobody's looked. We'll look tomorrow." (The flaw's
day-one symptom, planted per SPEC §13.3.)

**Beat M5, 18:00, the batch window.** Steps:
1. The batch window panel: the critical path, the 06:00 deadline, the projected finish. "This is what gets you
   phoned at three in the morning."
2. Which business owns it (the Regulator, and Retail on a miss). Then let the night run.

**Beat M6, review.** Steps:
1. The report card: each service's attainment, the trust deltas, the MLC tracker. No incidents today, so no RCA: "a
   quiet day is the best kind".
2. RMF Reports › Workload Activity. "Postprocessor reports only cover intervals that have ended. That's why you
   read them in the evening, until you have something better." Open it.
3. WLMGL detail: find ONLHI period 1; read its goal, its actual, its PI and its using and delay samples. Spotlighted
   field by field. Step done when the player has opened WLMGL and selected the 10:30 interval.
4. The interval selector: the reports are at 30 minutes ("I've asked for that to go to 15. We'll see if it happens
   before I leave."). This is flaw F11. Ruth does not fix it, and her line holds either way on Day 1: on Story the
   previous team's message says it was done (§3.2), otherwise it wasn't.
5. Insight: the top bar counter went up when the reports were opened. "Reading pays. You'll spend it tomorrow."

### 5.2 Tue 27: "Who's waiting, and for what"

Goal: the player can find a delay in Monitor III, pin evidence, make a WLM change through the change board, and file
a first RCA, with every field explained.

**Beat T1, 06:00, briefing.**
1. Analytics tab: the tool tree, Insight, and the price of measurement ("monitors burn CPU too"). Ruth: "My cost
   centre has a little left this month. You pick what we turn on." Turn on **RMF Monitor III** with Insight. Step
   done when the tool is owned.
2. Engineer-hours check: about 8 today; Ruth estimates the day's work at 3–4 hours.

**Beat T2, 08:30, the Monitor III tour.** Quiet morning, so the views show normal. Steps:
1. SYSSUM: goals vs actuals, live.
2. SYSINFO: the LPAR view and the z/OS view of CPU.
3. DELAY: using, delayed, unknown. "Unknown is mostly time inside Db2, CICS, the CF. RMF can't see it. That's normal
   when the PI is fine."
4. BREF/FREF: step back one interval and forward again. "Monitor III keeps history. You can look at what happened
   ten minutes ago, which is usually when it started."

**Beat T3, ~11:40, the campaign hits the cap.** The scripted `CAMPAIGN` card started at 11:00. Mobile traffic doubles;
DDFPRD hits DDFLIMIT's maximum; MOBILE's response time grows, its SLA ticker turns, and an incident opens. Steps:
1. Console: the incident panel names MOBILE. "Who's hurting? Since when?"
2. Monitor III SYSSUM: DDFPRD period 1 is red.
3. SYSINFO for PROD2: the machine has room. "So the work is slow and the machine isn't full. Something is holding it
   back."
4. DELAY for DDFPRD: delayed, with RG-Cap as the primary reason. Codex: **resource groups**. "WLM is putting DDF to
   sleep on purpose. Somebody told it to."
5. Change Desk › WLM › Resource groups: DDFLIMIT, its maximum, and DDFPRD as its member. Ruth tells the story of the
   migration cap. "Every temporary change is permanent unless somebody takes it out."
6. Pin two pieces of evidence, each spotlighted: DDFPRD's delay row (the cap delay on the hurt work), and PROD2's
   busy (the machine wasn't full). Ruth explains a pin: "a reading, at a time, on a row. You'll attach these to the
   RCA." The Evidence board shows them.

**Beat T4, right after T3, the change.** Still paused.
1. While in the WLM section: **classification rules** decide which class work lands in. The **test bench**: "where
   does a TELLER transaction go?" Step done when the test bench has been run once. (A neutral example, so no
   main-game flaw is shown.)
2. The fix. Remove DDFPRD from DDFLIMIT, or delete the group (both the real fix); or raise the maximum (a stopgap).
   All accepted. Ruth: "Raising it gets you through lunch. Taking it out is the fix."
3. **When it happens, and what it costs.** Ruth explains the two ways in:
   - install and activate now, an **emergency change**: it costs trust (×1 while an incident is active, ×3
     otherwise) and carries a small failure risk;
   - ride it out and make the change in tomorrow's briefing, a **normal change** that applies at 06:00 Wednesday, at
     no trust cost. During the live day every change without a lead time is an emergency change
     (`src/game/catalog.ts`); planned changes are made only in the briefing.

   Both are accepted. "In my day, we rode it out and took it to the board. You decide."
4. Either Validate → Install → Activate now, or **Ride it out** (a `TUTOR_ACK` choice). Step done when an emergency
   change is applied whose installed policy leaves DDFPRD uncapped, or raises DDFLIMIT's maximum above the campaign's
   demand (predicate `ddfCapRelieved`), or when the player chose to ride it out. In that case W1 carries the change.

**Beat T5, ~13:00 (or when the campaign ends).**
- If the change went in live: Ruth shows the PI heat map recovering, and DELAY with no RG-Cap left on DDFPRD.
- If the player rode it out: the campaign ends on its own around 13:00. "Tomorrow morning you make the change in the
  briefing, and the morning after you check it worked. Always check."

**Beat T6, review: RCA #1, fully guided.** This is the scoring lesson. Steps:
1. The RCA form: the affected service and window (prefilled), and what an incident is (an SLA breach episode).
2. **Mechanism**: the resource × the way it failed. Ruth gives it and says why. **Trigger**: what started it. Ruth
   gives it and says why.
   - The expected answers are whatever the truth engine produces for the scripted incident (§11.5). The likely
     answer is CAPPING (a period of the hurt work showed CAP delay), with the campaign or the policy as the trigger.
   - Ruth's dialogue is written against that truth and its full accepted set. When the player picks an accepted
     alternative, Ruth says "that's also defensible, because …", using the accepted-answer reason line.
3. **Evidence**: attach the two pins. Ruth explains the proof:
   - it is a recipe of two predicates: the symptom on the right subject, then the reading that rules out the
     look-alike (here: the machine had room, so it wasn't capacity);
   - a complete recipe for the mechanism earns full evidence points, and half a recipe earns a little;
   - a complete recipe for the trigger as well makes the evidence **strong** (+5 Insight).
4. **Remediation**: link the resource group change.
5. File it. Ruth walks the reply line by line:
   - "accepted" vs "not accepted" for the answer;
   - "proven" vs "your pins did not prove it" for the evidence;
   - each pin counted, or the reason it didn't count.

   Then the scoring summary:
   - 3 points for an accepted mechanism, 2 for an accepted trigger, evidence on top;
   - a correct RCA earns trust and Insight; a wrong one costs a little trust; skipping costs nothing but the reward;
   - one RCA covers every incident with the same cause.
6. The **draft**: pick one of three opportunities. Ruth: "Every evening you get to choose one." The *A mentor* perk is
   left out of prologue drafts (Ruth is the mentor).

### 5.3 Wed 28: "The box"

Goal: the player understands that four systems share one machine, how PR/SM divides it, how to tell a full machine
from work in the way, what LPAR capping does and how it differs from Tuesday's WLM cap, what sets the bill, that a
change can fail, and that a temporary fix comes back out.

**Beat W1, 06:00, briefing.**
1. If the player made Tuesday's change live: "Did yesterday's change work?" The Requests results, and the policy now
   active.
2. If the player rode it out: make the change now, in the briefing. It is a normal change that applies at 06:00
   today, at no trust cost. Step done when the planned change satisfies `ddfCapRelieved`.
3. **(undo)** If the player raised DDFLIMIT's maximum instead of removing it: "You raised it. Now take it out
   properly." Step done when a planned change leaves DDFPRD in no resource group (it applies at 06:00 today).
4. Turn on **Partition Data** (Insight from Monday and Tuesday).

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
1. Finance tab: the monthly opex budget, the bill to date (seeded for the 1st–25th, §8.4), the R4HA chart, product MSU
   by hour. "Software is billed on the peak four-hour rolling average of the month, not the average. One bad
   afternoon sets the bill. Look where this month's peak is." (The seeded peak, with its date.)
2. Console's R4HA gauge against the month's peak. "Tuesday's campaign got close."
3. DEVT is uncapped, so its busy hours add to the peak. Ruth: "Dev is everyone's favourite thing to cap. It's also
   the developers' whole day."

**Beat W4, ~12:20, the cooling fault.** The scripted `POWER_CAP` card starts at 12:00. The CPC runs one capacity
setting lower for about six hours, and Facilities' announcement arrives as in the main game. Ruth: "Same machine,
less of it. Now what?" Steps (assisted: Ruth names the report and asks):
1. "Same engines. What changed?" The player finds it in SYSINFO or Partition Data (less MSU per image; a capacity
   adjustment). Either is accepted.
2. "Is the box full, or is someone in the way?" Ruth explains CPU_CAPACITY vs CPU_PRIORITY:
   - if the processor is saturated and nothing displaceable is running, it's capacity;
   - if a less important class is using CPU the hurt work could have had, it's priority.

   The player looks at CPC busy and at what's running at low importance. Ruth accepts either answer if the truth's
   accepted set does (a CPU verdict inside the §10 bands accepts both sides), and explains why the line is blurry.
   Then the contrast with Tuesday: "Yesterday the machine had room and WLM was told to hold DDF back. Today there
   isn't room."
3. Pick a response. Accepted:
   - lower DEVT's weight, or cap it (HMC: initial capping, or a defined capacity);
   - hold discretionary batch;
   - lower TSO's importance;
   - protect importance-1 work.

   Ruth notes what On/Off CoD is and that it's billed daily, and points out that buying capacity for a six-hour fault
   is expensive.
4. **The change fails.** The first change the player submits in this beat fails on purpose (the scripted failure, §14
   decision 5): the Requests results say so, with the reason ("HMC: image profile update rejected; retry"), and
   the hours are spent. Ruth: "Happens. Read why, then submit it again." Step done when a resubmitted change has
   succeeded. If the player's response needs no change (riding it out), the failure moves to Thursday's first change.

**Beat W5, ~18:10, the chiller is fixed (undo).** The card ends and capacity is back. Ruth: "Take your cap off.
Remember Tuesday." Step done when every LPAR profile and the WLM policy are back to their start-of-day values for the
parts the player changed in W4 (DEVT weight, caps, TSO importance, held batch released). Two ways, both accepted:
undo it now, which is an emergency change with no incident open (trust ×3; Ruth says so), or leave it overnight and
undo it in Thursday's briefing (a normal change at 06:00), in which case H1 carries the step. A player who leaves it
in past Thursday's briefing gets the handover back-out line (§3.2) and Ruth's "you'll be the next person's
DDFLIMIT".

**Beat W6, review: RCA #2, assisted.** Ruth asks the questions, the player answers:
1. "Which resource?" The player picks. "What started it?" The player picks.
2. "Which reading shows the machine got smaller?" The player pins from Partition Data or SYSINFO.
3. File. If the answer is not accepted, Ruth explains with the reply's own lines and offers **one refile** (a
   prologue-only rule, §14 decision 6), so the player sees a correct reply too.
4. Ruth points at the trust line: an RCA's trust reward counts once per incident in its group.

### 5.4 Thu 29: "Inside the subsystems" (month-end begins)

Goal: the player knows that RMF shows CPU and delays by class, but the reason inside a subsystem is in the
subsystem's own records; meets each subsystem's view once; learns that a pin has to be about the hurt work.

**Beat H1, 06:00, briefing.**
0. **(undo, carried)** If Wednesday's cooling-fault change is still in, undo it now, a normal change at 06:00 today
   (W5).
1. "Month-end starts today. More traffic, a heavier night."
2. Inbox › **Ask around**: Ruth suggests asking the CICS team whether anything changed recently. It costs a little
   time; the answer arrives later in office hours as one fragment. (Scripted: the reply, around 09:30, mentions a new
   release on PROD2 "using more storage in test".)
3. Turn on **CICS monitoring (SMF 110)** and **CF/DASD reports**. If the player is short of Insight, Ruth turns them
   on anyway ("I'll find the money"). Note their CPU overhead.

**Beat H2, ~10:40, CICS short on storage.** The scripted `CICS_SOS` card starts at 10:00 on the PROD2 AORs. Retail
service slows on PROD2 only. Steps (prompted: Ruth asks, points only on request):
1. "Retail is slow, but only some of it. Where?" Monitor III SYSWKM or WFEX: CICS work queued for a task slot on
   PROD2.
2. "CPU's fine. So what are the tasks waiting for?" SMF › CICS monitoring: MXT wait up on PROD2 only, CPU and QR
   wait normal. The region storage view: EDSA peak at EDSALIM, SOS minutes.
3. Ruth explains in two sentences: a region has a storage limit; when tasks no longer fit, CICS stops starting new
   ones, so they queue for a slot even though MXT would allow more.
4. Fixes, all accepted:
   - recycle the PROD2 AORs: an operations fix, immediate, costs Retail trust, and nothing to undo;
   - raise EDSALIM (Change Desk › Systems › CICS);
   - lower MXT to what storage holds;
   - route CICS work to PROD1 (Routing).

   Ruth prefers the recycle "because it leaves nothing behind". She warns before the player raises MXT: "more slots
   doesn't help when it's storage that's short." If the player raises it anyway, that is allowed, and the day shows it
   doesn't help.

**Beat H3, ~14:10, the CICS team ships a fix (undo).** The card ends: the CICS team has fixed the leak. If the player
raised EDSALIM, changed MXT or moved routing, Ruth asks for it back: "Storage is a budget other regions share, and
routing that nobody remembers is how PROD1 ends up doing PROD2's job for a year." Step done when the CICS settings
and routing are back to their start-of-day values: now, as an emergency change with no incident open (trust ×3), or
in Friday's briefing as a normal change, in which case F1 carries the step. Nothing to do after a recycle.

**Beat H4, ~14:40, the subsystem tour.** No incident. One or two steps each: "learn normal, so you can see
abnormal".
1. SMF › Db2 accounting (101): class 1 elapsed, CPU per transaction against its baseline, class 3 suspensions.
   Db2 statistics: DBAT waits at MAXDBAT.
2. Change Desk › Systems › MQ: the queue managers and queue depth; where MQ's address spaces are classified.
3. RMF › CF Activity: two coupling facilities, sync and async requests. "When a CF is slow, z/OS spins waiting for it,
   so a CF problem can look like a CPU problem." (F8 is visible here; Ruth doesn't name it.)
4. RMF › DASD Activity: response, IOSQ, DISC per LCU; Change Desk › Systems › DASD: HyperPAV aliases per LCU.
5. SMF › CPU MF (113): one sentence on cache misses and why low-polarity engines lose cache. Ruth turns it on for
   the afternoon if the player hasn't bought it.

**Beat H5, review: RCA #3, prompted.** The player fills the form alone.
- Before filing, Ruth suggests adding a DASD pin from H4 ("it was a busy LCU, wasn't it?").
- After filing, the reply shows that pin as **not counted: not about the work**. Ruth explains relevance: a pin counts
  only if it is about the hurt work, its server or its host, in the incident window, and notable. "I set you up.
  Sorry. Everybody pins the scary number once."

### 5.5 Fri 30: "Nights and the long game" (month-end)

Goal: the player handles an incident alone; meets batch, initiators and the night; sees the planning tools and the
month's bill; is handed over.

**Beat F1, 06:00, briefing.**
0. **(undo, carried)** If Thursday's CICS or routing change is still in, undo it now, a normal change at 06:00 today
   (H3).
1. Ruth's licences: Capacity planner, What-if, Alerts, Automation and AIOps are on for today, on her cost centre.
   "Have a look. They go when the month closes."
2. **What-if**: Ruth asks: "If we hadn't taken that cap out on Tuesday, what would today look like?" The player forks
   today with any basket and compares SLA hours, batch end, R4HA peak and the MLC estimate. One engineer-hour.
3. **Capacity planner**: the R4HA forecast with its widening bands. "This is the conversation you'll have with Finance
   in a few weeks."
4. Change Desk › Projects: multi-day improvements (threadsafe CICS, zIIP-enable Java, SQL tuning). Ruth: "These pay
   off in weeks. You'll want one going by your second week." Booking one is optional; Ruth notes it would start on
   Monday under the player's name, and it isn't carried over (it falls under the handover back-out).
5. Alerts: Ruth's own rule, "page me if a critical job abends", is already defined. Fatigue from night pages.

**Beat F2, ~10:15, the runaway (solo).** The scripted `RUNAWAY` card starts at 09:30: one ad-hoc DDF query burns CPU
for hours. Its zIIP-eligible time runs on PROD2's general CPs, because PROD2 has no zIIP online (F7, shown but not
named): PROCU shows it as IIPCP. With DDFLIMIT gone, it can take more; Ruth doesn't point that out unless asked ("caps are a fine
tool; that one was in the wrong place"). Ruth: "This one's yours. I'm getting coffee."
- The hint ladder is available (§6.3).
- AIOps shows its top hypothesis on the incident card, with its confidence. Ruth: "It's right more often than it's
  wrong. That isn't the same as right."
- Accepted fixes:
  - cancel the thread: an operator command that costs hours and Digital trust but no change-board trust, and leaves
    nothing to undo;
  - a WLM change for the ad-hoc work. Ruth: "Good instinct. That's a policy change for the board, not for my last
    day." It is accepted, and it falls under the handover back-out.
- No step tells the player which. The beat completes when the incident closes or the player says they're done.

**Beat F3, review of the day (before the night).** RCA #4, solo. Ruth comments only after the reply.

**Beat F4, 18:00, the month-end night.** Steps:
1. SMF 30 batch (on Ruth's licence): last night's critical path as a Gantt, initiator queue time vs elapsed. "Batch is
   a chain. The chain is as fast as its slowest link and its longest wait for an initiator. And tonight's chain is
   longer: month-end."
2. Change Desk › Batch & operations: job classes and initiators; Routing. Look, don't change.
3. TSO and the team's own goal: "If TSO gets slow, everything we do takes longer." (PT-50.)

**Beat F5, ~01:40, the abend.** The scripted `JOB_ABEND` card: a critical job abends. Ruth's alert pages; the pause is
the page. Steps:
1. Operations log and batch window: which job, how much slack is left.
2. Operations › restart the job. Ruth: "Find out why it abended before it abends again. Tonight, just restart it."
3. Let the night run.
   - If the critical path still misses 06:00, a BATCH incident opens and the final review includes a fifth RCA
     (optional; Ruth shows the SMF 30 pins).
   - If it makes it, Ruth: "No incident is the best RCA."
4. Automation: Ruth shows the rule "if job X abends, restart once" and its cost: it can misfire.

**Beat F6, the month closes.** In the final review (Saturday 06:00, after the month closed at midnight):
1. Finance › Bills: the month's bill. It shows the peak R4HA, the hour that set it, the products, the total against
   the opex budget, and the SCRT-style report.
2. Ruth reads it with the player, from the bill's own data:
   - if the week set the peak: "Tuesday's campaign set this month's bill. Ninety minutes of lunch."
   - if the seeded peak held: "The 12th still holds the peak. Your week didn't move it. That's a good week."
3. "Next month's bill starts Monday. It's yours."

**Beat F7, the handover.**
1. A week report card: the week's score, the RCAs, the changes made and undone.
2. Ruth's **handover note** in the inbox:
   - what she learned, and three habits: look before you touch; check every change the next morning; take your
     temporary changes back out;
   - the **back-out list**: any change still in that isn't in the Day 1 state, by name (§3.2, §11.2), or "Nothing
     left in. Good." when there is none;
   - a short, deliberately vague list of "things I never got round to" ("the reporting granularity is poor": F6;
     "development has more processors than it needs": F9), clearer on Story. It never names F7, F8 or F11, which
     Story fixes at the start (§3.2).
3. The Codex gains **Ruth's notebook**: one page per lesson, in her voice, linking the Codex entries it used. It
   persists across runs.
4. The unlocks (§8.3) are announced: Ruth's terminal theme and Ruth's pager sound.
5. "Production's yours on Monday." The new-run screen opens on Midwest Mutual with the difficulty picker
   (recommending Story for a first run). Day 1, Monday the 3rd, starts exactly as it does today, day-1 corner tutorial
   included.

## 6. Interaction model

### 6.1 The mentor panel and the spotlight

- A **mentor panel** docks at the bottom right (bottom sheet at phone width): Ruth's portrait, the current step's
  text, the step counter ("Beat T3 · 2/6"), and buttons: **Hint**, **Next** (for read-only steps) and **Skip step**.
- The **spotlight** dims the page and outlines the target: a tab, a section header, a report row, a field, a button.
  - Targets are named anchors (`data-tour="console.pi-heatmap"`, `reports.wlmgl.row:ONLHI#1`), so the content says what
    to point at and the UI finds it.
  - The spotlight opens the tab and expands the section first, scrolls the target into view and moves keyboard focus
    to it.
- The spotlight is advisory: the player can click anywhere. Ruth's panel never blocks the page.
- The panel can be minimised; it reappears at the next beat.

### 6.2 Steps

A step is data: `{ id, say, target?, done, hints[], accepts?, onAlt?, precondition? }`.

- **`done`** is a predicate. Two kinds:
  - *Game-state* predicates over `RunState` (a tool owned, a change planned whose policy satisfies `ddfCapRelieved`,
    a profile back to its start-of-day value, a pin of a given metric and relation in the window, an RCA filed).
    Pure functions in the game layer, tested headlessly.
  - *Navigation* predicates (a tab opened, a Codex entry opened, a report interval selected, the test bench run).
    The UI reports them with a no-op game command, `TUTOR_NOTE { kind, ref }`, which the game layer records on the
    run's tutorial state and the sim never sees (the same pattern as `reportsOpenedToday`). So navigation shows up in
    the run file, and headless play can drive the whole prologue.
- A step is **done however the player gets there**. If they pin the right row before Ruth asks, the step completes
  as soon as it starts, with a short "you're ahead of me".
- **`accepts`** lists the alternatives (any period with PI > 0.9; remove, delete or raise the cap; any of four CICS
  fixes), and **`onAlt`** gives Ruth's comment per alternative. A different valid fix is acknowledged with its
  trade-off, never corrected.
- An **(undo)** step's precondition is "the player changed something the lesson's undo covers". With nothing to undo,
  the beat is skipped with a line ("Nothing to put back. That's the nice thing about a recycle.").
- A step whose precondition no longer holds (the player already did it in a way the script didn't expect) is
  skipped with a line: "Already done. Good."

### 6.3 The hint ladder

Three rungs, each one click on **Hint**, in the voice of the morning hints (SPEC §11.2):

1. **Nudge**: the question. "The machine has room. So what's stopping DDF?"
2. **Pointer**: the place. Spotlights the tab or report.
3. **Show me**: the exact row, field or button. For a change, fills the Change Desk **draft** (never submits it).

On the solo day, hints cost nothing but are counted in the week report card ("solved with 1 hint").
Ruth never makes a change, files an RCA or picks a draft for the player.

### 6.4 Off-script play and temporary changes

The player may make any change at any time after Monday. Rules:

- A change that would defuse a later lesson (capping DEVT on Tuesday before Wednesday's cooling fault) is allowed;
  the later lesson's steps are written to still work ("you already capped dev, so look at what's left").
- Every change the script asks for is one of three kinds:
  - the prologue flaw's fix, which matches Day 1;
  - a fix that leaves nothing behind (an operator command, a recycle, a restart);
  - a temporary change with an (undo) beat when its problem ends.
- Anything else still in on Friday night appears in the handover back-out list (§3.2).
- **Timing follows the change model as it is:** during the live day a change without a lead time is an emergency
  change; a normal change is made in the briefing and applies at that day's 06:00. Every step that asks for a change
  accepts both routes, and a step left for the briefing is carried into the next day's first beat.
- A change that breaks the system badly (an absurd policy) triggers Ruth's "want me to put it back?" offer, which
  reverts to the start-of-day state of the chapter (a reload, not an undo of the sim; §11.4).
- Changes are never blocked by the script, except on Monday, when the Change Desk's submit buttons say "Monday we
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
| #1 Tue | MOBILE during the campaign, held by DDFLIMIT | Gives each answer and why; walks the reply | The form; mechanism vs trigger; pins; proof recipes (symptom + ruling out capacity); points; accepted alternatives |
| #2 Wed | CPU incident during the cooling fault | Asks the question per field; one refile | Capacity vs priority; that the accepted set can hold both; trust per incident in a group |
| #3 Thu | Retail on PROD2 during CICS SOS | Comments after filing; plants an irrelevant pin | Subsystem records as evidence; the ruling-out predicate (QR wait low); pin relevance |
| #4 Fri | The runaway query | Nothing until the reply | Doing it alone |
| (#5 Fri night) | Batch miss, if it happens | Optional; shows SMF 30 pins | Batch incidents exist and have their own evidence |

Two scoring rules are explained explicitly, because players otherwise discover them by surprise:
- **one RCA per root cause:** incidents of the same card group together;
- **a pin outside its relation scores nothing:** another class's CPU delay is not evidence about this class; only its
  APPL share is.

The prologue's RCAs are scored by the real engine: the same truth, accepted sets, proof recipes and reply wording as
any run.

## 8. Economy in the prologue

### 8.1 Resources

| Resource | In the prologue |
|---|---|
| Engineer-hours | 8 a day, the usual costs. Each day's script is budgeted to leave at least 2 hours spare (§11.5 tests it). |
| Trust and facets | Move as usual. The run can't be lost (a silent floor). Reset to the Day 1 values without comment. |
| Insight | Earned as usual (reports read, RCAs) and spent on tools Tuesday–Thursday. Reset on Day 1. |
| Opex, capex, MLC | Real figures; the month's bill closes Friday night (§8.4). No loss condition applies. |
| Fatigue | Real, so Friday's night page shows it. Reset on Day 1. |
| Draft picks | Real effects for the rest of the week. Reset on Day 1. |
| Change failure risk | Zero, except the one scripted failure on Wednesday (§5.3 W4). |

### 8.2 Tools: Ruth's cost centre

During the week, the tools run on Ruth's cost centre.
- On Tuesday to Thursday the player chooses what to turn on with Insight, which teaches the tool tree and its price.
- When a lesson needs a tool the player can't afford, Ruth turns it on anyway, using the draft's existing
  vendor-trial mechanism (`TOOL_TRIAL`) as a tool owned with an expiry.
- On Friday the tier 3–4 tools are on for the day.
- The cost centre closes with the month, so everything goes at the handover. On Monday the player starts with 15
  Insight and nothing bought, as today. Ruth's note: "Finance gave you enough for one tool to start. I'd spend it on
  Monitor III."

This keeps the fog-of-war spine of the main game intact.

### 8.3 What carries into the main game

Only things that don't change the balance (user, 2026-11-25):
- **50 career XP**, once, for finishing the prologue: about five played days on Normal. It is enough to show on the
  career line, too small to move the unlock curve.
- **Ruth's terminal**: an amber-phosphor screen theme beside the existing system, dark, light and 3270 themes.
- **Ruth's pager**: an alert sound option beside the existing sounds.
- Ruth's notebook in the Codex, and the Codex entries opened during the prologue.
- The day-1 corner tutorial stays as it is, for everyone (§14 decision 4).

The theme and the sound are viewer preferences (like the existing theme and sound toggles), not run state.

### 8.4 The month's bill

The bill is the existing model: the sim closes the month at midnight on the 30th (`closeMonth`), and Finance › Bills
shows it.
- The prologue's starting cost state is **seeded** with plausible month-to-date figures for the 1st–25th: hourly
  product MSU, a monthly peak R4HA with its date (say the 12th), and MSU-hours. They are FICTIONAL values in
  `content/prologue/`.
- The seeded peak is tuned a little below what Tuesday's campaign afternoon produces when the cap is removed early,
  and a little above a quiet week. So the player's week visibly decides whether the month's peak moves: the lesson
  of W3 and F6.
- The opex budget is the main game's; the seeded month sits under it, so no overrun warning fires from the seed
  alone.

## 9. Coverage

Every tab, the sections in it, and every modelled subsystem, against the beats that introduce them. A content test
checks this table against the step targets (§11.5), so coverage cannot silently drop.

| Tab / overlay | Sections and views | Introduced |
|---|---|---|
| Briefing | inbox, stakeholder moods, hours, calendar, starting perk (Day 1 only, mentioned) | M1 |
| Ops Console | clock and speed, LPAR busy, SLA tickers, PI heat map, operations log, incidents, batch window, R4HA gauge, AIOps hypothesis | M2–M5, W3, F2 |
| Monitor III | SYSSUM, SYSINFO, DELAY, PROCU, SYSWKM, WFEX, ENCLAVE, CPC, WLM activity log, BREF/FREF | T2–T5, W2, H2, F2 (ENCLAVE in the runaway's hint ladder) |
| RMF Reports | Workload Activity, WLMGL detail, CPU Activity, Partition Data, CF Activity, DASD Activity, interval selector | M6, W2, H4 (CPU Activity in W4's accepted views) |
| SMF analytics | Db2 101, Db2 statistics, Db2 blockers, CICS 110 and region storage, SMF 30 batch, CPU MF 113 | H2, H4, F4 (Db2 blockers named in H4) |
| Evidence board | pins, relations, judged verdicts | T3, T6, H5 |
| Change Desk › WLM | service classes, resource groups, classification rules and test bench, report classes, policies and daily schedule | T3–T4 (report classes and policy schedule named in T4 and F1) |
| Change Desk › LPARs & hardware | HMC image profile, polarity preview, capping, hardware orders, On/Off CoD | W2, W4–W5 |
| Change Desk › Systems, CF & I/O | z/OS options (RMF interval), CF and structures, DASD aliases, Db2, MQ, CICS | M6 (named), H2–H4 |
| Change Desk › Batch & operations | event fixes, job restart, routing, initiators, job classes | H2–H3, F2, F4–F5 |
| Change Desk › Projects | multi-day projects | F1 |
| Change Desk › requests | basket, planned vs emergency, results, a failed change | T4, W1, W4 |
| Finance | budget, bill to date, R4HA, product MSU by hour, bills, SCRT report, TFP (named) | W3, F6 |
| Analytics | Insight, tool tree, overhead, capacity planner, What-if, alerts, automation, AIOps | T1, W1, F1, F5 |
| Codex | entries, CodexHint links, Ruth's notebook | M2, T3, F7 |
| Inbox | messages, forewarnings, Ask around, handover note | M1, H1, F7 |
| Review | report card, RCA, draft | M6, T6, W6, H5, F3, F6 |

| Subsystem / model | Introduced |
|---|---|
| WLM goals, importance, PI, periods | M2–M6 |
| WLM resource groups and capping | T3–T5 |
| WLM classification, policy activation | T4 |
| z/OS dispatcher and CPU delay | T3, W4 |
| Db2 (address spaces, accounting, DBATs) | H4 |
| DDF and enclaves | T3, F2 |
| CICS (regions, MXT, storage, QR) | H2–H3 |
| MQ | H4 |
| Batch / JES2 / initiators / critical path | M5, F4–F5 |
| TSO and the team's goal | F4 |
| PR/SM weights, logical CPs, HiperDispatch | W2 |
| CPC capacity, zIIPs, CoD | W2, W4 |
| LPAR capping, R4HA, MLC, TFP | W3–W5, F6 |
| Coupling facility | H4 |
| DASD, HyperPAV | H4 |
| SMF 113 / LSPR | H4 |
| Measurement overhead | T1 |
| Change failure and change hygiene | W4–W5, H3, F7 |

## 10. Relationship to existing work

- **The day-1 tutorial** (`src/game/tutorial.ts`, `src/ui/Tutorial.tsx`, SPEC §11.1) teaches F1 in six stages, and
  stays as it is for every player (§14 decision 4). The prologue teaches a different flaw (§3.4), so the two don't
  overlap: Monday's corner card is the first thing the player does alone on production.
- **P2** proposed one guided Midwest day. This is P2 spread over five days, with an empty deck and a mentor; its step
  engine is the same thing P2 described.
- **P1** (a weekly cost statement) is related: the prologue's bill lesson (W3, F6) uses the existing bill and estimate
  and doesn't depend on P1.
- **P3 / M9 simplified mode** planned to reuse P2's step engine for a simplified tutorial. The engine here (§11.2)
  is generic enough for that: a simplified prologue would be another script over the same engine, with bundles in
  place of raw changes.
- **Morning hints** (SPEC §11.2) and the hint ladder share their tone and their rule: point at the report and the
  question, never the answer.

## 11. Technical design

### 11.1 Content

`src/content/prologue/`:
- `game-prologue.ts`: the `midwest-prologue` scenario.
  - Midwest's sim scenario is reused as is (no copy, no edits) apart from the calendar start (§11.2).
  - Its `GameContent` (`defineGame`) has `events: []` (no deck), `story` for the inbox beats, a `prologue` flag and
    `maxDays: 5`.
  - It is registered in its own `PROLOGUE_SCENARIOS` map, not in `SCENARIOS`, so every tool that iterates `SCENARIOS`
    (goldens, bench, bots, sweeps, the balance gate) never sees it.
- `flaw.ts`: the **starting commands** that install the prologue flaw: an `ACTIVATE_POLICY` of BASEPOL plus the
  DDFLIMIT resource group with DDFPRD as its member. It is applied at run creation, the same way `startingFixes`
  applies per-difficulty commands today. The group's type and maximum are `// FICTIONAL:` tuning values ("Monday's
  mobile peak just fits; the campaign doesn't").
- `schedule.ts`: the **scheduled cards**: `{ card: 'CAMPAIGN', day: 1, at: '11:00', durationHours?, severity? }`.
  - The cards are the existing Midwest `EventDef`s, so footprints, announcements, fixes, RCA truth and accepted sets
    work unchanged.
  - Overrides (a fixed duration, a severity) are fields on the schedule entry, not edits to the card.
- `cost.ts`: the seeded month-to-date cost state for the 1st–25th (§8.4), `// FICTIONAL:`.
- `script.ts`: chapters → beats → steps (§6.2), with mentor text, targets, predicates by id, hint ladders,
  alternatives and the undo scopes. All mentor text lives here.
- `tuning.ts`: `// FICTIONAL:` prologue knobs: the trust floor and the tools Ruth turns on.
  - The plant's workloads, growth and noise stay Midwest's. The lessons are tuned only through the scheduled cards'
    times and severities, and the flaw's maximum.
  - Workload growth compounds over the five days and restarts on Day 1, so prologue traffic is about 1–2 % above Day
    1's. Accepted as invisible.

Content types gain `GameContent.scheduledCards?`, `GameContent.startingCommands?`, `GameContent.startingCost?` and
`GameContent.prologue?`.
- They are absent on the three scenarios, so their saved states and hashes don't change. Every new `RunState` field
  (`tutor`) is absent on non-prologue runs for the same reason (the `defineGame` rule).
- Each PRO PR backs "no behaviour change" with `npm run compare --base origin/dev` and the Midwest and Harbourline
  bench hashes in its body.

### 11.2 Game layer, and the one sim change

- **Calendar start.** `clockAt` hard-wires a run's first Monday to the 3rd of the month (`dayOfMonth: ((calendarDay +
  2) % 30) + 1`).
  - The scenario gains `monthDayAtStart?` (default 3, so every existing run is unchanged). The prologue sets 26.
  - Weekday arithmetic is untouched, so Monday stays Monday.
  - About 18 call sites read `dayOfMonth` or the other calendar fields and need the scenario's value passed
    through. It is mechanical, and it is the only change under `src/sim`. `npm run compare` must show no difference.
  - **As built (PRO-01):** `clockAt(tick, monthDayAtStart = DEFAULT_MONTH_DAY_AT_START)`; `initState` copies a set
    `Scenario.monthDayAtStart` into `SimState.monthDayAtStart` (absent on the default, so saves and hashes are
    unchanged), and every date reader passes the state's value: arrivals and the batch network (`step`), `closeMonth`
    (`tick/control.ts`), the MLC month fraction and TFP switch, entity sizing, and the game's batch-network callers.
  - With 26, Thursday and Friday get the existing month-end multipliers and batch volumes, and the month closes at
    Friday's midnight through the existing `closeMonth`.
- **Scheduled cards** start through the same path as drawn cards (the daily draw in the game layer). A run with
  `scheduledCards` draws nothing and starts each entry at its tick. The sim sees ordinary commands at fixed ticks,
  so determinism holds (CLAUDE.md rule 2).
- **Tutorial state** on `RunState`: `tutor: { chapter, beat, step, done: string[], hintsUsed, refiles, notes,
  undoBase }`, plain serialisable data.
  - `undoBase` records the start-of-beat values of whatever a lesson's undo covers (profiles, policy, CICS settings,
    routing).
  - `TUTOR_NOTE` and `TUTOR_ACK` (Next / Skip) are game commands with no sim effect.
- **Predicates** live in `src/game/tutor/predicates.ts` as named pure functions over `RunState` (plus the recorded
  notes and `undoBase`). Content names them by id; no closures in content.
- **The back-out list** is a pure function: the end-of-prologue configuration (policy, LPAR profiles, subsystem
  settings, routing, initiators, booked projects) against the canonical Day 1 state, one line per difference, in a
  fixed order. Day 1 is a fresh run from the canonical state either way; the list is what makes that honest.
- **Prologue-only rules**, all gated on `content.prologue` so a normal run can never reach them:
  - the refile (one per prologue RCA);
  - the trust floor and the disabled loss conditions;
  - the scripted change failure: the first change in a named beat fails, overriding the failure roll.

### 11.3 Pausing at a beat

Beats are **stop ticks**. `advance` already chunks at boundaries for history and Monitor III; the next beat's tick
becomes one more boundary, and reaching it sets the speed to 0 and raises the beat. Speed isn't sim state, so this
changes no hash.

Beats triggered by a condition (an incident opening, a card ending) are checked at the hour or chunk boundary where
the game already evaluates incidents. That is coarse but deterministic; the script's condition beats name the
earliest tick they may fire.

### 11.4 UI

- `src/ui/tutor/`: `MentorPanel.tsx`, `Spotlight.tsx`, `anchors.ts` (the target registry).
  - `data-tour` anchors are added to the components the script targets, one commit per area, with no behaviour
    change.
  - The spotlight opens tabs and Change Desk sections through the existing tab state and `Section` ids.
- Top bar: the date ("Mon 26 · Shadow week") in place of "Day N / 40" while the prologue runs.
- Phone width: the panel is a bottom sheet; the spotlight scrolls the target into view above it; nothing needs
  horizontal scroll.
- Accessibility:
  - the outline is not colour alone (a thick outline plus a label);
  - focus moves to the target, and the panel is an ARIA live region;
  - no new single-key shortcuts (1–5 and Space are taken).
- "Put it back" (§6.4) reloads the chapter's start state.
- Cosmetics: the amber theme joins `ThemeToggle`'s cycle and `styles.css`'s palettes, and it must pass the existing
  contrast checks. The pager sound joins `sound.ts`. Both are locked until the prologue is finished (a per-viewer
  flag, like the tutorial's).

### 11.5 Validation the content depends on

The script makes claims ("an incident opens around 11:40", "the expected mechanism is X", "the campaign moves the
month's peak"), and the sim decides whether they're true. So:

- **Do-nothing playthrough** (every navigation step acked, no changes):
  - each scripted incident opens inside its beat's window;
  - the truth engine's primary and accepted answers match the script's `expect` for each RCA;
  - Monday shows DDFPRD warm with no SLA breach.
- **Reference playthrough** (the script's suggested fix at every step, undos included):
  - every step completes, and each day leaves ≥ 2 engineer-hours;
  - the later lessons still have their incidents after the earlier fixes;
  - the back-out list is empty, and the final policy equals BASEPOL;
  - the bill's peak moves or holds as §8.4 says.
- **Alternative playthroughs**, one per `accepts` alternative (the cap raised rather than removed, each CICS fix,
  each cooling-fault response, and every ride-it-out route that carries a change or an undo into the next briefing): the next lessons still fire, and each undo beat triggers exactly when it should.
- **Coverage test**: every tab and section in §9 is the target of at least one step.
- **Anchor test**: every step target names an anchor that exists in the UI registry.
- **Calendar test**: a Midwest run's clock is unchanged; the prologue's Monday is the 26th, its Friday's night closes
  a bill, and its Saturday is the 1st.
- **Isolation**:
  - the prologue's reference run joins the cross-report invariants (`tests/sim/report-invariants.test.ts`) as an
    extra fixture;
  - the prologue is not in `SCENARIOS`, so bots, sweeps, goldens and the balance gate are unchanged;
  - a test asserts that `SCENARIOS` has no prologue entry and that a Midwest run's state has no `tutor` field.

Tuning order:
1. Set the flaw's maximum and the card severities until the do-nothing run produces the intended incidents with the
   intended truth.
2. Set the seeded bill.
3. Write Ruth's RCA and bill dialogue against those results. Never the other way round.

### 11.6 Headless

- `npm run play -- runs/p.json new --scenario midwest-prologue` starts the prologue.
- `play tutor` prints the current step and its target; `play tutor ack | note <kind> <ref> | hint` drive it. So the
  existing persona agents can playtest it, and a new persona brief ("intern: knows JCL and SDSF, never owned a WLM
  policy") can report confusion step by step.
- The reference command log in `tests/fixtures/prologue/` is what produces the chapter start states.

## 12. Realism

Every statement Ruth makes about z/OS behaviour is a statement about z/OS behaviour (CLAUDE.md realism policy).
- Most of what she says restates mechanics already modelled and cited in SPEC (§5, §8, §9, §10) and
  `docs/research.md`. Those lines cite the same source in `script.ts` comments.
- A new claim goes through the `zos-docs` skill before it ships, or is marked unverified and softened. Examples:
  - the RG-Cap primary reason as the clue: SPEC §5.5.6 and the Monitor III DELAY help text already state it, but the
    script's exact wording is checked against RMF Report Analysis;
  - how type 2 resource groups behave when the LPAR's share changes;
  - why a slow CF can look like CPU.
- Each lesson's Codex links must point at entries with their own sources. The resource groups entry is checked for
  that before T3 relies on it.
- The forgotten migration cap is a story, not a claim about any real shop; Ruth's "every temporary change is
  permanent" is advice, not a fact.

## 13. Delivery plan (BACKLOG list `prologue`)

Scoped into BACKLOG.md list `prologue` on 2026-11-25; the entries there are the source of truth for scope and
"Done when":

1. **PRO-01 calendar start**: `monthDayAtStart` through `clockAt` and its callers. The only sim change; `npm run
   compare` shows no difference, and the bench hashes are unchanged.
2. **PRO-02 engine**: `scheduledCards`, `startingCommands`, `startingCost`, the `prologue` flag, tutorial state on
   `RunState`, `TUTOR_NOTE`/`TUTOR_ACK`, stop ticks, predicates, the back-out list, the prologue-only rules, and
   headless `play tutor`. Game layer only; goldens unchanged.
3. **PRO-03 UI shell**: mentor panel, spotlight, anchor registry, date in the top bar, new-run choice. No content
   beyond a test chapter.
4. **PRO-04 Mon 26 + Tue 27**: the DDFLIMIT flaw, content, tuning, the do-nothing / reference tests, Codex notebook
   pages.
5. **PRO-05 Wed 28 + Thu 29**: the scripted failure, the undo beats, the seeded bill.
6. **PRO-06 Fri 30 + handover**: the bill reading, the back-out note, Ruth's tools, the transition to Day 1, 50 XP,
   the amber theme and the pager sound.
7. **PRO-07 playtests**: the intern persona agent through all five chapters; one human playtest
   (`docs/playtests/`); fixes.

Each content PR runs the §11.5 tests. Only PRO-01 touches the sim, and it doesn't change behaviour.

## 14. Decisions (user, 2026-11-25)

1. **Audience:** zero *mainframe* experience, with experience of other software or platforms (§2).
2. **Flaws:** teach one flaw: the prologue-only DDFLIMIT resource group cap (§3.4). F1 stays with the day-1 corner
   tutorial; F3 and F7–F11 are shown at most, never named.
3. **Rewards:** a small XP award (50, once) and two cosmetics: Ruth's terminal (amber theme) and Ruth's pager (alert
   sound) (§8.3).
4. **Day-1 corner tutorial:** kept as it is.
5. **A scripted change failure:** yes, on Wednesday (§5.3 W4).
6. **Refile:** yes, one refile per prologue RCA.
7. **Length:** five days, about 70 minutes.
8. **Plant and isolation:** a separate optional scenario id on the Midwest plant as is; no golden or sweep impact.
9. **Month-end bill:** yes. Plausible seeded values for the 1st–25th plus the week as played (§8.4).
10. **Framing:** a real production handover in the last week of the prior month, Monday 26th to Friday 30th (§3.2,
    §3.3). Scripted events are not justified in the story. The reset of trust and the other resources on Day 1 gets
    no story.
11. **Continuity:** the script guides the player to undo temporary changes (the (undo) beats); anything else still in
    on Friday is listed in Ruth's handover note as backed out.
12. **Story's starting fixes** (author's design call on review finding B1, 2026-11-25; the user may override): Ruth's
    text never claims F7, F8 or F11 is undone, so Story's previous-team message on Day 1 stays consistent and Day 1's
    content is unchanged (§3.2).
13. **Change timing** (author's design call on review finding B2, 2026-11-25): no new "plan for tomorrow" mechanic.
    During a beat, the player either makes an emergency change now or rides it out and makes the change in the next
    briefing, as the change model already works. Undo steps offer the same two routes, and a step chosen for the
    briefing is carried into the next day's first beat (§5).
