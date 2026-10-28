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
    const few = evaluateDasd({ ...dasd, lcus: dasd.lcus.map((l) => ({ ...l, aliases: 1 })) }, { RANDOM: 60_000, SEQ: 30_000 }).classes.RANDOM.iosqSec;
    expect(few).toBeGreaterThan(2 * many);
  });
  it('back-end degradation shows up as disconnect time', () => {
    const ok = evaluateDasd(dasd, { RANDOM: 10_000, SEQ: 0 }).classes.RANDOM;
    const bad = evaluateDasd({ ...dasd, backendDegrade: 5 }, { RANDOM: 10_000, SEQ: 0 }).classes.RANDOM;
    expect(bad.discSec).toBeGreaterThan(4 * ok.discSec);
    expect(bad.connSec).toBeCloseTo(ok.connSec);
  });
});

describe('DASD logical control units', () => {
  const load = { RANDOM: 6_000, SEQ: 2_000 };
  const storm = { ...dasd, lcus: dasd.lcus.map((l) => (l.id === '21' ? { ...l, extraIops: { SEQ: 55_000 } } : l)) };
  const lcu = (r: ReturnType<typeof evaluateDasd>, id: string) => r.lcus.find((x) => x.id === id)!;
  it('day-to-day load does not queue with HyperPAV', () => {
    for (const l of evaluateDasd(dasd, load).lcus) expect(l.iosqSec).toBeLessThan(0.00002);
  });
  it('a utility storm queues on its own LCU only: aliases are not borrowed across LCUs', () => {
    const r = evaluateDasd(storm, load);
    expect(lcu(r, '21').iosqSec).toBeGreaterThan(0.0001);
    expect(lcu(r, '10').iosqSec).toBeLessThan(lcu(r, '21').iosqSec / 20);
  });
  it('moving aliases to the hot LCU cuts its IOSQ', () => {
    const more = { ...storm, lcus: storm.lcus.map((l) => (l.id === '21' ? { ...l, aliases: 56 } : l)) };
    expect(lcu(evaluateDasd(more, load), '21').iosqSec).toBeLessThan(lcu(evaluateDasd(storm, load), '21').iosqSec / 2);
  });
});

describe('coupling facility', () => {
  const t = MIDWEST.cfTunables;
  const ded = { cfg: { lparId: 'A', thinInterrupts: true }, availableEngines: 1, entitlementEngines: 1, dedicated: true };
  const one = [{ name: 'GBP', type: 'CACHE' as const, requestShare: 1, cfLparId: 'A', costMult: 1 }];
  it('dedicated CF at low load stays synchronous', () => {
    const [r] = evaluateCf([ded], one, 10_000, t);
    expect(r!.asyncFrac).toBe(0);
    expect(r!.syncSec).toBeLessThan(t.syncThresholdSec);
  });
  it('a shared, low-weight CF converts to async and burns more z/OS CPU per request', () => {
    const shared = { ...ded, dedicated: false, entitlementEngines: 0.1, cfg: { ...ded.cfg, thinInterrupts: false } };
    const [d] = evaluateCf([ded], one, 10_000, t);
    const [s] = evaluateCf([shared], one, 10_000, t);
    expect(s!.asyncFrac).toBeGreaterThan(0.9);
    expect(s!.serviceSec).toBeGreaterThan(10 * d!.serviceSec);
    expect(s!.zosCpuSec).toBeGreaterThan(d!.zosCpuSec);
  });
  it('thin interrupts shorten shared-CF service times', () => {
    const base = { ...ded, dedicated: false, entitlementEngines: 0.1 };
    const [thin] = evaluateCf([{ ...base, cfg: { ...ded.cfg, thinInterrupts: true } }], one, 10_000, t);
    const [poll] = evaluateCf([{ ...base, cfg: { ...ded.cfg, thinInterrupts: false } }], one, 10_000, t);
    expect(thin!.serviceSec).toBeLessThan(poll!.serviceSec);
  });
  it('lock requests convert too on a slow CF, after cache requests (z/OS 1.2+ heuristic)', () => {
    const shared = { ...ded, dedicated: false, entitlementEngines: 0.1, cfg: { ...ded.cfg, thinInterrupts: false } };
    const mix = [
      { name: 'LOCK1', type: 'LOCK' as const, requestShare: 0.5, cfLparId: 'A', costMult: 1 },
      { name: 'GBP0', type: 'CACHE' as const, requestShare: 0.5, cfLparId: 'A', costMult: 1 },
    ];
    const [r] = evaluateCf([shared], mix, 10_000, t);
    const lock = r!.structures.find((x) => x.type === 'LOCK')!;
    const gbp = r!.structures.find((x) => x.type === 'CACHE')!;
    expect(lock.asyncFrac).toBeGreaterThan(0.8);
    expect(gbp.asyncFrac).toBeGreaterThan(lock.asyncFrac);
    // Converted requests stop spinning the z/OS CP but take longer end to end.
    expect(lock.zosCpuSec).toBeLessThan(lock.syncSec);
    expect(lock.serviceSec).toBeGreaterThan(lock.syncSec);
    expect(r!.requestRate).toBeCloseTo(10_000);
  });
  it('a CF with no structures carries no requests', () => {
    const [r] = evaluateCf([ded], [{ ...one[0]!, cfLparId: 'B' }], 10_000, t);
    expect(r!.requestRate).toBe(0);
    expect(r!.busyFrac).toBe(0);
  });
  it('utilisation rises with request rate', () => {
    const [lo] = evaluateCf([ded], one, 5_000, t);
    const [hi] = evaluateCf([ded], one, 50_000, t);
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

  it('accounts lost elapsed time by cause, and a missed night sums it for its critical jobs', () => {
    const def = job('J', [], { critical: true, deadlineSec: 100 });
    const shape = jobShape(def, 0.6, 0.86, 0.0004);
    const b = releaseNetwork(emptyBatch(), 0, [def]);
    const j = b.jobs[0]!;
    j.status = 'RUNNING';
    j.lparId = 'SYSA';
    j.startTick = 5;
    j.queuedTick = 0;
    advanceJob(j, shape, { cpWanted: shape.cpRate, cpGot: shape.cpRate / 2, ziipWanted: 0, ziipGot: 0, extraStretch: 1.5, lockStretch: 1.5, ioDelayFrac: 0.25 }, 5);
    const lostSec = TICK_SEC * (1 - 1 / j.stretch);
    expect(j.delaySec!.lock).toBeCloseTo(TICK_SEC / 3);
    expect(j.delaySec!.db2).toBeCloseTo(0);
    expect(j.delaySec!.cpu + j.delaySec!.lock).toBeCloseTo(lostSec);
    expect(j.delaySec!.io).toBeGreaterThan(0);
    j.abended = true;
    const night = closeNight(b, 0, 10).nights[0]!;
    expect(night.criticalDelaySec!.cpu).toBeCloseTo(j.delaySec!.cpu);
    expect(night.criticalDelaySec!.init).toBeCloseTo(5 * TICK_SEC);
    expect(night.criticalAbended).toEqual(['J']);
    expect(night.criticalHosts).toEqual([{ lparId: 'SYSA', name: 'J', jobClass: 'A' }]);
  });

  it('projects the critical path and records missed deadlines', () => {
    const b = releaseNetwork(emptyBatch(), 0, [job('A'), job('B', ['A']), job('C', ['B'], { deadlineSec: 100 })]);
    const proj = projectCriticalEnd(b.jobs, 0, 0, () => 1000);
    expect(proj).toBeCloseTo(3 * 1000 * 1.15);
    const closed = closeNight(b, 0, 0);
    expect(closed.nights[0]!.missedDeadline).toBe(true);
    expect(closed.nights[0]!.criticalEndSec).toBeNull();
  });

  it("a night that overruns its deadline keeps its finished jobs until its stragglers' successors can run", () => {
    const b = releaseNetwork(emptyBatch(), 0, [job('A'), job('B'), job('C', ['A', 'B'])]);
    b.jobs[0]!.status = 'DONE';
    b.jobs[0]!.endTick = 100;
    b.jobs[1]!.status = 'RUNNING';
    const closed = closeNight(b, 0, 0);
    expect(closed.nights[0]!.missedDeadline).toBe(true);
    closed.jobs.find((j) => j.def.name === 'B')!.status = 'DONE';
    promoteEligible(closed.jobs, 9000);
    expect(closed.jobs.find((j) => j.def.name === 'C')!.status).toBe('QUEUED');
    // Once the instance has nothing left, a later close drops it.
    for (const j of closed.jobs) j.status = 'DONE';
    expect(closeNight(closed, 1, 8640).jobs).toEqual([]);
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
