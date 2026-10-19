import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { MIDWEST } from '../../src/content/scenarios';
import { addAlertRule } from '../../src/game/alerts';
import { addAutoRule } from '../../src/game/automation';
import { savePolicy } from '../../src/game/policies';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';

const content = { ...MIDWEST_GAME, events: [] };
const tools = ['RMF_MON3', 'ALERTS', 'AUTOMATION'];
const ok = (out: { run: RunState; ok: boolean; message: string }) => {
  expect(out.ok, out.message).toBe(true);
  return out.run;
};

function setup(): RunState {
  let r = startDay({ ...newRun(MIDWEST, content, 7), tools }, content);
  r = ok(savePolicy(r, { ...r.sim.wlm.definition, policyName: 'PEAKPOL' }));
  r = ok(addAlertRule(r, { metric: 'CPC_BUSY', subject: '', threshold: 1, forMin: 0, pause: false }));
  return r;
}

describe('automation', () => {
  it('acts on an alert without engineer-hours or trust cost (or misfires visibly)', () => {
    let r = setup();
    r = ok(addAutoRule(r, { trigger: { kind: 'ALERT', alertId: r.alerts.rules[0]!.id }, action: { kind: 'ACTIVATE_POLICY', policyName: 'PEAKPOL' }, maxPerDay: 2 }));
    const hours = r.hoursLeft;
    const trust = { ...r.trust };
    r = advance(r, MIDWEST, content, 60);
    const log = r.automation.log.map((e) => e.text).join('\n');
    expect(log).toMatch(/activated policy PEAKPOL|MISFIRE/);
    if (log.includes('activated')) expect(advance(r, MIDWEST, content, 1).sim.wlm.definition.policyName).toBe('PEAKPOL');
    expect(r.hoursLeft).toBe(hours);
    expect(r.trust).toEqual(trust);
  }, 60_000);

  it('restarts an abended critical job once', () => {
    let r = setup();
    r = ok(addAutoRule(r, { trigger: { kind: 'JOB_ABEND', criticalOnly: true }, action: { kind: 'RESTART_JOB' }, maxPerDay: 5 }));
    r = advance(r, MIDWEST, content, 16 * 360); // 22:00, batch running
    r = advance({ ...r, pendingCommands: [{ kind: 'ABEND_JOB', critical: true }] }, MIDWEST, content, 12);
    expect(r.automation.restarted.length).toBe(1);
    expect(r.automation.log.at(-1)!.text).toMatch(/restarted|MISFIRE/);
  }, 60_000);

  it('Capacity Provisioning refuses while an LPAR is hard-capped; rules are validated', () => {
    let r = setup();
    r = ok(addAutoRule(r, { trigger: { kind: 'ALERT', alertId: r.alerts.rules[0]!.id }, action: { kind: 'COD' }, maxPerDay: 1 }));
    r = advance({ ...r, pendingCommands: [{ kind: 'SET_ABSOLUTE_CAP', lparId: 'DEVT', engines: 1 }] }, MIDWEST, content, 30);
    expect(r.automation.log.at(-1)!.text).toMatch(/CPM refused: an LPAR is hard-capped/);
    expect(addAutoRule(r, { trigger: { kind: 'ALERT', alertId: 99999 }, action: { kind: 'COD' }, maxPerDay: 1 }).ok).toBe(false);
    expect(addAutoRule(r, { trigger: { kind: 'JOB_ABEND', criticalOnly: true }, action: { kind: 'COD' }, maxPerDay: 1 }).ok).toBe(false);
    expect(addAutoRule(r, { trigger: { kind: 'ALERT', alertId: r.alerts.rules[0]!.id }, action: { kind: 'ACTIVATE_POLICY', policyName: 'NOPE' }, maxPerDay: 1 }).ok).toBe(false);
  }, 60_000);
});
