# PROGRESS.md

Status tracker for **GOAL MODE**. Update at the end of every working session.
Finished work is summarised; the full per-loop detail is in git history (`git log -p -- PROGRESS.md`).

## Current status

- **Phase:** M0–M7 and M8.9 done; M8 in progress; M9 released (user, 2026-10-26). Playable in the browser
  (`npm run dev`); published build: https://claude.ai/artifact/GD8gCYCtcpRMvdT9JybCVv (private; republish on request).
- **Last updated:** 2026-10-27
- **Next up:** Monitor III history follow-ups (pin evidence from a past interval; `play` CLI access), the rest of playtest round 2 finding K (M8.6), M8.4 events (27 in the deck; more only if a playtest asks for one). M8.1 and M8.2 closed (2026-10-27).
- **Repo:** https://github.com/piconaut/goal-mode (build-loop branch `dev`, renamed from `ccr-2af28431-vidfb0` on 2026-10-21; merged into `main` from time to time).
- **PRs to `main` (user request 2026-10-21):** open a PR `dev` → `main` at sensible milestones: a PROGRESS item or
  milestone ticked done (e.g. a scenario playable and swept, a model feature with goldens and sweep recorded), not for
  docs-only or in-progress work. Before opening: `npm run check` green, bench hash recorded, PROGRESS updated. Body:
  what changed since the last merge to `main`, test count, hashes, sweep results, anything waiting on the user. At most
  one open `dev` → `main` PR; later pushes to `dev` update it, so retitle/re-describe it instead of opening another.
  The body also needs a "## Behaviour change" section listing the golden changes since the last merge to `main` (CI
  `behaviour-note` gate). Each one gets a `pr-reviewer` review (base `main`, head `dev`), which it also posts on the PR
  as a reference comment. When the verdict is MERGE and all required checks are green, merge it with a **merge commit**
  (not squash, so `dev` and `main` keep shared history); otherwise fix or comment. No human approval is needed (user
  decision 2026-10-26). NEEDS USER verdicts go to the user.
- **Branch workflow (user request 2026-10-23):** each session works on its own branch cut from `dev`, opens a PR into
  `dev` with auto-merge, and CI merges it when green. CI (`.github/workflows/`): `check` (typecheck + all tests,
  goldens included); `behaviour-note` (a PR that changes `tests/golden/hashes.json` needs a filled-in
  "## Behaviour change" section, see the PR template); `perf-hash` (a PR labelled `perf` or titled "perf…" must keep
  the Midwest and Harbourline 1-day bench hashes of its base); `balance` (when goldens change: donothing/textbook/expert
  over seeds 1–5 must stay inside the loose bands in `tools/ci/balanceGate.ts`). After a rebase that conflicts on
  `hashes.json`, regenerate it with `UPDATE_GOLDEN=1`, never merge it by hand. Run one golden-changing PR at a time.
  GitHub settings (user): default branch `dev`; protect `dev` and `main` with these four checks required; allow
  auto-merge; delete head branches on merge. `main` requires the same checks but no approval: GitHub records Claude's
  PRs as authored by the user, who can't approve their own PR (user decision 2026-10-26).
- **Health:** `npm run check` green (370 tests). Headless (cloud box): day 1 3.25–3.7 s, steady days ~2.0–2.4 s;
  bots ~4 s/day. Bench hash (seed 42, 1 day) Midwest `be43ff16de564882` (since PR #9), Harbourline `be97b3e401164fc5`.
- **Try it:** `npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1` prints daily SLA/batch/MLC summaries,
  hourly busy/PI, and Postprocessor-style WLMGL, Partition Data, CF and DASD reports. `--dc PROD2=420` sets a defined capacity.
- **Calibration (seed 42, BASEPOL, no player action):** day 1–3 CPC peak ≈ 85% at 12:00; online SLAs 99.5–99.9% except
  MOBILE (96–98%). PROD2 runs hottest (no zIIPs + all ad-hoc BI). On days 1–2 batch starts at 20:00 into Mobile's
  evening peak and starves Db2 (F1) and DDF (F4) until WLM adapts. Critical batch (40 jobs) ends 04:13 → 04:44
  (deadline 06:00) and erodes with 0.4%/day batch growth. CF02 (shared, polling, weight 10): sync ≈ 1.4 ms, ~98%
  async (F8). Payday (15th, day 13) saturates the CPC and MOBILE misses SLA.

## Milestones

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

### M0–M6 — Foundation and playable vertical slice (done)
- [x] M0 scaffolding: Vite + React + TS strict, Vitest, purity test (`tests/sim/purity.test.ts`), seeded RNG, `npm run check`
- [x] M1 hardware, PR/SM, HiperDispatch polarity, dispatcher with Erlang-C (`sim/hw/`, `sim/zos/dispatcher.ts`)
- [x] M2 workloads and WLM: arrivals, classification, periods, PI, policy adjustment, CPU critical, blocked
  workload, RG min/max, discretionary, I/O priority, MPL/swap; BASEPOL with flaws F1–F6
- [x] M3 subsystems: CICS (QR/MXT, REGION mode), Db2 (BP/DBAT/locks), DASD, CF (structures, rebuild, duplexing),
  paging, MQ queue depth, nightly batch DAG with critical path (`sim/subsys/`, `sim/io/`, `sim/cf/`)
- [x] M4 capping and cost: R4HA, defined/group capacity, CAP delay, MLC, SCRT report, RMF/SMF records and
  Postprocessor renderers (`sim/cost/`, `sim/measure/`)
- [x] M5 game layer: commands, run state machine, economy, change board, events, incidents + RCA, draft,
  bots; Midwest Mutual with flaws F1–F12
- [x] M6 UI: worker, Ops Console, RMF browser, Change Desk, overlays, charts (`src/ui/LineChart.tsx`), autosave,
  screenshot driver `node tools/screenshot.mjs`
- [x] M6.1 user requests: classification rules view, Change Desk QoL and polish (sub-tabs, basket, cost/risk
  previews), service class / resource group editor, Monitor III charts, Ask around (with stakeholder mood),
  report-card toggle, saves keep Change Desk work

### M7 — Analytics, fog of war & strategic depth (done)
Insight is earned by investigating and spent on tools (`content/tools.ts`, `game/tools.ts`); tools reveal data
and cost CPU (`mods.measureCpu`). Tier 1: Monitor III, live WLM log, CPC view. Tier 2: Monitor III charting, CF
per structure, DASD per LCU, SMF 101/110/30/113, RCA evidence pinning. Tier 3: what-if, capacity planner, alerts,
automation + CoD, saved policies with a daily schedule. Tier 4: report classes + advisor, AIOps, TFP offer,
Finance tab, multi-day projects, Codex with contextual "?" hints.
- [ ] ~~RMF interval < 15 min needs the tool~~ dropped: the Postprocessor interval is just SMF INTVAL on real systems
- [ ] PROCU is per service-class period, not per address space (slices are not kept per tick). Add top address
  spaces if a diagnosis needs it
- Known gaps (APPROX, revisit only if gameplay needs them): per-AOR QR busy not shown in SMF 110 (QR is per LPAR);
  WLM "policy overrides" not modelled (whole policies are swapped); discretionary capping ignores "not a recent
  receiver/donor"; TSO users are not swappable address spaces; RMF doesn't split homogeneous report classes into
  periods; TFP unused baseline is lost (no rollover); lock requests never convert to async
- Dev aids (dev builds): `globalThis.__goalMode.send(msg)` with `DEV_INSIGHT`, `DEV_FAST_DAYS {days}`, `DEV_TFP_OFFER`

### M8 — Balance, difficulty, content & polish
Goal: a run that is fair, readable and replayable. Done when bots hit their targets on every difficulty,
three scenarios ship, a new player can finish day 1 with the tutorial, and an accessibility pass is clean.

**M8.1 Performance (prerequisite for bots and what-if)**
- [x] ~~Target ≤ 2 s per headless day~~ closed 2026-10-27 (user decision): the gate is the UI budget, ≤ 4 ms per
  tick in the worker, which holds; 2 s per headless day was a tooling convenience for bots and sweeps, not a game
  requirement (Midwest 2.56 s, Harbourline 5.27 s per day on the cloud box). Revisit only if sweeps become the bottleneck
- [x] Benchmark `npm run bench [-- --days N --seed S --hash]` (`tools/bench.ts`); `--hash` proves an optimisation is
  behaviour-neutral. Seed 42 hashes: 1 day `8a82ad7db2b258ae`, 3 days `55d9e06f477c9197`, 8 days `c2ec32ace44f6b06` (since PR #8)
- History: loop 21 ≈ 8.5 s/day → 2026-10-20 perf thread ~1.7–1.9× (index-based dispatcher/evaluator, shared
  projection demand stage, copy-on-write batch jobs, cached keys; textbook bot 6.3 → 4.1 s/day) → 2026-10-21
  `step` split into `lparDemand` / `dispatchLpar` stages sharing a `TickCtx` (day 1 4.05–4.18 → 3.25–3.7 s).
  Profile is flat (no function > 13% self); left: allocation (GC ~5–7%), log-normal buckets (~5%), and JIT
  deopts of `step` on days 1–4 as state objects change shape. Micro-opts are exhausted at ≤ 1% each (loops 91–92)
- 2026-10-21 (2nd thread): soft capping, PR/SM, policy adjustment and the R4HA/MLC/RMF tail are their own
  stages too (`softCap`, `prsm`, `adjustPolicies`, `stepCapping`, `stepCost`, `stepRmf`); `step` self time
  11% → 8%. Slice templates were already memoised; `buildSlices` now skips the key string and nested lookups
  per LPAR while inputs are unchanged, and Db2 use per workload is memoised. Hash-neutral; wall-clock gain is
  within this VM's noise (it measured ~2× slower than the day before: base 3-day run 14–17 s). Lesson: building
  slices with a field-by-field literal instead of a spread was ~40% slower overall (hidden-class split with
  the other slice copies), so keep slice copies as spreads
- [x] Structural options for 4× (closed with the target, 2026-10-27), in expected-value order: (1) ~~cache per-LPAR slice specs~~ (templates
  cached; the per-tick spread copy and demand fill remain, ~3%); (2) project only the periods at or below the highest DP a trial
  touches, as WLM does (SG24-6472-03 PDF p.66; `docs/research.md`); periods above it are unaffected by the move. Not
  receiver + donors only: WLM's net value test covers every class at or below the move. Should keep the bench hash;
  if it doesn't, check zIIP overflow and I/O for upward effects; (3) struct-of-arrays for scps/buckets to cut allocation; (4) evaluate DEVT/SYSP every 3rd
  tick (low-importance images, APPROX); (5) RMF accumulation every tick → running sums without object spreads.
  2026-10-27 profile (Harbourline day 5.27 s, Midwest 2.56 s): dispatchLpar 35 %, policyAdjust 8.4 % of which the trial
  projections are only 2.1 %, stepRmf 6.6 % (accumulateTick 5.2 %), GC 7.6 %. User decision 2026-10-27: (2) dropped, its
  ceiling is ~2 % and dependency health, CP queue ratio and I/O priority can carry effects upward; (5) shelved: in-place
  sums break `step` purity (realism tests step several branches from one base state), and a packed copy-per-tick
  accumulator would gain ~3 % for a save-format change and golden/bench hash churn; behaviour-changing skips ((4) or
  skipping quiet LPARs) not wanted. No hash-neutral item left above ~3 %; the 2 s target stays open
  Each must keep the golden hash or regenerate it with a reason
- Decision: the what-if simulator doesn't wait on M8.1 (runs in the briefing with the clock stopped, chunked)

**M8.2 Balance harness & targets (SPEC §16)**
- [x] `npm run sweep -- --bots donothing,textbook --seeds 1-20 [--jobs N] [--days D] [--out f.csv]` (`tools/sweep.ts`)
  → CSV + per-bot summary (day p10/median/p90, median score, ends by cause)
- [x] Golden runs (`tests/golden/`, seed 42, 2 days; regenerate with `UPDATE_GOLDEN=1 npx vitest run tests/golden`)
- [x] Bots: donothing (lose day 12–18), textbook (≈ day 28–32), spendtowin (On/Off CoD every day: SLA fine, loses on opex), expert (scripted good play incl. capacity orders and caps: wins with grade A on Normal)
- [x] Targets hold across ≥ 20 seeds (median and spread), not just seed 42; event-deck intensity, growth rates and trust weights tuned from sweeps
  - Closed 2026-10-27 (user decision): bot balance is done; from now on sweeps are a regression check (CI
    `balanceGate` on 5 seeds, 20 seeds to confirm a balance-affecting change), not a tuning target. The
    Harbourline expert wins 16/20 (80 %); its four trust ends (seeds 1, 2, 15, 20, three of them on day 40) are accepted as the
    hardest scenario's spread.
  - Latest results, Normal (day p10 / median / p90):
    - **Expert buys a permanent CP after repeated capacity incidents (adopted, user decision 2026-10-27; seeds 1–20,
      code 3a4acbf):** two or more CPU_CAPACITY incident days on a CPC within 7 days → order PERM_CP, then +1 logical CP
      on each prod image once it is applied. Ends unchanged from the base expert: Midwest victory 19 · opex 1 (score
      median 2790), Revenue victory 20 (2777), Harbourline victory 16 · trust 4 (2965, base 2960). It is kept because
      the expert should play the capacity lever a good analyst would, not because it moves the numbers.
    - **On/Off CoD revert fix + capacity trials (2026-10-27, seeds 1–20, keyed RNG streams):** a CoD lease used to
      revert to an absolute CP count taken at request time, so a lease could permanently lose a CP; fixed with a
      relative `ADD_CPC_ENGINES` command. Spendtowin after the fix: Harbourline opex 16 · trust 4 (was 18 · 2),
      Midwest opex 20, Revenue opex 20 — still loses on opex. Expert base: Harbourline victory 16 (trust 4), Midwest
      19 (opex 1), Revenue 20. Trial variants (not merged, user decision pending): expert + CoD after capacity
      incidents: Harbourline 15 (opex 1 · trust 4), Midwest 19, Revenue 20; expert + permanent CP after repeated
      capacity incidents: same outcomes as base everywhere. On Harbourline the permanent CP is unusable: its prod
      LPARs defined no reserved logical CPs, so the logical-CP raise failed (fixed: 2 reserved per PRD image). After the
      image-full label rule + reserved CPs (Harbourline, seeds 1–20): expert victory 16 (trust 4), spendtowin opex 16
      (trust 4), both unchanged; textbook 29 / 31 / 37, trust 18 · victory 2. Trials re-run on that code (Harbourline,
      seeds 1–20; CoD now also brings +1 logical CP online on the CPC's prod images for the lease): base expert victory 16
      · trust 4, end trust median 69.8, 256 capacity / 1129 incidents; + CoD victory 15 · trust 4 · opex 1 (seed 11:
      lease opex ends the run on day 28), trust median 76.0, 191 / 994; + permanent CP victory 16 · trust 4, trust
      median 73.5, 208 / 1031 (seeds 3, 5, 13 end at 92–98 trust). Neither turns a trust loss (seeds 1, 15, 20) into
      a win. User decision pending
    - **Full sweep (2026-10-26, seeds 1–20, code 937a2ee, before PRs #30/#31):** Midwest: do-nothing 12 / 16 / 21
      (trust 14 · batch 6); textbook 20 / 28 / 28 (batch 10 · trust 10); expert 40 / 40 / 40, victory 20/20; spendtowin
      28 / 28 / 28 (opex 19 · batch 1). Revenue: do-nothing 10 / 13 / 15 (trust 20); textbook 27 / 28 / 29 (trust 20);
      expert victory 19/20 (trust: seed 17, day 19); spendtowin 28 / 28 / 28 (opex 19 · trust 1). Harbourline: do-nothing
      9 / 12 / 13 (trust 20; seed 17 ends day 6); textbook 28 / 32 / 37 (trust 18 · opex 2); expert 28 / 40 / 40, victory
      only 13/20 (opex on day 28: seeds 5, 12, 13, 16; trust: seeds 8 day 40, 10 day 25, 19 day 33); spendtowin
      28 / 28 / 28 (opex 19 · trust 1). Early textbook trust ends: Midwest seeds 7 and 17 (day 17), Revenue seed 17
      (day 13), Harbourline seed 10 (day 12). Verdict: do-nothing, textbook and spendtowin targets hold in all three
      scenarios; expert holds on Midwest and Revenue but fails on Harbourline (65 %), so both boxes stay open.
    - **Post-M8.7 re-sweep (2026-10-26, seeds 1–20, dev 8984b9c = PRs #30/#31/#36):** Midwest and Revenue match the
      full sweep (same ends by cause, day percentiles within a day; Midwest: do-nothing 11 / 16 / 21, textbook 20 / 28 / 28, expert victory 20/20,
      spendtowin opex 19 · batch 1; Revenue: do-nothing 10 / 13 / 15, textbook 27 / 28 / 29, expert victory 19/20,
      spendtowin opex 19 · trust 1). Harbourline: do-nothing 8 / 12 / 15, textbook 28 / 32 / 37 (trust 18 · opex 2),
      expert victory 13/20 on the same seeds (opex day 28: 5, 12, 13, 16, month-1 bills
      $1.89–2.02M; trust: 8, 10, 19), spendtowin opex 19 · trust 1. So the three M8.7 realism fixes leave the balance
      where it was; the Harbourline expert opex wall remains → budget raised to $1.6M (below).
    - **Harbourline opex budget $1.5M → $1.6M (2026-10-26, user decision; seeds 1–20, Normal):** expert victory
      13/20 → 15/20, 33 / 40 / 40 (trust 4: seeds 8, 10, 13 day 39, 19; opex 1: seed 16, month-1 bill $2.02M against the
      new $2.0M limit); spendtowin still loses on opex (18/20, trust 2), so buying capacity every day stays too
      expensive; textbook 28 / 32 / 37 (trust 18 · opex 2) and do-nothing 8 / 12 / 15 unchanged. The M8.2 boxes stay
      open: the Harbourline expert win rate (75 %) is still below Midwest (100 %) and Revenue (95 %), and the remaining
      losses are trust ends.
      - [x] (Closed with M8.2, 2026-10-27: opex ends gone after the $1.6M budget and the CoD revert fix; trust ends accepted.) Investigate Harbourline expert losses: opex ends on day 28 (seeds 5, 12, 13, 16) recur even though the
        expert now declines BUDGET_SWAP; also the trust ends on seeds 8, 10 and 19. Re-check after the post-sweep
        re-sweep that includes PRs #30/#31.
        - Loop 4 (seed 5 on dev 4743420, after PRs #30/#31): still opex on day 28, and only just: the month-1 bill
          is $1,895,889 against a $1,875,000 limit (budget $1.5M + 25 %), so it is 26.4 % over. The month's MLC
          estimate goes $1452k → $1748k on day 12 (Holiday shopping-day card spike sets the month's R4HA peak, with the
          PRDA absolute cap removed and capacity setting +1 bought on day 1, and no defined capacity anywhere). The
          day-27 Vendor price increase then pushes it to $1896k. Candidate expert fixes (bot only, no model change):
          set a Harbourline defined capacity that bounds the peak R4HA, or prefer FRIENDS_IN_FINANCE (+10 % budget) in
          the review draft over the first-offered pick.
        - Loop 5, tried a bot-only defined-capacity rule. Each briefing it ratchets every PRD LPAR's defined
          capacity up to its month-to-date R4HA peak × headroom (never down). Not adopted.
          - FRIENDS_IN_FINANCE is a career unlock (xp 1400), so the bots never see it.
          - Seeds 5/12/13/16/1/2 before the rule: 2 of 6 victories (1, 2).
          - Headroom 1.05: every month-1 bill is inside the limit, but all 6 seeds collapse on trust (Market/Cards
            incidents from capping). This includes seeds 1 and 2, which won before.
          - Headroom 1.15: 3 of 6 victories (5, 1, 2). Seed 16 is still opex on day 28 (bill $1.891M); seeds 12 and 13
            end on trust (days 36/37).
          - In seed 5 the margin is the day-27 Vendor price increase (priceMult 1.08). Without it the bill is ~17 %
            over. The month's R4HA peak (4133 MSU) is set on day 19.
          - Next candidates are balance decisions, to try after the full sweep: a Harbourline opex budget nearer
            $1.6M (check that spendtowin still ends on opex), or the Vendor price increase landing less often in
            month 1.
        - Trust losses (2026-10-26): the expert now tunes away yesterday's POLICY incidents at briefing (bot only,
          `tunePolicyIncidents`): THREAD_LIMIT raises MAXDBAT (DDF) or MXT (CICS) ×1.5 on the workload's images (caps 2000 /
          1000), QR_TCB halves the AORs' `qrFrac` (floor 0.1). A CPU_PRIORITY importance bump was tried and dropped: on 6
          seeds it moved incidents onto the next class (2/6 wins, as before). Expert re-sweep, seeds 1–20, Normal:
          Harbourline victory 15/20 (trust 5: seeds 2, 12, 13, 15, 19, days 36–40; seed 16's opex end did not recur, but seeds were not paired then, see the 2026-10-26 RNG decision), QR_TCB
          incidents 28 → 1, THREAD_LIMIT 397 → 284, CPU_PRIORITY 621 → 828; Midwest victory 20/20, Revenue 19/20 (seed 17,
          unchanged), so no regression. The remaining Harbourline trust ends are heavy days with both CPCs at 90–100 % CP
          busy that the incident attribution labels CPU_PRIORITY/POLICY, because it pools busy across CPCs and averages it
          over the hour; fixing that attribution is next (user decision 2026-10-26).
        - Incident labels (2026-10-26, user chose importance-aware): `mechanismOf` calls a CPU incident CPU_CAPACITY
          when a host CPC averaged ≥ 90 % CP busy over the hour and < 10 % of the image's CP went to work less important
          than the hurt class (no WLM donors), else CPU_PRIORITY. A tried per-CPC "≥ 95 % busy for ¼ of the hour" rule
          relabelled Midwest almost wholly to capacity (PRIORITY 248 → 37). Expert sweep, seeds 1–20 (outcomes
          unchanged, labels only): Harbourline PRIORITY/CAPACITY 828/28 → 634/222, Midwest 248/232 → 349/131, Revenue
          123/2 → 125/0. Next: trial the expert buying capacity after yesterday's CPU_CAPACITY incidents (Harbourline
          trust-loss seeds 2, 12, 13, 15 and 19 had 9, 11, 25, 19 and 4 CAPACITY incidents).
    - **Loop-113 re-sweep (2026-10-21, seeds 1–20, after RETRY_STORM, per-scenario facets and PR #13):** do-nothing
      11 / 17 / 21, ends trust 14 · batch 6; textbook 17 / 28 / 28, ends batch 11 · trust 9 (median 28 reaches the 28–32
      target, but 10 of 20 runs end on a batch miss on exactly day 28: a fixed wall where nightly growth outruns the
      window and textbook buys no capacity; early ends are trust on days 17–22); expert 28 / 40 / 40, victory 17 · opex 3.
      Traced (loop 116): the wall is REG_DEADLINE (05:00 from day 20) plus 0.4%/day nightly growth. Textbook batch ends
      04:00–04:50 on days 20–26, then crosses 05:00 on day 27; two misses end the run on day 28. The batch-capacity
      reaction lives in `fixer` (expert, spend-to-win), not textbook, by design; the morning hint and batch projection are
      the clue path, and expert buys the capacity setting on day 1. No change: intended pressure, median on target.
    - **Post-PR #9 re-sweep (2026-10-21, loop 141, seeds 1–20, HiperDispatch E<1 → 1 VM):** do-nothing 12 / 16 / 21,
      ends batch 7 · trust 13; textbook 17 / 28 / 28, ends batch 11 · trust 9; expert 28 / 40 / 40, victory 16 · opex 3 ·
      trust 1. Same as loop 113 within one seed: the polarity change doesn't move balance. Expert's 3 opex ends (seeds 2,
      3, 11, day 28, bill ~$891k) and Harbourline's (seeds 5, 12, 13) all took the BUDGET_SWAP pact first (bots take
      draft card 0), so the budget is 10% lower and an ordinary bill is >25% over. Expert now declines that pact; all six
      seeds re-run to day-40 victories with unchanged bills (Midwest expert ≈ 19/20 wins).
    - **Post-PR #8 re-sweep (2026-10-21, seeds 1–20, 22 cards):** do-nothing 12 / 15 / 21, ends batch 10 · trust 10
      (median 15 is now on target, p90 a bit late); textbook 22 / 27 / 28, ends batch 12 · trust 8 (median 27 is still
      below the 28–32 target, p10 up from 17). Early textbook ends: seeds 13 (day 17) and 20 (day 24) are Retail trust
      collapses, and both drew NEW_APP_GOLIVE, so the booking decision still matters. Seeds 15, 17 and 5 (days 19–23)
      are batch ends, and all three drew REORG_OVERRUN + JOB_ABEND. Outlier: do-nothing seed 17 ends on batch on
      day 4 (JOB_ABEND only) and seed 9 on day 5. Cause: JOB_ABEND drawn on day 3 *and* day 4 (two unrestarted
      abends = two misses). Fixed: no card is drawn two days running (`drawEvents`); seed 17 now lasts to day 10.
    - **No-repeat re-sweep (loop 109, seeds 1–20):** do-nothing 10 / 16 / 21, ends trust 18 · batch 2 (seed 9 still ends
      day 5 on trust; next earliest seeds 12 day 8, 17 day 10); textbook 20 / 26 / 28, ends trust 12 · batch 8 (short: seeds
      1 day 15, 17 day 18, 3 day 20, all trust). Rule moved ends from batch to trust; textbook median 26 still below target.
    - **do-nothing** 9 / 13 / 18, ends trust 14 · batch 6 (loop 37; median ok, p10 a bit early; not re-swept since)
    - **expert** 40 / 40 / 40, victory 20/20 (loop 68, 19 cards); 4/4 victories in the loop 102 smoke sweep; loop 110 smoke after RETRY_STORM: 3/4 (seed 3 opex end day 28,
      bill month 1 898k vs 860k; it never drew RETRY_STORM and wins on the commit before, so it's the reshuffled deck,
      not the card). Watch in the full re-sweep
    - **spend-to-win** 28 / 28 / 28, ends opex 20/20 (loop 68): right cause, zero spread (opex wall is the month-1 close)
    - **textbook** 17 / 26 / 28, ends trust 14 · batch 6 (loop 68): **below target**. All eight Retail-trust
      collapses on days 16–24 drew NEW_APP_GOLIVE: the booking app is Retail-judged with an SLA and textbook never
      classifies it. Asked the user (keep / booking without an SLA or Internal stakeholder / forewarning that names
      the work / later minDay). **User decision 2026-10-21: (a) keep as is.** Spotting new work is part of the game;
      textbook's lower median on runs that draw NEW_APP_GOLIVE is accepted, not a balance bug
  - Textbook spread is near zero even without that card (loop 46: 27 / 28 / 28): the day-20 05:00 deadline beat
    plus 0.4%/day batch growth is a deterministic wall on days 27–28. Widening it (randomised growth or deadline)
    is a balance call for later. Idea (closed PR #3): give textbook one obvious batch reaction (e.g. more
    initiators when the critical path runs late) to lift its median toward 30 and widen the spread
  - User decision (loop 46): textbook is a "reads the manual, no diagnosis" floor: day-0 F-fixes, reacts only to
    abends and open SLA incidents. The diagnosing reactions live in the `fixer` base used by expert and spend-to-win,
    which end event cards on sight with their fix
  - Month-1 bill (loop 45 medians): textbook/expert/spend-to-win $832k / $862k / $837k against a $780k budget

**M8.3 Difficulty & run structure**
- [x] Difficulty presets Story / Normal / Hard / Ironman (`src/content/difficulty.ts`, applied in the game layer):
  growth, event rate and severity, constraint timing, budgets, start trust, starting fixes (Story: F7/F8/F11),
  hint level, pause rules; picker in the day-1 briefing and on the end screen; `--difficulty` on bot/sweep
  - [x] Bot sweeps per difficulty to check the presets land where SPEC §11.2 says (loop 52, seeds 1–10):
    **Story** textbook 28 / 29 / 30 (batch 5 · trust 5, Retail at 0), expert victory 10/10. **Hard** textbook
    18 / 24 / 26, expert 33 / 40 / 40 (victory 5 · trust 5). Hard separates well; Story barely helps a
    non-diagnosing player (same batch-deadline wall; merger lands in SYSOTHER). User decision: a clear merger
    hint two days ahead, on Story and Normal (`STORY_BEAT_HINTS`, loops 59/62). Bots don't read hints, so
    their numbers don't move. Re-sweep Story/Hard after the deck is complete
    - **Full sweep (2026-10-26, seeds 1–20, code 937a2ee, before PRs #30/#31/#36; day p10 / median / p90):**
      **Story** Midwest: do-nothing 21 / 25 / 27 (batch 14 · trust 6), textbook 19 / 28 / 30 (batch 7 · trust 13),
      expert victory 20/20. Revenue: do-nothing 15 / 16 / 19, textbook 29 / 30 / 31 (all trust), expert victory 19/20.
      Harbourline: do-nothing 11 / 15 / 18, textbook victory 18/20, expert victory 19/20.
      **Hard** Midwest: do-nothing 9 / 12 / 17, textbook 16 / 24 / 27 (trust 16 · batch 4), expert 28 / 40 / 40
      (victory 8 · trust 7 · opex 5). Revenue: do-nothing 8 / 9 / 12, textbook 26 / 27 / 28, expert victory 16/20
      (opex 3 · trust 1). Harbourline: do-nothing 8 / 10 / 11, textbook 18 / 26 / 28 (trust 15 · opex 5), expert
      25 / 28 / 33, no victories (trust 11 · opex 9).
      Verdict: the presets order every scenario as intended (Story > Normal > Hard for every bot). Open balance
      questions, for after the M8.7 re-sweep: Hard Harbourline is unwinnable for the expert bot (its Normal win rate
      is already only 65 %, the same opex day-28 wall); Story Midwest textbook still hits the batch-deadline wall
      (same as Normal); Story Harbourline is won by the textbook bot (18/20), so Story may be too easy there.
- [x] Morning hints (Story clear, Normal vague, none on Hard/Ironman; `src/game/hints.ts`, texts in `src/content/hints.ts`)
- [x] Weekend auto-simulation with the report card as summary; optional "play the weekend"
- [x] Endless mode after victory; daily seed challenge (`src/game/daily.ts`), startable from the day-1 briefing too
- [x] End-of-run report (`src/game/endReport.ts`): per-day score, PI heat-map history, R4HA chart, decisions
  timeline, biggest incident, best RCA, grade S–D
- [~] Meta-progression: career XP and seven levels unlocking starting perks (IndexedDB), level 7 unlocks a starting
  tool (Report Class Hoarder); Codex persists (localStorage). Still open: scenario unlocks (one scenario so far)

**M8.4 Content**
- [~] Events to ~25 (SPEC §9); 27 now (deck complete for this pass). Since M5: REORG_OVERRUN, CF_FAILURE, SHADOW_IT, QR_RELEASE,
  NEW_APP_GOLIVE, POWER_CAP, HSM_RECALL_STORM, CP_SPARING (red herring), HIRING_FREEZE, AUDIT_UNCLASSIFIED,
  ZIIP_LOSS (loop 104), CICS_SOS (loop 105), SMF_AUDIT (loop 106), RETRY_STORM (loop 110), XLOG_LOOP (loop 112: looping STC misclassified by the CICS* rule), ENCRYPTION_MANDATE and GREEN_IT_COD (loop 113). Re-sweep the bots once the deck is complete
  - VENDOR_PRICE (2026-10-23, user's option 1): `SET_MLC_PRICE` sets `cost.priceMult` (absent = 1, goldens unchanged);
    card +8% from day 10, permanent, once per run, in all three decks; fix `NEGOTIATE_MLC_PRICE` (3 h, Finance −1);
    TFP terms are not affected, later TFP offers are priced at the new list price
  - HyperPAV exhaustion dropped: organic LCU I/O is ~2k/s, so even zero aliases moves IOSQ < 0.3 ms (no symptom)
  - STORAGE card (DBA grows DB1B buffer pools on PROD2) not added (loop 107): it exposed a swap deadlock, fixed
    with `STORAGE_SWAP.minSwappedIn: 1`, but with the fix even +60 GB BP costs < 0.2 h of critical path. Needs a
    harsher paging model first
  - HSM storm magnitude 60k (75k is past the LCU 30 cliff, ≈ 15× response)
  - RCA truth: cards may declare `mechanisms`; `triggerOf` blames an active card only for incidents with one of them
- [x] More draft options and perks: every SPEC §9.5 opportunity type, 11 perks, 2 pacts (`content/draft.ts`).
  Loop 102 smoke sweep (seeds 1–4): no regression
- [ ] Scenarios: *Continental Insurance* (IMS-heavy claims batch, needs an IMS subsystem model), *State Revenue Agency* (tax-season spike, strict regulator), *Global Airline* (24×7, two CPCs/sites, GDPS-style constraints)
- [ ] Each scenario ships with its own flaw list (SPEC §13.3 rules) and story beats
- [x] *State Revenue Agency* playable (loop 114, SPEC §13.4): scenario packs (`content/packs.ts`, `--scenario revenue`,
  picker in the new-run dialog and day-1 briefing), per-scenario facets, flaws G1–G3/H1–H2, story beats with a
  two-day hint for pre-filled returns. First sweep (seeds 1–6, Normal): do-nothing 10 / 14 / 20 (trust 5 · batch 1,
  mostly Regulator after batch misses), textbook 26 / 29 / 30 (trust 6: Taxpayers or Regulator), expert victory 6/6.
  Agency deck done (loop 116: 16 adapted cards, see SPEC §13.4). 20-seed sweep with it (seeds 1–20, Normal):
  do-nothing 15 / 22 / 23 (trust 20, 19 Taxpayers; too late, target ~12–18: the 7-card deck's frequent audit cards are
  now diluted), textbook 27 / 29 / 29 (trust 20, all Taxpayers; on target), expert 40 / 40 / 40 (victory 19, trust 1).
  Tried G1 heavier analytics (0.3 → 0.45 qps, seeds 1–10): no effect (do-nothing 18 / 22 / 24, textbook unchanged), reverted.
  Both bots' incidents are mostly CPU_PRIORITY (do-nothing 298, textbook 217 over 20 seeds), so the planted fixes barely
  relieve the main pressure. Seed 5: do-nothing's hits are EFILE CPU_PRIORITY (G1); textbook's are the day-22 PREFILL
  app. Lowered WEBDDF to importance 4 (G1 bites harder; textbook gives e-filing its own class, so it is unaffected).
  Seeds 1–10: do-nothing 11 / 14 / 15 (on target), textbook 28 / 29 / 29 (unchanged). Codex already covers
  IIPHONORPRIORITY (`ziip`) and soft capping (`r4ha`). **20-seed confirmation (loop 117, Normal):** do-nothing
  10 / 13 / 15, textbook 27 / 29 / 29, expert 40 / 40 / 40 (victory 19, trust 1); all ends trust. Done; follow-ups:
  Story/Hard sweeps, textbook's day-22 PREFILL losses (its PFILAPI class still misses).
- [ ] Scenario (user request 2026-10-21): **large bank, big mainframe estate**, a harder run for experienced players.
  - **Estate:** several CPCs and many LPARs and sysplex members.
  - **Analytics at the start:** some tools are unlocked from day 1, so the challenge is diagnosis, not visibility.
  - **Harder problems.** Two the user named:
    - **Strongly spiky online workload:** bursty arrivals well above the hourly mean (e.g. flash events, open-of-market).
      WLM's 10 s adjustment and R4HA/capping lag behind it, so the player has to choose between headroom, goals that
      tolerate bursts, and capping (e.g. defined capacity vs. absolute cap).
    - **Workload-balancing issues across the sysplex:** sysplex distributor / CICSPlex SM routing and WLM routing
      recommendations send work to the wrong images, through skewed weights, a sick-but-alive region (storm
      drain) or uneven zIIP capacity. Fixes trade affinity against even load.
  - **Needs:** a multi-CPC world (the hardware catalog and HMC assume one CPC), finer-than-hourly arrival bursts in
    the workload model, and routing that reacts to image health.
  - [x] Design: SPEC §13.5 "Harbourline Bank" (2 CPCs, 6 LPARs, starting tools; Problem 1 spiky markets work with
    four fix families; Problem 2 flaws B1–B4: static SD weights, storm drain, CP-only WLM weights, CF locality; build
    order multi-CPC → burst arrivals → routing policies → content)

**M8.6 Playtesting, polish & progression (user request 2026-10-26)**
- [ ] Playtesting: human and agent playtests on all three scenarios (`goal-mode-player` and the persona agents for
  the headless side); record friction points and fix the worst ones
  - Round 1 (2026-10-27, play CLI): goal-mode-player on Midwest seed 11, cautious-operator on Revenue seed 23,
    cost-cutter on Harbourline seed 37, each to about day 9. CLI and display friction (RCA scoring with no feedback,
    clock labels, shifting RMF interval indices, bare class names, raw-JSON mon3/smf, REVIEW staging hints) fixed in
    the play CLI the same day. Design findings:
  - [x] A: when response time and SLA attainment disagree (Harbourline MKTORD slid while WLM showed PI < 1, because
    the region-served class hid it), an Inquiry reply or the sysprog morning hint should point at CICS SMF 110.
    Done 2026-10-27 in the morning hint: a CICS or DDF incident workload whose serving classes all had a worst
    sysplex PI ≤ 1 that day gets "WLMGL disagreed" plus a pointer to SMF 110 / SMF 101 (SPEC §11.2). Hint text
    only: bench hash unchanged, golden hashes change because the seed 42 Midwest inbox gains the sentence. No bot
    check: no bot reads hints, so outcomes are identical by construction.
  - [x] B: a batch-window miss becomes an incident with its own RCA (Revenue day 7 abend had no clue path). Done
    2026-10-27: critical jobs account lost elapsed time by cause (CPU, Db2 locks, Db2 health, DASD queueing, swap,
    initiator wait) and ABENDs; a missed night opens a `BATCH` incident (new mechanism JOB_FAILURE for an ABEND, else
    the largest cause mapped onto the online mechanisms; JOB_ABEND and REORG_OVERRUN now affect BATCH) (SPEC §10).
    Normal Midwest seeds 1–10: oraclerca ends unchanged except seed 8 (day 18 → 19), median score 1180 → 1188, batch
    misses 29 (14 JOB_FAILURE incidents); textbook files no RCAs and is unaffected by design. Follow-up done 2026-10-27:
    BATCH incidents take SMF 30 evidence pins (the night's delay shares per cause and the critical ABEND count; `pin
    BATCH <day> <metric>` in the play CLI), and WLMGL/Monitor III pins on the critical jobs' classes and images count
    as about the night. The SMF tab's Batch view shows the shares and ABENDs with pin buttons.
  - [x] C: incidents with the same root cause on the same day group into one RCA (Midwest teller release: 5
    incidents, 5 RCAs; Harbourline holiday spike: 6). Done 2026-10-27: same-day, same-truth incidents link to the first
    (`rcaGroup`); one RCA covers the group, scored once (SPEC §10). Only oraclerca files RCAs, so only it moves:
    Normal Midwest seeds 1–10, median day 19 → 18, median score 1393 → 1284, ends unchanged (batch 3, trust 7). Seed 1
    ended day 15 instead of 22: fewer RCAs means fewer +1 trust bumps. A player who RCAs everything loses the same
    trust income; if that proves too harsh, scale the group RCA's trust by group size (open question).
    - [x] Scale a group RCA's trust reward with the size of its group (user decision 2026-10-27). Done 2026-10-27:
      the reward (not a wrong RCA's penalty) counts once per incident in the group at filing time
      (`EVIDENCE.groupTrustPerIncident`); score and Insight still count once. Normal Midwest oraclerca seeds 1–10 vs
      dev: seed 1 day 15 → 22 (score 968 → 1427), seed 3 day 16 → 17, the rest end on the same day; median day
      18 → 18.5, median score 1299 → 1351, ends unchanged (batch 3, trust 7). Goldens unchanged.
  - [x] D: insight is too scarce early: the QR TCB diagnosis needed CICS_MON (14 insight) with 13 on hand by day 8
    - [x] Options for the user (2026-10-27), `bot --reader`, Normal, expert and oraclerca, seeds 1–10, all three
      scenarios vs dev: o1 CICS_MON 14 → 8, o2 starting insight 15, o3 report cap 5 → 8 per day, o4 CICS_MON 10 +
      starting insight 10. Wins, scores (±30) and median end day unchanged everywhere (expert 9/10/9 → 9/10/10 on
      Harbourline for o2–o4, one seed); the reader buys Monitor III on day 1 instead of 2 and holds ~1 more tool by
      day 5 with o2/o4, o1 only moves CICS_MON a day earlier. User picked o2: `INSIGHT.starting` 15.
  - [x] E: events with no warning or no visible effect (review the warnings in the M8.4 events work): the holiday
    spike arrived with no warning on Harbourline; a REBIND access-path regression raised no incident; "campaign starts
    tomorrow" mail sent after the campaign had started; the runaway query could only be cancelled as an emergency
    change
    - [x] Warning timing (2026-10-27): forewarnings are dated the card's own day and land in that morning's briefing,
      but ten of them said "tomorrow" / "scheduled overnight", so they read as a warning for the next day. The
      Harbourline holiday did have one (day 8 "Tomorrow is the big shopping holiday", spike the same day), so both
      the holiday and the campaign finding were this wording. Reworded to the day they arrive ("today", "ran
      overnight"); a test keeps "tomorrow" out of forewarnings. Text only: bench and golden hashes unchanged.
    - [x] REBIND regression with no incident; runaway query cancellable only as an emergency change. Done
      2026-10-27. Runaway: it starts and ends inside one live day, so its fix was only ever an emergency change.
      Fixes that are operator or DBA commands under the incident procedure (CANCEL_RUNAWAY, TERM_UTILITY,
      CANCEL_XLOG, HOLD_HSM_RECALLS(_REV)) are now `operational`: live, they cost their hours and own facet trust
      but no change-board trust (SPEC §6). Normal Midwest seeds 1–5 vs dev: expert ends and scores unchanged
      (4 victories, 1 opex day 28), end trust +0.7 to +7.6; oraclerca identical (median day 16). REBIND: no
      change. On Midwest the ×3 CPU on RBANK (a third of a small estate) is a cost event that only turns into an
      incident when capacity is short; clue path is the overnight-REBIND forewarning, WLMGL service per
      transaction up with END/S flat, and Db2 accounting by package. The playtester found it and rolled it back.
  - [x] F: the Change Desk catalog offers both RECYCLE_PROD2_AORS and RECYCLE_PROD2_AORS_REV and accepts both. Done
    2026-10-27: the UI already listed only the scenario's fixes; the play CLI `catalog` listed all of them and
    requestChange accepted any. Both now use the fixes the scenario's event cards call for (`fixIdsOf`). Bench and
    golden hashes unchanged.
  - Round 2 (2026-10-27, seed 2027 Normal, to the day-8 briefing): goal-mode-player on Midwest (trust 70.6, score
    463), cautious-operator on Revenue (trust 83.1, score 450), cost-cutter on Harbourline (trust 73.6, score 529). Fixed in the
    play CLI the same day: `pin BATCH` takes the day as labelled (`D2`), and `smf BATCH` shows `D2` too (it took the
    0-based index); pin text carries the day (`SMF 30 D3 06:00`); DB2/CICS/BATCH pins need the same tool as their
    SMF view, as in the browser; `pin DB2|CICS` takes the hour as `smf` does (`10`, `D3 10`) instead of an internal
    key; no EPIPE crash when piped into `head`. Open findings:
  - [x] G: one event can raise several incidents with different truths (Midwest D2 runaway ad-hoc query:
    THREAD_LIMIT/POLICY, THREAD_LIMIT/RUNAWAY_WORK, CPU_PRIORITY/POLICY), and nothing points a player at
    THREAD_LIMIT for RBANK. Check the clue path or let the related truth count as half-right.
    Checked 2026-10-27 after the N/O fix: the replay still gives THREAD_LIMIT on RBANK/CARDAUTH/TELLER. Starved AORs
    run slow tasks, and once rate × RT passes MXT the queue grows faster than the in-region time, so the linear
    subtraction still leaves THREAD_LIMIT on top. The clue path exists (THREAD_LIMIT hint → CICS 110 MXT_WAIT).
    Options for the user: (a) the sim also records MXT/DBAT wait at baseline RT, so attribution can tell queue growth
    caused by slow tasks from queue growth caused by rate; (b) half credit for a mechanism that is ranked high but is not the top one.
    User decision 2026-10-27: (a). Done: the sim records the MXT/DBAT queue at each slice's unqueued service time
    (`outsideRef`), and THREAD_LIMIT is credited with its growth only (SPEC §10). Replay: RBANK, CARDAUTH and TELLER
    become CPU_PRIORITY/POLICY, MOBILE DEPENDENCY/RUNAWAY_WORK; CICS_SOS stays THREAD_LIMIT. Bench 0.40 vs 0.42 ms/tick
    (noise). Sweep (expert and oraclerca with `--reader`, Normal, seeds 1–10, vs dev): THREAD_LIMIT truths fall to
    0–1.4 per run (were 2–5), mostly to CPU_PRIORITY; Midwest and Revenue ends unchanged; Harbourline expert 9 → 8
    wins (seed 1 lost on trust on day 40, 59.3 → 58.9), mean trust 74.9 → 74.4; oraclerca unchanged.
  - [x] H: events with no incident or a weak warning: Midwest D6 access-path regression, Revenue D7 REORG overrun
    and D6 runaway compliance query (BATCHHI PI 12.6, no miss); BATCHPRD#1 PI 5–10 every night with no miss.
    Probably fine (no SLA broken), but the morning hint could mention them.
    Done 2026-10-27: a strain morning hint names a class whose worst PI reached 3 and at least doubled from the day
    before, with no incident on its work (classes hot every night stay quiet). Expert seed 3 full runs: 5 hints on
    Midwest, 3 on Revenue, 0 on Harbourline.
  - [ ] I: RCA guessing pays: CPU_PRIORITY/POLICY was right three times on CARDAUTH blips without evidence, and a
    JOB_FAILURE trigger POLICY (the player's own activation) cannot be derived; half-right RCAs still give +1 on
    every facet. User decision 2026-10-27: fine as it is (guessing may pay).
  - [x] J: GOODWILL (and CFO_BONUS, RC_HOARDER) drafts show no visible cost; both agents called GOODWILL dominant.
    User decision 2026-10-27: leave it; draft rewards cost only the cards not picked.
  - [ ] K: CLI and UX rough edges: pin ids share the incident counter; `smf CICS` lists workloads, not the region
    names SET_CICS needs; finished projects disappear from status; a change with several commands costs the same
    1.5 h as one; `wlm` says "activate at tomorrow's briefing" but `activate` is refused until the draft closes;
    idle engineer-hours on quiet days.
    Partly done 2026-10-27: `status` lists projects (finished ones too); the REVIEW-phase `wlm` message says to close
    the day first. Several commands summing their hours is kept (each change is real work); shared pin/incident ids
    and idle hours left as is for now.
  - [x] L (Harbourline): CICS region names and current MXT are shown nowhere, so SET_CICS is a guess; a planned
    change is not checked against the config (a bogus region was accepted and charged) and cannot be withdrawn.
    Done 2026-10-27: requestChange dry-runs command changes on today's config plus the changes already planned and
    refuses a bad target before charging, naming the real ones; `catalog` lists LPARs, CICS regions with MXT and Db2
    MAXDBAT; `cancel <change id>` withdraws a planned change (cancelChange existed; the CLI lacked it).
  - [x] M (Harbourline): PRDA shows CAPPED 2–3.4% in Partition Data with no defined capacity, `pin CPC PRDA CAPPED`
    reads 0.0%, and RCAs answer CAPPING/POLICY; the cap's source is not discoverable. Check the clue path.
    Done 2026-10-27: the cap is Harbourline's deliberate absolute cap (6.0 engines). Partition Data gains an ABS CAP
    column; the pin read 0 because a CPC pin without an interval reads Monitor III now (in the review, after the
    peak), so `pin CPC <lpar> CAPPED <interval id>` now cites the Partition Data row.
  - [x] N (Harbourline): MXT queueing shows as OTH/UNK (73–89%) in WLMGL and Monitor III; only SMF 110 names it. The
    sysprog hint said "Partition Data around the peak" on days 4–6 while the cause was MXT wait.
  - [x] O (Harbourline): one recurring MXT/QR symptom was scored QR_TCB, THREAD_LIMIT, CAPPING and CPU_PRIORITY (all
    POLICY) on different incidents (same family as G); JOB_FAILURE/POLICY for an S0C7 abend reads oddly.
    N and O done 2026-10-27: the MXT wait was mostly a symptom. CPU starvation on the capped PRDA and QR TCB wait slow
    the tasks, so they hold MXT slots longer and queue (Little's law); the truth counted that queueing as THREAD_LIMIT
    and flipped between THREAD_LIMIT, CAPPING and CPU_PRIORITY by the hour. THREAD_LIMIT is now credited only with
    MXT/DBAT queueing beyond the in-region growth (SPEC §10). Harbourline seeds 11, 23 and 37 (do-nothing, 8 days):
    THREAD_LIMIT truths fell from about a third of incidents to one; the rest are CAPPING or CPU_PRIORITY (whether
    PRDA was capped over 5 % that hour), so the sysprog hint's "Partition Data" now points at the real cause.
    Still open: the S0C7 abend read as JOB_FAILURE/POLICY.
    Sweep (expert and oraclerca with `--reader`, Normal, seeds 1–10, vs dev before the change): Midwest and Revenue
    ends unchanged; Harbourline expert 9 → 8 wins (seed 7 lost on trust on day 39, 61 → 58), mean trust 76.4 → 75.4;
    oraclerca truths there move from THREAD_LIMIT (22.5 → 1.6 per run) to CAPPING (23.8 → 55.4), its score rises
    1190 → 1474. The bots still read MXT queueing as THREAD_LIMIT, so they lose a little trust where the truth moved.
  - [x] P (Harbourline): the MLC month estimate does not say it follows the month's peak R4HA, so capping non-prod
    shows no saving; the DEV1 cap stretched dev batch ×82 with no label. The pin label for an SMF hour shows the
    hour's end (10:00–11:00 pins as 11:00).
    Done 2026-10-27: `status` and the header's MLC tooltip say the estimate is priced on the month's peak R4HA to
    date; `smf BATCH` ends with a legend for stretch (times slower than running alone) and queuedSec, and the Gantt
    tooltip says the same; Db2 101 and CICS 110 pins read `D3 10:00–11:00`.
- [ ] UI polish pass: consistency of panels, spacing, labels and empty states; phone width; follow-ups from playtests
- [ ] Additional perks: widen the draft and starting-perk pool (each with a cost or trade-off, data in `src/content/`)
- [ ] Expand career unlocks: more levels and unlock kinds (scenarios, starting tools, cosmetic titles), building on
  the career XP system (M8.3 meta-progression)

**M8.7 Realism fixes (researched 2026-10-26; facts and citations in `docs/research.md`)**
Each is a sim model change: regenerate the goldens with a "Behaviour change" note, re-sweep, update SPEC §5.5.5 and §17.
- [x] **Soft capping cuts polarity.** While an LPAR is soft-capped through a positive phantom weight (its weight-based
  share is above its defined capacity), PR/SM effectively lowers its priority and it may get fewer VH/VM logical
  processors (*MVS Planning: WLM* 3.1, p.46). The sim caps with a flat MSU limit and leaves polarity alone; compute
  polarity from the capped entitlement while the cap is on. Done (loop 6): `resolveCpc` takes polarity from
  min(entitlement, soft-cap engines); goldens and the day-1 bench hash are unchanged (no cap is active by then).
  The balance check waits for the post-sweep re-sweep.
- [x] **Discretionary goal management thresholds.** Eligible periods are capped from PI < 0.71 and held between PI 0.71
  and 0.81, so little is taken (SG24-6472-03 PDF p.201, printed 183; eligibility in *MVS Planning: WLM* PDF p.118). The sim starts at
  0.7, stays capped below 0.9 and gives a flat 80 % of demand (`DISC_GOAL_MGMT` in `src/content/wlm/tuning.ts`);
  cap toward the 0.71–0.81 PI band instead. Done: cap = 1 − (0.81 − PI), floor 50 %; balance check with the post-sweep re-sweep.
- [x] **SERVERWLM weights are zIIP-aware by default.** Since V1R9 the server-specific weight is a composite of the
  available and displaceable capacity of each processor type (CP, zAAP, zIIP), weighted by the server's current use
  of each; PROCTYPE only applies to BASEWLM, and PROCXCOST (1–100, 1 = no penalty) lowers the weight of servers
  whose zIIP-targeted work crossed over to CPs (*IP Configuration Guide* 3.1, PDF p.555–556). The sim's `WLM`
  routing is CP-only unless `ziipAware` is set (`wlmShares` in `src/sim/workload/routing.ts`). Make the composite
  the default, turn the `ziipAware` lever into PROCXCOST (crossover penalty), and update the `sd-wlm-weights`
  Codex entry, which also wrongly says BASEWLM counts only CPs.
  Done: `WLM{distMethod: BASEWLM | SERVERWLM}` replaces `ziipAware`; BASEWLM = idle CP capacity (Harbourline's B3 is now
  "left on default BASEWLM"), SERVERWLM = CP/zIIP composite. PROCXCOST/PROCTYPE not modelled (no crossover penalty lever
  yet). Balance check with the post-sweep re-sweep.

**M8.5 UX polish & accessibility** (done)
- [x] Day-1 guided tutorial; charts with crosshair tooltips and table views; keyboard shortcuts (Space, 1–5,
  Alt+1–8); forced-colors support; contrast test for dark, light and 3270 themes (`tests/ui/contrast.test.ts`);
  sound toggle; theme toggle; remembered speed; crash-safe hourly autosave; static deploy + README

### M8.9 — Game-playing agents (last work on `main`; user request 2026-10-20) (done)
After M7–M8 are done and **before** starting M9, add AI agents that can play the game, then stop pushing
to `main` (this is the last push there; M9 goes on its feature branch).
- [x] Headless play CLI `npm run play -- <runFile> <verb>` (`tools/play.ts`, `tools/playCore.ts`): reports, SMF,
  Monitor III, changes, WLM edits, RCA with evidence, ask, projects, notes, `advance N [--pace 2s]`; command log
  replays deterministically. Quick reference in `docs/agents.md`
- [x] Agents `.claude/agents/goal-mode-player.md`, `-cautious-operator`, `-cost-cutter` (no access to ground truth);
  smoke test (loop 83) played seed 42 day 1 through review; its friction reports were fixed (loops 83–85)
- [x] Spectator mode: `?spectate=<name>` polls `runs/<name>.json` read-only with the agent's latest command/note in a
  banner; `npm run bot -- ... --spectate runs/bot.json [--pace 2]`; "Take over this run" adopts it as a save

### M9 — Simplified mode (after M8; user request 2026-10-20)
Goal: the same simulation, made approachable for players who aren't z/OS experts. Nothing in `src/sim`
changes; simplified mode is a game/UI layer over the same commands, reports and scoring.
Hold released by the user on 2026-10-26 (was: don't start until told, 2026-10-20). Do all M9 work on a separate
feature branch (e.g. `feature/simplified-mode`), not on `main`.
- [ ] Mode switch at run start (Expert / Simplified); same seed gives the same world in both modes
- [ ] Keep the full WLM policy definition visible and editable, but offer **goal-level actions** that bundle
  the discrete changes an expert would make, e.g. "Protect mobile banking from ad-hoc queries" = new service
  class + classification rule + report class; "Protect the critical batch path" = BATCHHI rule for critical jobs
  + initiator change; "Stop dev from stealing production CPU" = DEVT weight/logicals + soft cap. Each bundle
  shows the exact changes it makes (expandable), its cost and trade-off, and can be undone as a unit
- [ ] Bundles are data in `src/content/` (preconditions, the change list, explanation, Codex links), built
  from the existing Change Desk requests so cost, change risk and the change freeze still apply
- [ ] Plain-language summaries of reports and incidents ("mobile is slow because it waits for CPU behind
  batch") with the raw RMF view one click away; fewer, friendlier Monitor III views
- [ ] Diagnosis stays the gameplay: symptoms → suggested bundles (more than one valid fix), not auto-fixes
- [ ] Balance: bots in simplified mode (bundles only) reach roughly the textbook bot's results
- [ ] Tutorial for simplified mode; Codex entries linked from each bundle

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-10-19 | Name: **GOAL MODE** | Nods to WLM goal mode; short and memorable |
| 2026-10-19 | Browser game, TypeScript + React, sim in Web Worker | Zero-install, shareable; worker keeps UI smooth; same TS sim runs headless in Node for balancing |
| 2026-10-19 | Tick = 10 sim-s (WLM policy interval); fluid/analytic model; batch jobs discrete | Matches the real WLM cadence; 8,640 ticks/day is cheap; batch critical path needs per-job identity |
| 2026-10-19 | Day runs 06:00 → 06:00 | Each day ends on the batch-window deadline, a natural climax |
| 2026-10-19 | Run = ~40 played business days, weekends auto-simulated; growth compressed | Roguelike-length runs (~7 h at 1×, less with speed-up) without 60-hour calendars |
| 2026-10-19 | Erlang-C for CPU queueing; log-normal RT distributions | Standard, cheap, captures engine-count effects and percentile behaviour |
| 2026-10-19 | HiperDispatch polarity uses the Watson & Walker published rules | Concrete and documented; teaches the "weight +1 flips VM→VH" lesson |
| 2026-10-19 | Real mechanics, fictional numbers (no real LSPR/MSU/price data) | Avoids presenting invented figures as IBM data; keeps the content tunable |
| 2026-10-19 | Pause allowed by default; Ironman disables it | Accessibility and analysis depth vs tension for experts |
| 2026-10-19 | Pinned TS 5.9, Vite 7, Vitest 4, React 19; `.npmrc` sets `legacy-peer-deps=true` | npm 10 crashed resolving Vitest's optional peer set (`edgesOut` null); TS 7 (native) skipped for stability |
| 2026-10-19 | Architecture rules enforced by a test (purity scan) instead of ESLint for now | Fewer deps; ESLint can come later |
| 2026-10-19 | Dispatcher returns delay-to-using *ratios* (queue, PR/SM) rather than samples | WLM sampling (M2) multiplies by using samples; keeps the dispatcher model independent of goal logic |
| 2026-10-19 | Dispatch per service-class period, then split grants to slices by demand | Equivalent (equal-DP work shares by demand) and ~3× cheaper; policy-adjust projections re-run the evaluator many times |
| 2026-10-19 | "Samples" are time-average concurrencies per state (engines using, units delayed) rather than discrete 250 ms counts | Same ratios as sampling, computed analytically |
| 2026-10-19 | I/O: connect+disconnect count as *using*, IOSQ+pend as *delay* | APPROX; makes velocity goals for I/O-heavy work achievable. Superseded 2026-10-21: connect only (see below) |
| 2026-10-19 | Dependency (server) waits are "other" delay: visible in RT, excluded from velocity, not WLM-fixable | Recreates the classic Db2-below-its-callers priority inversion diagnostic pattern |
| 2026-10-19 | Unmet CPU demand becomes backlog (engine-seconds); wait = backlog / service rate; timeouts drop work and feed retries | Gives realistic saturation collapse and retry storms |
| 2026-10-19 | Run calendar starts on the 3rd of a 30-day month | First payday (15th) lands on day 13, not day 1 |
| 2026-10-19 | Pure memoisation caches (classification, slice templates) keyed on the definition object | Big speed win; edits create a new definition object so caches stay correct |
| 2026-10-19 | Circular couplings (I/O RT, CF service, lock index, concurrency) use previous-tick values in `env` | Avoids fixed-point iteration each tick; 10 s lag is invisible at game scale |
| 2026-10-19 | Batch jobs aggregated into one slice per (image, service-class period); grants shared by demand | Same DP fairness as per-job dispatch, far cheaper |
| 2026-10-19 | Played day releases its job network at 06:00; jobs hold until their earliest start | Daytime DEV batch and evening streams share one mechanism; unfinished critical jobs roll into the next day (overlap with online) |
| 2026-10-19 | Midwest has 2 CICS AORs per prod image (qrFrac 0.6) and a CFTEST LPAR sharing the ICF with CF02 | 1 AOR overloaded the QR TCB on day 1; CFTEST makes F8 (low CF02 weight) real |
| 2026-10-19 | Soft cap enforced as a PR/SM cap at DC/msuPerCp engines; capping decided at each 5-min R4HA boundary | Matches "capped until the average drops below DC"; pattern capping's burstiness not modelled (APPROX) |
| 2026-10-19 | While capped, min(1, 4×cappedFrac) of undispatched CPU counts as CAP delay | APPROX attribution; keeps CAP visible in WLMGL and stops WLM chasing it |
| 2026-10-19 | Months are 30 played-calendar days; MLC samples hourly at tick boundaries | Simple, deterministic; ~1.3 bills per standard run |
| 2026-10-19 | Short-engine PR/SM delay coefficient lowered 0.35 → 0.15 | 10–25% PR/SM delay in the Partition Data report was implausibly high |
| 2026-10-19 | Classification rules live inside the Change Desk WLM section, expandable, not a separate tab | User feedback: rules are part of the policy you're editing; keeps the change board and pending banner in view |
| 2026-10-19 | TFP baseline is a committed monthly minimum, not a multi-year pool with rollover | A 40-day run is too short for annual true-ups; keeps the trade-off (lose capping savings, gain cheap growth) visible within the run |
| 2026-10-19 | CF load comes from named structures placed on CFs; lock requests never convert to async | Gives CF placement a real diagnosis path (lock vs GBP) and a trap; per-CF request shares were opaque. Lock part superseded 2026-10-21 (see below) |
| 2026-10-20 | Sonnet subagents `implementer` and `log-reader` in `.claude/agents/` | Save usage on well-scoped coding and log digestion; sim models and balance stay on the main agent (user request) |
| 2026-10-21 | Realism pass: batch jobs age through periods by consumed SU; address spaces sit in their class's last period; type 1 resource groups split their sysplex SU/s budget by demand (was applied in full on every system); MLC bills a capacity group at most its limit | All were divergences from real WLM/SCRT; behaviour-neutral for BASEPOL (no multi-period batch/STC classes, resource groups or capacity groups), so day-1 hash and goldens are unchanged |
| 2026-10-21 | CICS transaction classes: velocity, discretionary or multi-period goals are a warning in the editor, a resource group is a hard error (edit and install refused) | WLM Planning ch. 9–10 / SG24-6472 call the goals "not supported" but document an ISPF error only for the resource group; velocity stays valid on the region STC class |
| 2026-10-21 | IBM-docs realism audit: (1) WLM I/O using is device connect only, disconnect is neither using nor delay; (2) zIIP-eligible batch work in a discretionary period (or Honor Priority NO) never overflows to CPs (batch slices always could); (3) CF lock requests convert to async like cache/list ones, at a higher FICTIONAL threshold | (1) *MVS Planning: WLM* (V2R5) "Velocity formula"; (2) same, "Honor Priority" ("discretionary … never gets help from general purpose processors"); (3) IBM WSC *Heuristic Conversion of CF Operations*: since z/OS 1.2 lock requests are heuristic-eligible. The CF02 lock trap stays: converted lock requests take far longer. Goldens and bench hashes regenerated |
| 2026-10-21 | NEW_APP_GOLIVE stays as is (booking app Retail-judged with an SLA, no forewarning, same minDay); textbook's median below 30 on runs that draw it is accepted | User decision (option a): spotting and classifying new work is part of the game, and textbook by design never diagnoses |
| 2026-10-21 | Browser worker and headless `play` share game-layer helpers (`pendingBase`/`nextPolicyName`, `applyReportClassAdvice`, `runWorkItems`, `renderReport`); `noUnusedLocals` on | The two front ends had drifted copies of the same logic; one copy means one place to fix and test |
| 2026-10-21 | Monitor III audit against *RMF Report Analysis* (SC34-2665, z/OS 2.5) ch. 2: new SYSSUM view holds goals vs actuals and PI (real SYSINFO has no PI); SYSINFO gets its real header (CPs/IIPs online, Avg CPU vs MVS Util%, Appl%/EAppl%/Appl% IIP) and per-period WFL%, Users ACT, AVG USG and avg delayed users; DELAY uses RMF columns (WFL/USG/DLY/UKN, PRC/DEV/STR/CAP) and server waits move from DLY % to UKN %; PROCU shows Time on CP % Total/IIP and EAppl % CP/IIP; ENCLAVE shows class, period, goal, EAppl% and USG/DLY/UNK; CPC shows the real header and Logical/Physical Util % columns (weight, polarity, PR/SM delay kept in a separate table); WFEX gets a Speed section and Name/Reason/Critical val. columns; ENCLAVE shows one line per DDF period (two DDF workloads in one class used to repeat the period's figures, and the DDF chart double-counted them) | Field names and formulas were invented or borrowed from other reports; UKN vs DLY changes how much "delay" a Db2-bound DDF period shows, which is the realistic reading. View-model only: no sim state change, hashes and goldens unchanged |
| 2026-10-21 | VENDOR_PRICE card built on a run-level MLC price multiplier in sim cost state (default 1), changed by card commands | User decision (option 1 of 3): smallest sim change, keeps goldens, reusable by later perks or pacts |
| 2026-10-22 | Monitor III history: 48 h of 100 s intervals, held by the worker outside the run (not saved, not hashed); pins live-only | User request and retention choice. Keeping it out of RunState keeps saves small and goldens stable; the cost is losing history on reload |
| 2026-10-21 | Performance budget: ≤ 2 s per headless day applies to Midwest-size estates; larger estates (Harbourline, 6 LPARs, ~7 s/day) are accepted as they are, no structural perf work for now. ≤ 4 ms/tick is a Midwest target too | User decision. The profile is flat and reaching 2 s on 6 LPARs would need structural changes (fewer per-tick allocations, coarser ticks for quiet LPARs); not worth it yet |
| 2026-10-21 | HiperDispatch: 0 < E < 1 CP gets 1 × VM and the rest VL (was 2 × VM); 1 ≤ E < 1.5 keeps 2 × VM | Claim confirmed by the user (PR #9). DEVT 2VM+2VL → 1VM+3VL, SYSP 2VM → 1VM+1VL on Midwest; goldens and bench hashes regenerated |
| 2026-10-23 | Capacity chart: LPARs from the scenario; one stacked MSU chart per CPC (from the LPARs' `cpcId`, any CPC count; `overlay` series stay lines over the stack) with that CPC's dashed installed CP capacity line (rises with On/Off CoD), plus one R4HA chart for all LPARs; last played day stays on screen until the next day's first sample; `LineChart` end labels spread 12 px apart, shown for up to 8 series | User request 2026-10-22 (Harbourline chart was empty, labels overlapped). Per-CPC charts at user request 2026-10-23: one total capacity line squashed the LPAR lines on multi-CPC estates |
| 2026-10-23 | CI is the merge gate for `dev` and `main`: tests + goldens, a required "Behaviour change" note when goldens change, bench-hash equality for `perf` PRs, and a 5-seed bot sweep inside loose bands when goldens change | Sessions merge unattended, so the gates must be enforced by CI, not by the agent's own report. A valid behaviour change passes (regenerated goldens + note); an unexplained one or a "perf" change that moves the state does not |
| 2026-10-26 | `main` requires the four CI checks but no approving review; Claude merges milestone PRs (merge commit) after a `pr-reviewer` MERGE verdict, and the reviewer posts its report on the PR | Claude acts as the user's GitHub account, so a required approval could never be given (an author can't approve their own PR). The gate is CI plus a more thorough review: base-vs-head bench hashes for both scenarios, determinism re-run, a 10-seed sweep for milestones, adversarial read |
| 2026-10-26 | Daily challenge on the day-1 briefing: a "Daily challenge" button next to Scenario/Difficulty restarts on today's UTC seed; a daily run shows a tag and "Random seed instead", and changing scenario or difficulty keeps it daily | User request: the button was only on the end screen, so a first-time player could not start a daily before finishing a run |
| 2026-10-26 | M9 hold released; M8.6 added (playtesting, UI polish pass, more perks, wider career unlocks) | User request |
| 2026-10-26 | Routing/capping open questions researched against IBM PDFs: group limits only clip bursts with `AbsMSUcapping=YES` (sim matches the NO default); soft capping by positive phantom weight can cut VH/VM (to model); discretionary goal management caps from PI < 0.71 and holds 0.71–0.81 (to model); CPSM routing factors confirmed | User request; the two model changes are listed in CLAUDE.md "Pending realism changes" so the next model session picks them up |
| 2026-10-26 | Last two routing questions settled from books the agent now fetches itself (IP Configuration Guide, CPSM Managing Workloads, SG24-7621): SERVERWLM is zIIP-aware by default (realism change queued in CLAUDE.md); CPSM abend recovery matches the sim's shape, decay rate undocumented; `storm-drain` Codex thresholds corrected | User request |
| 2026-10-26 | Pending realism changes moved from CLAUDE.md to PROGRESS.md "M8.7 Realism fixes"; CLAUDE.md keeps only the rule for where they go | User: CLAUDE.md was a misstatement; to-dos belong with the milestones |
| 2026-10-26 | New `docs/research.md` ledger: one row per confirmed fact with a PDF page link and the sim status; settled research moved out of Open questions; SPEC §17 points to it, §18 stays the bibliography | User asked for one central place for researched facts. Pages re-checked against the 3.1 books; SPEC §17 "Discretionary capping conditions: Real" row dropped (the conditions are only partly modelled) |
| 2026-10-26 | Discretionary goal management caps from PI < 0.71, stays capped below 0.81, cap = 1 − (0.81 − PI), floor 50 % (was 0.7 / 0.9 / flat 80 %) | M8.7: real WLM holds capped work's PI in 0.71–0.81 (SG24-6472-03 p.183). Proportional cap is APPROX of WLM's projection; balance check deferred to the post-sweep re-sweep |
| 2026-10-26 | Routing `WLM{ziipAware}` → `WLM{distMethod}`: BASEWLM weighs systems by idle CP capacity, SERVERWLM by the CP/zIIP composite of displaceable capacity; Harbourline B3 recast as the distributor left on default BASEWLM | M8.7: SERVERWLM is zIIP-aware by default and BASEWLM is the default method, CP-only without PROCTYPE (IP Config Guide 3.1 p.555–556), so B3's puzzle keeps its fix with a real name. PROCXCOST not added: no crossover-penalty lever needed for B3. Harbourline hash changes; balance check deferred to the re-sweep |
| 2026-10-26 | Event deck draws from its own RNG stream per (seed, day), not the shared run RNG | Change failures, activation failures, AIOps hypotheses and drafts rolled the same stream, so any extra bot action reshuffled every later event and seed-by-seed comparisons of bot variants were invalid (seed 18 diverged on day 21 after one CoD rental). Win rates over independent seeds before this stay unbiased but carry ~±10 pp noise at 20 seeds; per-seed claims and small variant deltas made before this are unreliable. Goldens regenerated; balance sweeps re-baselined after (user decision). |
| 2026-10-26 | Every game roll gets its own keyed stream (`streamRng(seed, purpose, …key)`): events by day, draft by day, change and activation failures by day + label + attempt, AIOps by tick + workload, inquiries by ask tick + topic; `RunState.rng` removed | The event-only split (#41) still left the draft, failure, AIOps and inquiry rolls on one stream: in a paired sweep, seed 13's CoD rental shifted its day-9 draft (MENTOR instead of BELT_AND_BRACES) and the run lost ~4 trust on every facet from that alone. With keyed streams, seed 13 base and CoD draw identical events and drafts and differ only after the rental. Goldens regenerated; the paired sweep from #41 was stopped and is re-run on this. |
| 2026-10-27 | Hardware engine adds and their reverts are relative (`ADD_CPC_ENGINES` delta, clamped ≥ 0); capacity-setting changes stay absolute | On/Off CoD reverted with "set N" computed when the lease was requested, so a lease taken over a pending or overlapping change lost or kept a CP for good (spendtowin bled CPs on Harbourline). Deltas compose in any order. Goldens unchanged |
| 2026-10-27 | CPU_CAPACITY also when an image used ≥ 95 % of the CP available to it (online logical CPs, entitlement + white space), not only when its CPC was ≥ 90 % busy; the donor test is unchanged. Harbourline PRD images define 2 reserved logical CPs | User decision 2026-10-27. Seed 7 Harbourline: PRDA–PRDD sat at their logical CPs (13 of CPC1's 14 CPs, 10 of CPC2's 10) and the incidents read CPU_PRIORITY once a new CP lowered CPC busy to 86–89 %, the wrong clue. With no reserved CPs and no IPL lever a bought or rented CP could never reach production |
| 2026-10-27 | The expert bot buys a permanent CP (PERM_CP) after CPU_CAPACITY incidents on 2 days within 7 on one CPC, then raises prod logical CPs by 1; On/Off CoD variant not adopted | User decision. 20-seed sweeps: same ends as the base expert in all three scenarios; the CoD variant cost Harbourline seed 11 an opex end |
| 2026-10-27 | M8.1 closed: the performance gate is ≤ 4 ms per tick in the worker; ≤ 2 s per headless day is no longer a target | User decision. No hash-neutral optimisation above ~3 % is left, (2) and (5) were rejected, and the UI budget already holds. CLAUDE.md and SPEC §15 updated |
| 2026-10-27 | M8.2 closed: bot balance done; sweeps become a regression check (CI 5 seeds, 20 to confirm) | User decision. Do-nothing, textbook and spendtowin hold in all three scenarios; expert wins 19/20, 20/20, 16/20 |
| 2026-10-27 | Finding D: every run starts with 15 insight (`INSIGHT.starting`), was 0 | User decision among four swept options; bot outcomes unchanged, Monitor III affordable on day 1 |
| 2026-10-27 | Finding I: RCA guessing may pay; no change | User decision |
| 2026-10-27 | Finding J: GOODWILL (+4 trust with every stakeholder) stays as is | User decision; a draft reward's cost is the cards not picked |
| 2026-10-27 | RCA truth credits THREAD_LIMIT only with MXT/DBAT queueing beyond the in-region growth | Little's law: slower tasks hold MXT slots longer, so the queueing is mostly a symptom of CPU or QR TCB delay (playtest findings N, O) |

## Open questions

- Settled research (sysplex routing and capping, 2026-10-26, and everything earlier) is in `docs/research.md`. Only
  open items stay here.
- CICS transaction classes with velocity or multiple periods: the editor now warns (WLM Planning says "not supported"),
  but the sim still splits such work like DDF. IBM documents no runtime behaviour for this case; model it if a source turns up.
- RMF Partition Data shows PR/SM absolute capping somewhere; the sim's ABS CAP column (engines, next to DEF CAP) is an
  APPROX of its name and place. Check the real report layout (*RMF Report Analysis*, Partition Data Report).

- CICS_SOS (loop 105) is modelled as an effective MXT cut, so a player who raises MXT on the PROD2 AORs clears it. Real SOS gets worse with a higher MXT. A proper fix needs a DSA storage model (or a lock on MXT while the card runs).
- Monitor III CAP column: the sim's capping delay mixes WLM resource-group capping (RMF RG-Cap) with work held back by
  a soft-capped image. On a real system the latter probably shows as processor (PRC) delay, since PR/SM just stops
  dispatching the logical CPs. Unverified; the DELAY report keeps one CAP column.
- Monitor III MVS Util% is derived as LPAR util ÷ (1 − short-engine wait) (APPROX). Real MVS busy also differs from LPAR
  busy through HiperDispatch parking and wait-completion settings; check against the CPU Activity report docs.
- Period switching sums CP and zIIP seconds × SU/s without normalising zIIP time to CP speed (APPROX).
- Resource group minimum for discretionary members: what exactly counts as "missing goals"? Modelled as delay > using.
- CICS: does WLM/RMF response time include MXT queue time? Currently treated as outside the work
  manager (like DBAT queueing before enclave creation). Verify against CICS performance docs.
- Policy-adjust projections don't model backlog/DBAT feedback, so WLM sometimes places batch above
  DDF while DDF is happy and then can't undo it quickly. Realistic in spirit, but watch in balancing.
- Percentile PI edge cases: how exactly does WLM handle periods with very few completions
  (minimum-sample rules)? Currently an EWMA with a variable horizon. Check *MVS Planning: WLM*.
- WLM-managed initiator start/stop heuristics: the JES2 Init & Tuning Guide "queue delay
  measurements" section wasn't reviewed yet.
- ~~R4HA after IPL~~ settled: *MVS Planning: WLM* says WLM starts with a four-hour window containing no usage, i.e. 48 zero slots, as modelled.
- TFP details (baseline commitment, overage pricing) are left deliberately abstract; is
  that enough for the strategic choice to feel real?
- Should two-CPC topologies (cross-site sysplex) be in the base scenario or saved for the
  airline scenario?
- Tuning target for "fun density": how many meaningful decisions per live day? (Target: 3–6
  alerts that matter, 1–2 incidents in Act II+.)
- Waiting on the user: nothing open (M9 released 2026-10-26). (VENDOR_PRICE: decided option 1, sim price multiplier, 2026-10-21.) (Booking go-live: decided (a) keep, 2026-10-21.)

## Risks

- **Model complexity vs performance:** policy-adjustment projections re-run the evaluator
  (≤2 receivers × ≤6 trials per system per tick). Steady days ~2.0–2.4 s headless against a 2 s/day target.
  Fine for the UI (4 ms/tick budget) but slow for bots and sweeps. Options in M8.1.
- **Opaque cause and effect:** if players can't see *why*, it feels random. Mitigate with clue
  design rules (SPEC §13.3), the WLM Activity log, morning hints and the Codex.
- **Balance whack-a-mole:** keep bots and golden runs green; sweep ≥ 20 seeds before tuning.

## Lessons (tooling)

- `pgrep -f` / `pkill -f` loops match their own command line (exit 144 kills the shell); wait on files or PIDs,
  stop with task IDs or `fuser -k`.
- ScheduleWakeup wakeups failed to fire twice (loop 50); the build loop schedules with `send_later` plus an
  hourly watchdog.
- The cloud box is noisy (±10–20%); compare perf old vs new back to back with esbuild bundles, and prove
  behaviour-neutrality with `npm run bench -- --hash`.

## Session log

Newest first. Entries before loop 48 are summarised in the milestones above; see git history for detail.
- **2026-10-27:** Play CLI fixes from playtest round 1 (M8.6). `rca` now says which half was right, the true
  mechanism/trigger and the trust effect. Times read `D1 Tue 00:30` (played day plus calendar weekday). RMF intervals
  have stable ids (end time in 5-minute slots) in `status`, `report`, `pin WLMGL` and incident lines, and `report`/`pin`
  respect the fog of war (today's intervals need Monitor III), as the browser does. Bare class names mean period 1;
  unknown rows list the valid keys. `status` shows the last completed hour's SLA when the current hour has no data
  and the PI > 1 rows of the latest interval. `mon3 [system] [--json]` prints SYSINFO/CPC/DELAY/WFEX tables;
  `smf` takes `12` or `D8 12`, lists hours by label and prints tables (`--json` for raw rows). REVIEW staging and
  empty `--evidence` messages say what to do; the SET_PERIOD error names the 0-based index and `docs/agents.md` uses
  `"period":0`. Goldens unchanged.
- **2026-10-27:** Play CLI fix: `new` crashed on every fresh run file (`apply()` read `file.run` before the `new` case), found by the first agent playtest round, which could not start. `new` now runs first and refuses an unknown scenario instead of silently falling back to Midwest; usage and `docs/agents.md` list `harbourline`. Goldens unchanged.
- **2026-10-23:** VENDOR_PRICE card (`SET_MLC_PRICE` → `cost.priceMult`, sub-capacity MLC ×1.08; fix `NEGOTIATE_MLC_PRICE`). Hashes unchanged (`be43ff16de564882`), 377 tests. Sweep seeds 1–5 (Normal, Midwest; card drawn in 8 of 15 runs): do-nothing 12 / 16 / 22 (batch 2 · trust 3), textbook 24 / 27 / 28 (batch 4 · trust 1), expert victory 5/5; inside the bands.
- **2026-10-23:** CI added (`.github/workflows/ci.yml`, `pr-gates.yml`, `tools/ci/`, PR template) for the per-session-branch → `dev` auto-merge workflow. Balance bands checked against current `dev` (seeds 1–5): do-nothing 12 / 16 / 22 (batch 3 · trust 2), textbook 22 / 26 / 28 (batch 3 · trust 2), expert victory 5/5; all inside the bands, 15 runs in ~7 min on 4 cores. Waiting on the user for the GitHub settings (default branch, branch protection, auto-merge).
- **2026-10-21 (loop 117):** revenue balance: REVPOL WEBDDF importance 3 → 4 (flaw G1); do-nothing median 22 → 14
  (seeds 1–10), textbook unchanged at 29. Heavier analytics tried first: no effect, reverted.
- **2026-10-21 (loop 124):** slice templates cached per LPAR by that LPAR's shares within a routing-free scope (bounded
  at 512 sets); bit-identical (hash `eddf17fc7c615524`). Harbourline day 8.7 s vs 9.3–9.9 s before; frozen dynamic
  policies 7.7 s, all-static 6.9 s, so share changes still cost ~1.4 ms each (1 % steps rarely repeat, so misses stay
  common). Next perf idea: share-independent templates (multiply shares at build time) so a change costs nothing; then
  the structural M8.1 items.
- **2026-10-21 (loop 123):** Harbourline perf measured (one headless day, seed 42, this box): Midwest 5.2 s, Harbourline
  9.3–9.9 s, Harbourline with every policy static 7.1–7.7 s (same at the dynamic run's final shares, so it's overhead,
  not load). Dynamic routing changes shares ~700×/day (MOBILE WLM every minute plus CPSM every 30 s); template rebuilds
  ≈ 5 % of step time, updateRouting ≈ 2 %, rest GC/cache churn. Plan (M8.1): per-LPAR template reuse when that LPAR's
  shares are unchanged, and make templates share-independent (multiply the share at build time, bit-identical order);
  six LPARs alone are 1.4–1.5× Midwest, so the structural items in M8.1 matter more for the 2 s budget.
- **2026-10-21 (loop 139):** perf pass (sonnet subagent in a worktree, reviewed and cherry-picked): six bit-identical
  optimisations (addToBuckets bound logs cached per goal, packed emptyBuckets + length guard, resolveCpc config plan
  cached per CPC/LPAR list, iosq service objects shared per DP, WLM log copied only on change, batch job classification
  memoised). Hashes unchanged (Midwest `eddf17fc7c615524`, Harbourline `be97b3e401164fc5`, new `bench --scenario`).
  Gain small: Midwest 4.36 → 3.89 s, Harbourline 7.27 → 7.03 s (agent's back-to-back medians). Profile is flat (no
  function > 10 % self); remaining: ~1.3 s warm-up deopts (~140 'wrong map'), slice/accumulator spreads (~3–4 % each).
  Reaching 2 s needs structural work (fewer per-tick allocations in buildSlices/accumulateTick, or coarser ticks for
  quiet LPARs), not micro-tuning → open question for the user whether the 2 s budget should be revisited for 6-LPAR
  estates.
- **2026-10-22:** Monitor III history (user request; 48 h retention, user decision). The worker records a packed Mon3View every MINTIME (10 ticks) while the tool is owned (`game/mon3History.ts`: numbers in a Float32Array, text shapes interned): ≈5.5 KB/interval Midwest, ≈10 KB Harbourline, so ≈11 / ≈20 MB for 48 h; recording costs ≈1.4 ms per 100 s (< 0.15 ms/tick). Kept out of the run (no save or hash change; lost on reload). Monitor III gets a time bar (◀◀ hour, ◀/▶ interval, slider, Live); pins are hidden on past intervals because they read live values. SPEC §8/§17 and the `rmf` Codex entry updated. 368 tests; hash `be43ff16de564882` unchanged.
- **2026-10-21 (loop 141):** Post-PR #9 Midwest re-sweep matches loop 113 (balance unchanged by the polarity fix). Expert opex game overs (Midwest 2/3/11, Harbourline 5/12/13) traced to the bots taking the BUDGET_SWAP pact; expert now declines it and those seeds win. Loop stopped at the user's request; game artifact rebuilt.
- **2026-10-21 (loop 140):** User accepted a larger perf budget for 6-LPAR estates (decisions log); CLAUDE.md rule 5
  updated. Harbourline expert opex losses (seeds 5, 12, 13, 19, all day 28): month-1 bills $1.73–1.76M are below the
  25 % trip ($1.875M), and winners have bills up to $1.80M, so the trip comes from bill + `opexSpentThisMonth`
  (temporary-capacity charges) rather than MLC alone. Expert buys no COD, so the next step is to find which change
  carries `opexPerDay` with a `revertDay` in those runs (seed-5 replay reproduces the day-28 end). Cost loop stopped
  at the user's request.
- **2026-10-21 (loop 138):** Harbourline 20-seed confirmation (hb40f, Normal, 40 days): **donothing 9 / 12 / 14
  (trust 20), textbook 29 / 32 / 37 (trust 20), expert 28 / 40 / 40 (victory 12 · opex 4 · trust 4)**. In band
  (Midwest loop 113: donothing 11 / 17 / 21, textbook 17 / 28 / 28, expert 17/20 wins). Expert's 4 opex ends are all
  day 28 with month-1 bills $1.73–1.76M (budget 1.5M): left as intended spend pressure for now. Outliers: textbook
  seed 10 day 12, seed 18 day 24. Next: Harbourline perf (~4.4–4.6 s/day vs 2 s budget).
- **2026-10-21 (loop 137):** Harbourline expert re-sweep with the day-1 capacity step (hb40d, seeds 1–8): expert
  28 / 33 / 36, 0 wins (trust 6, opex 2). Harbourline growth was ~0.72 %/day CPU-weighted vs Midwest ~0.45 % → all
  growth ×0.6. **Re-sweep hb40e (seeds 1–8, Normal, 40 days): donothing 11 / 12 / 12 (target 12–18), textbook
  30 / 33 / 37 (target 28–32, a little long), expert 33 / 40 / 40, victory 5 · trust 2 · opex 1** (Midwest expert
  17/20 wins). Month-1 bills $1.52–1.78M vs $1.5M budget (Midwest +7–10 %). Harbourline balance is now in the target
  band. Milestone PR #17 dev→main reviewed by pr-reviewer: MERGE (360 tests, hash unchanged, expert seed 1 VICTORY
  day 40 confirmed) → merged (10f2bfa). Opex comment corrected (bills 5–15 % over). Next: 20-seed confirmation sweep,
  Harbourline perf (~4.4–4.6 s/day vs 2 s budget).
- **2026-10-21 (loop 136):** Harbourline collapse root-caused (sonnet replay of textbook seed 1, day 18): peak-hour
  CP exhaustion on both CPCs (CPC1 85–98 %, CPC2 to 100 % from 09:00) under REGRESSION (RETAIL ×1.5 for 30 h, two
  peaks) + MARKET_OPEN_SURGE + ENCRYPTION_MANDATE; no cap or model blow-up. Counterfactual with REGRESSION off:
  Markets 80 vs 45, day recovers. Fixes: REGRESSION 12 h on Harbourline. Structural bug found: every hardware item
  went to `cpcs[0]` (CPC1, already setting 7 / M2), so expert's day-1 capacity step was a no-op and CPC2 could never be
  upgraded → `ChangeRequest.cpcId`, `HardwareItem.perCpc/unavailable`, refused pointless buys, UI CPC picker, bots
  step the first CPC below 7 (SPEC §5.11.3). 360 tests, Midwest hash unchanged. Re-sweep running → runs/hb40c.csv
  (before: hb40b textbook median day 28, expert 26, all trust/opex ends).
  hb40c (12 h regression + per-CPC hardware): donothing 10 / 11 / 11, textbook 26 / 29 / 32 (in the 28–32 target),
  expert 24 / 26 / 29 (target: wins). Seed-2 digest: expert's day-0 capacity step was refused for hours (Harbourline
  day-0 fixes 10.5 h + 2 h > 12 h incl. overtime), so it played as plain fixer and its emergency changes cost trust and
  shifted the event draw. Expert now retries the capacity step on days 1–2 (CPC2 5 → 6 from day 3). Expert re-sweep
  seeds 1–8 running → runs/hb40d.csv. Open: donothing ends day 10–11 (target 12–18).
- **2026-10-21 (loop 135):** Harbourline balance from the 40-day digest: REGRESSION adapted to RETAIL ×1.5 (was
  Midwest's ×3; RETAIL ≈ half of online CPU, so ×3 added ~10 CPs of demand to a 24-CP sysplex), opex budget 1.4M → 1.5M
  (textbook bills $1.6–1.7M, ~7 % over like Midwest's). Midwest hash unchanged. Re-sweep running → runs/hb40b.csv.
- **2026-10-21 (loop 134):** Midwest perf re-measured (3 runs each, bench seed 42): dev 4.78/4.07/4.28 s vs pre-merge
  main 4.49/3.98/4.39 s, same hash: noise, no regression. Harbourline `GameContent.startTools` (SPEC §13.5): Mon III,
  Partition Data, CF/DASD, CICS monitoring, Db2 accounting installed on day 1 with their measurement overhead applied
  at newRun (test added; Midwest hash unchanged, 359 tests). 40-day Harbourline sweep (3 bots × seeds 1–4) running →
  runs/hb40.csv: every run loses on Markets trust (donothing day 9–11, textbook/expert median day 28–29; one textbook
  opex end). Textbook seed 1 digest: Markets fine (88) until day 17, then day 18 REGRESSION (RETAIL cpu ×3) + MARKET_OPEN_SURGE
  + scheduled index rebalance stack → MKTORD/RETAIL/CARDS/PAYMENTS at 0 % for 6–9 h, Markets 88 → 22 → 0 in two days;
  MLC est. jumps $1.49M → $1.74M (budget 1.4M; already 1.42M by day 5). Next: check whether RETAIL ×3 alone saturates
  both CPCs (Midwest-sized ×3 too big for Harbourline's RETAIL share?), whether bots apply REBIND_REVERT, and retune
  opex budget vs day-1 MLC; then Harbourline perf (~4.6 s/day, budget 2 s).
- **2026-10-21 (loop 133):** milestone PR #16 dev→main (Harbourline playable) reviewed by pr-reviewer: MERGE (358
  tests, hash `eddf17fc7c615524` on both, goldens unchanged, layering/determinism clean); merged. Reviewer note: Midwest
  bench day 4.7 s on dev vs 4.2 s on main (one run each, maybe noise) → re-measure next and profile if real. Next:
  that perf check, 40-day Harbourline sweep, startTools for the pack.
- **2026-10-21 (loop 132):** decision (user, 2026-10-21): QR TCB overload failures count as *slow*, not as abends,
  for CPSM goal routing; real CICS queues on a saturated QR rather than abending fast, so an overloaded region
  repels work and only a genuinely abending region (SICK_AOR) storm-drains. Sim: slices carry `abendFrac`
  (Db2/MQ rejections, `regionFailFrac`) and `failByWorkloadLpar` counts only that. New test: a QR-saturated PROD2
  never registers abends and doesn't draw RBANK (fails without the fix). SPEC §17 updated. 358 tests, hash
  unchanged. Harbourline 3 days seed 1: donothing MKTORD worst hours 87–92 % (was 82–91), textbook unchanged.
- **2026-10-21 (loop 131):** diagnosed the Harbourline dips (sonnet subagent): the scheduled 09:30 ×5 / 16:00 ×4
  market bursts overloaded the AOR QR TCBs (qrFrac 0.6) on any config, and a starved MQ slice (PAYMENTS) reported
  backlog / 1e-9 s as response time (~1e10 s → 0 % hour, and a bogus MXT wait labelled THREAD_LIMIT). Fixes: sim
  bounds a starved queue's wait by Little's law on arrivals (hash unchanged); content open ×3, close ×2.5; textbook
  bot also makes the AORs threadsafe (qrFrac 0.3). 3 days seed 1: donothing still has MKTORD 82–87 % hours and
  MKTQRY 77 %, textbook green except one MKTQRY 86 % hour. Open: a sick/overloaded region still draws CPSM work
  outside SICK_AOR (QR failures count as fast abends); consider whether QR_TCB failFrac should count for routing.
- **2026-10-21 (loop 130):** bot day-0 fixes for Harbourline (`harbourlineDay0`: MKTORD PCT 90 % / 0.2 s, MKTQRY and
  MOBILE on zIIP-aware WLM weights, ABENDTHRESH 10 % / ABENDCRIT 20 % on MKTORD and CARDS, payments 35/35/15/15,
  PRDA absolute cap removed). SICK_AOR moved to CICSAOR3 on PRDC to match SPEC B2. Re-sweep (seeds 1–2, 10 days):
  CAPPING incidents gone, but THREAD_LIMIT (21–26) and CPU_PRIORITY (18–26) take their place, trust 56–63 (was
  58–71), scores 725–727. So the fixes move the bottleneck rather than help: next, find which workload/LPAR hits
  the thread limit (DBAT? CICS MXT?) and whether removing the cap just floods PRDA; tune the fixes or the content.
- **2026-10-21 (loop 129):** first Harbourline bot sweep (seeds 1–2, 10 days, normal): donothing 695 median, one
  trust game-over on day 10 (lowest facet Markets), trust ~42; textbook 733 / trust 60–71; expert 727–733 / trust
  58–65; no batch misses for the active bots. CAPPING dominates incidents (13–27 per run: the PRDA absolute cap, B?),
  then QR_TCB. Expert ≈ textbook, so the bots don't use Harbourline's levers yet. Next: bot day-0 fixes for the
  planted flaws (PRDA absolute cap, MKTORD avg goal in HBPOL, MKTQRY static weights → WLM, ABENDCRIT on CPSM
  workloads), then retune volumes (CPC1 under target) and a 40-day sweep.
- **2026-10-21 (loop 128):** Codex: `sd-wlm-weights`, `cpsm-routing`, `storm-drain` (found on SICK_AOR),
  `absolute-capping`, `arrival-bursts` (found on MARKET_OPEN_SURGE), wired into the Routing and HMC sections; sources
  checked against IBM pages (implementer drafted, URLs replaced with verified ones). Next: startTools for Harbourline,
  bot day-0 fixes, volume retune + sweeps, Harbourline perf.
- **2026-10-21 (loop 127):** UI: Change Desk → Batch & operations → Routing gets a routing-policy form (static / WLM
  weights with zIIP-aware / CPSM goal with ABENDTHRESH, ABENDCRIT, quiesce per region); the static share editor shows
  only under static weights. The Ops fix list now shows only fixes the scenario's deck can call for (`view.fixIds`;
  before, Midwest listed revenue fixes too). Screenshot checked, 357 tests. Next: startTools, Codex entries (SD
  weights, CPSM routing, storm drain, absolute capping, bursts), bot day-0 fixes, retune, sweeps.
- **2026-10-21 (loop 126):** 4b part 2 (game layer): `SET_ROUTING_POLICY` costs 1 engineer-hour (SD VIPADISTRIBUTE / CPSM
  WLMSPEC change), basket target and now → new text (`routingPolicyLabel`), config view exposes each workload's live
  routing policy; new fix RECYCLE_SICK_AOR (1 h, −1 Markets) ends SICK_AOR. Quiescing a region costs its capacity, and
  ABENDCRIT a trickle of failures, so the levers keep trade-offs. 357 tests, hash unchanged. Next: UI routing-policy
  controls (Actions routing form), startTools, then 4c Codex/bots/retune/sweeps.
- **2026-10-21 (loop 125):** large-bank step 4b part 1: Harbourline game pack (`PACKS.harbourline`, 'Harbourline Bank'):
  FICTIONAL budgets ~2× Midwest, facets Markets/Cards/Retail/Payments/Finance/Regulator, 6 story beats, deck of neutral
  and adapted Midwest cards plus SICK_AOR (B2: `regionFailFrac` 0.35 on MKTORD/CARDS@PRDB, storm-drain clue),
  MARKET_OPEN_SURGE and HOLIDAY_CARD_SPIKE; pack tests. Built by the implementer, reviewed. 356 tests, hash unchanged.
  Next (4b part 2): game verbs for routing policy / ABENDTHRESH-CRIT / quiesce / zIIP-aware weights with costs, so
  SICK_AOR's fixes are playable; startTools; then 4c UI, Codex, bots, retune, sweeps.
- **2026-10-21 (loop 122):** large-bank step 4a: Harbourline sim content (2 CPCs, 6 z/OS LPARs, HBPOL, 8 workloads with
  bursts and B1–B4 planted, batch, products; `SCENARIOS.harbourline`, not yet a pack), built by the implementer subagent
  and reviewed. It found a CPSM bug (timeouts read as fast abends → day-long storm drain into a saturated region), fixed
  in sim. Day 1 seed 42: CPC1 55–66 %, CPC2 60–88 %, SLAs ~97–100 % per day, market-open window 72–97 %. Headless
  day ~2× Midwest (6 LPARs + dynamic routing): perf follow-up before balancing. Next: 4b game pack (startTools, facets,
  story, events incl. B2 sick AOR, routing verbs), then volume retune and sweeps.
- **2026-10-21 (loop 121):** large-bank step 3 part 2: `CPSM_GOAL` routing with abend compensation and quiesce,
  `mods.regionFailFrac` for a sick region. Midwest RBANK trial: a PROD2 region failing 40 % draws 96 % of RBANK
  (overall failures 38 %); with ABENDCRIT 20 % it drops to the 2 % trickle. 346 tests, hash `eddf17fc7c615524`, no
  timing change. Next: step 4 Harbourline content (world, workloads, policy B1–B4, events, Codex, game verbs).
- **2026-10-21 (loop 120):** large-bank step 3 part 1: routing policies `STATIC | WLM{ziipAware}` (SD SERVERWLM-style
  shares from displaceable capacity each minute; B3's CP-only default). Midwest MOBILE trial: WLM shifts 57–69 % to
  PROD1, zIIP-aware 65–78 %; no day-time cost. 342 tests, hash `eddf17fc7c615524`. Next: `CPSM_GOAL` + region health
  (B2 storm drain), quiesce, game-layer verbs.
- **2026-10-21 (loop 119):** large-bank step 2: burst arrivals (`ArrivalShape.bursts`, random + scheduled, RNG drawn
  only for bursty workloads). 335 tests, hash `eddf17fc7c615524`. Next: step 3 routing policies.
- **2026-10-21 (loop 118):** large-bank step 1 (multi-CPC, SPEC §13.5): per-job-CPC critical projection, power cap hits
  every CPC, capacity groups must stay on one CPC; two-CPC Midwest test (deterministic, group check). 332 tests, hash
  `eddf17fc7c615524`. Next: view/hardware CPC selector, then step 2 burst arrivals.
- **2026-10-21 (loop 116):** textbook day-28 wall traced (intended; above). Revenue deck: 16 agency cards adapted from
  Midwest (retargeted mechanics, agency clues, facet-correct fix twins), bot fix lookup per scenario. 330 tests, Midwest
  hash unchanged, Midwest expert table identical.
- **2026-10-21 (loop 115):** PR #13 (Monitor III screens per RMF Report Analysis) reviewed by the new `pr-reviewer`
  subagent and merged (325 tests, hash unchanged). Sweep now saves each run to `<out>.partial.jsonl` and has `--resume`
  (a sweep killed at 59/60 had lost everything). SPEC §13.5 large-bank design written. Midwest 20-seed re-sweep: textbook
  median 28 (on target) with a day-28 batch wall, do-nothing 17, expert 17/20 victories. Branch renamed to `dev`.
- **2026-10-21 (loop 114):** second scenario *State Revenue Agency* (scenario packs, per-scenario facets, shared batch generator, REVPOL flaws G1–G3, H1–H2, SPEC §13.4, bot day-0 fixes, UI picker). Midwest unchanged: bench hash `eddf17fc7c615524`, goldens unchanged, 320 tests. Revenue sweep seeds 1–6 on target (above). The loop-113 Midwest re-sweep died mid-run (a bot.ts edit during the sweep); re-run pending. Planned a large-bank scenario (user request).
- **2026-10-21 (loop 110):** PR #10 (CICS goal checks) merged after check + hashes; RETRY_STORM card (mobile λ ×2.5, CPU/txn flat; fix MOBILE_BACKOFF) with realism test. 308 tests, bench hash unchanged.
- **2026-10-21 (IBM-docs realism thread):** audited WLM, capping, IEAOPTxx, CF heuristic against MVS Planning: WLM V2R5,
  Init & Tuning Ref and the WSC sync/async paper. Fixed I/O using (connect only), discretionary batch zIIP overflow and
  CF lock conversion (goldens/hashes regenerated); citations added to correct-but-uncited models. Seed 42 bots: do-nothing
  day 15 → 16, textbook day 25 → 26 (small easing).
- **2026-10-21 (loop 109):** no-repeat 20-seed re-sweep recorded: do-nothing median 16, textbook 26; ends now mostly trust. No code change.
- **2026-10-21 (loop 108):** do-nothing day-4 loss traced to back-to-back JOB_ABEND draws; no card repeats on consecutive days. Bench hash unchanged, 299 tests.
- **2026-10-21 (code-quality thread):** worker/play duplication folded into game helpers; policy names past 9 keep 8 chars (BASEPOL9 → BASEPO10, was BASEPOL1); `noUnusedLocals`. 8-day hash unchanged.
- **2026-10-21 (realism thread):** period aging for batch jobs and address spaces, sysplex-scope type 1 resource
  groups, SCRT capacity-group limit in MLC. Hash unchanged (25f061d42778588a). 294 tests.
- **2026-10-21 (bug-hunt thread):** fixed three bugs. Successors of a batch job that overran 06:00 stayed HELD forever
  (`closeNight` dropped the night's finished jobs while it still had stragglers). An SLA incident open at 06:00 kept
  counting into the day it started, so the new day reported 100% attainment and paid the clean-day trust bonus; incidents
  now split at the day boundary. Batch lock stretch used the online Db2 rate of the images dispatched so far, not the
  sysplex rate (PROD1 batch saw only PROD1 traffic); goldens and the bench hash change with it. (Type 1 resource groups
  were also applied in full on every system; left to the realism thread's PR #7.)
- **2026-10-21 (perf thread):** `step` split into per-LPAR stages; day 1 ~20% faster, hash unchanged. 288 tests.
- **2026-10-21 (loop 107):** STORAGE card tried; found and fixed a swap deadlock (`minSwappedIn: 1`); card not added (M8.4).
- **2026-10-21 (loop 106):** SMF_AUDIT card (22 cards); HyperPAV exhaustion dropped.
- **2026-10-21 (loop 105):** CICS_SOS card (21 cards), modelled as an MXT cut. Open question logged: raising MXT also clears it in the sim, unlike real SOS.
- **2026-10-21 (loop 104):** ZIIP_LOSS card (20 cards): new sim modifier `ziipEligMult` (neutral 1, so SET_MODIFIER's reset-at-1 works and project `ziipShift` is untouched). Bench hash unchanged; goldens unaffected. 286 tests.
- **2026-10-21 (loop 103):** career level 7 unlocks a starting tool (Report Class Hoarder).
- **2026-10-21:** post-PR #8 20-seed re-sweep: do-nothing median 15, textbook median 27 (still short of target; booking go-live + reorg/abend batch walls).
- **2026-10-21 (loops 93–102):** draft perks and the vendor tool trial; all SPEC §9.5 opportunities exist; smoke sweep, no regression.
- **2026-10-20 (loops 80–92):** play CLI, player agents, spectator mode (M8.9); perf profiling.
- **2026-10-20 (loop 79):** contrast audit fixed the light theme's status colours; contrast test for all themes. 273 tests.
- **2026-10-20 (loop 78):** career v1 (XP across runs → starting-perk unlocks, IndexedDB). 270 tests.
- **2026-10-20 (loop 77):** two pact draft cards (persistent perk + persistent downside). 267 tests.
- **2026-10-20 (loop 76):** weekend auto-run (full sim at worker speed, report card as summary); weekday shown. 265 tests.
- **2026-10-20 (loop 75):** day-1 guided tutorial (corner card, state-driven steps, F1 fix detection); ticked finished M7 items. 264 tests.
- **2026-10-20 (loop 74):** three new draft options (Weekend push, Friend at the Vendor, Well Connected). 262 tests.
- **2026-10-20 (loop 73):** hourly autosave during the live day (resume mid-day after a crash or reload; no more replaying a day from its briefing).
- **2026-10-20 (loop 72):** endless mode after victory (fresh capex, counts as a win, endless days in report and share line). 259 tests.
- **2026-10-20 (loop 69):** daily seed challenge (implementer subagent, reviewed): UTC-date seed, share line with Copy on the end screen. 257 tests.
- **2026-10-20 (loop 68):** 20-seed Normal sweep with 19 cards: expert 20/20, textbook median 26 (booking go-live drives early Retail collapses). Asked the user.
- **2026-10-20 (loop 67):** fixer bots (expert, spend-to-win) end cards on sight with their fix (REORG, monitor creep, shadow IT, teller release, HSM storm); expert seed 6 Normal now wins (was trust loss day 32; not a paired comparison, see 2026-10-26 RNG decision).
- **2026-10-20 (loop 66):** AUDIT_UNCLASSIFIED card (implementer subagent; reviewed: tunables moved to content). 19 cards, 253 tests.
- **2026-10-20 (loop 65):** HIRING_FREEZE card (implementer subagent; reviewed: reason moved into the briefing). VENDOR_PRICE needs a product price lever in the sim or a run-aware scenario: asked the user. 250 tests.
- **2026-10-20 (loop 64):** RCA trigger truth respects card mechanisms. 249 tests.
- **2026-10-20 (loops 48–63):** morning hints, difficulty severity/timing/starting fixes, Story/Hard sweep, end-of-run report, six new event cards, merger hint (user decision). 229 → 246 tests.
- **2026-10-21 (loop 112):** XLOG_LOOP card: CICSXLOG log archiver matches the CICS* STC rule, lands in STCHI (imp 1) and loops on ~1 engine on PROD1. Fixes: cancel (Regulator −1) or a reclassification rule. Built as an STC rather than the SPEC's batch job because address spaces classify by jobname only; SPEC §9 row updated. Realism test; 311 tests, bench hash unchanged (eddf17fc…).
- **2026-10-21 (loop 113):** ENCRYPTION_MANDATE (permanent +6% CPU/txn on CARDAUTH/TELLER/PAYMQ; fix SCOPE_ENCRYPTION, Regulator −2) and GREEN_IT_COD (On/Off CoD refused for 7 days via a new `blocksHardware` card field checked in previewChange, so CPM automation is refused too). SPEC §9.4 rows updated. 313 tests; 1/3/8-day hashes unchanged. Full bot re-sweep started on the 26-card deck.
- **2026-10-21 (thread):** Monitor III realism audit vs *RMF Report Analysis* ch. 2 (SYSSUM view added; SYSINFO, DELAY, PROCU, ENCLAVE, CPC, WFEX columns and formulas fixed; UKN split out of DLY %). The *RMF User's Guide* PDF could not be located under the usual ibm.com/docs PDF names. Game/UI layer only; goldens unchanged.
