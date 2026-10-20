// Balance sweep (SPEC §16, PROGRESS M8.2): run strategy bots over many seeds in parallel processes
// and summarise when and why runs end. Each run is a separate `tools/bot.ts --json` process.
//
//   npm run sweep -- --bots donothing,textbook --seeds 1-20 [--jobs 4] [--days 40] [--difficulty story|normal|hard|ironman] [--out sweep.csv]

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

const bots = arg('bots', 'donothing,textbook').split(',');
const [lo, hi] = arg('seeds', '1-20').split('-').map(Number) as [number, number];
const seeds = Array.from({ length: (hi ?? lo) - lo + 1 }, (_, i) => lo + i);
const jobs = Number(arg('jobs', String(Math.max(1, cpus().length))));
const days = arg('days', '');
const difficulty = arg('difficulty', '');
const out = arg('out', 'sweep.csv');

interface Result {
  bot: string;
  seed: number;
  phase: string;
  cause: string;
  day: number;
  score: number;
  overallTrust: number;
  lowestFacet: string;
  bill1: number;
  incidents: number;
  byMechanism: Record<string, number>;
  batchMisses: number;
  events: string[];
}

function runOne(bot: string, seed: number): Promise<Result> {
  return new Promise((resolve, reject) => {
    const args = ['--import', 'tsx', 'tools/bot.ts', '--bot', bot, '--seed', String(seed), '--json', ...(days ? ['--days', days] : []), ...(difficulty ? ['--difficulty', difficulty] : [])];
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    p.stdout.on('data', (d: Buffer) => (text += d.toString()));
    p.on('close', (code) => {
      const line = text.split('\n').find((l) => l.startsWith('JSON:'));
      if (code !== 0 || !line) reject(new Error(`${bot} seed ${seed} failed (exit ${code})`));
      else resolve(JSON.parse(line.slice(5)) as Result);
    });
  });
}

const queue = bots.flatMap((b) => seeds.map((s) => ({ b, s })));
const results: Result[] = [];
const t0 = Date.now();
let done = 0;
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    results.push(await runOne(job.b, job.s));
    done++;
    process.stderr.write(`\r${done}/${bots.length * seeds.length} runs (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
process.stderr.write('\n');
results.sort((a, b) => (a.bot < b.bot ? -1 : a.bot > b.bot ? 1 : a.seed - b.seed));

const mechs = [...new Set(results.flatMap((r) => Object.keys(r.byMechanism)))].sort();
const csv = [
  ['bot', 'seed', 'phase', 'cause', 'day', 'score', 'overall_trust', 'lowest_facet', 'bill_month1', 'incidents', 'batch_misses', ...mechs.map((m) => `inc_${m}`), 'events'].join(','),
  ...results.map((r) =>
    [r.bot, r.seed, r.phase, r.cause, r.day, r.score, r.overallTrust, r.lowestFacet, r.bill1, r.incidents, r.batchMisses, ...mechs.map((m) => r.byMechanism[m] ?? 0), r.events.join(' ')].join(','),
  ),
].join('\n');
writeFileSync(out, csv + '\n');

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]!;
};
console.log(`\n${results.length} runs in ${Math.round((Date.now() - t0) / 1000)} s → ${out}\n`);
console.log('bot          runs  day p10/median/p90   score median  ends by cause');
for (const b of bots) {
  const rs = results.filter((r) => r.bot === b);
  const ds = rs.map((r) => r.day);
  const causes: Record<string, number> = {};
  for (const r of rs) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
  console.log(
    `${b.padEnd(12)} ${String(rs.length).padStart(4)}   ${String(q(ds, 0.1)).padStart(3)} / ${String(q(ds, 0.5)).padStart(3)} / ${String(q(ds, 0.9)).padStart(3)}      ${String(q(
      rs.map((r) => r.score),
      0.5,
    )).padStart(6)}      ${Object.entries(causes)
      .sort()
      .map(([c, n]) => `${c} ${n}`)
      .join(', ')}`,
  );
}
