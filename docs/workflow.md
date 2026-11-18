# Workflow: branches, PRs, CI and definition of done

This is the single source for GOAL MODE's contribution workflow. `CLAUDE.md` and `AGENTS.md` keep short summaries and
host-specific notes; `PROGRESS.md` tracks milestones, decisions and open questions, not workflow rules. The skills and
agent briefs keep their own operational steps and link here for the shared rules.

## Branch workflow

- One task branch per change, cut from `dev`. Never push directly to, or merge into, `dev` or `main` (user request
  2026-10-23): “merge into dev” means open a PR into `dev` and let the review loop merge it. Direct pushes or merges to
  either protected branch need the user's explicit wording that they want to bypass the PR workflow.
- Work milestone by milestone from `BACKLOG.md`, keeping the sim runnable headless at every step. Small, focused
  commits; don't mix model changes with UI changes. After a PR merges, further work starts again from the latest
  `dev`, on a new branch and PR.
- The author opens the PR and does not merge it or enable auto-merge (user request 2026-11-09). The review loop
  (`pr-fix-loop`) reviews and merges ordinary PRs into `dev`; it may push small review fixes by plain fast-forward,
  never rebase or force-push. Auto-merge is enabled only when the user explicitly authorizes it.
- Loops: each tick of a scheduled task runs one skill, with its state in PR comment markers. `pr-fix-loop` is the
  review loop; `dev-loop` is the author loop (it implements one ready `BACKLOG.md` entry, answers a HOLD, or skips,
  and disables its schedule when the lists have no eligible entry). Their skills are the operational source for tick
  behaviour.
- Keep model design, balance decisions and cross-layer work with the main agent; review every subagent diff before
  committing. Vetted realism fixes may go to the `realism-fixer` subagent; balance calls stay with the main agent.
- Keep PR-specific audit findings, review reports and validation evidence in the PR description or comments. Do not
  commit per-PR documents to the repository (e.g. `docs/reviews/pr-<number>.md`); reusable facts belong in
  `PROGRESS.md`, `SPEC.md`, `docs/research.md` or a `BACKLOG.md` entry.

## Pull requests

- Open a PR for every task without waiting to be asked, into `dev` (never `main`), with the body following
  `.github/pull_request_template.md`. Fill in “Behaviour change” whenever goldens change; label pure optimisations
  `perf`; open the PR as a draft when it is not ready for review.
- Subscribe to the PR's activity and keep CI green: fix red checks and review findings, then push again. Don't push
  to or merge anyone else's PR; report that to the user. The `pr-fix-loop` exception is above.
- Open a `dev` → `main` PR only at sensible milestones (user request 2026-10-21): a PROGRESS item or milestone ticked
  done, not docs-only or in-progress work. Before opening: `npm run check` green, bench hash recorded, `PROGRESS.md`
  updated. The body says what changed since the last merge to `main`, gives test count, hashes and sweep results,
  anything waiting on the user, and a “## Behaviour change” section listing golden changes for CI's gate. At most one
  `dev` → `main` PR is open; later pushes to `dev` update it rather than starting a new PR. Each gets a `pr-reviewer`
  review (base `main`, head `dev`), posted on the PR as a reference comment. Merge with a **merge commit**, not a
  squash, when the verdict is MERGE and all required checks are green; no human approval is needed (user decision
  2026-10-26), but NEEDS USER verdicts go to the user.
- GitHub settings (user): default branch `dev`; protect `dev` and `main` with the four checks below required; allow
  auto-merge; delete head branches on merge. `main` requires the same checks but no approval, because GitHub records
  the agent's PRs as authored by the user, who cannot approve their own PR (user decision 2026-10-26).

## CI gates

- `check`: typecheck + all tests, goldens included.
- `behaviour-note`: a PR that changes `tests/golden/hashes.json` must have a filled-in “## Behaviour change” section.
- `perf-hash`: a PR labelled `perf` or titled “perf…” must keep the Midwest and Harbourline 1-day bench hashes of its
  base. `balance`: when goldens change, donothing/textbook/expert over seeds 1–5 must stay inside the loose bands in
  `tools/ci/balanceGate.ts`. Run one golden-changing PR at a time.
- After a rebase that conflicts on `hashes.json`, regenerate it with `UPDATE_GOLDEN=1 npx vitest run tests/golden`;
  never merge that file by hand.

## Reviews and attribution

- Every review report posted on a PR (any agent or vendor, any tool) starts with a header line naming its role. The
  loops find their own reports by the exact `pr-reviewer` and `pr-fixer` strings kept word for word in
  `.claude/agents/pr-reviewer.md` and `.claude/agents/pr-fixer.md`; every other reviewer uses another role name.
  Comments are posted under the user's account, so a comment without such a header reads as the user's own decision.
- Reviewers read CI's results instead of rerunning `npm run check`; when a rerun is needed, use `npm run test:remote`
  rather than the full suite locally.
- Every agent-written commit, review report and PR comment ends with a line naming the agent and the model it is
  itself running as (`Co-Authored-By: <Agent> <Model> <vendor address>`), read from its own system prompt or
  environment. In a review or comment it goes last, after the report. Never copy a trailer from a coordinator or
  another agent; omit the model rather than guess it. Host-specific trailer forms are in `CLAUDE.md` and `AGENTS.md`.

## Definition of done

- `npm run check` green (typecheck + tests); `PROGRESS.md` updated at the end of a development session. When a full
  suite is needed, run it on GitHub Actions with `npm run test:remote` on the committed HEAD; a busy host makes the
  local full suite hit timeouts. Reviewers read CI instead of rerunning the suite.
- Bench hashes recorded before and after (`npm run bench -- --hash` and `-- --hash --scenario harbourline`); when
  goldens change, say why in “Behaviour change” and run `npm run sweep:remote -- --bots donothing,textbook,expert
  --seeds 1-10`, recording the summary.
- Claiming no behaviour change: paste the `npm run compare -- --base origin/dev` summary. UI touched: `npx vite build`
  succeeds. Regenerated goldens use `UPDATE_GOLDEN=1`, never a hand edit.
- Long runs (sweeps, bot batches, remote suites) use background/tracked command sessions in a call of their own, not
  `nohup … &` chained inside another command, so they notify on exit and need no polling.
