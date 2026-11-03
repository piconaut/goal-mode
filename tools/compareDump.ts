// Dumps what a run looks like to the player and to WLM, for tools/compare.ts. Runs unchanged inside any checkout
// (compare.ts copies it into the base worktree), so it uses only long-standing APIs.
// Usage: npx tsx tools/compareDump.ts <out.json> [--scenarios a,b] [--seed 42] [--days 1] [--every 3] [--drop k1,k2]
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { HARBOURLINE_GAME } from '../src/content/game-harbourline';
import { MIDWEST_GAME } from '../src/content/game-midwest';
import { REVENUE_GAME } from '../src/content/game-revenue';
import { SCENARIOS } from '../src/content/scenarios';
import { buildMon3 } from '../src/game/mon3';
import { advance, chooseDraft, newRun, startDay } from '../src/game/run';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../src/sim/core/units';
import * as reports from '../src/sim/measure/reports';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
};
const out = process.argv[2]!;
const scenarios = arg('scenarios', 'midwest,harbourline,revenue').split(',');
const seed = Number(arg('seed', '42'));
const days = Number(arg('days', '1'));
const every = Number(arg('every', '3')) * TICKS_PER_HOUR;
// Reporting-only state: left out of the WLM/sim hash so a report-only change shows "sim: same".
const DROP = new Set(['rmf', 'reports', ...arg('drop', '').split(',').filter(Boolean)]);
const GAMES: Record<string, typeof MIDWEST_GAME> = { midwest: MIDWEST_GAME, harbourline: HARBOURLINE_GAME, revenue: REVENUE_GAME };
const hash = (x: unknown, drop?: Set<string>) =>
  createHash('sha256').update(JSON.stringify(x, drop ? (k, v) => (drop.has(k) ? undefined : v) : undefined)).digest('hex').slice(0, 16);

// Every text renderer for one RMF interval; renderers a checkout doesn't have are skipped.
function rmfText(iv: Parameters<typeof reports.renderWlmSummary>[0]): string {
  const r = reports as unknown as Record<string, ((iv: unknown, ...a: unknown[]) => string) | undefined>;
  const systems = ['*PLEX', ...new Set(iv.wlm.map((w) => w.lparId).filter((s) => s !== '*PLEX'))];
  const parts = systems.map((s) => reports.renderWlmSummary(iv, s));
  for (const w of [...iv.wlm, ...(iv.wlmRc ?? [])]) parts.push(reports.renderWlmDetail(iv, w.scKey, w.lparId));
  for (const name of ['renderPartitionData', 'renderCfActivity', 'renderDasdSummary']) if (r[name]) parts.push(r[name]!(iv));
  return parts.join('\n');
}

const result: Record<string, unknown> = {};
for (const id of scenarios) {
  const sc = SCENARIOS[id];
  const game = GAMES[id];
  if (!sc || !game) throw new Error(`unknown scenario ${id}`);
  let run = newRun(sc, game, seed);
  const mon3: { tick: number; view: unknown }[] = [];
  for (let d = 0; d < days; d++) {
    run = startDay(run, game);
    for (let t = 0; t < TICKS_PER_DAY; t += every) {
      run = advance(run, sc, game, Math.min(every, TICKS_PER_DAY - t));
      mon3.push({ tick: run.sim.tick, view: buildMon3(run, sc) });
    }
    if (run.phase === 'REVIEW') run = chooseDraft(run, game, run.draft?.[0]?.id ?? null);
  }
  const { sim, ...game_ } = run;
  const ivs = sim.rmf.intervals;
  result[id] = {
    simHash: hash(sim, DROP),
    gameHash: hash(game_, DROP),
    logHash: hash(run.log),
    rmfText: ivs.map((iv) => ({ tick: iv.endTick, text: rmfText(iv) })),
    rmf: ivs.map((iv) => ({ tick: iv.endTick, ...iv })),
    mon3,
  };
}
writeFileSync(out, JSON.stringify(result));
