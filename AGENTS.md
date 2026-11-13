# Codex project instructions

Read and follow [CLAUDE.md](CLAUDE.md) for the shared architecture, conventions,
validation and branch/PR workflow. Read the relevant SPEC.md sections before
implementing and update PROGRESS.md at the end of a development session.

## Native Codex roles

Project roles are registered in `.codex/config.toml`. Each role loads its matching
`.claude/agents/<role>.md` brief; those briefs remain the source of truth for task
scope and reporting. The Codex role instructions adapt host-specific details.

- `implementer`: precise content/data, existing-function tests and small UI tasks.
- `log-reader`: concise analysis of long logs and failures; read-only.
- `pr-reviewer`: independent review in disposable worktrees; the main agent merges.
- `pr-fixer` (`pr-fix-loop` skill): reviews one PR and may fast-forward small mechanical fixes, but never merges.
  When it has pushed fixes to your PR branch, pull before pushing again, and don't redo fixes listed in its
  "Automated pr-fixer report" comment; fix only items it left open.
- `realism-fixer`: one vetted realism fix in a separate worktree.
- `goal-mode-realism-auditor`: controlled experiments and documented findings;
  writes only under `runs/lab/`.
- `goal-mode-player`, `goal-mode-cost-cutter`, `goal-mode-cautious-operator`, `goal-mode-firefighter`:
  headless play with the brief's information restrictions and strategy.

## Branch workflow

For any repository change, create a task branch from `dev` and open a pull request targeting `dev`. Do not push
directly to `dev` or `main`, and do not interpret "merge into dev" as permission to do so: it means create the PR
into `dev`. The review loop merges ordinary PRs. Enable auto-merge only when the user explicitly authorizes it.
Direct pushes or merges to either protected branch require the user's explicit wording that they want to bypass the
PR workflow.

Keep model design, balance decisions and cross-layer work on the main agent,
except the vetted realism-fixer delegation documented in CLAUDE.md. Give each
delegate a precise scope, working directory and validation expectations; review
its diff before committing. Game-playing agents must not inspect scenario ground
truth, even though implementation agents can.

Keep PR-specific audit findings, review reports and validation evidence in the
PR description or comments. Do not create or commit per-PR documents in the
repository, such as `docs/reviews/pr-<number>.md`. Reusable facts belong in the
existing research ledger, SPEC or PROGRESS tracker as appropriate.

## Reviews

When you post a review report on a PR, whether as a native role, as an ad hoc review the user asked for, or as a
subagent:

- Start it with the exact header line `Automated <role> report (reference only, not a GitHub approval)`.
  - The loops find their own reports by the `pr-reviewer` and `pr-fixer` headers, so an ad hoc review uses another
    role name, e.g. `codex-review`.
  - Comments are posted under the user's account, so a review without the header reads as the user's own decision.
- End it with the attribution line (below), after the report.
- Read CI's results rather than rerunning `npm run check` (`.claude/agents/pr-reviewer.md` check 3). If a rerun is
  needed, use `npm run test:remote` (CLAUDE.md), not the full suite locally.

## Attribution

Every commit an agent writes, and every review report or PR comment it posts, ends with a line naming the agent and
the model it is itself running as: `Co-Authored-By: <Agent> <Model> <vendor address>` (e.g. Codex with its model and
OpenAI's address, if it has one). This applies to subagents and to any agent working under the user's instruction.
Read the model from your own system prompt or environment. Never copy a trailer from a coordinator's brief or from
another agent's commit, and if you can't tell which model you are, omit the model rather than guess. In a review
or comment the line goes last, after the report. Claude sessions use the attribution lines their host provides
(CLAUDE.md "Commit trailers"); where a host's own instructions rule out a model name somewhere, the host's rule wins
there and the model is omitted.

## Host adaptations

- Use the available Codex tools in place of Claude's Bash/Read/Write/Grep/Glob/
  Skill/WebFetch names. Use `rg` for searches. Use tracked command sessions for
  long jobs and collect their exit status; Claude's `run_in_background` option
  is not a Codex tool option.
- Claude's `sonnet`/`opus` metadata does not select Codex models. Each Codex role
  specifies its own model and reasoning defaults in `.codex/agents/`; see the
  assignments and rationale in `docs/codex.md`.
- Resolve checkout and dependency paths from the actual workspace, never from
  a hard-coded `/home/user/goal-mode` path.
- When a named skill is unavailable, use the brief's documented fallback and
  report the limitation. Never claim to have used an unavailable skill or tool.
- Role availability depends on the Codex host and project configuration loading.
  In a fresh trusted session, verify the named roles are exposed before relying
  on them. If unavailable, pass the matching brief, adapters, configured model
  and reasoning level explicitly to an available subagent tool and report that
  fallback. Report unavailable models or unsupported overrides instead of
  claiming the configured selection was used.

See [docs/codex.md](docs/codex.md) for configuration and validation details.
