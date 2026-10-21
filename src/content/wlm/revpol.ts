// Starting WLM service definition for the State Revenue Agency. Flaws G1–G3 are deliberate (see the
// scenario notes in SPEC §13.4).

import type { ClassificationRule, PeriodDef, ServiceClassDef, ServiceDefinition } from '../../sim/wlm/types';

const vel = (velocity: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'VEL', velocity }, importance, durationSu });
const pct = (p: number, rtSec: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'PCT', pct: p, rtSec }, importance, durationSu });
const avg = (rtSec: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'AVG', rtSec }, importance, durationSu });
const disc = (): PeriodDef => ({ goal: { kind: 'DISC' }, importance: 5, durationSu: null });
const sc = (id: string, description: string, periods: PeriodDef[]): ServiceClassDef => ({ id, description, periods, cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
const rule = (qualifier: ClassificationRule['qualifier'], pattern: string, serviceClass: string | null): ClassificationRule => ({ qualifier, pattern, serviceClass, reportClass: null, children: [] });

export const REVPOL: ServiceDefinition = {
  policyName: 'REVPOL',
  classes: [
    sc('STCHI', 'High STCs: CICS regions, Db2', [vel(60, 1)]),
    sc('STCMED', 'Medium STCs: monitors', [vel(40, 3)]),
    // G3: no rule covers the MQ queue managers, so MSTR/CHIN default to the lowest STC class.
    sc('STCLO', 'Low STCs', [vel(20, 5)]),
    sc('ONLINE', 'Taxpayer online: account, refund status', [pct(95, 0.3, 1)]),
    sc('AGENTS', 'Call centre and employer services', [pct(90, 0.5, 2)]),
    // G1: e-filing has a velocity goal, at importance 4, in one class with the compliance analysts' queries.
    sc('WEBDDF', 'All DDF: web filing and analytics', [vel(40, 4)]),
    // G2: the compliance analytics batch is "high" because an auditor once asked for it by 07:00.
    sc('BATCHHI', 'High batch', [vel(50, 3)]),
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
        rule('TN', '*IRLM', 'SYSSTC'),
        rule('TN', 'DB*', 'STCHI'),
        rule('TN', 'CICS*', 'STCHI'),
        rule('TN', 'MON*', 'STCMED'),
      ],
    },
    {
      subsystem: 'CICS',
      defaultServiceClass: 'AGENTS',
      defaultReportClass: null,
      rules: [rule('TN', 'TXAC*', 'ONLINE'), rule('TN', 'RFST*', 'ONLINE'), rule('TN', 'CC*', 'AGENTS'), rule('TN', 'EWH*', 'AGENTS')],
    },
    { subsystem: 'DDF', defaultServiceClass: 'WEBDDF', defaultReportClass: null, rules: [] },
    { subsystem: 'TSO', defaultServiceClass: 'TSO', defaultReportClass: null, rules: [] },
    {
      subsystem: 'JES',
      defaultServiceClass: 'BATCHPRD',
      defaultReportClass: null,
      rules: [rule('TC', 'D', 'DEVBAT'), rule('TN', 'CMP*', 'BATCHHI')],
    },
  ],
};
