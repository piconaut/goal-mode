# Game-playing agents

GOAL MODE can be played headlessly by AI agents through a small CLI, `tools/play.ts`. The same CLI works for
humans who want to script a run.

## The play CLI

```
npm run -s play -- runs/a.json new 42 normal harbourline  # new run: seed, difficulty (story|normal|hard|ironman), scenario (midwest|revenue|harbourline; default midwest)
npm run -s play -- runs/a.json status             # phase, clock, trust, budgets, PI > 1, SLAs, inbox, incidents, draft
npm run -s play -- runs/a.json catalog            # hardware, fixes, analytics tools, RCA vocabulary
npm run -s play -- runs/a.json start              # start the day (BRIEFING → LIVE)
npm run -s play -- runs/a.json advance 2          # advance the live day 1–24 sim hours (stops early when a job abends; lists new mail)
npm run -s play -- runs/a.json restart SET016     # restart an abended batch job from its checkpoint (only during its batch night)
npm run -s play -- runs/a.json policy [pending]   # the WLM service definition, classification rules, LPAR CP/zIIP counts, CICS regions
npm run -s play -- runs/a.json report WLM_SUMMARY [id] [scKey] [system]   # also WLM_DETAIL, PARTITION, CF, DASD; id from status
npm run -s play -- runs/a.json smf DB2|CICS|BATCH|SMF113 [hour] [--json]   # hour: 12 (newest 12:00), 'D8 12', current
npm run -s play -- runs/a.json mon3 [system] [--json]   # Monitor III tables incl. PROCU jobs (needs the RMF_MON3 tool)
npm run -s play -- runs/a.json mon3 PRDA --at D1 09:40   # a past range from the history (the values a pin reads; kept 48 h in runs/a.mon3.json)
npm run -s play -- runs/a.json wlmlog PROD1 --grep RCVR   # the Monitor's WLM activity log (last 60 lines; live only with RMF_MON3): receivers, donors, DP moves, and for "no action with net value" the first move it tried and why it was rejected
npm run -s play -- runs/a.json finance    # Finance tab: bill so far; under TFP, MSU-hours vs the prorated baseline, projection and overage $ per MSU-hour by LPAR
npm run -s play -- runs/a.json capacity   # CPC engines and MSU, LPAR logical CPs/weights/defined capacity, job class initiators, capacity changes by day
npm run -s play -- runs/a.json batch      # last batch night by stream (needs SMF30_BATCH, like smf BATCH): LPARs, start/end, queueing, stretch
npm run -s play -- runs/a.json rca INC3 CPU_PRIORITY POLICY [--evidence PIN1,PIN4]   (ids: INC incident, PIN pin, CHG planned change; bare numbers work too)
npm run -s play -- runs/a.json pin WLMGL 312 '*PLEX' ONLHI#1 DELAY_CPU   # interval id; also MON3, CPC, DB2, CICS (see catalog)
npm run -s play -- runs/a.json pin MON3 PRDA MKTORD DELAY_CPU --at D1 09:40   # MON3 and CPC pins from a past Monitor III range
npm run -s play -- runs/a.json pin MON3 PROD1 ONLHI#1 VELOCITY CICSAOR1   # a SYSWKM server's velocity (current range only)
npm run -s play -- runs/a.json ask CALENDAR       # ask around; APP_ENTRY/GROWTH take a workload id
npm run -s play -- runs/a.json project SQL_TUNING 4   # spend engineer-hours on a multi-day project
npm run -s play -- runs/a.json buy RMF_MON3
npm run -s play -- runs/a.json draft <id|none>    # closes the end-of-day review
npm run -s play -- runs/a.json json '{"cmd":"change","req":{"label":"+1 CP","hardwareId":"PERM_CP"}}'
npm run -s play -- runs/a.json json '{"cmd":"wlm","edit":{...}}'   # then: activate (or discard)
```

Each call loads the run file, applies one command and saves it. Refused commands print `REFUSED: …`, exit
with code 2 and change nothing.

Times read `D1 Tue 00:30`: the played day runs 06:00 to 06:00, so the small hours after day 1's evening are still
D1, on the next calendar weekday. RMF intervals have stable ids (the interval's end in 5-minute slots since the
run began); `status` lists the latest ones, and `report`, `pin WLMGL` and incident lines all use these ids. A
bare service class name (`ONLHI`) means its first period (`ONLHI#1`). `rca` replies with which half was right,
the true mechanism/trigger and the trust effect (a wrong RCA costs trust; skipping one earns no points and costs no trust). Shapes: `PlayCommand` in `tools/playCore.ts`, Change Desk commands in
`src/sim/core/commands.ts`, WLM edits in `src/game/wlmEdit.ts`.

### Command shapes (quick reference)

Change Desk (`json '{"cmd":"change","req":{"label":"…","commands":[…]}}'`), most used `Command` kinds:

```
{"kind":"SET_WEIGHT","lparId":"PROD1","pool":"CP","weight":600}
{"kind":"SET_LOGICAL","lparId":"PROD1","pool":"CP","logical":6}
{"kind":"SET_DEFINED_CAPACITY","lparId":"PROD1","msu":null}          # null removes the cap
{"kind":"SET_JOB_CLASS","jobClass":"B","initiators":{"SYSA":4}}
{"kind":"SET_DB2","ssid":"DBP1","maxDbat":400}
{"kind":"SET_CICS","name":"CICSAOR1","maxTasks":250}
{"kind":"MOVE_STRUCTURE","name":"DB2_LOCK1","cfLparId":"CF01"}
{"kind":"SET_RMF_INTERVAL","minutes":15}
```

A change may carry only the change-desk kinds above and their siblings (those with an engineer-hours cost); other
`Command` kinds, a `fixId`/`hardwareId` combined with commands, and event-only fields are refused at no cost.

WLM edits (`json '{"cmd":"wlm","edit":{…}}'`, accumulate on a pending policy until `activate`). Goals are
`{"kind":"AVG","rtSec":0.5}`, `{"kind":"PCT","rtSec":0.5,"pct":90}`, `{"kind":"VEL","velocity":40}` or
`{"kind":"DISC"}`; importance 1–5; `period` is 0-based (0 = the first period, RMF row `ONLHI#1`); qualifiers TN UI TC PK CI SY; subsystems STC JES CICS DDF TSO MQ OMVS.

```
{"op":"SET_PERIOD","classId":"ONLHI","period":0,"goal":{"kind":"PCT","rtSec":0.3,"pct":90},"importance":1}
{"op":"ADD_CLASS","classId":"MOBILE","description":"Mobile API","goal":{"kind":"AVG","rtSec":0.4},"importance":2,"cpuCritical":false}
{"op":"ADD_RULE","subsystem":"DDF","qualifier":"UI","pattern":"MOB*","serviceClass":"MOBILE","reportClass":"RMOBILE"}
{"op":"SET_RULE_TARGET","subsystem":"DDF","path":[0],"serviceClass":null,"reportClass":"RMOBILE"}
{"op":"SET_RESOURCE_GROUP","classId":"BATLO","group":{"id":"RGBAT","type":2,"min":null,"max":30}}
```

Names here are illustrative; take the real LPAR, class, subsystem and structure names from `status` and the
reports. The full unions are in `src/sim/core/commands.ts` and `src/game/wlmEdit.ts`.

The run file holds the same serialised `RunState` the browser saves, the pending WLM policy and the command
log. Seed + command log replays the run exactly (the sim is deterministic), and the file round-trips through
JSON bit-identically (tested in `tests/tools/play.test.ts`). A full simulated day takes about 6 s on the cloud host (new, start, advance 24; 2026-11-06).

## Watching an agent play (spectator mode)

```
npm run dev                                   # or build, then serve with the Vite preview server
open http://localhost:5173/?spectate=a        # watches runs/a.json
```

The page polls `runs/<name>.json` every 1.5 s through a dev/preview-server route (`/__spectate/<name>`) and shows it
in the normal UI, read-only: speed buttons and actions are ignored, and nothing is saved over your own
browser save. A banner shows the agent's latest command and its latest `note "…"` (agents should note their
reasoning before acting). `advance N --pace 2s` steps one hour at a time so a viewer can follow along. The strategy bots can be watched the
same way: `npm run bot -- --bot expert --seed 42 --spectate runs/bot.json --pace 2`, then open `?spectate=bot`. Charts start when you open the page and grow with each
new state the CLI writes.

The banner's **Take over this run** button stops watching and keeps the run as the browser's own save
(replacing any saved run), so a human can carry on from where the agent stopped.

The other way round: the top bar's **⇩ export** button downloads the browser's run as a run file
(`goal-mode-<scenario>-<seed>-day<N>.json`) that `npm run play -- <file> status` (and every other verb) reads, so a
human playtest can be inspected or continued headlessly; **⇧ import** loads such a file back as the browser's run.
Both also read a save whose backslashes were all doubled on its way to disk (seen on a browser export) and text pasted
with its surrounding backticks.

`npm run inspect -- <file> dp <system>` prints sim internals the game never shows (dispatching priorities per RMF
interval) for developers checking a bug. `npm run inspect -- <file> wlm <system> --at 'D19 22:00' [--ticks 6]
[--class ONL]` explains WLM's decisions there: per policy adjustment, the receiver candidates in assessment order
(importance, sysplex and local PI, DP, bottleneck), each trial move and its verdict (`ACCEPTED`, `CPU_CRITICAL`,
`NO_RECEIVER_GAIN`, `SMALL_GAIN`, `MORE_IMPORTANT_HARMED`, `EQUAL_DISPARITY`, `NO_NET_VALUE`) with the projected PIs
behind it, and candidates skipped as not CPU/zIIP-fixable or over the two-receivers-per-importance projection budget.
`npm run inspect -- <file> wlm-stats [system] [--from 'D1 06:00'] [--to 'D3 06:00'] [--ladder '12:00']` adds the same
counters over a range (adjustments, candidates by outcome, trials by verdict, accepted and reversed moves, periods
assessed on 30 adjustments without a receiver move, and the DP ladder at a clock time each day); it needs a play-CLI
file, replays a logged `advance` only as far as the CLI ran it (an ABEND stops it), and costs about 6 s per played day.
A play-CLI file replays from its seed and log to any past time; a browser save has no log, so `wlm` is traced forward
from the saved moment and `wlm-stats` refuses it. Player agents must not use any of these verbs: none is something a
player can see.

## What an agent can see

Only what a player sees in the browser: the briefing and inbox, the status line, RMF reports, SMF and Monitor
III views once the matching tool is owned, the catalog and the Codex. The CLI never prints incident ground
truth, and the agent definitions forbid reading scenario and event files under `src/`. The exception is `goal-mode-realism-auditor`,
which audits the model rather than playing and is meant to read the code behind what it observes.

## The agents

Definitions live in `.claude/agents/`:

| Agent | Style |
|---|---|
| `goal-mode-player` | balanced analyst: diagnose, fix the planted flaws, buy tools, keep SLAs and cost in line |
| `goal-mode-cautious-operator` | minimal, reversible changes; no emergency changes; keeps hours spare |
| `goal-mode-cost-cutter` | keeps MLC under budget; capping and WLM tuning before capacity |
| `goal-mode-firefighter` | emergency WLM edits (CPU Critical, importance, policy switch) and CoD during incidents; watches `wlmlog` for WLM going quiet |
| `goal-mode-realism-auditor` | not a player: makes drastic changes in same-seed A/B runs, checks the results against IBM docs (zos-docs skill) and reports matches and mismatches; may read `src/` and writes only under `runs/lab/` |

Launch one from Claude Code, for example: *"Use the goal-mode-player agent to play runs/p42.json, seed 42,
normal, up to day 5."* Each keeps a log next to the run file (`runs/p42.json.log.md`), one line per command, an incident block per
incident (the human playtest checklist), and a paragraph per day with pacing notes; it snapshots the run file at
the first sign of an incident (`runs/p42.D19-2200.json`) so the state can be replayed. `runs/` is git-ignored.

## Scores and comparison with the bots

`status` shows trust per stakeholder, the score and the last report card; the run ends in VICTORY or
GAMEOVER with a reason. Compare with the strategy bots on the same seed and difficulty:

```
npm run bot -- --bot textbook --seed 42
npm run sweep -- --bots donothing,textbook,expert --seeds 1-20
```

Bots take the first draft option and play by script; their results per seed are the baseline an agent should
beat (PROGRESS.md M8.2 records current numbers).
