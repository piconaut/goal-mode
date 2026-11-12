// WLM tracing for tools/bot.ts (`--trace-day`, `--dump`): what policy adjustment did during a bot's run, an hour
// at a time, without a play file to replay. Sim internals: investigations only.

import type { Scenario } from '../src/sim/core/scenario';
import { hourAttainment } from '../src/game/sla';
import type { RunState } from '../src/game/types';
import { allWorkloads } from '../src/game/workloads';
import type { WlmAdjustTrace } from '../src/sim/wlm/adjust';

const pi2 = (x: number | null | undefined) => (x === null || x === undefined ? '-' : x.toFixed(2));
const piPath = (pi: readonly (number | null)[] | undefined) => (pi ?? []).map(pi2).join('→');

/** `--dump`: one adjustment's candidates in order (PIs, DP, outcome, projected base, managed delay share, delay
 * shares in %, skip clock) and each trial with its verdict. */
export function candidateDump(t: WlmAdjustTrace): string[] {
  const out = [`## ${t.lparId} ${t.clockText}`];
  for (const c of t.candidates) {
    const shares = Object.entries(c.delayShares)
      .map(([k, v]) => `${k}${(100 * (v as number)).toFixed(0)}`)
      .join(' ');
    const mdf = c.managedDelayFrac === undefined ? '-' : c.managedDelayFrac.toFixed(3);
    out.push(
      `   ${c.scKey} imp${c.importance} plex ${pi2(c.sysplexPi)} loc ${pi2(c.localPi)} dp ${c.dp.toString(16).toUpperCase()} ${c.outcome} base ${pi2(c.basePi)} mdf ${mdf} [${shares}]` +
        (c.skipUntilTick !== undefined ? ` clock→${c.skipUntilTick}` : ''),
    );
    for (const tr of c.trials) out.push(`      ${tr.move} ${tr.verdict} ${piPath(tr.receiverPi)}${tr.detail ? ` ${tr.detail}` : ''}`);
  }
  return out;
}

/** The played day (1-based) a `--dump` prefix names, e.g. 29 for `PRDA D29 10:0`. */
export function dumpDay(prefix: string): number | null {
  const m = /\bD(\d+)\b/.exec(prefix);
  return m ? Number(m[1]) : null;
}

/** Collects one hour of traces for `--trace-day`: candidate outcomes per system and the accepted moves. */
export interface HourTrace {
  outcomes: Record<string, number>;
  moves: string[];
}

export const emptyHour = (): HourTrace => ({ outcomes: {}, moves: [] });

export function addTrace(h: HourTrace, t: WlmAdjustTrace): void {
  for (const c of t.candidates) {
    const k = `${t.lparId} ${c.outcome}`;
    h.outcomes[k] = (h.outcomes[k] ?? 0) + 1;
    for (const tr of c.trials) if (tr.verdict === 'ACCEPTED') h.moves.push(`${t.clockText} ${t.lparId} for ${c.scKey}: ${tr.move} ${piPath(tr.receiverPi)}`);
  }
}

/** `--trace-day`: the hour just simulated: moves, candidate outcomes, each workload's SLA attainment for the hour and
 * every goal period's DP (hex). */
export function hourLines(clock: string, h: HourTrace, run: RunState, scenario: Scenario): string[] {
  const outcomes = Object.entries(h.outcomes)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
  const hour = run.smfHours.at(-1);
  const sla = allWorkloads(scenario, run)
    .map((w) => {
      const wh = hour?.workloads[w.id];
      const a = wh ? hourAttainment(w, wh) : null;
      return a ? `${w.id} ${a.attainmentPct.toFixed(0)}` : null;
    })
    .filter((x) => x !== null)
    .join(' ');
  const dps = run.sim.wlm.systems.map(
    (s) => `${s.lparId}: ${s.scps.filter((p) => p.dp >= 0).map((p) => `${p.scKey}=${p.dp.toString(16).toUpperCase()}`).join(' ')}`,
  );
  return [
    `-- ${clock}  ${h.moves.length} move(s)${outcomes ? `; candidates ${outcomes}` : ''}`,
    ...h.moves.map((m) => `   ${m}`),
    `   SLA % ${sla || '-'}`,
    ...dps.map((d, i) => `   ${i === 0 ? 'DPs' : '   '} ${d}`),
  ];
}
