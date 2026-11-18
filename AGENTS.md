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

## Workflow and attribution

Codex sessions follow the shared branch/PR workflow, CI gates, review-header rule and definition of done in
[**docs/workflow.md**](docs/workflow.md). The role briefs in `.claude/agents/` remain the source of truth for each
role's scope; the Codex role assignments are in `docs/codex.md`.

Codex specifics on top of the shared rules:

- The `pr-fixer` role may fast-forward small mechanical fixes to a PR branch but never merges; when it has pushed to
  your branch, pull before pushing again and don't redo the fixes in its report.
- Keep host-specific instructions out of the shared docs: `CLAUDE.md` is the Claude host brief, this file is the
  Codex one, and neither repeats the workflow rules.
- Commit and review-report trailers name the Codex agent and its model from its own prompt or environment; no
  `Claude-Session:` line.

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
