// CI gate: after a behaviour change, a small bot sweep must stay inside loose balance bands. The bands catch a
// model change that breaks the game (expert stops winning, do-nothing survives), not fine balance: the 20-seed
// targets in PROGRESS.md M8.2 stay the job of full sweeps.
//
//   npm run sweep -- --bots donothing,textbook,expert --seeds 1-5 --out runs/ci-sweep.csv
//   npx tsx tools/ci/balanceGate.ts runs/ci-sweep.csv 5
import { appendFileSync, readFileSync } from 'node:fs';

interface Band {
  dayMedian: [number, number];
  victories?: [number, number];
}

// Normal difficulty, Midwest, seeds 1–5. Wider than the M8.2 targets because five seeds are noisy.
export const BANDS: Record<string, Band> = {
  donothing: { dayMedian: [8, 22], victories: [0, 0] },
  textbook: { dayMedian: [20, 36] },
  expert: { dayMedian: [28, 40], victories: [3, 5] },
};

export interface Row {
  bot: string;
  seed: number;
  cause: string;
  day: number;
  score: number;
}

export function parseSweepCsv(csv: string): Row[] {
  const [header, ...lines] = csv.trim().split('\n');
  const col = header!.split(',');
  const at = (cells: string[], name: string) => cells[col.indexOf(name)]!;
  return lines.map((l) => {
    const c = l.split(',');
    return { bot: at(c, 'bot'), seed: Number(at(c, 'seed')), cause: at(c, 'cause'), day: Number(at(c, 'day')), score: Number(at(c, 'score')) };
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export function checkBands(rows: Row[], seedsPerBot: number, bands = BANDS): { table: string[]; failures: string[] } {
  const table = ['| bot | runs | day median (band) | victories (band) | ends by cause |', '|---|---|---|---|---|'];
  const failures: string[] = [];
  for (const [bot, band] of Object.entries(bands)) {
    const rs = rows.filter((r) => r.bot === bot);
    const med = rs.length ? median(rs.map((r) => r.day)) : NaN;
    const wins = rs.filter((r) => r.cause === 'victory').length;
    const causes: Record<string, number> = {};
    for (const r of rs) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
    if (rs.length !== seedsPerBot) failures.push(`${bot}: ${rs.length} of ${seedsPerBot} runs finished`);
    if (!(med >= band.dayMedian[0] && med <= band.dayMedian[1])) failures.push(`${bot}: median end day ${med} outside ${band.dayMedian.join('–')}`);
    if (band.victories && (wins < band.victories[0] || wins > band.victories[1])) failures.push(`${bot}: ${wins} victories outside ${band.victories.join('–')}`);
    const winBand = band.victories ? band.victories.join('–') : 'any';
    const ends = Object.entries(causes).sort().map(([c, n]) => `${c} ${n}`).join(', ');
    table.push(`| ${bot} | ${rs.length} | ${med} (${band.dayMedian.join('–')}) | ${wins} (${winBand}) | ${ends} |`);
  }
  return { table, failures };
}

if (process.argv[1]?.endsWith('balanceGate.ts')) {
  const [file, seeds] = process.argv.slice(2);
  if (!file || !seeds) throw new Error('usage: balanceGate.ts <sweep.csv> <seedsPerBot>');
  const { table, failures } = checkBands(parseSweepCsv(readFileSync(file, 'utf8')), Number(seeds));
  const report = ['### Balance sweep (Normal, Midwest)', '', ...table, '', ...(failures.length ? failures.map((f) => `- ❌ ${f}`) : ['All bots inside their bands.'])].join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  if (failures.length) process.exit(1);
}
