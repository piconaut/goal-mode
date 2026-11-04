// Investigation views of a run file that the game does not show the player (sim internals).
// For developers and the playtest companion checking a bug; player agents must not use it (docs/agents.md).
// Usage:
//   npm run inspect -- runs/a.json dp <system> [--class ONL] [--from 'D19 20:00'] [--to 'D20 06:00']
//     Dispatching priority (hex) per service class period at the end of each RMF interval, oldest first.

import { readFileSync } from 'node:fs';
import { decodePlayFile, clockText } from './playCore';
import { tickOfClock } from '../src/sim/core/clock';

process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
}

/** DP per scKey per RMF interval on one system: one line per interval, `CLASS#p=HEX` pairs. */
export function dpText(text: string, system: string, opts: { cls?: string; from?: string; to?: string } = {}): string {
  const run = decodePlayFile(text).run;
  const from = opts.from ? tickOfClock(opts.from) : null;
  const to = opts.to ? tickOfClock(opts.to) : null;
  if ((opts.from && from === null) || (opts.to && to === null)) throw new Error('times look like D19 20:00');
  const cls = opts.cls?.toUpperCase();
  const ivs = run.sim.rmf.intervals.filter((iv) => (from === null || iv.endTick > from) && (to === null || iv.startTick < to));
  const systems = [...new Set(run.sim.rmf.intervals.flatMap((iv) => iv.wlm.map((w) => w.lparId)))].filter((s) => s !== '*PLEX').sort();
  if (!systems.includes(system)) return `No system ${system}; one of ${systems.join(' ')}`;
  const lines = ivs.map((iv) => {
    const rows = iv.wlm
      .filter((w) => w.lparId === system && w.dp !== null && (!cls || w.scKey.toUpperCase().includes(cls)))
      .sort((a, b) => b.dp! - a.dp! || (a.scKey < b.scKey ? -1 : 1));
    return `${clockText(iv.endTick)}  ${rows.map((w) => `${w.scKey}=${w.dp!.toString(16).toUpperCase()}`).join(' ')}`;
  });
  return [`${system} dispatching priority at each RMF interval end (highest first; hex)`, ...(lines.length ? lines : ['no intervals in range'])].join('\n');
}

if (process.argv[1]?.endsWith('inspect.ts')) {
  const args = process.argv.slice(2);
  const cls = opt(args, '--class'), from = opt(args, '--from'), to = opt(args, '--to');
  const [path, verb, system] = args;
  if (!path || verb !== 'dp' || !system) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
    process.exit(1);
  }
  console.log(dpText(readFileSync(path, 'utf8'), system, { ...(cls ? { cls } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }));
}
