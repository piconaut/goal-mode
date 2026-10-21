import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { MON3_CHARTS } from '../../src/content/tools';
import { buildMon3 } from '../../src/game/mon3';
import { firstSeen } from '../../src/game/mon3Charts';
import { applyWlmEdit } from '../../src/game/wlmEdit';
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

  it('delay stack adds up to the DELAY report delays (less STR) plus UKN', () => {
    const r = advance(startDay(withCharts(), content), MIDWEST, content, 6 * 360);
    const last = r.mon3Charts!.samples.at(-1)!;
    for (const row of buildMon3(r, MIDWEST).rows.filter((x) => x.system === '*PLEX' && x.goal !== 'system')) {
      const d = last.delay[row.scKey]!;
      expect(d.cpu + d.ziip + d.io + d.cap + d.other).toBeCloseTo(100 * (row.delayFrac - row.delay.stor + row.unknownFrac), 0);
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

describe('response time by class', () => {
  it('records new service classes and report classes, keeping first-seen colour order', () => {
    let r = advance(startDay(withCharts(), content), MIDWEST, content, 360);
    let def = r.sim.wlm.definition;
    const step1 = applyWlmEdit(def, { op: 'ADD_CLASS', classId: 'DDFMOB', description: 'mobile', goal: { kind: 'PCT', pct: 90, rtSec: 0.3 }, importance: 2, cpuCritical: false });
    if (typeof step1 === 'string') throw new Error(step1);
    const step2 = applyWlmEdit(step1, { op: 'ADD_RULE', subsystem: 'DDF', qualifier: 'UI', pattern: 'MOBAPI', serviceClass: 'DDFMOB', reportClass: 'RMOBILE', at: [0] });
    if (typeof step2 === 'string') throw new Error(step2);
    def = { ...step2, policyName: 'TEST2' };
    const before = firstSeen(r.mon3Charts!.samples, (s) => s.rt);
    r = advance({ ...r, pendingCommands: [{ kind: 'ACTIVATE_POLICY', definition: def }] }, MIDWEST, content, 60);
    const last = r.mon3Charts!.samples.at(-1)!;
    expect(last.rt['DDFMOB#1']).toBeGreaterThan(0);
    expect(last.rcRt.RMOBILE).toBeGreaterThan(0);
    const after = firstSeen(r.mon3Charts!.samples, (s) => s.rt);
    // DDFMOB sorts before DDFPRD but arrives later: existing series keep their positions.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe('DDFMOB#1');
  });
});

describe('report class edits', () => {
  it('validates names and registers them in the definition', () => {
    const def = newRun(MIDWEST, content, 7).sim.wlm.definition;
    const ok = applyWlmEdit(def, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'TN', pattern: 'RB*', serviceClass: 'ONLHI', reportClass: 'RRETAIL', at: [0] });
    expect(typeof ok).not.toBe('string');
    expect((ok as typeof def).reportClasses).toContain('RRETAIL');
    expect(applyWlmEdit(def, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'TN', pattern: 'RB*', serviceClass: 'ONLHI', reportClass: 'ONLHI' })).toMatch(/service class/);
    expect(applyWlmEdit(def, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'TN', pattern: 'RB*', serviceClass: 'ONLHI', reportClass: 'TOOLONGNAME' })).toMatch(/1–8/);
  });
});
