// Cross-report invariants (SPEC §16): every figure a player can read in the RMF interval reports, Partition Data,
// Monitor III, the SMF views and Finance must agree with the others and with the sim state it is measured from.
// One seeded headless run per scenario in the registry (tests/helpers/reportRun.ts), with stress phases derived
// from the scenario's own configuration, is shared by every identity (tests/helpers/reportIdentities.ts).
// No assertion names a scenario, LPAR, service class or workload: a scenario added to SCENARIOS is covered as is,
// and an identity whose feature a scenario lacks makes no comparison there. The last test fails if an identity
// was exercised by no scenario at all.
import { MIDWEST, SCENARIOS } from '../../src/content/scenarios';
import type { RmfInterval } from '../../src/sim/measure/rmf';
import { Check, CONDITIONS, IDENTITIES } from '../helpers/reportIdentities';
import { runReportScenario, type ReportRun } from '../helpers/reportRun';

const exercised: Record<string, string[]> = Object.fromEntries(IDENTITIES.map((i) => [i.id, []]));
const reached: Record<string, string[]> = Object.fromEntries(Object.keys(CONDITIONS).map((k) => [k, []]));

describe.each(Object.keys(SCENARIOS))('report invariants: %s', (id) => {
  let run: ReportRun;
  beforeAll(() => {
    run = runReportScenario(SCENARIOS[id]!);
  }, 300_000);

  it('reaches the situations its configuration allows', () => {
    for (const [name, test] of Object.entries(CONDITIONS)) if (test(run)) reached[name]!.push(id);
    // The run is one played day from 06:00, live to the end, with every command accepted.
    expect(run.final.phase).toBe('LIVE');
    expect(run.intervals.length).toBeGreaterThan(20);
  });

  it.each(IDENTITIES.map((i) => [i.id, i.basis, i.title, i] as const))('%s [%s] %s', (_id, _basis, _title, identity) => {
    const c = new Check();
    identity.check(run, c);
    // Recorded before the assertion: a failing identity was exercised, and must not also fail the coverage test.
    if (c.n > 0) exercised[identity.id]!.push(id);
    expect(c.failures).toEqual([]);
  });
});

describe('report invariants: coverage', () => {
  it('every identity is exercised by at least one scenario in the registry', () => {
    expect(Object.keys(exercised).filter((k) => exercised[k]!.length === 0)).toEqual([]);
  });

  it('every stress situation is reached by at least one scenario in the registry', () => {
    expect(Object.keys(reached).filter((k) => reached[k]!.length === 0)).toEqual([]);
  });

  it('identity ids are unique and each states its basis and source', () => {
    expect(new Set(IDENTITIES.map((i) => i.id)).size).toBe(IDENTITIES.length);
    for (const i of IDENTITIES) expect(i.source.length, i.id).toBeGreaterThan(0);
  });
});

// RF-12: a gatherer gap makes sampled rows shorter than the interval, so the cross-window CF sums cannot hold; the
// identity must skip them for that interval without going silent on the identities a sampled row still satisfies.
describe('CF Activity identity under a gatherer gap (RF-12)', () => {
  const identity = IDENTITIES.find((i) => i.id === 'cf-requests-add-up')!;
  const iv = (gatherer: Record<string, number>): RmfInterval => ({
    startTick: 0, endTick: 60, intervalSec: 600, policy: 'P', cpu: [], cpcBusy: [], wlm: [],
    dasd: { iops: 0, rtRandomMs: 0, rtSeqMs: 0, iosqMs: 0, pendMs: 0, discMs: 0, connMs: 0 }, lcus: [],
    // Deliberately inconsistent sums (60 vs 100): the identity must not reconcile them while a row is short.
    cf: [{ lparId: 'CF01', busyPct: 10, reqPerSec: 100, syncUs: 1, asyncPct: 0, serviceUs: 1 }],
    cfStructures: [{ name: 'DB1G_LOCK1', type: 'LOCK', cfLparId: 'CF01', reqPerSec: 100, syncPct: 90, syncUs: 1, serviceUs: 1 }],
    cfSystems: [{ system: 'PROD1', cfLparId: 'CF01', distKm: 10, reqPerSec: 60, syncUs: 1, asyncPct: 0, serviceUs: 1 }],
    cfStructSystems: [{ name: 'DB1G_LOCK1', type: 'LOCK', cfLparId: 'CF01', system: 'PROD1', reqPerSec: 60, syncPct: 90, syncUs: 1, asyncUs: 1 }],
    cfMaster: 'PROD1', cfGathererSec: gatherer, jobs: [],
  });
  const run = (interval: RmfInterval): ReportRun => ({
    intervals: [{ phase: 'test', iv: interval, config: MIDWEST.world, cfRequests: 6000, steady: true }],
  } as unknown as ReportRun);
  // The service identity needs the CF line and its structure/copy lines inconsistent, and the per-system row
  // consistent with its own structure lines (so the inner check has something to pass).
  const serviceIv = (gatherer: Record<string, number>): RmfInterval => {
    const base = iv(gatherer);
    return {
      ...base,
      cf: [{ ...base.cf[0]!, syncUs: 99, serviceUs: 99, asyncPct: 10 }],
      cfSystems: [{ ...base.cfSystems![0]!, syncUs: 1, asyncPct: 10, serviceUs: 1 }],
      cfStructSystems: [{ ...base.cfStructSystems![0]!, syncPct: 90, syncUs: 1, asyncUs: 1 }],
    };
  };

  it('skips the cross-window sums when a CF system sampled short, keeping the inner identity', () => {
    const c = new Check();
    identity.check(run(iv({ PROD1: 300 })), c);
    expect(c.failures).toEqual([]);
    expect(c.n).toBeGreaterThan(0);
  });

  it('checks them again when every CF system sampled the whole interval', () => {
    const c = new Check();
    identity.check(run(iv({ PROD1: 600 })), c);
    expect(c.failures.length).toBeGreaterThan(0);
  });

  it('does not skip for a stopped gatherer on a system with no CF rows', () => {
    const c = new Check();
    identity.check(run(iv({ PROD1: 600, TSOONLY: 300 })), c);
    expect(c.failures.length).toBeGreaterThan(0);
  });

  it('skips when a CF-bearing system was down for the whole interval and left no row', () => {
    const c = new Check();
    identity.check(run(iv({ PROD1: 600, PROD2: 0 })), c);
    expect(c.failures).toEqual([]);
    expect(c.n).toBeGreaterThan(0);
  });

  it('checks an interval closed before RF-12, which carries no gatherer data', () => {
    const { cfMaster: _master, cfGathererSec: _sec, ...legacy } = iv({});
    const c = new Check();
    identity.check(run(legacy as RmfInterval), c);
    expect(c.failures.length).toBeGreaterThan(0);
  });

  it('checks a gap interval with the sampled-time identity', () => {
    const gap = IDENTITIES.find((i) => i.id === 'cf-gap-consistency')!;
    const ok = new Check();
    gap.check(run(iv({ PROD1: 300 })), ok);
    expect(ok.failures).toEqual([]);
    expect(ok.n).toBeGreaterThan(0);
    // A row without sampled time, and a master without samples, are contradictions.
    const rowless = new Check();
    gap.check(run(iv({ PROD1: 0 })), rowless);
    expect(rowless.failures.length).toBeGreaterThan(0);
    const masterless = new Check();
    gap.check(run(iv({ PROD1: 0, PROD2: 600 })), masterless);
    expect(masterless.failures.length).toBeGreaterThan(0);
  });

  it('applies the same gap rule to the CF service-time identity', () => {
    const service = IDENTITIES.find((i) => i.id === 'cf-service-times')!;
    const gap = new Check();
    service.check(run(serviceIv({ PROD1: 300 })), gap);
    expect(gap.failures).toEqual([]);
    expect(gap.n).toBeGreaterThan(0);
    const whole = new Check();
    service.check(run(serviceIv({ PROD1: 600 })), whole);
    expect(whole.failures.length).toBeGreaterThan(0);
  });
});
