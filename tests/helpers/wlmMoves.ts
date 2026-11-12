import type { WlmAdjustTrace } from '../../src/sim/wlm/adjust';
import { DAY_SEC, DAY_START_HOUR } from '../../src/sim/core/units';

export interface CommittedMove { sec: number; who: string; dir: number; line: string }

/** Observe live ordering, including ties: internal steps and canonical DP numbers are not live moves. */
export function committedMoves(t: WlmAdjustTrace): CommittedMove[] {
  const clock = /^D(\d+) (\d\d):(\d\d):(\d\d)$/.exec(t.clockText)!;
  const sec = (Number(clock[1]) - 1) * DAY_SEC + ((Number(clock[2]) - DAY_START_HOUR + 24) % 24) * 3600 + Number(clock[3]) * 60 + Number(clock[4]);
  const position = (dps: Record<string, number>, key: string) => {
    const values = Object.values(dps);
    return values.filter((dp) => dp < dps[key]!).length + values.filter((dp) => dp === dps[key]!).length / 2;
  };
  return t.candidates.flatMap((c) => c.trials.filter((tr) => tr.verdict === 'ACCEPTED').flatMap((tr) => {
    if (!tr.plan || !tr.afterDps) throw new Error('Expected a complete committed-plan trace');
    return [...new Set(tr.plan.map((m) => m.scKey))].sort().flatMap((who) => {
      const dir = Math.sign(position(tr.afterDps!, who) - position(t.dps, who));
      return dir === 0 ? [] : [{ who, dir, sec, line: t.action! }];
    });
  }));
}
