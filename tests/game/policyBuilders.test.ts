import { BASEPOL } from '../../src/content/wlm/basepol';
import { avg, disc, pct, rule, sc, vel } from '../../src/content/wlm/policyBuilders';

// CL-26: the shipped policies build their classes and rules through one set of builders.
describe('WLM policy builders', () => {
  it('builds a period for each goal kind', () => {
    expect(vel(60, 1, 500)).toEqual({ goal: { kind: 'VEL', velocity: 60 }, importance: 1, durationSu: 500 });
    expect(pct(95, 0.25, 1)).toEqual({ goal: { kind: 'PCT', pct: 95, rtSec: 0.25 }, importance: 1, durationSu: null });
    expect(avg(0.5, 2, 400)).toEqual({ goal: { kind: 'AVG', rtSec: 0.5 }, importance: 2, durationSu: 400 });
    expect(disc()).toEqual({ goal: { kind: 'DISC' }, importance: 5, durationSu: null });
  });

  it('overrides service-class defaults only when asked', () => {
    const plain = sc('TSO', 'TSO users', [avg(0.5, 2)]);
    expect(plain).toEqual({ id: 'TSO', description: 'TSO users', periods: [avg(0.5, 2)], cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
    // An override reaches the built class and leaves the identity and periods as the arguments set them.
    const capped = sc('TSO', 'TSO users', [avg(0.5, 2)], { cpuCritical: true, resourceGroup: 'RG1' });
    expect(capped).toEqual({ id: 'TSO', description: 'TSO users', periods: [avg(0.5, 2)], cpuCritical: true, storageCritical: false, resourceGroup: 'RG1', honorPriority: true });
  });

  it('builds a rule with no report class and no children by default', () => {
    expect(rule('TN', 'CICS*', 'STCHI')).toEqual({ qualifier: 'TN', pattern: 'CICS*', serviceClass: 'STCHI', reportClass: null, children: [] });
  });

  // A structural pin of the shipped Midwest policy: it catches a lost class, rule or default flag without copying
  // every balance number (those are pinned by the goldens; deliberate balance edits should keep this shape).
  it('builds BASEPOL from the shared builders with its intended shape', () => {
    expect(BASEPOL.classes).toHaveLength(10);
    expect(new Set(BASEPOL.classes.map((c) => c.periods[0]!.goal.kind))).toEqual(new Set(['VEL', 'PCT', 'AVG', 'DISC']));
    expect(BASEPOL.classes.find((c) => c.id === 'DDFPRD')!.periods).toHaveLength(2);
    for (const c of BASEPOL.classes) expect(c).toMatchObject({ cpuCritical: false, storageCritical: false, resourceGroup: null, honorPriority: true });
    expect(BASEPOL.reportClasses).toEqual([]); // F6
    expect(BASEPOL.resourceGroups).toEqual([]);
    expect(BASEPOL.subsystems.map((s) => [s.subsystem, s.defaultServiceClass, s.defaultReportClass, s.rules.length])).toEqual([
      ['STC', 'STCLO', null, 10],
      ['CICS', 'ONLMED', null, 4],
      ['DDF', 'DDFPRD', null, 0],
      ['TSO', 'TSO', null, 0],
      ['JES', 'BATCHPRD', null, 1],
    ]);
    expect(BASEPOL.subsystems.flatMap((s) => s.rules)).toContainEqual(rule('TC', 'D', 'DEVBAT'));
  });
});
