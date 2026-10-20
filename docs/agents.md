# Game-playing agents

GOAL MODE can be played headlessly by AI agents through a small CLI, `tools/play.ts`. The same CLI works for
humans who want to script a run.

## The play CLI

```
npm run -s play -- runs/a.json new 42 normal      # new run: seed, difficulty (story|normal|hard|ironman)
npm run -s play -- runs/a.json status             # phase, clock, trust, budgets, PI > 1, SLAs, inbox, incidents, draft
npm run -s play -- runs/a.json catalog            # hardware, fixes, analytics tools, RCA vocabulary
npm run -s play -- runs/a.json start              # start the day (BRIEFING → LIVE)
npm run -s play -- runs/a.json advance 2          # advance the live day 1–24 sim hours
npm run -s play -- runs/a.json report WLM_SUMMARY [index] [scKey] [system]   # also WLM_DETAIL, PARTITION, CF, DASD
npm run -s play -- runs/a.json smf DB2|CICS|BATCH|SMF113 [hour]
npm run -s play -- runs/a.json mon3               # Monitor III (needs the RMF_MON3 tool)
npm run -s play -- runs/a.json rca 3 CPU_PRIORITY POLICY
npm run -s play -- runs/a.json buy RMF_MON3
npm run -s play -- runs/a.json draft <id|none>    # closes the end-of-day review
npm run -s play -- runs/a.json json '{"cmd":"change","req":{"label":"+1 CP","hardwareId":"PERM_CP"}}'
npm run -s play -- runs/a.json json '{"cmd":"wlm","edit":{...}}'   # then: activate (or discard)
```

Each call loads the run file, applies one command and saves it. Refused commands print `REFUSED: …`, exit
with code 2 and change nothing. Shapes: `PlayCommand` in `tools/playCore.ts`, Change Desk commands in
`src/sim/core/commands.ts`, WLM edits in `src/game/wlmEdit.ts`.

The run file holds the same serialised `RunState` the browser saves, the pending WLM policy and the command
log. Seed + command log replays the run exactly (the sim is deterministic), and the file round-trips through
JSON bit-identically (tested in `tests/tools/play.test.ts`). A full simulated day takes about 10 s.

## What an agent can see

Only what a player sees in the browser: the briefing and inbox, the status line, RMF reports, SMF and Monitor
III views once the matching tool is owned, the catalog and the Codex. The CLI never prints incident ground
truth, and the agent definitions forbid reading scenario and event files under `src/`.

## The agents

Definitions live in `.claude/agents/`:

| Agent | Style |
|---|---|
| `goal-mode-player` | balanced analyst: diagnose, fix the planted flaws, buy tools, keep SLAs and cost in line |
| `goal-mode-cautious-operator` | minimal, reversible changes; no emergency changes; keeps hours spare |
| `goal-mode-cost-cutter` | keeps MLC under budget; capping and WLM tuning before capacity |

Launch one from Claude Code, for example: *"Use the goal-mode-player agent to play runs/p42.json, seed 42,
normal, up to day 5."* Each keeps a log next to the run file (`runs/p42.json.log.md`), one line per command plus
a paragraph per day. `runs/` is git-ignored.

## Scores and comparison with the bots

`status` shows trust per stakeholder, the score and the last report card; the run ends in VICTORY or
GAMEOVER with a reason. Compare with the strategy bots on the same seed and difficulty:

```
npm run bot -- --bot textbook --seed 42
npm run sweep -- --bots donothing,textbook,expert --seeds 1-20
```

Bots take the first draft option and play by script; their results per seed are the baseline an agent should
beat (PROGRESS.md "Balance" records current numbers).
