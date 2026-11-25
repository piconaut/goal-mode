// Problem records (RT-22): a diagnosis on a subject and a window for cards, standing faults and quiet hours that
// never page, with the same truth, proof, reward and anti-fishing limits as an incident RCA.

import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { cardMechanisms } from '../../src/content/footprint';
import { PROBLEM } from '../../src/content/rca';
import { advance, newRun, startDay, submitRca } from '../../src/game/run';
import { creditedEpisode, episodeOf } from '../../src/game/run/rca';
import { sameEpisode } from '../../src/game/run/grouping';
import { closeHour, newHour } from '../../src/game/run/hourly';
import { applyCommands } from '../../src/sim/core/commands';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import type { RmfInterval } from '../../src/sim/measure/rmf';
import {
  fileProblemDiagnosis,
  openProblemRecord,
  problemHours,
  problemWindowOf,
  problemsView,
  subjectWorkloads,
} from '../../src/game/problems';
import type { HourAcc, Incident, Mechanism, ProblemSubject, QuietHour, RunState, Trigger } from '../../src/game/types';
import { truthOf, EMPTY_SUBJECTS } from '../helpers/truth';

const content = { ...MIDWEST_GAME, events: [] };
const H = TICKS_PER_HOUR;

/** A run with two closed hours (D1 06:00 and 07:00) and no facts or incidents. */
function quiet(over: Partial<RunState> = {}): RunState {
  const base = newRun(MIDWEST, content, 7);
  return {
    ...base,
    sim: { ...base.sim, tick: 2 * H },
    smfHours: [
      { day: 0, hourOfDay: 6, workloads: {} },
      { day: 0, hourOfDay: 7, workloads: {} },
    ],
    ...over,
  };
}

const fact = (workloadId: string, truth: ReturnType<typeof truthOf>, over: Partial<QuietHour> = {}): QuietHour => ({
  day: 0,
  hourOfDay: 6,
  startTick: 0,
  endTick: H,
  workloadId,
  reason: 'CARD',
  truth,
  subjects: EMPTY_SUBJECTS,
 
  ...over,
});

const incident = (id: number, workloadId: string, truth: ReturnType<typeof truthOf>, over: Partial<Incident> = {}): Incident => ({
  id,
  workloadId,
  day: 0,
  startTick: 0,
  endTick: null,
  hours: 1,
  worstAttainmentPct: 80,
  truth,
  subjects: EMPTY_SUBJECTS,
  rca: null,
  trustLost: 0,
  ...over,
});

const open = (run: RunState, subject: ProblemSubject, fromTick = 0, toTick = H) => openProblemRecord(run, content, MIDWEST, subject, fromTick, toTick);
const file = (run: RunState, id: number, mechanism: Mechanism, trigger: Trigger, evidenceIds: number[] = []) => fileProblemDiagnosis(run, content, MIDWEST, id, mechanism, trigger, evidenceIds);

describe('problem records (RT-22)', () => {
  it('opens on a card without an incident and scores the answer once', () => {
    const truth = truthOf('CPU_PRIORITY', 'CHANGE_REGRESSION', { cause: 'REGRESSION@0' });
    const run = quiet({ quietHours: [fact('RBANK', truth)] });
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    expect(out.ok, out.message).toBe(true);
    expect(out.record!.truth).toMatchObject({ mechanism: 'CPU_PRIORITY', trigger: 'CHANGE_REGRESSION', cause: 'REGRESSION@0' });
    const filed = file(out.run, out.record!.id, 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(filed.ok, filed.message).toBe(true);
    expect(filed.filing!.points).toBe(5);
    expect(filed.filing!.trust).toBe(1);
    expect(filed.filing!.trustFacet).toBe('Retail');
    expect(filed.run.insight - out.run.insight).toBe(5);
    expect(filed.run.score - out.run.score).toBe(5);
    expect(creditedEpisode(filed.run, { cause: 'REGRESSION@0', day: 0, startTick: 0, endTick: H })).toBe(out.record!.id);
    // The next day is a new episode of the same cause and is still open for payment.
    expect(creditedEpisode(filed.run, { cause: 'REGRESSION@0', day: 1, startTick: TICKS_PER_DAY, endTick: TICKS_PER_DAY + H })).toBeNull();
    expect(filed.filing!.reply.join('\n')).toContain('Mechanism CPU_PRIORITY accepted');
    // A second record on the same subject and window would reset the anti-fishing limits; it is refused.
    const again = open(out.run, { kind: 'WORKLOAD', id: 'RBANK' });
    expect(again.ok).toBe(false);
    expect(again.message).toContain('already covers');
  });

  it('records a real card that met its SLA as a quiet hour, and a record can name it', () => {
    const def = MIDWEST_GAME.events.find((e) => e.id === 'REGRESSION')!;
    let run = startDay(newRun(MIDWEST, content, 7), content);
    run = {
      ...run,
      sim: applyCommands(run.sim, def.begin),
      events: [{
        uid: 'REGRESSION@0', defId: def.id, name: def.name, startTick: 0, endTick: null, trigger: def.trigger,
        affects: def.affects, mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false,
      }],
    };
    run = advance(run, MIDWEST, content, 4 * H);
    expect(run.incidents.some((i) => i.workloadId === 'RBANK')).toBe(false);
    const facts = (run.quietHours ?? []).filter((f) => f.workloadId === 'RBANK');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]!.truth.cause).toBe('REGRESSION@0');
    const first = facts[0]!;
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' }, first.startTick, first.endTick);
    expect(out.ok, out.message).toBe(true);
    expect(out.record!.truth.cause).toBe('REGRESSION@0');
    expect(out.record!.truth.accepted.mechanisms).toContain('CPU_PRIORITY');
    const filed = file(out.run, out.record!.id, 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(filed.ok, filed.message).toBe(true);
    expect(filed.filing!.points).toBe(5);
  }, 120_000);

  it('opens on an ABENDed batch job that opened no incident', () => {
    let run = startDay(newRun(MIDWEST, content, 7), content);
    run = advance(run, MIDWEST, content, 20 * 360);
    const j = run.sim.batch.jobs[0];
    expect(j).toBeDefined();
    const failed = {
      ...j!,
      status: 'ABENDED' as const,
      abended: true,
      failCode: 'S0C7',
      startTick: 18 * 360,
      endTick: 19 * 360,
    };
    run = { ...run, sim: { ...run.sim, batch: { ...run.sim.batch, jobs: [failed] } } };
    const out = open(run, { kind: 'JOB', id: failed.def.name }, 18 * H, 20 * H);
    expect(out.ok, out.message).toBe(true);
    expect(out.record!.truth).toMatchObject({ mechanism: 'JOB_FAILURE', trigger: 'APPLICATION_ERROR' });
    const filed = file(out.run, out.record!.id, 'JOB_FAILURE', 'APPLICATION_ERROR');
    expect(filed.ok, filed.message).toBe(true);
    expect(filed.filing!.points).toBe(5);
  }, 120_000);

  it('accepts a standing CF fault from a quiet hour, and every accepted answer', () => {
    const truth = truthOf('CF_SERVICE', 'POLICY', {
      accepted: { mechanisms: ['CF_SERVICE', 'IO'], triggers: ['POLICY', 'HARDWARE_FAULT'] },
      cause: 'none:CF_SERVICE:CF02',
    });
    const run = quiet({ quietHours: [fact('RBANK', truth, { reason: 'PEER' })] });
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    expect(out.ok, out.message).toBe(true);
    expect(out.record!.truth.accepted.mechanisms).toEqual(['CF_SERVICE', 'IO']);
    const cf = file(out.run, out.record!.id, 'CF_SERVICE', 'HARDWARE_FAULT');
    expect(cf.filing!.points).toBe(5);
    // A second record on the same hour accepts the co-dominant I/O reading too.
    const again = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    const io = file(again.run, again.record!.id, 'IO', 'POLICY');
    expect(io.filing!.points).toBe(5);
  });

  it('calls a clean window no problem and charges a wholly wrong filing', () => {
    const out = open(quiet(), { kind: 'WORKLOAD', id: 'RBANK' });
    expect(out.ok, out.message).toBe(true);
    expect(out.record!.truth.mechanism).toBeNull();
    expect(out.record!.candidates).toHaveLength(0);
    const filed = file(out.run, out.record!.id, 'CPU_PRIORITY', 'POLICY');
    expect(filed.ok, filed.message).toBe(true);
    expect(filed.filing!.points).toBe(0);
    expect(filed.filing!.noProblem).toBe(true);
    expect(filed.filing!.trust).toBe(-PROBLEM.wrongTrust);
    expect(filed.filing!.reply.join('\n')).toContain('shows no problem');
  });

  it('prices a filing, allows one an hour and three a day, and takes the wrong-answer trust once a day', () => {
    const truth = truthOf('CPU_PRIORITY', 'POLICY', { accepted: { mechanisms: ['CPU_PRIORITY'], triggers: ['POLICY', 'GROWTH'] } });
    const run = quiet({ quietHours: [fact('RBANK', truth)] });
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    const first = file(out.run, out.record!.id, 'LOCK_CONTENTION', 'DEMAND_SURGE');
    expect(first.ok, first.message).toBe(true);
    expect(first.run.hoursLeft).toBeCloseTo(out.run.hoursLeft - PROBLEM.hours);
    expect(first.filing!.trust).toBe(-PROBLEM.wrongTrust);
    // The same record cannot be filed again within the hour.
    expect(file(first.run, out.record!.id, 'LOCK_CONTENTION', 'DEMAND_SURGE').ok).toBe(false);
    // An hour later the same wholly wrong answer costs no second trust loss.
    const later = { ...first.run, sim: { ...first.run.sim, tick: first.run.sim.tick + H } };
    const second = file(later, out.record!.id, 'LOCK_CONTENTION', 'DEMAND_SURGE');
    expect(second.ok, second.message).toBe(true);
    expect(second.filing!.trust).toBe(0);
    // The third is allowed; the fourth is not.
    const thirdTick = { ...second.run, sim: { ...second.run.sim, tick: second.run.sim.tick + H } };
    const third = file(thirdTick, out.record!.id, 'LOCK_CONTENTION', 'DEMAND_SURGE');
    expect(third.ok, third.message).toBe(true);
    const fourthTick = { ...third.run, sim: { ...third.run.sim, tick: third.run.sim.tick + H } };
    const fourth = file(fourthTick, out.record!.id, 'LOCK_CONTENTION', 'DEMAND_SURGE');
    expect(fourth.ok).toBe(false);
    expect(fourth.message).toContain('3 filings today');
    // A new played day resets the count.
    const nextDay = { ...fourthTick, day: 1, sim: { ...fourthTick.sim, tick: fourthTick.sim.tick + TICKS_PER_DAY }, hoursLeft: 8 };
    expect(file(nextDay, out.record!.id, 'LOCK_CONTENTION', 'DEMAND_SURGE').ok).toBe(true);
  });

  it('records a card on a no-SLA workload (TSO) and a record can name it', () => {
    const def = MIDWEST_GAME.events.find((e) => e.id === 'SHADOW_IT')!;
    let run = startDay(newRun(MIDWEST, content, 7), content);
    run = {
      ...run,
      sim: applyCommands(run.sim, def.begin),
      events: [{
        uid: 'SHADOW_IT@0', defId: def.id, name: def.name, startTick: 0, endTick: null, trigger: def.trigger,
        affects: def.affects, reach: ['DEVT', 'PROD1', 'PROD2'], mechanisms: cardMechanisms(def) ?? [], endCommands: def.end, started: true, ended: false,
      }],
    };
    run = advance(run, MIDWEST, content, 6 * H);
    const facts = (run.quietHours ?? []).filter((f) => f.workloadId === 'TSO');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]!.reason).toBe('CARD');
    expect(facts[0]!.truth.cause).toBe('SHADOW_IT@0');
    const first = facts[0]!;
    const out = open(run, { kind: 'WORKLOAD', id: 'TSO' }, first.startTick, first.endTick);
    expect(out.ok, out.message).toBe(true);
    expect(out.record!.truth.cause).toBe('SHADOW_IT@0');
    const filed = file(out.run, out.record!.id, 'CPU_PRIORITY', 'NEW_WORKLOAD');
    expect(filed.ok, filed.message).toBe(true);
    expect(filed.filing!.points).toBe(5);
  }, 120_000);

  it('opens on the later ABEND when an older instance of the same job failed', () => {
    let template = startDay(newRun(MIDWEST, content, 7), content);
    template = advance(template, MIDWEST, content, 20 * 360);
    const def = template.sim.batch.jobs[0]!.def;
    const job = (day: number, failTick: number) => ({
      ...template.sim.batch.jobs[0]!,
      day,
      def,
      status: 'ABENDED' as const,
      abended: true,
      failCode: 'S0C7',
      failTick,
      startTick: failTick - 60,
      endTick: failTick,
    });
    const run: RunState = {
      ...template,
      sim: { ...template.sim, tick: 38 * H, batch: { ...template.sim.batch, jobs: [job(0, H), job(1, 37 * H)] } },
      smfHours: [
        { day: 1, hourOfDay: 0, workloads: {} },
        { day: 1, hourOfDay: 1, workloads: {} },
      ],
      quietHours: undefined,
      problemRecords: undefined,
    };
    const out = open(run, { kind: 'JOB', id: def.name }, 37 * H, 38 * H);
    expect(out.ok, out.message).toBe(true);
    expect(out.record!.truth).toMatchObject({ mechanism: 'JOB_FAILURE', trigger: 'APPLICATION_ERROR' });
    const filed = file(out.run, out.record!.id, 'JOB_FAILURE', 'APPLICATION_ERROR');
    expect(filed.filing!.points).toBe(5);
  }, 120_000);

  it('records a peer-slow LCU on a met hour as a standing fault', () => {
    const base = newRun(MIDWEST, content, 7);
    const tick = 5 * H;
    const hour: HourAcc = {
      ...newHour(tick),
      ticks: 12,
      workloads: { RBANK: { completions: 1000, withinSla: 1000, failed: 0, rtSumSec: 200, parts: { cpuQueue: 50, io: 100 } } },
    };
    const run: RunState = {
      ...base,
      sim: {
        ...base.sim,
        tick,
        rmf: {
          ...base.sim.rmf,
          intervals: [{
            endTick: tick,
            cf: [],
            lcus: [
              { id: '10', iops: 100, discMs: 0.07, rtMs: 0.22 },
              { id: '21', iops: 100, discMs: 0.07, rtMs: 0.22 },
              { id: '30', iops: 100, discMs: 0.5, rtMs: 0.22 },
            ],
            cfSystems: [],
          } as unknown as RmfInterval],
        },
      },
      hour,
      baselines: {},
      hourBaselines: { RBANK: { '10': { cpuQueue: 0.05, io: 0.1 } } },
    };
    const closed = closeHour(run, MIDWEST, content);
    const peer = (closed.quietHours ?? []).find((q) => q.workloadId === 'RBANK' && q.reason === 'PEER');
    expect(peer).toBeDefined();
    expect(peer!.truth.accepted.mechanisms).toContain('IO');
  });

  it('judges a met hour against the baseline in force during it, not the folded one', () => {
    const base = newRun(MIDWEST, content, 7);
    const tick = 5 * H;
    const hour: HourAcc = {
      ...newHour(tick),
      ticks: 12,
      workloads: { RBANK: { completions: 1000, withinSla: 1000, failed: 0, rtSumSec: 50, parts: { cpuQueue: 130 } } },
    };
    const run: RunState = {
      ...base,
      sim: { ...base.sim, tick },
      hour,
      baselines: {},
      hourBaselines: { RBANK: { '10': { cpuQueue: 0.1 } } },
    };
    const closed = closeHour(run, MIDWEST, content);
    const delay = (closed.quietHours ?? []).find((q) => q.workloadId === 'RBANK' && q.reason === 'DELAY');
    expect(delay).toBeDefined();
    // The folded slot baseline would read 0.13 - 0.115 = 0.015, under the 0.025 floor, and lose the fact.
    expect(closed.hourBaselines!.RBANK!['10']!.cpuQueue).toBeCloseTo(0.115);
    expect(delay!.truth.mechanism).toBeDefined();
  });

  it('pays a trigger-only correct answer at the RCA per-facet rate', () => {
    const truth = truthOf('CPU_PRIORITY', 'POLICY', { accepted: { mechanisms: ['CPU_PRIORITY'], triggers: ['POLICY', 'GROWTH'] } });
    const run = quiet({ quietHours: [fact('RBANK', truth)] });
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    const filed = file(out.run, out.record!.id, 'LOCK_CONTENTION', 'POLICY');
    expect(filed.ok, filed.message).toBe(true);
    expect(filed.filing!.points).toBe(2);
    expect(filed.filing!.trust).toBe(0.25);
    expect(filed.filing!.trustFacet).toBe('Retail');
  });

  it('pays a same-cause RCA on a later episode, but not within one fallback episode', () => {
    const truth = truthOf('CPU_CAPACITY', 'GROWTH', { cause: 'none:CPU:PROD1' });
    const first = incident(1, 'RBANK', truth, { day: 0, startTick: 0, endTick: H });
    const later = incident(2, 'RBANK', truth, { day: 6, startTick: 6 * TICKS_PER_DAY, endTick: 6 * TICKS_PER_DAY + H });
    const run = quiet({ incidents: [first, later] });
    const scored = submitRca(run, 1, 'CPU_CAPACITY', 'GROWTH');
    expect(scored.incidents.find((i) => i.id === 1)!.rca!.points).toBe(5);
    const after = submitRca(scored, 2, 'CPU_CAPACITY', 'GROWTH');
    expect(after.incidents.find((i) => i.id === 2)!.rca!.points).toBe(5);
    expect(after.incidents.find((i) => i.id === 2)!.rca!.duplicateOf).toBeUndefined();
    // The same fallback cause two hours later is still one episode and pays once.
    const close = incident(3, 'RBANK', truth, { day: 0, startTick: 2 * H, endTick: 3 * H });
    const within = submitRca(quiet({ incidents: [first, close] }), 1, 'CPU_CAPACITY', 'GROWTH');
    const second = submitRca(within, 3, 'CPU_CAPACITY', 'GROWTH');
    expect(second.incidents.find((i) => i.id === 3)!.rca!.points).toBe(0);
    expect(second.incidents.find((i) => i.id === 3)!.rca!.duplicateOf).toBe(1);
  });

  it('chains back-to-back quiet hours of a fallback cause, and starts a new episode after a longer gap', () => {
    const ep = (cause: string, day: number, startHour: number, endHour: number) => ({ cause, day, startTick: startHour * H, endTick: endHour * H });
    expect(sameEpisode(ep('none:CPU:PROD1', 0, 9, 10), ep('none:CPU:PROD1', 0, 10, 11))).toBe(true);
    expect(sameEpisode(ep('none:CPU:PROD1', 0, 9, 10), ep('none:CPU:PROD1', 0, 12, 13))).toBe(true);
    expect(sameEpisode(ep('none:CPU:PROD1', 0, 9, 10), ep('none:CPU:PROD1', 0, 13, 14))).toBe(false);
    expect(sameEpisode(ep('REGRESSION@0', 0, 9, 10), ep('REGRESSION@0', 1, 6, 7))).toBe(false);
    // A standing fault's hourly quiet hours chain into one episode, even when the first and last are hours apart.
    const truth = truthOf('IO', 'POLICY', { cause: 'none:IO:30' });
    const hourly = Array.from({ length: 5 }, (_, i) => fact('RBANK', truth, { day: 0, hourOfDay: 9 + i, startTick: (9 + i) * H, endTick: (10 + i) * H }));
    const run = quiet({ quietHours: hourly });
    const chained = episodeOf(run, ep('none:IO:30', 0, 9, 10));
    expect(chained).toMatchObject({ startTick: 9 * H, endTick: 14 * H });
    expect(episodeOf(run, ep('none:IO:30', 0, 13, 14))).toMatchObject({ startTick: 9 * H, endTick: 14 * H });
    // A gap of more than GROUP_FOLLOW_HOURS starts a separate episode.
    const gap = quiet({ quietHours: [...hourly, fact('RBANK', truth, { day: 0, hourOfDay: 17, startTick: 17 * H, endTick: 18 * H })] });
    expect(episodeOf(gap, ep('none:IO:30', 0, 17, 18))).toMatchObject({ startTick: 17 * H, endTick: 18 * H });
  });

  it('does not count a wrong prior RCA as the cause', () => {
    const truth = truthOf('CPU_PRIORITY', 'CHANGE_REGRESSION', { cause: 'REGRESSION@0' });
    const wrong = incident(1, 'RBANK', truth, { rca: { mechanism: 'IO', trigger: 'POLICY', points: 0 } });
    const run = quiet({ quietHours: [fact('RBANK', truth)], incidents: [wrong] });
    expect(creditedEpisode(run, { cause: 'REGRESSION@0', day: 0, startTick: 0, endTick: H })).toBeNull();
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    const filed = file(out.run, out.record!.id, 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(filed.filing!.points).toBe(5);
    expect(filed.filing!.duplicateOf).toBeUndefined();
    // The incident side too: a later RCA on the same cause earns when the earlier one was wrong.
    const second = incident(2, 'RBANK', truth);
    const rca = submitRca({ ...run, incidents: [wrong, second] }, 2, 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(rca.incidents.find((i) => i.id === 2)!.rca!.points).toBe(5);
    expect(rca.incidents.find((i) => i.id === 2)!.rca!.duplicateOf).toBeUndefined();
  });

  it('does not pay twice for a cause an incident already earned, or let a later RCA pay again', () => {
    const truth = truthOf('CPU_PRIORITY', 'CHANGE_REGRESSION', { cause: 'REGRESSION@0' });
    const inc = incident(1, 'RBANK', truth, { rca: { mechanism: 'CPU_PRIORITY', trigger: 'CHANGE_REGRESSION', points: 5 } });
    const run = quiet({ quietHours: [fact('RBANK', truth)], incidents: [inc] });
    expect(creditedEpisode(run, { cause: 'REGRESSION@0', day: 0, startTick: 0, endTick: H })).toBe(1);
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    const filed = file(out.run, out.record!.id, 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(filed.filing!.points).toBe(0);
    expect(filed.filing!.duplicateOf).toBe(1);
    expect(filed.filing!.trust).toBe(0);
    expect(filed.run.insight).toBe(out.run.insight);
    // The other direction: a record earns the cause first, and the incident's RCA earns nothing.
    const run2 = quiet({ quietHours: [fact('RBANK', truth)], incidents: [incident(2, 'RBANK', truth)] });
    const opened = open(run2, { kind: 'WORKLOAD', id: 'RBANK' });
    const record = file(opened.run, opened.record!.id, 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(record.filing!.points).toBe(5);
    const rca = submitRca(record.run, 2, 'CPU_PRIORITY', 'CHANGE_REGRESSION');
    expect(rca.incidents.find((i) => i.id === 2)!.rca!.points).toBe(0);
    expect(rca.incidents.find((i) => i.id === 2)!.rca!.duplicateOf).toBe(opened.record!.id);
    expect(rca.score).toBe(record.run.score);
  });

  it('resolves a class, an image and a job subject', () => {
    const truth = truthOf('CPU_PRIORITY', 'CHANGE_REGRESSION', { cause: 'REGRESSION@0' });
    const run = quiet({ quietHours: [fact('RBANK', truth)] });
    expect(subjectWorkloads(run, MIDWEST, { kind: 'CLASS', id: 'ONLHI#1' })).toContain('RBANK');
    expect(subjectWorkloads(run, MIDWEST, { kind: 'IMAGE', id: 'PROD1' })).toContain('RBANK');
    expect(subjectWorkloads(run, MIDWEST, { kind: 'JOB', id: 'CICSAOR1' })).toContain('RBANK');
    for (const subject of [
      { kind: 'CLASS', id: 'ONLHI#1' },
      { kind: 'IMAGE', id: 'PROD1' },
      { kind: 'JOB', id: 'CICSAOR1' },
    ] as const) {
      const out = open(run, subject);
      expect(out.ok, `${subject.kind}: ${out.message}`).toBe(true);
      expect(out.record!.truth.cause).toBe('REGRESSION@0');
    }
  });

  it('rejects windows that are not whole consecutive closed hours, or too long', () => {
    const run = quiet();
    expect(typeof problemWindowOf(run, 1, H)).toBe('string');
    expect(typeof problemWindowOf(run, 0, H + 1)).toBe('string');
    expect(typeof problemWindowOf(run, H, 0)).toBe('string');
    const gap = { ...run, smfHours: [{ day: 0, hourOfDay: 6, workloads: {} }, { day: 0, hourOfDay: 8, workloads: {} }] };
    expect(typeof problemWindowOf(gap, 0, 2 * H)).toBe('string');
    const many = { ...run, smfHours: Array.from({ length: PROBLEM.maxWindowHours + 1 }, (_, i) => ({ day: 0, hourOfDay: (6 + i) % 24, workloads: {} })) };
    expect(typeof problemWindowOf(many, 0, (PROBLEM.maxWindowHours + 1) * H)).toBe('string');
  });

  it('publishes the subjects, the closed hours and the view without the hidden truth', () => {
    const truth = truthOf('CPU_PRIORITY', 'CHANGE_REGRESSION', { cause: 'REGRESSION@0' });
    const run = quiet({ quietHours: [fact('RBANK', truth)] });
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    const view = problemsView(out.run, MIDWEST);
    expect(view.hours).toHaveLength(2);
    expect(view.subjects.some((s) => s.kind === 'WORKLOAD' && s.id === 'RBANK')).toBe(true);
    expect(view.records[0]).toMatchObject({ id: out.record!.id, attemptsToday: 0, canFile: true });
    expect('truth' in view.records[0]!).toBe(false);
    expect('candidates' in view.records[0]!).toBe(false);
    expect(problemHours(out.run).map((h) => h.label)).toEqual(['D1 06:00', 'D1 07:00']);
  });
});
