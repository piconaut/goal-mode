// A slow TSO costs the team engineer-hours (PT-50): the scenario's own response goal, the sustained window, the
// surcharge on hands-on changes, the one inbox complaint per episode and the recovery.

import { describe, expect, it } from 'vitest';
import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { previewChange } from '../../src/game/catalog';
import { advance, newRun, previewContext, requestChange, startDay } from '../../src/game/run';
import { closeHour, newHour } from '../../src/game/run/hourly';
import { slowInternalOf } from '../../src/game/staff';
import type { HourAcc, RunState, SmfHour } from '../../src/game/types';
import { applyCommand } from '../../src/sim/core/commands';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';
import type { Command } from '../../src/sim/core/commands';

const content = { ...MIDWEST_GAME, events: [] };
const fresh = (): RunState => newRun(MIDWEST, content, 7);
const weight = (w: number): Command => ({ kind: 'SET_WEIGHT', lparId: 'PROD1', pool: 'CP', weight: w });

/** A closed hour with TSO at `rtSec` average (and no other workload data the game rule needs). */
const tsoHour = (day: number, hourOfDay: number, rtSec: number, completions = 1000): SmfHour => ({
  day,
  hourOfDay,
  workloads: { TSO: { completions, withinSla: completions, failed: 0, rtSumSec: rtSec * completions, parts: {} } },
});

/** The hour accumulator a close needs for an hour whose TSO work averaged `rtSec`. */
const closingHour = (rtSec: number, completions = 1000): HourAcc => ({
  ...newHour(0),
  ticks: TICKS_PER_HOUR,
  workloads: { TSO: { completions, withinSla: completions, failed: 0, rtSumSec: rtSec * completions, parts: {} } },
});

const surchargeOf = (run: RunState) => previewContext(run, content).staffSurcharge;

describe('slow internal work (PT-50)', () => {
  it('opens only after the content window of consecutive missed clock hours', () => {
    const one = slowInternalOf({ ...fresh(), smfHours: [tsoHour(0, 10, 1.2)] }, content.internalGoal);
    expect(one).toBeNull();
    const two = slowInternalOf({ ...fresh(), smfHours: [tsoHour(0, 10, 1.2), tsoHour(0, 11, 1.4)] }, content.internalGoal);
    expect(two).toMatchObject({ key: '0:10', workloadId: 'TSO', missedHours: 2, rtSec: 1.4, goalSec: 0.5, hoursMult: 1.5 });
    // A met hour at the end ends the episode: the cost is derived from the newest hours, never a stored flag.
    expect(slowInternalOf({ ...fresh(), smfHours: [tsoHour(0, 10, 1.2), tsoHour(0, 11, 0.1)] }, content.internalGoal)).toBeNull();
    // The window is consecutive clock hours: a gap (here the 11:00 hour is missing) resets it.
    expect(slowInternalOf({ ...fresh(), smfHours: [tsoHour(0, 9, 1.2), tsoHour(0, 11, 1.2)] }, content.internalGoal)).toBeNull();
    // An hour with no completions has no work to be slow, so it ends the window.
    expect(slowInternalOf({ ...fresh(), smfHours: [tsoHour(0, 10, 1.2), tsoHour(0, 11, 1.2, 0)] }, content.internalGoal)).toBeNull();
    // The played day starts at 06:00, so 05 and the next day's 06 are adjacent clock hours.
    const across = slowInternalOf({ ...fresh(), smfHours: [tsoHour(0, 5, 1.2), tsoHour(1, 6, 1.2)] }, content.internalGoal);
    expect(across).toMatchObject({ key: '0:5', missedHours: 2 });
  });

  it('charges 1.5x hands-on hours, complains once per episode, and restores the price when TSO recovers', () => {
    const opening = fresh();
    const run = { ...opening, sim: { ...opening.sim, tick: 3 * TICKS_PER_HOUR }, smfHours: [tsoHour(0, 6, 1.2), tsoHour(0, 7, 1.2)] };
    const closed = closeHour({ ...run, hour: closingHour(1.2) }, MIDWEST, content);
    expect(slowInternalOf(closed, content.internalGoal)).toMatchObject({ missedHours: 3, rtSec: 1.2 });
    const complaints = closed.inbox.filter((m) => m.subject === 'TSO response is slow');
    expect(complaints).toHaveLength(1);
    expect(complaints[0]!.body).toContain('1.20 s');
    expect(complaints[0]!.body).toContain('0.50 s');
    expect(complaints[0]!.body).toContain('1.5×');
    // The Change Desk's preview and the charge agree: 0.5 h of weight work costs 0.75 h, and the reason is exposed.
    const p = previewChange(previewContext(closed, content), { commands: [weight(500)] });
    expect(p.hours).toBeCloseTo(0.75);
    expect(p.staffMult).toBe(1.5);
    expect(surchargeOf(closed)).toMatchObject({ mult: 1.5, rtSec: 1.2, goalSec: 0.5, missedHours: 3 });
    const charged = requestChange(closed, content, { label: 'Weight', commands: [weight(500)] });
    expect(charged.run.hoursLeft).toBeCloseTo(closed.hoursLeft - 0.75);
    // A further missed hour stays the same episode: no second complaint.
    const longer = closeHour({ ...closed, sim: { ...closed.sim, tick: 4 * TICKS_PER_HOUR }, hour: closingHour(1.3) }, MIDWEST, content);
    expect(slowInternalOf(longer, content.internalGoal)).toMatchObject({ key: '0:6', missedHours: 4 });
    expect(longer.inbox.filter((m) => m.subject === 'TSO response is slow')).toHaveLength(1);
    // TSO recovers: the derived surcharge is gone and the same change costs its base 0.5 h.
    const recovered = closeHour({ ...longer, sim: { ...longer.sim, tick: 5 * TICKS_PER_HOUR }, hour: closingHour(0.1) }, MIDWEST, content);
    expect(slowInternalOf(recovered, content.internalGoal)).toBeNull();
    expect(surchargeOf(recovered)).toBeUndefined();
    const restored = previewChange(previewContext(recovered, content), { commands: [weight(500)] });
    expect(restored.hours).toBeCloseTo(0.5);
    expect(restored.staffMult).toBe(1);
    // A new episode after the recovery complains again (the marker was cleared by the met hour).
    const again = closeHour({ ...recovered, sim: { ...recovered.sim, tick: 6 * TICKS_PER_HOUR }, hour: closingHour(1.1) }, MIDWEST, content);
    expect(again.inbox.filter((m) => m.subject === 'TSO response is slow')).toHaveLength(1);
    const second = closeHour({ ...again, sim: { ...again.sim, tick: 7 * TICKS_PER_HOUR }, hour: closingHour(1.2) }, MIDWEST, content);
    expect(slowInternalOf(second, content.internalGoal)).toMatchObject({ key: '0:11', missedHours: 2 });
    expect(second.inbox.filter((m) => m.subject === 'TSO response is slow')).toHaveLength(2);
  });

  it('raises the price after a real DEVT cap and restores it when the cap is released', () => {
    // The flowing path: a hard cap on the LPAR that carries 85 % of TSO's work makes every TSO hour miss the goal.
    let r = startDay(newRun(MIDWEST, content, 7), content);
    r = { ...r, sim: applyCommand(r.sim, { kind: 'SET_ABSOLUTE_CAP', lparId: 'DEVT', engines: 0.2 }).state };
    r = advance(r, MIDWEST, content, 3 * TICKS_PER_HOUR);
    expect(slowInternalOf(r, content.internalGoal)).toMatchObject({ workloadId: 'TSO', missedHours: 3, hoursMult: 1.5 });
    expect(r.inbox.filter((m) => m.subject === 'TSO response is slow')).toHaveLength(1);
    expect(previewChange(previewContext(r, content), { commands: [weight(500)] }).hours).toBeCloseTo(0.75);
    // Release the cap: the next full hour is back under the goal, and the derived surcharge goes with it.
    r = { ...r, sim: applyCommand(r.sim, { kind: 'SET_ABSOLUTE_CAP', lparId: 'DEVT', engines: null }).state };
    r = advance(r, MIDWEST, content, 2 * TICKS_PER_HOUR);
    expect(slowInternalOf(r, content.internalGoal)).toBeNull();
    expect(previewChange(previewContext(r, content), { commands: [weight(500)] }).hours).toBeCloseTo(0.5);
  }, 180_000);
});
