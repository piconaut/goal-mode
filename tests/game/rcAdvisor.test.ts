import { MIDWEST } from '../../src/content/scenarios';
import { BASEPOL } from '../../src/content/wlm/basepol';
import { workItems } from '../../src/game/classifyExplain';
import { adviseReportClasses } from '../../src/game/rcAdvisor';
import { applyWlmEdit } from '../../src/game/wlmEdit';
import { classify } from '../../src/sim/wlm/classify';
import type { ServiceDefinition } from '../../src/sim/wlm/types';

const items = workItems(MIDWEST.workloads, MIDWEST.addressSpaces, MIDWEST.batchNetwork(42, 0, 3));

describe('report class advisor', () => {
  it('suggests a report class for every workload sharing a service class (F6)', () => {
    const advice = adviseReportClasses(BASEPOL, items);
    const ids = advice.map((a) => a.workloadId);
    expect(ids).toEqual(expect.arrayContaining(['MOBILE', 'ADHOC', 'RBANK', 'CARDAUTH']));
    expect(advice.find((a) => a.workloadId === 'MOBILE')!.sharedWith).toContain('ADHOC');
    expect(new Set(advice.map((a) => a.suggested)).size).toBe(advice.length);
  });

  it('applying every suggestion gives each workload its own report class and changes no service class', () => {
    let def: ServiceDefinition = BASEPOL;
    for (let i = 0; i < 30; i++) {
      const a = adviseReportClasses(def, items)[0];
      if (!a) break;
      const res = applyWlmEdit(def, a.edit);
      if (typeof res === 'string') throw new Error(res);
      def = res;
    }
    expect(adviseReportClasses(def, items)).toEqual([]);
    for (const it of items) expect(classify(def, it.work).serviceClass, it.label).toBe(classify(BASEPOL, it.work).serviceClass);
    const rcs = MIDWEST.workloads.map((w) => classify(def, w.work).reportClass);
    expect(rcs.filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });
});
