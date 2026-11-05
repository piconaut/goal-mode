---
name: pr-review-loop
description: One tick of the hourly GOAL MODE PR review (user request 2026-11-04) - review every open PR into dev with the pr-reviewer subagent, hold PRs with any finding, re-check held PRs after updates and merge when the earlier findings are fixed, and log second-pass leftovers in PROGRESS.md. State lives in hidden markers in the review comments, so each tick can run in a fresh session. Usage - /pr-review-loop (fired hourly by a scheduled task).
---

# PR review loop (one tick)

You run one pass over the open pull requests into `dev` in `piconaut/goal-mode`, then stop. Each tick may start in a
fresh session, so everything you need to know about earlier ticks is on GitHub, in the review comments. Never
rely on memory of an earlier tick.

Only PRs with base `dev`. The `dev` → `main` milestone PR is the user's; leave it alone.

Skip draft PRs (user request 2026-11-04): don't review, merge or comment on a PR while `draft` is true. It joins the
next tick after it is marked ready for review, as **new** or per its latest marker. List them in the report as
`draft - skipped`.

Models (user request 2026-11-04): the scheduled task runs this coordinating session on Sonnet; the review itself
stays on Opus through the `pr-reviewer` agent's `model: opus`. Don't pass a `model` override when spawning it, and
don't review diffs yourself: your job is bookkeeping, merging and the PROGRESS.md docs PR.

## 1. Gather state

For each open, non-draft PR into `dev` (`mcp__github__list_pull_requests`, base `dev`, state open; drop `draft: true`):

- head SHA, `mergeable_state`, title, body;
- the PR's issue comments (`mcp__github__pull_request_read` method `get_comments`, all pages). Find the **latest
  review comment**: the newest comment starting with "Automated pr-reviewer report".
- From that comment, read the **marker** (an HTML comment at its end):

  ```
  <!-- pr-review-loop
  head: <sha reviewed>
  pass: first | followup
  outcome: MERGE | HOLD
  blocking:
  - B1: <one line>
  nonblocking:
  - N1: <one line>
  -->
  ```

  Reviews posted before this skill existed have no marker. Then use the comment's "Problems" lines as blocking
  findings and its "Notes" lines as non-blocking findings, and treat it as a first-pass review of the head SHA
  it names (the "bench (head / base)" line or the reviewer's stated head). A later comment carrying
  `<!-- pr-review-loop-note -->` (a policy note from this loop) may add items to fix; include them.

Classify each PR:

| Case | Condition | Action |
|---|---|---|
| **new** | no review comment | first-pass review |
| **follow-up** | latest marker outcome HOLD, and the head SHA differs from the marker's `head`, or a comment from the author (not a review report, not a loop note) is newer than the review | follow-up review |
| **unchanged** | held, same head, no newer author comment | skip |
| **approved, not merged** | latest marker outcome MERGE at the current head, PR still open | merge now (step 3); no new review |
| **stale approval** | outcome MERGE but the head moved | follow-up review against that marker's lists |

Overlap guard: if the latest review comment is for the current head and is less than 60 minutes old and has no
marker yet, another tick is probably mid-review; skip the PR this tick.

## 2. Review

For each PR to review, spawn the `pr-reviewer` subagent (in the background; several PRs may run in parallel, but
spawn them all in one message and wait for every hand-back before deciding). Brief:

- PR number, title, head branch and SHA, base `dev`, and a scratchpad directory.
- "Check z/OS behaviour claims against IBM docs with the zos-docs skill (Skill tool; cite pages); a z/OS behaviour
  or report change with no checked citation is a blocking finding; say n/a when there are none."
- "Review-loop mode: classify every finding as blocking or non-blocking, give them IDs, and end the posted comment
  with the review-loop marker (see your agent file)." A merge conflict with `dev` is a blocking finding.
- **First pass:** `pass: first`.
- **Follow-up:** `pass: followup`, plus the previous blocking and non-blocking lists verbatim. "For each previous
  item, say fixed / not fixed with evidence. List NEW findings separately with new IDs (continue the numbering)."

## 3. Decide

Outcome rules (the user's policy, 2026-11-04):

- **First pass:** MERGE only if there are no blocking and no non-blocking findings. Otherwise HOLD.
- **Follow-up:** MERGE if every previous blocking and non-blocking item is fixed and there is no new blocking
  finding. New non-blocking findings do not block on this pass. Otherwise HOLD.
- Required checks (`check`, `balance`, `behaviour-note`, `perf-hash`) on a MERGE outcome:
  - all green: squash-merge with `expectedHeadSha` set to the reviewed head;
  - some still pending: enable auto-merge (squash);
  - any red: that is a blocking finding, so the outcome becomes HOLD.

The reviewer's own MERGE / DON'T MERGE verdict feeds in as findings; you apply the rules above. Check that the
marker's `outcome` matches your decision. If it doesn't, post a short note on the PR with the corrected outcome,
starting with `<!-- pr-review-loop-note -->` and ending with the footer below.

GitHub sometimes answers a merge with 502 or "Merge already in progress" while the merge goes through. Re-read the
PR (or `git fetch origin dev` and look for `(#<n>)`) before retrying; `enable_pr_auto_merge` answering "already
merged" also settles it.

Never merge a PR whose head moved after the review (the `expectedHeadSha` guard enforces this). Never approve,
push to, or close someone else's PR.

## 4. Log second-pass leftovers

After merging a PR on a follow-up pass with NEW non-blocking findings, add them to the "PR review follow-ups"
section of PROGRESS.md: one unticked line each, tagged with the PR number, with file paths. Skip any item already
listed. Collect all of this tick's items into one docs-only PR:

- branch: this session's designated branch if it has one, else `review-loop/followups-<YYYYMMDD-HHMM>`, cut from
  the latest `origin/dev`;
- PR into `dev` following `.github/pull_request_template.md` ("## Behaviour change" → "None."), auto-merge (squash);
- don't wait for it: the next tick reviews it like any other PR. It is a docs-only PR, so a clean review merges it.

Also tick any follow-up item in that section that a PR merged this tick fixed, when the reviewer says so.

## 5. Report

End with a terse summary, one line per open PR: `#<n> <new|follow-up|unchanged|approved> - <findings: B open/fixed,
N open/fixed> - <merged | auto-merge on | held | skipped>`, plus the docs PR link if you opened one. If nothing
was open, say so in one line. Don't re-explain the policy.

## Comment footer

Every comment this loop posts ends with:

```

---
_Generated by [Claude Code](https://claude.ai/code)_
```
