import { describe, expect, it } from 'vitest';
import { MIDWEST_UTILITIES, type UtilityDef } from '../../src/content/entities';
import { tickOfPlayedHour } from '../../src/sim/core/clock';
import { TICK_SEC, TICKS_PER_DAY } from '../../src/sim/core/units';
import { activeUtilities, scheduledTonight, utilityIopsByLcu } from '../../src/sim/subsys/utilities';

const byKind = (k: UtilityDef['kind']) => MIDWEST_UTILITIES.find((u) => u.kind === k)!;
const reorg = byKind('REORG');
const runstats = byKind('RUNSTATS');

describe('scheduledTonight', () => {
  it('is deterministic and hits nightFrac over many days', () => {
    expect(scheduledTonight(reorg, 4, 10)).toBe(scheduledTonight(reorg, 4, 10));
    for (const u of MIDWEST_UTILITIES) {
      let n = 0;
      for (let d = 0; d < 400; d++) if (scheduledTonight(u, 11, d)) n++;
      expect(Math.abs(n / 400 - u.nightFrac)).toBeLessThan(0.08);
    }
  });
});

describe('activeUtilities', () => {
  const nights = (u: UtilityDef) => {
    const on: number[] = [];
    const off: number[] = [];
    for (let d = 0; d < 200 && (on.length < 1 || off.length < 1); d++) (scheduledTonight(u, 3, d) ? on : off).push(d);
    return { on: on[0]!, off: off[0]! };
  };

  it('runs a utility only inside its window on a scheduled night', () => {
    const { on, off } = nights(reorg);
    expect(off).toBeDefined();
    const start = on * TICKS_PER_DAY + tickOfPlayedHour(reorg.startHour);
    const len = Math.round((reorg.durationMin * 60) / TICK_SEC);
    expect(activeUtilities(MIDWEST_UTILITIES, 3, start, undefined).map((a) => a.def.id)).toContain('REORGSET');
    expect(activeUtilities(MIDWEST_UTILITIES, 3, start + len - 1, undefined).map((a) => a.def.id)).toContain('REORGSET');
    expect(activeUtilities(MIDWEST_UTILITIES, 3, start + len, undefined).map((a) => a.def.id)).not.toContain('REORGSET');
    expect(activeUtilities(MIDWEST_UTILITIES, 3, start - 1, undefined).map((a) => a.def.id)).not.toContain('REORGSET');
    const a = activeUtilities(MIDWEST_UTILITIES, 3, start, undefined).find((x) => x.def.id === 'REORGSET')!;
    expect(a).toMatchObject({ seqIops: reorg.seqIops, overrun: false });
    // Not scheduled that night: quiet at the same time of day.
    const offStart = off * TICKS_PER_DAY + tickOfPlayedHour(reorg.startHour);
    expect(activeUtilities(MIDWEST_UTILITIES, 3, offStart, undefined).map((x) => x.def.id)).not.toContain('REORGSET');
  });

  it('puts small-hours utilities in the next morning of the same played day', () => {
    const { on } = nights(runstats);
    const tick = on * TICKS_PER_DAY + tickOfPlayedHour(runstats.startHour);
    expect(tick % TICKS_PER_DAY).toBeGreaterThan(TICKS_PER_DAY / 2);
    expect(activeUtilities(MIDWEST_UTILITIES, 3, tick, undefined).map((a) => a.def.id)).toContain('RUNSTDAT');
    expect(activeUtilities(MIDWEST_UTILITIES, 3, on * TICKS_PER_DAY, undefined).map((a) => a.def.id)).not.toContain('RUNSTDAT');
  });

  it('keeps an overrunning utility active at its overrun rate at any tick', () => {
    const r = activeUtilities(MIDWEST_UTILITIES, 3, 0, [{ kind: 'REORG', seqIops: 55_000 }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ seqIops: 55_000, overrun: true });
    expect(r[0]!.def.kind).toBe('REORG');
    expect(activeUtilities(undefined, 3, 0, undefined)).toEqual([]);
  });
});

describe('utilityIopsByLcu', () => {
  it('sums SEQ per LCU and is undefined for none', () => {
    expect(utilityIopsByLcu([])).toBeUndefined();
    const a = (lcuId: string, seqIops: number) => ({ def: { ...reorg, lcuId }, seqIops, overrun: false });
    expect(utilityIopsByLcu([a('21', 100), a('21', 50), a('10', 7)])).toEqual({ '21': { SEQ: 150 }, '10': { SEQ: 7 } });
  });
});
