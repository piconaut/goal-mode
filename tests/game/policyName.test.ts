import { BASEPOL } from '../../src/content/wlm/basepol';
import { nextPolicyName, pendingBase } from '../../src/game/wlmEdit';

describe('pending policy names', () => {
  it('numbers successive policies and stays within 8 characters', () => {
    expect(nextPolicyName('BASEPOL')).toBe('BASEPOL2');
    expect(nextPolicyName('BASEPOL2')).toBe('BASEPOL3');
    expect(nextPolicyName('BASEPOL9')).toBe('BASEPO10');
    expect(nextPolicyName('BASEPO10')).toBe('BASEPO11');
    expect(nextPolicyName('NIGHT')).toBe('NIGHT2');
  });

  it('edits build on the pending policy, or a renamed copy of the active one', () => {
    expect(pendingBase(null, BASEPOL)).toEqual({ ...BASEPOL, policyName: nextPolicyName(BASEPOL.policyName) });
    const pending = { ...BASEPOL, policyName: 'MINE' };
    expect(pendingBase(pending, BASEPOL)).toBe(pending);
  });
});
