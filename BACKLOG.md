# BACKLOG.md

The development work that is scoped and ready to pick up, for **GOAL MODE**. Agents implement only from this file
(user request 2026-11-09). Anything else, including PROGRESS.md design directions, proposals awaiting the user,
milestone roadmaps and open questions, is **not** work to start until it has been scoped into an entry here.

## Rules

- **One entry per change.** Each entry is one PR's worth of work. Split it if it isn't.
- **Pick only `status: ready`.** `blocked: <reason>` entries wait for what the reason names:
  - `design`: a design call, by the user or the main agent with the user;
  - `user`: a user decision;
  - `balance`: a balance call, which stays with the main agent (CLAUDE.md);
  - `research`: an IBM-docs answer first.
  Unblocking an entry means rewriting it with the decision and setting it to `ready`, in a PR of its own or in the PR
  that settles the question.
- **Pick order** within a list: high/S, high/M, low/S, low/M, then L. Ties go by ID.
- **Claim by PR.** The PR that implements an entry names it in its body (`Backlog: PT-07`). An entry with an open PR
  naming it is taken. Don't write "in progress" into this file.
- **Remove on fix.** The PR that fixes an entry deletes it from this file, and records anything durable in SPEC §17,
  docs/research.md or PROGRESS.md decisions. A partial fix rewrites the entry to what remains. IDs are never reused.
- **Adding entries.** Each needs: a stable ID with its list's prefix (next free number), list, status, priority
  (`high` | `low`), size (`S` ≤ ~100 lines, `M` ≤ ~400, `L` more), area (`sim` | `game` | `ui` | `content` |
  `tooling`), source, what to change, and "Done when". `sim` entries are model changes: goldens, a "Behaviour change"
  note, a sweep (`npm run sweep:remote`) and the CLAUDE.md realism policy (zos-docs citations) apply. They stay on the
  main agent, not subagents.
- **Lists.** A loop or agent told to work through "the backlog" must be given a list name from the table below. A
  request that names no list, or names something that isn't a list here (e.g. "everything in PROGRESS.md"), isn't
  enough to start on.

| List | Prefix | What goes in it |
| --- | --- | --- |
| `playtest-fixes` | PT | Findings from human and agent playtests: bugs, clue-path gaps, UI and tooling problems |
| `pr-followups` | PR | Non-blocking findings left open by PR reviews |
| `realism-fixes` | RF | Sim model changes queued by docs/research.md rows (sim status "Fix queued") or audit rounds |
| `cleanup` | CL | Refactors and tooling tidy-ups with no behaviour change (prove it with `npm run compare`) |

## playtest-fixes

Sources: playtest round 2 (2026-11-04, Midwest Normal seed 467203, builds `2253b11` / `d8ada51`; narrative in
PROGRESS.md) unless stated. Investigation facts are in docs/research.md.

### PT-02 · A player change can carry any sim command
`list: playtest-fixes · status: ready · priority: high · size: M · area: game`

Found 2026-11-09 in review of piconaut/goal-mode#238. The play CLI's `json change` takes `req.commands` from the client
as-is:
- Event-only kinds plan like any change, at the 0.5 h default: `ADD_CPC_ENGINES` (free engines), `SET_MLC_PRICE`,
  `SET_MODIFIER`, `ADD_WORKLOAD`, and `REMOVE_ADDRESS_SPACE`. The last one ends XLOG_LOOP without its fix, or removes
  an AOR that work is routed to.
- A request with a `fixId` skips `dryRunRefusal` but still applies its commands, and any fix id is accepted with no
  event active. On a live day, `CANCEL_RUNAWAY` plus `ADD_CPC_ENGINES` took CPCA from 8 to 12 CPs for 0.5 h and no
  capex. The same path can put MOBILE on SYSP past `placementRefusal`.
- Allowed kinds carry event-only fields: `SET_CF degrade`, `SET_LCU extraIops` and `SET_CICS leak` end their events
  without diagnosis. `SET_LCU hotSkew` has no limit through JSON, unlike the UI.

Fix: allow only the kinds with an engineer-hours cost (`HOURS` in `game/catalog.ts`), refuse commands alongside a
`fixId` or `hardwareId`, and check event-only fields. A tested allowlist was written and then reverted out of #238
(commit f4a8dec), so start from that.
Done when: each case above is refused at no cost, with tests; the UI and bots are unaffected (`npm run compare`).

### PT-03 · Power-cap RCA is a gotcha (remaining parts)
`list: playtest-fixes · status: ready · priority: high · size: M · area: game`

INC52 RBANK: filed CPU_CAPACITY/HARDWARE_FAULT, truth CPU_PRIORITY/HARDWARE_FAULT. CPU_CAPACITY needs CPC ≥ 90 % (or
LPAR ≥ 95 %) and < 10 % of CP to less important work (`src/game/sla.ts`); CPCA was 70.9–82 % physical. Already fixed:
the card's affected workloads (POWER_CAP resolves every workload on the throttled CPC) and the RCA vocabulary in the
form. Remaining:
- move the CPU_CAPACITY thresholds out of `sla.ts` into `src/content/` (CLAUDE.md data-driven rule);
- explain the verdict after scoring ("CPC 81 % busy, below the 90 % capacity line");
- show a capacity-adjustment clue in CPC / Partition Data (SMF70CAI/SMF70CCR, MVS SMF p.589; check with zos-docs).
Done when: all three are in, with tests; the scoring itself is unchanged (goldens unchanged).

### PT-04 · POWER_CAP's RCA scope is a start-time snapshot
`list: playtest-fixes · status: ready · priority: low · size: S · area: game`

Known limitation left by the POWER_CAP fix: `affects` is resolved when the card starts and kept for expired-card
attribution. Routing changes and workloads added during the cap don't refresh it, so mid-cap moves can leave stale
attribution or miss newly exposed workloads. Done when: attribution follows the routing in effect during the
incident's hour; a regression test covers a mid-cap routing change.

### PT-05 · Clue path for "why didn't WLM raise CICS"
`list: playtest-fixes · status: ready · priority: high · size: M · area: game`

The player read the WLM log correctly but couldn't see why there was no receiver raise. Add to the player-visible WLM
log the best rejected trial and why ("ONLCARD F4→F6 rejected: harms DDFMOB, equal importance"). On WLMGL/SYSWKM, say
that a region class managed to transaction goals runs at the served classes' DP (its own PI is reported, not managed
to; WLM Planning p.111, p.122–123). The `inspect wlm` trace sink in `adjust.ts` already has the verdicts.
Done when: both clues show in the browser and in `play wlmlog` / `play mon3`; no decision changes (`npm run compare`
differs only in the log/report text).

### PT-06 · IIPCP reported on an image with no online zIIP
`list: playtest-fixes · status: ready · priority: low · size: S · area: sim`

With PROJECTCPU=NO (the default) and no zIIP configured, real RMF reports no IIPCP (Init & Tuning p.434; re-check with
zos-docs). The sim always reports it. Midwest PROD2 now has 0 online + 1 reserved zIIP, so it still shows there.
Done when: IIPCP is zero on an image with no online zIIP (reporting only), with a test and a docs/research.md row.

### PT-07 · No clue path from a sysplex PI to the LPAR behind it
`list: playtest-fixes · status: ready · priority: low · size: M · area: ui`

The D19–D20 STCMED alerts were DEVT's test Db2 (`TN=DB*` → STCMED, importance 1) under DEVT's cap; Monitor III DELAY
named a PROD batch job as STCMED's primary reason. Sysplex PI first is real (SG24-7621 p.105–106), but the per-system
split should be easy to find. Done when: the alert and SYSSUM link to the per-system rows (WLMGL by system, or a
by-system SYSSUM toggle).

### PT-08 · No alert for CICS short-on-storage stalls
`list: playtest-fixes · status: ready · priority: low · size: M · area: content`

Response times are for ended transactions only, so PI looking fine while transactions stall is real (RMF Report
Analysis 3.1 p.148; SG24-6472 p.190). The game has no alert on what does show it: ended-rate drop, SOS time, MXT waits.
Done when: an Analytics/automation alert rule for it exists in `src/content/`, with a test and a Codex mention.

### PT-09 · A forewarned fix planned ahead is silently wasted
`list: playtest-fixes · status: ready · priority: high · size: M · area: game`

D24: the inbox forewarned a stored-procedure redeploy and the player planned "Redeploy as native SQL procedures" in the
briefing. It applied at 06:00, the card started later that morning, `endEventByFix` found nothing and the 2 h were
spent. Dev now logs "no active event matched this fix" but still discards it. Pick one:
- the fix arms against the forewarned card and ends it when it starts that day;
- or it is refused at planning time with the reason, and the hours are refunded if it found no target.

A free refusal must not let the Change Desk probe for hidden events, which is why no-target fixes are charged today.
Also, the same card came twice in that run (D11, D24): if a redeploy reintroduces COBOL procedures, say so in the
card's clue. Done when: the chosen behaviour has tests and the SPEC §6 visibility rule is updated.

### PT-10 · Activate a saved policy now
`list: playtest-fixes · status: ready · priority: low · size: M · area: game`

Saved policies can only be scheduled; real `V WLM,POLICY=` exists. Add "Activate now" (an ordinary activation,
emergency when live) and "Load into editor". Done when: both are in the browser and the play CLI, with tests.

### PT-11 · Hardware orders and On/Off CoD during the live day
`list: playtest-fixes · status: ready · priority: low · size: M · area: game`

Every live change is an emergency (−1.5 trust per stakeholder, fail roll). That includes lead-time items (CP/zIIP/ICF,
4 days) that arrive later anyway, and there's no "plan for tomorrow" while live. CoD costs $9k/day for 3 days per order,
with no early end. Fix: allow plan-for-tomorrow during the live day without the trust cost, or exempt lead-time items;
add "Deactivate CoD" from the next day (check real early deactivation with zos-docs first; if unverified, mark it
APPROX). Done when: implemented with tests; bot sweeps are unaffected (bots don't use emergencies).

### PT-12 · The TFP offer lacks the numbers
`list: playtest-fixes · status: ready · priority: low · size: M · area: ui`

The offer shows baseline $/month, the sub-capacity bill at the peak and overage %. The per-product terms are stripped
from the view, and nothing projects TFP against sub-capacity from history. Add a per-product table (peak MSU and
$/MSU, baseline MSU-hours and $/MSU-hour, MSU-hours used) and a run-rate projection. Done when: the offer shows both,
in the browser and `play finance`.

### PT-13 · SMF 101 "vs base" moves retroactively
`list: playtest-fixes · status: ready · priority: high · size: M · area: game`

`src/game/smf.ts` divides past hours by today's baseline, an EWMA (0.8/h) learned from every SLA-met hour, so a
regression is absorbed in ~3 h: at the D7 briefing the D6 08:00 row read 1.00 instead of ≈2.8. Fix: freeze each hour's
ratio when it closes, and learn the baseline only from hours without an active event of that mechanism (or a slow
decay, or same hour last week). Also tag the Db2-team mail "(Db2 Whisperer)": it is the perk's tip, sent at event
start. Done when: a past row keeps its ratio across days, with a test.

### PT-14 · Monitor III CPC report: per-type groups
`list: playtest-fixes · status: ready · priority: low · size: M · area: ui`

CPC lists CP rows only. Real Monitor III CPC has per-type groups with *CP / *ICF / *IIP and PHYSICAL lines (RMF Report
Analysis p.97–98; check the Monitor III CPC page with zos-docs). Done when: the browser and `play mon3 CPC` show the
groups.

### PT-15 · Monitor III charts: choose which charts to show, fix CP busy labels, add CPU by service class
`list: playtest-fixes · status: ready · priority: low · size: M · area: ui`

Three changes to the Monitor III charts panel (`src/ui/Mon3Charts.tsx`):
- **Chart picker.** The player chooses which charts to show and which to hide, across **every** chart in the panel:
  PI, CP busy, delay breakdown, PR/SM delay, % capped, response time, arrivals, DDF engines, and the new chart below.
  Use one control in the panel header, like the existing class pickers. Remember the choice per viewer in
  localStorage, the way the panel's open/closed state is (`OPEN_KEY`; `useStored` for the pattern), and survive
  blocked storage. The default is today's set. Hidden charts leave no gap in the layout, including at phone width.
- **CP busy labels.** "CP busy per system" plots % of logical CPs per LPAR but % of physical CPs for the CPC line.
  Relabel it so each line says which it is, and add a "% of CPC" option that plots every LPAR against the CPC's
  physical CPs.
- **CPU by service class.** A new chart of CPU engines per service class (per-class engines are already sampled). It
  is an ordinary chart in the picker, hidden by default.

Done when: each chart can be hidden and shown again, the choice survives a reload (and falls back to the default when
storage is blocked), the CP busy chart says what each line is measured against, and the new chart is in the picker.
UI only: `npm run compare` shows no difference.

### PT-16 · CPC busy forecast ignores weekends and capacity changes
`list: playtest-fixes · status: ready · priority: low · size: S · area: game`

The forecast is a 10-day log-linear fit of daily peak busy as % of installed CPs. Weekends (47 %, 34 %) and added
capacity pull it down. Fit weekdays (or add a weekday term), forecast MSU demand against capacity, and mark capacity
changes. Done when: the fit skips weekends and uses MSU, with a test.

### PT-17 · Browser saves can't be traced into the past
`list: playtest-fixes · status: ready · priority: low · size: M · area: tooling`

`inspect wlm` replays a play-CLI file from seed + log, but a browser save holds only the current state, so a question
about an earlier moment (INC126 D29, asked from the D40 save) can't be answered. Option: keep the live day's
start-of-day state and its commands in the save. Measure the size cost first and put the numbers in the PR.
Done when: `inspect wlm --at` works on a browser save for any time in its current day.

### PT-18 · Imported saves lack Monitor III history
`list: playtest-fixes · status: ready · priority: low · size: M · area: game`

`mon3 --at` on an imported save shows nothing for past ranges. Replay forward to rebuild it, or include the history in
the export. Done when: `play mon3 --at` on an imported save shows earlier ranges of its current day.

### PT-19 · Inbox change notices are always bad news
`list: playtest-fixes · status: blocked: design · priority: low · size: M · area: content`

By D26 the player rolls back any announced change on sight (Db2 REBIND, monitoring agent). Add changes that help
(better access path, cheaper agent) so impact has to be judged. Needs a design call: which changes, how often, and how
the player tells good from bad (SPEC §9 clue rules).

### PT-20 · General-purpose operations instead of per-event ones
`list: playtest-fixes · status: blocked: design · priority: low · size: L · area: game`

Add operations for common fixes that aren't tied to one event, and generalise event-specific ones (e.g. "Recycle CICS
AORs" with a choice of regions). Each event registers a general operation that fixes it, so `endEventByFix` matches on
effect, not on a card-specific fix id. Needs a design call; interacts with PROGRESS.md design direction D1.

### PT-21 · Starving "Internal" work is free
`list: playtest-fixes · status: blocked: design · priority: low · size: M · area: game`

TSO and ADHOC have stakeholder `Internal` and SLA `NONE`. DEV batch is non-critical with `lockIntensity` 0, so capped or
discretionary work costs nothing (a lever with no cost). Candidates: an Internal trust facet or inbox escalation when
TSO/ADHOC degrade; capped work holding Db2 locks or ENQs (enqueue promotion); sysprog TSO during incidents.

### PT-22 · Pacing and late-game engineer hours
`list: playtest-fixes · status: blocked: design · priority: low · size: M · area: game`

D17: running out of things to spend engineer-hours on. D19: system well tuned, little to do. "Ask if anything could
hit the system" was the only good late use of hours (the player liked it). Options: more projects, late-game sinks,
dynamic difficulty.

### PT-23 · One job class for every batch stream
`list: playtest-fixes · status: blocked: design · priority: low · size: L · area: game`

All Midwest production streams are class A, so non-Db2 BKP and HSK can't go to SYSP (cheaper under TFP) without the Db2
streams. Player proposal: finer job classes (Db2 production, non-Db2 utilities, reports), each with initiators per
LPAR, reclassing via a Change Desk JCL change with lead time and a small failure risk. Information in tiers: SMF 30
class and program; inbox answers per stream; the batch analysis unlock shows the network. SCHENV later.

### PT-24 · Grade S (100) felt generous
`list: playtest-fixes · status: blocked: balance · priority: low · size: S · area: game`

The player doubted it. Check the grade's inputs and caps against sweep results; the call is the main agent's.

## pr-followups

Non-blocking findings from the reviews of #178–#185 (2026-11-04), each still present on `dev` at 7fbeffa.

### PR-01 · A scheduled activation overrides a queued install
`list: pr-followups · status: ready · priority: high · size: S · area: game`

From the #179 review. `advance` pushes the policy-schedule activation after `pendingCommands` in the same tick
(`src/game/run.ts` `scheduledActivation`). So if the game is paused on an hour with a schedule entry (including 06:00
at day start), the scheduled policy replaces the player's queued install while the editor still says "Queued for next
tick: X". Show the scheduled entry in `plannedPolicy`, or apply the schedule before player commands.
Done when: the editor and the outcome agree, with a test.

### PR-02 · Cancel B then A leaves A's edit pending silently
`list: pr-followups · status: ready · priority: low · size: S · area: game`

From #180. A's edit stays in the pending policy and A's cancel message doesn't say so (also true before #180; the
edits are uninstalled and visible). Done when: the message says so.

### PR-03 · A suppressed install failure is silent
`list: pr-followups · status: ready · priority: low · size: S · area: game`

From #180. When a later install succeeds after an earlier one failed at day start, the play CLI's day-start text and
the mail don't say that the earlier install's edits went live through the later one. Done when: both say so.

### PR-04 · Planned-policy labels
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #178. CLASSIFY flags the planned policy only as `pending` (`src/worker/game.worker.ts` CLASSIFIED); the play CLI
`status` and `policy` output don't show the planned (queued or briefing) policy at all. Done when: both show it.

### PR-05 · The import dialog reads its result from toast wording
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #181. The dialog (`src/ui/RunFiles.tsx`) matches `Loaded run:` / `Import failed:` toast text. Since #185,
`submittedToast.current = toast` (after the confirmation wait) stores the toast from before the prompt opened, which is
harmless only because results are matched by prefix. Give the worker an explicit import-result message.
Done when: the dialog no longer reads toasts.

### PR-06 · Closing during an in-flight import still replaces the run
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #181, after the player has already confirmed. Done when: closing the dialog cancels the import, or the dialog
can't be closed until the import ends.

### PR-07 · The open modal scrolls with the page
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #181. `.modal { position: relative }` in `src/ui/styles.css`: the open modal dialog computes to position absolute
and scrolls with the page instead of staying fixed. Done when: it stays fixed (check at phone width).

### PR-08 · One unstyled frame on programmatic close
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #183. The `modal` class drops when state resets but `el.close()` runs in a passive `useEffect`; `useLayoutEffect`
would avoid the frame. `close()` also runs twice on cancel (harmless).

### PR-09 · No automated test for the dialog lifecycle
`list: pr-followups · status: ready · priority: low · size: M · area: ui`

#181/#183/#185 were verified by hand with Playwright. Cover the save dialogs and the in-app confirmation
(`src/ui/Confirmation.tsx`): open, close, Escape, reopen, delayed close events, confirm/cancel.

### PR-10 · Confirmation polish
`list: pr-followups · status: ready · priority: low · size: S · area: ui`

From #185. During a file import the button still reads "Reading file…" while the prompt is open; the confirm button has
no primary/danger styling.

## realism-fixes

None open. Completed fixes are in SPEC §17 and docs/research.md.

## cleanup

None open.
