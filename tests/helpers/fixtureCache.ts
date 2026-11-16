// Shared start states for the heavy game test files (CL-12). Vitest runs each test file in its own worker, so an
// expensive `advance` can only be shared through disk. The key hashes every file under `src/`, `tests/helpers/` and
// `package-lock.json` — this file included — so any code, content or recipe change rebuilds instead of serving a
// state that no longer matches the code under test.
//
// The recipes live here, beside the cache, so editing one changes the key. A test file that builds its own start
// state cannot use the cache silently: it would have to pass a builder whose source is not hashed.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { packOf } from '../../src/content/packs';
import { MIDWEST } from '../../src/content/scenarios';
import { scenarioFor } from '../../src/game/difficulty';
import { advance, chooseDraft, newRun, startDay } from '../../src/game/run';
import { decodeRunJson, encodeRunJson } from '../../src/game/runFile';
import type { RunState } from '../../src/game/types';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CACHE_DIR = join(ROOT, 'node_modules/.cache/goal-mode-fixtures');
const HOUR = 360;
const midwestContent = { ...MIDWEST_GAME, events: [] };
const revenuePack = packOf('revenue');
const revenueScenario = scenarioFor(revenuePack.scenario, 'NORMAL');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let fingerprint: string | undefined;
/** sha256 over the sorted relative path and bytes of everything a start state depends on. */
function sourceFingerprint(): string {
  fingerprint ??= (() => {
    const files = [
      ...walk(join(ROOT, 'src')),
      ...walk(join(ROOT, 'tests/helpers')),
      join(ROOT, 'package-lock.json'),
    ]
      .map((f) => relative(ROOT, f))
      .sort();
    const h = createHash('sha256');
    for (const f of files) {
      h.update(f);
      h.update('\0');
      h.update(readFileSync(join(ROOT, f)));
      h.update('\0');
    }
    return h.digest('hex');
  })();
  return fingerprint;
}

let tmpCounter = 0;

/** The named state from the cache, or `build()` written there for the next worker. Every call returns a fresh copy. */
export function cachedRunState(name: string, build: () => RunState): RunState {
  const key = sourceFingerprint().slice(0, 16);
  const file = join(CACHE_DIR, `${name}.${key}.json`);
  if (existsSync(file)) {
    try {
      return decodeRunJson<RunState>(readFileSync(file, 'utf8'));
    } catch {
      // A truncated or hand-edited file: rebuild and overwrite it below.
    }
  }
  const state = build();
  const text = encodeRunJson(state);
  const copy = decodeRunJson<RunState>(text);
  // The state must survive the codec the cache uses (the sim keeps Infinity for "uncapped"), and the copy handed
  // back must be the one the next reader would get. Fail in the owning worker rather than in another test file.
  if (encodeRunJson(copy) !== text) throw new Error(`fixture ${name}: state does not survive the JSON cache`);

  mkdirSync(CACHE_DIR, { recursive: true });
  // Writes go to a private temporary file and are renamed into place, so a parallel worker never reads a half state.
  const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  // Stale keys only accumulate after a code change; drop them so the directory stays about one state set. Only whole
  // cache files match, so another worker's in-flight `.tmp` write is never removed.
  try {
    for (const f of readdirSync(CACHE_DIR)) {
      const stale = /\.([0-9a-f]{16})\.json$/.exec(f);
      if (stale && stale[1] !== key) rmSync(join(CACHE_DIR, f), { force: true });
    }
  } catch {
    // Another worker is pruning too; the next run cleans up.
  }
  return copy;
}

/** Midwest seed 7, events off, 6 h to 12:00 on day 1: the shared start of evidence, storageJobWmPins, proofRecipes,
 * smf and mon3. */
export const midwestNoon = (): RunState =>
  cachedRunState('midwest-noon', () =>
    advance(startDay(newRun(MIDWEST, midwestContent, 7), midwestContent), MIDWEST, midwestContent, 6 * HOUR),
  );

/** `midwestNoon` plus one hour with RBANK's CPU capped to 3: the regressed hour evidence and storageJobWmPins pin. */
export const midwestNoonRbank = (): RunState =>
  cachedRunState('midwest-noon-rbank', () =>
    advance(
      { ...midwestNoon(), pendingCommands: [{ kind: 'SET_MODIFIER', mod: 'cpu', key: 'RBANK', value: 3 }] },
      MIDWEST,
      midwestContent,
      HOUR,
    ),
  );

/** Hours played into day 2 for `revenueIncidentHour`. */
export const REVENUE_INCIDENT_HOUR = 5;

/** Revenue seed 6 at D2 11:00: the hour of its first incident, which counterfactual.test.ts replays. */
export const revenueIncidentHour = (): RunState =>
  cachedRunState('revenue-incident-hour', () => {
    let run = newRun(revenuePack.scenario, revenuePack.game, 6);
    run = startDay(run, revenuePack.game);
    run = advance(run, revenueScenario, revenuePack.game, 24 * HOUR);
    run = chooseDraft(run, revenuePack.game, null);
    run = startDay(run, revenuePack.game);
    return advance(run, revenueScenario, revenuePack.game, REVENUE_INCIDENT_HOUR * HOUR);
  });
