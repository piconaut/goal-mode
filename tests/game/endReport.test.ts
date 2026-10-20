import { describe, expect, it } from 'vitest';
import { endReport, gradeFor } from '../../src/game/endReport';
import type { RunState } from '../../src/game/types';

describe('gradeFor', () => {
  it('rewards surviving the quarter most, then SLA, then trust', () => {
    expect(gradeFor(1, true, 99.8, 90).grade).toBe('S');
    expect(gradeFor(1, true, 99.8, 90).points).toBe(98);
    expect(gradeFor(0.95, false, 99.8, 95).grade).toBe('B');
    expect(gradeFor(1, true, 97, 60).grade).toBe('B');
    expect(gradeFor(0.3, false, 94, 10).grade).toBe('D');
  });
});

describe('endReport', () => {
  it('builds the timeline, the biggest incident and the best RCA from run records', () => {
    const inc = (id: number, workloadId: string, hours: number, rcaPoints: number | null) => ({
      id, workloadId, day: id, startTick: 0, endTick: 1, hours, worstAttainmentPct: 80,
      truth: { mechanism: 'CAPPING', trigger: 'POLICY' },
      rca: rcaPoints === null ? null : { mechanism: 'CAPPING', trigger: 'POLICY', points: rcaPoints },
      trustLost: 0,
    });
    const run = {
      phase: 'GAMEOVER',
      maxDays: 40,
      reports: [
        { day: 0, sla: [{ attainmentPct: 100 }, { attainmentPct: 90 }], score: 50, batchMissed: false, piWorst: { 'ONLHI#1': 1.4 } },
        { day: 1, sla: [{ attainmentPct: 98 }], score: 40, batchMissed: true, piWorst: { 'BATCHPRD#1': 2, 'ONLHI#1': 0.8 } },
      ],
      capacityDays: [{ day: 1, peakR4haSum: 812 }],
      changes: [
        { label: 'later', activateDay: 1, emergency: true, status: 'APPLIED' },
        { label: 'first', activateDay: 0, emergency: false, status: 'APPLIED' },
        { label: 'never', activateDay: 0, emergency: false, status: 'FAILED' },
      ],
      incidents: [inc(0, 'MOBILE', 2, 5), inc(1, 'TELLER', 6, null)],
    } as unknown as RunState;
    const r = endReport(run, 50);
    expect(r.daysPlayed).toBe(2);
    expect(r.meanSlaPct).toBeCloseTo(96);
    expect(r.days[0]!.worstSlaPct).toBe(90);
    expect(r.days[1]!.peakR4haSum).toBe(812);
    expect(r.decisions.map((d) => d.label)).toEqual(['first', 'later']);
    expect(r.biggestIncident).toMatchObject({ workloadId: 'TELLER', hours: 6, cause: 'capping (policy)' });
    expect(r.piHeat).toEqual({ scKeys: ['BATCHPRD#1', 'ONLHI#1'], byDay: [[null, 2], [1.4, 0.8]] });
    expect(r.bestRca).toMatchObject({ workloadId: 'MOBILE', points: 5 });
  });
});
