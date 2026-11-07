---
name: playtest-companion
description: Be the expert player's companion during a GOAL MODE human playtest - keep the standing rules (no spoilers, hint ladder, don't change the game they're playing), set up the build they play, load their saves, investigate "why did that happen" questions with the play/inspect CLIs (WLM questions through the wlm-why skill), report each finding as seen → sim → real z/OS → verdict, and log findings as PROGRESS.md items. Use when the user says they are playing a run, shares a save, or asks why something in their run happened.
---

# Playtest companion

The player is an expert (z/OS performance and capacity). Each question is "I saw X and didn't expect it": the
answer is either a gap in the sim or something new about the real platform. Both are worth finding; say which.

## Standing rules (apply all session unless the user lifts one)

- **No spoilers.** Don't look up or say which events or flaws this seed has, or an incident's true cause, until
  the player has filed the RCA or asks for the answer. That includes `inspect` output that names an event's effect.
- **Hints in order:** the report to look at → what to look for in it → the answer. One step per ask.
- **Don't change the game they're playing.** Never republish the artifact and don't push model or game changes to
  `dev` during the playtest unless asked. Investigation code goes in the scratchpad.
- **Be careful with dev:** `git fetch` before comparing; use a worktree for the build they play.
- **Realism claims:** check `docs/research.md` first, verify with the `zos-docs` skill when it matters, otherwise
  say "not verified".
- **Short replies while they play.** Model fixes go into PROGRESS.md as items, not code, unless asked.

## Setup

1. Find the build they play: the artifact's build commit (from the user or the artifact's page). Make a worktree at
   it (`git worktree add <dir> <sha>`, symlink `node_modules`) for behaviour checks; run newer tools (`inspect`,
   new play verbs) from the main checkout on `dev`, which read older saves.
2. Saves arrive as zips or pasted text. Unzip each into its own empty scratchpad directory; the play CLI and
   `inspect` read them directly (`decodePlayFile` repairs doubled backslashes and surrounding backticks). If the
   player asks you to fix a save, write the fixed copy to the scratchpad and send it back with SendUserFile.
3. Keep a short note of the run (seed, scenario, difficulty, build, incidents so far) in the scratchpad.

## Toolbox (use these before writing scripts)

```bash
npm run -s play -- <save> status | report WLM_SUMMARY | smf <kind> | policy
npm run -s play -- <save> mon3 [system] --at 'D19 22:10'     # Monitor III history (play-CLI files only; browser saves keep none)
npm run -s play -- <save> wlmlog [system] --grep ONLCARD     # the WLM activity log the player sees
npm run -s play -- <save> finance | capacity | batch         # bill and TFP pace, CPC/LPARs/initiators, last batch night
npm run -s inspect -- <save> dp <system> --class X --from … --to …   # DPs per RMF interval (internals)
npm run -s inspect -- <save> wlm <system> --at … --ticks 12          # WLM decisions (internals; see wlm-why)
```

- **WLM questions** ("why didn't WLM raise / donate / help X"): invoke the `wlm-why` skill and follow it.
- **Events and incidents:** the run's `events` (start/end ticks, `affects`, `endCommands`) and incidents
  (`triggerOf`/`mechanismOf` truth in `src/game/sla.ts`, evidence judging in `src/game/evidence.ts`) explain RCA
  scores. Only read them after the player has filed, per the spoiler rule.
- RMF intervals in a save only reach back a few days; a question about an older moment may have no data. Say so
  instead of guessing.

## Report each finding

What the player saw → what the sim did (numbers, with the interval or tick) → real z/OS (source, page) → verdict:
**bug**, **design gap**, **realism gap** or **player knowledge** (and what to take from it).

## Log findings

When asked (or at the end of a playtest round): add items to PROGRESS.md under the current playtest round, in its
category (Sim and game-logic bugs · Incident truth, RCA and evidence · Clue paths and realism · Events and
operations design · Levers, economy and pacing · UI and reports · Saves, export and tooling), open items first.
Items, not code. Commit on the session branch and open the PR into `dev` per CLAUDE.md, unless the user says to
hold the PR or not to auto-merge it.
