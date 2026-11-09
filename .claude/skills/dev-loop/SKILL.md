---
name: dev-loop
description: One tick of the GOAL MODE development loop (user request 2026-11-09), the author-side counterpart of pr-fix-loop / pr-review-loop - with no dev-loop PR waiting, implement the next ready entry from the named BACKLOG.md list(s) and open a PR; when the review loop has held that PR, address its findings; otherwise skip the tick. Stops the scheduled task when the lists are finished, and does nothing when the lists are missing or not BACKLOG.md lists. Usage - /dev-loop <list>[,<list>…], e.g. /dev-loop playtest-fixes (fired by a scheduled task).
---

# Dev loop (one tick)

You do at most one unit of author work in `piconaut/goal-mode`, then stop. Each tick may start in a fresh session:
everything about earlier ticks is in GitHub (PRs labelled `dev-loop`, their remote branches and comments). Never rely
on memory of an earlier tick.

You are the author. The review loop (`pr-fix-loop`, or `pr-review-loop` if the scheduled task runs that instead)
reviews and merges. The two take turns through the review loop's markers, so only one of you ever pushes to a PR
branch at a time (step 2).

Overrides of CLAUDE.md's standing PR request, for this loop only: **never merge, never enable auto-merge, and don't
subscribe to PR activity**; the review loop merges, and the next tick is your follow-up. This skill authorises you
to push to `dev-loop/*` branches, whatever branch the session was started with.

## 0. Check the arguments (do nothing unless they're valid)

The argument is one or more list names, comma-separated. Read the list table at the top of `BACKLOG.md` on fetched
`origin/dev`.

- No argument, or any name that isn't a list in that table (e.g. "PROGRESS.md", "everything", "all", an entry ID, a
  milestone): reply with one line saying which names are invalid and listing the valid lists, and stop. Don't pick
  anything, don't touch PRs, don't disable the scheduled task.
- Valid lists: go on. Work only from those lists, even if other lists have ready entries.

## 1. Gather state

- `git fetch origin dev`, then read `BACKLOG.md` "Rules" and the named lists from `origin/dev`.
- Open PRs labelled `dev-loop` (`mcp__github__list_pull_requests`, base `dev`; filter by label): number, head branch
  and SHA, labels, body, issue comments (all pages).
- Remote branches `dev-loop/*` with no PR (`git ls-remote origin 'refs/heads/dev-loop/*'`) and their commit time.
- Closed, unmerged `dev-loop` PRs from the last 30 days: the entry IDs on their `Backlog:` lines (rejected picks).
- Every open PR's `Backlog:` line (any author): those entries are claimed.

Overlap guard: a `dev-loop/*` branch with no PR whose head commit is under 3 hours old means another tick is
mid-implementation. Report `another tick running` and stop. An older orphan branch is abandoned: delete it and go on.

## 2. Classify the open dev-loop PR

PRs labelled `needs-user` wait for the user: report them and don't count them below. At most one other `dev-loop`
PR is open at a time. For it, find the **latest review marker**: the newest comment containing `<!-- pr-fix-loop`
or `<!-- pr-review-loop`, and any later `<!-- pr-fix-loop-check` or `<!-- pr-fix-loop-note` comments. Find your
**latest response**: the newest comment containing `<!-- dev-loop-response`.

| Case | Condition | Action |
|---|---|---|
| **awaiting review** | no review marker | skip the tick |
| **reviewer's turn** | marker `outcome: MERGE` or `FIXED`, a fix-check pending or failed, or a `pr-fix-loop-note` newer than the marker | skip (the review loop fixes, re-checks or merges) |
| **held** | marker `outcome: HOLD`, its `head` is the current head, no response of yours newer than it | address it, or close it on a backlog rule finding (step 3) |
| **responded** | your response is newer than the HOLD, or the head moved past the HOLD's `head` | skip (the review loop re-reviews) |

No open `dev-loop` PR (other than `needs-user` ones): go to step 4.

## 3. Address a hold

1. Read the hold report and its marker: `open:` (pr-fix-loop) or `blocking:` + `nonblocking:` (pr-review-loop),
   and the `Hold reason:` line.
2. **Backlog rule finding**: close the PR with a comment saying why (the entry was blocked, removed or claimed on
   `dev` since you picked it, or you picked wrongly), delete its branch, and stop. The next tick picks again.
3. **A finding that needs the user** (a design or balance call, NEEDS USER, a change to what the entry asks for):
   don't guess. Post a response comment stating the question and options, add the label `needs-user`, and stop.
4. **Third response on this PR** (two `dev-loop-response` comments already): label `needs-user` with a comment
   summarising the open findings, and stop. Two rounds that didn't settle it need a human.
5. Otherwise fix every open finding. Work in a fresh worktree of the **remote** PR branch: the review loop may have
   pushed commits since your last tick.
   - Run `git worktree add -B <branch> <dir> origin/<branch>`.
   - Make one commit per finding, `review response <ID>: <one line>`, plus the commit attribution lines.
   - You may dispute a finding instead of fixing it, with evidence (a doc page, a test, a measurement). Never dispute
     by assertion.
   - Never skip, weaken or delete a test to get green.
6. Verify as in step 5.4 below, then push with a plain fast-forward: `git push origin HEAD:<branch>`. If the push is
   rejected because the branch moved, the review loop got there first: discard your work and stop. Never force.
7. Post a comment, and end it with the footer, then:
   `<!-- dev-loop-response head: <pushed SHA> addressed: B1,N2 disputed: N3 -->`.
   The comment gives one line per finding: what changed (commit sha7), or why it is disputed.

## 4. Pick the next entry

Candidates are entries in the named lists with `status: ready` that are:
- not claimed by any open PR;
- not named by a closed, unmerged `dev-loop` PR (the user or reviewer rejected that pick; list them in the report);
- not already fixed on `dev`. Check `git log origin/dev --grep 'Backlog: <ID>'` and the code. If one is fixed but
  still listed, open a small `dev-loop` PR that only deletes the entry (`Backlog: <ID>`), naming the fixing commit.

Order: BACKLOG.md "Pick order" (high/S, high/M, low/S, low/M, then L; ties by ID).

**No candidate left** (every entry in the named lists is done, blocked, claimed or rejected), and no open `dev-loop`
PR other than `needs-user` ones: the lists are finished.
- Report `finished: <lists>`, the blocked entries with their reasons, and any `needs-user` PRs.
- Then stop the scheduled task: `list_triggers`, find the enabled task whose prompt runs `/dev-loop` with these
  lists, and `update_trigger` it with `enabled: false`. Not found: say so.
- Don't start anything else.

## 5. Implement it

1. **Claim it first.** Create `dev-loop/<ID>-<slug>` from `origin/dev` and push it before writing code. This is the
   overlap guard's signal.
2. **Read.** Read the entry, CLAUDE.md, and the SPEC sections and files it names.
   - If it turns out to need a design or user call, or it's much bigger than its size, don't build it. Open a
     `dev-loop` PR that only edits BACKLOG.md: set the entry to `blocked: design` (or `user`) with the question, and
     put `Backlog: <ID> (blocked)` in the body. Then stop.
3. **Build it** as CLAUDE.md says, as if it were your own task:
   - realism policy with zos-docs citations;
   - units, layering and determinism;
   - tests for new pure functions;
   - Codex entries for new concepts.
   You may hand well-scoped content, test or small UI parts to the `implementer` subagent (review its diff). Keep
   `sim` work, balance calls and cross-layer work yourself.
   - In the same PR, delete the entry from BACKLOG.md; a partial fix rewrites it to what remains.
   - Record durable facts in SPEC §17/§18, docs/research.md, or a PROGRESS.md decision.
   - Commit with the attribution lines.
4. **Verify:**
   - `npm run check` must pass.
   - Run `npm run bench -- --hash` and `-- --hash --scenario harbourline`.
   - Goldens changed: say why in the "Behaviour change" section, and run `npm run sweep:remote -- --bots
     donothing,textbook,expert --seeds 1-10` (with `run_in_background`; record the summary).
   - Goldens unchanged but you claim no behaviour change: paste the `npm run compare` summary.
   - UI touched: `npx vite build`.
5. **Open the PR** into `dev`, ready for review (not a draft), labelled `dev-loop`. Title it after the entry, and
   write the body per `.github/pull_request_template.md`, with `Backlog: <ID>` as the first line of Summary. Check the
   entry's "Done when" against what you did. No auto-merge.

## 6. Report

One line: `<case> - <action> - <PR link or "none">`, e.g. `held - addressed B1,N2 (N3 disputed) - #251`,
`picked PT-05 - opened #252`, `awaiting review - skipped - #250`, `finished: playtest-fixes (PT-19…PT-24 blocked)
- task disabled`, `invalid list "PROGRESS.md" - nothing done (valid: playtest-fixes, pr-followups, realism-fixes,
cleanup)`.
