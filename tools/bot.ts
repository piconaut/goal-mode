// Headless strategy bots for balancing (SPEC §16).
// Usage: npm run bot -- --bot donothing --days 40 --seed 42 [--spectate runs/bot.json --pace 2]

import { packOf } from '../src/content/packs';
import { advance, chooseDraft, newRun, overallTrust, startDay } from '../src/game/run';
import type { RunState } from '../src/game/types';
import { FACETS, facetsOf } from '../src/game/types';
import { TICKS_PER_DAY } from '../src/sim/core/units';
import { instanceClock } from '../src/sim/core/step';
import { STRATEGIES } from './strategies';
import { decideTfp } from '../src/game/tfp';
import { writeSpectateFile } from './spectateFile';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

const pack = packOf(arg('scenario', 'midwest'));
const scenario = pack.scenario;
const content = pack.game;
const seed = Number(arg('seed', '42'));
const days = Number(arg('days', String(content.maxDays)));
const botName = arg('bot', 'donothing');
/** `--tfp sign` signs the Tailored Fit Pricing offer when it arrives; default declines by ignoring it. */
const tfp = arg('tfp', 'ignore');
const bot = STRATEGIES[botName];
if (!bot) throw new Error(`Unknown bot ${botName}; have ${Object.keys(STRATEGIES).join(', ')}`);

/** `--spectate runs/<name>.json [--pace 2]`: write the run after every simulated hour for `?spectate=<name>`. */
const spectatePath = process.argv.includes('--spectate') ? arg('spectate', 'runs/bot.json') : null;
const paceSec = Number(arg('pace', '0'));
const spectateLog: { cmd: string; text?: string }[] = [];
let seenChanges = 0;
function spectate(r: RunState) {
  if (!spectatePath) return;
  // Banner text: the change labels the bot made since the last write.
  const fresh = r.changes.slice(seenChanges).map((c) => c.label);
  seenChanges = r.changes.length;
  if (fresh.length) spectateLog.push({ cmd: 'note', text: `${botName}: ${fresh.join('; ')}` });
  spectateLog.push({ cmd: 'advance', text: `${botName} day ${r.day + 1} ${r.phase}` });
  writeSpectateFile(spectatePath, { version: 1, run: r, pendingPolicy: null, log: spectateLog.slice(-50) });
  if (paceSec > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, paceSec * 1000);
}

const difficulty = arg('difficulty', 'NORMAL').toUpperCase() as import('../src/content/difficulty').DifficultyId;
let run: RunState = newRun(scenario, content, seed, difficulty);
const t0 = performance.now();
console.log(`bot=${botName} seed=${seed} difficulty=${difficulty}`);
console.log('day  overall  ' + (content.facets?.map((x) => x.id) ?? FACETS).map((f) => f.slice(0, 6).padStart(7)).join('') + '  incid  batchEnd  score  MLCest     events');
while (run.day < days && (run.phase === 'BRIEFING' || run.phase === 'REVIEW')) {
  if (run.phase === 'BRIEFING') {
    run = bot.briefing(run, scenario, content);
    if (tfp === 'sign' && run.tfpOffer?.status === 'OFFERED') run = decideTfp(run, true).run;
    run = startDay(run, content);
    spectate(run);
    while (run.phase === 'LIVE') {
      run = advance(run, scenario, content, 360);
      if (run.phase === 'LIVE') run = bot.hourly(run, scenario, content);
      spectate(run);
    }
  }
  const rep = run.reports[run.reports.length - 1];
  if (rep) {
    const inc = run.incidents.filter((i) => i.day === rep.day);
    console.log(
      `${String(rep.day + 1).padStart(3)}  ${overallTrust(run).toFixed(1).padStart(7)}  ` +
        facetsOf(run).map((f) => run.trust[f]!.toFixed(0).padStart(7)).join('') +
        `  ${String(inc.length).padStart(5)}  ${(rep.batch?.criticalEndSec != null ? instanceClock(rep.batch.criticalEndSec) : 'unfin').padStart(8)}${rep.batchMissed ? '!' : ' '} ${String(rep.score).padStart(5)}  $${Math.round(rep.mlcEstimate / 1000)}k  ${rep.events.join(', ')}`,
    );
    for (const i of inc) console.log(`        ${i.workloadId} ${i.hours}h worst ${i.worstAttainmentPct.toFixed(1)}% → ${i.truth.mechanism}/${i.truth.trigger}`);
  }
  if (run.phase === 'REVIEW') run = bot.review(run, scenario, content);
  spectate(run);
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
  const lowest = facetsOf(run).reduce((a, f) => (run.trust[f]! < run.trust[a]! ? f : a));
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
