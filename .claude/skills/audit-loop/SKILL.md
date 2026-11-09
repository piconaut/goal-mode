---
name: audit-loop
description: Run a paced loop of GOAL MODE realism audit rounds (Sonnet auditor subagents → vetting by the main agent → Opus fixer subagents → serial PRs into dev → balance sweeps on GitHub Actions via npm run sweep:remote), driven by a scheduled task that stops after the requested number of rounds. Usage - /audit-loop <rounds> <pace>, e.g. /audit-loop 6 2h. Also used on each tick of that scheduled task ("audit-loop tick").
---

# Audit loop

You are the coordinator. You start audits on a schedule, process each audit as soon as it finishes, land fixes one
at a time and get every merged behaviour change swept for balance. Stop after `<rounds>` audits have been launched
and fully processed.

## Who does what

| Step | Done by | Why |
|---|---|---|
| Audit | `goal-mode-realism-auditor` subagent (Sonnet), background | Light CPU (play CLI); report lands here as a notification, files stay in `runs/lab/` |
| Vet findings | You | Judgment: is the doc read right, is it a dup, does the fix keep the game's clue paths and lever costs |
| Develop fix | `realism-fixer` subagent (Opus), background, `isolation: "worktree"` | Model change needs a strong model; worktree lets it run while other audits continue |
| Land fix (PR, CI, merge) | You, on your session branch | One golden-changing PR at a time (PROGRESS "Branch workflow"); PR events must reach this session |
| Balance sweep | `npm run sweep:remote`, one background Bash task per scenario | Runs sharded on GitHub's runners (user request 2026-11-06): no worker session, no local cores used |
| Balance decision | You | CLAUDE.md: balance stays on the main agent |
| Reading long logs | `log-reader` subagent | Keeps this context small |

## Arguments

- `<rounds>`: number of audits to launch (one audit = one auditor run = one round).
- `<pace>`: time between audit launches, whole hours, at least `1h` (scheduled tasks fire at most hourly).

## Start (when invoked by the user)

1. `get_session` with no id: note this session's id and branch.
   Then make the IBM books available to the auditors (subagents can't attach repositories): `add_repo`
   `piconaut/ibm-zos-books`, clone it as that result says (`/home/user/ibm-zos-books`, long timeout),
   `register_repo_root`, and check `python3 <zos-docs skill>/scripts/books.py locate erbb500` prints a path in the
   clone. See "Books".
2. `list_triggers`: if an enabled task named `audit-loop` exists, ask the user whether to replace it.
3. Read PROGRESS.md (every "Audit round" section), BACKLOG.md list `realism-fixes` and `docs/research.md` to build the coverage list:
   scenarios and seeds already audited and behaviours already tested or queued.
4. `create_trigger` firing into this session: name `audit-loop`, `cron_expression` `0 */<H> * * *` (for 1h,
   `0 * * * *`), `initiation: human_request`, prompt:
   `audit-loop tick. Launched 1 of <rounds>. Follow .claude/skills/audit-loop/SKILL.md "Tick".`
   The prompt is the durable counter: the container can be reclaimed between ticks and lose `runs/`.
5. Launch round 1 now (see Audit), and tell the user in three lines: rounds, pace, when the task stops.

## Tick (each scheduled firing)

1. `get_trigger` for the launched count `k`. Rebuild state if this context lost it: open PRs from your session
   branch, fixer branches (`git branch --list 'fix/*'`), local `runs/lab/`, PROGRESS.md.
2. Do pending work first: red or conflicted PR, finished fixer waiting to land, sweep result to judge.
3. If `k < rounds` and fewer than 2 audits are running: check the books clone (see Books), launch the next audit, then `update_trigger` the prompt to
   `Launched k+1 of <rounds>`. If 2 are still running, skip this launch (don't count it) and say so in one line.
4. If `k == rounds`: no launch. When every round is closed (audit vetted, its fixes merged or deferred, its sweep
   judged), run Finish.
5. If nothing changed, end the tick with no message.

## Books

The auditor checks IBM pages with the zos-docs skill, which reads a local clone of `piconaut/ibm-zos-books`. A
subagent cannot `add_repo` or clone it through the git proxy, so the coordinator does it: at Start, and on every tick
before launching an audit (the container may have been reclaimed), run the `books.py locate erbb500` check; if it
fails, redo the Start step. Tell the auditor the clone's path in its prompt.

## Audit

Pick the next untested combination: rotate scenario (midwest → harbourline → revenue), a seed not used before for
that scenario, and focus areas from the auditor's list that the coverage list doesn't cover. Launch:

`Agent(subagent_type: "goal-mode-realism-auditor", run_in_background: true, description: "Audit round K")`,
prompt: scenario, seed, 3–5 focus behaviours, the books clone path (`/home/user/ibm-zos-books`, for zos-docs), the list of findings already queued or fixed (so it doesn't repeat
them), "use the lab harness (`npm run lab`, `tools/lab.ts`) for A/B runs; put specs in runs/lab/rK/", and
"write runs/lab/<date>-audit-rK.md". Fixer briefs name the audit's spec files so the fixer reruns the same A/B.

## Vet (as soon as an audit finishes)

For each **Mismatch** in the report:
1. Open the cited code at `file:line` and confirm the mechanism; re-run a key number only if the report is shaky.
2. Spot-check the IBM citation with the zos-docs skill (`anthropic-skills:zos-docs`; if it needs the books repo,
   `add_repo` `piconaut/ibm-zos-books`).
3. Drop duplicates of BACKLOG.md entries / `docs/research.md` rows, and APPROX behaviour the repo already admits.
4. Classify: **fix now** (clear doc, contained change, keeps clues and lever costs), **needs user** (design call,
   balance-shifting, scenario puzzle affected: write the question, don't block the loop), **reject** (why).
Write an "Audit round K" section in PROGRESS.md like the earlier ones (items, citations, audit numbers); it rides the
round's first fix PR, or its own small docs PR if the round has no fixes. Record **needs user** items as BACKLOG.md `realism-fixes` entries with `status: blocked: user`, and hold them for the Finish report; don't message the user about them
mid-loop.

## Fix

For each **fix now** item, start a fixer immediately, at most 2 running at once (4 cores; each runs `npm run check`):
`Agent(subagent_type: "realism-fixer", isolation: "worktree", run_in_background: true)`, brief: the finding with its
numbers and citation, the chosen fix, the realism test to add, branch `fix/rK-<slug>`.
Review its diff before landing. If it stopped for a design call, decide or move it to **needs user**.
A **needs user** item with fixer work (finished or WIP) goes up as a PR that is pushed but never merged: push its
`fix/rK-<slug>` branch, open a **draft** PR into `dev` titled `[needs user] …`, no auto-merge, not counted against
the one-golden-PR-at-a-time rule. The body follows the PR template and holds everything needed to decide without this
session: the finding with audit numbers and citations, what the branch does and doesn't do, before → after numbers,
state (check/goldens run or not), side effects, and the numbered design questions with options and a recommendation.
Link it from the BACKLOG.md entry and from the Finish report. Don't subscribe to it.

## Land (one at a time)

1. `git fetch origin dev && git checkout -B <session branch> origin/dev`, `git cherry-pick <fixer SHA>`.
   On a `tests/golden/hashes.json` conflict take either side, then `UPDATE_GOLDEN=1 npx vitest run tests/golden`.
2. Add the PROGRESS.md lines (decision row with before → after numbers) and delete the item's BACKLOG.md entry if it has one. `npm run check` (pass/fail
   line only; failures to `log-reader`).
3. Push, open the PR into `dev` per `.github/pull_request_template.md` (Behaviour change filled when goldens
   change), `subscribe_pr_activity`, keep CI green. If goldens changed, open it as a **draft** and go to Balance; it
   stays a draft until the sweeps are judged and any follow-up fixes are pushed to it. If goldens didn't change (no
   sweep needed), open it ready for review.
4. After Balance passes: push the sweep numbers into the PR's PROGRESS.md decision row, mark it ready for review
   (`update_pull_request` `draft: false`), and keep CI green until the review loop merges it. Don't merge it or
   enable auto-merge yourself.
5. The next fix waits until this one merges. Fixers already done wait as local branches.

## Balance

Sweep each golden-changing fix PR before it merges (CI only sweeps Midwest seeds 1–5), on its pushed head SHA. To
save cost, batch: if another fix of the same round is ready, cherry-pick it onto the same PR first and sweep once.
For each scenario, start a remote sweep on that SHA as its own background Bash task (`run_in_background`; they run
in parallel on GitHub's runners):

```
npm run sweep:remote -- --ref <SHA> --bots donothing,textbook,expert --seeds 1-10 --scenario <scenario> --name <scenario>-rK
```

It prints the summary and the balance gate report when done (`runs/remote/<sha7>/` keeps the CSV; read it for the
expert seeds that did not end in victory). A non-zero exit with no summary is an infrastructure failure: rerun once.

When a sweep finishes, compare with the last recorded sweep for that scenario in PROGRESS.md. Gate red or expert down by ≥ 2 victories: diagnose (bot gap like #107, or the fix itself), push the cure
to the same draft PR and re-sweep the affected scenarios on the new head. When every scenario's sweep is judged
fine, finish Land step 4 (ready for review).

## Finish

`delete_trigger` the `audit-loop` task, make sure PROGRESS.md records every round,
and send the user one summary: per round, scenario/seed, findings (fixed / needs user / rejected) with PR numbers,
sweep results, then every needs-user question from all rounds, each with enough context to answer on its own.

## Rules

- Process events as they arrive (audit done → vet → fix; fixer done → land; sweep finished → judge). Never wait for
  all audits before starting the next step.
- The user stops the loop by saying so: `delete_trigger`, stop background agents and sweeps, report.
- Until Finish, be as terse as possible: at most one short line per event (PR landed, round vetted), no questions.
  All questions wait for the Finish report, which is the only full write-up.
