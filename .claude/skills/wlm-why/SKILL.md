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

## 4. Read the verdicts

| Output | What the sim did | Real WLM (check before claiming; docs/research.md rows) |
| --- | --- | --- |
| Candidate order | Importance first; within it sysplex PI before local PI, worst first | Matches: SG24-7621 p.105–107 (research.md "global before local") |
| `not assessed: bottleneck is not CPU/zIIP` | Biggest delay is I/O, cap, storage or other: no DP move tried | WLM fixes the biggest delay with the matching resource; the sim only models CPU/zIIP DP moves. Look at the delay breakdown, not the DP |
| `not assessed: two receivers already assessed` | The sim's per-interval budget ran out | **Sim approximation**: real WLM goes on to the next importance when no receiver can be helped (SG24-7621 p.105–106); a two-receiver cap is not documented. Repeated over many ticks this is a sim gap (PROGRESS: two-receiver budget) |
| `CPU_CRITICAL` | The move would put a less important period at or above a CPU-protected one | Matches for new moves (WLM Planning p.120). If *every* trial fails this way because current DPs already break protection, that's the known freeze bug |
| `NO_RECEIVER_GAIN` / `SMALL_GAIN` | Projection says the move barely helps the receiver | Receiver value test (SG24-6472 p.66–67). Common for CICS region classes managed to transaction goals: raising the region class's DP doesn't move TRANSACTION regions, which run at the served classes' DP (WLM Planning p.122–123) |
| `MORE_IMPORTANT_HARMED <class> PI a→b` | Projection pushes more important work past its goal | Net value test (SG24-6472 p.66–67). Check whether the projection is plausible; the sim re-evaluates every period on the LPAR |
| `EQUAL_DISPARITY` / `NO_NET_VALUE` | Equal-importance harm too large, or PIs end up further apart | Matches: SG24-6472 p.60, Enrico *How WLM Works* slide 52 |
| `no move to try` | Receiver already at the top managed DP and no donor at or above it | Nothing left to give on CPU; capacity or policy, not WLM |
| `no candidate` | Every goal period meets its goal (PI ≤ 1) | A red PI elsewhere is another system's or the sysplex view |

Then check `docs/research.md` for the row, and verify with the `zos-docs` skill when the verdict turns on real
behaviour that isn't there yet. Say "not verified" otherwise.

## 5. Call it

- **Real z/OS behaviour** (the player's policy or knowledge): say which rule and why their policy hit it, and what
  would have changed the outcome (importance, goal, CPU Critical, routing, capacity). This teaches something.
- **Sim gap**: the verdict follows code that differs from the documentation. Give `file:line`, the doc citation and
  the numbers; it becomes a PROGRESS item (realism fix or bug), never a silent fix.
- **Design gap**: real behaviour, but the game gives the player no clue path to see it (e.g. the WLM log hides the
  reason). That's a PROGRESS item too.

Report as: what was seen → what the sim did (numbers from the trace) → real z/OS (source) → verdict.
