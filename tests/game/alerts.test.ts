import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { ALERTS } from '../../src/content/alerts';
import { MIDWEST } from '../../src/content/scenarios';
import { addAlertRule, alertValue, removeAlertRule } from '../../src/game/alerts';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';

const content = { ...MIDWEST_GAME, events: [] };
const tools = ['RMF_MON3', 'ALERTS'];
const add = (r: RunState, rule: Parameters<typeof addAlertRule>[1]) => {
  const out = addAlertRule(r, rule);
  expect(out.ok, out.message).toBe(true);
  return out.run;
};

describe('alert rules', () => {
  it('fire after the condition holds for the set time, then clear', () => {
    let r = startDay({ ...newRun(MIDWEST, content, 7), tools }, content);
    r = advance(r, MIDWEST, content, 6 * 360); // noon
    const busy = alertValue(r, MIDWEST, { metric: 'CPC_BUSY', subject: '' })!;
    expect(busy).toBeGreaterThan(10);
    r = add(r, { metric: 'CPC_BUSY', subject: '', threshold: busy * 0.5, forMin: 5, pause: true });
    const id = r.alerts.rules[0]!.id;
    r = advance(r, MIDWEST, content, 12); // 2 min: holding, not yet long enough
    expect(r.alerts.firing).toEqual([]);
    r = advance(r, MIDWEST, content, 30); // 7 min
    expect(r.alerts.firing).toEqual([id]);
    expect(r.alerts.pauseRequested).toBe(true);
    expect(r.alerts.log.at(-1)!.text).toMatch(/PAGE: CPC busy > /);
    const fired = r.alerts.log.length;
    r = advance(r, MIDWEST, content, 30); // still breached: no second page
    expect(r.alerts.log.length).toBe(fired);
    // Raise the bar above the current value: the next evaluation clears it.
    r = { ...r, alerts: { ...r.alerts, rules: r.alerts.rules.map((x) => ({ ...x, threshold: 100 })) } };
    r = advance(r, MIDWEST, content, 6);
    expect(r.alerts.firing).toEqual([]);
    expect(r.alerts.log.at(-1)!.kind).toBe('CLEARED');
    expect(removeAlertRule(r, id).alerts.rules).toHaveLength(0);
  }, 60_000);

  it('pages at night cost fatigue; nothing is evaluated without the tool', () => {
    const base = advance(startDay(newRun(MIDWEST, content, 7), content), MIDWEST, content, 15 * 360); // 21:00
    const rule = { metric: 'CPC_BUSY' as const, subject: '', threshold: 0, forMin: 0, pause: false };
    const on = advance(add({ ...base, tools }, rule), MIDWEST, content, 12);
    expect(on.alerts.firing).toHaveLength(1);
    expect(on.fatigue).toBeCloseTo(base.fatigue + ALERTS.nightFatigue);
    const off = advance(add(base, rule), MIDWEST, content, 12);
    expect(off.alerts.firing).toHaveLength(0);
  }, 60_000);

  it('validates rules', () => {
    const r = newRun(MIDWEST, content, 7);
    expect(addAlertRule(r, { metric: 'PI', subject: '', threshold: 1.5, forMin: 5, pause: false }).ok).toBe(false);
    let x = r;
    for (let i = 0; i < ALERTS.maxRules; i++) x = add(x, { metric: 'CPC_BUSY', subject: '', threshold: 90, forMin: 5, pause: false });
    expect(addAlertRule(x, { metric: 'CPC_BUSY', subject: '', threshold: 90, forMin: 5, pause: false }).ok).toBe(false);
  });
});
