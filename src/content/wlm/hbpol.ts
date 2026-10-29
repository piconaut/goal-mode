// Starting WLM service definition for Harbourline Bank. Its deliberate flaw is the average-response
// goal on market order capture (SPEC §13.5, Problem 1); the rest is a reasonable policy.

import type { ClassificationRule, PeriodDef, ServiceClassDef, ServiceDefinition } from '../../sim/wlm/types';

const vel = (velocity: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'VEL', velocity }, importance, durationSu });
const pct = (p: number, rtSec: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'PCT', pct: p, rtSec }, importance, durationSu });
const avg = (rtSec: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'AVG', rtSec }, importance, durationSu });
const disc = (): PeriodDef => ({ goal: { kind: 'DISC' }, importance: 5, durationSu: null });
const sc = (id: string, description: string, periods: PeriodDef[]): ServiceClassDef => ({ id, description, periods, cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
const rule = (qualifier: ClassificationRule['qualifier'], pattern: string, serviceClass: string | null): ClassificationRule => ({ qualifier, pattern, serviceClass, reportClass: null, children: [] });

export const HBPOL: ServiceDefinition = {
  policyName: 'HBPOL',
  classes: [
    sc('STCHI', 'High STCs: CICS regions, Db2, MQ', [vel(60, 1)]),
    sc('STCMED', 'Medium STCs: monitors', [vel(40, 3)]),
    sc('STCLO', 'Low STCs', [vel(20, 5)]),
    // Problem 1: an average goal is wrecked by one burst (a few very slow orders drag the mean
    // over the goal), so WLM chases a goal that bursts make unreachable. A percentile goal tolerates them.
    sc('MKTORD', 'Markets order capture', [avg(0.15, 1)]),
    sc('ONLHI', 'Retail and card authorisation', [pct(95, 0.25, 2)]),
    sc('ONLMED', 'Payments', [pct(90, 0.5, 2)]),
    sc('MKTDDF', 'Markets price queries (DDF)', [pct(95, 0.4, 2, 2000), vel(30, 4)]),
    sc('DDFPRD', 'Other DDF: mobile and analytics', [pct(90, 0.5, 3, 2000), vel(30, 4)]),
    sc('BATCHHI', 'Critical batch', [vel(50, 3)]),
    sc('BATCHPRD', 'Production batch', [vel(30, 4)]),
    sc('TSO', 'TSO users', [avg(0.5, 3, 400), vel(20, 5)]),
    sc('DEVBAT', 'Development batch', [disc()]),
  ],
  reportClasses: [],
  resourceGroups: [],
  subsystems: [
    {
      subsystem: 'STC',
      defaultServiceClass: 'STCLO',
      defaultReportClass: null,
      rules: [
        rule('TN', 'JES2', 'SYSSTC'),
        rule('TN', 'VTAM', 'SYSSTC'),
        rule('TN', 'TCPIP', 'SYSSTC'),
        rule('TN', 'RRS', 'SYSSTC'),
        rule('TN', 'RMF*', 'SYSSTC'),
        rule('TN', '%%%%IRLM', 'SYSSTC'),
        rule('TN', 'DB*', 'STCHI'),
        rule('TN', 'CICS*', 'STCHI'),
        rule('TN', 'MQ*', 'STCHI'),
        rule('TN', 'MON*', 'STCMED'),
      ],
    },
    {
      subsystem: 'CICS',
      defaultServiceClass: 'ONLMED',
      defaultReportClass: null,
      rules: [rule('TN', 'MORD*', 'MKTORD'), rule('TN', 'AUTH*', 'ONLHI'), rule('TN', 'RB*', 'ONLHI'), rule('TN', 'PMQ*', 'ONLMED')],
    },
    {
      subsystem: 'DDF',
      defaultServiceClass: 'DDFPRD',
      defaultReportClass: null,
      rules: [rule('UI', 'MKTPRC*', 'MKTDDF')],
    },
    { subsystem: 'TSO', defaultServiceClass: 'TSO', defaultReportClass: null, rules: [] },
    {
      subsystem: 'JES',
      defaultServiceClass: 'BATCHPRD',
      defaultReportClass: null,
      rules: [rule('TC', 'D', 'DEVBAT'), rule('TN', 'SET*', 'BATCHHI'), rule('TN', 'CRD*', 'BATCHHI')],
    },
  ],
};
