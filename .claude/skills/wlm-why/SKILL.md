---
name: wlm-why
description: Explain why GOAL MODE's WLM did or didn't move a service class period at a given moment (why CICS wasn't raised, why batch wasn't donated, why a PI stayed red) from a run file, using npm run inspect dp/wlm, and say whether it is real z/OS behaviour, a sim gap or the player's policy. Use for any "why didn't WLM help X" question from a playtest, a bot run or an audit. Usage - /wlm-why <file> <system> <time> [class], e.g. /wlm-why runs/a.json PROD2 'D19 22:00' ONLCARD.
---

# Why did WLM do that?

The question is almost always "why *not*": the WLM log says "no action with net value" or nothing at all, and the
answer lies in what `policyAdjust` (`src/sim/wlm/adjust.ts`) tried and rejected. `npm run inspect -- <file> wlm`
prints exactly that. Work through the steps below; most questions need four or five tool calls.

Everything `inspect` prints is sim internals. Quote it as "the sim's WLM decided…", never as a report the player
could have read. Never use it in player agents, and in a live playtest follow the companion's spoiler rules (the
trace can name an event's effects before the player has filed an RCA).

## 1. Get a file you can trace

- **Play-CLI file** (`npm run play -- <file> …`; its `log` starts with `new`): `inspect wlm` replays seed + log to
  any past time. This is the good case.
- **Browser save** (an export or the player's zip; no log): only traceable *forward* from the saved moment, and
  only during a live day. A question about an earlier time can't be answered from it. Say so, then fall back to
  step 2's evidence and mark the cause **not verified**. `decodePlayFile` already repairs doubled backslashes and
  surrounding backticks; unzip uploads into their own empty scratchpad directory first.
- Check the build: run `inspect` from a checkout of the build that produced the file. Saves from an older artifact
  build need a worktree at that commit (`git worktree add <dir> <sha>`, symlink `node_modules`); fetch first.

## 2. Find the moment

Narrow it to a 10-minute window before tracing:

```bash
npm run -s play -- <file> wlmlog <system> --grep <CLASS>                     # what WLM logged (RCVR= lines are moves)
npm run -s inspect -- <file> dp <system> --class <CLASS> --from 'D19 20:00' --to 'D20 02:00'   # DPs per RMF interval
npm run -s play -- <file> report WLM_SUMMARY                                  # PI / velocity / delays per interval
npm run -s inspect -- <file> wlm-stats [system] --from 'D19 06:00' --to 'D21 06:00' --ladder '22:00'   # whole-range counters (WT-01)
```

Note the PI, DP and bottleneck of the period in question and of everything above it, from the RMF interval that
covers the moment.

## 3. Trace it

```bash
npm run -s inspect -- <file> wlm <system> --at 'D19 22:00' --ticks 12 [--class ONL]
```

One block per 10 s policy adjustment: the action taken (or "no DP change"), then the receiver candidates in the
order WLM assessed them (importance, sysplex PI, local PI, DP, bottleneck), with each trial move and its verdict.
Identical adjustments collapse to one line. `--class` filters the candidates shown, never the action. Trace a few
minutes (`--ticks 30`) when the answer might be "WLM did help, later"; a run of the same verdict over many ticks is
the finding.

For a question about a whole day or run rather than one moment, `inspect … wlm-stats` gives the same counters over a
range (the wlm-design audit's S-table): adjustments, candidates by outcome, trials by verdict, accepted and reversed
moves, episodes of a period assessed on 30 adjustments without a receiver move, and with `--ladder` the DP ladder at a
clock time each day. `--by-class` breaks the outcomes down per period, `--episodes` lists each 30-assessment run
(first and last assessment, verdicts, the move that ended it) and `--moves` lists every accepted move with the
receiver it was made for: start there for "why was X never helped today". `--json` prints the counters for a script. It replays faithfully — a logged `advance` stops where
the play CLI stopped (a fresh ABEND, the end of a played day), and a log that ends before `--to` says so — and costs
about 6 s per played day, so give it a range rather than a 19-day file when a shorter one answers the question.

## 4. Read the verdicts

| Output | What the sim did | Real WLM (check before claiming; docs/research.md rows) |
| --- | --- | --- |
| Candidate order | Importance first; within it sysplex PI before local PI, worst first (I3) | Matches: SG24-6472-03 p.59, SG24-7621 p.105–107 (research.md "global before local") |
| `(regions $SRMS001)` after a class | A CICS transaction class served by TRANSACTION regions: it is the goal receiver, and its server period, which holds the regions' DP, is what moves (WT-09) | Matches: goal and resource receivers, the free ride (SG24-6472-03 p.62–63, p.86–89; WLM Services p.138). One server period per system is an APPROX |
| `not assessed: skip clock running` | Every plan was rejected at this period's last assessment; it is skipped for 3 intervals (`rejectedSkipTicks`) and looked at again at `next look` | Matches: WLM Services p.145; 3 cycles, Sinram SHARE 2010 session 7777 p.11. Look at the assessment that set it for the reason |
| no skip clock after a rejection | Five or fewer goal periods on the image miss their goals, so the clock is not honoured and the period is assessed again next interval (RF-03) | Matches the z/OS 1.11 change (same SHARE p.11). APPROX: the count is per image |
| `not assessed: no managed delay` | Under 2 % of the period's samples are CPU, zIIP, I/O (in velocity), storage or queue delay: no priority can help | Matches: the "needs help" indicator (WLM Services p.144). A red PI with no managed delay is unknown or idle state, a dependency, or a goal that is too tight |
| `not assessed: CPU and zIIP delay each under 15 % …` | The managed delay is mostly I/O, storage or queue: no DP move tried (WT-10) | WLM fixes the biggest delay with the matching resource; the sim only models CPU/zIIP DP moves. Look at the delay breakdown, not the DP |
| `mostly waiting` | Waits (locks, servers, CF, capping) are most of the samples; they are not managed delays and no priority helps | Matches the "not WLM-fixable" pattern (SPEC §5.5.4) |
| `not assessed: the interval's projection budget is spent` | The 12 projections for this image and interval went to candidates before it; the next search starts at it | **Sim approximation** for cost only: real WLM examines every candidate (SG24-7621 p.105–106). With skip clocks this is rare; a class stuck here over many ticks is a sim bug |
| `not assessed: projected PI … already ≤ 1` | The projection at sustained demand says the period recovers at its current DP; the management PI is still catching up | Sim approximation of WLM projecting from sampled demand (WLM Services p.144); no move is needed |
| `donors in order: …` | Happy holders first, lowest PI first, importance ignored; then the rest from importance 5 up; at most 3 (WT-07) | Matches: WLM Services p.138, p.147; SG24-6472-03 p.59–60. The limit of 3 is FICTIONAL |
| `UP` / `CARRY` / `DONOR` steps, `RETAINED` | One plan of up to 6 moves on a copy of the ladder: receiver raises, a blocker carried along, donors lowered; a step that passes net value is kept (`RETAINED`) and the whole plan is committed only with receiver value (WT-08) | Matches the shape of IBM's assessment (SG24-6472-03 p.67–68; WLM Services p.137–138). The step limit and the single carry are APPROX |
| `plan ended: …; no tentative moves committed` | The plan ran out of steps or receiver value: nothing was applied | Real WLM also applies a change only when the whole assessment is positive (SG24-6472-03 p.66) |
| `CPU_CRITICAL` | The move would put a less important period at or above a CPU-protected one. Protection is restored before any trial, so current DPs never break it | Matches (WLM Planning p.120; WLM Services p.705) |
| `NO_RECEIVER_GAIN` / `SMALL_GAIN` | Projection says the plan barely helps the receiver: under max(10 % of the gap to PI 1, 0.05) | Receiver value test (WLM Services p.138); the numbers are the 1994 patent's and Enrico's, not IBM product documentation |
| `MORE_IMPORTANT_HARMED <class> PI a→b` | Projection pushes more important work past its goal | Net value (SG24-6472-03 p.66; WLM Services p.137–138). Check whether the projection is plausible; the sim re-evaluates every period on the LPAR |
| `MORE_IMPORTANT_HARMED <class> … is missing its goal and would be passed` | Less important work may not move to or above more important work that is missing its goal, whatever the projection says; no projection spent | 1994 patent p.19 and Enrico slide 52, not product documentation (user decision 2026-11-10). On a capped image it freezes WLM below the missing class, by design |
| `PROJECTION_DISAGREES` (receiver) | The receiver's management PI is over 4 × its projection and the projection bounded its transaction backlog: it is not raised (donor moves are still tried) | **Sim approximation** guarding the sim's backlog bound (docs/wlm-design.md §9.5); real WLM's demand data does not hide a backlog |
| `PROJECTION_DISAGREES … is behind with a backlog the projection bounds and would pass X` | A trial would put X below a period far behind its goal with a bounded backlog; that backlog would starve whatever ends up below it | **Sim approximation**, same cause (§9.12; WT-16 may replace both guards) |
| `EQUAL_DISPARITY` / `NO_NET_VALUE` | Equal-importance harm too large, or PIs end up further apart | Matches: SG24-6472-03 p.60; Enrico *How WLM Works* slide 52 |
| `no move to try` | Receiver already at the top managed DP and no donor at or above it | Nothing left to give on CPU; capacity or policy, not WLM |
| `no candidate` | Every goal period meets its goal (PI ≤ 1) | A red PI elsewhere is another system's or the sysplex view |
| `CPU protection restored first` | A less important period had reached a protected one's level (after a policy edit or a new period); it is moved down before the search | Matches the direction: the less important one is moved (WLM Services p.705) |

Then check `docs/research.md` for the row, and verify with the `zos-docs` skill when the verdict turns on real
behaviour that isn't there yet. Say "not verified" otherwise.

## 5. Call it

- **Real z/OS behaviour** (the player's policy or knowledge): say which rule and why their policy hit it, and what
  would have changed the outcome (importance, goal, CPU Critical, routing, capacity). This teaches something.
- **Sim gap**: the verdict follows code that differs from the documentation. Give `file:line`, the doc citation and
  the numbers; it becomes a BACKLOG.md entry (`realism-fixes` or `playtest-fixes`), never a silent fix.
- **Design gap**: real behaviour, but the game gives the player no clue path to see it (e.g. the WLM log hides the
  reason). That's a BACKLOG.md entry too.

Report as: what was seen → what the sim did (numbers from the trace) → real z/OS (source) → verdict.
