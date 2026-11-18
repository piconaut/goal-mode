# GOAL MODE

*A z/OS workload performance and capacity management roguelike.*

You are the new capacity and performance lead at a mid-size bank. Each run is a fiscal quarter; each
played day is a 24-hour simulated production day (about 10 real minutes). Read RMF-style reports,
diagnose what went wrong, and change the WLM policy, the LPAR configuration, the hardware plan and
your analytics tooling to keep the SLAs green and the software bill down while the workload grows and
events pile up. You lose when the business loses confidence in you.

The mechanics follow real z/OS behaviour (service classes, importance, velocity and response-time goals,
performance index, PR/SM weights and polarity, R4HA and capping, coupling facility, batch windows). The
numbers are fictional but plausible: nothing in the game is a real IBM rating or price.

## Play

```
npm install
npm run dev            # http://localhost:5173
```

Static build (works from any sub-path, e.g. GitHub Pages or an S3 bucket):

```
npm run build          # typecheck + vite build → dist/
npx vite preview --port 4173
```

Copy `dist/` to any static host. There is no server: the simulation runs in a Web Worker in the browser
and the run is autosaved in the browser (IndexedDB).

## Develop

New to the code? Play a day with `npm run dev`, then run `npm run check`. Read SPEC.md §0–2 (what the game is, then
how a day works), [`CLAUDE.md`](CLAUDE.md) (layering, content and review rules) and
[`BACKLOG.md`](BACKLOG.md) (the scoped work, by list); [`docs/tools.md`](docs/tools.md) lists every script and
[`docs/agents.md`](docs/agents.md) the headless play CLI.

```
npm test               # Vitest: unit, realism and golden tests
npm run typecheck      # tsc --noEmit
npm run check          # typecheck + tests
npm run bench -- --hash                     # one headless day: timing + end-state hash
npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1   # headless sim + RMF reports
npm run bot -- --bot textbook --seed 42 [--difficulty story|normal|hard]
npm run sweep -- --bots donothing,textbook --seeds 1-20 --jobs 4 # bots over many seeds → CSV + summary
npm run test:remote -- --suite sim         # the vitest suite on GitHub Actions; prints a summary
```

Every script and headless tool, with its flags: [`docs/tools.md`](docs/tools.md).

Layout: `src/content` (scenarios, workloads, events, tools, prices, coefficients) → `src/sim` (the
deterministic tick engine) ← `src/game` (run state, days, scoring) ← `src/ui` (React). `src/worker` hosts
the sim in a Web Worker; `tools/` holds the headless runners and strategy bots.

## Documents

- [`SPEC.md`](SPEC.md): the design source of truth (models, verbs, economy, events, scoring, fidelity notes,
  references).
- [`PROGRESS.md`](PROGRESS.md): milestones, decisions, balance results and open questions.
- [`BACKLOG.md`](BACKLOG.md): scoped work ready to pick up, in named lists.
- [`CLAUDE.md`](CLAUDE.md): architecture rules and conventions for contributors (human or AI).
- [`docs/workflow.md`](docs/workflow.md): the single source for branches, PRs, CI gates and definition of done.
- [`AGENTS.md`](AGENTS.md): Codex entry point.

The rest of `docs/` is the long-form material: [`tools.md`](docs/tools.md) (every npm script and headless tool, with
its flags), [`agents.md`](docs/agents.md) (the headless play CLI and the agent roles), [`codex.md`](docs/codex.md)
(the Codex host's roles), [`wlm-design.md`](docs/wlm-design.md) (policy adjustment against real WLM, with invariants
and gaps), [`rca-design.md`](docs/rca-design.md) (incident truth and RCA judging), [`research.md`](docs/research.md)
(the IBM fact ledger with sources), [`playtest-checklist.md`](docs/playtest-checklist.md) (a human playtest
script) and the dated performance analyses in [`headless-performance.md`](docs/headless-performance.md) and
[`headless-performance-options.md`](docs/headless-performance-options.md); `archive/`, `audit-loops/` and
`performance/` keep dated notes and measurements.
