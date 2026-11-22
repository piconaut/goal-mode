// Investigation views of a run file that the game does not show the player (sim internals).
// For developers and the playtest companion checking a bug; player agents must not use it (docs/agents.md).
// Usage:
//   npm run inspect -- runs/a.json dp <system> [--class ONL] [--from 'D19 20:00'] [--to 'D20 06:00']
//     Dispatching priority (hex) per service class period at the end of each RMF interval, oldest first.
//   npm run inspect -- runs/a.json wlm <system> --at 'D19 22:00' [--ticks 6] [--class ONL]
//     Why WLM did or didn't move DPs: per policy adjustment (10 s), the receiver candidates in order, each trial
//     move and why it was accepted or rejected. A play-CLI run (seed + log) replays to any past time; a browser save
//     carries its live day's 06:00 start and that day's actions (PT-17), so any time in its current day replays;
//     a save without either traces forward from the saved moment (live day only).
//   npm run inspect -- runs/a.json wlm-stats [system] [--from 'D1 06:00'] [--to 'D3 06:00'] [--ladder '12:00'] [--by-class] [--episodes] [--streaks] [--moves] [--json]
//     Policy adjustment statistics over a range of a play file (WT-01): adjustments, candidates by outcome, trials by
//     verdict, accepted moves, receivers assessed on 30 adjustments without a move, and the DP ladder at a clock
//     time. --by-class adds each period's outcomes, --episodes lists those 30-assessment runs, --streaks lists
//     runs of 30+ no-trial checks, --moves lists every accepted move. A whole-run replay costs about 6 s per played
//     day, like `blame`.
//   npm run inspect -- runs/a.json blame [--json] [--incident N] [--floor <pp>]
//     Counterfactual validator (RT-06, RT-25): every online incident's opening hour is replayed once per card active
//     in it with that card ended at the hour start. Reports each card's attainment gain against a noise floor
//     measured from red-herring cards, and keeps the RT-06 verdict (removal met the SLA) beside it. Costs an hour of
//     sim per card per incident, so it is offline only; needs a play-CLI file. --floor passes a scenario's floor
//     measured on a wider seed sample.

import { readFileSync } from 'node:fs';
import { dpText } from './inspect/dp';
import { wlmText } from './inspect/wlm';
import { blameText } from './inspect/blame';
import { wlmStatsText } from './inspect/wlmStats';
import { isMain, takeFlag, taker } from './args';

export { dpText } from './inspect/dp';
export { traceText, wlmText } from './inspect/wlm';
export { blameText } from './inspect/blame';
export { classRows, moveRows, replayTraces, statsText, wlmStats, wlmStatsText } from './inspect/wlmStats';
export type { WlmStatsCounters, WlmStats, WlmEpisode, WlmStreak, WlmClassRow, WlmMoveRow } from './inspect/wlmStats';
export { stoppedEarly, replayAdvance } from './inspect/shared';

process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const json = takeFlag(argv, 'json');
  const take = taker(argv);
  const cls = take('class') ?? '', from = take('from') ?? '', to = take('to') ?? '', at = take('at') ?? '', ticks = take('ticks') ?? '';
  const incident = take('incident');
  const floor = take('floor'), ladder = take('ladder');
  const details = { byClass: takeFlag(argv, 'by-class'), episodes: takeFlag(argv, 'episodes'), streaks: takeFlag(argv, 'streaks'), moves: takeFlag(argv, 'moves') };
  const [path, verb, system] = argv;
  if (path && verb === 'blame') {
    try {
      console.log(blameText(readFileSync(path, 'utf8'), { json, ...(incident ? { incident: Number(incident) } : {}), ...(floor ? { floorPct: Number(floor) } : {}) }));
    } catch (e) {
      console.error(`blame: ${(e as Error).message}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (path && verb === 'wlm-stats') {
    try {
      console.log(wlmStatsText(readFileSync(path, 'utf8'), { ...(system ? { system } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(ladder ? { ladder } : {}), json,
        ...Object.fromEntries(Object.entries(details).filter(([, v]) => v)) }));
    } catch (e) {
      console.error(`wlm-stats: ${(e as Error).message}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (path && verb === 'wlm' && system && at) {
    try {
      console.log(wlmText(readFileSync(path, 'utf8'), system, { at, ...(ticks ? { ticks: Number(ticks) } : {}), ...(cls ? { cls } : {}) }));
    } catch (e) {
      console.error(`wlm: ${(e as Error).message}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (!path || verb !== 'dp' || !system) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
    process.exit(1);
  }
  try {
    console.log(dpText(readFileSync(path, 'utf8'), system, { ...(cls ? { cls } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }));
  } catch (e) {
    console.error(`dp: ${(e as Error).message}`);
    process.exit(1);
  }
}
