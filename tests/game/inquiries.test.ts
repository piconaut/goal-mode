import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { FRIENDLY_PREFIX, RUDE_REPLIES } from '../../src/content/inquiries';
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

  it('can be asked in the end-of-day review, on tomorrow\'s hours, but not once the run is over', () => {
    const r = newRun(MIDWEST, content, 7);
    expect(askAround({ ...r, phase: 'REVIEW' }, 'JOB_CLASSES', null, MIDWEST).ok).toBe(true);
    expect(askAround({ ...r, phase: 'GAMEOVER' }, 'JOB_CLASSES', null, MIDWEST).ok).toBe(false);
    expect(askAround(r, 'NOPE' as never, null, MIDWEST).message).toContain('JOB_CLASSES');
  });

  it('never repeats a fragment', () => {
    let r = startDay(newRun(MIDWEST, content, 11), content);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      r = { ...r, hoursLeft: 8 };
      r = ok(askAround(r, 'CRITICAL_PATH', null, MIDWEST));
      r = deliverInquiries(at(r, 9), MIDWEST, content);
      r = at(r, (i + 1) / 10);
    }
    for (const k of r.inquiries!.revealed) {
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('ask around: stakeholder mood', () => {
  const askMobile = (trust: number, seed: number) => {
    let r = startDay(newRun(MIDWEST, content, seed), content);
    r = { ...r, trust: { ...r.trust, Digital: trust } };
    r = ok(askAround(r, 'APP_ENTRY', 'MOBILE', MIDWEST));
    return deliverInquiries(at(r, 9), MIDWEST, content);
  };
  it('a stakeholder who has lost trust is rude and tells you nothing', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r = askMobile(10, seed);
      expect(RUDE_REPLIES).toContain(r.inbox.at(-1)!.body);
      expect(r.inquiries!.revealed).toEqual([]);
    }
  });
  it('a happy stakeholder is friendly', () => {
    const bodies = [1, 2, 3, 4, 5].map((seed) => askMobile(95, seed).inbox.at(-1)!.body);
    expect(bodies.some((b) => FRIENDLY_PREFIX.some((p) => b.startsWith(p)))).toBe(true);
    expect(bodies.some((b) => RUDE_REPLIES.includes(b))).toBe(false);
  });
  it('IT colleagues answer on the merits whatever the business thinks', () => {
    let r = startDay(newRun(MIDWEST, content, 3), content);
    r = { ...r, trust: { Retail: 5, Cards: 5, Digital: 5, Payments: 5, Finance: 5, Regulator: 5 } };
    r = ok(askAround(r, 'JOB_CLASSES', null, MIDWEST));
    r = deliverInquiries(at(r, 9), MIDWEST, content);
    expect(RUDE_REPLIES).not.toContain(r.inbox.at(-1)!.body);
  });
});
