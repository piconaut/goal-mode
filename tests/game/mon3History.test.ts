import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { MON3_HISTORY } from '../../src/content/tools';
import { buildMon3, type Mon3View } from '../../src/game/mon3';
import { emptyMon3History, MON3_HISTORY_MAX, mon3At, mon3HistoryRange, packMon3, recordMon3History, unpackMon3 } from '../../src/game/mon3History';
import { advance, newRun, startDay } from '../../src/game/run';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };
let views: [number, Mon3View][];

beforeAll(() => {
  let run = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 3 * 360);
  views = [];
  for (let i = 0; i < 3; i++) {
    run = advance(run, MIDWEST, content, MON3_HISTORY.mintimeTicks);
    views.push([run.sim.tick, buildMon3(run, MIDWEST)]);
  }
});

// What the view looks like after a Float32 round trip (JSON form: undefined fields drop out).
const f32 = (v: Mon3View) => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'number' ? Math.fround(x) : x));

describe('Monitor III history', () => {
  it('48 hours of 120 s intervals (MINTIME(120))', () => {
    expect(MON3_HISTORY_MAX).toBe((48 * TICKS_PER_HOUR) / 12);
  });

  it('packs and unpacks a view to Float32 precision, nulls and text intact', () => {
    const [tick, v] = views[0]!;
    const back = unpackMon3(packMon3(emptyMon3History(), tick, v));
    expect(back).toEqual(f32(v));
    expect(back.rows.some((r) => r.goalVelocity === null)).toBe(true);
  });

  it('shares structure between intervals', () => {
    const h = emptyMon3History();
    const a = packMon3(h, views[0]![0], views[0]![1]);
    const b = packMon3(h, views[1]![0], views[1]![1]);
    // Names and goals are the same from one interval to the next; only some text (delay reasons) differs.
    const shared = a.shapes.filter((s) => b.shapes.includes(s)).length;
    expect(shared / a.shapes.length).toBeGreaterThan(0.5);
  });

  it('finds the interval ending at or before a time and reports the range', () => {
    let h = emptyMon3History();
    for (const [t, v] of views) h = recordMon3History(h, t, v);
    const [t0, t1] = [views[0]![0], views[1]![0]];
    expect(mon3At(h, t1)!.tick).toBe(t1);
    expect(mon3At(h, t1 + 3)!.tick).toBe(t1);
    expect(mon3At(h, t0 - 1)).toBeNull();
    expect(mon3HistoryRange(h)).toEqual({ firstTick: t0, lastTick: views[2]![0], count: 3, everyTicks: MON3_HISTORY.mintimeTicks });
  });

  it('drops intervals older than the retention window', () => {
    let h = emptyMon3History();
    const [, v] = views[0]!;
    for (let i = 0; i <= MON3_HISTORY_MAX + 5; i++) h = recordMon3History(h, i * 10, v);
    expect(h.entries.length).toBe(MON3_HISTORY_MAX);
    expect(h.entries[0]!.tick).toBe(60);
    expect(mon3At(h, 50)).toBeNull();
  });

  it('drops intervals at or after a rewound clock', () => {
    let h = emptyMon3History();
    for (const [t, v] of views) h = recordMon3History(h, t, v);
    h = recordMon3History(h, views[1]![0], views[1]![1]);
    expect(h.entries.map((e) => e.tick)).toEqual([views[0]![0], views[1]![0]]);
  });
});
