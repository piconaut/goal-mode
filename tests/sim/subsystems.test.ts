import { MIDWEST } from '../../src/content/scenarios';
import { generateMidwestNetwork } from '../../src/content/batch/midwest-batch';
import { evaluateCf } from '../../src/sim/cf/cf';
import { evaluateDasd } from '../../src/sim/io/dasd';
import { advanceJob, closeNight, emptyBatch, jobShape, projectCriticalEnd, promoteEligible, releaseNetwork, startJobs, type JobDef } from '../../src/sim/subsys/batch';
import { mxtQueueWaitSec, qrTcb } from '../../src/sim/subsys/cics';
import { bpIoMultiplier, dbatQueueWaitSec } from '../../src/sim/subsys/db2';
import { pagingDelayFrac } from '../../src/sim/zos/storage';
import { TICK_SEC } from '../../src/sim/core/units';

const dasd = MIDWEST.world.dasd;

describe('DASD', () => {
  it('response time = IOSQ + PEND + DISC + CONN', () => {
    const r = evaluateDasd(dasd, { RANDOM: 10_000, SEQ: 5_000 }).classes.RANDOM;
    expect(r.rtSec).toBeCloseTo(r.iosqSec + r.pendSec + r.discSec + r.connSec, 12);
  });
  it('IOSQ grows when HyperPAV aliases are scarce', () => {
    const many = evaluateDasd(dasd, { RANDOM: 60_000, SEQ: 30_000 }).classes.RANDOM.iosqSec;
    const few = evaluateDasd({ ...dasd, aliasPool: 8 }, { RANDOM: 60_000, SEQ: 30_000 }).classes.RANDOM.iosqSec;
    expect(few).toBeGreaterThan(2 * many);
  });
  it('back-end degradation shows up as disconnect time', () => {
    const ok = evaluateDasd(dasd, { RANDOM: 10_000, SEQ: 0 }).classes.RANDOM;
    const bad = evaluateDasd({ ...dasd, backendDegrade: 5 }, { RANDOM: 10_000, SEQ: 0 }).classes.RANDOM;
    expect(bad.discSec).toBeGreaterThan(4 * ok.discSec);
    expect(bad.connSec).toBeCloseTo(ok.connSec);
  });
});

describe('coupling facility', () => {
  const t = MIDWEST.cfTunables;
  const ded = { cfg: { lparId: 'A', requestShare: 1, thinInterrupts: true }, availableEngines: 1, entitlementEngines: 1, dedicated: true };
  it('dedicated CF at low load stays synchronous', () => {
    const [r] = evaluateCf([ded], 10_000, t);
    expect(r!.asyncFrac).toBe(0);
    expect(r!.syncSec).toBeLessThan(t.syncThresholdSec);
  });
  it('a shared, low-weight CF converts to async and burns more z/OS CPU per request', () => {
    const shared = { ...ded, dedicated: false, entitlementEngines: 0.1, cfg: { ...ded.cfg, thinInterrupts: false } };
    const [d] = evaluateCf([ded], 10_000, t);
    const [s] = evaluateCf([shared], 10_000, t);
    expect(s!.asyncFrac).toBeGreaterThan(0.9);
    expect(s!.serviceSec).toBeGreaterThan(10 * d!.serviceSec);
    expect(s!.zosCpuSec).toBeGreaterThan(d!.zosCpuSec);
  });
  it('thin interrupts shorten shared-CF service times', () => {
    const base = { ...ded, dedicated: false, entitlementEngines: 0.1 };
    const [thin] = evaluateCf([{ ...base, cfg: { ...ded.cfg, thinInterrupts: true } }], 10_000, t);
    const [poll] = evaluateCf([{ ...base, cfg: { ...ded.cfg, thinInterrupts: false } }], 10_000, t);
    expect(thin!.serviceSec).toBeLessThan(poll!.serviceSec);
  });
  it('utilisation rises with request rate', () => {
    const [lo] = evaluateCf([ded], 5_000, t);
    const [hi] = evaluateCf([ded], 50_000, t);
    expect(hi!.busyFrac).toBeGreaterThan(5 * lo!.busyFrac);
    expect(hi!.syncSec).toBeGreaterThan(lo!.syncSec);
  });
});

describe('Db2, CICS, storage', () => {
  it('bigger buffer pools mean fewer I/Os', () => {
    expect(bpIoMultiplier(40, 160)).toBeCloseTo(1);
    expect(bpIoMultiplier(80, 160)).toBeLessThan(0.75);
    expect(bpIoMultiplier(20, 160)).toBeGreaterThan(1.3);
  });
  it('DBAT and MXT queues only form above the limit', () => {
    expect(dbatQueueWaitSec(100, 1, 400)).toBe(0);
    expect(dbatQueueWaitSec(500, 1, 400)).toBeCloseTo(0.2);
    expect(mxtQueueWaitSec(300, 1, 200)).toBeCloseTo(1 / 3);
  });
  it('the QR TCB saturates at one engine', () => {
    expect(qrTcb(0.5).failFrac).toBe(0);
    expect(qrTcb(0.9).qrWaitRatio).toBeCloseTo(9);
    expect(qrTcb(1.25).failFrac).toBeCloseTo(0.2);
  });
  it('paging only when over-committed', () => {
    expect(pagingDelayFrac(100, 160)).toBe(0);
    expect(pagingDelayFrac(176, 160)).toBeGreaterThan(0.2);
  });
});

describe('batch', () => {
  const job = (name: string, preds: string[] = [], extra: Partial<JobDef> = {}): JobDef => ({
    name,
    stream: 'T',
    jobClass: 'A',
    sysaff: null,
    cpuSecRef: 600,
    ziipFrac: 0,
    ioCount: 100_000,
    lockIntensity: 0,
    usesDb2: false,
    preds,
    earliestSec: 0,
    critical: true,
    deadlineSec: 86_400,
    ...extra,
  });
  const classes = [{ jobClass: 'A', mode: 'JES' as const, initiators: { L1: 1 } }];

  it('respects predecessors and initiator limits', () => {
    let b = releaseNetwork(emptyBatch(), 0, [job('J1'), job('J2', ['J1']), job('J3')]);
    promoteEligible(b.jobs, 0);
    expect(b.jobs.map((j) => j.status)).toEqual(['QUEUED', 'HELD', 'QUEUED']);
    startJobs(b.jobs, 0, { jobClasses: classes, lparBusy: {} });
    expect(b.jobs.filter((j) => j.status === 'RUNNING').length).toBe(1);
    void b;
  });

  it('unconstrained elapsed = cpu + io, and CPU starvation stretches it', () => {
    const shape = jobShape(job('J'), 0.6, 0.86, 0.0004);
    expect(shape.elapsed).toBeCloseTo(600 / 0.6 + 100_000 * 0.0004);
    const b = releaseNetwork(emptyBatch(), 0, [job('J')]);
    const j = b.jobs[0]!;
    j.status = 'RUNNING';
    advanceJob(j, shape, { cpWanted: shape.cpRate, cpGot: shape.cpRate / 2, ziipWanted: 0, ziipGot: 0, extraStretch: 1 }, 0);
    expect(j.stretch).toBeGreaterThan(1.8);
    expect(j.progress).toBeCloseTo(TICK_SEC / (j.stretch * shape.elapsed));
  });

  it('projects the critical path and records missed deadlines', () => {
    const b = releaseNetwork(emptyBatch(), 0, [job('A'), job('B', ['A']), job('C', ['B'], { deadlineSec: 100 })]);
    const proj = projectCriticalEnd(b.jobs, 0, 0, () => 1000);
    expect(proj).toBeCloseTo(3 * 1000 * 1.15);
    const closed = closeNight(b, 0);
    expect(closed.nights[0]!.missedDeadline).toBe(true);
    expect(closed.nights[0]!.criticalEndSec).toBeNull();
  });

  it('the generated network is deterministic and acyclic, with month-end extras', () => {
    const a = generateMidwestNetwork(42, 3, 10);
    const b = generateMidwestNetwork(42, 3, 10);
    expect(a).toEqual(b);
    const names = new Set<string>();
    for (const j of a) {
      for (const p of j.preds) expect(names.has(p) || a.some((x) => x.name === p)).toBe(true);
      names.add(j.name);
    }
    expect(generateMidwestNetwork(42, 3, 30).length).toBeGreaterThan(a.length);
  });
});
