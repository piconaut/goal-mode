# RCA judging and incident truth: audit, truth model and D1 draft

Status: **proposal for the user** (2026-11-09). Nothing here is implemented. The work it leads to is in
[BACKLOG.md](../BACKLOG.md) list `rca-truth` (RT-01 … RT-24) and RF-02; entries that need a decision name the section of this
document to decide on. §7 lists the decisions.

Scope: the whole chain from sim causality → game "truth" (`src/game/sla.ts`, `run/hourly.ts`) → evidence matching
(`src/game/evidence.ts`) → verdict (`run/rca.ts`), for every event card and scenario flaw, on `dev` at `1300e69`.
Built on SPEC §9, §10, §13.3 and the playtest round 2 findings in PROGRESS.md.

How the findings were obtained:

- **Code reading** of the files above and the three event decks.
- **Replays** with a scratch harness (not committed; `runs/` is ignored) that does what
  `tests/game/power-cap.test.ts` does: start a run with `newRun`, play with no player actions, and on the chosen day
  add one or two `ActiveEvent`s built from the card definitions to `run.events` (the deck's own draw is switched off
  with `minDay`), then advance hour by hour and print each incident's truth, its CPU basis and how much each
  response-time group grew. Replays are named **R-n** below as *scenario, seed, day index, cards at hour*. All are
  Normal difficulty with no player actions unless stated. "Day 12" is day index 12, shown in the game as D13.
- **Pure-function calls** to `triggerOf`, `mechanismOf`, `failureMechanismOf` and `judgeEvidence` with hand-built
  inputs, named **U-n**. Each is two or three lines and is the natural shape for the regression test of its fix.
- **z/OS facts** are cited to book and page. Facts already in [docs/research.md](research.md) are cited from there;
  two were checked with the `zos-docs` skill in this session (Db2 thread queueing, §3 A14). Anything not checked is
  marked *unverified*.

## 1. Summary

The judging is not trustworthy enough to gate fixes on, and the reasons are structural, not a list of card bugs:

1. **Truth is a single label, but most incidents have two defensible answers.** A power cap is a capacity loss and
   a priority problem; a looping job in a high class is runaway work and a classification rule written too broadly
   (the card's own two fixes say so). A fair expert gets 0–2 points of 5 for a correct diagnosis (§3 A1).
2. **The trigger is found through hand-written `affects` lists.** Work hurt indirectly by a card (collateral
   victims) falls through to `POLICY` or `GROWTH`, so one cause yields two or three different truths on the same
   day. This is the playtest D12 complaint, and it holds for most cards, not just POWER_CAP (§3 A2).
3. **Cards that run long and declare no `mechanisms` take the blame for anything**, and ties are broken by the
   card's name. A permanent encryption mandate outranks a power cap because "E" sorts before "P" (§3 A3).
4. **The CPU three-way split asks the wrong question.** It takes the policy's importances as given, so work the
   policy ranks too low has "no donors" and its incident is judged capacity. Revenue flaw G1, a planted *policy*
   flaw, is judged `CPU_CAPACITY/GROWTH`. It also counts the hurt work's own Db2 as a donor, looks at any host
   rather than the one where the delay was, and flips on a one-point difference at the 90 % and 10 % lines (§3 A4–A6).
5. **Evidence does not discriminate.** A CPU-delay pin on any class on any system scores "points at the cause" for a
   CPU incident, while the discriminating facts for most cards (CPC busy, capacity change, CP vs zIIP split, CF and
   DASD reports, region storage, a flat CPU per transaction) cannot be pinned or are rejected as "unremarkable".
   Pins are also judged against the classification and routing at *filing* time, so the player's own remediation
   turns good pins into "not about X" (§3 A9–A11). RT-12 replaced the subject test with pin relations; the proof
   recipes (RT-13) and the missing pin sources (RT-05's busy figures are done; RT-10, RT-11) close the rest.
6. **A campaign and a retry storm are byte-identical in every report** (R-5). The D1 example fix cannot be proven
   by any data the game has today (§2, §5.3).

No finding crashes the game or corrupts state. One is a plain bug with a wrong truth as its result (A7: a
storm-drain incident fixed within the hour is judged `QR_TCB`).

§4 proposes a truth model built on four ideas: an **accepted set** with one primary answer; card blame by declared
**footprint** (what resource, where) instead of `affects`; the CPU split by **displaceable CPU on the host where the
delay was**, with bands instead of lines; and evidence as **proof recipes** (a discriminating pair) instead of single
metrics. §5 builds D1 on the recipes. §6 orders the work so that the scoring-only changes, which cannot move the
balance bands, land first.

## 2. Truth inventory

Verdicts: **agrees**; **game wrong** (a fair expert would reject the game's answer); **defensible but unfair** (the
game's answer can be argued, but so can another one the game scores as wrong); **unpinnable** (the evidence that
separates the cause from its look-alikes cannot be pinned, or is rejected); **ambiguous by nature** (the data cannot
separate two causes at all); **n/a** (the card never opens an incident).

"Expert" is what an analyst reading only player-visible data would file. The reasons rest on these facts:

- Regions managed to transaction goals have their delay states counted for the transaction classes they serve, and
  resource samples are reported with the regions' classes ([WLM Planning p.113](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=113),
  [SG24-7621 (2010) p.81, p.126](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=93)). So an analyst
  reads a CICS workload's CPU problem from the region class's row.
- WLM takes CPU from donors "that use the resource" and tests every move for net value; between equal importances it
  moves only to bring goal achievement closer together ([SG24-7621 p.105](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=105),
  [SG24-6472 (2008) p.60](https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=60)). So "who was ahead of
  it, and should they have been?" is the analyst's question, at any importance, not only below the victim.
- A capacity reduction is visible as SMF70CAI below 100 with a reason code ([MVS SMF p.589](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieag200_v3r1.pdf#page=589)).
- WLMGL CAP delay is resource-group capping and discretionary goal management, not LPAR capping, and is not part of
  CPU delay ([RMF Report Analysis p.540](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=540));
  LPAR capping is Partition Data WLM% ([p.401](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=401)).
- CICS 110 separates QR TCB wait (QRMODDLY) from first-dispatch delay by MXT (MXTDELAY)
  ([CICS Monitoring p.251–254](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/monitoring-reference_pdf.pdf#page=253)),
  and a short-on-storage region defers new task attaches ([CICS Performance p.76](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/performance_pdf.pdf#page=76)).
- Db2 accounting class 3 holds lock/latch and I/O suspensions ([Db2 13 Managing Performance p.709](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_perfbook.pdf#page=709)).

Game truth is from the code; **(R-n)** marks rows confirmed by a replay. "Collateral" means a workload the card
hurts without being in its `affects`. Pin metrics are the `EVIDENCE_METRICS` names; the tool that exposes each is in
brackets (tier 0 has WLMGL only).

### 2.1 Midwest Mutual, 27 cards

| # | Card | Expert: mechanism × trigger, and why | Game truth | Discriminating evidence; pinnable? | Verdict |
|---|---|---|---|---|---|
| 1 | CAMPAIGN | CPU (capacity or priority by headroom) × DEMAND_SURGE: mobile END/S ×2.5 at flat CPU per transaction, forewarned by Digital | MOBILE: `CPU_PRIORITY/DEMAND_SURGE` (R-1: CPC 89 % against the 90 % line, donors 12 % against 10 %). Collateral CICS work: `DEPENDENCY/POLICY` (R-9) | END/S up: `ENDED_RATE` pinnable (WLMGL), half weight. CPU per transaction flat: `CPU_VS_BASE` [DB2_ACCT] is rejected as "unremarkable" below ×1.3, so the ruling-out half cannot count | **agrees** for MOBILE (on a knife edge, A5); **game wrong** for collateral (A2) |
| 2 | RUNAWAY | CPU_PRIORITY × RUNAWAY_WORK: one enclave's CPU soars with its end rate flat; it shares DDFPRD with MOBILE (F3) and runs on CPs on PROD2 (F7) | MOBILE, ADHOC: CPU split / `RUNAWAY_WORK`. Other PROD2 work: fallback | DDFPRD#2 `APPL` pinnable (half weight). The ENCLAVE view and IIPCP are not pinnable | **agrees** for listed work; **game wrong** for collateral |
| 3 | REGRESSION | CPU or DEPENDENCY × ACCESS_PATH_REGRESSION for everything sharing the regions and the image | RBANK: any mechanism / `ACCESS_PATH_REGRESSION` for 30 h. R-3: RBANK had **no** incident; CARDAUTH did, `DEPENDENCY/POLICY` (Db2 in STCMED starved on PROD2: STCMED#1 PI 1.65, CPU delay 76 %) | `CPU_VS_BASE` ×3 on RBANK [DB2_ACCT or CICS_MON]. For the CARDAUTH incident that pin is "not about CARDAUTH" | **game wrong** (collateral, A2); long unfiltered card (A3) |
| 4 | BOT_ATTACK | CPU or THREAD_LIMIT (DBATs) × DEMAND_SURGE: END/S ×4 at *lower* CPU per transaction | MOBILE: any mechanism / `DEMAND_SURGE` (no incident on R day 12) | The discriminator against a campaign is CPU per transaction ×0.4: `CPU_VS_BASE` 0.4 is below the ×1.3 notable line, so "unremarkable" | label **agrees**; **unpinnable** |
| 5 | RETRY_STORM | CPU × DEMAND_SURGE, or APPLICATION_ERROR (clients retrying without backoff) | MOBILE: `CPU_PRIORITY/DEMAND_SURGE` (R-2: CPC 99 %, donors 12 %) | None exists. R-5: with the same start hour the WLMGL and Partition Data rows of RETRY_STORM and CAMPAIGN are identical to the last digit (both are `rate ×2.5`). Only the campaign's inbox forewarning separates them | **ambiguous by nature** (§5.3) |
| 6 | XLOG_LOOP | CPU_PRIORITY × RUNAWAY_WORK *or* POLICY: a looping STC in STCHI because the `CICS*` rule is too broad. The card's two fixes are "cancel it" and "add a classification rule" | TELLER, PAYMQ: CPU split / `RUNAWAY_WORK`. RBANK, CARDAUTH, MOBILE on PROD1: fallback. The victim is importance 2 and the loop importance 1, so the loop is never a "donor": at a full CPC the verdict is `CPU_CAPACITY` (U-11 shape) | STCHI `APPL` up with CICS END/S flat: pinnable at half weight. "CICSXLOG is the top consumer" (Mon III job row) is not pinnable | **defensible but unfair** (A1, A4) |
| 7 | ENCRYPTION_MANDATE | CPU × "a change made the same work cost more". By the form's own help text that is ACCESS_PATH_REGRESSION; GROWTH is arguable | `…/POLICY` on every later incident of CARDAUTH, TELLER, PAYMQ, whatever the mechanism, for the rest of the run, and it outranks any other card that covers the hour (U-1, R-8) | CPU per transaction ×1.06 is below the notable line | **game wrong** (A3); label **defensible but unfair** (A8) |
| 8 | VENDOR_PRICE | no performance effect | none (`affects` empty) | Finance tab | **n/a** |
| 9 | GREEN_IT_COD | no performance effect | none | change desk refusal | **n/a** |
| 10 | CF_LINK | CF_SERVICE × HARDWARE_FAULT (announced). Also extra z/OS CPU per Db2 transaction from slow sync requests | CF or lock mechanism / `HARDWARE_FAULT`. A CPU incident from the extra CPU is filtered out by `mechanisms` and falls to `POLICY`/`GROWTH` | `CF_WAIT` [DB2_ACCT]. CF Activity [CF_DASD] is not pinnable | **agrees** on CF; **game wrong** for its CPU side-effect |
| 11 | CF_FAILURE | CF_SERVICE × HARDWARE_FAULT (announced); failures if a structure is lost | any mechanism / `HARDWARE_FAULT` while it runs. Afterwards structures stay in CF02 "until moved": later CF incidents are `CF_SERVICE/GROWTH` | as CF_LINK | **agrees** while active; aftermath **defensible but unfair** (A8) |
| 12 | DASD_DEGRADED | IO × HARDWARE_FAULT: DISC ×5 on the back end | `IO/HARDWARE_FAULT` for RBANK, TELLER, PAYMQ, MOBILE. CARDAUTH and the batch night: `IO/GROWTH` | `DELAY_IO` (WLMGL), `SYNC_IO` [DB2_ACCT]. The DASD report that separates DISC (array) from IOSQ on one LCU (HSM, REORG) is not pinnable | **agrees** for listed work; **game wrong** for CARDAUTH and BATCH (A2, A12) |
| 13 | REORG_OVERRUN | IO × BATCH_OVERLAP | BATCH: `IO/BATCH_OVERLAP` (R-4) | `JOB_IO` [SMF30_BATCH] | **agrees** |
| 14 | JOB_ABEND | JOB_FAILURE × APPLICATION_ERROR (announced) | BATCH: `JOB_FAILURE/APPLICATION_ERROR` (R-4) | `JOB_ABEND` | **agrees**; precedence caveat (A12) |
| 15 | MONITOR_CREEP | CPU_PRIORITY or DEPENDENCY × a vendor upgrade that doubled the agent's CPU (a change, or runaway work) | MOBILE, RBANK: any mechanism / `POLICY` for 48 h. R-6: CARDAUTH `DEPENDENCY/POLICY`, MOBILE `CPU_PRIORITY/POLICY`, CARDAUTH 20:00 `LOCK_CONTENTION/GROWTH` (lock +2.9 ms), BATCH `CPU_PRIORITY/POLICY` grouped with MOBILE's | STCMED `APPL` up (half weight). MONAGENT as top consumer is not pinnable | **defensible but unfair** (A8); steals blame (U-3, A3) |
| 16 | LOCK_ESCALATION | LOCK_CONTENTION × BATCH_OVERLAP | `LOCK_CONTENTION/BATCH_OVERLAP` (R-4: CARDAUTH, lock +32 ms). The no-card fallback gives the same pair for unlisted work | `LOCK_WAIT` [DB2_ACCT]; WLMGL "waiting for lock" state is not pinnable; `DELAY_OTHER` half weight | **agrees** |
| 17 | SHADOW_IT | CPU_PRIORITY (TSO at importance 2, F5) × NEW_WORKLOAD or RUNAWAY_WORK | MOBILE, RBANK: CPU split / `NEW_WORKLOAD`. TSO has the victim's importance, so it is not a donor: at a full CPC the verdict is `CPU_CAPACITY` (U-11) although the card's lever is TSO's importance | TSO `APPL` ×8 with END/S flat: pinnable at half weight | **defensible but unfair** (A4, A1) |
| 18 | QR_RELEASE | QR_TCB × a release that is not threadsafe | `QR_TCB/POLICY` (same as the no-card fallback, so co-hosted CICS work agrees) | `QR_WAIT` [CICS_MON] | mechanism **agrees**; trigger label **defensible but unfair** (A8) |
| 19 | NEW_APP_GOLIVE | CPU_PRIORITY × NEW_WORKLOAD (unclassified work in SYSOTHER), POLICY after the first days | BOOKING: `CPU_PRIORITY/NEW_WORKLOAD` (R-4), fallback after two days. Mechanism is judged against an empty baseline (A6, U-13) | SYSOTHER `DELAY_CPU` (WLMGL) | **agrees** |
| 20 | POWER_CAP | CPU_CAPACITY × HARDWARE_FAULT (announced; SMF70CAI). CPU_PRIORITY also valid where the policy could have protected the work | R-7: MOBILE `CPU_PRIORITY/HARDWARE_FAULT` at CPC **98 %** busy (donors 12 %); CARDAUTH `DEPENDENCY/HARDWARE_FAULT`. One cause, two truths, neither is capacity | CHANGE REASON=MACHINE is not pinnable; `PRSM_DELAY`, `DELAY_CPU` are | **defensible but unfair** (playtest D12; A1, A4) |
| 21 | HSM_RECALL_STORM | IO × POLICY (a month-old migration policy change) or DEMAND_SURGE | `IO/DEMAND_SURGE` ("closest existing trigger", per the card's comment) | LCU 30 IOSQ in the DASD report: not pinnable. `DELAY_IO` counts for the mechanism | **defensible but unfair** (A1) |
| 22 | ZIIP_LOSS | CPU × an application redeploy that lost zIIP eligibility | `mechanisms: ['CPU_CAPACITY']` only. A `CPU_PRIORITY` or `CAPPING` incident does not match the card and gets `POLICY` from the fallback (U-6): the same label by coincidence | The clue is CP up and IIP down at flat total. `APPL` is CP + IIP (flat) and `CPU_VS_BASE` is CP + zIIP per transaction (flat): both show nothing | **unpinnable**; label **defensible but unfair** (A8) |
| 23 | CICS_SOS | THREAD_LIMIT × APPLICATION_ERROR. An expert may well file STORAGE: the region is short on storage | `THREAD_LIMIT/APPLICATION_ERROR`, four incidents in one group (R-4) | `MXT_WAIT` [CICS_MON]. The fact that separates it from a low MXT or QR (EDSA at EDSALIM, SOS time) is shown but not pinnable | **defensible but unfair** (STORAGE scores 0); **unpinnable** |
| 24 | CP_SPARING | none: transparent sparing, a red herring | never blamed (`affects` empty) | HMC message | **agrees** |
| 25 | HIRING_FREEZE | no performance effect | none | briefing | **n/a** |
| 26 | SMF_AUDIT | CPU × the audit, where an image is already at its share | `affects` is empty, so its `mechanisms` entry is dead: incidents get `CPU_PRIORITY/POLICY` or `CPU_CAPACITY/GROWTH` from the fallback | SYSSTC `APPL` up: pinnable at half weight | **game wrong** when it lands on GROWTH |
| 27 | AUDIT_UNCLASSIFIED | no performance effect | none | WLMGL SYSOTHER | **n/a** |

### 2.2 Story beats, calendar and Midwest flaws

| Cause | Expert | Game truth | Verdict |
|---|---|---|---|
| MERGER (ACQBANK on PROD2), PREFILL (Revenue) | CPU_PRIORITY × NEW_WORKLOAD, for the new work and for what it squeezes | New work: `NEW_WORKLOAD` for two days. Squeezed work: fallback | **game wrong** for collateral (A2) |
| DEADLINE_SURGE (Revenue day 33, announced), payday and month-end multipliers | CPU × DEMAND_SURGE | Not cards: `POLICY` or `GROWTH` (U-7). DEMAND_SURGE is never produced without a card | **game wrong** (A8) |
| F1 Db2 in STCMED below the work it serves | DEPENDENCY × POLICY; CPU_PRIORITY is the same thought ("Db2's priority is too low") | `DEPENDENCY/POLICY` (R-3, R-6) | **agrees**; CPU_PRIORITY scores 2 of 5 (A1) |
| F3 ad-hoc in MOBILE's class, F4 no critical-path class, F5 TSO at importance 2 | CPU_PRIORITY × POLICY | `CPU_PRIORITY/POLICY` while donors ≥ 10 %; else `CPU_CAPACITY/GROWTH` (A4) | **agrees**, with the A4 trap |
| F7 no zIIP on PROD2, F9/F10 DEVT uncapped and weights | CPU × POLICY (configuration) | `CPU_CAPACITY/GROWTH` when the image is full | **defensible but unfair** (A8) |
| F8 CF02 on a shared ICF | CF_SERVICE × POLICY (configuration) | `CF_SERVICE/GROWTH` | **defensible but unfair** (A8) |

### 2.3 Harbourline and Revenue

Adapted cards (`adapt.ts`) behave as their Midwest originals; the rows above apply with the retargeted workloads.
Harbourline drops the fix from BOT_ATTACK, RETRY_STORM and ZIIP_LOSS, so D1 has nothing to gate there.

| Card or flaw | Expert | Game truth | Verdict |
|---|---|---|---|
| SICK_AOR (Harbourline B2) | ROUTING × POLICY (no abend thresholds; [CPSM Managing Workloads p.34](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/cpsm-managing-workloads_pdf.pdf#page=34)). APPLICATION_ERROR is arguable: a region is abending | `ROUTING/POLICY` (R-10). Fixed at 10:48 in the opening hour: `QR_TCB/POLICY` (R-11, A7). `FAIL_PCT` [CICS_MON] is the evidence | **agrees**; **game wrong** when fixed within the hour |
| MARKET_OPEN_SURGE, HOLIDAY_CARD_SPIKE | CPU or THREAD_LIMIT × DEMAND_SURGE (both forewarned) | listed work: mechanism / `DEMAND_SURGE`; collateral: fallback | **agrees**; collateral as A2 |
| B1 static distributor weights (PRDA hot), B3 BASEWLM, B4 CF locality | ROUTING × POLICY: the form's help for ROUTING says "the wrong image or link" | R-12 (no cards, day 0–3): `CAPPING/POLICY` for all six workloads when PRDA's absolute cap binds, `QR_TCB/POLICY`, `CPU_PRIORITY/POLICY`. ROUTING is produced only by SICK_AOR's failures | **defensible but unfair**: ROUTING scores 0 for a routing flaw |
| Revenue G1: e-filing on a velocity goal at importance 4 | CPU_PRIORITY × POLICY: SPEC §13.4 lists it as a policy flaw whose fix is a class at importance 2 | R-13 (no cards, day 0, 5, 8 at 21:00): `CPU_CAPACITY/GROWTH`, CPC 97–99 %, donors 1 % | **game wrong** (A4) |
| Revenue G2, G3, H1 | CPU_PRIORITY, DEPENDENCY, CAPPING × POLICY | by code: as expert while donors ≥ 10 % | **agrees** (not replayed) |
| Revenue H2 IIPHONORPRIORITY=NO | zIIP delay with CP white space × POLICY ([Init & Tuning p.430](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieae200_v3r1.pdf#page=430)) | zIIP queueing is in the CPU group and is split by *general CP* busy and capping: `CPU_PRIORITY/POLICY` while the CPs have room | **agrees** by accident (A6) |

Of the 22 Midwest cards that can open an incident, four agree without qualification (REORG_OVERRUN, JOB_ABEND,
LOCK_ESCALATION, NEW_APP_GOLIVE). Every other one is wrong for collateral or co-occurring work, has a second
defensible answer the game scores as wrong, or cannot be evidenced.

## 3. Rule audit

Each finding: what the rule does, why it fails in general, and a minimal repro.

Replays referred to:

| Id | Scenario, seed, day index | Cards at hour (player commands) |
|---|---|---|
| R-1 | Midwest 42, 12 | CAMPAIGN@13 |
| R-2 | Midwest 42, 12 | RETRY_STORM@12 |
| R-3 | Midwest 42, 12 | REGRESSION@7 |
| R-4 | Midwest 42, 12 | one each: REORG_OVERRUN@21, JOB_ABEND@22, LOCK_ESCALATION@21, NEW_APP_GOLIVE@9, CICS_SOS@10 |
| R-5 | Midwest 42, 12 | RETRY_STORM@12 and, separately, CAMPAIGN@12; compare the reports at incident opening |
| R-6 | Midwest 42, 12 | MONITOR_CREEP@6 |
| R-7 | Midwest 42, 12 | POWER_CAP@12 |
| R-8 | Midwest 42, 12 | ENCRYPTION_MANDATE@6 + POWER_CAP@12 |
| R-9 | Midwest 42, 12 | MONITOR_CREEP@6 + CAMPAIGN@13:20 |
| R-10 | Harbourline 42, 5 | SICK_AOR@10 |
| R-11 | Harbourline 42, 5 | SICK_AOR@10, then `endEventByFix('RECYCLE_SICK_AOR')` at 10:48 |
| R-12 | Harbourline 42, 0–3 | none |
| R-13 | Revenue 42, 0–9 | none |
| R-14 | Midwest 42, 12 | none (`SET_DEFINED_CAPACITY PROD2 120` at 06:00) |
| R-15 | Midwest 42, 12 | none (`SET_DB2 DB1A/DB1B maxDbat 20` at 06:00) |
| R-16 | Midwest 42, 3 | RETRY_STORM@12, then pins and edits as in A9–A10 |

The control (Midwest 42, 12, no cards) has no incident, so every incident in R-1 … R-9 is caused by its cards.

Direct calls (the SLA hour is `[t, t+1h)`; cards are built from their definitions as `drawEvents` does):

| Id | Call | Result |
|---|---|---|
| U-1 | `triggerOf('CARDAUTH','CPU_PRIORITY', [POWER_CAP t−1h…t+5h with CARDAUTH in scope, ENCRYPTION_MANDATE since t−50h])` | `POLICY` |
| U-2 | `triggerOf('RBANK','IO', [DASD_DEGRADED t+20min…t+3h, REGRESSION t−3h…t+27h])` | `ACCESS_PATH_REGRESSION` |
| U-3 | `triggerOf('MOBILE','CPU_PRIORITY', [CAMPAIGN t+20min…t+2h, MONITOR_CREEP t−5h…t+43h])` | `POLICY` |
| U-4 | `triggerOf('MOBILE','LOCK_CONTENTION', [RETRY_STORM t…t+3h])`, lock index 5 | `DEMAND_SURGE` |
| U-5 | `triggerOf('CARDAUTH', m, [REGRESSION t−3h…t+27h])` for `m` = CPU_PRIORITY, CPU_CAPACITY | `POLICY`, `GROWTH` |
| U-6 | `triggerOf('MOBILE', m, [ZIIP_LOSS])` for `m` = CPU_PRIORITY, CAPPING | `POLICY` both (the fallback, not the card) |
| U-7 | `triggerOf(w, m, [])` for each mechanism | CPU_CAPACITY, IO, STORAGE, CF_SERVICE, LOCK_CONTENTION (lock index ≤ 1) → `GROWTH`; the rest → `POLICY` |
| U-8 | `failureMechanismOf` for a failure-only hour, SICK_AOR running at close; the same with `ended: true` at t+50min | `ROUTING` both (RT-01: the card overlaps the opening hour) |
| U-9 | `mechanismOf({cpuQueue: 1}, {}, hour with cappedByLpar {PROD2: 0.06}, hosts PROD1 and PROD2)` | `CAPPING` |
| U-10 | `mechanismOf`, CPC 99 % busy, CP by importance 0…6 = 0.2, 1.0, 1.5, 0.35, 0, 0, 0 engines, victim importance 2 | `CPU_PRIORITY` (donors 11.5 %) |
| U-11 | as U-10 with 0.2, 0.5, 3.2, 0.1, 0, 0, 0 | `CPU_CAPACITY` (80 % of the CP at the victim's importance) |
| U-12 | `mechanismOf({cpuQueue: 0.01}, {cpuQueue: 0.02}, …)`: nothing grew | `DEPENDENCY` |
| U-13 | `mechanismOf({io: 0.03, cpuQueue: 0.02, dependency: 0.022}, {}, …)`: new work, no baseline | `IO` |

### A1. One label per facet, where the cause is legitimately plural

`scoreRca` is `3 × (mechanism === truth) + 2 × (trigger === truth)`. There is no notion of an answer that is also
right. Cases where a second answer is at least as defensible: POWER_CAP (capacity/priority), XLOG_LOOP
(runaway/policy), F1 (dependency/priority), CICS_SOS (thread limit/storage), HSM (surge/policy), SHADOW_IT (new
work/runaway), SICK_AOR (policy/application error), and every collateral victim (the card and the policy that left
the victim exposed). Repro: R-7; the playtest D12 RCA (`CPU_CAPACITY/HARDWARE_FAULT`) scores 2 of 5 on MOBILE and on
CARDAUTH.

### A2. Collateral victims: blame follows `affects`, not the resource the card loads

`triggerOf` needs `e.affects.includes(workloadId)`. `affects` is a hand-written list of the workloads the designer
expected to suffer. PT-04 replaced it for POWER_CAP with "workloads routed onto the affected CPCs"; every other card
still has the list. Consequences:

- The direct target may stay healthy while a neighbour breaks, and the neighbour's truth ignores the card. R-3:
  REGRESSION on RBANK, incident on CARDAUTH, truth `DEPENDENCY/POLICY`.
- One cause yields several truths, so `rcaGroup` splits it and the player files (and is judged on) several RCAs.
  R-9: a campaign at 13:20 breaks RBANK, CARDAUTH, TELLER and PAYMQ in the 13:00 hour (`DEPENDENCY/POLICY`, the MXT
  queue +6 s as a symptom of Db2 starving). MOBILE's own incident had opened at 12:00 under agent creep
  (`CPU_PRIORITY/POLICY`), so the campaign that prolongs it is never its trigger (A6, opening hour only). R-8: under
  one power cap in one hour, MOBILE is `…/HARDWARE_FAULT` and CARDAUTH and PAYMQ are `…/POLICY`.
- The night's BATCH incident sees only cards that list `BATCH` (A12).
- Healthy-baseline learning uses the same list (`disturbed`), so collateral work's degraded-but-passing hours are
  folded into its baseline (A6).

### A3. Long-running cards without `mechanisms`, and the tie-break (fixed, RT-02)

A card with no `mechanisms` used to qualify for any mechanism. Ranking is: active at hour close, then longest overlap
with the hour, then ascending `uid`. A card that has run for hours always has the full overlap, so it beats a card
that started inside the hour, and two full-hour cards are ordered by name. RT-02 declares `mechanisms` on every card
with a non-empty `affects` (a content test enforces it), so the tie-break now only decides between cards that can
each legitimately cause the mechanism.

- U-1: `triggerOf('CARDAUTH','CPU_PRIORITY',[POWER_CAP covering the hour, ENCRYPTION_MANDATE permanent])` → `POLICY`.
  Live: R-8, CARDAUTH and PAYMQ `DEPENDENCY/POLICY`; without the mandate (R-7) CARDAUTH is `…/HARDWARE_FAULT`.
- U-2: RBANK `IO` incident, DASD_DEGRADED starting 20 minutes into the hour, REGRESSION since 07:00 →
  `HARDWARE_FAULT` (the DASD card; REGRESSION no longer names IO). (No live repro: day 12 on seed 42 raised no I/O
  incident.)
- U-3: MOBILE `CPU_PRIORITY`, CAMPAIGN starting 20 minutes in, MONITOR_CREEP since 06:00 → `POLICY`.
- U-4: MOBILE `LOCK_CONTENTION` during a RETRY_STORM → the fallback (`GROWTH`, or `BATCH_OVERLAP` with a lock
  index), not `DEMAND_SURGE`; RETRY_STORM does not name LOCK_CONTENTION.

The cards that were unfiltered (CAMPAIGN, RUNAWAY, REGRESSION, BOT_ATTACK, RETRY_STORM, XLOG_LOOP,
ENCRYPTION_MANDATE, CF_FAILURE, MONITOR_CREEP, SHADOW_IT, NEW_APP_GOLIVE, SICK_AOR, MARKET_OPEN_SURGE,
HOLIDAY_CARD_SPIKE) now declare mechanisms. SMF_AUDIT keeps `mechanisms` but has an empty `affects`, so it blames
nothing.

### A4. The donor test takes the policy under judgement as given

`CPU_CAPACITY` needs a full host *and* less than 10 % of the image's CP going to work of lower importance than the
hurt workload's class. Three systematic errors:

1. **Work ranked too low has no donors.** R-13: Revenue G1 puts e-filing at importance 4; at 21:00 batch has the
   CPU, the CPC is 97–99 % busy and only importance 5 and discretionary count as donors (1 %), so the planted policy
   flaw is `CPU_CAPACITY/GROWTH` on days 0, 5 and 8. The bots' `buyCapacityForIncidents` buys a permanent CP on
   repeated incidents with that label.
2. **Work at the same or higher importance is never counted as a donor**, though it is the usual culprit of a
   priority problem (and since WT-07 WLM itself takes from a happy more important period, down to its goal; RT-16's
   displaceable CP is to count that):
   XLOG_LOOP (importance 1 over importance 2), SHADOW_IT and F5 (TSO at the victim's importance), F3 (same class).
   U-11: CPC 99 %, 80 % of the CP used at the victim's importance, 2.5 % below → `CPU_CAPACITY`.
3. **The hurt work's own servers count as donors.** With F1, Db2 is importance 3 and uses 10–15 % of an image, so
   importance-1 and -2 work "has donors" at a saturated CPC. U-10: CPC 99 %, importance-3 share 11.5 % →
   `CPU_PRIORITY`. Live: R-2 (CPC 99 %, donors 12 %) and R-7 (CPC 98 %, donors 12 %); in R-2's WLMGL rows for PROD1 the
   only lower-importance class above 5 % APPL is STCMED (Db2 and the monitors) at 45 % of 403 %, which is that
   12 %. Taking CPU from Db2 would hurt the victim more.

With transaction-managed regions the CP is used by the regions, which are classified to the region class
(importance 1 in BASEPOL), so importance-2 CICS transactions are judged against importance-1 CPU that is partly
their own (by code reading; not replayed). The
playtest INC19 configuration (CARDAUTH in an importance-2 class, regions at the DP of the importance-1 class they
also serve, WLM Planning p.122–123 as recorded in docs/research.md) is the same shape.

### A5. Lines where bands are needed

90 % CPC busy, 95 % image busy, 10 % donors and 5 % capped are single lines on hour averages. R-1 is `CPU_PRIORITY`
at CPC 89 %; R-12 has a CARDS incident at CPC 91 %, donors 10 %; R-2 and R-7 sit two points above the donor line.
One more transaction per second flips the truth, and with it 3 of the 5 points. PT-03 made the numbers visible
after filing; it did not make them less arbitrary.

### A6. Mechanism selection: where, when and against what

- **Wrong host.** `hosts.some(capped)` and "any host full" ignore how much of the workload runs on each host and
  where its delay arose. U-9: a workload with any share on a host that was capped 6 % in one tick is `CAPPING`. The
  recorded basis is the first host of the busiest CPC: in R-2 and R-7 the explanation line names PROD1 (DDFPRD#1 PI
  0.5, CPU delay 3 %) while the incident is on PROD2 (PI 4.0, CPU delay 89 %).
- **Capping was the maximum of any tick.** `cappedByLpar` kept `max(cappedFrac)`, where `cappedFrac` is the share of
  that tick's demand cut, while SPEC §10 says "capped over 5 % of the hour": one capped tick decided the hour.
  Fixed by RT-08, which counts the ticks in which the image's demand was cut (`cappedTicksByLpar`) and calls the
  hour capped at `CAPPING.minHourShare` (5 %) of its ticks; `cappedByLpar` stays so an hour accumulated before
  RT-08 keeps its worst-tick reading.
- **The CPU refinement applies only to the workload's own queue.** Server starvation under the same cap or the same
  full CPC is `DEPENDENCY`. R-14: one soft cap on PROD2 gives `DEPENDENCY/POLICY` for TELLER and `CAPPING/POLICY`
  for PAYMQ and BATCH, in different groups. R-7 likewise.
- **zIIP queueing is judged on general CPs.** `ziipQueue` is in the CPU group; busy, donors and capping are all
  measured on the CP pool. A zIIP shortage is capacity only if the CPs happen to be full too (Revenue H2).
- **Opening hour only.** Mechanism and trigger are fixed from the first breached hour. An incident that starts as a
  policy miss and is prolonged by a card for five hours stays `POLICY`; a card that starts ten minutes before the
  hour closes owns an incident whose hour was mostly something else.
- **The baseline is the last few hours, not "normal for this time".** The EWMA (×0.8 per closed healthy hour) is
  dominated by the previous five hours, across midnight. A component with a daily cycle "grows" every day: lock wait
  rises when batch starts. R-6 and R-15 both produce `LOCK_CONTENTION/GROWTH` at 20:00 for a growth of 3 ms. An
  analyst compares with the same time on a normal day.
- **Absolute seconds, no floor.** The largest growth wins however small. U-12: nothing grew (a failure-only miss with
  no card) → `DEPENDENCY`, the first group whose growth is zero. U-13: new work with no baseline → the largest
  healthy component.
- **The thread limit's own share is understated.** THREAD_LIMIT is credited with the queue the arrivals would build
  at their *unqueued* service time (SPEC §10 calls this APPROX). R-15: MAXDBAT 20 at 20:00, DBAT queue +201 ms,
  reference queue +1.6 ms, lock +3.0 ms → `LOCK_CONTENTION/GROWTH`. The 12:00 incident of the same run is correctly
  `THREAD_LIMIT/POLICY`.
- **Region CPU wait is in the dependency group.** For CICS work the wait for CPU-starved regions is added to
  `dependency` (`results.ts`, `srvCpuSec`) while the reports show it as the region class's CPU delay. `DELAY_CPU`
  lists DEPENDENCY among its mechanisms to compensate, which is why the same pin "points at the cause" for both.

### A7. `failureMechanism` is lost when the card ends inside the hour (fixed, RT-01)

`failureMechanismOf` used to require `e.started && !e.ended` when the hour closes, unlike `triggerOf`, which PT-04
taught to use the hour overlap. U-8: SICK_AOR fixed 50 minutes into the hour → `null` → the delay groups decide.
R-11: `QR_TCB/POLICY` (QR +4.1 ms) instead of R-10's `ROUTING/POLICY`. A player who fixes the storm drain fast was
judged on a mechanism that was never there. The same hole existed for a card that expires inside the hour. RT-01
gives `failureMechanismOf` the hour and the same half-open overlap test, so both now name the card's mechanism.

### A8. Fallback triggers and the vocabulary

- Without a card the trigger is a function of the mechanism (U-7): CPU_CAPACITY, IO, STORAGE, CF_SERVICE → `GROWTH`;
  CPU_PRIORITY, CAPPING, DEPENDENCY, QR_TCB, THREAD_LIMIT, ROUTING → `POLICY`. So the trigger carries no
  information, and configuration flaws whose mechanism is a resource (F7, F8, F9/F10, alias shortage) are `GROWTH`.
- `DEMAND_SURGE` needs a card. Payday, month-end and the Revenue deadline week are announced surges applied as
  modifiers outside the deck.
- `GROWTH` is never tested against growth. It is the label for "a resource mechanism with no card".
- `POLICY` is defined in the form as "the WLM policy as configured", but it is also the trigger of an encryption
  mandate, a vendor agent upgrade, a non-threadsafe release, a stored-procedure redeploy and an audit. The form's
  text for ACCESS_PATH_REGRESSION ("a change made the same work cost more") describes four of those better.
- A player's own change has no special rule. It comes out as `POLICY` for most mechanisms (R-14, R-15 at 12:00),
  which is right, but the reply cannot say which change.

### A9. Evidence does not discriminate (fixed by RT-12's relations)

A pin scored when its metric listed the true mechanism **or** the true trigger, and seven metrics were `anySubject`
(`APPL`, `APPL_CP`, `APPL_IIP`, `IIPCP`, `DELAY_CPU`, `LOCK_WAIT`, `CF_WAIT`), which skipped the "about the hurt
workload" test entirely. R-16, for a
MOBILE incident on PROD1/PROD2, through the three rules:

| Pin | Before RT-03 | RT-03 | RT-12 (now) |
|---|---|---|---|
| WLMGL PROD2 **TSO#1** CPU delay 19.7 % | 1.0, "points at the cause" | 1.0 (PROD2 is a MOBILE image) | 0, "another class's row, not the hurt work's" |
| WLMGL **SYSP SYSTEM#1** APPL 3.4 % | 0.5, "consistent with the cause" | 0, "not on a system MOBILE runs on" | 0, unchanged |
| WLMGL PROD1 DDFPRD#1 CPU delay 8.2 % (the hurt class, on the image that was fine) | 0, "value is unremarkable" | 0, unchanged | 0, unchanged |
| WLMGL PROD1 DDFPRD#1 ended/s 222 | 0.5 | 0.5 | 0.5, unchanged |

RT-03 made an `anySubject` pin keep its subject freedom but took away its image freedom: `p.system` had to be one of
the incident's LPARs or `*PLEX`, so a TSO or SYSTEM row on another image no longer reached a production incident. It
also gave `APPL` a 5 % notable line. Two limits remained:

- `*PLEX` had to stay open: it is the roll-up of every image and the report views' default filter, so a `*PLEX` row
  for a class that only ran elsewhere still scored.
- The subject itself was never checked: TSO#1's *own* CPU delay, pinned on a MOBILE image, scored full weight for a
  MOBILE incident because the class merely ran on the host.

RT-12 replaces the subject test with a **relation** per pin (below and §4.6): TSO#1's delay is a `competitor` row and
`DELAY_CPU` accepts only `self`/`server`, so it scores nothing; its `APPL` share is still the half-weight competitor
clue. A competitor's row must also name a host image, so a `*PLEX` roll-up is rejected outright ("a *PLEX row does not
show which image the class ran on"). `LOCK_WAIT` and `CF_WAIT` are only ever pinned from Db2 101, whose subject is the
workload itself, so their relation is always `self`.

What remains open is the *combination*: two `DELAY_ZIIP` rows of the work's own class still reach "strong evidence"
(relevance ≥ 2, +5 Insight) for any CPU or dependency incident, because nothing checks that the pins, taken together,
separate the cause from its look-alikes. That is RT-13's proof recipes.

The reverse also holds: a ruling-out pin cannot count. "CPU per transaction unchanged" is the discriminator for a
surge against a regression or bot traffic, and `CPU_VS_BASE` near ×1.0 (or ×0.4 for bots) is below `notableAt`.

### A10. Evidence is judged against the present, not the incident (fixed, RT-04)

`judgeEvidenceRanked` classifies the workload with the current service definition and reads the current routing.
R-16, same pins, after three remediations a player would plausibly make before the review:

- MOBILE moved to its own class DDFMOB: the DDFPRD#1 ended/s pin becomes "not about MOBILE".
- MOBILE routed to PROD2 only: the Partition Data pin on PROD1 becomes "not about MOBILE".
- MOBILE routed away from PROD2 (`SET_ROUTING { PROD1: 1, PROD2: 0 }`, which keeps the zero weight): the PROD2
  TSO#1 CPU-delay pin becomes "not on a system MOBILE runs on", because RT-03's image test counts only host images
  with a positive routing weight. Routing the work *to* PROD2 is not what flips the pin.

All three punished the player for fixing the incident before the review. RT-04 stores the incident's classes, hosts
(and the positive-weight hosts the relation test needs) and serving regions when it opens, and judges against that
snapshot; incidents from old saves still derive them from the present. RT-12 added the serving regions' classes
(`serverClasses`), so a region's row is a `server` relation rather than the work's own. `tests/game/evidence.test.ts`
pins a class row, reclassifies the workload and reroutes it, and gets the pre-edit verdicts from the recorded
subjects (and the old defect from the live values). The snapshot is taken at the hour's close, so a change made
during the breaching hour is already in it, and rows from a later hour of a still-open incident sit under the new
class and no longer match — the price of a stable subject for the hour that opened the incident.

### A11. What cannot be pinned

| Fact the clue text points at | Card or mechanism it separates | Today |
|---|---|---|
| CPC busy, LPAR busy, MSU (Partition Data) | CPU_CAPACITY from CPU_PRIORITY | `CPC_BUSY` (90) and `LPAR_BUSY` (95) since RT-05; MSU not a metric |
| CHANGE REASON / capacity adjustment | POWER_CAP | `CAPACITY_ADJ` since RT-05 (100 − SMF70CAI, notable 1) |
| CP against IIP APPL %, IIPCP | ZIIP_LOSS, RUNAWAY on PROD2, H2 | `APPL_CP`, `APPL_IIP`, `IIPCP` since RT-05, at half weight beside `APPL` |
| CF Activity: sync service time, async conversion | CF_LINK, CF_FAILURE, F8 | no pin source |
| DASD Activity: DISC, IOSQ, per LCU | DASD_DEGRADED against HSM against REORG | no pin source |
| CICS region storage: EDSA at EDSALIM, SOS time | CICS_SOS against low MXT | shown (SMF tab), no pin |
| Top consumer job in a class (Mon III job rows) | XLOG_LOOP, MONITOR_CREEP, SMF_AUDIT | only SYSWKM server velocity |
| WLMGL work-manager states (waiting for lock, ready) | LOCK, QR against CPU | not a metric |
| A flat or lower CPU per transaction | surge against regression against bots | rejected by `notableAt` |
| WLMGL CAP delay | resource-group capping | maps to `CAPPING`, which the truth produces only for LPAR capping; since the sim stopped posting LPAR capping as CAP delay (RMF Report Analysis p.540) this pin can never score for a `CAPPING` incident (R-14: Partition Data capped 29–84 %, WLMGL CAP delay 0), and a resource-group cap goes through the CPU split, never `CAPPING` (by code reading) |

Most discriminators also sit behind tier-2 tools (DB2_ACCT, CICS_MON, CF_DASD, SMF30_BATCH). That is fine as design
(fog of war), but D1 must not gate a fix on a tool the player cannot have yet (§5.5).

### A12. BATCH incidents

- The trigger looks only at cards that list `BATCH` (REORG_OVERRUN, JOB_ABEND). A DASD fault at 22:00, a power cap
  that runs past 18:00, a 30-hour regression or 48-hour agent creep cannot be the night's trigger. R-6: the night is
  `CPU_PRIORITY/POLICY` from the fallback and is grouped with the day's MOBILE incident because the labels match.
- Any critical ABEND makes the night `JOB_FAILURE`, even when the job was restarted at once and the window was lost
  to CPU.
- The baseline is empty, so the largest absolute cause of lost time wins; the CPU split uses a 12-hour average and,
  since RT-08, the ticks of the night in which an image was capped.
- Evidence for the delay shares is one tool (SMF30_BATCH). WLMGL pins on the critical jobs' classes count.

### A13. Grouping by label

`rcaGroup` links incidents of the same played day with equal (mechanism, trigger).

- **Splits one cause**: R-7 (two groups), R-14 (two groups), R-9 (surge and dependency groups).
- **Merges different causes**: R-9, the 13:00 campaign incidents join the group opened at 09:00 by agent creep
  alone; R-6, the batch night joins a midday MOBILE incident. With the fallback, every no-card CPU-priority incident
  of the day is "the same cause" as every other.
- **Inherits silently**: an incident that joins a group whose RCA is already filed takes that RCA, score and all,
  unseen. In R-9 an RCA filed at 10:00 for a small CARDAUTH miss would cover four incidents at 13:00.

### A14. Realism mismatch found on the way: DBAT queue time in Db2 accounting

The SMF 101 view has a "DBAT queue ms/txn" column and `DBAT_QUEUE` is pinned from it. Db2 does not trace that wait:
"If the applicable limit has been exceeded, the request waits. The wait for threads is not traced, but the number of
requests queued is provided in the performance trace record with IFCID 73"
([Db2 13 Managing Performance p.143](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_perfbook.pdf#page=143)).
What an analyst reads is the count of requests queued at MAXDBAT, QDSTQDBT in the statistics record, shown by
`-DISPLAY DDF DETAIL` ([Db2 13 Command Reference p.303](https://www.ibm.com/docs/en/SSEPEK_13.0.0/pdf/db2z_13_comrefbook.pdf#page=303)).
Queued as RF-02; ledger rows added.

## 4. A truth model a fair expert would agree with

The test for every rule below: *an analyst who reads only what the player can read, and reasons correctly, is not
scored as wrong.* Truth stays a pure function of game state at hour close, computed in `src/game` from data the sim
already exposes or from new reporting-only fields, so determinism and layering hold.

### 4.1 An accepted set with one primary

```
truth: {
  mechanism, trigger,            // primary: unchanged fields; hints, AIOps and bots keep reading these
  accepted: { mechanisms: Mechanism[], triggers: Trigger[] },   // always includes the primary
  cause: string                  // identity of the cause, for grouping (§4.5)
}
```

- **Primary** is the answer the rules below rank first. **Accepted** are the answers a fair expert could defend from
  visible data. They are produced by rule, never listed per incident by hand.
- Scoring: an accepted mechanism scores 3 and an accepted trigger 2, as the primary does today. The post-RCA reply
  names the primary and says "also accepted: …" with one line of reasoning each, so the review teaches the fuller
  picture. Trust reward as today (≥ 3 points → full).
- *Contributing causes* are accepted answers. A contributing cause that could not be seen in player data is not
  accepted, and by the same test it should not be the primary either.
- A **family credit** of 1 point for the right resource with the wrong refinement (a CPU answer for a CPU incident
  outside the accepted band; STORAGE for a CICS short-on-storage) was an option. It softens the "0 for a near miss"
  feel at the cost of one more rule. Declined with the accepted set (Q1, 2026-11-10).
- **Built as RT-07**: `truth.accepted` and `truth.cause` are recorded when the truth is set (`game/rcaTruth.ts`),
  `scoreRca` and the evidence gate read membership, and the reply names the primary and each accepted answer with one
  line of reasoning. The first sources are the card alternates (content), a capacity-reducing card, the §4.3 bands,
  server CPU starvation and the no-card GROWTH/POLICY pair; the remaining rows of the source table (co-dominant groups,
  incident-long union, host imbalance) belong to RT-16, RT-17 and RT-19.

Sources of accepted answers:

| Rule | Adds |
|---|---|
| Co-dominant delay groups (§4.2) | the second mechanism |
| CPU bands (§4.3) | the other side of the capacity/priority split |
| Server CPU starvation (§4.3) | CPU_PRIORITY (or CAPPING, CPU_CAPACITY) beside DEPENDENCY |
| Capacity-reducing card, or capacity below what it was at the baseline | CPU_CAPACITY |
| Collateral victim of a card (§4.4) | the card's trigger and the fallback trigger |
| Card-declared alternates (`alsoTriggers`, `alsoMechanisms`, content) | XLOG_LOOP: POLICY. HSM: POLICY. SHADOW_IT: RUNAWAY_WORK. RETRY_STORM, SICK_AOR: APPLICATION_ERROR. CICS_SOS: STORAGE |
| No card, no surge, no player change (§4.4) | both GROWTH and POLICY |
| Host imbalance (one host of several carries ≥ ⅔ of the delay excess while another had room) | ROUTING |

### 4.2 Choosing the mechanism when groups move together

1. **Baseline by hour of day.** Keep one healthy baseline per workload per clock hour (24 slots, EWMA over days,
   weight 0.5), folded only from met, undisturbed hours. Until a slot has data, use the rolling EWMA as now.
   "Undisturbed" uses the card footprint (§4.4), so collateral work is not taught the card's effect. The SMF "vs
   base" columns read the same slot. This removes the daily cycle from "growth" (the 20:00 lock incidents).
2. **Shares, a floor, and co-dominance.** Excess per group = growth against the slot baseline, floored at zero.
   The primary is the largest. Any other group with at least a third of the total excess is accepted. If the total
   excess is under 10 % of the SLA's response-time budget, no delay group explains the miss: go to step 4.
3. **Causal order: symptoms never win.**
   - Slot queues (MXT, DBAT): credit THREAD_LIMIT with the queue the arrivals would build at their **baseline hold
     time** (slot baseline of in-region time), not at the unqueued service time. A limit that is too low for normal
     tasks then owns its queue (R-15); a queue behind slow tasks stays a symptom, as now.
   - Server waits: split `dependency` into `serverCpu` (the server was delayed for CPU, capping included) and
     `serverOther` (lock structure, I/O, health). `serverCpu` of regions managed to the work's goals joins the CPU
     group, matching the reports (WLM Planning p.113). `serverCpu` of other servers (Db2, MQ) stays DEPENDENCY as
     primary, with the CPU refinement of §4.3 accepted.
4. **Failure-only misses.** The sim knows why it failed each transaction (slot-queue timeout, region abend, Db2 or
   MQ unavailable, backlog timeout). Record failures by source per workload (reporting-only state), and map: queue
   timeout → THREAD_LIMIT, region abend → ROUTING, Db2/MQ → DEPENDENCY, backlog timeout → the CPU family. This
   replaces `failureMechanism` on the card and closes U-12. A7 is fixed on its own (RT-01, merged).
5. **Over the incident, not only its first hour.** Keep the opening hour as the primary (the player is paged then),
   and add to the accepted set whatever the same rules give for the hour with the worst attainment. Truth is then
   final when the incident closes; an RCA filed while it is open is judged when it closes.

### 4.3 The CPU split

For a CPU-family primary, or a `serverCpu` dependency:

1. **Host.** Record CPU wait per workload per LPAR (reporting-only; `failByWorkloadLpar` is the precedent). Judge on
   the host with the largest share of the excess; a second host with at least a third of it contributes to the
   accepted set. The recorded basis and the explanation line name that host.
2. **Pool.** If the excess is zIIP queueing, measure busy and displaceable use on the zIIP pool, and treat "zIIP work
   may not overflow" (IIPHONORPRIORITY=NO, Init & Tuning p.430) as a policy cause.
3. **Capping** when the host was capped for at least 5 % of the hour's ticks (time, not the worst tick), by defined
   capacity, group or absolute cap (built as RT-08: `cappedTicksByLpar`, `CAPPING.minHourShare`). Add: CAPPING also
   when the hurt class or its server was held by a resource-group
   maximum (WLMGL CAP delay, RMF Report Analysis p.540), with trigger POLICY. The form's help for CAPPING changes
   from "the image" to "the image or the class".
4. **Capacity or priority by displaceable CPU.** Replace "CP used by lower importance" with **displaceable CP**: CP
   on that image used by work that is not system work (SYSTEM, SYSSTC), not a server or region of the hurt workload,
   and not work whose own SLA was at risk that hour. The WLM importance of the consumer does not enter. A looping
   STC at importance 1, TSO at the victim's importance, ad-hoc queries in the victim's class and overnight batch
   ahead of a mis-ranked online workload are all displaceable; the victim's Db2 is not. "At risk" = an SLA workload
   below its target plus a margin that hour; critical batch during its window counts as SLA work.
5. **Bands.**

   | | Capacity is clear | Priority is clear | Between |
   |---|---|---|---|
   | Host full (CPC or image busy) | ≥ 95 % | < 85 % | both accepted; primary by the midpoint, 90 % |
   | Displaceable share of the image's CP | < 5 % | ≥ 20 % | both accepted; primary by the midpoint, 10 % |

   Capacity is the primary only when both rows say so; it is the only accepted answer only when both are clear.
   As built (RT-07): the accepted set widens unless a row settles the split — a host with room (< 85 %) rules capacity
   out, and a host at 95 % busy with under 5 % of its CP displaceable leaves capacity as the only answer. Everywhere
   between, both are accepted. A high displaceable share does not veto capacity, because the primary rule already
   keeps an hour with donors out of CPU_CAPACITY: it only ever appears beside a priority primary, where both readings
   hold.

   A capacity-reducing card, or a CPC whose capacity setting is below the one it had when the slot baseline was
   learned, always adds CPU_CAPACITY to the accepted set. The numbers are FICTIONAL and belong in
   `content/incidents.ts`.

Expected on the repros (the model is not implemented, so these are not runs): R-7 MOBILE → primary CPU_PRIORITY or
CPU_CAPACITY by the displaceable share once Db2 is excluded, with both accepted (band, and the card reduces capacity); CARDAUTH → DEPENDENCY with CPU_CAPACITY and
CPU_PRIORITY accepted; both in one group (§4.5). The player's D12 answer scores 5 on both. R-13 → CPU_PRIORITY/POLICY
(batch is displaceable). R-2 → CPU_CAPACITY primary at CPC 99 % with Db2 excluded, priority accepted in the band.

### 4.4 Triggers

1. **Footprint instead of `affects`.** Every card that can hurt work declares
   `footprint: { resource, reach, direct }`: the shared resource it loads (CP, zIIP, an LCU or all DASD, a CF, Db2
   locks, a region's QR or task slots, failures), where (images, CPCs, the sysplex), and the workloads whose own
   demand or path it changes. `mechanisms` becomes mandatory and derives from the resource. A workload is **direct**
   if listed, **collateral** if its hosts (or its servers' hosts) intersect the reach. A card qualifies for an
   incident when the mechanism matches its resource and the workload is direct or collateral. This is PT-04's
   routing-based scope, generalised. BATCH is a workload like any other here (A12).
2. **Ranking** among qualifying cards: direct before collateral; then **fresh before background**, where a card is
   background for a workload once that workload has closed a met hour with the card already running; then longer
   overlap with the hour. If that leaves a tie, both triggers are accepted and the earlier-starting card is primary.
   No alphabetical tie-break. A permanent mandate becomes background after its first healthy hour; its +6 % then
   belongs in the baseline, which is what "the new normal" means.
3. **Accepted triggers**: every qualifying card's trigger, the card's declared alternates, and for a collateral
   victim also the fallback trigger (the policy or headroom that left it exposed).
4. **Fallbacks, tested rather than assumed.**
   - `POLICY` primary when a player change in the last 24 h touched a lever of the winning mechanism on the judged
     host (caps and weights for the CPU family, MXT/MAXDBAT for THREAD_LIMIT, routing, classification or goals of
     the hurt class or its servers). The reply names the change.
   - `NEW_WORKLOAD` as now for the new work, and for work collateral to it (same footprint rule, the new workload's
     hosts as reach) for the same two days.
   - `DEMAND_SURGE` when the workload's arrivals that hour were at least 1.25 × its slot-baseline rate (covers
     payday, month-end and deadline week without making them cards). For collateral victims, when a co-hosted
     workload's were.
   - Otherwise `GROWTH` and `POLICY` are **both accepted**; the primary is as today. "Growth crossed the headroom"
     and "the configuration has no headroom" describe the same state, and no visible data separates them.
5. **Vocabulary** (labels and help text only; ids unchanged, so saves and bots are untouched):
   - `ACCESS_PATH_REGRESSION` is shown as **Change regression**: "a software or configuration change made the same
     work cost more or behave worse: a REBIND, a release, a redeploy, an agent upgrade, a mandate".
     ENCRYPTION_MANDATE, MONITOR_CREEP, QR_RELEASE, ZIIP_LOSS and SMF_AUDIT move to it.
   - `POLICY` is shown as **Policy or configuration**: WLM policy, PR/SM weights and caps, routing, subsystem limits.
   - `STORAGE` help adds "or a subsystem ran short of its own storage (CICS short on storage)", and CICS_SOS accepts it.

### 4.5 Grouping by cause

`truth.cause` is the primary card's `uid`, or `new:<workload>`, `change:<id>`, or `none:<mechanism family>:<host>`.
Incidents group when their causes are equal and they overlap or follow within two hours. A group's accepted set is
the union of its members'; its primary is the lead's. Joining a group whose RCA is already filed inherits it only
for the same card `uid`; otherwise the incident is listed as new. Effects: a power cap is one group whatever
mechanisms its victims show; two unrelated policy misses on different images stay apart; the batch night joins the
day's card only when that card reached it.

### 4.6 What "evidence for a mechanism" means

Evidence supports a **claim** when the pins together satisfy a **proof recipe** for it. A recipe is two predicates
that separate the claim from its nearest look-alike: one shows the symptom on the right subject, one shows (or rules
out) the discriminator. Recipes live in `content/evidence.ts` beside the metrics. Examples:

| Claim | Predicate 1 | Predicate 2 (the discriminator) |
|---|---|---|
| CPU_PRIORITY | CPU delay ≥ 10 % on the hurt class, its regions or its server, on the judged host | a displaceable consumer on that host: APPL of another class ≥ 10 % of the image |
| CPU_CAPACITY | as above | CPC or image busy ≥ 90 %, or a capacity adjustment below 100 |
| CAPPING | as above | Partition Data capped (WLM%) ≥ 5 % on that host, or CAP delay on the class |
| DEPENDENCY | the server's class delayed (CPU delay ≥ 10 %, or velocity under goal) | the hurt class's own CPU delay low (< 10 %), or its work-manager state "waiting" |
| THREAD_LIMIT | MXT wait or queued-DBAT count up | CPU per transaction and QR wait normal (a ruling-out pin) |
| DEMAND_SURGE | ended rate ≥ 1.25 × baseline on the surging workload | its CPU per transaction within ±15 % of baseline |
| Change regression | CPU per transaction ≥ 1.3 × baseline | its ended rate within ±15 % of baseline |
| RUNAWAY_WORK | APPL of one class or job up by ≥ half an engine | that work's ended rate flat |
| HARDWARE_FAULT | the resource's own report (CF sync time, DASD DISC, capacity adjustment, failed share on one region) | the same workload's rate and CPU per transaction normal |

Consequences for the matcher:

- A pin has a **relation** to the incident (`self`, `server`, `competitor`, `host`), computed from a snapshot of the
  hurt workload's classes, hosts and servers **taken when the incident opens**. `anySubject` goes away; each
  predicate names the relation it needs. This fixes A9 and A10.
- Predicates may ask for a value to be *normal*. Pins store the baseline beside the value so "flat" can be judged.
- New pin sources for the rows of A11 (Partition Data busy and capacity adjustment, CP/IIP split, CF Activity, DASD
  Activity per LCU, region storage, top-consumer job rows, work-manager states).

- Scoring: a complete recipe for the filed mechanism (if accepted) is worth what three relevant pins are worth today;
  a second complete recipe for the filed trigger makes the evidence "strong". A lone symptom pin earns the half
  weight a non-specific pin earns today. The three-pin limit stays: two recipes can share the symptom pin.
- The reply shows the recipe with each predicate ticked or not, in report terms. That is also the natural hint
  surface (§5.4).

**As built (RT-12).** `PinRelation = 'self' | 'server' | 'competitor' | 'host'`. `pinRelation` derives it from the
incident's recorded subjects: `self` is the work's own class or period, its Db2 101/CICS 110 row (subject = workload)
or its SMF 30 night; `server` is a `SYSWKM` row whose jobname and image match a serving region, or a region class
(`serverClasses`); `host` is an incident image, or the CPC one of them sits on; `competitor` is any other class row,
and only from an image the work runs on (never `*PLEX`). Class rows in any relation must name a host image or
`*PLEX`, so the mirror of A9 — the work's own class on an image it never runs on — does not count either, and a
competitor is judged from the row's own shape rather than today's definition, so an `ACTIVATE_POLICY` cannot change
a frozen row's verdict (A10). Each metric carries `relations` (`SYMPTOM` = all, `OWN` = self/server,
`OWN_OR_COMPETITOR`, `HOST_ONLY` = host, batch jobs = self), and the judge rejects a pin whose relation is missing or
not listed before it looks at size or mechanism. Pins also carry an optional `baseline`: the median of the same row
over the six preceding report intervals (each `rmfIntervalMin` long) or closed SMF hours, or 1 for `CPU_VS_BASE`
(already a ratio). Monitor III pins carry none: that view normalises APPL and ended/s differently from Workload
Activity, and its history only holds the pinned range, so a baseline from another view would not compare. No recipe
reads the baseline yet — that is RT-13.
### 4.7 Incidents caused by the player

Covered by §4.4(4): the trigger is POLICY, the reply names the change, and under D1 nothing is gated (there is no
card). A cap, limit or routing change that the player made and that hurts collateral work follows the footprint
rule with the change as the "card".

### 4.8 Bots, balance bands, determinism

- **Sim hash**: unchanged by everything in §4. Truth, evidence and grouping are game state. The new per-host CPU
  wait, `serverCpu` split, baseline-hold reference queue and failure sources are reporting-only sim fields; prove it
  with `npm run compare --drop`.
- **Scoring-only changes** (accepted sets, vocabulary, grouping, evidence, snapshot): no bot except `oraclerca`
  files RCAs, and no bot reads scores, so the SPEC §16 bands (do-nothing loses day 12–18, textbook to day 28–32,
  expert wins) cannot move. `oraclerca` and human scores rise. Goldens that hash score or incidents change and need
  a Behaviour note.
- **Primary-label changes** (slot baseline, displaceable CPU, host choice, serverCpu, thread-limit reference,
  trigger ranking and fallbacks) do move bots, because the strategies read `inc.truth` directly:
  `obviousHourly` applies a fix when an active card's trigger equals the incident's (more collateral incidents will
  match → fixes applied earlier → textbook/expert slightly stronger); `tunePolicyIncidents` raises MXT/MAXDBAT on
  `THREAD_LIMIT/POLICY` (more of those after the reference change); `buyCapacityForIncidents` buys a CP on repeated
  `CPU_CAPACITY` (Revenue G1 stops triggering purchases; saturated Midwest days start to). Each such entry needs
  `npm run sweep:remote` on the three scenarios and a band check; they are marked `sim`/`balance` accordingly.
- **Determinism**: every rule is a pure function of closed-hour accumulators and the event list. Slot baselines are
  plain arrays in run state. No iteration order matters once the alphabetical tie-break is replaced by accepting both.
- **Alternative considered: counterfactual replay.** Because the sim is deterministic, the game could re-run the
  opening hour from a kept state with one card's `end` commands applied at the hour start, and call the card a cause
  iff the SLA would then have been met. That is exact (it would have decided every row of §2 without footprints),
  but costs an hour of sim (360 ticks) per qualifying card per incident, in the worker, against the 4 ms tick budget,
  and slows sweeps. Not recommended now. It is a good offline **validator** (built as RT-06:
  `npm run inspect -- <file> blame`): a headless tool that replays incidents both ways and reports where footprint
  attribution and the counterfactual disagree would keep the footprints honest. RT-25 revises it: every card active
  in the hour is ended, one at a time (so a card hurting work it never declares is found), and a card is a cause when
  the hour's **attainment gain** clears a **noise floor** measured from red-herring cards (`CP_SPARING`, any card with
  no declared `affects`), whether or not the SLA would then have been met (so a joint cause still counts). The RT-06
  verdict stays in the output beside it, so the two can be compared.

## 5. D1 on top of it: fixes unlocked by proof

A draft for the user. It assumes §4.1, §4.4 and §4.6 are in place.

### 5.1 What unlocks a fix

A card's targeted fix appears in Operations when the player has filed a **diagnosis** that (a) names an accepted
mechanism and an accepted trigger for that card and (b) carries a complete recipe (§4.6) for the card's
**unlock claim**. The label alone never unlocks; the proof does. So the form cannot be brute-forced by trying
labels, and a lucky label without evidence gains nothing.

Several cards never open an SLA incident (REORG_OVERRUN stretches batch; ZIIP_LOSS and SMF_AUDIT raise MSU;
REGRESSION on a roomy day, R-3). D1 therefore needs a diagnosis that does not hang on an incident: a **problem
record** the player opens on a subject (workload, class, image or job) and a time window, with the same form and
pins. An incident is a problem record the game opened. Without this, D1 would lock the fix of exactly the cards a
good analyst catches early.

What the player was *told* counts as half a proof. A forewarning ("REBINDs ran overnight") or a perk tip satisfies
the "what changed" predicate; the player still pins the measurement. Announced cards (CF_LINK, CF_FAILURE,
POWER_CAP, JOB_ABEND) have no targeted fix and are not gated. Today a forewarned card's fix can be armed before the
card starts (`armableEvents`); under D1 arming needs the same proof, so it is possible only from the second
occurrence or with a tip. That is a visible nerf to preparation and needs the user's call (§7 Q8b).

### 5.2 Unlock recipes per card

| Card (fix) | Unlock claim | Proof: both needed | Tool for the second pin |
|---|---|---|---|
| RUNAWAY (CANCEL_RUNAWAY) | runaway work in DDF | APPL of the DDF period up ≥ half an engine; ended rate of that work flat | tier 0 (WLMGL) |
| REGRESSION (REBIND_REVERT) | change regression on a package | CPU per transaction ≥ ×1.3 on the workload; its ended rate flat. The forewarning or Db2 Whisperer tip may stand in for the first | CICS_MON or DB2_ACCT; tier 0 with a per-workload report class: service per transaction from WLMGL |
| BOT_ATTACK (BLOCK_BOTS) | surge of cheap requests | ended rate ≥ ×2; CPU per transaction ≤ ×0.7 | DB2_ACCT, or WLMGL service per transaction |
| RETRY_STORM (MOBILE_BACKOFF) | surge that is retries | ended rate ≥ ×2 at flat CPU per transaction; **a retry discriminator that does not exist yet** (§5.3) | — |
| XLOG_LOOP (CANCEL_XLOG) | runaway job in a class | STCHI APPL up ≥ half an engine with CICS ended rates flat; the job named as top consumer (new pin) | RMF_MON3 |
| ENCRYPTION_MANDATE (SCOPE_ENCRYPTION), VENDOR_PRICE (NEGOTIATE_MLC_PRICE), SMF_AUDIT (SCOPE_SMF_AUDIT) | — | Not gated: these are negotiations with a stakeholder about an announced demand, not diagnoses | — |
| REORG_OVERRUN (TERM_UTILITY) | utility I/O on the batch volumes | LCU 21 IOSQ up (new DASD pin); critical jobs' I/O wait share ≥ 25 % or batch class I/O delay | CF_DASD; SMF30_BATCH or WLMGL |
| MONITOR_CREEP (ROLLBACK_MONITOR) | change regression in an agent | STCMED APPL up on every image; MONAGENT as top consumer (new pin). The forewarning stands in for one | RMF_MON3 |
| LOCK_ESCALATION (COMMIT_SETTLEMENT_OFTEN) | batch holding locks | lock wait per transaction up; the hurt class's CPU delay low | DB2_ACCT; tier 0 |
| SHADOW_IT (STOP_SHADOW_IT) | runaway or new TSO work | TSO APPL ≥ ×3 with ended rate flat; DEVT or PROD image share up (Partition Data) | PARTITION_DATA |
| QR_RELEASE (ROLLBACK_TELLER_RELEASE) | QR TCB after a release | QR wait up on the PROD1 regions; PROD2 regions normal. The forewarning stands in for one | CICS_MON |
| HSM_RECALL_STORM (HOLD_HSM_RECALLS) | I/O surge on the system LCU | LCU 30 IOSQ up; Db2 LCUs normal (new DASD pins) | CF_DASD |
| ZIIP_LOSS (NATIVE_SQL_PROCS) | zIIP eligibility lost | DDFPRD CP APPL up and IIP APPL down (new split pin); ended rate flat. The forewarning stands in for one | tier 0 |
| CICS_SOS (RECYCLE_PROD2_AORS) | short on storage | MXT wait up on PROD2 regions; EDSA at EDSALIM or SOS time (new pin) | CICS_MON |
| SICK_AOR (RECYCLE_SICK_AOR) | a region failing fast | failed share ≥ 1 % on one region; its response time normal or better | CICS_MON |

Revenue's twins follow their originals. Harbourline's fix-less adaptations are unaffected.

### 5.3 The retry storm cannot be proven today

R-5: RETRY_STORM and CAMPAIGN are the same command (`rate ×2.5` on MOBILE) and produce identical reports. "END/S up
at unchanged CPU per transaction" (the D1 note) is true of both. Options:

1. **A realistic side-effect on the card.** Retries follow client timeouts, so a storm should come with abandoned
   work: a higher share of rolled-back or abnormally ended threads in Db2 accounting, or timeouts at the
   distributor. *Unverified*: the book search in this session did not confirm which accounting field an analyst
   would read (searched Db2 13 Managing Performance for rollback/abort counters in the accounting sections); it
   needs a `zos-docs` pass before it is modelled (RT-23 is `blocked: research`). It also needs the card to stop
   being a fixed multiplier, or at least to expose a second modifier.
2. **An inbox clue from the application team** ("many duplicate request IDs") on the hint ladder, accepted as the
   second half of the proof once received. Cheap, but then the proof is "wait for the mail".
3. **Leave it ungated**: the storm keeps an open fix, and D1's first showcase is a card with a real discriminator
   (REGRESSION or XLOG_LOOP).

Recommendation: 3 now, 1 when researched. The user ruled out a gateway retries view as too generous (2026-11-05);
option 1 is an indirect signal in a record the player already has.

### 5.4 The cost of a wrong diagnosis

Proof-gating already removes label brute force. What is left to price is pin-and-label fishing:

- Filing a diagnosis costs **0.25 engineer-hours**, right or wrong (writing it up).
- A filed diagnosis with a wrong mechanism costs trust as a wrong RCA does today (−0.5 on the hurt facet), once per
  problem per day. Re-filing on the same problem is allowed after one simulated hour.
- At most **three** diagnoses per problem per day. The third wrong one closes the form for that problem until the
  next day (the fix is then reachable only through generic levers that day).
- The reply to a wrong or incomplete diagnosis shows which predicate of the recipe was missing, at the clarity of
  the difficulty's hint level (CLEAR: names the report and the comparison; VAGUE: names the report; NONE: only
  "incomplete").

### 5.5 Hint ladder

Hints for a running, undiagnosed, silent card arrive in the inbox by time since it started hurting (first breached
hour or first notable deviation), never naming the mechanism, trigger or fix (SPEC §11.2):

| Step | Content | Story (CLEAR) | Normal (VAGUE) | Hard, Ironman (NONE) |
|---|---|---|---|---|
| 1 | A stakeholder symptom ("mobile feels slow since lunch") | +1 h | +2 h | +4 h |
| 2 | Where to look (the report of predicate 1) | +2 h | +4 h | — |
| 3 | What to compare (predicate 2, e.g. "is each request costing more, or are there more of them?") | +3 h | next morning | — |

The Mentor perk moves one column to the left (as `hintLevelFor` does). Card perks (Db2 Whisperer) and Ask Around
rumours deliver step 3 for their card at once; that is what they cost a perk slot or hours for. A hint never
completes a proof by itself except where §5.1 says a tip stands in for the "what changed" half.

If a recipe's second pin needs a tool the player does not own, step 2 says which record would show it. The gate must
never require a tier-3 tool, and for cards with `minDay` below 6 it should have a tier-0/1 path (the WLMGL
service-per-transaction path for REGRESSION is the model).

### 5.6 What stays open

Everything that is not a card's targeted fix: WLM policy edits and activations, routing, MXT/MAXDBAT/EDSALIM, PR/SM
weights and logical CPs, defined capacity and group caps, On/Off CoD and hardware orders, job restarts and holds,
structure moves, and the generic operations PT-20 proposes. The trade D1 wants is then real: pay hours, money or
trust for a generic lever now, or spend attention on the proof and get the cheap fix. PT-20's "each event registers a
general operation that fixes it" must respect the gate: a general operation that ends a card (recycle a region)
stays open only where a competent operator would do it without knowing the cause.

### 5.7 Bots

Today `obviousHourly` and the fixer's `ON_SIGHT_FIXES` apply a card's fix the tick it is running. Under D1:

- Bots must go through the same gate: build pins from report data by recipe (not from `inc.truth`), file the
  diagnosis, and apply the fix when it unlocks. A recipe that cannot be satisfied from the data shows up in sweeps as
  a card that is never fixed, which makes the sweep a standing test for unpinnable cards.
- **Textbook** owns tier-0/1 tools only and diagnoses after a fixed delay per card (a competent analyst: 2 h);
  cards whose recipes need tier 2 it handles with generic levers. **Expert** buys tools on the `--reader` schedule
  and diagnoses after 1 h. **Do-nothing** and **spend-to-win** are unchanged.
- Expect the textbook band (survives to day 28–32) to move earlier and the expert's grade to drop; both need a
  re-tune of event severity or fix costs, a balance call after a three-scenario sweep.

## 6. Order of work

The work is BACKLOG.md list `rca-truth`, numbered in dependency order (user decision 2026-11-10, replacing the
PT-25 … PT-47 entries this document first proposed). Gating uses the `blocked: after <ID>` status, so `dev-loop`
cannot pick an entry before its prerequisites are merged.

1. **Committed (RT-00 … RT-15).** Bot fix lookup by card, so bot behaviour does not depend on trigger labels (RT-00, before RT-09 and RT-14). Bugs and missing pin sources (RT-01 … RT-05, RT-08, RT-10, RT-11), the
   counterfactual validator (RT-06, moved earlier from Q10), accepted answer sets (RT-07), wording (RT-09), pin
   relations (RT-12), proof recipes (RT-13), card footprints (RT-14), grouping by cause (RT-15). Of these only RT-02,
   RT-09 and RT-14 move truth labels and need sweeps. RF-02 stays in `realism-fixes`.
2. **Human playtest** on the result, when `dev-loop rca-truth` reports the list finished (only blocked entries left).
   Footprints come before it because most "one cause, several truths" complaints are collateral blame (§3 A2).
3. **Parked until that playtest (RT-16 … RT-21):** the CPU split (RT-16, first in line: Revenue G1 is still judged
   capacity and bots buy CPs on it), hour-of-day baselines (RT-17, deferred), fallback triggers (RT-18), server CPU
   and the thread-limit reference (RT-19), failure sources (RT-20), batch nights (RT-21).
4. **D1 (RT-22 … RT-24)**, after the user's Q8a/Q8b and Q9, and PT-20's design call.

D1 depends on RT-05, RT-07, RT-12, RT-13 and RT-14. It does not depend on RT-16 … RT-21, because unlocking is
judged against accepted sets and recipes, not against the primary label.

## 7. Decisions for the user

| # | Question | Recommendation | Decision (user) | Unblocks |
|---|---|---|---|---|
| Q1 | §4.1: accept a set of answers at full credit, with the primary named in the reply? Add the 1-point family credit? | Yes; yes | Yes to accepted sets; **no** family credit (2026-11-10) | RT-07 |
| Q2 | §4.4(5): relabel the two triggers and move five cards to "Change regression"? | Yes (labels only) | Yes (2026-11-10) | RT-09 |
| Q3 | §4.6: evidence as two-predicate recipes, pin relations instead of `anySubject`? | Yes | Yes, and every common recipe needs a tier-0/1 path (2026-11-10) | RT-12, RT-13 |
| Q4 | §4.5: group by cause identity; stop silent inheritance across different causes? | Yes | Yes, with two refinements: card causes group across the played day (the two-hour window applies only to non-card causes), and RT-15 lands after RT-14 (2026-11-10) | RT-15 |
| Q5 | §4.4: card footprints, fresh-before-background ranking, accepted both ways for collateral victims; tested fallbacks (surge by rate, player change, GROWTH and POLICY both accepted)? | Yes | Yes (2026-11-10); the fallback half (RT-18) is parked until the playtest | RT-14, RT-18 |
| Q6 | §4.2: hour-of-day baselines, co-dominance at one third, incident-long accepted set? | Yes; the thresholds are tunables | Deferred until after the playtest (2026-11-10) | RT-17, RT-19, RT-20 |
| Q7 | §4.3: displaceable CPU instead of importance donors, judged on the host of the delay, with bands? | Yes | Open; after the playtest | RT-16 |
| Q8 | §5: D1 as proof-gated fixes with problem records; arming a forewarned fix needs proof; costs of §5.4; ladder of §5.5? | Yes, starting with REGRESSION and XLOG_LOOP | Split into Q8a (problem records, RT-22) and Q8b (gating, RT-24), decided separately; open | RT-22, RT-24 |
| Q9 | §5.3: retry storm ungated until a discriminator is researched? | Yes | Open | RT-23 |
| Q10 | §4.8: build the counterfactual replay as an offline validator? | Later, after RT-14 | Yes, **earlier**: RT-06, now, as RT-14's acceptance test (2026-11-10) | — |
