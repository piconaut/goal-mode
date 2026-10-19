import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { workOnProject } from '../../src/game/projects';
import { advance, chooseDraft, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { TICKS_PER_DAY } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };
const ok = (out: { run: RunState; ok: boolean; message: string }) => {
  expect(out.ok, out.message).toBe(true);
  return out.run;
};

describe('projects', () => {
  it('respect the daily ceiling and the briefing, and apply their effect on completion', () => {
    let r = newRun(MIDWEST, content, 7);
    r = ok(workOnProject(r, 'SQL_TUNING', 6));
    expect(workOnProject(r, 'SQL_TUNING', 2).ok).toBe(false); // 6h/day ceiling
    expect(r.hoursLeft).toBeCloseTo(8 - 6);
    r = advance(startDay(r, content), MIDWEST, content, 10);
    expect(workOnProject(r, 'SQL_TUNING', 2).ok).toBe(false); // live day
    r = advance(r, MIDWEST, content, TICKS_PER_DAY);
    r = chooseDraft(r, content, null);
    r = ok(workOnProject(r, 'SQL_TUNING', 6));
    expect(r.projects.find((p) => p.id === 'SQL_TUNING')!.done).toBe(true);
    r = advance(startDay(r, content), MIDWEST, content, 1);
    expect(r.sim.mods.efficiency?.RBANK).toBeCloseTo(0.85);
  }, 60_000);

  it('threadsafe conversion lowers every region’s QR share; zIIP enablement moves CPU to zIIP', () => {
    let r = newRun(MIDWEST, content, 7);
    r = { ...r, projects: [{ id: 'THREADSAFE', hoursDone: 20, hoursToday: 0, day: 0, done: false }, { id: 'ZIIP_JAVA', hoursDone: 16, hoursToday: 0, day: 0, done: false }] };
    const before = r.sim.config.cics.map((c) => c.qrFrac);
    r = ok(workOnProject(r, 'THREADSAFE', 4));
    r = ok(workOnProject(r, 'ZIIP_JAVA', 4));
    r = advance(startDay(r, content), MIDWEST, content, 6 * 360);
    r.sim.config.cics.forEach((c, i) => expect(c.qrFrac).toBeCloseTo(before[i]! * 0.4));
    expect(r.sim.mods.ziipShift?.MOBILE).toBeCloseTo(0.25);
  }, 60_000);
});
