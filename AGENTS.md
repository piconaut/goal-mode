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
- `realism-fixer`: one vetted realism fix in a separate worktree.
- `goal-mode-realism-auditor`: controlled experiments and documented findings;
  writes only under `runs/lab/`.
- `goal-mode-player`, `goal-mode-cost-cutter`, `goal-mode-cautious-operator`:
  headless play with the brief's information restrictions and strategy.

Keep model design, balance decisions and cross-layer work on the main agent,
except the vetted realism-fixer delegation documented in CLAUDE.md. Give each
delegate a precise scope, working directory and validation expectations; review
its diff before committing. Game-playing agents must not inspect scenario ground
truth, even though implementation agents can.

## Host adaptations

- Use the available Codex tools in place of Claude's Bash/Read/Write/Grep/Glob/
  Skill/WebFetch names. Use `rg` for searches. Use tracked command sessions for
  long jobs and collect their exit status; Claude's `run_in_background` option
  is not a Codex tool option.
- Claude's `sonnet`/`opus` metadata does not select Codex models. Roles inherit
  the host's model and reasoning settings unless configured by the user.
- Resolve checkout and dependency paths from the actual workspace, never from
  a hard-coded `/home/user/goal-mode` path.
- When a named skill is unavailable, use the brief's documented fallback and
  report the limitation. Never claim to have used an unavailable skill or tool.
- Role availability depends on the Codex host and project configuration loading.
  In a fresh trusted session, verify the named roles are exposed before relying
  on them. If unavailable, pass the matching brief and adapters explicitly to an
  available subagent tool and report that fallback.

See [docs/codex.md](docs/codex.md) for configuration and validation details.
