import { BASEPOL } from '../../src/content/wlm/basepol';
import { applyWlmEdit } from '../../src/game/wlmEdit';
import type { ServiceDefinition } from '../../src/sim/wlm/types';

describe('resource group edits', () => {
  it('create, validate, share and drop resource groups', () => {
    const ok = (r: ServiceDefinition | string) => {
      if (typeof r === 'string') throw new Error(r);
      return r;
    };
    let d = ok(applyWlmEdit(BASEPOL, { op: 'SET_RESOURCE_GROUP', classId: 'STCMED', group: { id: 'RGDB2', type: 3, min: 150, max: null } }));
    expect(d.resourceGroups).toEqual([{ id: 'RGDB2', type: 3, min: 150, max: null }]);
    expect(applyWlmEdit(d, { op: 'SET_RESOURCE_GROUP', classId: 'STCMED', group: { id: 'RGDB2', type: 3, min: 300, max: 100 } })).toMatch(/above maximum/);
    d = ok(applyWlmEdit(d, { op: 'SET_RESOURCE_GROUP', classId: 'STCHI', group: { id: 'RGDB2', type: 3, min: 200, max: null } }));
    expect(d.resourceGroups[0]!.min).toBe(200);
    d = ok(applyWlmEdit(d, { op: 'SET_RESOURCE_GROUP', classId: 'STCMED', group: null }));
    expect(d.resourceGroups).toHaveLength(1);
    d = ok(applyWlmEdit(d, { op: 'SET_RESOURCE_GROUP', classId: 'STCHI', group: null }));
    expect(d.resourceGroups).toEqual([]);
  });
});
