import { describe, expect, it } from 'vitest';
import { ACQUIRED_APP, BOOKING_APP } from '../../src/content/events/midwest-events';
import { PREFILL_APP, REVENUE_STORY } from '../../src/content/events/revenue-events';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { NEW_WORKLOAD_DAYS } from '../../src/content/sla';
import { storyBeatsFor } from '../../src/game/difficulty';
import { advance, newRun, startDay } from '../../src/game/run';
import { closeHour, newHour } from '../../src/game/run/hourly';
import type { ActiveEvent, RunState } from '../../src/game/types';
import { isNewWorkload } from '../../src/game/workloads';
import { applyCommands } from '../../src/sim/core/commands';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/core/units';
import type { WorkloadDef } from '../../src/sim/workload/types';

const storyStart = MIDWEST_GAME.story.find((b) => b.id === 'MERGER')!.day * TICKS_PER_DAY;
const windowTicks = NEW_WORKLOAD_DAYS * TICKS_PER_DAY;
const golive = MIDWEST_GAME.events.find((e) => e.id === 'NEW_APP_GOLIVE')!;
const eventStart = 10 * TICKS_PER_DAY + 2 * TICKS_PER_HOUR + 72;
const event: ActiveEvent = {
  uid: 'NEW_APP_GOLIVE@10', defId: golive.id, name: golive.name, trigger: golive.trigger,
  startTick: eventStart, endTick: null, started: true, ended: false, affects: golive.affects, endCommands: [],
};

function breach(w: WorkloadDef, hourStart: number, events: ActiveEvent[] = []): RunState {
  const r = startDay(newRun(MIDWEST, { ...MIDWEST_GAME, events: [] }, 7), MIDWEST_GAME);
  return {
    ...r, events, day: Math.floor(hourStart / TICKS_PER_DAY),
    sim: { ...applyCommands(r.sim, [{ kind: 'ADD_WORKLOAD', workload: w }]), tick: hourStart + TICKS_PER_HOUR },
    hour: {
      ...newHour(hourStart), ticks: TICKS_PER_HOUR,
      workloads: { [w.id]: { completions: 1000, withinSla: 0, failed: 0, rtSumSec: 10_000, parts: { cpuQueue: 10_000 } } },
    },
  };
}
const truth = (r: RunState) => closeHour(r, MIDWEST, MIDWEST_GAME).incidents.at(-1)!.truth;

describe('new-workload incident window', () => {
  it.each(['STORY', 'NORMAL', 'HARD', 'IRONMAN'] as const)(
    'recovers the Revenue PREFILL story go-live window on %s', (difficulty) => {
      const run = { ...breach(PREFILL_APP, 22 * TICKS_PER_DAY), difficulty };
      const content = { ...MIDWEST_GAME, events: [], story: REVENUE_STORY };
      for (const day of [21, 22, 23, 24]) {
        expect(isNewWorkload(run, content, PREFILL_APP.id, day * 24)).toBe(day === 22 || day === 23);
      }
    },
  );

  it.each([
    ['NORMAL', 10, 'DEADLINE_0500', 10],
    ['STORY', 10, 'DEADLINE_0500', 13],
    ['HARD', 10, 'DEADLINE_0500', 6],
    ['IRONMAN', 2, 'DEADLINE_0500', 1],
    ['STORY', 10, 'CFO_MANDATE', null],
  ] as const)('uses the scheduled story workload day on %s (day %i, %s)', (difficulty, day, constraint, effectiveDay) => {
    const run = { ...breach(ACQUIRED_APP, 0), difficulty };
    const beat = { ...MIDWEST_GAME.story.find((b) => b.id === 'MERGER')!, day, constraint };
    const content = { ...MIDWEST_GAME, events: [], story: [beat] };
    const scheduledDays = Array.from({ length: 20 }, (_, d) => d).filter((d) => storyBeatsFor([beat], difficulty, d).length > 0);
    expect(scheduledDays).toEqual(effectiveDay === null ? [] : [effectiveDay]);
    for (let d = 0; d < 20; d++) {
      expect(isNewWorkload(run, content, ACQUIRED_APP.id, d * 24))
        .toBe(effectiveDay !== null && d >= effectiveDay && d < effectiveDay + NEW_WORKLOAD_DAYS);
    }
  });

  it.each([0, windowTicks - TICKS_PER_HOUR, windowTicks, windowTicks + TICKS_PER_DAY])(
    'uses the scripted go-live age at offset %i, including the exact expiry boundary', (age) => {
      expect(truth(breach(ACQUIRED_APP, storyStart + age))).toMatchObject({
        mechanism: 'CPU_PRIORITY', trigger: age < windowTicks ? 'NEW_WORKLOAD' : 'POLICY',
      });
    },
  );

  it('keeps the last new hour new even when it closes at expiry through the live advance path', () => {
    const r = breach(ACQUIRED_APP, storyStart + windowTicks - TICKS_PER_HOUR);
    const closed = advance({ ...r, sim: { ...r.sim, tick: r.sim.tick - 1 } }, MIDWEST, MIDWEST_GAME, 1);
    expect(closed.incidents.find((i) => i.workloadId === ACQUIRED_APP.id)!.truth.trigger).toBe('NEW_WORKLOAD');
  });

  it.each([0, windowTicks, windowTicks + TICKS_PER_HOUR])(
    'bounds the persistent go-live card and fallback together at offset %i', (age) => {
      const hourStart = eventStart - 72 + age;
      expect(truth(breach(BOOKING_APP, hourStart, [event])).trigger)
        .toBe(hourStart < eventStart + windowTicks ? 'NEW_WORKLOAD' : 'POLICY');
    },
  );

  it('expires a persistent card exactly on an hour-aligned go-live boundary', () => {
    const aligned = { ...event, startTick: eventStart - 72 };
    expect(truth(breach(BOOKING_APP, aligned.startTick + windowTicks, [aligned])).trigger).toBe('POLICY');
  });

  it('recovers old saves without difficulty or added age metadata, without changing prior incidents', () => {
    const old = breach(ACQUIRED_APP, storyStart + windowTicks);
    delete old.difficulty;
    const recent = truth(breach(ACQUIRED_APP, storyStart));
    const saved = JSON.parse(JSON.stringify({ ...old, incidents: [{
      id: 123, workloadId: ACQUIRED_APP.id, day: 26, startTick: storyStart, endTick: storyStart + TICKS_PER_HOUR,
      hours: 1, worstAttainmentPct: 0, truth: recent, rca: null, trustLost: 1,
    }] })) as RunState;
    const closed = closeHour(saved, MIDWEST, MIDWEST_GAME);
    expect(closed.incidents[0]!.truth.trigger).toBe('NEW_WORKLOAD');
    expect(closed.incidents.at(-1)!.truth.trigger).toBe('POLICY');
    expect(truth(JSON.parse(JSON.stringify(breach(BOOKING_APP, eventStart - 72, [event])))).trigger).toBe('NEW_WORKLOAD');
  });

  it('does not invent an age for unknown origins, undelivered events or original scenario workloads', () => {
    const r = breach(BOOKING_APP, eventStart - 72);
    for (const events of [[], [{ ...event, started: false }], [{ ...event, defId: 'MISSING' }]]) {
      expect(isNewWorkload({ ...r, events }, MIDWEST_GAME, BOOKING_APP.id, r.hour!.hourIndex)).toBe(false);
    }
    expect(isNewWorkload({ ...r, events: [event] }, MIDWEST_GAME, 'RBANK', r.hour!.hourIndex)).toBe(false);
    expect(truth(r).trigger).toBe('POLICY');
  });

  it('never counts a player-added workload as new when no event or story beat adds it', () => {
    const r = breach(BOOKING_APP, eventStart - 72);
    const content = { ...MIDWEST_GAME, events: [], story: [] };
    for (let d = 0; d < 20; d++) expect(isNewWorkload({ ...r, events: [] }, content, BOOKING_APP.id, d * 24)).toBe(false);
  });

  it('preserves other card precedence and policy, growth and batch-lock fallbacks after expiry', () => {
    const r = breach(ACQUIRED_APP, storyStart + windowTicks);
    const other = { ...event, uid: 'CURRENT', defId: 'CURRENT', startTick: r.hour!.hourIndex * TICKS_PER_HOUR,
      trigger: 'HARDWARE_FAULT' as const, affects: [ACQUIRED_APP.id], mechanisms: ['CPU_PRIORITY' as const] };
    expect(truth({ ...r, events: [other] }).trigger).toBe('HARDWARE_FAULT');
    expect(truth({ ...breach(ACQUIRED_APP, storyStart), events: [{ ...other, startTick: storyStart }] }).trigger).toBe('HARDWARE_FAULT');
    const withParts = (parts: Record<string, number>, lockIndexSum = 0): RunState => ({
      ...r, hour: { ...r.hour!, lockIndexSum, workloads: { [ACQUIRED_APP.id]: { ...r.hour!.workloads[ACQUIRED_APP.id]!, parts } } },
    });
    expect(truth(withParts({ io: 10_000 })).trigger).toBe('GROWTH');
    expect(truth(withParts({ lock: 10_000 }, 3 * TICKS_PER_HOUR)).trigger).toBe('BATCH_OVERLAP');
    const shadow = MIDWEST_GAME.events.find((e) => e.id === 'SHADOW_IT')!;
    expect(truth({ ...r, events: [{ ...other, trigger: shadow.trigger, endTick: r.sim.tick }] }).trigger).toBe('NEW_WORKLOAD');
  });
});
