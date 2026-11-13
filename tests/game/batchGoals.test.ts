import { BASEPOL } from '../../src/content/wlm/basepol';
import { applyWlmEdit, batchGoalIssues, serviceClassGoalIssues } from '../../src/game/wlmEdit';
import type { Goal, ServiceDefinition } from '../../src/sim/wlm/types';

describe('batch goal advice (WLM Planning 3.1 p.71)', () => {
  it.each<Goal>([{ kind: 'AVG', rtSec: 60 }, { kind: 'PCT', rtSec: 60, pct: 90 }])('warns but permits a JES $kind goal', (goal) => {
    const def = applyWlmEdit(BASEPOL, { op: 'SET_PERIOD', classId: 'BATCHPRD', period: 0, goal, importance: 4 });
    expect(typeof def).not.toBe('string');
    const issues = batchGoalIssues(def as ServiceDefinition);
    expect(issues).toEqual([{ classId: 'BATCHPRD', subsystem: 'JES', severity: 'warning', message: 'BATCHPRD serves JES jobs with a response-time goal: needs at least three completions per 20 minutes (WLM Planning p.71); with fewer the PI is erratic.' }]);
    expect(serviceClassGoalIssues(def as ServiceDefinition)).toEqual(issues);
  });

  it('leaves the shipped velocity/discretionary batch classes and other RT classes alone', () => {
    expect(batchGoalIssues(BASEPOL)).toEqual([]);
  });

  it('finds nested JES targets and warns once per class, including later RT periods', () => {
    const def = structuredClone(BASEPOL);
    const cls = def.classes.find((c) => c.id === 'BATCHHI')!;
    cls.periods[0]!.durationSu = 1000;
    cls.periods.push({ goal: { kind: 'PCT', rtSec: 60, pct: 90 }, importance: 4, durationSu: null });
    const jes = def.subsystems.find((s) => s.subsystem === 'JES')!;
    jes.rules[0]!.children.push({ qualifier: 'TN', pattern: 'PAY*', serviceClass: 'BATCHHI', reportClass: null, children: [] });
    jes.rules.push({ qualifier: 'TN', pattern: 'RPT*', serviceClass: 'BATCHHI', reportClass: null, children: [] });
    expect(batchGoalIssues(def).map((i) => i.classId)).toEqual(['BATCHHI']);
  });
});
