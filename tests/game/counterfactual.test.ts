import { beforeAll, describe, expect, it } from 'vitest';
import { encodePlayFile, type PlayFile } from '../../tools/playCore';
import { blameText } from '../../tools/inspect';
import { blameIncident, counterfactualCandidates, endedAtHourStart, summarizeBlame } from '../../src/game/counterfactual';
import { advance, chooseDraft, newRun, startDay } from '../../src/game/run';
import { scenarioFor } from '../../src/game/difficulty';
import { packOf } from '../../src/content/packs';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import type { ActiveEvent, Incident, RunState } from '../../src/game/types';

const pack = packOf('revenue');
const scenario = scenarioFor(pack.scenario, 'NORMAL');

// D2 11:00 on Revenue: the hour of seed 6's first incident (a runaway compliance query, RUNAWAY_COMPLIANCE@1, from
// 11:17, hurting EFILE). Midwest's runaways were the fixture before WT-10 (seed 2 before WT-04, then seed 3); since
// WT-10 WLM helps MOBILE's CPU delay while it mostly waits on Db2, and no Midwest runaway in seeds 1–30 breaks it.
const DAY = 1;
const HOURS = 5;
const HOUR_START = DAY * TICKS_PER_DAY + HOURS * TICKS_PER_HOUR;
const CARD = 'RUNAWAY_COMPLIANCE@1';
const VICTIM = 'EFILE';

/** D1 played to its review, D2 started, at the incident's hour start; the log replays it. */
let file: PlayFile;
beforeAll(() => {
  let run = newRun(pack.scenario, pack.game, 6);
  run = startDay(run, pack.game);
  run = advance(run, scenario, pack.game, 24 * 360);
  run = chooseDraft(run, pack.game, null);
  run = startDay(run, pack.game);
  run = advance(run, scenario, pack.game, HOURS * 360);
  file = {
    version: 1,
    run,
    pendingPolicy: null,
    log: [
      { cmd: 'new', seed: 6, difficulty: 'NORMAL', scenario: 'revenue' },
      { cmd: 'start' },
      { cmd: 'advance', hours: 24 },
      { cmd: 'draft', optionId: null },
      { cmd: 'start' },
      { cmd: 'advance', hours: HOURS },
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
    const incident = truthOf(file.run, VICTIM);
    // A card on the same workload that does nothing at all, and cannot be the CPU card the game blames.
    const bystander: ActiveEvent = {
      uid: 'BYSTANDER@1',
      defId: 'BYSTANDER',
      name: 'A change that did nothing',
      startTick: HOUR_START,
      endTick: HOUR_START + TICKS_PER_HOUR,
      trigger: 'POLICY',
      affects: [VICTIM],
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
    expect(blame.tested.map((t) => t.card.uid).sort()).toEqual(['BYSTANDER@1', CARD]);
    expect(blame.tested.find((t) => t.card.uid === 'BYSTANDER@1')!.met).toBe(false);
    expect(blame.causes.map((c) => c.uid)).toEqual([CARD]);
    expect(blame.blamed?.uid).toBe(CARD);
    expect(blame.agrees).toBe(true);
    expect(summarizeBlame([blame])).toMatchObject({ incidents: 1, reproduced: 1, testable: 1, withCause: 1, agree: 1, disagree: 0 });
  });

  it('disagrees when the game blames no card but a card would have met the SLA', () => {
    const real = truthOf(file.run, VICTIM);
    // The same hour read as a policy incident: every card declares CPU_PRIORITY only, so none can be blamed for
    // CAPPING, while the runaway is still the cause.
    const events = file.run.events.map((e) => ({ ...e, mechanisms: ['CPU_PRIORITY' as const] }));
    const mislabeled: Incident = { ...real, truth: { mechanism: 'CAPPING', trigger: 'POLICY' } };
    const blame = blameIncident({ ...file.run, events }, scenario, pack.game, mislabeled);
    expect(blame.blamed).toBeNull();
    expect(blame.causes.map((c) => c.uid)).toEqual([CARD]);
    expect(blame.agrees).toBe(false);
    expect(summarizeBlame([blame])).toMatchObject({ testable: 1, withCause: 1, agree: 0, disagree: 1 });
  });

  it('refuses a save with no play log, which cannot replay a past hour', () => {
    expect(() => blameText(encodePlayFile({ ...file, log: [] }))).toThrow(/play-CLI file/);
  });

  it('refuses a log that replays a different run than the saved state', () => {
    const wrong = { ...file, log: [{ cmd: 'new' as const, seed: 4 }, ...file.log.slice(1)] };
    expect(() => blameText(encodePlayFile(wrong))).toThrow(/starts a different run/);
    const difficulty = { ...file, log: [{ cmd: 'new' as const, seed: 3, difficulty: 'HARD' as const }, ...file.log.slice(1)] };
    expect(() => blameText(encodePlayFile(difficulty))).toThrow(/starts a different run/);
  });

  it('runs on a play-CLI file, waiting for the commands issued at the incident hour', () => {
    // Past the hour, so the run holds the incident, then blame the file end to end. The note sits at the hour start:
    // the branch must be taken after it, once, not before it and again after (the duplicate-blame regression).
    const run = advance(structuredClone(file.run), scenario, pack.game, TICKS_PER_HOUR);
    expect(run.incidents.some((i) => i.startTick === HOUR_START)).toBe(true);
    const log = [...file.log, { cmd: 'note' as const, text: 'the hour starts here' }, { cmd: 'advance' as const, hours: 1 }];
    const text = blameText(encodePlayFile({ ...file, run, log }));
    // Keep the hour-boundary replay assertion independent of incident numbering on earlier days.
    const incident = run.incidents.find((i) => i.startTick === HOUR_START && i.workloadId === VICTIM)!;
    expect(text).toContain('1 online incident');
    expect(text.split(`${VICTIM} (incident ${incident.id})`)).toHaveLength(2);
    expect(text).toContain(`Runaway compliance query [${CARD}]`);
    expect(text).toContain('AGREE: Runaway compliance query is a counterfactual cause');
  });

  it('replays a log with a Monitor III pin at a past time', () => {
    // The pin reads the Monitor III history the play CLI records while it advances; the replay must record it too.
    const log = [
      ...file.log.slice(0, 5),
      { cmd: 'buy' as const, toolId: 'RMF_MON3' },
      { cmd: 'advance' as const, hours: HOURS },
      { cmd: 'pin' as const, req: { source: 'MON3' as const, system: 'PROD1', scKey: 'WEBDDF#1', metric: 'PI' as const }, at: 'D2 10:30' },
      { cmd: 'advance' as const, hours: 1 },
    ];
    const run = advance(structuredClone(file.run), scenario, pack.game, TICKS_PER_HOUR);
    const text = blameText(encodePlayFile({ ...file, run, log }));
    expect(text).toContain(`${VICTIM} (incident 1)`);
    expect(text).not.toContain('failed');
  }, 120_000);

  it('tests a cap whose scope grew during the hour and a card that put the workload live', () => {
    const cap = (uid: string, affects: string[]) => ({
      uid, defId: 'POWER_CAP', name: 'Power cap', startTick: HOUR_START, endTick: HOUR_START + 6 * TICKS_PER_HOUR,
      trigger: 'HARDWARE_FAULT' as const, affects, mechanisms: ['CPU_CAPACITY' as const], endCommands: [], started: true, ended: false,
    });
    // The hour-start scope did not include MOBILE; the closing union does (a workload routed onto the capped CPC).
    const start = [cap('POWER_CAP@1', ['RBANK'])];
    const end = [cap('POWER_CAP@1', ['RBANK', 'MOBILE'])];
    expect(counterfactualCandidates(start, end, 'MOBILE', HOUR_START, pack.game).map((e) => e.uid)).toEqual(['POWER_CAP@1']);
    // A card that puts a workload live can declare only the old work in `affects`: its begin names the new id.
    const golive = {
      uid: 'FAKE@1', defId: 'FAKE', name: 'New app', startTick: HOUR_START, endTick: null,
      trigger: 'NEW_WORKLOAD' as const, affects: ['OLD'], endCommands: [], started: true, ended: false,
    };
    const fake = {
      ...pack.game,
      events: [{ id: 'FAKE', affects: ['OLD'], begin: [{ kind: 'ADD_WORKLOAD', workload: { id: 'NEWWL' } }] } as unknown as (typeof pack.game.events)[number]],
    };
    expect(counterfactualCandidates([golive], [golive], 'NEWWL', HOUR_START, fake)).toHaveLength(1);
    expect(counterfactualCandidates([golive], [golive], 'MOBILE', HOUR_START, fake)).toHaveLength(0);
  });

  it("reads an incident in the day's last hour, whose replay ends the day", () => {
    const run = advance(structuredClone(file.run), scenario, pack.game, (23 - HOURS) * TICKS_PER_HOUR); // D3 05:00
    const incident: Incident = {
      id: 999,
      workloadId: VICTIM,
      day: run.day,
      startTick: run.sim.tick,
      endTick: null,
      hours: 1,
      worstAttainmentPct: 0,
      truth: { mechanism: 'CPU_PRIORITY', trigger: 'POLICY' },
      rca: null,
      trustLost: 0,
    };
    expect(run.sim.tick % TICKS_PER_DAY).toBe(23 * TICKS_PER_HOUR); // 05:00, the day's last hour
    const blame = blameIncident(run, scenario, pack.game, incident);
    // The hour's accounting is in the last smfHours entry even though the branch crossed 06:00 and ended the day.
    expect(blame.baseline.attainmentPct).not.toBeNull();
    expect(blame.id).toBe(999);
  });

  it('removes an already-running card at the first tick and a card that starts inside the hour before it begins', () => {
    const ev = { uid: 'C@1', defId: 'C', name: 'Change', startTick: HOUR_START - TICKS_PER_HOUR, endTick: HOUR_START + TICKS_PER_HOUR, trigger: 'POLICY' as const, affects: ['MOBILE'], endCommands: [], started: true, ended: false };
    // Ran before the hour: its end commands apply at the first tick.
    expect(endedAtHourStart(ev, HOUR_START)).toMatchObject({ startTick: HOUR_START - TICKS_PER_HOUR, endTick: HOUR_START, started: true, ended: false });
    // Starts at or inside the hour: marked run and ended so its begin never applies.
    expect(endedAtHourStart({ ...ev, startTick: HOUR_START }, HOUR_START)).toMatchObject({ startTick: HOUR_START, endTick: HOUR_START, started: true, ended: true });
  });
});
