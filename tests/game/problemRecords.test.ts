// Problem records (RT-22): a diagnosis on a subject and a window for cards, standing faults and quiet hours that
// never page, with the same truth, proof, reward and anti-fishing limits as an incident RCA.

import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { cardMechanisms } from '../../src/content/footprint';
import { PROBLEM } from '../../src/content/rca';
import { advance, newRun, startDay, submitRca } from '../../src/game/run';
import { applyCommands } from '../../src/sim/core/commands';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import {
  causeCredited,
  fileProblemDiagnosis,
  openProblemRecord,
  problemHours,
  problemWindowOf,
  problemsView,
  subjectWorkloads,
} from '../../src/game/problems';
import type { Incident, Mechanism, ProblemSubject, QuietHour, RunState, Trigger } from '../../src/game/types';
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
  attainmentPct: 100,
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
    expect(filed.run.creditedCauses).toContain('REGRESSION@0');
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

  it('calls a clean window no problem and charges the wrong mechanism', () => {
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

  it('prices a filing, allows one an hour and three a day, and takes the wrong-mechanism trust once a day', () => {
    const truth = truthOf('CPU_PRIORITY', 'POLICY', { accepted: { mechanisms: ['CPU_PRIORITY'], triggers: ['POLICY', 'GROWTH'] } });
    const run = quiet({ quietHours: [fact('RBANK', truth)] });
    const out = open(run, { kind: 'WORKLOAD', id: 'RBANK' });
    const first = file(out.run, out.record!.id, 'LOCK_CONTENTION', 'POLICY');
    expect(first.ok, first.message).toBe(true);
    expect(first.run.hoursLeft).toBeCloseTo(out.run.hoursLeft - PROBLEM.hours);
    expect(first.filing!.trust).toBe(-PROBLEM.wrongTrust);
    // The same record cannot be filed again within the hour.
    expect(file(first.run, out.record!.id, 'LOCK_CONTENTION', 'POLICY').ok).toBe(false);
    // An hour later the same wrong mechanism costs no second trust loss.
    const later = { ...first.run, sim: { ...first.run.sim, tick: first.run.sim.tick + H } };
    const second = file(later, out.record!.id, 'LOCK_CONTENTION', 'POLICY');
    expect(second.ok, second.message).toBe(true);
    expect(second.filing!.trust).toBe(0);
    // The third is allowed; the fourth is not.
    const thirdTick = { ...second.run, sim: { ...second.run.sim, tick: second.run.sim.tick + H } };
    const third = file(thirdTick, out.record!.id, 'LOCK_CONTENTION', 'POLICY');
    expect(third.ok, third.message).toBe(true);
    const fourthTick = { ...third.run, sim: { ...third.run.sim, tick: third.run.sim.tick + H } };
    const fourth = file(fourthTick, out.record!.id, 'LOCK_CONTENTION', 'POLICY');
    expect(fourth.ok).toBe(false);
    expect(fourth.message).toContain('3 filings today');
    // A new played day resets the count.
    const nextDay = { ...fourthTick, day: 1, sim: { ...fourthTick.sim, tick: fourthTick.sim.tick + TICKS_PER_DAY }, hoursLeft: 8 };
    expect(file(nextDay, out.record!.id, 'LOCK_CONTENTION', 'POLICY').ok).toBe(true);
  });

  it('does not pay twice for a cause an incident already earned, or let a later RCA pay again', () => {
    const truth = truthOf('CPU_PRIORITY', 'CHANGE_REGRESSION', { cause: 'REGRESSION@0' });
    const inc = incident(1, 'RBANK', truth, { rca: { mechanism: 'CPU_PRIORITY', trigger: 'CHANGE_REGRESSION', points: 5 } });
    const run = quiet({ quietHours: [fact('RBANK', truth)], incidents: [inc] });
    expect(causeCredited(run, 'REGRESSION@0')).toBe(1);
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
