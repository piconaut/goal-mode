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

```
npm test               # Vitest: unit, realism and golden tests
npm run typecheck      # tsc --noEmit
npm run check          # typecheck + tests
npm run bench -- --hash                     # one headless day: timing + end-state hash
npm run sim -- --days 2 --hourly --report 12 --detail ONLHI#1   # headless sim + RMF reports
npm run bot -- --bot textbook --seed 42 [--difficulty story|normal|hard]
npm run sweep -- --bots donothing,textbook --seeds 1-20 --jobs 4 # bots over many seeds → CSV + summary
```

Layout: `src/content` (scenarios, workloads, events, tools, prices, coefficients) → `src/sim` (the
deterministic tick engine) ← `src/game` (run state, days, scoring) ← `src/ui` (React). `src/worker` hosts
the sim in a Web Worker; `tools/` holds the headless runners and strategy bots.

## Documents

- [`SPEC.md`](SPEC.md): the design source of truth (models, verbs, economy, events, scoring, fidelity notes,
  references).
- [`PROGRESS.md`](PROGRESS.md): milestones, decisions, balance results and open questions.
- [`CLAUDE.md`](CLAUDE.md): architecture rules and conventions for contributors (human or AI).
- [`docs/agents.md`](docs/agents.md): the headless play CLI and the AI agents that play the game through it.
