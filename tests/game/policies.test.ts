import { MIDWEST_GAME } from '../../src/content/game-midwest';
import { POLICY_SCHEDULE } from '../../src/content/alerts';
import { MIDWEST } from '../../src/content/scenarios';
import { deletePolicy, savePolicy, setSchedule } from '../../src/game/policies';
import { advance, newRun, startDay } from '../../src/game/run';
import type { RunState } from '../../src/game/types';

const content = { ...MIDWEST_GAME, events: [] };
const ok = (out: { run: RunState; ok: boolean; message: string }) => {
  expect(out.ok, out.message).toBe(true);
  return out.run;
};

describe('WLM policy schedule', () => {
  it('switches policies at the scheduled hour every day', () => {
    let r = newRun(MIDWEST, content, 7);
    const def = r.sim.wlm.definition;
    r = ok(savePolicy(r, { ...def, policyName: 'DAYPOL' }));
    // A night policy that lifts batch: BATCHPRD to importance 2.
    const night = structuredClone(def);
    night.policyName = 'NIGHTPOL';
    const b = night.classes.find((c) => c.id === 'BATCHPRD')!;
    b.periods[0]!.importance = 2;
    r = ok(savePolicy(r, night));
    const hours = r.hoursLeft;
    r = ok(setSchedule(r, [{ hour: 20, policyName: 'NIGHTPOL' }, { hour: 6, policyName: 'DAYPOL' }]));
    expect(r.hoursLeft).toBeCloseTo(hours - POLICY_SCHEDULE.editHours);
    r = advance(startDay(r, content), MIDWEST, content, 14 * 360 + 1); // 06:00 → 20:00 (+1 tick)
    expect(r.sim.wlm.definition.policyName).toBe('NIGHTPOL');
    expect(r.log.some((l) => l.includes('V WLM,POLICY=NIGHTPOL'))).toBe(true);
  }, 60_000);

  it('validates the schedule and protects scheduled policies', () => {
    let r = newRun(MIDWEST, content, 7);
    r = ok(savePolicy(r, { ...r.sim.wlm.definition, policyName: 'DAYPOL' }));
    expect(setSchedule(r, [{ hour: 6, policyName: 'NOPE' }]).ok).toBe(false);
    expect(setSchedule(r, [{ hour: 24, policyName: 'DAYPOL' }]).ok).toBe(false);
    expect(setSchedule(r, [{ hour: 6, policyName: 'DAYPOL' }, { hour: 6, policyName: 'DAYPOL' }]).ok).toBe(false);
    expect(setSchedule({ ...r, constraints: ['FREEZE'] }, [{ hour: 6, policyName: 'DAYPOL' }]).ok).toBe(false);
    r = ok(setSchedule(r, [{ hour: 6, policyName: 'DAYPOL' }]));
    expect(deletePolicy(r, 'DAYPOL').ok).toBe(false);
    for (let i = 0; i < POLICY_SCHEDULE.maxSaved - 1; i++) r = ok(savePolicy(r, { ...r.sim.wlm.definition, policyName: `P${i}` }));
    expect(savePolicy(r, { ...r.sim.wlm.definition, policyName: 'ONEMORE' }).ok).toBe(false);
    // Re-saving an existing name replaces it.
    expect(savePolicy(r, { ...r.sim.wlm.definition, policyName: 'DAYPOL' }).ok).toBe(true);
  });
});
