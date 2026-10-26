# Research ledger

Confirmed facts about real z/OS behaviour that the sim models (or chooses not to), each with its source and how
the sim stands against it. This is the place to look up "is this how z/OS really works?" and the place to record a
new finding.

- **SPEC §17** rates each model's fidelity and points here for the facts behind it. **SPEC §18** is the
  bibliography. **PROGRESS.md "Open questions"** holds only what is still unsettled; once a question is settled,
  its finding moves here. **PROGRESS.md "M8.7 Realism fixes"** holds the model changes queued by entries below.
- Page links use the PDF page index (`#page=N`), which can differ from the printed page number. Books are the z/OS
  3.1 editions unless noted. Redbooks are point-in-time snapshots by their authors; the edition date is given, and
  the z/OS book wins where both cover a fact.
- **Checked** = the page was read and says what the row claims. **Web** = cited from a web page or practitioner
  source; not checked against a book page.

Sim status:
- **Matches**: the sim does what the source says.
- **Approx**: same mechanism, simplified; the difference is stated. Code carries `// APPROX:`.
- **Fix queued**: the sim differs and a change is queued in PROGRESS.md "M8.7 Realism fixes".
- **Not modelled**: real behaviour the sim leaves out, on purpose.

Books referred to below:

| Short name | Book |
|---|---|
| WLM Planning | *z/OS MVS Planning: Workload Management* (ieaw100), [PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf) |
| Init & Tuning | *z/OS MVS Initialization and Tuning Reference* (ieae200), [PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieae200_v3r1.pdf) |
| RMF Report Analysis | *z/OS RMF Report Analysis* (erbb500), [PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf) |
| Setting Up a Sysplex | *z/OS MVS Setting Up a Sysplex* (ieaf100), [PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaf100_v3r1.pdf) |
| IP Config Guide | *z/OS Communications Server: IP Configuration Guide* (halz002), [PDF](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/halz002_v3r1.pdf) |
| CPSM Workloads | *CICS TS 6 CICSPlex SM Managing Workloads*, [PDF](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/cpsm-managing-workloads_pdf.pdf) |
| CPSM Admin | *CICS TS 6 CICSPlex SM Administration*, [PDF](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering-cpsm_pdf.pdf) |
| SG24-7621 | Redbook *ABCs of z/OS System Programming Vol. 12* (WLM), SG24-7621-00, Jan 2010, [PDF](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf) |
| SG24-6472 | Redbook *System Programmer's Guide to: Workload Manager*, SG24-6472-03, Mar 2008, [PDF](https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf) |
| SG24-7817 | Redbook *System z Parallel Sysplex Best Practices*, SG24-7817-00, Jan 2011, [PDF](https://www.redbooks.ibm.com/redbooks/pdfs/sg247817.pdf) |

## WLM goals and the performance index

| Fact | Source | Checked | Sim status |
|---|---|---|---|
| PI = actual ÷ goal for response-time goals, goal ÷ actual for velocity goals; PI > 1 misses the goal | [SG24-7621 p.95 §3.6](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=95) | Checked | Matches (`src/sim/wlm/goals.ts`) |
| Discretionary work has a fixed PI of 0.81; discretionary is only allowed in the last period and is SYSOTHER's goal | [SG24-7621 p.95](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=95), [p.40 §1.14](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=40) | Checked | Matches |
| Percentile goals use 14 buckets; bucket 14 is > 4× the goal, so a percentile PI lies in 0.5–4.0 | [SG24-7621 p.101–102 §3.10](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=102) | Checked | Matches (`goals.ts`) |
| Velocity = using ÷ (using + delay) × 100. Using = CPU and DASD connect; delay = CPU, storage (paging, swapping, MPL, server AS creation) and DASD I/O delay (IOS queue, subchannel pending, CU queue) | [WLM Planning p.70–71](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=70) | Checked | Approx: analytic time-average concurrency instead of samples; CU queue folded into pending (`src/sim/wlm/evaluate.ts`) |
| WLM samples work states every 250 ms | [SG24-7621 p.93 §3.5](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=93) | Checked | Approx: analytic equivalent, no sample counts |
| Period switching counts service units; since V2R5 service = CPU + SRB service units (I/O and MSO coefficients removed) | [WLM Planning p.69–70](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=69) | Checked | Matches (`src/sim/workload/periods.ts`); zIIP time not normalised to CP speed (Approx) |
| Report classes report on a subset of a service class or across service classes (homogeneous / heterogeneous) | [WLM Planning p.113 ch.12](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=113) | Checked | Approx: one row per report class, goal and PI only for a single-period source |

## WLM policy adjustment and dispatching

| Fact | Source | Checked | Sim status |
|---|---|---|---|
| Policy adjustment runs about every 10 s: picks one receiver, fixes its biggest delay with one or more donors that use the resource, and assesses the change before doing it | [SG24-7621 p.105 §3.12](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=105) | Checked | Approx: projection uses the sim's dispatcher model; IBM's thresholds are not published (`src/sim/wlm/adjust.ts`) |
| Dispatch priorities: 255 SYSTEM, 254 SYSSTC, 253 small consumer, 252–208 managed goal work, 207–202 unused, 201–192 discretionary, 191 quiesced | [SG24-7621 p.110–111 §3.14](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=110) | Checked | Matches (`src/sim/zos/dispatcher.ts`) |
| WLM puts special system address spaces (GRS, SMF, CATALOG, MASTER, XCFAS, WLM…) in SYSTEM; SYSSTC runs at a very high DP | [WLM Planning p.74](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=74), [SG24-7621 p.108–109 §3.13](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=108) | Checked | Matches (`src/sim/wlm/types.ts`) |
| Enqueue promotion: a holder of a resource another unit wants is promoted for a limited time and not swapped out | [SG24-6472 p.109 §3.2](https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=109) | Checked | Approx (`adjust.ts`) |
| Blocked workload support: work not dispatched for BLWLINTHD (default 20 s) is promoted; BLWLTRPCT (default 5 = 0.5 %, range 0–200) bounds the CPU used and so how many units get promoted | [Init & Tuning p.427 IEAOPTxx](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieae200_v3r1.pdf#page=427) | Checked | Approx (`evaluate.ts`) |
| IIPHONORPRIORITY=YES (recommended default): CPs run zIIP-eligible work in priority order when zIIPs need help; NO: CPs never help. zIIPs defined but offline → work runs as if not zIIP-eligible | [Init & Tuning p.430–431](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieae200_v3r1.pdf#page=430) | Checked | Matches (`dispatcher.ts`) |
| Service class Honor Priority = NO stops that class's specialty work overflowing to CPs; for CICS/IMS regions all transaction classes in the region must say NO | [WLM Planning p.121–122](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=121) | Checked | Matches (`src/sim/workload/slices.ts`) |
| Long-term CPU protection (CPU Critical = YES) keeps less important work from getting a higher DP | [WLM Planning p.120](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=120) | Checked | Matches (`adjust.ts`) |
| I/O priority management: SYSTEM and SYSSTC I/O is not managed; discretionary I/O may be throttled but never favoured | [WLM Planning p.43](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=43), [p.115](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=115) | Checked | Approx: IOSQ reordered by DP per image (`evaluate.ts`) |
| CICS/IMS regions are managed to the goals of their transaction service classes by default, or to the region's own class (REGION) | [WLM Planning p.122](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=122), [SG24-7621 p.135–139 §3.30–3.32](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=135) | Checked | Approx: no per-region split of work (`src/sim/core/step.ts`) |

## Discretionary goal management

| Fact | Source | Checked | Sim status |
|---|---|---|---|
| Eligible work is not in a resource group and has a velocity goal ≤ 30 or a response-time goal > 1 minute | [WLM Planning p.118](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=118) | Checked | Matches (`DISC_GOAL_MGMT` in `src/content/wlm/tuning.ts`) |
| Capping starts when the class's PI is below 0.71; WLM keeps the capped work's PI between 0.71 and 0.81, so very little is taken | [SG24-6472 p.201 (printed 183)](https://www.redbooks.ibm.com/redbooks/pdfs/sg246472.pdf#page=201) | Checked | Approx: starts below 0.71, stays capped below 0.81; the cap is proportional to the distance from 0.81 (FICTIONAL gain, floor 50 %) instead of WLM's projection |
| Further conditions (not a recent receiver or donor, not a small consumer, last uncapped non-discretionary period, not a significant CPU receiver candidate), all of which must hold | [SG24-7621 p.177 Fig. 4-22](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=177) | Checked | Small consumers skipped; the rest Not modelled (not in the z/OS book, unexplained) |

## Resource groups, defined capacity and group capacity

| Fact | Source | Checked | Sim status |
|---|---|---|---|
| Resource group types: 1 = unweighted CPU SU/s (sysplex-wide), 2 = % of the LPAR share and 3 = CPs × 100 (both per system), 4 = MSU; set minimum and maximum consumption; "Include Specialty Processor Consumption" option | [WLM Planning p.57–63 ch.7](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=58), [SG24-7621 p.168 §4.17](https://www.redbooks.ibm.com/redbooks/pdfs/sg247621.pdf#page=168) | Checked | Approx: CP only; type 1 split by this tick's member demand; minimum while delay > using (Open question) |
| Defined capacity caps a partition only when its four-hour rolling average reaches the limit; spikes over the limit before that are allowed, and the R4HA after IPL starts from low values | [WLM Planning p.44](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=44) | Checked | Matches (`src/sim/cost/r4ha.ts`); cap is a flat MSU limit, not a phantom weight (Approx) |
| A capacity group caps like defined capacity (only while the group R4HA ≥ limit); each member's entitled share is proportional to its weight; WLM forecasts members from the previous interval, so a limit can take minutes to bite | [WLM Planning p.44–47](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=45) | Checked | Matches the `AbsMSUcapping=NO` default |
| `ABSMSUCAPPING=YES` in IEAOPTxx enforces the defined-capacity or group limit permanently, independent of the R4HA (default NO). Unrelated to PR/SM absolute capping | [Init & Tuning p.426–427](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieae200_v3r1.pdf#page=426), [WLM Planning p.45](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=45) | Checked | Not modelled (possible later lever); PR/SM absolute capping is (`SET_ABSOLUTE_CAP`) |
| While a partition is capped through a positive phantom weight (its weight-based share is above its defined capacity), its priority is effectively reduced and it may get fewer VH/VM logical processors | [WLM Planning p.46](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=46) | Checked | **Fix queued**: sim leaves polarity alone while capped |
| A hardware cap (Initial Capping) is not allowed for a partition in a capacity group | [WLM Planning p.47](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaw100_v3r1.pdf#page=47) | Checked | Not modelled |

## Sysplex routing

| Fact | Source | Checked | Sim status |
|---|---|---|---|
| SERVERWLM (since V1R9): the weight is a composite of available and displaceable capacity per processor type (CP, zAAP, zIIP), weighted by the server's current use of each type; PROCXCOST (1–100) penalises zIIP-targeted work crossing to CPs; ILWEIGHTING (default 0); weights normalised to 0–64. BASEWLM also counts zAAP/zIIP when no system is pre-V1R9; PROCTYPE applies to BASEWLM | [IP Config Guide p.555–557](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/halz002_v3r1.pdf#page=555) | Checked | **Approx**: `distMethod` BASEWLM = idle CP capacity, SERVERWLM = CP/zIIP composite of displaceable capacity (`wlmShares`, `src/sim/workload/routing.ts`); PROCTYPE, PROCXCOST and ILWEIGHTING not modelled |
| CPSM queue algorithm weighs task load vs MAXTASKS, region health (SOS, dumping, at MAXTASKS, stalled), link speed, RTA events and affinities, and prefers the region least likely to abend; the goal algorithm routes to the region best able to meet the response-time goal; region status is in the CF since CICS TS 4.1 | [SG24-7817 p.90–92 (PDF p.105)](https://www.redbooks.ibm.com/redbooks/pdfs/sg247817.pdf#page=105) | Checked | Approx: aggregate shares chase the best observed response, not per-transaction choice |
| Abend compensation: an unhandled abend sets the abend probability to 100 % and the region is unhealthy; it decays (rate undocumented); below ABENDCRIT it is healthy with doubled load, below ABENDTHRESH normal; an unhealthy region still gets work if nothing healthier exists; DTRPGM only; HANDLE ABEND abends are invisible | [CPSM Workloads p.34–35](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/cpsm-managing-workloads_pdf.pdf#page=34), [CPSM Admin p.274](https://www.ibm.com/docs/en/SSJL4D_6.x/pdf/administering-cpsm_pdf.pdf#page=274) | Checked | Approx: keyed on the current abend rate, not an ageing probability (`src/content/routing.ts`) |

## Coupling facility

| Fact | Source | Checked | Sim status |
|---|---|---|---|
| z/OS converts sync CF requests to async heuristically when sync service would cost more than async; since z/OS 1.2 lock, list and cache requests are all eligible, thresholds normalised to sender CP speed | [Setting Up a Sysplex p.189–192](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/ieaf100_v3r1.pdf#page=189); [IBM WSC paper](https://www.ibm.com/support/pages/system/files/inline-files/Sync_Async_Heuristic.pdf) | Checked (book); Web (paper) | Approx: per-type thresholds FICTIONAL, not scaled by CP speed (`src/sim/cf/cf.ts`) |

## RMF

| Fact | Source | Checked | Sim status |
|---|---|---|---|
| Monitor III common measurements (using, delay, workflow %, execution velocity) and MINTIME/range | [RMF Report Analysis p.50–55](https://www.ibm.com/docs/en/SSLTBW_3.1.0/pdf/erbb500_v3r1.pdf#page=50) | Checked | Approx: built from WLM's smoothed state (≈ 67 s), not a fixed MINTIME (`src/game/mon3.ts`) |

## Web and practitioner sources (not page-checked)

| Fact | Source | Sim status |
|---|---|---|
| HiperDispatch polarity: entitlement in engines decides VH/VM/VL counts; E < 1 → one VM | Watson & Walker Tuning Letter 2022 No. 1 | Approx (published rule of thumb; `src/sim/hw/prsm.ts`) |
| PR/SM overhead grows above about 2:1 logical to physical | [IBM z/VM tip](https://www.vm.ibm.com/perf/tips/prsmovhd.html) | Approx, coefficients FICTIONAL |
| LSPR workload category from RNI and L1MP (LOW/AVERAGE/HIGH table) | [IBM: Relating production workloads to LSPR](https://www.ibm.com/support/pages/relating-production-workloads-lspr-workloads) | Table matches; counters FICTIONAL (`src/content/smf.ts`) |
| CICS QR TCB is a single-engine limit; threadsafe programs move off it | [CICS threadsafe white paper](https://public.dhe.ibm.com/software/uk/itsolutions/leveragingmiddleware/new-face-of-cics/cics-threadsafe-whitepaper.pdf) | Matches |
| Db2 address space velocity goals and zIIP eligibility | [Db2 12 velocity goals](https://www.ibm.com/docs/en/SSEPEK_12.0.0/perf/src/tpc/db2z_determinevelocitygoals.html), [Configuring zIIPs](https://www.ibm.com/docs/SSEPEK_12.0.0/perf/src/tpc/db2z_ibmziip.html) | Matches as guidance |
| Tailored Fit Pricing: consumption against a committed baseline, discounted growth, no capping | [IBM TFP overview](https://www.ibm.com/support/knowledgecenter/SSLTBW_2.3.0/com.ibm.zos.v2r3.izsc100/containerPricingOverview.htm), Precisely blog | Approx (single-month baseline, no rollover) |

## Adding an entry

Verify the fact on the book page (the `zos-docs` skill finds and reads it), add a row with the PDF page link and the
sim status, and mark it Checked. If the sim differs, also add an unticked item to PROGRESS.md "M8.7 Realism fixes"
(or the current milestone's realism list). When the fix lands, change the status here and update SPEC §17.
