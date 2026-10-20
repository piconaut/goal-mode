// Headless strategy bots for balancing (SPEC §16).
// Usage: npm run bot -- --bot donothing --days 40 --seed 42

import { MIDWEST_GAME } from '../src/content/game-midwest';
import { SCENARIOS } from '../src/content/scenarios';
import { advance, chooseDraft, newRun, overallTrust, startDay } from '../src/game/run';
import type { RunState } from '../src/game/types';
import { FACETS } from '../src/game/types';
import { TICKS_PER_DAY } from '../src/sim/core/units';
import { instanceClock } from '../src/sim/core/step';
import { STRATEGIES } from './strategies';
import { decideTfp } from '../src/game/tfp';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

const scenario = SCENARIOS[arg('scenario', 'midwest')]!;
const content = MIDWEST_GAME;
const seed = Number(arg('seed', '42'));
const days = Number(arg('days', String(content.maxDays)));
const botName = arg('bot', 'donothing');
/** `--tfp sign` signs the Tailored Fit Pricing offer when it arrives; default declines by ignoring it. */
const tfp = arg('tfp', 'ignore');
const bot = STRATEGIES[botName];
if (!bot) throw new Error(`Unknown bot ${botName}; have ${Object.keys(STRATEGIES).join(', ')}`);

const difficulty = arg('difficulty', 'NORMAL').toUpperCase() as import('../src/content/difficulty').DifficultyId;
let run: RunState = newRun(scenario, content, seed, difficulty);
const t0 = performance.now();
console.log(`bot=${botName} seed=${seed} difficulty=${difficulty}`);
console.log('day  overall  ' + FACETS.map((f) => f.slice(0, 6).padStart(7)).join('') + '  incid  batchEnd  score  MLCest     events');
while (run.day < days && (run.phase === 'BRIEFING' || run.phase === 'REVIEW')) {
  if (run.phase === 'BRIEFING') {
    run = bot.briefing(run, scenario, content);
    if (tfp === 'sign' && run.tfpOffer?.status === 'OFFERED') run = decideTfp(run, true).run;
    run = startDay(run, content);
    while (run.phase === 'LIVE') {
      run = advance(run, scenario, content, 360);
      if (run.phase === 'LIVE') run = bot.hourly(run, scenario, content);
    }
  }
  const rep = run.reports[run.reports.length - 1];
  if (rep) {
    const inc = run.incidents.filter((i) => i.day === rep.day);
    console.log(
      `${String(rep.day + 1).padStart(3)}  ${overallTrust(run).toFixed(1).padStart(7)}  ` +
        FACETS.map((f) => run.trust[f].toFixed(0).padStart(7)).join('') +
        `  ${String(inc.length).padStart(5)}  ${(rep.batch?.criticalEndSec != null ? instanceClock(rep.batch.criticalEndSec) : 'unfin').padStart(8)}${rep.batchMissed ? '!' : ' '} ${String(rep.score).padStart(5)}  $${Math.round(rep.mlcEstimate / 1000)}k  ${rep.events.join(', ')}`,
    );
    for (const i of inc) console.log(`        ${i.workloadId} ${i.hours}h worst ${i.worstAttainmentPct.toFixed(1)}% → ${i.truth.mechanism}/${i.truth.trigger}`);
  }
  if (run.phase === 'REVIEW') run = bot.review(run, scenario, content);
  if (run.phase === 'GAMEOVER' || run.phase === 'VICTORY') break;
  void TICKS_PER_DAY;
}
console.log(`\n${run.phase}: ${run.endReason ?? ''}  day ${run.day + 1}  score ${run.score}  (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
for (const b of run.sim.cost.bills) console.log(`bill month ${b.month + 1}: $${Math.round(b.total).toLocaleString()}`);
console.log(`month ${run.sim.cost.month + 1} to date: $${Math.round(run.reports.at(-1)?.mlcEstimate ?? 0).toLocaleString()}${run.sim.cost.tfp ? ' (TFP)' : ''}`);
void chooseDraft;

// One machine-readable summary line for tools/sweep.ts.
if (process.argv.includes('--json')) {
  const reason = run.endReason ?? '';
  const cause = run.phase === 'VICTORY' ? 'victory' : /trust/i.test(reason) ? 'trust' : /batch/i.test(reason) ? 'batch' : /opex|outsourc/i.test(reason) ? 'opex' : run.phase === 'GAMEOVER' ? 'other' : 'unfinished';
  const byMech: Record<string, number> = {};
  for (const i of run.incidents) byMech[i.truth.mechanism] = (byMech[i.truth.mechanism] ?? 0) + 1;
  const lowest = FACETS.reduce((a, f) => (run.trust[f] < run.trust[a] ? f : a), FACETS[0]!);
  console.log(
    'JSON:' +
      JSON.stringify({
        bot: botName,
        seed,
        phase: run.phase,
        cause,
        // Day the run ended on (1-based), or days completed when it was cut short by --days.
        day: run.phase === 'GAMEOVER' || run.phase === 'VICTORY' ? run.day + 1 : run.day,
        score: run.score,
        overallTrust: Math.round(overallTrust(run) * 10) / 10,
        lowestFacet: lowest,
        bill1: Math.round(run.sim.cost.bills[0]?.total ?? 0),
        incidents: run.incidents.length,
        byMechanism: byMech,
        batchMisses: run.reports.filter((r) => r.batchMissed).length,
        events: [...new Set(run.events.filter((e) => e.started).map((e) => e.defId))].sort(),
      }),
  );
}
