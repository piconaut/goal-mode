import { BASEPOL } from '../../src/content/wlm/basepol';
import { applyWlmEdit, cicsGoalIssues, cicsTransactionClasses } from '../../src/game/wlmEdit';
import type { ServiceDefinition } from '../../src/sim/wlm/types';

const ok = (r: ServiceDefinition | string) => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

describe('CICS transaction class goals (WLM Planning ch. 9–10)', () => {
  it('finds the classes CICS rules and the CICS default point at, and BASEPOL is clean', () => {
    expect(cicsTransactionClasses(BASEPOL)).toEqual(['ONLHI', 'ONLMED']);
    expect(cicsGoalIssues(BASEPOL)).toEqual([]);
  });

  it('warns on a velocity goal but still applies the edit', () => {
    const d = ok(applyWlmEdit(BASEPOL, { op: 'SET_PERIOD', classId: 'ONLMED', period: 0, goal: { kind: 'VEL', velocity: 50 }, importance: 2 }));
    expect(cicsGoalIssues(d)).toEqual([expect.objectContaining({ classId: 'ONLMED', severity: 'warning', message: expect.stringMatching(/velocity goal: not supported \(WLM Planning/) })]);
  });

  it('warns on a second period', () => {
    const d = ok(applyWlmEdit(BASEPOL, { op: 'ADD_PERIOD', classId: 'ONLHI', goal: { kind: 'PCT', pct: 90, rtSec: 1 }, importance: 3, previousDurationSu: 500 }));
    const issues = cicsGoalIssues(d);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/2 periods: not supported/);
  });

  it('warns once a velocity class starts serving CICS work, not before', () => {
    expect(cicsGoalIssues(BASEPOL).some((i) => i.classId === 'BATCHPRD')).toBe(false);
    const d = ok(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'TN', pattern: 'BX*', serviceClass: 'BATCHPRD' }));
    expect(cicsGoalIssues(d).map((i) => [i.classId, i.severity])).toEqual([['BATCHPRD', 'warning']]);
  });

  it('leaves velocity goals on the CICS region started-task class alone', () => {
    expect(cicsTransactionClasses(BASEPOL)).not.toContain('STCHI');
  });

  it('refuses a resource group on a CICS transaction class', () => {
    const r = applyWlmEdit(BASEPOL, { op: 'SET_RESOURCE_GROUP', classId: 'ONLHI', group: { id: 'RGONL', type: 3, min: null, max: 200 } });
    expect(r).toMatch(/ONLHI serves CICS transactions, which can't be in a resource group/);
  });

  it('refuses classifying CICS work into a class that has a resource group', () => {
    const d = ok(applyWlmEdit(BASEPOL, { op: 'SET_RESOURCE_GROUP', classId: 'BATCHPRD', group: { id: 'RGBAT', type: 3, min: null, max: 200 } }));
    expect(applyWlmEdit(d, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'TN', pattern: 'BX*', serviceClass: 'BATCHPRD' })).toMatch(/resource group/);
    expect(applyWlmEdit(d, { op: 'SET_DEFAULT', subsystem: 'CICS', serviceClass: 'BATCHPRD' })).toMatch(/resource group/);
    expect(applyWlmEdit(d, { op: 'SET_RULE_TARGET', subsystem: 'CICS', path: [0], serviceClass: 'BATCHPRD' })).toMatch(/resource group/);
  });

  it('keeps an older policy that already has the error editable', () => {
    const bad = structuredClone(BASEPOL);
    bad.resourceGroups.push({ id: 'RGONL', type: 3, min: null, max: 200 });
    bad.classes.find((c) => c.id === 'ONLHI')!.resourceGroup = 'RGONL';
    expect(cicsGoalIssues(bad).filter((i) => i.severity === 'error')).toHaveLength(1);
    ok(applyWlmEdit(bad, { op: 'SET_FLAGS', classId: 'STCHI', cpuCritical: true }));
    expect(cicsGoalIssues(ok(applyWlmEdit(bad, { op: 'SET_RESOURCE_GROUP', classId: 'ONLHI', group: null })))).toEqual([]);
  });
});
