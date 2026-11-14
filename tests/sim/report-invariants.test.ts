// Cross-report invariants (SPEC §16): every figure a player can read in the RMF interval reports, Partition Data,
// Monitor III, the SMF views and Finance must agree with the others and with the sim state it is measured from.
// One seeded headless run per scenario in the registry (tests/helpers/reportRun.ts), with stress phases derived
// from the scenario's own configuration, is shared by every identity (tests/helpers/reportIdentities.ts).
// No assertion names a scenario, LPAR, service class or workload: a scenario added to SCENARIOS is covered as is,
// and an identity whose feature a scenario lacks makes no comparison there. The last test fails if an identity
// was exercised by no scenario at all.
import { SCENARIOS } from '../../src/content/scenarios';
import { Check, IDENTITIES } from '../helpers/reportIdentities';
import { runReportScenario, type ReportRun } from '../helpers/reportRun';

const exercised: Record<string, string[]> = Object.fromEntries(IDENTITIES.map((i) => [i.id, []]));

describe.each(Object.keys(SCENARIOS))('report invariants: %s', (id) => {
  let run: ReportRun;
  beforeAll(() => {
    run = runReportScenario(SCENARIOS[id]!);
  }, 300_000);

  it.each(IDENTITIES.map((i) => [i.id, i.basis, i.title, i] as const))('%s [%s] %s', (_id, _basis, _title, identity) => {
    const c = new Check();
    identity.check(run, c);
    expect(c.failures).toEqual([]);
    if (c.n > 0) exercised[identity.id]!.push(id);
  });
});

describe('report invariants: coverage', () => {
  it('every identity is exercised by at least one scenario in the registry', () => {
    expect(Object.keys(exercised).filter((k) => exercised[k]!.length === 0)).toEqual([]);
  });

  it('identity ids are unique and each states its basis and source', () => {
    expect(new Set(IDENTITIES.map((i) => i.id)).size).toBe(IDENTITIES.length);
    for (const i of IDENTITIES) expect(i.source.length, i.id).toBeGreaterThan(0);
  });
});
