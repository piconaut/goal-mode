import { beforeAll, describe, expect, it } from 'vitest';
import { encodePlayFile, type PlayFile } from '../../tools/playCore';
import { blameText } from '../../tools/inspect';
import { blameIncident, summarizeBlame } from '../../src/game/counterfactual';
import { advance, chooseDraft, newRun, startDay } from '../../src/game/run';
import { scenarioFor } from '../../src/game/difficulty';
import { packOf } from '../../src/content/packs';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import type { ActiveEvent, Incident, RunState } from '../../src/game/types';

const pack = packOf('midwest');
const scenario = scenarioFor(pack.scenario, 'NORMAL');

// D2 14:00: the hour of seed 2's first incident (a runaway query, RUNAWAY@1).
const DAY = 1;
const HOUR_START = DAY * TICKS_PER_DAY + 8 * TICKS_PER_HOUR;

/** D1 played to its review, D2 started, at the incident's hour start; the log replays it. */
let file: PlayFile;
beforeAll(() => {
  let run = newRun(pack.scenario, pack.game, 2);
  run = startDay(run, pack.game);
  run = advance(run, scenario, pack.game, 24 * 360);
  run = chooseDraft(run, pack.game, null);
  run = startDay(run, pack.game);
  run = advance(run, scenario, pack.game, 8 * 360);
  file = {
    version: 1,
    run,
    pendingPolicy: null,
    log: [
      { cmd: 'new', seed: 2, difficulty: 'NORMAL', scenario: 'midwest' },
      { cmd: 'start' },
      { cmd: 'advance', hours: 24 },
      { cmd: 'draft', optionId: null },
      { cmd: 'start' },
      { cmd: 'advance', hours: 8 },
    ],
  };
  expect(run.sim.tick).toBe(HOUR_START);
}, 60_000);

const truthOf = (start: RunState, workloadId: string): Incident => {
  const after = advance(structuredClone(start), scenario, pack.game, TICKS_PER_HOUR);
  const inc = after.incidents.find((i) => i.startTick === start.sim.tick && i.workloadId === workloadId);
  expect(inc, `no ${workloadId} incident at ${start.sim.tick}`).toBeDefined();
  return inc!;
};

describe('counterfactual validator (RT-06)', () => {
  it('clears a causal card, ignores a bystander on the same workload, and agrees with the game', () => {
    const incident = truthOf(file.run, 'MOBILE');
    // A card on the same workload that does nothing at all, and cannot be the CPU card the game blames.
    const bystander: ActiveEvent = {
      uid: 'BYSTANDER@1',
      defId: 'BYSTANDER',
      name: 'A change that did nothing',
      startTick: HOUR_START,
      endTick: HOUR_START + TICKS_PER_HOUR,
      trigger: 'POLICY',
      affects: ['MOBILE'],
      mechanisms: ['CAPPING'],
      endCommands: [],
      started: true,
      ended: false,
    };
    const run = { ...file.run, events: [...file.run.events, bystander] };
    const blame = blameIncident(run, scenario, pack.game, incident);
    expect(blame.reproduced).toBe(true);
    expect(blame.baseline.met).toBe(false);
    // Both cards are tested; only the runaway's removal meets the SLA.
    expect(blame.tested.map((t) => t.card.uid).sort()).toEqual(['BYSTANDER@1', 'RUNAWAY@1']);
    expect(blame.tested.find((t) => t.card.uid === 'BYSTANDER@1')!.met).toBe(false);
    expect(blame.causes.map((c) => c.uid)).toEqual(['RUNAWAY@1']);
    expect(blame.blamed?.uid).toBe('RUNAWAY@1');
    expect(blame.agrees).toBe(true);
    expect(summarizeBlame([blame])).toMatchObject({ incidents: 1, reproduced: 1, testable: 1, withCause: 1, agree: 1, disagree: 0 });
  });

  it('disagrees when the game blames no card but a card would have met the SLA', () => {
    const real = truthOf(file.run, 'MOBILE');
    // The same hour read as a policy incident: every card declares CPU_PRIORITY only, so none can be blamed for
    // CAPPING, while the runaway is still the cause.
    const events = file.run.events.map((e) => ({ ...e, mechanisms: ['CPU_PRIORITY' as const] }));
    const mislabeled: Incident = { ...real, truth: { mechanism: 'CAPPING', trigger: 'POLICY' } };
    const blame = blameIncident({ ...file.run, events }, scenario, pack.game, mislabeled);
    expect(blame.blamed).toBeNull();
    expect(blame.causes.map((c) => c.uid)).toEqual(['RUNAWAY@1']);
    expect(blame.agrees).toBe(false);
    expect(summarizeBlame([blame])).toMatchObject({ testable: 1, withCause: 1, agree: 0, disagree: 1 });
  });

  it('refuses a save with no play log, which cannot replay a past hour', () => {
    expect(() => blameText(encodePlayFile({ ...file, log: [] }))).toThrow(/play-CLI file/);
  });

  it('refuses a log that replays a different run than the saved state', () => {
    const wrong = { ...file, log: [{ cmd: 'new' as const, seed: 3 }, ...file.log.slice(1)] };
    expect(() => blameText(encodePlayFile(wrong))).toThrow(/starts a different run/);
  });

  it('runs on a play-CLI file and reports the incident, cards and verdict', () => {
    // Past the hour, so the run holds the incident, then blame the file end to end.
    const run = advance(structuredClone(file.run), scenario, pack.game, TICKS_PER_HOUR);
    expect(run.incidents.some((i) => i.startTick === HOUR_START)).toBe(true);
    const text = blameText(encodePlayFile({ ...file, run, log: [...file.log, { cmd: 'advance', hours: 1 }] }));
    expect(text).toContain('1 online incident');
    expect(text).toContain('MOBILE (incident 1)');
    expect(text).toContain('Runaway ad-hoc query [RUNAWAY@1]');
    expect(text).toContain('AGREE: Runaway ad-hoc query is a counterfactual cause');
  });
});
