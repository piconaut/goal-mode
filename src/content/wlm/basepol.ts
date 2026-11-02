// Starting WLM service definition for Midwest Mutual (SPEC §13.1). Flaws F1–F6 are deliberate.

import type { ClassificationRule, PeriodDef, ServiceClassDef, ServiceDefinition } from '../../sim/wlm/types';

const vel = (velocity: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({
  goal: { kind: 'VEL', velocity },
  importance,
  durationSu,
});
const pct = (p: number, rtSec: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({
  goal: { kind: 'PCT', pct: p, rtSec },
  importance,
  durationSu,
});
const avg = (rtSec: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({
  goal: { kind: 'AVG', rtSec },
  importance,
  durationSu,
});
const disc = (): PeriodDef => ({ goal: { kind: 'DISC' }, importance: 5, durationSu: null });

const sc = (id: string, description: string, periods: PeriodDef[], extra: Partial<ServiceClassDef> = {}): ServiceClassDef => ({
  id,
  description,
  periods,
  cpuCritical: false,
  storageCritical: false,
  resourceGroup: null,
  honorPriority: true,
  ...extra,
});

const rule = (
  qualifier: ClassificationRule['qualifier'],
  pattern: string,
  serviceClass: string | null,
  reportClass: string | null = null,
  children: ClassificationRule[] = [],
): ClassificationRule => ({ qualifier, pattern, serviceClass, reportClass, children });

export const BASEPOL: ServiceDefinition = {
  policyName: 'BASEPOL',
  classes: [
    sc('STCHI', 'High STCs: CICS regions, MQ', [vel(60, 1)]),
    // F1: Db2 MSTR/DBM1/DIST below the work they serve.
    sc('STCMED', 'Medium STCs: Db2, monitors', [vel(40, 3)]),
    sc('STCLO', 'Low STCs', [vel(20, 5)]),
    // F2: cards (99%/100 ms SLA) share a class with retail.
    sc('ONLHI', 'High online: retail + cards', [pct(95, 0.25, 1)]),
    sc('ONLMED', 'Medium online: teller, payments', [pct(90, 0.5, 2)]),
    // F3: ad-hoc BI queries share the class with mobile.
    sc('DDFPRD', 'All DDF work', [pct(90, 0.5, 2, 2000), vel(30, 4)]),
    // F4: one batch class for critical and non-critical jobs.
    sc('BATCHPRD', 'Production batch', [vel(30, 4)]),
    sc('BATCHHI', 'Critical batch (unused)', [vel(50, 3)]),
    // F5: developers at importance 2.
    sc('TSO', 'TSO users', [avg(0.5, 2, 400), vel(20, 4)]),
    sc('DEVBAT', 'Development batch', [disc()]),
  ],
  reportClasses: [], // F6: no report classes
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
        rule('TN', 'DB*', 'STCMED'),
        rule('TN', 'CICS*', 'STCHI'),
        rule('TN', 'MQ*', 'STCHI'),
        rule('TN', 'MON*', 'STCMED'),
      ],
    },
    {
      subsystem: 'CICS',
      defaultServiceClass: 'ONLMED',
      defaultReportClass: null,
      rules: [rule('TN', 'AUTH*', 'ONLHI'), rule('TN', 'RB*', 'ONLHI'), rule('TN', 'TL*', 'ONLMED'), rule('TN', 'PM*', 'ONLMED')],
    },
    { subsystem: 'DDF', defaultServiceClass: 'DDFPRD', defaultReportClass: null, rules: [] },
    { subsystem: 'TSO', defaultServiceClass: 'TSO', defaultReportClass: null, rules: [] },
    {
      subsystem: 'JES',
      defaultServiceClass: 'BATCHPRD',
      defaultReportClass: null,
      rules: [rule('TC', 'D', 'DEVBAT')],
    },
  ],
};
