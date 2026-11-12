// Build the play-CLI file of a hands-off run: the docs/wlm-design.md repro recipe (seed 42, Normal, no player
// actions; per day `start`, `advance 24` until the day ends, `draft none`), played in-process through the play CLI's
// own code path, so `inspect … wlm`, `wlm-stats` and `blame` can replay it.
//
//   npm run repro -- runs/s2.json S-2                              # an audit run: S-1 Midwest 2 days, S-2 Revenue 3, S-3 Harbourline 3
//   npm run repro -- runs/m.json --scenario midwest --days 8 [--seed 2] [--difficulty hard]

import { rmSync } from 'node:fs';
import type { DifficultyId } from '../src/content/difficulty';
import { applyPlayCommand, clockText, newPlayFile, type PlayCommand, type PlayFile } from './playCore';
import { writeSpectateFile } from './spectateFile';

/** The audit's statistics runs (docs/wlm-design.md §1, the S-table). */
export const REPRO_RUNS: Record<string, { scenario: string; days: number }> = {
  'S-1': { scenario: 'midwest', days: 2 },
  'S-2': { scenario: 'revenue', days: 3 },
  'S-3': { scenario: 'harbourline', days: 3 },
};

/** Play `days` hands-off days. The log holds exactly the commands the CLI recipe would issue. */
export function reproFile(opts: { scenario: string; days: number; seed?: number; difficulty?: DifficultyId }): PlayFile {
  const seed = opts.seed ?? 42;
  const difficulty = opts.difficulty ?? 'NORMAL';
  let f = newPlayFile(seed, difficulty, opts.scenario);
  const run = (c: PlayCommand) => {
    const out = applyPlayCommand(f, c);
    if (!out.ok) throw new Error(`${JSON.stringify(c)} refused at ${clockText(f.run.sim.tick)}: ${out.text}`);
    f = out.file;
  };
  // A function, so the checker does not narrow the phase across the commands that change it.
  const phase = (): string => f.run.phase;
  for (let d = 0; d < opts.days; d++) {
    if (phase() !== 'BRIEFING') break; // the run ended
    run({ cmd: 'start' });
    // `advance` stops early at a fresh ABEND; the recipe advances again, as the CLI user would.
    while (phase() === 'LIVE') run({ cmd: 'advance', hours: 24 });
    if (phase() === 'REVIEW') run({ cmd: 'draft', optionId: null });
  }
  return f;
}

if (process.argv[1]?.endsWith('repro.ts')) {
  const [path, preset] = process.argv.slice(2);
  const opt = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const named = preset && !preset.startsWith('--') ? REPRO_RUNS[preset] : undefined;
  if (!path || (preset && !preset.startsWith('--') && !named)) {
    console.error(`usage: npm run repro -- <file.json> (${Object.keys(REPRO_RUNS).join(' | ')} | --scenario <id> --days <n>) [--seed 42] [--difficulty normal]`);
    process.exit(2);
  }
  const scenario = opt('scenario') ?? named?.scenario ?? 'midwest';
  const days = Number(opt('days') ?? named?.days ?? 1);
  const seed = Number(opt('seed') ?? 42);
  const difficulty = (opt('difficulty') ?? 'normal').toUpperCase() as DifficultyId;
  const t0 = Date.now();
  const f = reproFile({ scenario, days, seed, difficulty });
  // Same layout as the play CLI: the Monitor III history goes beside the run file.
  const { mon3, ...runFile } = f;
  writeSpectateFile(path, runFile);
  const mon3Path = path.replace(/\.json$/, '') + '.mon3.json';
  if (mon3) writeSpectateFile(mon3Path, mon3);
  else rmSync(mon3Path, { force: true });
  console.log(`${path}: ${scenario} seed ${seed} ${difficulty}, ${days} day(s), now ${clockText(f.run.sim.tick)} ${f.run.phase}, ${f.log.length} commands (${Math.round((Date.now() - t0) / 1000)} s)`);
}
