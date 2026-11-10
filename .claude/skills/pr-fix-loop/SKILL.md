---
name: pr-fix-loop
description: One tick of the GOAL MODE review-and-fix loop (user request 2026-11-06) - for every open PR into dev, the Opus pr-fixer reviews it and fixes small mechanical findings itself on the PR branch (or holds the PR for its author), a Sonnet check verifies the fixes, and the PR is squash-merged. State lives in hidden markers in the report comments, so each tick can run in a fresh session. Replaces pr-review-loop when the scheduled task runs this skill. Usage - /pr-fix-loop (fired by a scheduled task).
---

# PR fix loop (one tick)

You run one pass over the open pull requests into `dev` in `piconaut/goal-mode`, then stop. Each tick may start in a
fresh session: everything about earlier ticks is in the PR comments. Never rely on memory of an earlier tick.

Why this exists (user request 2026-11-06): sending findings back to the author (often a Codex agent) and then
reviewing again costs a second full review plus an author round trip. Opus fixes small mechanical findings while it
has the PR loaded, and a cheap Sonnet check of only the fix commits stands in for the second review.

Scope: open, non-draft PRs with base `dev`. Leave alone: the `dev` → `main` milestone PR, drafts (report
`draft - skipped`), and PRs labelled `no-autofix` (report `no-autofix - skipped`; the user or author wants them
reviewed by hand or by `pr-review-loop`). Never push to a PR outside this scope.

PRs labelled `dev-loop` come from the `dev-loop` skill, the author-side loop. Treat them like any other PR: when
you HOLD one, `dev-loop` answers on its next tick by pushing fixes and a `<!-- dev-loop-response` comment, which
is your **held, updated** case (the comment is an author comment, not a loop comment). Skip a `dev-loop` PR labelled
`needs-user` (report `needs-user - skipped`). The backlog rule (pr-reviewer check 10) applies to these PRs.

Models: you (the coordinator) run on Sonnet and do bookkeeping, spawning and merging only; never review or edit
diffs yourself. `pr-fixer` runs on its Opus default. Checks of fixes use `pr-reviewer` with `model: "sonnet"`.

## 1. Gather state

For each PR in scope (`mcp__github__list_pull_requests`, base `dev`, state open): head SHA, head branch,
`mergeable_state`, labels, title, body, and its issue comments (all pages). Find the **latest loop comment**: the
newest comment starting with "Automated pr-fixer report" or "Automated pr-reviewer report", and its marker
(`<!-- pr-fix-loop … -->`, or the older `<!-- pr-review-loop … -->`). Also note any later comment starting with
`<!-- pr-fix-loop-check` (a fix-check result this loop posted, step 3).

Classify:

| Case | Condition | Action |
|---|---|---|
| **new** | no loop comment | `pr-fixer`, pass first, attempt 1 |
| **fixed, unchecked** | latest marker `outcome: FIXED`, its `head` is the current head, no check comment after it | fix-check (step 3) |
| **fix-check failed** | FIXED marker at the current head, newest check comment says FAIL | `pr-fixer`, pass followup, attempt +1, open items = the check's not-fixed items and new findings, plus the marker's `open` list |
| **held, updated** | `outcome: HOLD` (either marker), and the head differs from the marker's `head`, or an author comment (not a loop comment) is newer | `pr-fixer`, pass followup, attempt 1, open items = the marker's lists (an old `pr-review-loop` marker: its `blocking` + `nonblocking`) |
| **held, unchanged** | HOLD, same head, no newer author comment | skip |
| **approved** | `outcome: MERGE` at the current head, or FIXED with a PASS check at the current head | merge (step 4) |
| **moved after approval** | MERGE/FIXED marker but the head moved and no newer loop comment | `pr-fixer`, pass followup, attempt 1, open items = the marker's `open` list (may be empty) |

Overlap guard: a loop comment for the current head under 60 minutes old with no marker means another tick is
mid-run; skip the PR.

## 2. Review and fix

Spawn one `pr-fixer` per PR to review (background; spawn them all in one message, wait for every hand-back). Brief:
PR number, title, head branch and SHA, base `dev`, a scratchpad directory per PR, pass, attempt, open items
verbatim on a follow-up, the `Claude-Session:` line and the footer (not your own `Co-Authored-By` line: the subagent adds its own model's
trailer, see CLAUDE.md), and: "Check z/OS behaviour claims against IBM docs with
the zos-docs skill (Skill tool; cite pages); a z/OS behaviour or report change with no checked citation is a
blocking finding."

Read its marker from the hand-back (or from the posted comment if the hand-back lacks one).

## 3. Check the fixes (outcome FIXED)

In the same tick, as soon as a `pr-fixer` returns FIXED:

- `fixlines` ≤ 150: spawn `pr-reviewer` with `model: "sonnet"` in **fix-check mode**: PR number, head branch,
  base `dev`, reviewed SHA, fix head SHA, and the `fixed` list with each commit from the report's `Fixes:` line. It
  reads the fix commits against the whole PR at the fix head (user request 2026-11-09), because the same agent found,
  triaged and fixed the problems.
- `fixlines` > 150 (the fixes grew past the estimate): spawn `pr-reviewer` with `model: "sonnet"` in **review-loop
  mode**, pass first, on the whole PR at the fix head. Its blocking and non-blocking findings count as new
  findings; it posts its own comment. Treat outcome MERGE as PASS; anything else as FAIL.

Post the result as a PR comment starting with `<!-- pr-fix-loop-check head: <fix head SHA> result: PASS|FAIL -->`,
then "Fix check (Sonnet): PASS|FAIL", the reviewer's lines, and the footer. Non-blocking `Missed:` items don't block
the merge: after merging, add each one to BACKLOG.md list `pr-followups` as an entry, in a small docs PR. Then:

- PASS → merge (step 4).
- FAIL → the PR becomes **fix-check failed**; the next tick sends it back to `pr-fixer` (attempt +1; `pr-fixer`
  holds at attempt 3). Its open items include the check's not-fixed, `New:` and blocking `Missed:` items.

## 4. Merge

Required checks: `check`, `balance`, `behaviour-note`, `perf-hash` on the head being merged.

- All green: squash-merge with `expectedHeadSha` = the approved head.
- Some pending: enable auto-merge (squash). If the head moves before it merges, the next tick sees **moved after
  approval**.
- Any red: don't merge; post a `<!-- pr-fix-loop-note -->` comment naming the red check and the failing line, and
  treat the PR as **held, updated** next tick (`pr-fixer` will reproduce and fix it if it's mechanical).

GitHub sometimes answers a merge with 502 or "Merge already in progress" while the merge goes through. Re-read the
PR before retrying; `enable_pr_auto_merge` answering "already merged" settles it. Never merge a head other than the
one reviewed or checked. Never approve or close a PR.

## 5. Report

End with one line per PR in scope or skipped:
`#<n> <case> - <outcome: MERGE | FIXED <k> | HOLD (<reason>)> - <check PASS/FAIL/n-a> - <merged | auto-merge on | held | skipped>`.
If nothing was open, say so in one line.
