# Developing with Codex

`AGENTS.md` is the Codex entry point. It references `CLAUDE.md` so architecture,
conventions and workflow stay shared. Native named roles are registered under
`[agents.<name>]` in `.codex/config.toml`; each `config_file` is resolved relative
to that file. The eight `.codex/agents/*.toml` files load the corresponding
`.claude/agents/*.md` brief and adapt host-specific instructions. Edit the existing
brief for shared role changes, and the TOML wrapper for Codex-only changes.

No Claude models or tool allowlists are copied. Roles inherit the host's model,
reasoning and permission settings. `log-reader` additionally requests a read-only
sandbox. Other roles need the host's normal workspace write access for code,
disposable review worktrees or run artifacts. Instructions about output paths
are behavioural constraints, not filesystem sandbox boundaries.

Open a fresh Codex session in this trusted repository after adding/changing the
configuration. Project trust and multi-agent availability are controlled by the
installed client or managed host; this repository does not change those settings.
Verify that its spawn interface exposes the named roles before relying on native
selection. A host that provides its own agent tools may not expose local roles;
in that case supply the existing brief plus the Codex wrapper instructions in an
explicit subagent assignment. Do not claim native role loading was verified by
merely parsing these files.

To validate configuration without running an agent, parse all TOML files and
check that every role's `config_file` and matching Claude brief exist. On a local
Codex CLI installation, `codex --strict-config doctor --summary` also checks loaded
configuration keys and reports environment health; project configuration must be
trusted to be loaded. Network diagnostics may fail independently of configuration. A live
role-selection smoke test still requires a fresh session with role support.

The game itself still uses the normal setup: `npm ci`, `npm run dev` and
`npm run check`. See README.md. Chromium is an additional prerequisite only for
the screenshot helper.

References: [Codex configuration](https://developers.openai.com/codex/config-advanced)
and [configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json).
