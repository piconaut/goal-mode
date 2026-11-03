import type { ClassificationRule, PeriodDef, ServiceClassDef } from '../../sim/wlm/types';

export const vel = (velocity: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'VEL', velocity }, importance, durationSu });
export const pct = (p: number, rtSec: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'PCT', pct: p, rtSec }, importance, durationSu });
export const avg = (rtSec: number, importance: 1 | 2 | 3 | 4 | 5, durationSu: number | null = null): PeriodDef => ({ goal: { kind: 'AVG', rtSec }, importance, durationSu });
export const disc = (): PeriodDef => ({ goal: { kind: 'DISC' }, importance: 5, durationSu: null });
export const sc = (id: string, description: string, periods: PeriodDef[]): ServiceClassDef => ({ id, description, periods, cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
export const rule = (qualifier: ClassificationRule['qualifier'], pattern: string, serviceClass: string | null): ClassificationRule => ({ qualifier, pattern, serviceClass, reportClass: null, children: [] });

