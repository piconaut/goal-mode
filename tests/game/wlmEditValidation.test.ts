import { describe, expect, it } from 'vitest';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { applyWlmEdit, goalError } from '../../src/game/wlmEdit';

const refused = (r: unknown) => expect(typeof r).toBe('string');
const accepted = (r: unknown) => expect(typeof r).not.toBe('string');

describe('WLM edit validation (WLM Planning p.67, p.84, p.99, p.102, p.120)', () => {
  it('keeps goals in range', () => {
    expect(goalError({ kind: 'VEL', velocity: 0 })).toMatch(/1 to 99/);
    expect(goalError({ kind: 'VEL', velocity: 100 })).toMatch(/1 to 99/);
    expect(goalError({ kind: 'PCT', rtSec: 0.5, pct: 100 })).toMatch(/1 to 99/);
    expect(goalError({ kind: 'AVG', rtSec: 0 })).toMatch(/millisecond/);
    expect(goalError({ kind: 'AVG', rtSec: 86_401 })).toMatch(/24 hours/);
    expect(goalError({ kind: 'VEL', velocity: 50 })).toBeNull();
    refused(applyWlmEdit(BASEPOL, { op: 'SET_PERIOD', classId: 'STCHI', period: 0, goal: { kind: 'VEL', velocity: 100 }, importance: 1 }));
    refused(applyWlmEdit(BASEPOL, { op: 'SET_PERIOD', classId: 'STCHI', period: 0, goal: { kind: 'VEL', velocity: 50 }, importance: 9 as never }));
    refused(applyWlmEdit(BASEPOL, { op: 'SET_PERIOD', classId: 'TSO', period: 0, goal: { kind: 'AVG', rtSec: 1 }, importance: 2, durationSu: -5 }));
    refused(applyWlmEdit(BASEPOL, { op: 'SET_PERIOD', classId: 'TSO', period: 0, goal: { kind: 'AVG', rtSec: 1 }, importance: 2, durationSu: null }));
  });

  it('allows CPU Critical only on single-period, non-discretionary classes', () => {
    refused(applyWlmEdit(BASEPOL, { op: 'SET_FLAGS', classId: 'DDFPRD', cpuCritical: true }));
    refused(applyWlmEdit(BASEPOL, { op: 'SET_FLAGS', classId: 'DEVBAT', cpuCritical: true }));
    accepted(applyWlmEdit(BASEPOL, { op: 'SET_FLAGS', classId: 'ONLHI', cpuCritical: true }));
    const crit = applyWlmEdit(BASEPOL, { op: 'SET_FLAGS', classId: 'BATCHPRD', cpuCritical: true });
    accepted(crit);
    refused(applyWlmEdit(crit as typeof BASEPOL, { op: 'ADD_PERIOD', classId: 'BATCHPRD', goal: { kind: 'DISC' }, importance: 5, previousDurationSu: 1000 }));
    refused(applyWlmEdit(crit as typeof BASEPOL, { op: 'SET_PERIOD', classId: 'BATCHPRD', period: 0, goal: { kind: 'DISC' }, importance: 5 }));
    refused(applyWlmEdit(BASEPOL, { op: 'ADD_CLASS', classId: 'NEWDISC', description: '', goal: { kind: 'DISC' }, importance: 5, cpuCritical: true }));
  });

  it('limits SYSSTC and SYSTEM to the subsystems that may use them', () => {
    refused(applyWlmEdit(BASEPOL, { op: 'SET_DEFAULT', subsystem: 'DDF', serviceClass: 'SYSSTC' }));
    refused(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'JES', qualifier: 'TN', pattern: 'PAY*', serviceClass: 'SYSTEM' }));
    refused(applyWlmEdit(BASEPOL, { op: 'SET_RULE_TARGET', subsystem: 'CICS', path: [0], serviceClass: 'SYSSTC' }));
    accepted(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'STC', qualifier: 'TN', pattern: 'NETVIEW', serviceClass: 'SYSSTC' }));
    accepted(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'JES', qualifier: 'TN', pattern: 'SMFDUMP', serviceClass: 'SYSSTC' }));
  });

  it('accepts only qualifiers the subsystem supports, 8 characters, not nested in themselves', () => {
    refused(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'DDF', qualifier: 'TN', pattern: 'X', serviceClass: 'DDFPRD' }));
    refused(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'TSO', qualifier: 'PK', pattern: 'X', serviceClass: 'TSO' }));
    refused(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'STC', qualifier: 'TC', pattern: 'X', serviceClass: 'STCMED' }));
    refused(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'TN', pattern: 'ABCDEFGHIJKL', serviceClass: 'ONLHI' }));
    const one = applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'TN', pattern: 'PAY*', serviceClass: 'ONLHI', at: [0] });
    accepted(one);
    refused(applyWlmEdit(one as typeof BASEPOL, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'TN', pattern: 'PAY1', serviceClass: 'ONLMED', at: [0, 0] }));
    accepted(applyWlmEdit(one as typeof BASEPOL, { op: 'ADD_RULE', subsystem: 'CICS', qualifier: 'UI', pattern: 'TELLER*', serviceClass: 'ONLMED', at: [0, 0] }));
    accepted(applyWlmEdit(BASEPOL, { op: 'ADD_RULE', subsystem: 'DDF', qualifier: 'PK', pattern: 'MOBPKG', serviceClass: 'DDFPRD' }));
  });
});
