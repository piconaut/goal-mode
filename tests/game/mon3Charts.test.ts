import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { MON3_CHARTS } from '../../src/content/tools';
import { buildMon3 } from '../../src/game/mon3';
import { advance, chooseDraft, newRun, requestChange, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { buildView } from '../../src/game/view';
import { TICKS_PER_DAY } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };
const withCharts = (seed = 7): RunState => ({ ...newRun(MIDWEST, content, seed), tools: ['RMF_MON3', 'MON3_CHARTS'] });

describe('Monitor III charting', () => {
  it('samples once per sim-minute and is deterministic', () => {
    const a = advance(startDay(withCharts(), content), MIDWEST, content, 120);
    const b = advance(startDay(withCharts(), content), MIDWEST, content, 120);
    const s = a.mon3Charts!.samples;
    expect(s).toHaveLength(120 / MON3_CHARTS.sampleTicks);
    expect(s[1]!.tick - s[0]!.tick).toBe(MON3_CHARTS.sampleTicks);
    expect(JSON.stringify(a.mon3Charts)).toBe(JSON.stringify(b.mon3Charts));
  });

  it('is off without the tool, or with Monitor III switched off', () => {
    const plain = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 60);
    expect(plain.mon3Charts).toBeNull();
    expect(buildView(plain, MIDWEST).mon3Charts).toBeNull();
    const off = advance(startDay({ ...withCharts(), toolsOff: ['RMF_MON3'] }, content), MIDWEST, content, 60);
    expect(off.mon3Charts).toBeNull();
  });

  it('delay stack adds up to the DELAY report total', () => {
    const r = advance(startDay(withCharts(), content), MIDWEST, content, 6 * 360);
    const last = r.mon3Charts!.samples.at(-1)!;
    for (const row of buildMon3(r, MIDWEST).rows.filter((x) => x.system === '*PLEX' && x.goal !== 'system')) {
      const d = last.delay[row.scKey]!;
      expect(d.cpu + d.ziip + d.io + d.cap + d.other).toBeCloseTo(100 * row.delayFrac, 0);
    }
  });

  it('marks emergency changes and resets at the next day', () => {
    let r = advance(startDay(withCharts(), content), MIDWEST, content, 60);
    r = requestChange(r, content, { label: 'RMF 15', commands: [{ kind: 'SET_RMF_INTERVAL', minutes: 15 }] }).run;
    r = advance(r, MIDWEST, content, 12);
    expect(r.mon3Charts!.markers.some((m) => m.kind === 'CHANGE' && m.text.includes('RMF 15'))).toBe(true);
    r = advance(r, MIDWEST, content, TICKS_PER_DAY);
    expect(r.mon3Charts!.samples.length).toBeLessThanOrEqual(TICKS_PER_DAY / MON3_CHARTS.sampleTicks);
    r = startDay(chooseDraft(r, content, null), content);
    expect(r.mon3Charts!.samples).toHaveLength(0);
  });
});
