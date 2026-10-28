import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { MON3_HISTORY } from '../../src/content/tools';
import { addPin } from '../../src/game/evidence';
import { buildMon3, type Mon3View } from '../../src/game/mon3';
import { emptyMon3PinHistory, mon3PinRange, mon3PinsAt, recordMon3Pins, type Mon3PinHistory } from '../../src/game/mon3PinHistory';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };
let run: RunState;
let views: [number, Mon3View][];

beforeAll(() => {
  run = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 3 * TICKS_PER_HOUR);
  views = [];
  for (let i = 0; i < 3; i++) {
    run = advance(run, MIDWEST, content, MON3_HISTORY.mintimeTicks);
    views.push([run.sim.tick, buildMon3(run, MIDWEST)]);
  }
});

const record = (vs: [number, Mon3View][], h = emptyMon3PinHistory()): Mon3PinHistory => vs.reduce((a, [t, v]) => recordMon3Pins(a, t, v), h);

describe('Monitor III pin history (play CLI)', () => {
  it('keeps what a pin reads, to four decimals', () => {
    const [t, v] = views[1]!;
    const back = mon3PinsAt(record(views), t)!;
    expect(back.tick).toBe(t);
    expect(back.view.rows.length).toBe(v.rows.length);
    for (const [i, r] of v.rows.entries()) {
      const b = back.view.rows[i]!;
      expect([b.system, b.scKey]).toEqual([r.system, r.scKey]);
      if (r.pi === null) expect(b.pi).toBeNull();
      else expect(b.pi).toBeCloseTo(r.pi, 4);
      expect(b.cpuEngines).toBeCloseTo(r.cpuEngines, 4);
      expect(b.delay.cpu).toBeCloseTo(r.delay.cpu, 4);
    }
    expect(back.view.cpc.map((c) => [c.lparId, c.prsmDelayPct])).toEqual(v.cpc.map((c) => [c.lparId, Math.round(c.prsmDelayPct * 1e4) / 1e4]));
  });

  it('finds the range ending at or before a time; names are stored once while they stay the same', () => {
    const h = record(views);
    expect(h.keySets).toHaveLength(1);
    expect(mon3PinsAt(h, views[1]![0] + 5)!.tick).toBe(views[1]![0]);
    expect(mon3PinsAt(h, views[0]![0] - 1)).toBeNull();
    expect(mon3PinRange(h)).toEqual({ firstTick: views[0]![0], lastTick: views[2]![0] });
  });

  it('keeps 48 hours and drops the names no kept range uses', () => {
    const [, v] = views[0]!;
    const renamed: Mon3View = { ...v, rows: v.rows.map((r) => ({ ...r, scKey: `X${r.scKey}` })) };
    const every = MON3_HISTORY.mintimeTicks;
    let h = recordMon3Pins(emptyMon3PinHistory(), 0, renamed);
    const n = (MON3_HISTORY.retentionHours * TICKS_PER_HOUR) / every;
    for (let i = 1; i <= n; i++) h = recordMon3Pins(h, i * every, v);
    expect(h.entries).toHaveLength(n);
    expect(h.entries[0]!.tick).toBe(every);
    expect(h.keySets).toHaveLength(1);
    expect(mon3PinsAt(h, every)!.view.rows[0]!.scKey).toBe(v.rows[0]!.scKey);
  });

  it('a pin from a past range carries that range\'s time and value; without history it is refused', () => {
    const [t0, v0] = views[0]!;
    const h = record(views);
    const row = v0.rows.find((r) => r.system === '*PLEX' && r.pi !== null)!;
    const req = { source: 'MON3' as const, system: '*PLEX', scKey: row.scKey, metric: 'PI' as const, tick: t0 + 1 };
    const out = addPin(run, MIDWEST, req, (t) => mon3PinsAt(h, t));
    expect(out.ok, out.message).toBe(true);
    const p = out.run.pins.at(-1)!;
    expect(p.tick).toBe(t0);
    expect(p.value).toBeCloseTo(row.pi!, 4);
    expect(addPin(run, MIDWEST, req).ok).toBe(false);
    const cpc = addPin(run, MIDWEST, { source: 'CPC', lparId: v0.cpc[0]!.lparId, metric: 'PRSM_DELAY', tick: t0 }, (t) => mon3PinsAt(h, t));
    expect(cpc.ok, cpc.message).toBe(true);
    expect(cpc.run.pins.at(-1)!.tick).toBe(t0);
  });
});
