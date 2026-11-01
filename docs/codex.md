# Developing with Codex

`AGENTS.md` is the Codex entry point. It references `CLAUDE.md` so architecture,
conventions and workflow stay shared. Native named roles are registered under
`[agents.<name>]` in `.codex/config.toml`; each `config_file` is resolved relative
to that file. The eight `.codex/agents/*.toml` files load the corresponding
`.claude/agents/*.md` brief and adapt host-specific instructions. Edit the existing
brief for shared role changes, and the TOML wrapper for Codex-only changes.

No Claude models or tool allowlists are copied. Codex role files set `model` and
`model_reasoning_effort` explicitly. Permission policy stays with the host/user.
`log-reader` additionally requests a read-only sandbox. Other roles need the
host's normal workspace write access for code,
disposable review worktrees or run artifacts. Instructions about output paths
are behavioural constraints, not filesystem sandbox boundaries.

## Model assignments

| Role | Model | Reasoning | Rationale |
| --- | --- | --- | --- |
| `log-reader` | `gpt-6-luna` | `low` | Focused extraction of exact evidence from supplied logs. |
| `implementer` | `gpt-6.1-sol` | `medium` | Reliable coding for a precise, bounded assignment. |
| `pr-reviewer` | `gpt-6.1-sol` | `high` | Adversarial code review, edge cases and checking claims against evidence. |
| `realism-fixer` | `gpt-6.1-sol` | `high` | Vetted model changes require careful implementation, regression tests and determinism. |
| `goal-mode-realism-auditor` | `gpt-6-astra` | `high` | Open-ended source interpretation, experiment design and causal judgments across z/OS subsystems. |
| `goal-mode-player` | `gpt-6-luna` | `high` | Repeated CLI play with explicit rules; extra reasoning for diagnosis and resource trade-offs. |
| `goal-mode-cost-cutter` | `gpt-6-luna` | `high` | The same play task with a cost-focused strategy. |
| `goal-mode-cautious-operator` | `gpt-6-luna` | `high` | The same play task with a conservative strategy. |

These are task-based starting defaults, not measured quality guarantees. Keeping
the three players on the same model and effort avoids introducing a model
difference when comparing their strategies. The main agent reviews delegated
changes and findings; difficult player diagnoses can be escalated to it.

## Loading and validation

Open a fresh Codex session in this trusted repository after adding/changing the
configuration. Project trust and multi-agent availability are controlled by the
installed client or managed host; this repository does not change those settings.
Verify that its spawn interface exposes the named roles before relying on native
selection. A host that provides its own agent tools may not expose local roles;
in that case supply the existing brief plus the Codex wrapper instructions and
pass that role's configured model and reasoning level to the subagent tool. If
the host cannot select that model or effort, report the limitation. Do not claim
native role loading was verified by merely parsing these files.

To validate configuration without running an agent, parse all TOML files and
check that every role's `config_file` and matching Claude brief exist. On a local
installation, `codex debug models` lists available model slugs and their
`supported_reasoning_levels`; check each role's selection against that catalog.
`codex --strict-config doctor --summary` also checks loaded
configuration keys and reports environment health; project configuration must be
trusted to be loaded. Network diagnostics may fail independently of configuration.
A live role-selection smoke test still requires a fresh session with role support.

The game itself still uses the normal setup: `npm ci`, `npm run dev` and
`npm run check`. See README.md. Chromium is an additional prerequisite only for
the screenshot helper.

References: [Codex configuration](https://developers.openai.com/codex/config-advanced)
and [configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json).
