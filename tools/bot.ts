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

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

const scenario = SCENARIOS[arg('scenario', 'midwest')]!;
const content = MIDWEST_GAME;
const seed = Number(arg('seed', '42'));
const days = Number(arg('days', String(content.maxDays)));
const botName = arg('bot', 'donothing');
const bot = STRATEGIES[botName];
if (!bot) throw new Error(`Unknown bot ${botName}; have ${Object.keys(STRATEGIES).join(', ')}`);

let run: RunState = newRun(scenario, content, seed);
const t0 = performance.now();
console.log(`bot=${botName} seed=${seed}`);
console.log('day  overall  ' + FACETS.map((f) => f.slice(0, 6).padStart(7)).join('') + '  incid  batchEnd  score  MLCest     events');
while (run.day < days && (run.phase === 'BRIEFING' || run.phase === 'REVIEW')) {
  if (run.phase === 'BRIEFING') {
    run = bot.briefing(run, scenario, content);
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
void chooseDraft;
