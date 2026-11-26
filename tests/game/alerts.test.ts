import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { ALERTS } from '../../src/content/alerts';
import { MIDWEST } from '../../src/content/scenarios';
import { addAlertRule, alertValue, evaluateAlerts, removeAlertRule } from '../../src/game/alerts';
import { requestOperation } from '../../src/game/operations';
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

  it('clears firing rules while MONAGENT is down and restarts their duration when it returns', () => {
    let r = startDay({ ...newRun(MIDWEST, content, 7), tools }, content);
    r = advance(r, MIDWEST, content, 6 * 360);
    r = add(r, { metric: 'CPC_BUSY', subject: '', threshold: 0, forMin: 5, pause: false });
    r = advance(r, MIDWEST, content, 6 * 6 + 6);
    expect(r.alerts.firing).toHaveLength(1);
    const down = requestOperation(r, MIDWEST, content, { kind: 'CANCEL_ADDRESS_SPACE', jobname: 'MONAGENT', lparId: 'PROD1' });
    expect(down.ok, down.message).toBe(true);
    const gap = advance(down.run, MIDWEST, content, 12);
    expect(gap.alerts.firing).toEqual([]);
    expect(gap.alerts.breachSince).toEqual({});
    expect(gap.alerts.log.at(-1)!.text).toMatch(/no data \(MONAGENT down\)/);
    // Automation restarts it; the 5-minute condition must hold again in full before it pages.
    const back = down.run.sim.cancelledAddressSpaces![0]!.restartTick!;
    const after = advance(gap, MIDWEST, content, back - gap.sim.tick + 6 * 4);
    expect(after.alerts.firing).toEqual([]);
    expect(advance(after, MIDWEST, content, 6 * 2).alerts.firing).toHaveLength(1);
  }, 60_000);

  it('watches CICS short-on-storage minutes per region', () => {
    let r = startDay({ ...newRun(MIDWEST, content, 7), tools }, content);
    r = advance(r, MIDWEST, content, 6);
    expect(r.hour).not.toBeNull();
    r = { ...r, hour: { ...r.hour!, cicsStorage: { PROD2AOR: { peakMb: 800, limitMb: 800, sosSec: 120 } } } };
    expect(alertValue(r, MIDWEST, { metric: 'CICS_SOS', subject: 'PROD2AOR' })).toBeNull();
    r = { ...r, tools: [...tools, 'CICS_MON'] };
    expect(alertValue(r, MIDWEST, { metric: 'CICS_SOS', subject: 'PROD2AOR' })).toBe(2);
    expect(alertValue(r, MIDWEST, { metric: 'CICS_SOS', subject: 'MISSING' })).toBeNull();
    r = add(r, { metric: 'CICS_SOS', subject: 'PROD2AOR', threshold: 1, forMin: 0, pause: false });
    r = evaluateAlerts(r, MIDWEST);
    expect(r.alerts.firing).toHaveLength(1);
    expect(r.alerts.log.at(-1)!.text).toMatch(/PAGE: CICS region short on storage PROD2AOR > 1min/);
    const off = { ...r, toolsOff: ['CICS_MON'] };
    expect(alertValue(off, MIDWEST, { metric: 'CICS_SOS', subject: 'PROD2AOR' })).toBeNull();
    const cleared = evaluateAlerts(off, MIDWEST);
    expect(cleared.alerts.firing).toEqual([]);
    expect(cleared.alerts.log.at(-1)!.kind).toBe('CLEARED');
  }, 60_000);

  it('validates rules', () => {
    const r = newRun(MIDWEST, content, 7);
    expect(addAlertRule(r, { metric: 'PI', subject: '', threshold: 1.5, forMin: 5, pause: false }).ok).toBe(false);
    let x = r;
    for (let i = 0; i < ALERTS.maxRules; i++) x = add(x, { metric: 'CPC_BUSY', subject: '', threshold: 90, forMin: 5, pause: false });
    expect(addAlertRule(x, { metric: 'CPC_BUSY', subject: '', threshold: 90, forMin: 5, pause: false }).ok).toBe(false);
  });
});
