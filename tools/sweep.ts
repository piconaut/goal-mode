// Balance sweep (SPEC §16, PROGRESS M8.2): run strategy bots over many seeds in parallel processes
// and summarise when and why runs end. Each run is a separate `tools/bot.ts --json` process.
//
//   npm run sweep -- --bots donothing,textbook --seeds 1-20 [--jobs 4] [--days 40] [--difficulty story|normal|hard|ironman] [--scenario midwest|revenue] [--out sweep.csv] [--resume]

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname } from 'node:path';

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
const scenarioId = arg('scenario', '');
const out = arg('out', 'sweep.csv');
// Each finished run is appended here at once, so a killed sweep keeps its results; --resume skips them.
const partial = `${out}.partial.jsonl`;
const resume = process.argv.includes('--resume');
mkdirSync(dirname(out), { recursive: true }); // CI checks out without runs/ (gitignored)

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
    const args = ['--import', 'tsx', 'tools/bot.ts', '--bot', bot, '--seed', String(seed), '--json', ...(days ? ['--days', days] : []), ...(difficulty ? ['--difficulty', difficulty] : []), ...(scenarioId ? ['--scenario', scenarioId] : [])];
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

const results: Result[] =
  resume && existsSync(partial)
    ? readFileSync(partial, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Result)
        .filter((r) => bots.includes(r.bot) && seeds.includes(r.seed))
    : [];
if (!resume) writeFileSync(partial, '');
const have = new Set(results.map((r) => `${r.bot}:${r.seed}`));
const queue = bots.flatMap((b) => seeds.map((s) => ({ b, s }))).filter((j) => !have.has(`${j.b}:${j.s}`));
if (results.length) process.stderr.write(`resuming: ${results.length} runs already in ${partial}\n`);
const failed: string[] = [];
const t0 = Date.now();
let done = results.length;
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    try {
      const r = await runOne(job.b, job.s);
      results.push(r);
      appendFileSync(partial, JSON.stringify(r) + '\n');
    } catch (e) {
      failed.push((e as Error).message);
    }
    done++;
    process.stderr.write(`\r${done}/${bots.length * seeds.length} runs (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
process.stderr.write('\n');
for (const f of failed) process.stderr.write(`FAILED: ${f}\n`);
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
