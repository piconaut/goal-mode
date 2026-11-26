// The nightly Db2 utility schedule (PT-52): REORG, COPY and RUNSTATS on most nights, each adding sequential I/O to its
// LCU while it runs. A card can make one overrun (SimState.utilityOverruns), which keeps it active after its scheduled end.

import type { UtilityDef } from '../../content/entities';
import { streamRng } from '../core/rng';
import type { UtilityOverrun } from '../core/types';
import { TICK_SEC, TICKS_PER_DAY } from '../core/units';
import type { IoClass } from '../io/dasd';

/** Ticks after the played day's 06:00 start at which a wall-clock hour falls (hours below 6 = next morning). */
const startTickOfDay = (hour: number) => Math.round((((hour - 6 + 48) % 24) * 3600) / TICK_SEC);

/** Whether `u` is on the schedule for played day `day`'s night (seeded, so the same every replay). */
export function scheduledTonight(u: UtilityDef, seed: number, day: number): boolean {
  return streamRng(seed, 'utility', u.id, day).chance(u.nightFrac);
}

export interface ActiveUtility {
  def: UtilityDef;
  seqIops: number;
  /** Running after its scheduled end. */
  overrun: boolean;
}

/** The utilities running at `tick`: the night's scheduled ones inside their window, plus any overrunning one. */
export function activeUtilities(utilities: readonly UtilityDef[] | undefined, seed: number, tick: number, overruns: readonly UtilityOverrun[] | undefined): ActiveUtility[] {
  if (!utilities?.length) return [];
  const day = Math.floor(tick / TICKS_PER_DAY);
  const tod = tick % TICKS_PER_DAY;
  const out: ActiveUtility[] = [];
  for (const u of utilities) {
    const over = overruns?.find((o) => o.kind === u.kind);
    if (over) {
      out.push({ def: u, seqIops: over.seqIops, overrun: true });
      continue;
    }
    const from = startTickOfDay(u.startHour);
    const to = from + Math.round((u.durationMin * 60) / TICK_SEC);
    if (tod >= from && tod < to && scheduledTonight(u, seed, day)) out.push({ def: u, seqIops: u.seqIops, overrun: false });
  }
  return out;
}

/** Utility I/O per LCU, for the DASD model's hot volumes. */
export function utilityIopsByLcu(active: readonly ActiveUtility[]): Record<string, Partial<Record<IoClass, number>>> | undefined {
  if (active.length === 0) return undefined;
  const out: Record<string, Partial<Record<IoClass, number>>> = {};
  for (const a of active) {
    const l = (out[a.def.lcuId] ??= {});
    l.SEQ = (l.SEQ ?? 0) + a.seqIops;
  }
  return out;
}
