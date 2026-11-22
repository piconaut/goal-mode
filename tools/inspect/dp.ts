import { decodePlayFile, clockText } from '../playCore';
import { tickOfClock } from '../../src/sim/core/clock';

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
