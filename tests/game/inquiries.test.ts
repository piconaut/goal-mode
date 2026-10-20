import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { askAround, deliverInquiries } from '../../src/game/inquiries';
import { newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';
import { TICKS_PER_HOUR } from '../../src/sim/core/units';

const content = { ...MIDWEST_GAME, events: [] };
const ok = (out: { run: RunState; ok: boolean; message: string }) => {
  expect(out.ok, out.message).toBe(true);
  return out.run;
};
/** Jump the clock (the reply logic only reads the tick). */
const at = (r: RunState, hourAfter0600: number): RunState => ({ ...r, sim: { ...r.sim, tick: Math.round(hourAfter0600 * TICKS_PER_HOUR) } });

describe('ask around', () => {
  it('costs time, limits open questions and answers later with one fragment', () => {
    let r = startDay(newRun(MIDWEST, content, 7), content);
    const hours = r.hoursLeft;
    r = ok(askAround(r, 'CRITICAL_PATH', null, MIDWEST));
    expect(r.hoursLeft).toBeCloseTo(hours - 0.25);
    expect(askAround(r, 'CRITICAL_PATH', null, MIDWEST).ok).toBe(false); // already asked
    expect(askAround(r, 'APP_ENTRY', null, MIDWEST).ok).toBe(false); // needs an app
    r = ok(askAround(r, 'APP_ENTRY', 'MOBILE', MIDWEST));
    r = ok(askAround(r, 'JOB_CLASSES', null, MIDWEST));
    expect(askAround(r, 'CALENDAR', null, MIDWEST).ok).toBe(false); // 3 open
    const inbox = r.inbox.length;
    expect(deliverInquiries(at(r, 0.5), MIDWEST, content).inbox.length).toBe(inbox); // too early
    // Night: nobody answers even if due.
    expect(deliverInquiries(at(r, 14), MIDWEST, content).inbox.length).toBe(inbox);
    const answered = deliverInquiries(at(r, 9), MIDWEST, content); // 15:00
    expect(answered.inbox.length).toBe(inbox + 3);
    expect(answered.inquiries!.pending).toEqual([]);
    const replies = answered.inbox.slice(-3).map((m) => m.body).join('\n');
    expect(replies).toMatch(/[A-Z]{3}\d{3}|MOBAPI|ZCONNECT|MOBPKG|DDF|class|Honestly|Not sure|asking|heads-down|predates/);
  });

  it('never repeats a fragment', () => {
    let r = startDay(newRun(MIDWEST, content, 11), content);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      r = { ...r, hoursLeft: 8 };
      r = ok(askAround(r, 'CRITICAL_PATH', null, MIDWEST));
      r = deliverInquiries(at(r, 9), MIDWEST, content);
      r = at(r, 0);
    }
    for (const k of r.inquiries!.revealed) {
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});
